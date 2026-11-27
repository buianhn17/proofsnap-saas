import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/auth";
import TabBar from "../components/ios/TabBar";
import SkipLink from "../components/SkipLink";
import { api } from "../lib/api";
import { STUDIO_SHOWS_CHANGED_EVENT, type StudioShow } from "../lib/studioShows";
import { CLIENTS_SEEN_EVENT } from "../lib/navEvents";

interface NavItem {
  to: string;
  label: string;
  /** Nhãn ngắn trên thanh tab mobile */
  tabLabel: string;
  enabled: boolean;
  icon: React.ReactNode;
  /** Hiện badge số bài nộp chờ chủ Studio duyệt */
  showPendingBadge?: boolean;
  /** Hiện badge số khách mới gửi lựa chọn (chưa xem) */
  showClientsBadge?: boolean;
}

const navItems: NavItem[] = [
  {
    to: "/admin/dashboard",
    label: "Bảng điều khiển",
    tabLabel: "Tổng quan",
    enabled: true,
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </svg>
    ),
  },
  {
    to: "/admin/albums",
    label: "Bộ sưu tập",
    tabLabel: "Album",
    enabled: true,
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    ),
  },
  {
    to: "/admin/shows",
    label: "Bàn giao Ekip",
    tabLabel: "Ekip",
    enabled: true,
    showPendingBadge: true,
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="m16 11 2 2 4-4" />
      </svg>
    ),
  },
  {
    to: "/admin/clients",
    label: "Khách hàng",
    tabLabel: "Khách hàng",
    enabled: true,
    showClientsBadge: true,
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: "/admin/settings",
    label: "Cài đặt",
    tabLabel: "Cài đặt",
    enabled: true,
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

// Tổng số bài nộp đang chờ duyệt trên các show mình làm chủ Studio. Tải lại khi đổi trang,
// khi quay lại tab, và ngay khi tạo show / duyệt bài (sự kiện STUDIO_SHOWS_CHANGED_EVENT).
function useNavBadges() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const refresh = () => setRefreshKey((k) => k + 1);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener(STUDIO_SHOWS_CHANGED_EVENT, refresh);
    window.addEventListener(CLIENTS_SEEN_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(STUDIO_SHOWS_CHANGED_EVENT, refresh);
      window.removeEventListener(CLIENTS_SEEN_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const [unseenClients, setUnseenClients] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ owned: StudioShow[] }>("/api/studio/shows")
      .then(({ data }) => {
        if (!cancelled) setCount(data.owned.reduce((sum, show) => sum + show.stats.pending_count, 0));
      })
      .catch(() => {});
    // Mục 5.2 — "hệ thống gửi thông báo cho PTG" khi khách gửi lựa chọn: thông báo trong app.
    api
      .get<{ count: number }>("/api/clients/unseen-count")
      .then(({ data }) => {
        if (!cancelled) setUnseenClients(data.count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname, refreshKey]);

  return { pendingReviews: count, unseenClients };
}

export default function AdminLayout() {
  const { photographer, logout } = useAuth();
  const navigate = useNavigate();
  const { pendingReviews, unseenClients } = useNavBadges();
  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  const displayName = photographer?.display_name || photographer?.email || "";
  const initial = (displayName.charAt(0) || "P").toUpperCase();

  const sidebarContent = (
    <>
        {/* Brand Header */}
      <div className="mb-8 flex items-center gap-3 px-1">
        <div className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-zinc-900 shadow-inner">
          <svg
            className="h-5 w-5 text-zinc-300 transition-transform duration-500 group-hover:rotate-45"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" className="opacity-30" />
            <path d="m14.31 8 5.74 9.94" />
            <path d="M9.69 8h11.48" />
            <path d="m7.38 12 5.74-9.94" />
            <path d="M9.69 16 3.95 6.06" />
            <path d="M14.31 16H2.83" />
            <path d="m16.62 12-5.74 9.94" />
          </svg>
          <span className="absolute h-1.5 w-1.5 rounded-full bg-indigo-400 blur-[1px]" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-base font-bold tracking-tight text-white">
              LensProof
            </span>
            <span className="rounded bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-indigo-300 uppercase">
              Studio
            </span>
          </div>
          <p className="text-[11px] text-zinc-400">Proofing & Culling</p>
        </div>
      </div>

      {/* Navigation */}
      <nav aria-label="Menu quản trị" className="flex flex-1 flex-col gap-1.5">
        <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
          Menu quản trị
        </div>
        {navItems.map((item) =>
          item.enabled ? (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group relative flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                  isActive
                    ? "bg-white/10 text-white shadow-sm border border-white/10 backdrop-blur-md"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
                  )}
                  <span
                    className={`transition-colors ${
                      isActive ? "text-indigo-400" : "text-zinc-500 group-hover:text-zinc-300"
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {item.showClientsBadge && unseenClients > 0 && (
                    <span
                      className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-300"
                      aria-label={`${unseenClients} khách mới gửi lựa chọn`}
                    >
                      {unseenClients > 99 ? "99+" : unseenClients}
                    </span>
                  )}
                  {item.showPendingBadge && pendingReviews > 0 && (
                    <span
                      className="rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300"
                      aria-label={`${pendingReviews} bài chờ duyệt`}
                    >
                      {pendingReviews > 99 ? "99+" : pendingReviews}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ) : (
            <div
              key={item.to}
              title="Tính năng sắp ra mắt"
              className="flex cursor-not-allowed items-center justify-between rounded-xl px-3.5 py-2 text-sm text-zinc-600 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="opacity-40">{item.icon}</span>
                <span>{item.label}</span>
              </div>
              <span className="rounded bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 border border-white/5">
                Sắp có
              </span>
            </div>
          )
        )}
      </nav>

      {/* Trạng thái Google Drive thật nằm ở Cài đặt (gọi Drive API) — không hiển thị "Live" giả ở đây. */}
      <Link
        to="/admin/settings"
        className="mb-4 flex items-center gap-2.5 rounded-xl border border-white/5 bg-zinc-900/40 p-3 text-xs transition-colors hover:bg-zinc-900/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
      >
        <svg className="size-4 shrink-0 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2 2 19h20L12 2z" />
          <path d="M7 12h10" />
        </svg>
        <span className="min-w-0">
          <span className="block font-medium text-zinc-200">Google Drive</span>
          <span className="block truncate text-[11px] text-zinc-500">Xem trạng thái kết nối & lưu trữ</span>
        </span>
      </Link>

      {/* User Profile & Logout */}
      <div className="border-t border-white/10 pt-4">
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500/30 to-purple-500/20 border border-white/10 text-sm font-semibold text-white">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-zinc-200">
              {displayName}
            </p>
            <p className="truncate text-[11px] text-zinc-500">
              {photographer?.email}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 transition duration-200 hover:bg-red-500/10 hover:text-red-300 active:scale-[0.98]"
        >
          <svg
            className="h-4 w-4 shrink-0 text-zinc-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>Đăng xuất</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-dvh bg-[#090a0f] text-slate-100 antialiased selection:bg-indigo-500/30">
      <SkipLink />
      {/* Desktop (≥ lg): sidebar cố định */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-zinc-950/80 p-5 backdrop-blur-2xl lg:flex">
        {sidebarContent}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Thanh tiêu đề mobile/tablet (< lg) — điều hướng chính nằm ở thanh tab dưới */}
        <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-zinc-950/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 lg:hidden">
          <span className="flex items-center gap-2">
            <span className="text-[17px] font-semibold tracking-tight text-white" translate="no">
              LensProof
            </span>
            <span className="rounded border border-indigo-500/30 bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
              Studio
            </span>
          </span>
          <Link
            to="/admin/settings"
            aria-label="Tài khoản và cài đặt"
            className="flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            <span className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-gradient-to-tr from-indigo-500/40 to-cyan-500/20 text-sm font-semibold text-white">
              {initial}
            </span>
          </Link>
        </header>

        {/* Main Content Area */}
        <main id="main" tabIndex={-1} className="relative min-w-0 flex-1 scroll-mt-14 focus:outline-none">
          {/* Subtle Ambient Background Orbs */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="absolute -top-40 right-1/4 h-[500px] w-[500px] rounded-full bg-indigo-600/10 blur-[140px] motion-safe:animate-ambient-pulse" />
            <div className="absolute top-1/2 -right-20 h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-[120px]" />
          </div>

          <div className="relative mx-auto max-w-7xl px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:pt-8 lg:p-10 animate-fade-in">
            <Outlet />
          </div>
        </main>

        <TabBar
          label="Menu quản trị"
          hideFrom="lg:hidden"
          items={navItems.map((item) => ({
            to: item.to,
            label: item.tabLabel,
            icon: <span className="[&>svg]:size-[22px]">{item.icon}</span>,
            badge: item.showPendingBadge ? pendingReviews : item.showClientsBadge ? unseenClients : undefined,
          }))}
        />
      </div>
    </div>
  );
}
