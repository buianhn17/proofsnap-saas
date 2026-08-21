// Bước 1.7 — đọc EXIF DateTimeOriginal trực tiếp từ nhị phân JPEG (không dùng thư viện
// ngoài — chỉ cần đúng 1-2 tag) để làm mốc thời gian gom scene theo buổi chụp. Chỉ đọc
// phần đầu file (EXIF luôn nằm ngay sau SOI) nên rẻ, không cần decode cả ảnh.

const HEADER_READ_BYTES = 128 * 1024;

/** Trả về thời điểm chụp (ms epoch) từ EXIF, hoặc null nếu không phải JPEG/không có EXIF/lỗi. */
export async function readExifDateTimeOriginal(
  file: File
): Promise<number | null> {
  try {
    const bytes = new Uint8Array(
      await file.slice(0, HEADER_READ_BYTES).arrayBuffer()
    );
    if (bytes.length < 4) return null;
    const view = new DataView(bytes.buffer);
    if (view.getUint16(0) !== 0xffd8) return null; // không phải JPEG (thiếu SOI)

    let offset = 2;
    while (offset + 4 <= bytes.length) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffd9 || marker === 0xffda) break; // EOI hoặc bắt đầu scan data

      const segmentLength = view.getUint16(offset + 2);
      if (marker === 0xffe1 && offset + 4 + 6 <= bytes.length) {
        const isExifApp1 =
          bytes[offset + 4] === 0x45 && // E
          bytes[offset + 5] === 0x78 && // x
          bytes[offset + 6] === 0x69 && // i
          bytes[offset + 7] === 0x66; // f
        if (isExifApp1) {
          const result = parseTiff(view, bytes, offset + 4 + 6);
          if (result !== null) return result;
        }
      }
      offset += 2 + segmentLength;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiff(
  view: DataView,
  bytes: Uint8Array,
  tiffStart: number
): number | null {
  if (tiffStart + 8 > bytes.length) return null;
  const byteOrderMark = view.getUint16(tiffStart);
  const littleEndian = byteOrderMark === 0x4949; // "II"
  if (!littleEndian && byteOrderMark !== 0x4d4d) return null; // không phải "II"/"MM"

  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  const ifd0 = readIfd(view, tiffStart, tiffStart + ifd0Offset, littleEndian, bytes.length);
  if (!ifd0) return null;

  // DateTimeOriginal (0x9003) nằm trong Exif SubIFD, trỏ tới bởi tag 0x8769 ở IFD0.
  const exifIfdOffset = ifd0.get(0x8769);
  if (typeof exifIfdOffset === "number") {
    const exifIfd = readIfd(
      view,
      tiffStart,
      tiffStart + exifIfdOffset,
      littleEndian,
      bytes.length
    );
    const dateStr = exifIfd?.get(0x9003);
    if (typeof dateStr === "string") {
      const parsed = parseExifDateString(dateStr);
      if (parsed !== null) return parsed;
    }
  }

  // Không có Exif SubIFD hoặc thiếu DateTimeOriginal — thử tag DateTime (0x0132) ở IFD0.
  const fallback = ifd0.get(0x0132);
  return typeof fallback === "string" ? parseExifDateString(fallback) : null;
}

function readIfd(
  view: DataView,
  tiffStart: number,
  ifdAbsOffset: number,
  littleEndian: boolean,
  maxLen: number
): Map<number, number | string> | null {
  if (ifdAbsOffset < 0 || ifdAbsOffset + 2 > maxLen) return null;
  const entryCount = view.getUint16(ifdAbsOffset, littleEndian);
  const result = new Map<number, number | string>();

  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = ifdAbsOffset + 2 + i * 12;
    if (entryOffset + 12 > maxLen) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);

    if (type === 2) {
      // ASCII — nếu độ dài (kể cả NUL cuối) <=4 byte thì nằm ngay trong ô giá trị.
      const byteLength = count;
      const strStart =
        byteLength <= 4
          ? entryOffset + 8
          : tiffStart + view.getUint32(entryOffset + 8, littleEndian);
      if (strStart >= 0 && strStart + byteLength <= maxLen) {
        const chars: string[] = [];
        for (let j = 0; j < byteLength; j += 1) {
          const code = view.getUint8(strStart + j);
          if (code === 0) break;
          chars.push(String.fromCharCode(code));
        }
        result.set(tag, chars.join(""));
      }
    } else if (type === 4 && count === 1) {
      result.set(tag, view.getUint32(entryOffset + 8, littleEndian)); // LONG
    } else if (type === 3 && count === 1) {
      result.set(tag, view.getUint16(entryOffset + 8, littleEndian)); // SHORT
    }
  }
  return result;
}

function parseExifDateString(value: string): number | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    value.trim()
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  // EXIF không ghi timezone — dùng làm mốc tương đối để so KHOẢNG CÁCH thời gian giữa các
  // ảnh (mục tiêu gom scene), không cần quy đổi UTC chính xác tuyệt đối.
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s)
  );
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}