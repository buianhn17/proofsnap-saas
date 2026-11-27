import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/auth";

export default function RequireAuth() {
  const { photographer, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center gap-3 bg-[#090a0f] text-sm text-zinc-400"
      >
        <span className="size-4 animate-spin rounded-full border-2 border-white/15 border-t-indigo-400" aria-hidden="true" />
        Đang kiểm tra đăng nhập…
      </div>
    );
  }

  if (!photographer) {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
}
