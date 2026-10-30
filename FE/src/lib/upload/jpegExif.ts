// Giữ EXIF (ngày giờ chụp, thông số máy, tác giả...) khi nén lại ảnh bằng canvas — canvas
// encode JPEG mới tinh, không mang theo metadata nào của file gốc. Chép nguyên đoạn APP1 Exif
// của file gốc sang file mới, sửa 2 chỗ cho khớp với ảnh đã vẽ lại:
//   - Orientation -> 1: createImageBitmap đã xoay pixel theo EXIF rồi, giữ tag cũ thì trình
//     xem ảnh sẽ xoay thêm lần nữa.
//   - Bỏ liên kết tới IFD1 (ảnh thumbnail nhúng theo chiều CŨ) để không hiện thumbnail lệch.
// Không chép ICC profile: canvas đã quy màu về sRGB khi vẽ.

const TAG_ORIENTATION = 0x0112;
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/** Đoạn APP1 Exif hoàn chỉnh (marker + độ dài + dữ liệu) trong vùng byte đầu file JPEG; null
 * nếu không có hoặc vùng byte không chứa trọn đoạn đó. */
export function findExifSegment(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // SOS/EOI: đã qua hết vùng metadata.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker === 0xe1 && length >= 2 + EXIF_HEADER.length + 8 &&
        EXIF_HEADER.every((byte, i) => bytes[offset + 4 + i] === byte)) {
      return bytes.slice(offset, offset + 2 + length);
    }
    offset += 2 + length;
  }
  return null;
}

/** Bản sao đoạn Exif đã sửa cho ảnh vẽ lại (xem đầu file); null nếu cấu trúc TIFF không đọc
 * được — khi đó bỏ EXIF luôn còn hơn giữ 1 tag Orientation sai làm ảnh bị xoay lệch. */
export function exifForRedrawnImage(segment: Uint8Array): Uint8Array | null {
  const out = segment.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const tiff = 4 + EXIF_HEADER.length;
  const byteOrder = view.getUint16(tiff);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const little = byteOrder === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 42) return null;

  const ifd0 = tiff + view.getUint32(tiff + 4, little);
  if (ifd0 + 2 > out.length) return null;
  const entryCount = view.getUint16(ifd0, little);
  const entriesEnd = ifd0 + 2 + entryCount * 12;
  if (entriesEnd + 4 > out.length) return null;

  for (let entry = ifd0 + 2; entry < entriesEnd; entry += 12) {
    // Orientation là SHORT, 1 giá trị — nằm ngay trong 2 byte đầu ô giá trị.
    if (view.getUint16(entry, little) === TAG_ORIENTATION) {
      view.setUint16(entry + 8, 1, little);
    }
  }
  view.setUint32(entriesEnd, 0, little);
  return out;
}

/** Chèn đoạn Exif vào ngay sau SOI của file JPEG (do canvas tạo, chưa có Exif). */
export async function insertExifSegment(jpeg: Blob, segment: Uint8Array): Promise<Blob> {
  const soi = new Uint8Array(await jpeg.slice(0, 2).arrayBuffer());
  if (soi[0] !== 0xff || soi[1] !== 0xd8) return jpeg;
  return new Blob([soi, segment.slice(), jpeg.slice(2)], { type: "image/jpeg" });
}
