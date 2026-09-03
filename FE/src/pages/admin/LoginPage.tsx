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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#131313]">
      <div className="absolute inset-0 overflow-hidden">
        <img
          alt=""
          className="absolute left-1/2 top-0 h-full w-[147%] max-w-none -translate-x-1/2 object-cover"
          src={backgroundImage}
        />
      </div>
      <div className="absolute inset-0 bg-[rgba(19,19,19,0.9)] mix-blend-multiply" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(19,19,19,0) 0%, rgba(19,19,19,0.95) 100%)",
        }}
      />

      <div className="relative z-10 w-full max-w-[440px] px-4">
        <div className="relative flex w-full flex-col items-center rounded-lg border border-[#414752] bg-[rgba(32,31,31,0.65)] p-[65px] shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)] backdrop-blur-[8px]">
          <div className="flex flex-col items-center pb-6">
            <div className="mb-4 flex size-16 items-center justify-center rounded-lg border border-[#414752] bg-[#353534] p-px shadow-[inset_0px_2px_4px_0px_rgba(0,0,0,0.05)]">
              <img alt="LensProof" className="size-6" src={logoIcon} />
            </div>
            <h1 className="text-center text-[32px] font-semibold leading-[38.4px] tracking-[-0.8px] text-[#e5e2e1]">
              LensProof
            </h1>
          </div>

          <p className="max-w-[280px] pb-16 text-center text-base leading-6 text-[#c1c6d4]">
            Nền tảng lọc ảnh AI và bảo vệ bản quyền cho nhiếp ảnh gia
          </p>

          {error && (
            <p className="mb-4 w-full rounded-md bg-red-950/50 px-3 py-2 text-center text-sm text-red-300">
              {ERROR_MESSAGES[error] ?? "Đăng nhập thất bại. Vui lòng thử lại."}
            </p>
          )}

          <a
            href={googleLoginUrl}
            className="flex w-full items-center justify-center gap-4 rounded border border-[#414752] bg-[#201f1f] px-[25px] py-[17px] text-base font-medium text-[#e5e2e1] transition-colors hover:bg-[#2a2929]"
          >
            <img alt="" className="size-5" src={googleIcon} />
            Đăng nhập với Google
          </a>

          <div className="mt-10 w-full border-t border-[rgba(65,71,82,0.5)] pt-[17px]">
            <p className="text-center font-mono text-xs font-medium uppercase tracking-[0.6px] text-[#8b919e]">
              Vui lòng sử dụng tài khoản Studio
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
