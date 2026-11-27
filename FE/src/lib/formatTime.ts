/** "vừa xong", "5 phút trước", "3 giờ trước", "2 ngày trước", rồi ngày cụ thể sau 7 ngày. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Thời gian còn lại tới hạn, dạng ngắn: "còn 3 ngày", "còn 5 giờ", "còn 12 phút", "đã quá hạn". */
export function formatTimeUntil(iso: string, now = Date.now()): string {
  const diffMs = new Date(iso).getTime() - now;
  if (diffMs <= 0) return "đã quá hạn";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `còn ${Math.max(1, minutes)} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `còn ${hours} giờ`;
  return `còn ${Math.floor(hours / 24)} ngày`;
}

/** Chữ cái đầu của tên (tối đa 2) cho ảnh đại diện: "Trần Thảo" → "TT". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 1) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}
