// Trạng thái hiển thị của album — dùng chung cho danh sách và trang chi tiết album,
// để 2 nơi không lệch nhau (trước đây trang chi tiết hiện "Đã khóa" cho cả album lưu trữ).
import type { Album } from "./types";

export function deadlineDays(deadline: string | null) {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
}

export function getAlbumStatusBadge(album: Album) {
  if (album.status === "archived") {
    return {
      label: "LƯU TRỮ",
      className: "border-white/10 bg-zinc-800/80 text-zinc-300",
      dot: "bg-zinc-400",
    };
  }
  if (album.is_locked) {
    return {
      label: "ĐÃ KHÓA",
      className: "border-rose-500/30 bg-rose-950/60 text-rose-300",
      dot: "bg-rose-400",
    };
  }
  const days = deadlineDays(album.selection_deadline);
  if (days !== null && days <= 3) {
    return {
      label: days <= 0 ? "HẾT HẠN" : "SẮP HẾT HẠN",
      className: "border-amber-500/30 bg-amber-950/60 text-amber-300",
      dot: "bg-amber-400",
    };
  }
  return {
    label: "ĐANG MỞ",
    className: "border-emerald-500/30 bg-emerald-950/60 text-emerald-300",
    dot: "bg-emerald-400",
  };
}

