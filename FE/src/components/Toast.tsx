// Thông báo ngắn (toast) dùng chung — 1 thông báo tại 1 thời điểm, tự ẩn sau vài giây.
// Đặt trong vùng aria-live để trình đọc màn hình đọc ngay khi thông báo đổi. z-[60] để nổi
// trên lightbox/modal (z-50).
import { useEffect } from "react";
import type { ToastState, ToastTone } from "../lib/useToast";

const TONE_CLASS: Record<ToastTone, string> = {
  info: "border-white/15 bg-zinc-900 text-zinc-100",
  success: "border-emerald-500/40 bg-emerald-950 text-emerald-100",
  warning: "border-amber-500/40 bg-amber-950 text-amber-100",
  error: "border-rose-500/40 bg-rose-950 text-rose-100",
};

const TOAST_DURATION_MS = 4000;

export function ToastViewport({
  toast,
  onDismiss,
  placement = "bottom",
}: {
  toast: ToastState | null;
  onDismiss: () => void;
  /** "top": thả xuống từ đỉnh như banner thông báo iOS — tránh đè thanh tab/thanh hành động đáy. */
  placement?: "top" | "bottom";
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={`pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3 ${
        placement === "top"
          ? "top-[max(0.5rem,env(safe-area-inset-top))]"
          : "bottom-[max(1rem,env(safe-area-inset-bottom))]"
      }`}
    >
      {toast && (
        <div
          key={toast.id}
          role={toast.tone === "error" || toast.tone === "warning" ? "alert" : "status"}
          className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-xl shadow-black/40 backdrop-blur-xl ${
            placement === "top" ? "motion-safe:animate-[bannerDown_240ms_cubic-bezier(0.16,1,0.3,1)]" : "motion-safe:animate-[fadeInUp_180ms_ease-out]"
          } ${TONE_CLASS[toast.tone]}`}
        >
          <span className="min-w-0 flex-1 text-pretty">{toast.message}</span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Đóng thông báo"
            className="-my-1 -mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
