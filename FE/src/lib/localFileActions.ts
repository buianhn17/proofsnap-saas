// Bước 1.9 — Hành động cuối trên file cục bộ.
// Sau khi PTG xác nhận danh sách giữ/loại trên trang duyệt (AlbumCullPage), cho chọn:
//   (a) copyKeptPairsToNewFolder — sao chép các cặp RAW+JPG "giữ" sang một thư mục mới
//       (không đụng tới thư mục gốc);
//   (b) deleteRejectedPairsFromOriginal — xoá thẳng các cặp RAW+JPG "loại" khỏi thư mục
//       gốc (không thể hoàn tác — UI phải cảnh báo và xác nhận trước khi gọi hàm này).
// Cả hai đều dùng File System Access API (ghi qua createWritable, xoá qua removeEntry).

import type { LocalPhotoFile } from "./localPhotoFile";

/** Một cặp ảnh đã có quyết định giữ/loại — raw có thể null nếu ảnh chỉ có JPG (không có RAW đi kèm). */
export interface LocalPhotoActionPair {
  jpg: LocalPhotoFile;
  raw: LocalPhotoFile | null;
}

export interface CopyProgress {
  copiedFiles: number;
  totalFiles: number;
}

export interface CopyResult {
  folderName: string;
  copiedFiles: number;
}

export interface DeleteProgress {
  deletedFiles: number;
  totalFiles: number;
}

export interface DeleteResult {
  deletedFiles: number;
}

function countFiles(pairs: LocalPhotoActionPair[]): number {
  return pairs.reduce((sum, pair) => sum + 1 + (pair.raw ? 1 : 0), 0);
}

/**
 * Xin quyền readwrite trên một handle đã có (thư mục được chọn ban đầu ở chế độ "read",
 * hoặc handle con lấy ra từ nó). queryPermission trước để khỏi hiện prompt nếu đã có quyền
 * sẵn (ví dụ trình duyệt nhớ lựa chọn trước đó trong cùng phiên).
 */
async function ensureReadWritePermission(
  handle: FileSystemHandle
): Promise<boolean> {
  const options: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  const current = await handle.queryPermission(options);
  if (current === "granted") return true;
  const requested = await handle.requestPermission(options);
  return requested === "granted";
}

async function getOrCreateDir(
  root: FileSystemDirectoryHandle,
  dirPath: string
): Promise<FileSystemDirectoryHandle> {
  if (!dirPath) return root;
  let current = root;
  for (const segment of dirPath.split("/")) {
    if (!segment) continue;
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
}

function leafName(relativePath: string): string {
  const slashIndex = relativePath.lastIndexOf("/");
  return slashIndex === -1 ? relativePath : relativePath.slice(slashIndex + 1);
}

function dirName(relativePath: string): string {
  const slashIndex = relativePath.lastIndexOf("/");
  return slashIndex === -1 ? "" : relativePath.slice(0, slashIndex);
}

async function writeFileInto(
  targetRoot: FileSystemDirectoryHandle,
  source: LocalPhotoFile
): Promise<void> {
  const dir = await getOrCreateDir(targetRoot, dirName(source.relativePath));
  const fileHandle = await dir.getFileHandle(leafName(source.relativePath), {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(source.file);
  } finally {
    await writable.close();
  }
}

/**
 * Mở hộp thoại chọn thư mục đích (chế độ readwrite) rồi sao chép toàn bộ file trong các cặp
 * "giữ" sang đó, giữ nguyên cấu trúc thư mục con tương đối. Trả về null nếu PTG bấm huỷ hộp
 * thoại chọn thư mục đích.
 */
export async function copyKeptPairsToNewFolder(
  pairs: LocalPhotoActionPair[],
  onProgress?: (progress: CopyProgress) => void
): Promise<CopyResult | null> {
  let targetRoot: FileSystemDirectoryHandle;
  try {
    targetRoot = await window.showDirectoryPicker!({ mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }

  const totalFiles = countFiles(pairs);
  let copiedFiles = 0;
  onProgress?.({ copiedFiles, totalFiles });

  for (const pair of pairs) {
    await writeFileInto(targetRoot, pair.jpg);
    copiedFiles += 1;
    onProgress?.({ copiedFiles, totalFiles });

    if (pair.raw) {
      await writeFileInto(targetRoot, pair.raw);
      copiedFiles += 1;
      onProgress?.({ copiedFiles, totalFiles });
    }
  }

  return { folderName: targetRoot.name, copiedFiles };
}

/**
 * Xoá thẳng các file trong các cặp "loại" khỏi thư mục gốc trên máy. KHÔNG THỂ HOÀN TÁC —
 * gọi hàm này chỉ sau khi UI đã cảnh báo và PTG xác nhận rõ ràng.
 * rootHandle là handle thư mục gốc đã chọn (LocalFolderScanResult.rootHandle) — dùng để xin
 * nâng quyền lên readwrite (ban đầu chỉ mở ở chế độ "read" để quét thư mục).
 */
export async function deleteRejectedPairsFromOriginal(
  rootHandle: FileSystemDirectoryHandle,
  pairs: LocalPhotoActionPair[],
  onProgress?: (progress: DeleteProgress) => void
): Promise<DeleteResult> {
  const granted = await ensureReadWritePermission(rootHandle);
  if (!granted) {
    throw new Error(
      "Trình duyệt không cấp quyền ghi/xoá trên thư mục đã chọn — không thể xoá file gốc."
    );
  }

  const totalFiles = countFiles(pairs);
  let deletedFiles = 0;
  onProgress?.({ deletedFiles, totalFiles });

  for (const pair of pairs) {
    await pair.jpg.parentDirHandle.removeEntry(leafName(pair.jpg.relativePath));
    deletedFiles += 1;
    onProgress?.({ deletedFiles, totalFiles });

    if (pair.raw) {
      await pair.raw.parentDirHandle.removeEntry(
        leafName(pair.raw.relativePath)
      );
      deletedFiles += 1;
      onProgress?.({ deletedFiles, totalFiles });
    }
  }

  return { deletedFiles };
}
