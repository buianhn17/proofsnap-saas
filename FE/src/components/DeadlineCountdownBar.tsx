// Bước 2.1 — thanh đếm ngược luôn hiển thị trên mọi trang Client Portal đã xác thực PIN
// (gắn ở ClientAlbumScope trong router.tsx, bọc ngoài mọi route con). Tick mỗi giây dựa trên
// estimatedServerNow (giờ server ước tính, xem ClientAlbumContext.tsx) — không đọc thẳng
// Date.now() để tránh lệch nếu khách chỉnh giờ máy.
import { useEffect, useState } from "react";
import { estimatedServerNow, useClientAlbum } from "../contexts/clientAlbum";
import { formatCountdown } from "../lib/formatCountdown";

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
      <div role="status" className="mb-6 rounded-xl border border-rose-500/30 bg-rose-950/60 px-4 py-2 text-center text-sm font-medium text-rose-300">
        Album đã bị khóa — không thể thả tim hoặc thêm ghi chú mới.
      </div>
    );
  }

  if (!album.selection_deadline) {
    return (
      <div className="mb-6 rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-2 text-center text-xs text-zinc-400">
        Không giới hạn thời gian chọn ảnh
      </div>
    );
  }

  const remainingMs = Date.parse(album.selection_deadline) - estimatedServerNow(serverOffsetMs);
  const expired = remainingMs <= 0;

  const deadlineText = new Date(album.selection_deadline).toLocaleString("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div
      role="timer"
      aria-label={expired ? "Đã hết hạn chọn ảnh" : `Hạn chọn ảnh: ${deadlineText}`}
      className={`mb-6 rounded-xl border px-4 py-2 text-center text-sm font-medium text-balance ${
        expired
          ? "border-rose-500/30 bg-rose-950/60 text-rose-300"
          : remainingMs < 5 * 60 * 1000
            ? "border-amber-500/30 bg-amber-950/60 text-amber-200"
            : "border-white/10 bg-zinc-900/60 text-zinc-300"
      }`}
    >
      {expired
        ? "Đã hết hạn chọn ảnh — không thể thả tim hoặc thêm ghi chú mới."
        : (
            <>
              Còn <span className="whitespace-nowrap font-semibold tabular-nums">{formatCountdown(remainingMs)}</span> để chọn ảnh
              <span className="ml-1 hidden text-xs font-normal text-zinc-400 sm:inline">(hạn {deadlineText})</span>
            </>
          )}
    </div>
  );
}
