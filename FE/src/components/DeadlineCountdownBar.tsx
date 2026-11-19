// Bước 2.1 — thanh đếm ngược luôn hiển thị trên mọi trang Client Portal đã xác thực PIN
// (gắn ở ClientAlbumScope trong router.tsx, bọc ngoài mọi route con). Tick mỗi giây dựa trên
// estimatedServerNow (giờ server ước tính, xem ClientAlbumContext.tsx) — không đọc thẳng
// Date.now() để tránh lệch nếu khách chỉnh giờ máy.
import { useEffect, useState } from "react";
import { estimatedServerNow, useClientAlbum } from "../contexts/ClientAlbumContext";
import { ClockIcon } from "./Icons";

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
      <div className="mb-4 flex w-fit max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium sm:mb-6 border-rose-500/30 bg-rose-950/60 text-rose-300">
        <ClockIcon size={13} className="shrink-0" />
        Album đã khóa — chỉ xem, không chọn thêm được
      </div>
    );
  }

  if (!album.selection_deadline) {
    return (
      <div className="mb-4 flex w-fit max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium sm:mb-6 border-white/10 bg-zinc-900/60 text-zinc-400">
        <ClockIcon size={13} className="shrink-0" />
        Không giới hạn thời gian chọn ảnh
      </div>
    );
  }

  const remainingMs = Date.parse(album.selection_deadline) - estimatedServerNow(serverOffsetMs);
  const expired = remainingMs <= 0;

  return (
    <div
      className={`mb-4 flex w-fit max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium sm:mb-6 ${
        expired
          ? "border-rose-500/30 bg-rose-950/60 text-rose-300"
          : remainingMs < 5 * 60 * 1000
            ? "border-amber-500/30 bg-amber-950/60 text-amber-200"
            : "border-white/10 bg-zinc-900/60 text-zinc-300"
      }`}
    >
      <ClockIcon size={13} className="shrink-0" />
      {expired
        ? "Đã hết hạn chọn ảnh — chỉ xem, không chọn thêm được"
        : (
            <>
              Còn <span className="font-semibold tabular-nums">{formatRemaining(remainingMs)}</span> để chọn ảnh
            </>
          )}
    </div>
  );
}
