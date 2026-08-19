import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

export default function AlbumAccessPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      setError(getErrorMessage(err, "Không thể truy cập album"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-8">
      <h1 className="text-xl font-semibold text-slate-900">Nhập mã PIN</h1>
      <p className="mt-1 text-sm text-slate-600">Xem ảnh trong album của bạn</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Họ tên
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nguyễn Văn A"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">
            Số điện thoại
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0901234567"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">
            Mã PIN
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="123456"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? "Đang kiểm tra..." : "Xem ảnh"}
        </button>
      </form>
    </div>
  );
}
