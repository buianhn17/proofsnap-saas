import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { COMPRESSION_PRESETS } from "../../lib/compressionPresets";
import { PIN_PATTERN } from "../../lib/validation";
import type { Album } from "../../lib/types";
import closeIcon from "../../assets/icons/close.svg";
import infoIcon from "../../assets/icons/info.svg";
import lockSmallIcon from "../../assets/icons/lock-small.svg";
import chevronDownIcon from "../../assets/icons/chevron-down.svg";

const inputClass =
  "w-full rounded-[4px] border border-[#2a2a2a] bg-[#131313] px-[17px] py-[19px] text-base text-[#e5e2e1] placeholder:text-[#5a5958] focus:outline-none focus:ring-1 focus:ring-[#a9c7ff]";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]">
      <div className="flex w-full max-w-[600px] flex-col overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#201f1f] shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-between border-b border-[#2a2a2a] px-6 pb-[17px] pt-4">
          <h1 className="text-xl font-semibold text-[#e5e2e1]">
            Tạo album mới
          </h1>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Đóng"
            className="flex size-8 items-center justify-center rounded-xl hover:bg-[#2a2a2a]"
          >
            <img src={closeIcon} alt="" className="size-3.5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex max-h-[calc(100vh-160px)] flex-col overflow-auto"
        >
          <div className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="font-mono text-xs font-medium uppercase tracking-[0.6px] text-[#c1c6d4]">
                Tên album
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Đám cưới Minh & Lan"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="font-mono text-xs font-medium uppercase tracking-[0.6px] text-[#c1c6d4]">
                  Mã PIN
                </label>
                <img
                  src={infoIcon}
                  alt=""
                  title="Khách cần nhập mã PIN này để xem album"
                  className="size-[13.333px]"
                />
              </div>
              <div className="relative">
                <img
                  src={lockSmallIcon}
                  alt=""
                  className="pointer-events-none absolute left-4 top-1/2 h-[15.75px] w-3 -translate-y-1/2"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="0000"
                  className={`${inputClass} py-[19px] pl-10 tracking-[1.6px]`}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-mono text-xs font-medium uppercase tracking-[0.6px] text-[#c1c6d4]">
                Giới hạn số ảnh chọn
              </label>
              <input
                type="number"
                min={1}
                value={maxSelectablePhotos}
                onChange={(e) => setMaxSelectablePhotos(e.target.value)}
                placeholder="Để trống nếu không giới hạn"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-mono text-xs font-medium uppercase tracking-[0.6px] text-[#c1c6d4]">
                Hạn chót chọn ảnh
              </label>
              <input
                type="date"
                value={selectionDeadline}
                onChange={(e) => setSelectionDeadline(e.target.value)}
                className={`${inputClass} [color-scheme:dark]`}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-mono text-xs font-medium uppercase tracking-[0.6px] text-[#c1c6d4]">
                Chất lượng nén ảnh khi tải lên
              </label>
              <div className="relative">
                <select
                  value={compressionPresetId}
                  onChange={(e) => setCompressionPresetId(Number(e.target.value))}
                  className={`${inputClass} appearance-none pr-10`}
                >
                  {COMPRESSION_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.labelVi} — {preset.jpegQuality}%, cạnh dài tối đa{" "}
                      {preset.maxLongEdgePx}px
                    </option>
                  ))}
                </select>
                <img
                  src={chevronDownIcon}
                  alt=""
                  className="pointer-events-none absolute right-4 top-1/2 h-[5.55px] w-[9px] -translate-y-1/2"
                />
              </div>
            </div>

            <div className="border-t border-[#2a2a2a] sm:col-span-2" />

            <label className="flex items-start justify-between gap-4 rounded-[4px] border border-[#2a2a2a] bg-[#1c1b1b] p-[17px] sm:col-span-2">
              <span className="flex flex-col gap-1">
                <span className="text-base font-medium text-[#e5e2e1]">
                  Bật watermark bảo vệ bản quyền
                </span>
                <span className="text-sm text-[#c1c6d4]">
                  Áp dụng lớp phủ mờ có dạng [Tên khách hàng] — [Số điện thoại]
                  lên toàn bộ ảnh trong thư viện khách hàng.
                </span>
              </span>
              <span className="relative mt-1 inline-flex h-6 w-11 shrink-0">
                <input
                  type="checkbox"
                  checked={watermarkEnabled}
                  onChange={(e) => setWatermarkEnabled(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="absolute inset-0 rounded-full border border-[#2a2a2a] bg-[#414752] transition-colors peer-checked:bg-[#5a9cff]" />
                <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
              </span>
            </label>
          </div>

          {error && (
            <p className="mx-6 mb-4 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-4 border-t border-[#2a2a2a] bg-[#0e0e0e] px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-[4px] border border-[#2a2a2a] px-[25px] py-[9px] text-sm text-[#e5e2e1] hover:bg-[#2a2a2a]"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-[4px] bg-[#5a9cff] px-6 py-2 text-sm font-medium text-[#003369] hover:bg-[#4a8cef] disabled:opacity-50"
            >
              {isSubmitting ? "Đang tạo..." : "Tạo album"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
