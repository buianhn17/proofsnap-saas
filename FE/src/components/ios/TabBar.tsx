// Thanh tab dưới kiểu iOS (UITabBar): cố định đáy màn hình, nền mờ trong suốt, đường kẻ mảnh,
// biểu tượng + nhãn nhỏ, chừa vùng an toàn (home indicator). Chỉ hiện trên màn hình nhỏ —
// lớp `hideFrom` quyết định breakpoint ẩn (md:hidden cho Client, lg:hidden cho Admin).
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

export interface TabItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Số hiển thị trên huy hiệu đỏ (iOS badge); 0/undefined = ẩn. */
  badge?: number;
  /** So khớp trang đang mở thủ công (VD tab dùng query string). */
  isActive?: boolean;
  end?: boolean;
}

export const TAB_BAR_HEIGHT = "calc(3.25rem + env(safe-area-inset-bottom))";

function tabClass(active: boolean) {
  return `relative flex h-full flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium tracking-tight transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-400 ${
    active ? "text-indigo-300" : "text-zinc-500 active:text-zinc-300"
  }`;
}

function TabContent({ item }: { item: TabItem }) {
  return (
    <>
      <span className="relative flex size-6 items-center justify-center" aria-hidden="true">
        {item.icon}
        {item.badge ? (
          <span className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none tabular-nums text-white">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate px-1">{item.label}</span>
      {item.badge ? <span className="sr-only">, {item.badge} mục</span> : null}
    </>
  );
}

export default function TabBar({
  items,
  label,
  hideFrom = "md:hidden",
}: {
  items: TabItem[];
  label: string;
  hideFrom?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-zinc-950/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 ${hideFrom}`}
    >
      <ul className="mx-auto flex h-[3.25rem] max-w-lg items-stretch">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            {item.isActive !== undefined ? (
              // Tab phân biệt bằng query string (VD ?view=liked): tự xác định trang đang mở.
              <Link to={item.to} aria-current={item.isActive ? "page" : undefined} className={tabClass(item.isActive)}>
                <TabContent item={item} />
              </Link>
            ) : (
              <NavLink to={item.to} end={item.end} className={({ isActive }) => tabClass(isActive)}>
                <TabContent item={item} />
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
