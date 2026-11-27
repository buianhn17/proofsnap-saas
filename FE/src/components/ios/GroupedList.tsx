// Danh sách nhóm kiểu iOS (UITableView .insetGrouped): tiêu đề nhóm chữ nhỏ, khối bo tròn,
// các hàng ngăn bằng đường kẻ mảnh thụt lề trái, chevron cho hàng điều hướng.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function ListSection({
  title,
  footer,
  children,
  className = "",
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {title && (
        <h2 className="mb-1.5 px-4 text-[13px] font-medium uppercase tracking-wide text-zinc-500">{title}</h2>
      )}
      <ul className="divide-y divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.06] bg-zinc-900/80">
        {children}
      </ul>
      {footer && <p className="mt-1.5 px-4 text-pretty text-[13px] leading-snug text-zinc-500">{footer}</p>}
    </section>
  );
}

const Chevron = () => (
  <svg className="size-4 shrink-0 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export function ListRow({
  icon,
  title,
  subtitle,
  value,
  to,
  onClick,
  trailing,
  destructive = false,
  chevron,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  to?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  destructive?: boolean;
  chevron?: boolean;
}) {
  const showChevron = chevron ?? Boolean(to || onClick);
  const body = (
    <>
      {icon && <span className="flex shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1 py-2.5">
        <span className={`block truncate text-[15px] ${destructive ? "text-rose-400" : "text-zinc-100"}`}>{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[13px] text-zinc-500">{subtitle}</span>}
      </span>
      {value !== undefined && <span className="max-w-[45%] shrink-0 truncate text-[15px] text-zinc-500">{value}</span>}
      {trailing}
      {showChevron && <Chevron />}
    </>
  );
  const rowClass =
    "flex min-h-12 w-full items-center gap-3 px-4 text-left transition-colors active:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none";
  return (
    <li>
      {to ? (
        <Link to={to} className={`${rowClass} hover:bg-white/[0.03]`}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={`${rowClass} hover:bg-white/[0.03]`}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

/** Ô biểu tượng màu kiểu ứng dụng Cài đặt của iOS. */
export function IconTile({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span className={`flex size-[29px] items-center justify-center rounded-[7px] text-white ${color}`} aria-hidden="true">
      {children}
    </span>
  );
}
