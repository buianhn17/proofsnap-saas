import { useEffect, useMemo, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { useClientAlbum, useIsAlbumExpired } from "../../contexts/ClientAlbumContext";
import PhotoAnnotationLightbox from "../../components/PhotoAnnotationLightbox";
import PhotoCompareView from "../../components/PhotoCompareView";

interface PublicPhoto {
  id: string;
  original_base_filename: string;
  width: number | null;
  height: number | null;
  created_at: string;
  // Bước 2.3 (nền) — null nếu ảnh không thuộc cụm burst nào (culling không gom được, hoặc
  // upload thủ công không qua AI Culling).
  burst_cluster_id: string | null;
}

const GRID_GAP_PX = 12;

function useColumnCount(containerWidth: number): number {
  if (containerWidth === 0) return 2;
  if (containerWidth < 640) return 2;
  if (containerWidth < 768) return 3;
  return 4;
}

export default function AlbumGalleryPage() {
  const { album, refetch } = useClientAlbum();
  const expired = useIsAlbumExpired();
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);

  const albumId = album?.id ?? null;

  useEffect(() => {
    if (!albumId) return;
    api
      .get<{ photos: PublicPhoto[] }>(`/api/public/albums/${albumId}/photos`)
      .then(({ data }) => setPhotos(data.photos))
      .catch((err) => {
        if (
          isAxiosError(err) &&
          (err.response?.status === 401 || err.response?.status === 403)
        ) {
          return; // ClientAlbumContext đã lo redirect về trang PIN.
        }
        setError(getErrorMessage(err, "Không tải được danh sách ảnh"));
      });
  }, [albumId]);

  async function toggleHeart(photoId: string) {
    if (!albumId || expired) return;
    try {
      const { data } = await api.post<{ selected: boolean }>(
        `/api/public/albums/${albumId}/photos/${photoId}/select`
      );
      setSelected((prev) => {
        const next = new Set(prev);
        if (data.selected) next.add(photoId);
        else next.delete(photoId);
        return next;
      });
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 403) {
        refetch();
      }
      // Bỏ qua lỗi 1 lượt thả tim, không chặn xem ảnh còn lại.
    }
  }

  function handleCardClick(photo: PublicPhoto) {
    if (compareMode) {
      setCompareSelection((prev) => {
        if (prev.includes(photo.id)) return prev.filter((id) => id !== photo.id);
        if (prev.length >= 2) return prev;
        return [...prev, photo.id];
      });
      return;
    }
    setOpenPhotoId(photo.id);
  }

  // Bước 2.4 — virtualize theo hàng (chỉ render vài hàng quanh viewport) để album vài nghìn
  // ảnh không mount toàn bộ <img> cùng lúc. useWindowVirtualizer dùng scroll của window nên
  // trải nghiệm cuộn trang không đổi so với lưới CSS thường trước đây.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = useColumnCount(containerWidth);
  const itemSize =
    containerWidth > 0 ? (containerWidth - GRID_GAP_PX * (columns - 1)) / columns : 0;
  const rowHeight = itemSize > 0 ? itemSize + GRID_GAP_PX : 160;
  const rowCount = Math.ceil(photos.length / columns);

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  const compareTargets = useMemo(
    () => photos.filter((p) => compareSelection.includes(p.id)),
    [photos, compareSelection]
  );

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }

  if (!album) {
    return <p className="text-sm text-slate-500">Đang tải...</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">{album.name}</h1>
        <button
          type="button"
          onClick={() => {
            setCompareMode((prev) => !prev);
            setCompareSelection([]);
          }}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            compareMode
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-300 text-slate-700 hover:bg-slate-50"
          }`}
        >
          {compareMode ? "Đang chọn ảnh để so sánh" : "So sánh 2 ảnh"}
        </button>
      </div>

      {compareMode && compareSelection.length < 2 && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          Chọn 2 ảnh ({compareSelection.length}/2 đã chọn) — công cụ so sánh sẽ tự mở khi
          chọn đủ 2 ảnh.
        </div>
      )}

      {photos.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          Chưa có ảnh nào trong album.
        </p>
      ) : (
        <div
          ref={containerRef}
          className="relative mt-6"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowPhotos = photos.slice(
              virtualRow.index * columns,
              virtualRow.index * columns + columns
            );
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex gap-3"
              >
                {rowPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    style={{ width: itemSize || undefined }}
                    className="relative shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => handleCardClick(photo)}
                      className="block w-full"
                    >
                      <img
                        src={`${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photo.id}/view`}
                        alt={photo.original_base_filename}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                    </button>

                    {photo.burst_cluster_id && (
                      <span className="absolute left-2 top-2 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        Cụm ảnh giống
                      </span>
                    )}

                    {compareMode ? (
                      <span
                        className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold shadow ${
                          compareSelection.includes(photo.id)
                            ? "bg-slate-900 text-white"
                            : "bg-white/90 text-slate-500"
                        }`}
                      >
                        {compareSelection.includes(photo.id) ? "✓" : "+"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleHeart(photo.id)}
                        disabled={expired}
                        aria-label="Thả tim"
                        title={expired ? "Đã hết hạn chọn ảnh" : "Thả tim"}
                        className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-lg shadow disabled:cursor-not-allowed disabled:opacity-50 ${
                          selected.has(photo.id)
                            ? "bg-red-500 text-white"
                            : "bg-white/90 text-slate-500"
                        }`}
                      >
                        ♥
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {openPhotoId && albumId && (
        <PhotoAnnotationLightbox
          albumId={albumId}
          photoId={openPhotoId}
          photoName={
            photos.find((p) => p.id === openPhotoId)?.original_base_filename ?? ""
          }
          onClose={() => setOpenPhotoId(null)}
        />
      )}

      {compareSelection.length === 2 && compareTargets.length === 2 && albumId && (
        <PhotoCompareView
          albumId={albumId}
          left={compareTargets[0]}
          right={compareTargets[1]}
          onClose={() => {
            setCompareMode(false);
            setCompareSelection([]);
          }}
        />
      )}
    </div>
  );
}
