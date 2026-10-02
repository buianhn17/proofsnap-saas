// Trích ảnh JPEG preview mà máy ảnh đã nhúng sẵn trong file RAW, thay vì decode file gốc.
//
// Mọi máy ảnh đều nhúng ít nhất 1 bản JPEG đã xử lý màu sẵn trong file RAW (để màn hình máy
// ảnh hiển thị/zoom). Decode bản ~1600-2000px đó nhanh hơn decode JPEG full 24-60MP cùng
// cặp hàng chục lần, và chỉ cần đọc đúng vài trăm KB tại offset của nó thay vì cả file
// 30-80MB. Vị trí preview theo định dạng:
//   - TIFF-based (CR2, NEF, ARW, DNG, PEF, ORF, RW2...): tag JPEGInterchangeFormat ở các
//     IFD/SubIFD, strip nén JPEG (Compression 6/7), hoặc tag JpgFromRaw (RW2).
//   - CR3: box "PRVW" (~1620x1080) trong uuid box của Canon.
//   - RAF: JPEG nhúng ngay sau header (offset ở byte 84).
// Chọn preview NHỎ NHẤT nhưng vẫn đạt cạnh dài tối thiểu — đủ chi tiết cho phân tích mà
// decode rẻ nhất. Không có preview đạt chuẩn -> trả null, tầng gọi tự decode file JPEG.

import { parseJpegHeader, readFileHeader } from "./exifMetadata";
import { TiffReader, findFourcc, isCr3, isRaf } from "./tiffReader";

export interface EmbeddedPreview {
  blob: Blob;
  width: number;
  height: number;
  /** true nếu bản thân JPEG preview có EXIF riêng (trình duyệt sẽ tự xoay theo Orientation
   * của nó khi decode); false -> tầng gọi phải tự xoay theo Orientation của file RAW. */
  hasOwnExif: boolean;
}

interface Candidate {
  offset: number;
  length: number;
}

const TAG_SUBIFDS = 0x014a;
const TAG_COMPRESSION = 0x0103;
const TAG_STRIP_OFFSETS = 0x0111;
const TAG_STRIP_BYTE_COUNTS = 0x0117;
const TAG_JPEG_OFFSET = 0x0201;
const TAG_JPEG_LENGTH = 0x0202;
const TAG_RW2_JPG_FROM_RAW = 0x002e;
// Tối đa số IFD duyệt — chặn vòng lặp vô hạn khi file hỏng có con trỏ IFD tự trỏ vòng.
const MAX_IFDS = 32;
// Đủ để đọc tới SOF của preview (thường nằm trong vài KB đầu, sau bảng lượng tử/EXIF).
const PREVIEW_HEADER_BYTES = 64 * 1024;

function collectTiffCandidates(view: DataView): Candidate[] {
  const reader = TiffReader.open(view, 0);
  if (!reader) return [];

  const candidates: Candidate[] = [];
  const queue: number[] = [reader.firstIfdOffset];
  const visited = new Set<number>();

  while (queue.length > 0 && visited.size < MAX_IFDS) {
    const ifdOffset = queue.shift()!;
    if (visited.has(ifdOffset)) continue;
    visited.add(ifdOffset);
    const ifd = reader.readIfd(ifdOffset);
    if (!ifd) continue;
    const { entries } = ifd;

    const jpegOffset = reader.number(entries.get(TAG_JPEG_OFFSET));
    const jpegLength = reader.number(entries.get(TAG_JPEG_LENGTH));
    if (jpegOffset && jpegLength) {
      candidates.push({ offset: reader.absolute(jpegOffset), length: jpegLength });
    }

    // Strip nén JPEG (Compression 6 = JPEG cũ, 7 = JPEG mới). Chỉ nhận 1 strip duy nhất —
    // preview luôn là 1 khối liền; nhiều strip thường là dữ liệu RAW thật.
    const compression = reader.number(entries.get(TAG_COMPRESSION));
    if (compression === 6 || compression === 7) {
      const offsets = reader.numbers(entries.get(TAG_STRIP_OFFSETS), 2);
      const counts = reader.numbers(entries.get(TAG_STRIP_BYTE_COUNTS), 2);
      if (offsets.length === 1 && counts.length === 1) {
        candidates.push({ offset: reader.absolute(offsets[0]), length: counts[0] });
      }
    }

    const rw2Jpeg = entries.get(TAG_RW2_JPG_FROM_RAW);
    if (rw2Jpeg && rw2Jpeg.type === 7) {
      candidates.push({ offset: rw2Jpeg.valueOffset, length: rw2Jpeg.count });
    }

    for (const subIfd of reader.numbers(entries.get(TAG_SUBIFDS), 8)) queue.push(subIfd);
    if (ifd.nextIfdOffset) queue.push(ifd.nextIfdOffset);
  }
  return candidates;
}

