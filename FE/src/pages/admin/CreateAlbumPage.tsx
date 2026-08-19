import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { COMPRESSION_PRESETS } from "../../lib/compressionPresets";
import { PIN_PATTERN } from "../../lib/validation";
import type { Album } from "../../lib/types";

export default function CreateAlbumPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [maxSelectablePhotos, setMaxSelectablePhotos] = useState("");
  const [selectionDeadline, setSelectionDeadline] = useState("");
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [compressionPresetId, setCompressionPresetId] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Tên album không được để trống");
      return;
    }
    if (!PIN_PATTERN.test(pin)) {
      setError("PIN phải là chuỗi số từ 4 đến 12 ký tự");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data } = await api.post<{ album: Album }>("/api/albums", {
        name: name.trim(),
        pin,
        max_selectable_photos: maxSelectablePhotos
          ? Number(maxSelectablePhotos)
          : null,
        selection_deadline: selectionDeadline
          ? new Date(selectionDeadline).toISOString()
          : null,
        watermark_enabled: watermarkEnabled,
        compression_preset_id: compressionPresetId,
      });
      navigate(`/admin/albums/${data.album.id}`, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Không thể tạo album"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          Tạo album mới
        </h1>
        <Link
          to="/admin/albums"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Hủy
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Tên album
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kỷ yếu 2026"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">
            Mã PIN (4-12 chữ số)
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

        <div>
          <label className="block text-sm font-medium text-slate-700">
            Giới hạn số ảnh được chọn
          </label>
          <input
            type="number"
            min={1}
            value={maxSelectablePhotos}
            onChange={(e) => setMaxSelectablePhotos(e.target.value)}
            placeholder="Để trống nếu không giới hạn"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">
            Hạn chọn ảnh (deadline)
          </label>
          <input
            type="datetime-local"
            value={selectionDeadline}
            onChange={(e) => setSelectionDeadline(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">
            Mức nén ảnh
          </label>
          <select
            value={compressionPresetId}
            onChange={(e) => setCompressionPresetId(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          >
            {COMPRESSION_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.labelVi} — {preset.jpegQuality}%, cạnh dài tối đa{" "}
                {preset.maxLongEdgePx}px
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={watermarkEnabled}
            onChange={(e) => setWatermarkEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Bật watermark động cho khách xem ảnh
        </label>

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
          {isSubmitting ? "Đang tạo..." : "Tạo album"}
        </button>
      </form>
    </div>
  );
}
