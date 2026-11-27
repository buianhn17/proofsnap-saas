// Segmented control kiểu iOS (UISegmentedControl): rãnh xám, đoạn đang chọn nổi lên. Dùng
// radiogroup để bàn phím (←/→) và trình đọc màn hình hiểu đúng "chọn 1 trong n".
import { useId, type KeyboardEvent } from "react";

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Số nhỏ cạnh nhãn (VD số khách) */
  count?: number;
}

export default function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  className = "",
  size = "md",
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const name = useId();
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = segments.findIndex((s) => s.value === value);
    const next = segments[(index + (event.key === "ArrowRight" ? 1 : -1) + segments.length) % segments.length];
    onChange(next.value);
    (event.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex w-full rounded-[10px] bg-white/[0.08] p-0.5 ${className}`}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            name={name}
            data-value={segment.value}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(segment.value)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-[8px] px-2 font-medium transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 ${
              size === "sm" ? "h-8 text-[13px]" : "h-9 text-sm"
            } ${
              selected
                ? "bg-zinc-600/90 text-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span className="truncate">{segment.label}</span>
            {segment.count !== undefined && (
              <span className={`tabular-nums text-xs ${selected ? "text-zinc-300" : "text-zinc-500"}`}>
                {segment.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
