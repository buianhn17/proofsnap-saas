import { useEffect, useRef, useState } from "react";
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

interface PhotoUploadPanelProps {
  albumId: string;
  preset: CompressionPreset;
  onUploaded: (photo: Photo, thumbnailUrl: string) => void;
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

export default function PhotoUploadPanel({
  albumId,
  preset,
  onUploaded,
  initialItems,
}: PhotoUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const consumedInitialItems = useRef(false);

  useEffect(() => {
    if (consumedInitialItems.current) return;
    if (!initialItems || initialItems.length === 0) return;
    consumedInitialItems.current = true;
    initialItems.forEach((item) => uploadOne(item));
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
      const thumbnailUrl = URL.createObjectURL(compressed);
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
      onUploaded(data.photo, thumbnailUrl);
    } catch (err) {
      updateItem(id, {
        status: "error",
        error: getErrorMessage(err, "Upload thất bại"),
      });
    }
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList) return;
    Array.from(fileList).forEach((file) => uploadOne({ file }));
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
        className="block text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
      />

      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-md border border-slate-200 bg-white p-3"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-slate-700">
                  {item.fileName}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {item.status === "compressing" && "Đang nén..."}
                  {item.status === "uploading" && `${item.progress}%`}
                  {item.status === "done" && "Hoàn tất"}
                  {item.status === "error" && "Lỗi"}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    item.status === "error" ? "bg-red-500" : "bg-slate-900"
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
                <p className="mt-1 text-xs text-red-600">{item.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
