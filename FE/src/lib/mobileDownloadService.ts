// Tải ảnh hoàn thiện về điện thoại: nạp ảnh thành File rồi mở Native Share Sheet
// (navigator.share) để khách bấm "Lưu X hình ảnh" thẳng vào Thư viện ảnh — thay vì tải file
// .ZIP mà iOS/Android không mở được vào Photos.
//
// LƯU Ý iOS Safari: navigator.share chỉ được gọi trong "user activation" (vài giây sau khi
// người dùng chạm). Nạp 10 ảnh qua mạng di động thường lâu hơn thế, nên KHÔNG được làm
// "chạm -> fetch -> share" trong 1 lượt: phải nạp sẵn (prepareFiles) trước, rồi gọi
// shareBatchFiles NGAY trong handler của lần chạm kế tiếp (xem BatchDownloadModal).

/** Điện thoại/máy tính bảng — kể cả iPadOS 13+ (UA giả dạng Mac, nhận ra qua cảm ứng). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
    .userAgentData;
  if (uaData?.mobile) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** Trình duyệt chia sẻ được đúng danh sách file này qua Web Share API. */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

/** Kiểm tra sớm (trước khi nạp ảnh thật) bằng 1 file JPEG rỗng — đủ để biết trình duyệt có hỗ
 * trợ chia sẻ file ảnh hay không, tránh bắt khách chờ nạp ảnh rồi mới báo không hỗ trợ. */
export function supportsImageFileSharing(): boolean {
  if (typeof File === "undefined") return false;
  return canShareFiles([new File([new Uint8Array(0)], "probe.jpg", { type: "image/jpeg" })]);
}

export class ImageFetchError extends Error {
  readonly filename: string;
  /** HTTP status nếu server trả lỗi; null nếu lỗi mạng/CORS (trình duyệt không cho biết chi
   * tiết, cả 2 đều hiện thành TypeError). */
  readonly status: number | null;

  constructor(filename: string, message: string, status: number | null) {
    super(message);
    this.name = "ImageFetchError";
    this.filename = filename;
    this.status = status;
  }
}

const FETCH_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

/**
 * Signal huỷ khi `parent` huỷ HOẶC hết `timeoutMs`. Tự cài thay cho AbortSignal.any /
 * AbortSignal.timeout vì AbortSignal.any chỉ có từ Safari 17.4 — iOS 16 vẫn còn nhiều.
 * Gọi dispose() khi xong để gỡ timer/listener.
 */
function signalWithTimeout(
  timeoutMs: number,
  parent?: AbortSignal
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort(new DOMException("Timeout", "TimeoutError"));
  }, timeoutMs);
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

/** Lỗi đáng thử lại: mạng chập chờn, timeout, server quá tải/lỗi tạm thời. 4xx (hết quyền,
 * không tìm thấy) thì thử lại cũng vô ích. */
function isRetryable(error: unknown): boolean {
  if (error instanceof ImageFetchError) {
    return error.status === null || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}

/**
 * Tải 1 ảnh về thành File. Gửi kèm cookie phiên (credentials: "include") vì API ảnh hoàn
 * thiện yêu cầu xác thực khách và nằm khác origin với FE. Tự thử lại tối đa MAX_RETRIES lần
 * (lùi dần 1s, 2s) với lỗi mạng/5xx; mỗi lần tối đa FETCH_TIMEOUT_MS.
 */
export async function fetchImageAsFile(
  url: string,
  filename: string,
  options: { signal?: AbortSignal } = {}
): Promise<File> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), options.signal);

    const attemptSignal = signalWithTimeout(FETCH_TIMEOUT_MS, options.signal);
    try {
      const response = await fetch(url, { credentials: "include", signal: attemptSignal.signal });
      if (!response.ok) {
        throw new ImageFetchError(
          filename,
          `Máy chủ trả lỗi ${response.status} khi tải ${filename}`,
          response.status
        );
      }
      const blob = await response.blob();
      // iOS chỉ hiện "Lưu hình ảnh" khi file có MIME ảnh — server/CDN trả
      // application/octet-stream thì ép về image/jpeg (ảnh hoàn thiện luôn là JPEG).
      const type = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
      return new File([blob], filename, { type, lastModified: Date.now() });
    } catch (error) {
      // Người dùng huỷ (đóng modal) — dừng ngay, không thử lại.
      if (options.signal?.aborted) throw options.signal.reason;
      lastError =
        error instanceof ImageFetchError
          ? error
          : new ImageFetchError(
              filename,
              attemptSignal.timedOut()
                ? `Quá thời gian tải ${filename} — mạng có thể đang yếu`
                : `Không tải được ${filename} — kiểm tra kết nối mạng`,
              null
            );
      if (!isRetryable(lastError)) break;
    } finally {
      attemptSignal.dispose();
    }
  }
  throw lastError;
}

export type ShareOutcome =
  /** Share sheet đã đóng sau khi người dùng chọn 1 hành động (Lưu ảnh, gửi đi...). */
  | "shared"
  /** Người dùng bấm Huỷ/vuốt đóng share sheet. */
  | "cancelled"
  /** Trình duyệt chặn vì không còn trong user activation (cần chạm lại nút). */
  | "needs_gesture"
  | "unsupported"
  | "failed";

/**
 * Mở Native Share Sheet với danh sách ảnh. Không truyền title/text/url: trên iOS, chia sẻ kèm
 * văn bản khiến share sheet coi đây là "nội dung hỗn hợp" và có thể ẩn mất lựa chọn "Lưu X
 * hình ảnh" — đúng thứ khách cần.
 */
export async function shareBatchFiles(files: File[]): Promise<ShareOutcome> {
  if (!canShareFiles(files)) return "unsupported";
  try {
    await navigator.share({ files });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === "AbortError") return "cancelled";
      if (error.name === "NotAllowedError") return "needs_gesture";
    }
    return "failed";
  }
}

/**
 * Giữ màn hình sáng trong lúc nạp ảnh (màn hình tắt -> trình duyệt di động treo tab, việc tải
 * dừng giữa chừng). Best-effort: trình duyệt không hỗ trợ thì bỏ qua. Trả hàm nhả khoá.
 */
export async function keepScreenAwake(): Promise<() => void> {
  try {
    const sentinel = await navigator.wakeLock?.request("screen");
    return () => {
      sentinel?.release().catch(() => undefined);
    };
  } catch {
    return () => undefined;
  }
}
