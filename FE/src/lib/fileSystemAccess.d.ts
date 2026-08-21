// TypeScript's bundled lib.dom.d.ts khai báo FileSystemDirectoryHandle/FileSystemFileHandle
// nhưng thiếu window.showDirectoryPicker() và khả năng duyệt (entries/values/keys) vì đây
// vẫn là phần chưa chuẩn hoá đầy đủ của File System Access API (mới chạy trên Chromium).
// Bổ sung khai báo ambient ở đây để dùng được với type-check mà không cần @types/wicg-file-system-access.

interface FileSystemDirectoryHandle {
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
}

// lib.dom.d.ts của bản TypeScript đang dùng chưa khai báo requestPermission/queryPermission
// trên FileSystemHandle (phần permissions của File System Access API vẫn chưa chuẩn hoá đầy
// đủ). Bước 1.9 cần requestPermission("readwrite") trước khi ghi/xoá file trên thư mục đã
// chọn ở chế độ "read".
type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?:
    | FileSystemHandle
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos";
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}