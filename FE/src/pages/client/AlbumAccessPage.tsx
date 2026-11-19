import { useId, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

const inputClass =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 aria-[invalid=true]:border-rose-500/60";

export default function AlbumAccessPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const id = useId();
  const errorId = `${id}-error`;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/api/public/albums/${albumId}/verify-pin`, {
        pin,
        name,
        phone,
      });
      navigate(`/a/${albumId}/gallery`, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Không thể truy cập album. Kiểm tra lại mã PIN rồi thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] items-center justify-center">
      <div className="relative w-full max-w-sm animate-scale-in overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/60 p-7 shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-8">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent" />

        <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-zinc-950 text-indigo-300">
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h1 className="mt-5 text-xl font-bold tracking-tight text-white">Mở album ảnh của bạn</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Nhập mã PIN nhiếp ảnh gia đã gửi để xem và chọn ảnh.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor={`${id}-name`} className="block text-sm font-medium text-zinc-300">
              Họ tên
            </label>
            <input
              id={`${id}-name`}
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nguyễn Văn A"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor={`${id}-phone`} className="block text-sm font-medium text-zinc-300">
              Số điện thoại
            </label>
            <input
              id={`${id}-phone`}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0901 234 567"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor={`${id}-pin`} className="block text-sm font-medium text-zinc-300">
              Mã PIN
            </label>
            <input
              id={`${id}-pin`}
              name="pin"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••••"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={`${inputClass} font-mono text-base tracking-[0.4em] tabular-nums`}
            />
          </div>

          <div aria-live="polite">
            {error && (
              <p
                id={errorId}
                className="rounded-xl border border-rose-500/20 bg-rose-950/50 px-3.5 py-2.5 text-sm text-rose-300"
              >
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting && (
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
            )}
            {isSubmitting ? "Đang kiểm tra…" : "Xem ảnh"}
          </button>
        </form>
      </div>
    </div>
  );
}
