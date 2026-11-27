import { useEffect, useId, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useEscapeKey } from "../lib/useEscapeKey";
import { XIcon } from "./Icons";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  /** Thanh nút cuối dialog — đặt trong <form> nếu cần submit. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Chặn đóng (Esc, bấm nền, nút X) khi đang xử lý. */
  dismissible?: boolean;
}

const SIZE_CLASS = { sm: "max-w-md", md: "max-w-[560px]", lg: "max-w-3xl" };

/** Modal cùng phong cách CreateAlbumPage: nền mờ, card zinc-950, header có icon. */
export default function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = "md",
  dismissible = true,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose, open && dismissible);

  useFocusTrap(panelRef);
  // Focus vào ô nhập đầu tiên (hoặc chính panel) khi mở, trả focus về chỗ cũ khi đóng.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select") ??
      panel;
    target?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-md animate-fade-in sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`flex max-h-[92dvh] w-full ${SIZE_CLASS[size]} flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/80 backdrop-blur-2xl outline-none animate-scale-in sm:rounded-3xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-bold text-white">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="text-xs text-zinc-400">
                  {description}
                </p>
              )}
            </div>
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="flex size-8 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <XIcon />
            </button>
          )}
        </div>
        <div className="overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 bg-zinc-900/60 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const dialogInputClass =
  "w-full rounded-xl border border-white/10 bg-zinc-900/80 px-4 py-3 text-sm text-white placeholder:text-zinc-500 transition focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 aria-[invalid=true]:border-rose-500/60 [color-scheme:dark]";

export const dialogLabelClass = "text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 border border-indigo-400/30 transition hover:from-indigo-400 hover:to-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white";
