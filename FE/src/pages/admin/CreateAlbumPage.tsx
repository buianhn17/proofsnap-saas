import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { COMPRESSION_PRESETS } from "../../lib/compressionPresets";
import { PIN_PATTERN } from "../../lib/validation";
import type { Album } from "../../lib/types";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-zinc-900/80 px-4 py-3 text-sm text-white placeholder:text-zinc-500 transition-all focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 [color-scheme:dark]";

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

  function handleClose() {
    navigate("/admin/albums");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Tên album không được để trống");
      return;
    }
    if (!PIN_PATTERN.test(pin)) {
      setError("PIN phải là chuỗi số từ 4 đến 12 chữ số");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-in-up">
      <div className="flex max-h-[90vh] w-full max-w-[620px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/80 backdrop-blur-2xl animate-scale-in">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Tạo bộ sưu tập mới</h2>
              <p className="text-xs text-zinc-400">Thiết lập cấu hình bảo vệ và chọn ảnh cho khách</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Đóng"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="flex flex-col overflow-y-auto">
          <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2">
            {/* Album Name */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                Tên album <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Đám cưới Hoàng & Thảo — Tiệc tối 2026"
                className={inputClass}
                autoFocus
              />
            </div>

            {/* PIN Code */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                  Mã PIN bảo mật <span className="text-rose-400">*</span>
                </label>
                <span className="text-[11px] text-zinc-500">4-12 số</span>
              </div>
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="VD: 1234"
                  className={`${inputClass} pl-10 font-mono tracking-widest`}
                />
              </div>
            </div>

            {/* Max Selectable Photos */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                Số ảnh chọn tối đa
              </label>
              <input
                type="number"
                min={1}
                value={maxSelectablePhotos}
                onChange={(e) => setMaxSelectablePhotos(e.target.value)}
                placeholder="Để trống = Không giới hạn"
                className={inputClass}
              />
            </div>

            {/* Deadline */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                Hạn chót chọn ảnh
              </label>
              <input
                type="date"
                value={selectionDeadline}
                onChange={(e) => setSelectionDeadline(e.target.value)}
                className={inputClass}
              />
            </div>

            {/* Compression Preset */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                Mức nén ảnh preview
              </label>
              <div className="relative">
                <select
                  value={compressionPresetId}
                  onChange={(e) => setCompressionPresetId(Number(e.target.value))}
                  className={`${inputClass} appearance-none pr-10`}
                >
                  {COMPRESSION_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id} className="bg-zinc-900 text-white">
                      {preset.labelVi} — {preset.jpegQuality}% ({preset.maxLongEdgePx}px)
                    </option>
                  ))}
                </select>
                <svg
                  className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>

            {/* Watermark Toggle */}
            <div className="sm:col-span-2">
              <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900/50 p-4 transition-colors hover:bg-zinc-900/80">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-white">
                    Bảo vệ bản quyền Watermark
                  </span>
                  <span className="text-xs text-zinc-400">
                    Áp dụng lớp phủ mờ [Tên khách hàng] — [SĐT] lên toàn bộ ảnh trong Client Portal để chống chụp màn hình trái phép.
                  </span>
                </div>
                <div className="relative mt-1 inline-flex h-6 w-11 shrink-0">
                  <input
                    type="checkbox"
                    checked={watermarkEnabled}
                    onChange={(e) => setWatermarkEnabled(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="h-6 w-11 rounded-full border border-white/10 bg-zinc-800 transition-colors peer-checked:bg-indigo-600" />
                  <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
                </div>
              </label>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mx-6 mb-4 rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-white/10 bg-zinc-900/60 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-400 hover:to-indigo-500 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Đang tạo...</span>
                </>
              ) : (
                <span>Tạo album ngay</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
