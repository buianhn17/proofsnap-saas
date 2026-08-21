// Bước 1.2 — ghép cặp RAW/JPG theo tên gốc (cùng đường dẫn thư mục + cùng tên file,
// khác đuôi mở rộng). File không tìm được cặp (chỉ RAW hoặc chỉ JPG) được liệt kê
// riêng để PTG biết mà xử lý (ví dụ export thiếu, hoặc ảnh chỉ chụp JPG).

import type { LocalPhotoFile } from "./localFolderImport";

export interface PhotoPair {
  /** Tên file gốc không kèm đuôi mở rộng (ví dụ "IMG_0001"). */
  baseName: string;
  /** Đường dẫn thư mục chứa cặp ảnh này, tính từ thư mục gốc đã chọn ("" nếu ở gốc). */
  dirPath: string;
  raw: LocalPhotoFile;
  jpg: LocalPhotoFile;
}

export interface PairLocalPhotosResult {
  pairs: PhotoPair[];
  /** File RAW không có JPG cùng tên đi kèm. */
  unmatchedRaw: LocalPhotoFile[];
  /** File JPG không có RAW cùng tên đi kèm. */
  unmatchedJpg: LocalPhotoFile[];
}

function splitPath(relativePath: string, extension: string) {
  const withoutExt = relativePath.slice(
    0,
    relativePath.length - extension.length - 1
  );
  const slashIndex = withoutExt.lastIndexOf("/");
  return {
    dirPath: slashIndex === -1 ? "" : withoutExt.slice(0, slashIndex),
    baseName:
      slashIndex === -1 ? withoutExt : withoutExt.slice(slashIndex + 1),
  };
}

/**
 * Ghép các LocalPhotoFile cùng tên gốc (khác đuôi) thành PhotoPair.
 * Khoá ghép là "đường dẫn thư mục + tên file" — chỉ ghép các file nằm cùng thư mục,
 * để tránh ghép nhầm hai file trùng tên ở hai thư mục con khác nhau.
 */
export function pairLocalPhotoFiles(
  files: LocalPhotoFile[]
): PairLocalPhotosResult {
  const rawByKey = new Map<string, LocalPhotoFile>();
  const jpgByKey = new Map<string, LocalPhotoFile>();
  const unmatchedRaw: LocalPhotoFile[] = [];
  const unmatchedJpg: LocalPhotoFile[] = [];

  for (const file of files) {
    const { dirPath, baseName } = splitPath(file.relativePath, file.extension);
    const key = `${dirPath}/${baseName}`;
    const byKey = file.kind === "raw" ? rawByKey : jpgByKey;

    const existing = byKey.get(key);
    if (existing) {
      // Trùng key cùng loại (ví dụ 2 file RAW khác đuôi cùng tên) — không ghi đè,
      // coi cả hai là file lẻ để không âm thầm mất dữ liệu.
      (file.kind === "raw" ? unmatchedRaw : unmatchedJpg).push(existing, file);
      byKey.delete(key);
      continue;
    }
    byKey.set(key, file);
  }

  const pairs: PhotoPair[] = [];
  for (const [key, raw] of rawByKey) {
    const jpg = jpgByKey.get(key);
    if (jpg) {
      jpgByKey.delete(key);
      const { dirPath, baseName } = splitPath(raw.relativePath, raw.extension);
      pairs.push({ baseName, dirPath, raw, jpg });
    } else {
      unmatchedRaw.push(raw);
    }
  }
  for (const jpg of jpgByKey.values()) {
    unmatchedJpg.push(jpg);
  }

  pairs.sort((a, b) => a.baseName.localeCompare(b.baseName));
  unmatchedRaw.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  unmatchedJpg.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return { pairs, unmatchedRaw, unmatchedJpg };
}