// Bước 2.3 — xem 2 ảnh cạnh nhau, phóng to/kéo đồng bộ (bật/tắt được qua "Đồng bộ Zoom/Pan").
// Mỗi ảnh vẫn tải qua đúng URL /view hiện có (proxy watermark theo phiên khách đang đăng
// nhập) — không có xử lý watermark riêng ở đây, tự động đúng theo từng khách.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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
    <div className="fixed inset-0 z-50 flex flex-col bg-[#131313]">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#43474f] bg-[#1c1b1b] px-6">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-[#c1c6d4] hover:text-[#e5e2e1]"
        >
          ← Quay lại xem lưới
        </button>
        <div className="text-center">
          <p className="text-lg font-semibold text-[#e5e2e1]">So sánh chi tiết</p>
          <p className="text-xs text-[#8b919e]">Chọn 1 trong 2 ảnh để giữ lại</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#c1c6d4]">Đồng bộ Zoom/Pan</span>
          <button
            type="button"
            role="switch"
            aria-checked={synced}
            onClick={toggleSynced}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              synced ? "bg-[#a9c7ff]" : "bg-[#43474f]"
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

      <div className="flex flex-1 gap-px overflow-hidden bg-[#43474f]">
        {panels.map(({ side, photo, label }) => {
          const transform = getTransform(side);
          const selected = isSelected(photo.id);
          return (
            <div key={photo.id} className="flex flex-1 flex-col bg-[#131313]">
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
                <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-[4px] border border-[#43474f] bg-[#1c1b1b]/90 px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => zoomBy(side, -0.5)}
                    disabled={transform.scale <= MIN_SCALE}
                    className="flex size-6 items-center justify-center rounded text-[#c1c6d4] hover:bg-[#2a2a2a] disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-9 text-center text-xs text-[#c1c6d4]">
                    {transform.scale.toFixed(1)}x
                  </span>
                  <button
                    type="button"
                    onClick={() => zoomBy(side, 0.5)}
                    disabled={transform.scale >= MAX_SCALE}
                    className="flex size-6 items-center justify-center rounded text-[#c1c6d4] hover:bg-[#2a2a2a] disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-[#43474f] bg-[#1c1b1b] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-[#e5e2e1]">{photo.original_base_filename}</p>
                  <p className="text-xs text-[#8b919e]">Ngày chụp: {formatDate(photo.created_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleSelect(photo.id)}
                  className={`shrink-0 rounded-[4px] border px-4 py-2 text-sm font-semibold ${
                    selected
                      ? "border-[#a9c7ff] bg-[#a9c7ff] text-white"
                      : "border-[#43474f] text-[#e5e2e1] hover:bg-[#2a2a2a]"
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
