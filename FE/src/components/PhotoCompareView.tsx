// Bước 2.3 — xem 2 ảnh cạnh nhau, phóng to/kéo đồng bộ (bật/tắt được qua "Đồng bộ Zoom/Pan").
// Mỗi ảnh vẫn tải qua đúng URL /view hiện có (proxy watermark theo phiên khách đang đăng
// nhập) — không có xử lý watermark riêng ở đây, tự động đúng theo từng khách.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEscapeKey } from "../lib/useEscapeKey";

interface ComparePhoto {
  id: string;
  original_base_filename: string;
  created_at: string;
}

interface PhotoCompareViewProps {
  albumId: string;
  left: ComparePhoto;
  right: ComparePhoto;
  onClose: () => void;
  isSelected: (photoId: string) => boolean;
  onToggleSelect: (photoId: string) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("vi-VN");
}

export default function PhotoCompareView({
  albumId,
  left,
  right,
  onClose,
  isSelected,
  onToggleSelect,
}: PhotoCompareViewProps) {
  useEscapeKey(onClose);
  const [synced, setSynced] = useState(true);
  const [sharedTransform, setSharedTransform] = useState<Transform>(IDENTITY);
  const [leftTransform, setLeftTransform] = useState<Transform>(IDENTITY);
  const [rightTransform, setRightTransform] = useState<Transform>(IDENTITY);
  const dragState = useRef<{ startX: number; startY: number; origin: { x: number; y: number } } | null>(
    null
  );

  function getTransform(side: "left" | "right"): Transform {
    if (synced) return sharedTransform;
    return side === "left" ? leftTransform : rightTransform;
  }

  function setTransform(side: "left" | "right", updater: (prev: Transform) => Transform) {
    if (synced) {
      setSharedTransform(updater);
    } else if (side === "left") {
      setLeftTransform(updater);
    } else {
      setRightTransform(updater);
    }
  }

  function handlePointerDown(side: "left" | "right", e: ReactPointerEvent<HTMLDivElement>) {
    if (getTransform(side).scale <= 1) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origin: getTransform(side) };
  }

  function handlePointerMove(side: "left" | "right", e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    const origin = dragState.current.origin;
    setTransform(side, (prev) => ({ ...prev, x: origin.x + dx, y: origin.y + dy }));
  }

  function handlePointerUp() {
    dragState.current = null;
  }

  function zoomBy(side: "left" | "right", delta: number) {
    setTransform(side, (prev) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale + delta));
      return nextScale === MIN_SCALE ? IDENTITY : { ...prev, scale: nextScale };
    });
  }

  function toggleSynced() {
    setSynced((prev) => {
      const next = !prev;
      // Đồng bộ lại khung nhìn 2 bên về đúng 1 trạng thái ngay lúc bật, tránh 1 bên đang zoom
      // to còn bên kia đứng yên gây lệch đột ngột.
      if (next) setSharedTransform(IDENTITY);
      else {
        setLeftTransform(IDENTITY);
        setRightTransform(IDENTITY);
      }
      return next;
    });
  }

  function photoUrl(photoId: string) {
    return `${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photoId}/view`;
  }

  const panels: { side: "left" | "right"; photo: ComparePhoto; label: string }[] = [
    { side: "left", photo: left, label: "Chọn trái" },
    { side: "right", photo: right, label: "Chọn phải" },
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label="So sánh hai ảnh" className="fixed inset-0 z-50 flex flex-col bg-zinc-950">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-zinc-900 px-6">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-zinc-400 hover:text-zinc-100"
        >
          ← Quay lại xem lưới
        </button>
        <div className="text-center">
          <p className="text-lg font-semibold text-zinc-100">So sánh chi tiết</p>
          <p className="text-xs text-zinc-500">Chọn 1 trong 2 ảnh để giữ lại</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">Đồng bộ Zoom/Pan</span>
          <button
            type="button"
            role="switch"
            aria-checked={synced}
            aria-label="Đồng bộ Zoom/Pan giữa hai ảnh"
            onClick={toggleSynced}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              synced ? "bg-indigo-500" : "bg-zinc-700"
            }`}
          >
            <span
              className={`inline-block size-5 transform rounded-full bg-white transition-transform ${
                synced ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-px overflow-hidden bg-zinc-700">
        {panels.map(({ side, photo, label }) => {
          const transform = getTransform(side);
          const selected = isSelected(photo.id);
          return (
            <div key={photo.id} className="flex flex-1 flex-col bg-zinc-950">
              <div
                className="relative flex-1 overflow-hidden"
                style={{ cursor: transform.scale > 1 ? "grab" : "default" }}
                onPointerDown={(e) => handlePointerDown(side, e)}
                onPointerMove={(e) => handlePointerMove(side, e)}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                <img
                  src={photoUrl(photo.id)}
                  alt={photo.original_base_filename}
                  draggable={false}
                  className="h-full w-full select-none object-contain"
                  style={{
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                    transformOrigin: "center center",
                  }}
                />
                <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900/90 px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => zoomBy(side, -0.5)}
                    aria-label="Thu nhỏ"
                    disabled={transform.scale <= MIN_SCALE}
                    className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-9 text-center text-xs tabular-nums text-zinc-400">
                    {transform.scale.toFixed(1)}x
                  </span>
                  <button
                    type="button"
                    onClick={() => zoomBy(side, 0.5)}
                    aria-label="Phóng to"
                    disabled={transform.scale >= MAX_SCALE}
                    className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 bg-zinc-900 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-100">{photo.original_base_filename}</p>
                  <p className="text-xs text-zinc-500">Ngày chụp: {formatDate(photo.created_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleSelect(photo.id)}
                  className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold ${
                    selected
                      ? "border-indigo-500 bg-indigo-500 text-white"
                      : "border-white/10 text-zinc-100 hover:bg-zinc-800"
                  }`}
                >
                  {selected ? "✓ Đã chọn" : label}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
