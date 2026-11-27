import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { COMPRESSION_PRESETS } from "../../lib/compressionPresets";
import { PIN_PATTERN } from "../../lib/validation";
import type { Album, PhotographerSettings } from "../../lib/types";
import { useEscapeKey } from "../../lib/useEscapeKey";
import SwitchField from "../../components/SwitchField";
import UnsavedChangesGuard from "../../components/UnsavedChangesGuard";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { hasFinePointer } from "../../lib/pointer";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-zinc-900/80 px-4 py-3 text-sm text-white placeholder:text-zinc-500 transition focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 [color-scheme:dark]";

/** Giá trị cho <input type="date"> theo giờ máy (định dạng giao thức của input, không phải hiển thị). */
function toLocalDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function CreateAlbumPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [maxSelectablePhotos, setMaxSelectablePhotos] = useState("");
  const [selectionDeadline, setSelectionDeadline] = useState("");
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  // L7 (FR-05, NFR-03) — album có người dưới 18 tuổi (VD kỷ yếu): tắt hẳn tìm kiếm khuôn mặt,
  // backend không trích embedding khuôn mặt cho mọi ảnh của album.
  const [isMinorAlbum, setIsMinorAlbum] = useState(false);
  const [compressionPresetId, setCompressionPresetId] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Tạo xong thì điều hướng sang album mới — không được bị chặn bởi cảnh báo chưa lưu.
  const [created, setCreated] = useState(false);
  const [appliedDefaults, setAppliedDefaults] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  // Chỉ tự focus ô tên trên máy có chuột — trên điện thoại sẽ bật bàn phím ảo che nửa form.
  const [autoFocusName] = useState(hasFinePointer);
  const [todayLocal] = useState(() => toLocalDateInput(new Date()));

  // Điền sẵn giá trị mặc định PTG đặt ở trang Cài đặt — chỉ ghi vào ô PTG chưa sửa.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ settings: PhotographerSettings }>("/api/settings")
      .then(({ data }) => {
        if (cancelled) return;
        const d = data.settings.settings ?? {};
        if (d.default_compression_preset_id) {
          const preset = d.default_compression_preset_id;
          setCompressionPresetId((prev) => (prev === 2 ? preset : prev));
        }
        if (typeof d.default_watermark_enabled === "boolean") {
          const wm = d.default_watermark_enabled;
          setWatermarkEnabled((prev) => (prev === true ? wm : prev));
        }
        if (d.default_max_selectable_photos) {
          const max = String(d.default_max_selectable_photos);
          setMaxSelectablePhotos((prev) => (prev === "" ? max : prev));
        }
        if (d.default_deadline_days) {
          const local = toLocalDateInput(new Date(Date.now() + d.default_deadline_days * 86_400_000));
          setSelectionDeadline((prev) => (prev === "" ? local : prev));
        }
        setAppliedDefaults(Object.keys(d).length > 0);
      })
      .catch(() => {
        // Không có cài đặt mặc định thì dùng giá trị sẵn của form.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleClose() {
    navigate("/admin/albums");
  }
  useEscapeKey(handleClose, !isSubmitting);

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
        // Ô chọn ngày trả "YYYY-MM-DD" — new Date() sẽ hiểu là 00:00 UTC (= 07:00 sáng giờ VN),
        // khoá album sớm gần cả ngày. Hạn chót là HẾT ngày đã chọn theo giờ máy PTG.
        selection_deadline: selectionDeadline
          ? new Date(`${selectionDeadline}T23:59:59`).toISOString()
          : null,
        watermark_enabled: watermarkEnabled,
        compression_preset_id: compressionPresetId,
        is_minor_album: isMinorAlbum,
      });
      setCreated(true);
      // Chờ 1 lượt render để UnsavedChangesGuard nhận when=false trước khi điều hướng.
      setTimeout(() => navigate(`/admin/albums/${data.album.id}`, { replace: true }), 0);
    } catch (err) {
      setError(getErrorMessage(err, "Không thể tạo album"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
    <UnsavedChangesGuard
      when={!created && (name.trim() !== "" || pin !== "")}
      title="Bỏ album đang tạo?"
      message="Tên album và mã PIN bạn vừa nhập sẽ không được lưu."
      leaveLabel="Bỏ album"
    />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-album-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4 backdrop-blur-md animate-fade-in-up">
      <div className="flex max-h-[min(92dvh,860px)] w-full max-w-[620px] flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/80 backdrop-blur-2xl animate-scale-in">
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
              <h2 id="create-album-title" className="text-base font-bold text-white">Tạo bộ sưu tập mới</h2>
              <p className="text-xs text-zinc-400">
                {appliedDefaults ? "Đã điền sẵn theo mặc định trong Cài đặt" : "Thiết lập cấu hình bảo vệ và chọn ảnh cho khách"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Đóng"
            className="flex size-11 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 sm:size-9"
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
              <label htmlFor="album-name" className="text-sm font-medium text-zinc-300">
                Tên album <span className="text-rose-400">*</span>
              </label>
              <input id="album-name" name="name" autoComplete="off"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Đám cưới Hoàng & Thảo — Tiệc tối 2026…"
                className={inputClass}
                autoFocus={autoFocusName}
              />
            </div>

            {/* PIN Code */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="album-pin" className="text-sm font-medium text-zinc-300">
                  Mã PIN bảo mật <span className="text-rose-400">*</span>
                </label>
                <span className="text-xs text-zinc-500">4–12 chữ số</span>
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
                <input id="album-pin" name="pin" autoComplete="off" spellCheck={false}
                  type="text"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="VD: 1234…"
                  className={`${inputClass} pl-10 font-mono tracking-widest`}
                />
              </div>
            </div>

            {/* Max Selectable Photos */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="album-max" className="text-sm font-medium text-zinc-300">
                Số ảnh chọn tối đa
              </label>
              <input id="album-max" name="max_selectable" inputMode="numeric"
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
              <label htmlFor="album-deadline" className="text-sm font-medium text-zinc-300">
                Hạn chót chọn ảnh
              </label>
              <input id="album-deadline" name="deadline"
                type="date"
                min={todayLocal}
                value={selectionDeadline}
                onChange={(e) => setSelectionDeadline(e.target.value)}
                className={inputClass}
              />
            </div>

            {/* Compression Preset */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="album-preset" className="text-sm font-medium text-zinc-300">
                Mức nén ảnh preview
              </label>
              <div className="relative">
                <select id="album-preset" name="preset"
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
            <SwitchField
              className="sm:col-span-2"
              label="Bảo vệ bản quyền bằng watermark"
              description="Phủ mờ [Tên khách hàng] — [SĐT] lên mọi ảnh trong Client Portal để chống chụp màn hình trái phép. Ảnh gốc trên Drive luôn sạch."
              checked={watermarkEnabled}
              onChange={setWatermarkEnabled}
            />

            {/* Minor album — L7 */}
            <SwitchField
              className="sm:col-span-2"
              tone="warning"
              label="Album có người dưới 18 tuổi (Tắt tìm kiếm khuôn mặt)"
              description="Dùng cho kỷ yếu, sự kiện học sinh. Hệ thống sẽ không trích xuất dữ liệu khuôn mặt của bất kỳ ảnh nào và khách không thể dùng “Tìm ảnh bằng khuôn mặt” — tối thiểu hoá dữ liệu sinh trắc học theo Luật Bảo vệ dữ liệu cá nhân."
              checked={isMinorAlbum}
              onChange={setIsMinorAlbum}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div role="alert" className="mx-6 mb-4 rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-sm text-rose-300">
              {error}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-white/10 bg-zinc-900/60 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="h-11 rounded-xl border border-white/10 px-4 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 sm:h-10"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-indigo-500 px-5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-colors hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 active:translate-y-px disabled:opacity-50 sm:h-10"
            >
              {isSubmitting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Đang tạo…</span>
                </>
              ) : (
                <span>Tạo album ngay</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
    </>
  );
}
