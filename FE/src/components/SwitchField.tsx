// Công tắc bật/tắt có nhãn + mô tả, dùng chung cho form album (Admin Portal).
// Dựa trên <input type="checkbox" role="switch"> thật: bàn phím (Space), trình đọc màn hình
// và submit form hoạt động sẵn; toàn bộ thẻ là vùng bấm (≥ 44px).
import { useId, type ReactNode } from "react";

interface SwitchFieldProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** "warning" — viền hổ phách khi bật, dùng cho cài đặt có hệ quả pháp lý/dữ liệu. */
  tone?: "default" | "warning";
  disabled?: boolean;
  className?: string;
}

export default function SwitchField({
  label,
  description,
  checked,
  onChange,
  tone = "default",
  disabled = false,
  className = "",
}: SwitchFieldProps) {
  const id = useId();
  const descriptionId = `${id}-desc`;
  const activeBorder =
    tone === "warning" && checked ? "border-amber-500/40 bg-amber-950/20" : "border-white/10 bg-zinc-900/50";
  const trackOn = tone === "warning" ? "peer-checked:bg-amber-500" : "peer-checked:bg-indigo-600";

  return (
    <label
      htmlFor={id}
      className={`flex min-h-11 cursor-pointer items-start justify-between gap-4 rounded-2xl border p-4 transition-colors hover:bg-zinc-900/80 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo-400 ${activeBorder} ${disabled ? "cursor-not-allowed opacity-60" : ""} ${className}`}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-semibold text-white">{label}</span>
        {description && (
          <span id={descriptionId} className="text-pretty text-xs leading-relaxed text-zinc-400">
            {description}
          </span>
        )}
      </span>
      <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={description ? descriptionId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`h-6 w-11 rounded-full border border-white/10 bg-zinc-700 transition-colors ${trackOn}`}
        />
        <span
          aria-hidden="true"
          className="absolute left-1 top-1 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}
