import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function RequireAuth() {
  const { photographer, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Đang kiểm tra đăng nhập...
      </div>
    );
  }

  if (!photographer) {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
}
