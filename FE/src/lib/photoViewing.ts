// Tiện ích dùng chung cho lưới ảnh + trình xem ảnh phía khách.
import { flushSync } from "react-dom";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export type PublicPhotoSize = "thumb" | "preview";

export function publicPhotoUrl(albumId: string, photoId: string, size: PublicPhotoSize): string {
  return `${API_BASE_URL}/api/public/albums/${albumId}/photos/${photoId}/view?size=${size}`;
}

/** Tên view-transition chung giữa ô lưới và ảnh trong trình xem — để ảnh "phóng" ra từ ô. */
export function photoTransitionName(photoId: string): string {
  return `photo-${photoId}`;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Chạy cập nhật state trong View Transition nếu trình duyệt hỗ trợ (Chrome/Edge, Safari 18+)
 * và người dùng không bật giảm chuyển động; không thì cập nhật thẳng.
 */
export function runViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

/** Rung nhẹ xác nhận thao tác (Android; iOS Safari bỏ qua). */
export function tapFeedback() {
  navigator.vibrate?.(8);
}
