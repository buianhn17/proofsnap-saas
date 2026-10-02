import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

interface NavItem {
  to: string;
  label: string;
  enabled: boolean;
  icon: React.ReactNode;
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

export default function AdminLayout() {
  const { photographer, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  const displayName = photographer?.display_name || photographer?.email || "";
  const initial = (displayName.charAt(0) || "P").toUpperCase();

  return (
    <div className="flex min-h-screen bg-[#090a0f] text-slate-100 antialiased selection:bg-indigo-500/30">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-white/10 bg-zinc-950/80 backdrop-blur-2xl p-5">
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
              <span className="rounded bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-indigo-300 uppercase">
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
                  `group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ${
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
                    <span>{item.label}</span>
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
                <span className="rounded bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-medium text-zinc-600 border border-white/5">
                  Sắp có
                </span>
              </div>
            )
          )}
        </nav>

        {/* Studio Drive Status Pill */}
        <div className="mb-4 rounded-xl border border-white/5 bg-zinc-900/40 p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-medium text-zinc-200">Google Drive Live</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400 leading-tight">
            Sẵn sàng đồng bộ & trích xuất ảnh
          </p>
        </div>

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
            className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-zinc-400 transition-all duration-200 hover:bg-red-500/10 hover:text-red-300 active:scale-[0.98]"
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
