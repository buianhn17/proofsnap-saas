// Kiểu dữ liệu thuần cho 1 file ảnh cục bộ — tách riêng khỏi localFolderImport.ts (vốn
// dùng window.showDirectoryPicker, chỉ chạy được trên main thread) để culling.worker.ts
// (Bước 1.5, biên dịch dưới lib WebWorker, không có `window`) import được type này mà
// không kéo theo code phụ thuộc DOM.

export type LocalPhotoKind = "raw" | "jpg";

export interface LocalPhotoFile {
  file: File;
  /** Đường dẫn tương đối tính từ thư mục gốc đã chọn, dùng "/" làm dấu phân cách. */
  relativePath: string;
  extension: string;
  kind: LocalPhotoKind;
  /** Handle gốc của chính file này — dùng để ghi/copy (Bước 1.9). FileSystemHandle hỗ trợ
   * structured clone nên truyền qua postMessage vào culling.worker.ts vẫn an toàn. */
  handle: FileSystemFileHandle;
  /** Handle thư mục cha trực tiếp chứa file này — cần để xoá qua removeEntry() (Bước 1.9),
   * vì FileSystemFileHandle không tự xoá được chính nó trong lib.dom hiện tại. */
  parentDirHandle: FileSystemDirectoryHandle;
}