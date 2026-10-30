import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import axios from "axios";
import { api } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { CompressionPreset } from "../lib/compressionPresets";
import type { Photo } from "../lib/types";
import type { NormalizedFaceBox } from "../lib/culling/types";
import { PREPARE_CONCURRENCY, prepareUpload } from "../lib/upload/uploadPrepClient";
import type { PreparedUpload } from "../lib/upload/uploadPrepProtocol";

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
  /** Từ trang Cull: hộp khuôn mặt AI đã dò trên chính ảnh này (DetectedFace.box) — bước
   * chuẩn bị upload dùng luôn để cắt khuôn mặt cho Face Search, không phải dò lại. */
  faceBoxes?: NormalizedFaceBox[];
  /** 0-100 — độ nét (burstScoring.ts) mà trang Cull đã chấm. */
  sharpnessScore?: number;
  eyeStatus?: "open" | "squint" | "closed";
  cullingFlag?: "green" | "yellow" | "red";
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

// queued -> preparing (nén + cắt khuôn mặt) -> queued (đã chuẩn bị, chờ lượt upload) ->
// uploading -> processing (đã gửi hết dữ liệu, chờ server đẩy lên Drive) -> done | error.
type EntryStatus = "queued" | "preparing" | "uploading" | "processing" | "done" | "error";

interface UploadEntry {
  /** Gửi lên BE làm client_upload_id — giữ nguyên qua các lần thử lại để BE nhận ra request
   * lặp (mất mạng lúc chờ phản hồi) và không tạo ảnh trùng. */
  id: string;
  item: UploadQueueItem;
  status: EntryStatus;
  progress: number;
  attempts: number;
  /** Chờ tới thời điểm này mới thử lại (giãn cách khi lỗi tạm thời). */
  retryAt?: number;
  error?: string;
  prepared?: PreparedUpload;
}

// Upload song song: đủ lấp đường truyền, chừa kết nối cho các request khác của trang (trình
// duyệt chỉ mở ~6 kết nối tới cùng 1 server).
const UPLOAD_CONCURRENCY = 3;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];
// Vẽ lại danh sách tối đa ~5 lần/giây — mỗi file báo tiến độ nhiều lần/giây, vẽ lại theo từng
// sự kiện với vài trăm file làm giật trang.
const RENDER_THROTTLE_MS = 200;

const ACTIVE_STATUSES: EntryStatus[] = ["queued", "preparing", "uploading", "processing"];

const STATUS_LABEL: Record<EntryStatus, string> = {
  queued: "Chờ",
  preparing: "Đang nén...",
  uploading: "",
  processing: "Đang lưu lên Drive...",
  done: "Hoàn tất",
  error: "Lỗi",
};

/** Lỗi tạm thời (mất mạng, server/Drive quá tải) thì tự thử lại; lỗi dữ liệu (4xx) thì không. */
function isRetryable(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (!err.response) return true;
  const status = err.response.status;
  return status >= 500 || status === 408 || status === 429;
}

function buildFormData(entry: UploadEntry, prepared: PreparedUpload): FormData {
  const { item } = entry;
  const formData = new FormData();
  formData.append("file", prepared.blob, item.file.name);
  formData.append("client_upload_id", entry.id);
  formData.append("width", String(prepared.width));
  formData.append("height", String(prepared.height));
  if (prepared.capturedAt) formData.append("captured_at", prepared.capturedAt);
  if (item.sharpnessScore !== undefined) formData.append("sharpness_score", String(item.sharpnessScore));
  if (item.eyeStatus) formData.append("eye_status", item.eyeStatus);
  if (item.cullingFlag) formData.append("culling_flag", item.cullingFlag);
  if (item.sceneId) formData.append("scene_id", item.sceneId);
  if (item.burstClusterId) formData.append("burst_cluster_id", item.burstClusterId);
  if (item.isBestInCluster) formData.append("is_best_in_cluster", "true");
  if (prepared.faceCropsProvided) {
    formData.append("face_crops_provided", "true");
    formData.append("face_crop_regions", JSON.stringify(prepared.faceCropRegions));
    prepared.faceCrops.forEach((crop, index) => formData.append("face_crops", crop, `face_${index}.jpg`));
  }
  return formData;
}

