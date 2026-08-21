// Bước 2.3 — xem 2 ảnh cạnh nhau, phóng to/kéo đồng bộ. Cả 2 <img> dùng chung 1 state
// {scale, translateX, translateY} áp transform giống hệt nhau nên luôn khớp khung nhìn.
// Mỗi ảnh vẫn tải qua đúng URL /view hiện có (proxy watermark theo phiên khách đang đăng
// nhập) — không có xử lý watermark riêng ở đây, tự động đúng theo từng khách.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

interface ComparePhoto {
  id: string;
  original_base_filename: string;
}

interface PhotoCompareViewProps {
  albumId: string;
  left: ComparePhoto;
  right: ComparePhoto;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export default function PhotoCompareView({
  albumId,
  left,
  right,
  onClose,
}: PhotoCompareViewProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; origin: { x: number; y: number } } | null>(
    null
  );

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (scale <= 1) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origin: translate };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setTranslate({ x: dragState.current.origin.x + dx, y: dragState.current.origin.y + dy });
  }

  function handlePointerUp() {
    dragState.current = null;
  }

  function zoomBy(delta: number) {
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + delta));
      if (next === MIN_SCALE) setTranslate({ x: 0, y: 0 });
      return next;
    });
  }

  const imageStyle = {
    transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
    transformOrigin: "center center",
  };

  function photoUrl(photoId: string) {
    return `${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photoId}/view`;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-200">
        <button type="button" onClick={onClose} className="hover:text-white">
          ← Đóng so sánh
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => zoomBy(-0.5)}
            disabled={scale <= MIN_SCALE}
            className="rounded-md border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40"
          >
            − Thu nhỏ
          </button>
          <span className="w-12 text-center text-xs text-slate-400">
            {scale.toFixed(1)}x
          </span>
          <button
            type="button"
            onClick={() => zoomBy(0.5)}
            disabled={scale >= MAX_SCALE}
            className="rounded-md border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40"
          >
            + Phóng to
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-1 overflow-hidden px-1 pb-4">
        {[left, right].map((photo) => (
          <div
            key={photo.id}
            className="relative flex-1 overflow-hidden bg-slate-950"
            style={{ cursor: scale > 1 ? "grab" : "default" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <img
              src={photoUrl(photo.id)}
              alt={photo.original_base_filename}
              draggable={false}
              className="h-full w-full select-none object-contain"
              style={imageStyle}
            />
            <span className="absolute bottom-2 left-2 truncate rounded bg-black/60 px-2 py-1 text-xs text-slate-200">
              {photo.original_base_filename}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
