// Action sheet kiểu iOS (UIAlertController .actionSheet): trượt lên từ đáy trên điện thoại,
// nhóm hành động bo tròn + nút Huỷ tách riêng; ≥ sm hiện giữa màn hình như alert.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { useFocusTrap } from "../../lib/useFocusTrap";

export interface SheetAction {
  label: string;
  onSelect: () => void;
  /** "destructive" = chữ đỏ (xoá/huỷ không hoàn tác); "primary" = chữ đậm. */
  tone?: "default" | "primary" | "destructive";
  disabled?: boolean;
}

export default function ActionSheet({
  open,
  title,
  message,
  actions,
  onClose,
  cancelLabel = "Huỷ",
  children,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  actions: SheetAction[];
  onClose: () => void;
  cancelLabel?: string;
  children?: ReactNode;
}) {
  const titleId = useId();
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose, open);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstActionRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [open]);

  if (!open) return null;
  return (
    <div ref={dialogRef} className="fixed inset-0 z-[55] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={cancelLabel}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px] motion-safe:animate-[fadeIn_150ms_ease-out]"
      />
      <div className="relative w-full max-w-sm px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] motion-safe:animate-[sheetUp_260ms_cubic-bezier(0.16,1,0.3,1)] sm:pb-0">
        <div className="overflow-hidden rounded-[14px] bg-zinc-800/95 text-center backdrop-blur-xl">
          <div className="px-4 pb-3 pt-4">
            <h2 id={titleId} className="text-[13px] font-semibold text-zinc-300">
              {title}
            </h2>
            {message && <div className="mt-1 text-pretty text-[13px] leading-snug text-zinc-400">{message}</div>}
          </div>
          {children}
          {actions.map((action, index) => (
            <button
              key={action.label}
              ref={index === 0 ? firstActionRef : undefined}
              type="button"
              disabled={action.disabled}
              onClick={action.onSelect}
              className={`block min-h-14 w-full border-t border-white/10 px-4 text-[17px] transition-colors active:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none disabled:opacity-40 ${
                action.tone === "destructive"
                  ? "text-rose-400"
                  : action.tone === "primary"
                    ? "font-semibold text-indigo-300"
                    : "text-indigo-300"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 block min-h-14 w-full rounded-[14px] bg-zinc-800 text-[17px] font-semibold text-indigo-300 active:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-indigo-400"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
