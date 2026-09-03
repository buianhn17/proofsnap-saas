import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { api } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { CompressionPreset } from "../lib/compressionPresets";
import type { Photo } from "../lib/types";

interface UploadItem {
  id: string;
  fileName: string;
  status: "compressing" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

// Bước 2.3 (nền) — mở rộng từ File[] thuần sang mang theo scene_id/burst_cluster_id/
// is_best_in_cluster (map từ id tạm client-side sang UUID thật đã tạo qua POST
// /albums/:albumId/scenes và /burst-clusters trước khi tới đây — xem
// AlbumCullPage.tsx#handleContinueToUpload). Chọn file thủ công qua input vẫn hoạt động,
// chỉ là không có scene/burst nào đi kèm.
export interface UploadQueueItem {
  file: File;
  sceneId?: string;
  burstClusterId?: string;
  isBestInCluster?: boolean;
}

export interface PhotoUploadPanelHandle {
  /** Mở hộp thoại chọn file hệ thống (dùng cho nút "Tải ảnh lên" ở header). */
  openFileDialog: () => void;
  /** Thêm file vào hàng đợi upload (dùng cho kéo-thả trực tiếp vào lưới ảnh). */
  enqueueFiles: (files: FileList | File[]) => void;
}

interface PhotoUploadPanelProps {
  albumId: string;
  preset: CompressionPreset;
  onUploaded: (photo: Photo) => void;
  /** Bước 1.6 — danh sách ảnh "giữ" từ trang duyệt culling, tự động đưa vào hàng đợi
   * upload ngay khi panel này mount (ví dụ sau khi điều hướng từ AlbumCullPage về). */
  initialItems?: UploadQueueItem[];
}

async function compressForPreset(file: File, preset: CompressionPreset) {
  return imageCompression(file, {
    maxWidthOrHeight: preset.maxLongEdgePx,
    initialQuality: preset.jpegQuality / 100,
    useWebWorker: true,
    fileType: "image/jpeg",
  });
}

function PhotoUploadPanel(
  { albumId, preset, onUploaded, initialItems }: PhotoUploadPanelProps,
  ref: React.Ref<PhotoUploadPanelHandle>
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const consumedInitialItems = useRef(false);

  useEffect(() => {
    if (consumedInitialItems.current) return;
    if (!initialItems || initialItems.length === 0) return;
    consumedInitialItems.current = true;
    initialItems.forEach((item) => uploadOne(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItems]);

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  async function uploadOne({ file, sceneId, burstClusterId, isBestInCluster }: UploadQueueItem) {
    const id = crypto.randomUUID();
    setItems((prev) => [
      ...prev,
      { id, fileName: file.name, status: "compressing", progress: 0 },
    ]);

    try {
      const compressed = await compressForPreset(file, preset);
      updateItem(id, { status: "uploading", progress: 0 });

      const formData = new FormData();
      formData.append("file", compressed, file.name);
      if (sceneId) formData.append("scene_id", sceneId);
      if (burstClusterId) formData.append("burst_cluster_id", burstClusterId);
      if (isBestInCluster) formData.append("is_best_in_cluster", "true");

      const { data } = await api.post<{ photo: Photo }>(
        `/api/albums/${albumId}/photos`,
        formData,
        {
          onUploadProgress: (event) => {
            if (event.total) {
              updateItem(id, {
                progress: Math.round((event.loaded / event.total) * 100),
              });
            }
          },
        }
      );

      updateItem(id, { status: "done", progress: 100 });
      onUploaded(data.photo);
    } catch (err) {
      updateItem(id, {
        status: "error",
        error: getErrorMessage(err, "Upload thất bại"),
      });
    }
  }

  function enqueueFiles(fileList: FileList | File[]) {
    Array.from(fileList)
      .filter((file) => file.type === "image/jpeg")
      .forEach((file) => uploadOne({ file }));
  }

  useImperativeHandle(ref, () => ({
    openFileDialog: () => inputRef.current?.click(),
    enqueueFiles,
  }));

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList) return;
    enqueueFiles(fileList);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg"
        onChange={(e) => handleFilesSelected(e.target.files)}
        className="sr-only"
      />

      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-[4px] border border-[#43474f] bg-[#1c1b1b] p-3"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-[#e5e2e1]">
                  {item.fileName}
                </span>
                <span className="shrink-0 text-xs text-[#c1c6d4]">
                  {item.status === "compressing" && "Đang nén..."}
                  {item.status === "uploading" && `${item.progress}%`}
                  {item.status === "done" && "Hoàn tất"}
                  {item.status === "error" && "Lỗi"}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#2a2a2a]">
                <div
                  className={`h-full rounded-full transition-all ${
                    item.status === "error" ? "bg-red-500" : "bg-[#a9c7ff]"
                  }`}
                  style={{
                    width: `${
                      item.status === "compressing"
                        ? 10
                        : item.status === "done"
                          ? 100
                          : item.progress
                    }%`,
                  }}
                />
              </div>
              {item.error && (
                <p className="mt-1 text-xs text-red-400">{item.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default forwardRef(PhotoUploadPanel);
