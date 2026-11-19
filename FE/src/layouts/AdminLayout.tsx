import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import { STUDIO_SHOWS_CHANGED_EVENT, type StudioShow } from "../lib/studioShows";
import { useEscapeKey } from "../lib/useEscapeKey";

interface NavItem {
  to: string;
  label: string;
  enabled: boolean;
  icon: React.ReactNode;
  /** Hiện badge số bài nộp chờ chủ Studio duyệt */
  showPendingBadge?: boolean;
}

const navItems: NavItem[] = [
  {
    to: "/admin/dashboard",
    label: "Bảng điều khiển",
    enabled: false,
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
    enabled: false,
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
    enabled: false,
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
function usePendingReviewCount() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const refresh = () => setRefreshKey((k) => k + 1);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener(STUDIO_SHOWS_CHANGED_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(STUDIO_SHOWS_CHANGED_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ owned: StudioShow[] }>("/api/studio/shows")
      .then(({ data }) => {
        if (!cancelled) setCount(data.owned.reduce((sum, show) => sum + show.stats.pending_count, 0));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname, refreshKey]);

  return count;
}

type DriveState = "checking" | "ready" | "not_setup" | "error";

// Trạng thái Google Drive thật của photographer (thay cho nhãn "Live" cố định trước đây).
function useDriveStatus(): DriveState {
  const [state, setState] = useState<DriveState>("checking");
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ connected: boolean; rootFolder: { trashed?: boolean } | null }>("/api/drive/status")
      .then(({ data }) => {
        if (cancelled) return;
        setState(!data.connected ? "error" : data.rootFolder && !data.rootFolder.trashed ? "ready" : "not_setup");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

const DRIVE_META: Record<DriveState, { label: string; hint: string; dot: string; ping: boolean }> = {
  checking: { label: "Đang kiểm tra Drive…", hint: "Kết nối Google Drive của bạn", dot: "bg-zinc-500", ping: false },
  ready: { label: "Google Drive đã kết nối", hint: "Sẵn sàng lưu ảnh vào Drive của bạn", dot: "bg-emerald-500", ping: true },
  not_setup: { label: "Chưa tạo thư mục Drive", hint: "Tự tạo khi bạn tạo album đầu tiên", dot: "bg-amber-400", ping: false },
  error: { label: "Mất kết nối Drive", hint: "Đăng xuất rồi đăng nhập Google lại để cấp quyền", dot: "bg-rose-500", ping: false },
};

export default function AdminLayout() {
  const { photographer, logout } = useAuth();
  const navigate = useNavigate();
  const pendingReviews = usePendingReviewCount();
  const driveState = useDriveStatus();
  const drive = DRIVE_META[driveState];
  const { pathname } = useLocation();

  // Sidebar dạng ngăn kéo trên màn < lg: tự đóng khi chuyển trang hoặc bấm Esc
  const [navOpen, setNavOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setNavOpen(false);
  }
  useEscapeKey(() => setNavOpen(false), navOpen);

  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  const displayName = photographer?.display_name || photographer?.email || "";
  const initial = (displayName.charAt(0) || "P").toUpperCase();

  return (
    <div className="flex min-h-dvh flex-col bg-[#090a0f] text-zinc-100 antialiased selection:bg-indigo-500/30 lg:flex-row">
      {/* Thanh trên cùng cho màn hình nhỏ */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Mở menu"
          aria-expanded={navOpen}
          aria-controls="admin-sidebar"
          className="relative flex size-10 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {pendingReviews > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-amber-400" aria-hidden="true" />}
        </button>
        <span className="text-base font-bold tracking-tight text-white" translate="no">LensProof</span>
        <span className="size-10" aria-hidden="true" />
      </header>

      {navOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm animate-fade-in lg:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

      {/* Sidebar */}
      <aside
        id="admin-sidebar"
        aria-label="Menu quản trị"
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-72 shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-zinc-950/95 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur-2xl transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:w-64 lg:translate-x-0 lg:bg-zinc-950/80 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
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
        <nav className="flex flex-1 flex-col gap-1.5">
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
            Menu quản trị
          </div>
          {navItems.map((item) =>
            item.enabled ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition duration-200 ${
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

        {/* Studio Drive Status Pill */}
        <div role="status" className="mb-4 rounded-xl border border-white/5 bg-zinc-900/40 p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              {drive.ping && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${drive.dot}`} />
            </span>
            <span className="font-medium text-zinc-200">{drive.label}</span>
          </div>
          <p className="mt-1 text-[11px] leading-tight text-zinc-400">{drive.hint}</p>
        </div>

        {/* User Profile & Logout */}
        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center gap-3 px-1 py-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500/30 to-violet-500/20 border border-white/10 text-sm font-semibold text-white">
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
            className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-zinc-400 transition duration-200 hover:bg-rose-500/10 hover:text-rose-300 active:scale-[0.98]"
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
      </aside>

      {/* Main Content Area */}
      <main className="relative flex-1 min-w-0 overflow-y-auto">
        {/* Subtle Ambient Background Orbs */}
        <div className="pointer-events-none absolute -top-40 right-1/4 h-[500px] w-[500px] rounded-full bg-indigo-600/10 blur-[140px] animate-ambient-pulse" />
        <div className="pointer-events-none absolute top-1/2 -right-20 h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-[120px]" />

        <div className="relative mx-auto max-w-7xl p-6 sm:p-8 lg:p-10 animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