function PhotoUploadPanel(
  { albumId, preset, onUploaded, initialItems }: PhotoUploadPanelProps,
  ref: React.Ref<PhotoUploadPanelHandle>
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const consumedInitialItems = useRef(false);
  // Hàng đợi sống ngoài React state (các promise nén/upload cập nhật trực tiếp), state chỉ để
  // kích hoạt vẽ lại có giới hạn tần suất.
  const entriesRef = useRef<UploadEntry[]>([]);
  const [, setRenderTick] = useState(0);
  const renderTimerRef = useRef<number | null>(null);
  // Giá trị mới nhất của props cho các callback chạy dài (upload kéo dài qua nhiều lần render).
  const latestRef = useRef({ albumId, preset, onUploaded });
  latestRef.current = { albumId, preset, onUploaded };

  function scheduleRender() {
    if (renderTimerRef.current !== null) return;
    renderTimerRef.current = window.setTimeout(() => {
      renderTimerRef.current = null;
      setRenderTick((tick) => tick + 1);
    }, RENDER_THROTTLE_MS);
  }

  function startPrepare(entry: UploadEntry) {
    entry.status = "preparing";
    const { preset: currentPreset } = latestRef.current;
    prepareUpload(entry.item.file, {
      maxLongEdgePx: currentPreset.maxLongEdgePx,
      jpegQuality: currentPreset.jpegQuality,
      faceBoxes: entry.item.faceBoxes ?? null,
    })
      .then((prepared) => {
        entry.prepared = prepared;
        entry.status = "queued";
      })
      .catch((err: unknown) => {
        entry.status = "error";
        entry.error = getErrorMessage(err, "Không nén được ảnh");
      })
      .finally(() => {
        scheduleRender();
        pump();
      });
  }

  function startUpload(entry: UploadEntry, prepared: PreparedUpload) {
    entry.status = "uploading";
    entry.progress = 0;
    entry.retryAt = undefined;
    api
      .post<{ photo: Photo }>(
        `/api/albums/${latestRef.current.albumId}/photos`,
        buildFormData(entry, prepared),
        {
          onUploadProgress: (event) => {
            if (!event.total) return;
            entry.progress = Math.round((event.loaded / event.total) * 100);
            if (event.loaded >= event.total) entry.status = "processing";
            scheduleRender();
          },
        }
      )
      .then(({ data }) => {
        entry.status = "done";
        entry.prepared = undefined;
        latestRef.current.onUploaded(data.photo);
      })
      .catch((err: unknown) => {
        entry.attempts += 1;
        if (isRetryable(err) && entry.attempts <= RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[entry.attempts - 1];
          entry.status = "queued";
          entry.retryAt = Date.now() + delay;
          window.setTimeout(pump, delay);
          return;
        }
        entry.status = "error";
        entry.prepared = undefined;
        entry.error = getErrorMessage(err, "Upload thất bại");
      })
      .finally(() => {
        scheduleRender();
        pump();
      });
  }

  /** Khởi động thêm việc nén/upload cho tới khi đủ giới hạn song song. */
  function pump() {
    const entries = entriesRef.current;
    const now = Date.now();
    let uploading = entries.filter((e) => e.status === "uploading" || e.status === "processing").length;
    for (const entry of entries) {
      if (uploading >= UPLOAD_CONCURRENCY) break;
      if (entry.status === "queued" && entry.prepared && (entry.retryAt ?? 0) <= now) {
        startUpload(entry, entry.prepared);
        uploading += 1;
      }
    }

    // Không nén vượt quá số ảnh sắp được upload — ảnh đã nén nằm chờ trong RAM.
    let preparing = entries.filter((e) => e.status === "preparing").length;
    const preparedWaiting = entries.filter((e) => e.status === "queued" && e.prepared).length;
    for (const entry of entries) {
      if (preparing >= PREPARE_CONCURRENCY) break;
      if (preparing + preparedWaiting >= PREPARE_CONCURRENCY + UPLOAD_CONCURRENCY) break;
      if (entry.status === "queued" && !entry.prepared) {
        startPrepare(entry);
        preparing += 1;
      }
    }
    scheduleRender();
  }

  function enqueue(items: UploadQueueItem[]) {
    if (items.length === 0) return;
    entriesRef.current = [
      ...entriesRef.current,
      ...items.map((item) => ({
        id: crypto.randomUUID(),
        item,
        status: "queued" as const,
        progress: 0,
        attempts: 0,
      })),
    ];
    pump();
  }

  function retryEntry(entry: UploadEntry) {
    entry.status = "queued";
    entry.attempts = 0;
    entry.error = undefined;
    entry.retryAt = undefined;
  }

  function retryFailed() {
    entriesRef.current.filter((e) => e.status === "error").forEach(retryEntry);
    pump();
  }

  function clearFinished() {
    entriesRef.current = entriesRef.current.filter((e) => ACTIVE_STATUSES.includes(e.status));
    scheduleRender();
  }

  useEffect(() => {
    if (consumedInitialItems.current) return;
    if (!initialItems || initialItems.length === 0) return;
    consumedInitialItems.current = true;
    enqueue(initialItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItems]);

  // Đóng/tải lại tab giữa chừng thì các ảnh chưa upload bị bỏ dở — hỏi lại trước.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!entriesRef.current.some((e) => ACTIVE_STATUSES.includes(e.status))) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(
    () => () => {
      if (renderTimerRef.current !== null) window.clearTimeout(renderTimerRef.current);
    },
    []
  );

  function enqueueFiles(fileList: FileList | File[]) {
    enqueue(
      Array.from(fileList)
        .filter((file) => file.type === "image/jpeg")
        .map((file) => ({ file }))
    );
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

  const entries = entriesRef.current;
  const total = entries.length;
  const doneCount = entries.filter((e) => e.status === "done").length;
  const failed = entries.filter((e) => e.status === "error");
  const inFlight = entries.filter((e) => e.status === "preparing" || e.status === "uploading" || e.status === "processing");
  const waitingCount = entries.filter((e) => e.status === "queued").length;
  const isActive = inFlight.length > 0 || waitingCount > 0;
  // Ảnh đang upload tính theo % đã gửi; đang nén/chờ server tính 0.
  const overallPercent = total === 0
    ? 0
    : Math.round(
        ((doneCount + entries.filter((e) => e.status === "uploading").reduce((sum, e) => sum + e.progress / 100, 0)) /
          total) *
          100
      );

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

      {total > 0 && (
        <div className="mt-4 rounded-[4px] border border-[#43474f] bg-[#1c1b1b] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-[#e5e2e1]">
              {isActive ? "Đang tải ảnh lên Drive" : "Đã tải xong"} · {doneCount}/{total} ảnh
              {failed.length > 0 && <span className="text-red-400"> · {failed.length} lỗi</span>}
            </span>
            <div className="flex items-center gap-2">
              {failed.length > 0 && (
                <button
                  type="button"
                  onClick={retryFailed}
                  className="rounded-[4px] border border-[#43474f] px-2 py-1 text-xs text-[#e5e2e1] hover:bg-[#2a2a2a]"
                >
                  Thử lại {failed.length} ảnh lỗi
                </button>
              )}
              {!isActive && (
                <button
                  type="button"
                  onClick={clearFinished}
                  className="rounded-[4px] border border-[#43474f] px-2 py-1 text-xs text-[#c1c6d4] hover:bg-[#2a2a2a]"
                >
                  Ẩn
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#2a2a2a]">
            <div
              className="h-full rounded-full bg-[#a9c7ff] transition-all"
              style={{ width: `${overallPercent}%` }}
            />
          </div>

          {(inFlight.length > 0 || failed.length > 0) && (
            <ul className="mt-3 space-y-2">
              {[...inFlight, ...failed].map((entry) => (
                <li key={entry.id} className="rounded-[4px] border border-[#43474f] bg-[#161515] p-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-[#e5e2e1]">{entry.item.file.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[#c1c6d4]">
                      {entry.status === "uploading" ? `${entry.progress}%` : STATUS_LABEL[entry.status]}
                      {entry.status === "error" && (
                        <button
                          type="button"
                          onClick={() => {
                            retryEntry(entry);
                            pump();
                          }}
                          className="rounded-[4px] border border-[#43474f] px-1.5 py-0.5 text-[11px] text-[#e5e2e1] hover:bg-[#2a2a2a]"
                        >
                          Thử lại
                        </button>
                      )}
                    </span>
                  </div>
                  {entry.status === "uploading" && (
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#2a2a2a]">
                      <div className="h-full rounded-full bg-[#a9c7ff]" style={{ width: `${entry.progress}%` }} />
                    </div>
                  )}
                  {entry.error && <p className="mt-1 text-[11px] text-red-400">{entry.error}</p>}
                </li>
              ))}
            </ul>
          )}
          {waitingCount > 0 && (
            <p className="mt-2 text-[11px] text-[#8b919e]">{waitingCount} ảnh đang chờ tới lượt</p>
          )}
        </div>
      )}
    </div>
  );
}

export default forwardRef(PhotoUploadPanel);
