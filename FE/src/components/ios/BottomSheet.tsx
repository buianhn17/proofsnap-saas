// Sheet kiểu iOS (UISheetPresentationController): điện thoại trượt lên từ đáy, có thanh kéo
// và nút "Xong" bên phải tiêu đề; ≥ sm hiện giữa màn hình như hộp thoại.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { useFocusTrap } from "../../lib/useFocusTrap";

export default function BottomSheet({
  open,
  title,
  onClose,
  children,
  doneLabel = "Xong",
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  doneLabel?: string;
}) {
  const titleId = useId();
  const doneRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose, open);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    doneRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Đóng"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 motion-safe:animate-[fadeIn_150ms_ease-out]"
      />
      <div className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[14px] bg-zinc-900 shadow-2xl motion-safe:animate-[sheetUp_280ms_cubic-bezier(0.16,1,0.3,1)] sm:max-w-lg sm:rounded-[14px]">
        <div className="mx-auto mt-1.5 h-[5px] w-9 shrink-0 rounded-full bg-zinc-600 sm:hidden" aria-hidden="true" />
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2.5">
          <h2 id={titleId} className="min-w-0 truncate text-[17px] font-semibold text-white">
            {title}
          </h2>
          <button
            ref={doneRef}
            type="button"
            onClick={onClose}
            className="-mr-2 h-11 shrink-0 rounded-lg px-2 text-[17px] font-semibold text-indigo-300 focus-visible:outline-2 focus-visible:outline-indigo-400"
          >
            {doneLabel}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-black/20 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {children}
        </div>
      </div>
    </div>
  );
}
