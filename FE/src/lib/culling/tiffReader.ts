// Bộ đọc cấu trúc TIFF/IFD tối giản, dùng chung cho EXIF (exifMetadata.ts) và việc tìm ảnh
// preview nhúng trong file RAW (embeddedPreview.ts) — hầu hết định dạng RAW (CR2, NEF, ARW,
// DNG, PEF, ORF, RW2...) bản chất là file TIFF, và khối EXIF trong JPEG cũng là 1 TIFF thu
// nhỏ. Chỉ đọc trên 1 vùng byte đã nạp sẵn (đầu file), không tự đọc thêm từ đĩa.

export interface IfdEntry {
  type: number;
  count: number;
  /** Vị trí tuyệt đối (trong buffer) của dữ liệu giá trị: ngay trong ô 4 byte của entry nếu
   * vừa, hoặc nơi offset trỏ tới. */
  valueOffset: number;
}

const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  13: 4, // IFD
};

export class TiffReader {
  readonly littleEndian: boolean;
  private readonly view: DataView;
  /** Vị trí header TIFF ("II"/"MM") trong buffer — mọi offset trong TIFF tính từ đây. */
  private readonly base: number;

  private constructor(view: DataView, base: number, littleEndian: boolean) {
    this.view = view;
    this.base = base;
    this.littleEndian = littleEndian;
  }

  /** Trả về null nếu tại `base` không phải header TIFF hợp lệ. Không kiểm tra magic 42 vì
   * ORF ("IIRO"/"IIRS") và RW2 ("IIU") dùng magic riêng nhưng cấu trúc IFD giữ nguyên. */
  static open(view: DataView, base: number): TiffReader | null {
    if (base < 0 || base + 8 > view.byteLength) return null;
    const byteOrder = view.getUint16(base);
    if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
    return new TiffReader(view, base, byteOrder === 0x4949);
  }

  get firstIfdOffset(): number {
    return this.view.getUint32(this.base + 4, this.littleEndian);
  }

  /** Đọc 1 IFD tại offset (tính từ base). Trả về null nếu nằm ngoài vùng đã nạp. */
  readIfd(offset: number): { entries: Map<number, IfdEntry>; nextIfdOffset: number } | null {
    const start = this.base + offset;
    if (offset <= 0 || start + 2 > this.view.byteLength) return null;
    const entryCount = this.view.getUint16(start, this.littleEndian);
    // IFD thật hiếm khi quá vài trăm tag — số lớn bất thường là dấu hiệu đọc nhầm offset.
    if (entryCount === 0 || entryCount > 1000) return null;

    const entries = new Map<number, IfdEntry>();
    for (let i = 0; i < entryCount; i += 1) {
      const entryStart = start + 2 + i * 12;
      if (entryStart + 12 > this.view.byteLength) break;
      const tag = this.view.getUint16(entryStart, this.littleEndian);
      const type = this.view.getUint16(entryStart + 2, this.littleEndian);
      const count = this.view.getUint32(entryStart + 4, this.littleEndian);
      const byteLength = (TYPE_SIZES[type] ?? 1) * count;
      const valueOffset =
        byteLength <= 4
          ? entryStart + 8
          : this.base + this.view.getUint32(entryStart + 8, this.littleEndian);
      entries.set(tag, { type, count, valueOffset });
    }

    const nextPos = start + 2 + entryCount * 12;
    const nextIfdOffset =
      nextPos + 4 <= this.view.byteLength
        ? this.view.getUint32(nextPos, this.littleEndian)
        : 0;
    return { entries, nextIfdOffset };
  }

  /** Mọi giá trị số của 1 entry (SHORT/LONG/RATIONAL/...). Rỗng nếu dữ liệu ngoài vùng nạp. */
  numbers(entry: IfdEntry | undefined, maxCount = 64): number[] {
    if (!entry) return [];
    const size = TYPE_SIZES[entry.type] ?? 1;
    const count = Math.min(entry.count, maxCount);
    if (entry.valueOffset < 0 || entry.valueOffset + size * count > this.view.byteLength) {
      return [];
    }
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const pos = entry.valueOffset + i * size;
      switch (entry.type) {
        case 1:
        case 7:
          values.push(this.view.getUint8(pos));
          break;
        case 3:
          values.push(this.view.getUint16(pos, this.littleEndian));
          break;
        case 8:
          values.push(this.view.getInt16(pos, this.littleEndian));
          break;
        case 4:
        case 13:
          values.push(this.view.getUint32(pos, this.littleEndian));
          break;
        case 9:
          values.push(this.view.getInt32(pos, this.littleEndian));
          break;
        case 5:
        case 10: {
          const read = (p: number) =>
            entry.type === 5
              ? this.view.getUint32(p, this.littleEndian)
              : this.view.getInt32(p, this.littleEndian);
          const denominator = read(pos + 4);
          values.push(denominator === 0 ? NaN : read(pos) / denominator);
          break;
        }
        default:
          return values;
      }
    }
    return values;
  }

  number(entry: IfdEntry | undefined): number | null {
    const [value] = this.numbers(entry, 1);
    return value === undefined || Number.isNaN(value) ? null : value;
  }

  string(entry: IfdEntry | undefined): string | null {
    if (!entry || entry.type !== 2) return null;
    if (entry.valueOffset < 0 || entry.valueOffset + entry.count > this.view.byteLength) {
      return null;
    }
    let result = "";
    for (let i = 0; i < entry.count; i += 1) {
      const code = this.view.getUint8(entry.valueOffset + i);
      if (code === 0) break;
      result += String.fromCharCode(code);
    }
    return result;
  }

  /** Offset tuyệt đối trong buffer của 1 offset tính từ base (dùng cho tag trỏ tới dữ liệu
   * nằm trong file, ví dụ JPEGInterchangeFormat). */
  absolute(offset: number): number {
    return this.base + offset;
  }
}

/** Tìm chuỗi 4 ký tự (fourcc của box ISO-BMFF, ví dụ "PRVW") trong buffer. -1 nếu không có. */
export function findFourcc(bytes: Uint8Array, fourcc: string, from = 0): number {
  const c0 = fourcc.charCodeAt(0);
  const c1 = fourcc.charCodeAt(1);
  const c2 = fourcc.charCodeAt(2);
  const c3 = fourcc.charCodeAt(3);
  for (let i = from; i + 4 <= bytes.length; i += 1) {
    if (bytes[i] === c0 && bytes[i + 1] === c1 && bytes[i + 2] === c2 && bytes[i + 3] === c3) {
      return i;
    }
  }
  return -1;
}

/** File CR3 (Canon, ISO-BMFF): box "ftyp" ở offset 4 với major brand "crx ". */
export function isCr3(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    findFourcc(bytes.subarray(4, 8), "ftyp") === 0 &&
    findFourcc(bytes.subarray(8, 12), "crx ") === 0
  );
}

/** File RAF (Fujifilm): bắt đầu bằng "FUJIFILMCCD-RAW". */
export function isRaf(bytes: Uint8Array): boolean {
  const signature = "FUJIFILMCCD-RAW";
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature.charCodeAt(i)) return false;
  }
  return true;
}
