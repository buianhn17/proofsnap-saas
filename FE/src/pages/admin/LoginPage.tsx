import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Thiếu authorization code từ Google.",
  missing_refresh_token:
    "Không nhận được refresh_token từ Google. Vào https://myaccount.google.com/permissions gỡ quyền truy cập của app rồi đăng nhập lại.",
  oauth_failed: "Xác thực Google thất bại. Vui lòng thử lại.",
};

const googleLoginUrl = `${import.meta.env.VITE_API_BASE_URL}/api/auth/google`;

export default function LoginPage() {
  const { photographer, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");

  useEffect(() => {
    if (!isLoading && photographer) {
      navigate("/admin/albums", { replace: true });
    }
  }, [isLoading, photographer, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">LensProof</h1>
        <p className="mt-1 text-sm text-slate-600">
          Đăng nhập dành cho nhiếp ảnh gia
        </p>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {ERROR_MESSAGES[error] ?? "Đăng nhập thất bại. Vui lòng thử lại."}
          </p>
        )}

        <a
          href={googleLoginUrl}
          className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Đăng nhập với Google
        </a>
      </div>
    </div>
  );
}
