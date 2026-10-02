import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import backgroundImage from "../../assets/login/background.png";
import logoIcon from "../../assets/login/logo-icon.svg";
import googleIcon from "../../assets/login/google-icon.svg";

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#090a0f] text-slate-100 antialiased selection:bg-indigo-500/30">
      {/* Background with Ambient Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <img
          alt=""
          className="absolute left-1/2 top-0 h-full w-[140%] max-w-none -translate-x-1/2 object-cover opacity-25"
          src={backgroundImage}
        />
        <div className="absolute inset-0 bg-[#090a0f]/80 mix-blend-multiply" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at center, rgba(9,10,15,0.2) 0%, rgba(9,10,15,0.95) 100%)",
          }}
        />
        {/* Ambient floating orbs */}
        <div className="absolute -top-32 left-1/4 h-[450px] w-[450px] rounded-full bg-indigo-600/15 blur-[140px] animate-ambient-pulse" />
        <div className="absolute -bottom-32 right-1/4 h-[400px] w-[400px] rounded-full bg-purple-600/10 blur-[130px] animate-ambient-pulse" />
      </div>

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-[420px] px-4 animate-scale-in">
        <div className="relative flex w-full flex-col items-center overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/70 p-8 sm:p-10 shadow-2xl shadow-black/80 backdrop-blur-2xl">
          {/* Top highlight */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent" />

          {/* Brand Icon */}
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900 shadow-inner">
            <img alt="LensProof" className="h-7 w-7" src={logoIcon} />
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            LensProof
          </h1>
          <span className="mt-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
            Studio Admin
          </span>

          <p className="mt-3 max-w-[280px] text-center text-xs text-zinc-400 leading-relaxed">
            Nền tảng lọc ảnh AI thông minh và bảo vệ bản quyền cho nhiếp ảnh gia
          </p>

          {/* Error Message */}
          {error && (
            <div className="mt-6 w-full rounded-xl border border-rose-500/20 bg-rose-950/50 p-3 text-center text-xs text-rose-300">
              {ERROR_MESSAGES[error] ?? "Đăng nhập thất bại. Vui lòng thử lại."}
            </div>
          )}

          {/* Google Login Action */}
          <div className="mt-8 w-full">
            <a
              href={googleLoginUrl}
              className="group flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3.5 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:bg-white/10 hover:border-white/25 hover:shadow-indigo-500/10 hover:-translate-y-0.5 active:translate-y-0"
            >
              <img alt="" className="h-5 w-5 transition-transform group-hover:scale-110" src={googleIcon} />
              <span>Đăng nhập với Google</span>
            </a>
          </div>

          {/* Footer Note */}
          <div className="mt-8 w-full border-t border-white/5 pt-4 text-center">
            <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Dành riêng cho Studio & Nhiếp ảnh gia
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
