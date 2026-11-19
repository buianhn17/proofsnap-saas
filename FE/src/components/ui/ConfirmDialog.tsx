import { useState, type ReactNode } from "react";
import Dialog, { ghostButtonClass, primaryButtonClass } from "../Dialog";
import { AlertTriangleIcon } from "../Icons";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  /** danger: nút đỏ cho hành động phá huỷ / không hoàn tác */
  tone?: "danger" | "default";
  /** Ném lỗi để hiện ngay trong dialog; thành công thì dialog tự đóng. */
  onConfirm: () => Promise<void> | void;
}

/** Hộp xác nhận dùng chung — thay window.confirm (không theo giao diện, không đọc được bằng screen reader tốt). */
export default function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  busyLabel = "Đang xử lý…",
  tone = "default",
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thao tác thất bại, thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      dismissible={!busy}
      size="sm"
      title={title}
      description={description}
      icon={<AlertTriangleIcon size={18} />}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={ghostButtonClass}>
            Hủy
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            data-autofocus
            className={
              tone === "danger"
                ? "inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                : primaryButtonClass
            }
          >
            {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-zinc-300">
        {children}
        {error && (
          <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-xs text-rose-300">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
