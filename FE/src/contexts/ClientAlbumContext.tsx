import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { api } from "../lib/api";

import { ClientAlbumContext, type PublicAlbum } from "./clientAlbum";

interface AlbumResponse {
  album: PublicAlbum;
  server_time: string;
  completion: { completed_at: string } | null;
}

export function ClientAlbumProvider({ children }: { children: ReactNode }) {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<PublicAlbum | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [completedAt, setCompletedAt] = useState<string | null>(null);

  // Tải album rồi áp vào state. Gọi được từ effect (lần đầu) lẫn từ sự kiện (refetch) — mọi
  // setState đều nằm sau await, không chạy đồng bộ trong effect.
  const load = useCallback(
    (isCancelled: () => boolean = () => false) => {
      if (!albumId) return Promise.resolve();
      return api
        .get<AlbumResponse>(`/api/public/albums/${albumId}`)
        .then(({ data }) => {
          if (isCancelled()) return;
          setAlbum(data.album);
          setCompletedAt(data.completion?.completed_at ?? null);
          setServerOffsetMs(Date.parse(data.server_time) - Date.now());
        })
        .catch((err) => {
          if (isCancelled()) return;
          if (isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
            navigate(`/a/${albumId}`, { replace: true });
          }
        })
        .finally(() => {
          if (!isCancelled()) setIsLoading(false);
        });
    },
    [albumId, navigate]
  );

  const refetch = useCallback(() => load(), [load]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <ClientAlbumContext.Provider value={{ album, completedAt, isLoading, serverOffsetMs, refetch }}>
      {children}
    </ClientAlbumContext.Provider>
  );
}
