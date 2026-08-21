// Bước 2.1 — fetch album công khai (Client Portal) 1 lần, chia sẻ qua Context cho mọi
// trang con trong /a/:albumId/* (gallery, lightbox ghi chú, so sánh...), thay vì mỗi trang
// tự fetch riêng như AlbumGalleryPage.tsx làm trước đây. Đi kèm serverOffsetMs — chênh lệch
// giữa giờ server (server_time BE trả về) và giờ máy khách lúc fetch — để đồng hồ đếm ngược
// không phụ thuộc vào giờ hệ thống của trình duyệt khách (BE vẫn là nơi chốt hạn thật qua
// albumDeadlineMiddleware.js).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { api } from "../lib/api";

export interface PublicAlbum {
  id: string;
  name: string;
  watermark_enabled: boolean;
  selection_deadline: string | null;
  is_locked: boolean;
}

interface ClientAlbumContextValue {
  album: PublicAlbum | null;
  isLoading: boolean;
  serverOffsetMs: number;
  refetch: () => Promise<void>;
}

const ClientAlbumContext = createContext<ClientAlbumContextValue | null>(null);

export function ClientAlbumProvider({ children }: { children: ReactNode }) {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<PublicAlbum | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  const refetch = useCallback(async () => {
    if (!albumId) return;
    try {
      const { data } = await api.get<{ album: PublicAlbum; server_time: string }>(
        `/api/public/albums/${albumId}`
      );
      setAlbum(data.album);
      setServerOffsetMs(Date.parse(data.server_time) - Date.now());
    } catch (err) {
      if (
        isAxiosError(err) &&
        (err.response?.status === 401 || err.response?.status === 403)
      ) {
        navigate(`/a/${albumId}`, { replace: true });
        return;
      }
    } finally {
      setIsLoading(false);
    }
  }, [albumId, navigate]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return (
    <ClientAlbumContext.Provider value={{ album, isLoading, serverOffsetMs, refetch }}>
      {children}
    </ClientAlbumContext.Provider>
  );
}

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
