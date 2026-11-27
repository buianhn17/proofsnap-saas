/**
 * Định dạng thời gian còn lại cho thanh đếm ngược hạn chọn ảnh.
 *   ≥ 24 giờ : "X ngày HH:MM:SS"   (VD 934 giờ → "38 ngày 22:51:13")
 *   ≥ 1 giờ  : "H:MM:SS"
 *   < 1 giờ  : "M:SS"
 * Giá trị âm (đã quá hạn) được coi là 0.
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (days > 0) return `${days} ngày ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}