function collectCr3Candidates(bytes: Uint8Array, view: DataView): Candidate[] {
  // Layout box PRVW: [size u32]["PRVW"][header 16 byte][JPEG...]. Không phụ thuộc cứng vào
  // độ dài header — tìm SOI (FF D8) đầu tiên trong box, lấy tới hết box.
  const typePos = findFourcc(bytes, "PRVW");
  if (typePos < 4) return [];
  const boxStart = typePos - 4;
  const boxEnd = boxStart + view.getUint32(boxStart);
  for (let i = typePos + 4; i + 1 < Math.min(boxEnd, bytes.length); i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8) {
      return [{ offset: i, length: boxEnd - i }];
    }
  }
  return [];
}

function collectRafCandidates(view: DataView): Candidate[] {
  if (view.byteLength < 92) return [];
  return [{ offset: view.getUint32(84), length: view.getUint32(88) }];
}

async function inspectCandidate(
  file: Blob,
  candidate: Candidate
): Promise<(EmbeddedPreview & { longEdge: number }) | null> {
  if (candidate.offset <= 0 || candidate.length <= 0) return null;
  if (candidate.offset + candidate.length > file.size) return null;

  const header = new Uint8Array(
    await file
      .slice(candidate.offset, candidate.offset + Math.min(candidate.length, PREVIEW_HEADER_BYTES))
      .arrayBuffer()
  );
  const info = parseJpegHeader(new DataView(header.buffer), 0);
  if (!info || !info.displayable || info.width === 0 || info.height === 0) return null;

  return {
    blob: file.slice(candidate.offset, candidate.offset + candidate.length, "image/jpeg"),
    width: info.width,
    height: info.height,
    longEdge: Math.max(info.width, info.height),
    hasOwnExif: info.exifTiffOffset !== null,
  };
}

/**
 * Preview JPEG nhúng nhỏ nhất có cạnh dài >= minLongEdgePx, hoặc null nếu file không phải
 * RAW hỗ trợ / không có preview đủ lớn / file hỏng. Không bao giờ ném lỗi.
 */
export async function extractEmbeddedPreview(
  file: Blob,
  minLongEdgePx: number
): Promise<EmbeddedPreview | null> {
  try {
    const bytes = await readFileHeader(file);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 16) return null;

    const candidates = isCr3(bytes)
      ? collectCr3Candidates(bytes, view)
      : isRaf(bytes)
        ? collectRafCandidates(view)
        : collectTiffCandidates(view);

    const previews = (
      await Promise.all(candidates.map((c) => inspectCandidate(file, c).catch(() => null)))
    ).filter((p): p is NonNullable<typeof p> => p !== null && p.longEdge >= minLongEdgePx);
    if (previews.length === 0) return null;

    const smallest = previews.reduce((best, p) => (p.longEdge < best.longEdge ? p : best));
    return {
      blob: smallest.blob,
      width: smallest.width,
      height: smallest.height,
      hasOwnExif: smallest.hasOwnExif,
    };
  } catch {
    return null;
  }
}
