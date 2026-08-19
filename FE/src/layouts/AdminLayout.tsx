import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const navItems = [{ to: "/admin/albums", label: "Album" }];

export default function AdminLayout() {
  const { photographer, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4">
        <div className="mb-8 px-2 text-lg font-semibold text-slate-900">
          LensProof
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 pt-4">
          <p className="truncate px-2 text-sm font-medium text-slate-900">
            {photographer?.display_name || photographer?.email}
          </p>
          <p className="truncate px-2 text-xs text-slate-500">
            {photographer?.email}
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
