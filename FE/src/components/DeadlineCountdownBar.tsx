// Bước 2.1 — thanh đếm ngược luôn hiển thị trên mọi trang Client Portal đã xác thực PIN
// (gắn ở ClientAlbumScope trong router.tsx, bọc ngoài mọi route con). Tick mỗi giây dựa trên
// estimatedServerNow (giờ server ước tính, xem ClientAlbumContext.tsx) — không đọc thẳng
// Date.now() để tránh lệch nếu khách chỉnh giờ máy.
import { useEffect, useState } from "react";
import { estimatedServerNow, useClientAlbum } from "../contexts/ClientAlbumContext";

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

export default function DeadlineCountdownBar() {
  const { album, serverOffsetMs } = useClientAlbum();
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!album) return null;

  if (album.is_locked) {
    return (
      <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-center text-sm font-medium text-red-700">
        Album đã bị khóa — không thể thả tim hoặc thêm ghi chú mới.
      </div>
    );
  }

  if (!album.selection_deadline) {
    return (
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-2 text-center text-xs text-slate-500">
        Không giới hạn thời gian chọn ảnh
      </div>
    );
  }

  const remainingMs = Date.parse(album.selection_deadline) - estimatedServerNow(serverOffsetMs);
  const expired = remainingMs <= 0;

  return (
    <div
      className={`border-b px-6 py-2 text-center text-sm font-medium ${
        expired
          ? "border-red-200 bg-red-50 text-red-700"
          : remainingMs < 5 * 60 * 1000
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {expired
        ? "Đã hết hạn chọn ảnh — không thể thả tim hoặc thêm ghi chú mới."
        : `Còn ${formatRemaining(remainingMs)} để chọn ảnh`}
    </div>
  );
}
