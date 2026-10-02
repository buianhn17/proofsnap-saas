// Đọc metadata chụp ảnh trực tiếp từ nhị phân file (không dùng thư viện ngoài, không decode
// ảnh): thời điểm chụp tới mili-giây (DateTimeOriginal + SubSecTimeOriginal) để gom burst,
// hướng xoay (Orientation) để dựng đúng chiều ảnh preview nhúng trong RAW, và thông số
// phơi sáng (tiêu cự, khẩu độ, tốc độ, ISO). Hỗ trợ JPEG, RAW dạng TIFF (CR2/NEF/ARW/DNG/
// PEF/ORF/RW2...), CR3 (ISO-BMFF) và RAF. Mọi lỗi/thiếu tag đều trả giá trị null thay vì
// ném lỗi — ảnh thiếu EXIF vẫn phải phân tích được (tầng gọi tự dùng phương án dự phòng).
// Thay cho exifTimestamp.ts cũ (chỉ đọc được DateTimeOriginal từ JPEG).

import { TiffReader, findFourcc, isCr3, isRaf } from "./tiffReader";

/** Đủ chứa toàn bộ IFD/EXIF của JPEG và hầu hết RAW (IFD nằm sát đầu file). */
export const METADATA_HEADER_BYTES = 1024 * 1024;

export interface PhotoMetadata {
  /** ms epoch theo giờ máy ảnh (EXIF không có timezone — chỉ dùng để so khoảng cách giữa
   * các ảnh), đã cộng phần lẻ giây SubSecTimeOriginal nếu có. null nếu không đọc được. */
  capturedAtMs: number | null;
  /** true nếu capturedAtMs có phần lẻ giây thật — không có thì 2 ảnh burst cách nhau 0.3s
   * vẫn có thể lệch nhau tròn 1s, tầng gom burst cần nới ngưỡng thời gian. */
  hasSubSecond: boolean;
  /** EXIF Orientation 1-8 (1 = không xoay). */
  orientation: number;
  focalLengthMm: number | null;
  fNumber: number | null;
  exposureTimeS: number | null;
  iso: number | null;
}

export const EMPTY_METADATA: PhotoMetadata = {
  capturedAtMs: null,
  hasSubSecond: false,
  orientation: 1,
  focalLengthMm: null,
  fNumber: null,
  exposureTimeS: null,
  iso: null,
};

// Tag EXIF/TIFF dùng tới.
const TAG_ORIENTATION = 0x0112;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_F_NUMBER = 0x829d;
const TAG_ISO = 0x8827;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_SUBSEC_TIME_ORIGINAL = 0x9291;
const TAG_FOCAL_LENGTH = 0x920a;

export interface JpegHeaderInfo {
  width: number;
  height: number;
  /** false nếu là JPEG lossless/arithmetic (ví dụ dữ liệu RAW nén JPEG lossless trong DNG) —
   * trình duyệt không decode được, không dùng làm preview. */
  displayable: boolean;
  /** Vị trí header TIFF của khối EXIF (APP1) nếu có. */
  exifTiffOffset: number | null;
}

/**
 * Duyệt các marker của 1 JPEG bắt đầu tại `start` cho tới SOF (lấy kích thước) — không
 * decode dữ liệu ảnh. null nếu không phải JPEG hoặc header bị cắt cụt ngoài vùng đã nạp.
 */
export function parseJpegHeader(view: DataView, start: number): JpegHeaderInfo | null {
  if (start + 4 > view.byteLength || view.getUint16(start) !== 0xffd8) return null;

  let offset = start + 2;
  let exifTiffOffset: number | null = null;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) return null;
    // Byte đệm 0xFF trước marker — bỏ qua.
    if (marker === 0xffff) {
      offset += 1;
      continue;
    }
    if (marker === 0xffd9 || marker === 0xffda) return null; // tới EOI/SOS mà chưa thấy SOF
    const segmentLength = view.getUint16(offset + 2);

    if (
      marker === 0xffe1 &&
      exifTiffOffset === null &&
      offset + 10 <= view.byteLength &&
      view.getUint32(offset + 4) === 0x45786966 // "Exif"
    ) {
      exifTiffOffset = offset + 10;
    }

    // SOF0-SOF15, trừ DHT (C4), JPG (C8), DAC (CC).
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
      if (offset + 9 > view.byteLength) return null;
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
        // Chỉ baseline (C0), extended (C1), progressive (C2) là định dạng trình duyệt decode.
        displayable: marker <= 0xffc2,
        exifTiffOffset,
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function parseExifDateString(value: string): number | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const time = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s)
  ).getTime();
  return Number.isNaN(time) ? null : time;
}

/** "123" -> 0.123s, "5" -> 0.5s (SubSecTime là phần thập phân của giây, độ dài tuỳ máy). */
function parseSubSecondMs(value: string | null): number | null {
  const digits = value?.trim().match(/^\d+/)?.[0];
  if (!digits) return null;
  return Number(`0.${digits}`) * 1000;
}

