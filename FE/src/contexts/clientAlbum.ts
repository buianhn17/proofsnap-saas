// Bước 2.1 — fetch album công khai (Client Portal) 1 lần, chia sẻ qua Context cho mọi
// trang con trong /a/:albumId/* (gallery, lightbox ghi chú, so sánh...), thay vì mỗi trang
// tự fetch riêng như AlbumGalleryPage.tsx làm trước đây. Đi kèm serverOffsetMs — chênh lệch
// giữa giờ server (server_time BE trả về) và giờ máy khách lúc fetch — để đồng hồ đếm ngược
// không phụ thuộc vào giờ hệ thống của trình duyệt khách (BE vẫn là nơi chốt hạn thật qua
// albumDeadlineMiddleware.js).

import { createContext, useContext, useEffect, useState } from "react";

export interface PublicAlbum {
  id: string;
  name: string;
  watermark_enabled: boolean;
  selection_deadline: string | null;
  is_locked: boolean;
  // Bước 4.2 — true khi PTG đã "mở khóa tải" ZIP ảnh hoàn thiện cho album này.
  download_zip_unlocked: boolean;
  // FR-07 — số ảnh tối đa mỗi khách được chọn; null = không giới hạn.
  max_selectable_photos: number | null;
}

export interface ClientAlbumContextValue {
  album: PublicAlbum | null;
  /** Mục 5.2 — mốc khách xác nhận hoàn tất chọn ảnh theo lần tải album gần nhất. */
  completedAt: string | null;
  isLoading: boolean;
  serverOffsetMs: number;
  refetch: () => Promise<void>;
}

export const ClientAlbumContext = createContext<ClientAlbumContextValue | null>(null);

export function useClientAlbum() {
  const ctx = useContext(ClientAlbumContext);
  if (!ctx) {
    throw new Error("useClientAlbum phải được dùng bên trong ClientAlbumProvider");
  }
  return ctx;
}

/** Giờ server ước tính tại thời điểm gọi (không phải lúc fetch) — dùng cho tick đếm ngược. */
export function estimatedServerNow(serverOffsetMs: number): number {
  return Date.now() + serverOffsetMs;
}

export function isAlbumExpired(
  album: PublicAlbum | null,
  serverOffsetMs: number
): boolean {
  if (!album) return false;
  if (album.is_locked) return true;
  if (!album.selection_deadline) return false;
  return estimatedServerNow(serverOffsetMs) >= Date.parse(album.selection_deadline);
}

/** Bước 2.1 — hook tiện dụng cho các nút hành động (thả tim, vẽ ghi chú) cần tự disable
 * đúng lúc hết hạn mà không phải tự quản lý interval riêng. */
export function useIsAlbumExpired(): boolean {
  const { album, serverOffsetMs } = useClientAlbum();
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return isAlbumExpired(album, serverOffsetMs);
}
