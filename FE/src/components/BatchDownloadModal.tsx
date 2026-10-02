// Tải ảnh hoàn thiện về Thư viện ảnh trên điện thoại theo từng nhóm 10 ảnh.
//
// Vì sao chia nhóm + nạp sẵn:
// - Share sheet iOS/Android xử lý ổn định ~10 ảnh/lượt; nhiều hơn dễ treo hoặc hết bộ nhớ
//   (10 ảnh gốc đã ~100-200MB nằm trong RAM của tab).
// - iOS Safari chỉ cho mở share sheet ngay sau 1 lần chạm. Nên nhóm được NẠP SẴN ngay khi
//   tới lượt (tự động), nút "Tải N ảnh nhóm K" chỉ bật khi đã nạp xong và gọi share ngay
//   trong lần chạm đó — không chen fetch nào ở giữa.
// Trình duyệt không chia sẻ được file (PC, trình duyệt cũ) -> tải file ZIP từ server.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ImageFetchError,
  fetchImageAsFile,
  isMobileDevice,
  keepScreenAwake,
  shareBatchFiles,
  supportsImageFileSharing,
} from "../lib/mobileDownloadService";

export type DownloadQuality = "original" | "optimized";

export interface DownloadablePhoto {
  id: string;
  url: string;
  filename: string;
}

// Bên gọi nên đặt `key` theo chất lượng (hoặc danh sách ảnh) để đổi chất lượng là remount —
// modal bắt đầu lại từ nhóm 1 với state sạch.
interface BatchDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPhotos: DownloadablePhoto[];
  quality: DownloadQuality;
  /** Cho phép khách đổi chất lượng trước khi bắt đầu lưu nhóm đầu tiên. */
  onQualityChange?: (quality: DownloadQuality) => void;
  /** Link tải ZIP từ server — dùng khi thiết bị không hỗ trợ lưu ảnh qua share sheet. */
  zipFallbackUrl: string;
}

export const BATCH_SIZE = 10;
// Số ảnh tải song song trong 1 nhóm: đủ lấp băng thông 4G mà không làm nghẽn kết nối yếu.
const FETCH_CONCURRENCY = 3;

const QUALITY_LABEL: Record<DownloadQuality, string> = {
  original: "Ảnh gốc",
  optimized: "Bản tối ưu (nhẹ hơn)",
};

