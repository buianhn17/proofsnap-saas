import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import navDashboard from "../assets/icons/nav-dashboard.svg";
import navCollection from "../assets/icons/nav-collection.svg";
import navClients from "../assets/icons/nav-clients.svg";
import navSettings from "../assets/icons/nav-settings.svg";

const navItems = [
  { to: "/admin/dashboard", label: "Bảng điều khiển", icon: navDashboard, enabled: false },
  { to: "/admin/albums", label: "Bộ sưu tập", icon: navCollection, enabled: true },
  { to: "/admin/clients", label: "Khách hàng", icon: navClients, enabled: false },
  { to: "/admin/settings", label: "Cài đặt", icon: navSettings, enabled: false },
];

export default function AdminLayout() {
  const { photographer, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  const displayName = photographer?.display_name || photographer?.email || "";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-[#131313]">
      <aside className="flex w-[280px] shrink-0 flex-col justify-between border-r border-[#43474f] bg-[#201f1f] py-6 pl-4 pr-[17px]">
        <div className="flex flex-col gap-1 px-4 pb-16">
          <h1 className="text-2xl font-bold tracking-[-0.6px] text-[#e5e2e1]">
            LensProof
          </h1>
          <p className="text-xs font-medium tracking-[0.6px] text-[#c1c6d4]">
            Studio Admin
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-2">
          {navItems.map((item) =>
            item.enabled ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-4 py-2 text-base ${
                    isActive
                      ? "border-r-2 border-[#d6e2ff] bg-[#2a2a2a] text-[#d6e2ff]"
                      : "text-[#c1c6d4] hover:bg-[#2a2a2a]"
                  }`
                }
              >
                <img src={item.icon} alt="" className="size-4" />
                {item.label}
              </NavLink>
            ) : (
              <span
                key={item.to}
                title="Sắp ra mắt"
                className="flex cursor-not-allowed items-center gap-3 rounded-md px-4 py-2 text-base text-[#6b7280]"
              >
                <img src={item.icon} alt="" className="size-4 opacity-50" />
                {item.label}
              </span>
            )
          )}
        </nav>

        <div className="border-t border-[#43474f] pt-[25px]">
          <div className="flex items-center gap-3 px-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#353534] text-sm font-semibold text-[#e5e2e1]">
              {initial || "?"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#e5e2e1]">
                {displayName}
              </p>
              <p className="truncate text-xs text-[#8b919e]">
                {photographer?.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 w-full rounded-md px-2 py-2 text-left text-sm font-medium text-[#c1c6d4] hover:bg-[#2a2a2a]"
          >
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
