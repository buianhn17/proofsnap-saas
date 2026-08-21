// Bước 1.1 — đọc thư mục ảnh gốc trên máy PTG bằng File System Access API.
// Chỉ hỗ trợ trình duyệt Chromium (Chrome/Edge/Opera...) vì Safari và Firefox
// chưa triển khai window.showDirectoryPicker(). Xem FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE.

import { pairLocalPhotoFiles, type PairLocalPhotosResult } from "./photoPairing";
import type { LocalPhotoFile, LocalPhotoKind } from "./localPhotoFile";

export type { LocalPhotoFile, LocalPhotoKind };

export interface LocalFolderScanResult {
  folderName: string;
  /** Ảnh RAW + JPG tìm thấy, đã lọc theo phần mở rộng. */
  files: LocalPhotoFile[];
  /** Số file bị bỏ qua vì không phải RAW/JPG (ví dụ .xmp, .mov, .db...). */
  skippedCount: number;
  /** Kết quả ghép cặp RAW/JPG theo tên gốc — xem Bước 1.2 trong photoPairing.ts. */
  pairing: PairLocalPhotosResult;
  /** Handle thư mục gốc đã chọn — cần lại ở Bước 1.9 để xin quyền readwrite trước khi xoá. */
  rootHandle: FileSystemDirectoryHandle;
}

// Phần mở rộng RAW phổ biến theo hãng máy ảnh.
const RAW_EXTENSIONS = new Set([
  "cr2", // Canon
  "cr3", // Canon
  "crw", // Canon (cũ)
  "nef", // Nikon
  "nrw", // Nikon
  "arw", // Sony
  "srf", // Sony
  "sr2", // Sony
  "raf", // Fujifilm
  "rw2", // Panasonic
  "orf", // Olympus
  "pef", // Pentax
  "dng", // Adobe / nhiều hãng
  "3fr", // Hasselblad
  "iiq", // Phase One
  "mos", // Leaf
  "kdc", // Kodak
  "dcr", // Kodak
  "mrw", // Minolta
  "x3f", // Sigma
  "raw", // Panasonic/Leica (generic)
  "srw", // Samsung
]);

const JPG_EXTENSIONS = new Set(["jpg", "jpeg"]);

export const ACCEPTED_EXTENSIONS = new Set([
  ...RAW_EXTENSIONS,
  ...JPG_EXTENSIONS,
]);

export const FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE =
  "Trình duyệt này không hỗ trợ chọn thư mục trực tiếp (File System Access API). " +
  "Tính năng này hiện chỉ chạy trên Chrome, Edge hoặc các trình duyệt Chromium khác — " +
  "Safari và Firefox chưa hỗ trợ window.showDirectoryPicker(). " +
  "Vui lòng dùng Chrome/Edge, hoặc chọn ảnh bằng nút tải file thông thường bên dưới.";

export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function"
  );
}

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function classifyExtension(extension: string): LocalPhotoKind | null {
  if (RAW_EXTENSIONS.has(extension)) return "raw";
  if (JPG_EXTENSIONS.has(extension)) return "jpg";
  return null;
}

async function walkDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  parentPath: string,
  files: LocalPhotoFile[],
  skipped: { count: number }
): Promise<void> {
  for await (const [name, handle] of directoryHandle.entries()) {
    // Bỏ qua thư mục/file ẩn hệ thống (macOS .DS_Store, thư mục @eaDir của NAS...).
    if (name.startsWith(".") || name.startsWith("@")) {
      if (handle.kind === "file") skipped.count += 1;
      continue;
    }

    const path = parentPath ? `${parentPath}/${name}` : name;

    if (handle.kind === "directory") {
      await walkDirectory(handle as FileSystemDirectoryHandle, path, files, skipped);
      continue;
    }

    const extension = getExtension(name);
    const kind = classifyExtension(extension);
    if (!kind) {
      skipped.count += 1;
      continue;
    }

    const fileHandle = handle as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    files.push({
      file,
      relativePath: path,
      extension,
      kind,
      handle: fileHandle,
      parentDirHandle: directoryHandle,
    });
  }
}

/**
 * Mở hộp thoại chọn thư mục, duyệt toàn bộ cây thư mục con và trả về danh sách
 * file RAW/JPG tìm thấy. Trả về null nếu người dùng bấm huỷ hộp thoại.
 */
export async function pickLocalPhotoFolder(): Promise<LocalFolderScanResult | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE);
  }

  let directoryHandle: FileSystemDirectoryHandle;
  try {
    directoryHandle = await window.showDirectoryPicker!({ mode: "read" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return null;
    }
    throw err;
  }

  const files: LocalPhotoFile[] = [];
  const skipped = { count: 0 };
  await walkDirectory(directoryHandle, "", files, skipped);

  return {
    folderName: directoryHandle.name,
    files,
    skippedCount: skipped.count,
    pairing: pairLocalPhotoFiles(files),
    rootHandle: directoryHandle,
  };
}