type BatchStatus = "preparing" | "ready" | "sharing" | "partial_error" | "done";

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export default function BatchDownloadModal({
  isOpen,
  onClose,
  selectedPhotos,
  quality,
  onQualityChange,
  zipFallbackUrl,
}: BatchDownloadModalProps) {
  const batches = useMemo(() => chunk(selectedPhotos, BATCH_SIZE), [selectedPhotos]);
  // Tính 1 lần lúc mở modal — không đổi trong suốt phiên tải.
  const shareSupported = useMemo(
    () => isOpen && isMobileDevice() && supportsImageFileSharing(),
    [isOpen]
  );

  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [status, setStatus] = useState<BatchStatus>("preparing");
  const [progress, setProgress] = useState(0);
  const [completedBatches, setCompletedBatches] = useState<number[]>([]);
  const [failures, setFailures] = useState<ImageFetchError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // File đã nạp của nhóm hiện tại theo đúng vị trí trong nhóm (null = chưa nạp/lỗi). Để
  // trong ref, không phải state: hàng chục-trăm MB dữ liệu không cần (và không nên) đi qua
  // cơ chế so sánh/render của React. Gán null ngay sau khi lưu xong để GC thu hồi bộ nhớ.
  const filesRef = useRef<(File | null)[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentBatch = batches[currentBatchIndex] ?? [];
  const totalBatches = batches.length;

  const releaseBatch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    filesRef.current = null;
  }, []);

  /** Nạp các ảnh của 1 nhóm. `onlyMissing`: giữ ảnh đã nạp được, chỉ tải lại ảnh lỗi. */
  const prepareBatch = useCallback(
    async (batchIndex: number, onlyMissing = false) => {
      const batch = batches[batchIndex];
      if (!batch) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const files: (File | null)[] =
        onlyMissing && filesRef.current ? filesRef.current : new Array(batch.length).fill(null);
      filesRef.current = files;
      const errors: ImageFetchError[] = [];
      setStatus("preparing");
      setFailures([]);
      setProgress(files.filter(Boolean).length);

      const releaseWakeLock = await keepScreenAwake();
      try {
        const pending = batch.map((_, i) => i).filter((i) => files[i] === null);
        let cursor = 0;
        const worker = async () => {
          while (cursor < pending.length) {
            const position = pending[cursor];
            cursor += 1;
            const photo = batch[position];
            try {
              files[position] = await fetchImageAsFile(photo.url, photo.filename, {
                signal: controller.signal,
              });
              if (!controller.signal.aborted) setProgress((p) => p + 1);
            } catch (error) {
              if (controller.signal.aborted) return;
              errors.push(
                error instanceof ImageFetchError
                  ? error
                  : new ImageFetchError(photo.filename, `Không tải được ${photo.filename}`, null)
              );
            }
          }
        };
        await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
      } finally {
        releaseWakeLock();
      }

      // Modal đã đóng/chuyển nhóm trong lúc tải — kết quả lượt này không còn giá trị.
      if (controller.signal.aborted) return;
      setFailures(errors);
      setStatus(errors.length > 0 ? "partial_error" : "ready");
    },
    [batches]
  );

  // Mở modal -> nạp sẵn nhóm 1. Không tự reset state ở đây: bên gọi remount modal (đổi `key`)
  // khi đổi chất lượng/danh sách ảnh, nên mỗi lần mở luôn là state sạch từ nhóm 1. Cleanup
  // huỷ mọi request đang chạy và nhả File khi đóng modal/unmount.
  useEffect(() => {
    if (isOpen && shareSupported && batches.length > 0) prepareBatch(0);
    return releaseBatch;
  }, [isOpen, shareSupported, batches, prepareBatch, releaseBatch]);

  // Đóng modal bằng phím Esc.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  async function handleShare(skipFailed = false) {
    const files = (filesRef.current ?? []).filter((f): f is File => f !== null);
    if (files.length === 0) return;
    if (!skipFailed && files.length < currentBatch.length) return;

    // Gọi share NGAY, trước mọi await khác — giữ nguyên user activation của lần chạm này.
    setStatus("sharing");
    const outcome = await shareBatchFiles(files);

    if (outcome === "shared") {
      filesRef.current = null; // nhả bộ nhớ của nhóm vừa lưu
      setCompletedBatches((prev) => [...prev, currentBatchIndex]);
      const nextIndex = currentBatchIndex + 1;
      if (nextIndex < totalBatches) {
        setNotice(
          `Đã xong nhóm ${currentBatchIndex + 1}. Đang chuẩn bị nhóm ${nextIndex + 1} — bấm tải khi nút sáng lên.`
        );
        setCurrentBatchIndex(nextIndex);
        prepareBatch(nextIndex);
      } else {
        setNotice(null);
        setStatus("done");
      }
      return;
    }

    setStatus(failures.length > 0 ? "partial_error" : "ready");
    if (outcome === "cancelled") {
      setNotice(`Bạn đã đóng bảng chia sẻ. Bấm lại nút để lưu nhóm ${currentBatchIndex + 1}.`);
    } else if (outcome === "needs_gesture") {
      setNotice("Trình duyệt cần bạn chạm lại nút để mở bảng lưu ảnh.");
    } else {
      setNotice("Không mở được bảng lưu ảnh trên thiết bị này. Bạn có thể tải file ZIP bên dưới.");
    }
  }

  if (!isOpen) return null;

  const loadedCount = progress;
  const progressPercent =
    currentBatch.length > 0 ? Math.round((loadedCount / currentBatch.length) * 100) : 0;
  const started = completedBatches.length > 0 || status === "sharing";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-download-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-[#2a2a2a] bg-[#131313] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] text-[#e5e2e1] shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="batch-download-title" className="text-lg font-semibold">
              Lưu ảnh vào điện thoại
            </h2>
            <p className="mt-1 text-sm text-[#a8a29e]">
              {selectedPhotos.length} ảnh · {QUALITY_LABEL[quality]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-full p-2 text-[#a8a29e] hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </div>

        {selectedPhotos.length === 0 ? (
          <p className="text-sm text-[#a8a29e]">Chưa có ảnh hoàn thiện nào để tải.</p>
        ) : !shareSupported ? (
          <ZipFallback zipFallbackUrl={zipFallbackUrl} />
        ) : status === "done" ? (
          <div className="py-4 text-center">
            <p className="text-3xl">✓</p>
            <p className="mt-2 font-medium text-[#86e8a8]">
              Đã lưu xong {totalBatches} nhóm ({selectedPhotos.length} ảnh)
            </p>
            <p className="mt-1 text-sm text-[#a8a29e]">Ảnh nằm trong ứng dụng Ảnh / Thư viện.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-xl bg-[#a9c7ff] py-3 font-semibold text-[#0b1b33]"
            >
              Đóng
            </button>
          </div>
        ) : (
          <>
            {onQualityChange && !started && (
              <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-[#1f1f1f] p-1 text-sm">
                {(["original", "optimized"] as const).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onQualityChange(q)}
                    className={`rounded-lg py-2 ${
                      quality === q ? "bg-[#2e3a4d] font-semibold text-white" : "text-[#a8a29e]"
                    }`}
                  >
                    {QUALITY_LABEL[q]}
                  </button>
                ))}
              </div>
            )}

            {totalBatches > 1 && (
              <p className="mb-4 rounded-xl bg-[#1c2433] p-3 text-sm leading-relaxed text-[#c8d6ee]">
                Do số lượng ảnh lớn, ảnh sẽ được chia thành <b>{totalBatches} lượt tải</b>. Quý
                khách vui lòng nhấn nút Tải về cho mỗi lượt.
              </p>
            )}

            {/* Các nhóm: xong / đang làm / chờ */}
            {totalBatches > 1 && (
              <div className="mb-4 flex gap-1.5" aria-hidden="true">
                {batches.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${
                      completedBatches.includes(i)
                        ? "bg-[#86e8a8]"
                        : i === currentBatchIndex
                          ? "bg-[#a9c7ff]"
                          : "bg-[#2a2a2a]"
                    }`}
                  />
                ))}
              </div>
            )}

            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium">
                Nhóm {currentBatchIndex + 1}/{totalBatches}
              </span>
              <span className="font-mono text-[#a8a29e]">
                Đã chuẩn bị {loadedCount}/{currentBatch.length} ảnh
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-[#2a2a2a]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={currentBatch.length}
              aria-valuenow={loadedCount}
            >
              <div
                className="h-full rounded-full bg-[#a9c7ff] transition-[width] duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {status === "preparing" && (
              <p className="mt-3 text-xs text-[#d6b56d]">
                Vui lòng không tắt màn hình hoặc chuyển ứng dụng trong lúc đang chuẩn bị ảnh.
              </p>
            )}

            {status === "partial_error" && (
              <div className="mt-3 rounded-xl border border-[#5c2b2b] bg-[#2a1515] p-3 text-sm text-[#f2b8b5]">
                <p>
                  Không tải được {failures.length} ảnh
                  {failures.length <= 3 && `: ${failures.map((f) => f.filename).join(", ")}`}.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => prepareBatch(currentBatchIndex, true)}
                    className="rounded-lg border border-[#f2b8b5]/40 px-3 py-1.5 font-medium"
                  >
                    Thử lại
                  </button>
                  {loadedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleShare(true)}
                      className="rounded-lg px-3 py-1.5 text-[#e5e2e1] underline"
                    >
                      Bỏ qua, lưu {loadedCount} ảnh đã tải
                    </button>
                  )}
                </div>
              </div>
            )}

            {notice && <p className="mt-3 text-sm text-[#86e8a8]">{notice}</p>}

            <button
              type="button"
              onClick={() => handleShare()}
              disabled={status !== "ready"}
              className="mt-5 w-full rounded-xl bg-[#a9c7ff] py-3.5 text-base font-semibold text-[#0b1b33] transition-opacity disabled:opacity-40"
            >
              {status === "preparing"
                ? `Đang chuẩn bị nhóm ${currentBatchIndex + 1}…`
                : status === "sharing"
                  ? "Đang mở bảng lưu ảnh…"
                  : `Tải ${currentBatch.length} ảnh nhóm ${currentBatchIndex + 1}`}
            </button>
            <p className="mt-2 text-center text-xs text-[#78716c]">
              Trong bảng chia sẻ, chọn “Lưu {currentBatch.length} hình ảnh” (iPhone) hoặc “Lưu vào
              thiết bị” (Android).
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ZipFallback({ zipFallbackUrl }: { zipFallbackUrl: string }) {
  return (
    <div>
      <p className="text-sm leading-relaxed text-[#a8a29e]">
        Trình duyệt này chưa hỗ trợ lưu ảnh thẳng vào Thư viện. Bạn có thể tải toàn bộ ảnh dưới
        dạng file ZIP. Trên điện thoại, hãy mở bằng Safari (iPhone) hoặc Chrome (Android) để lưu
        ảnh trực tiếp.
      </p>
      <a
        href={zipFallbackUrl}
        className="mt-5 block w-full rounded-xl bg-[#a9c7ff] py-3.5 text-center font-semibold text-[#0b1b33]"
      >
        Tải file ZIP
      </a>
    </div>
  );
}