/** Đọc các tag cần thiết từ IFD0 (+ Exif SubIFD nếu IFD0 trỏ tới). `exifIfdReader` cho phép
 * CR3 truyền 1 TIFF riêng chứa Exif IFD (box CMT2) thay vì con trỏ 0x8769. */
function readFromTiff(
  ifd0Reader: TiffReader | null,
  exifIfdReader: TiffReader | null = null
): PhotoMetadata {
  const result: PhotoMetadata = { ...EMPTY_METADATA };

  const ifd0 = ifd0Reader?.readIfd(ifd0Reader.firstIfdOffset)?.entries;
  let exifReader = exifIfdReader;
  let exifIfd = exifIfdReader?.readIfd(exifIfdReader.firstIfdOffset)?.entries;

  if (ifd0Reader && ifd0) {
    const orientation = ifd0Reader.number(ifd0.get(TAG_ORIENTATION));
    if (orientation !== null && orientation >= 1 && orientation <= 8) {
      result.orientation = orientation;
    }
    const exifPointer = ifd0Reader.number(ifd0.get(TAG_EXIF_IFD));
    if (!exifIfd && exifPointer !== null) {
      exifReader = ifd0Reader;
      exifIfd = ifd0Reader.readIfd(exifPointer)?.entries;
    }
  }

  let capturedAtMs: number | null = null;
  if (exifReader && exifIfd) {
    capturedAtMs = parseExifDateString(
      exifReader.string(exifIfd.get(TAG_DATETIME_ORIGINAL)) ?? ""
    );
    const subSecondMs = parseSubSecondMs(
      exifReader.string(exifIfd.get(TAG_SUBSEC_TIME_ORIGINAL))
    );
    if (capturedAtMs !== null && subSecondMs !== null) {
      capturedAtMs += subSecondMs;
      result.hasSubSecond = true;
    }
    result.focalLengthMm = exifReader.number(exifIfd.get(TAG_FOCAL_LENGTH));
    result.fNumber = exifReader.number(exifIfd.get(TAG_F_NUMBER));
    result.exposureTimeS = exifReader.number(exifIfd.get(TAG_EXPOSURE_TIME));
    result.iso = exifReader.number(exifIfd.get(TAG_ISO));
  }
  // Thiếu DateTimeOriginal — thử DateTime (thời điểm ghi file) ở IFD0.
  if (capturedAtMs === null && ifd0Reader && ifd0) {
    capturedAtMs = parseExifDateString(ifd0Reader.string(ifd0.get(TAG_DATETIME)) ?? "");
  }
  result.capturedAtMs = capturedAtMs;
  return result;
}

/** Metadata từ vùng byte đầu file đã nạp sẵn (tối đa METADATA_HEADER_BYTES). */
export function parseMetadataFromHeader(bytes: Uint8Array): PhotoMetadata {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 16) return { ...EMPTY_METADATA };

    // JPEG: EXIF nằm trong segment APP1.
    if (view.getUint16(0) === 0xffd8) {
      const header = parseJpegHeader(view, 0);
      return header?.exifTiffOffset != null
        ? readFromTiff(TiffReader.open(view, header.exifTiffOffset))
        : { ...EMPTY_METADATA };
    }

    // CR3: IFD0 trong box CMT1, Exif IFD trong box CMT2 — mỗi box là 1 TIFF độc lập.
    if (isCr3(bytes)) {
      const cmt1 = findFourcc(bytes, "CMT1");
      const cmt2 = findFourcc(bytes, "CMT2");
      return readFromTiff(
        cmt1 >= 0 ? TiffReader.open(view, cmt1 + 4) : null,
        cmt2 >= 0 ? TiffReader.open(view, cmt2 + 4) : null
      );
    }

    // RAF: metadata nằm trong JPEG nhúng (offset ở byte 84, big-endian).
    if (isRaf(bytes)) {
      const jpegOffset = view.getUint32(84);
      const header = parseJpegHeader(view, jpegOffset);
      return header?.exifTiffOffset != null
        ? readFromTiff(TiffReader.open(view, header.exifTiffOffset))
        : { ...EMPTY_METADATA };
    }

    // RAW dạng TIFF: bản thân file là TIFF.
    return readFromTiff(TiffReader.open(view, 0));
  } catch {
    // Header hỏng/cắt cụt bất thường — coi như không có metadata.
    return { ...EMPTY_METADATA };
  }
}

export async function readFileHeader(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, METADATA_HEADER_BYTES).arrayBuffer());
}

export async function readPhotoMetadata(file: Blob): Promise<PhotoMetadata> {
  try {
    return parseMetadataFromHeader(await readFileHeader(file));
  } catch {
    return { ...EMPTY_METADATA };
  }
}
