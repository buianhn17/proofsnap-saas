import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useSearchParams } from "react-router-dom";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { useClientAlbum, useIsAlbumExpired } from "../../contexts/ClientAlbumContext";
import PhotoAnnotationLightbox from "../../components/PhotoAnnotationLightbox";
import PhotoCompareView from "../../components/PhotoCompareView";
import BatchDownloadModal, {
  type DownloadQuality,
  type DownloadablePhoto,
} from "../../components/BatchDownloadModal";
import { isMobileDevice } from "../../lib/mobileDownloadService";

interface PublicPhoto {
  id: string;
  original_base_filename: string;
  width: number | null;
  height: number | null;
  created_at: string;
  // Bước 2.3 (nền) — null nếu ảnh không thuộc cụm burst nào (culling không gom được, hoặc
  // upload thủ công không qua AI Culling).
  burst_cluster_id: string | null;
  // true nếu đây là ảnh AI chọn làm đại diện tốt nhất trong cụm burst_cluster_id — chỉ có ý
  // nghĩa khi burst_cluster_id khác null.
  is_best_in_cluster: boolean;
}

type FilterKey = "all" | "suggested" | "bursts";

// GET /api/public/albums/:albumId/downloads — tập ảnh hoàn thiện (giống nội dung ZIP).
interface DownloadListResponse {
  mode: "per_photo" | "zip_only";
  photos: { id: string; filename: string }[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const GRID_GAP_PX = 12;
const PAGE_SIZE = 24;

function useColumnCount(containerWidth: number): number {
  if (containerWidth === 0) return 2;
  if (containerWidth < 640) return 2;
  if (containerWidth < 768) return 3;
  return 4;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

export default function AlbumGalleryPage() {
  const { album, refetch } = useClientAlbum();
  const expired = useIsAlbumExpired();
  const [searchParams] = useSearchParams();
  const showLikedOnly = searchParams.get("view") === "liked";
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);

  const albumId = album?.id ?? null;

  // Tải ảnh hoàn thiện: PC giữ link ZIP như cũ; điện thoại mở BatchDownloadModal để lưu thẳng
  // vào Thư viện ảnh theo từng nhóm 10 ảnh.
  const isMobile = useMemo(() => isMobileDevice(), []);
  const [downloadList, setDownloadList] = useState<{ id: string; filename: string }[] | null>(
    null
  );
  const [downloadQuality, setDownloadQuality] = useState<DownloadQuality>("original");
  const [isLoadingDownloads, setIsLoadingDownloads] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const zipUrl = `${API_BASE_URL}/api/public/albums/${albumId}/download-zip`;

  const downloadablePhotos = useMemo<DownloadablePhoto[]>(
    () =>
      (downloadList ?? []).map((p) => ({
        id: p.id,
        filename: p.filename,
        url: `${API_BASE_URL}/api/public/albums/${albumId}/photos/${p.id}/download?quality=${downloadQuality}`,
      })),
    [downloadList, downloadQuality, albumId]
  );

  async function openMobileDownload() {
    if (!albumId) return;
    setIsLoadingDownloads(true);
    setDownloadError(null);
    try {
      const { data } = await api.get<DownloadListResponse>(
        `/api/public/albums/${albumId}/downloads`
      );
      if (data.mode === "zip_only") {
        // PTG đã upload ZIP hậu kỳ riêng — ảnh trong đó khác ảnh gốc, chỉ có thể tải ZIP.
        window.location.assign(zipUrl);
        return;
      }
      setDownloadList(data.photos);
    } catch (err) {
      setDownloadError(getErrorMessage(err, "Không lấy được danh sách ảnh để tải"));
    } finally {
      setIsLoadingDownloads(false);
    }
  }

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

  const filteredPhotos = useMemo(() => {
    let result = photos;
    if (showLikedOnly) result = result.filter((p) => selected.has(p.id));
    if (filter === "suggested") result = result.filter((p) => p.is_best_in_cluster);
    if (filter === "bursts") result = result.filter((p) => p.burst_cluster_id !== null);
    return result;
  }, [photos, showLikedOnly, filter, selected]);

  // Bước — chỉ render `visibleCount` ảnh đầu, tự tăng dần khi khách lướt gần tới cuối lưới
  // (IntersectionObserver theo dõi sentinel cuối trang), thay vì luôn virtualize toàn bộ
  // hàng nghìn ảnh cùng lúc ngay khi vào trang.
  const visiblePhotos = filteredPhotos.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPhotos.length;

  // Dùng ref dạng callback (thay useRef) vì sentinel chỉ mount khi hasMore === true — nếu
  // dùng useRef + effect deps rỗng, observer sẽ được gắn (hoặc không) đúng 1 lần lúc mount,
  // có thể là lúc sentinel chưa tồn tại, và không bao giờ gắn lại được nữa.
  const [sentinelNode, setSentinelNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sentinelNode || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => c + PAGE_SIZE);
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(sentinelNode);
    return () => observer.disconnect();
  }, [sentinelNode, hasMore]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [showLikedOnly, filter]);

  // Bước 2.4 — virtualize theo hàng (chỉ render vài hàng quanh viewport) để album vài nghìn
  // ảnh không mount toàn bộ <img> cùng lúc. useWindowVirtualizer dùng scroll của window nên
  // trải nghiệm cuộn trang không đổi so với lưới CSS thường trước đây.
  // Bước fix — div này chỉ mount SAU KHI ảnh tải xong (nhánh rỗng render trước đó không có
  // div để đo), nên dùng ref dạng callback thay vì useRef+effect deps rỗng: effect deps rỗng
  // chạy đúng 1 lần lúc mount, khi div còn chưa tồn tại, khiến ResizeObserver không bao giờ
  // được gắn và containerWidth mãi mãi bằng 0 (lưới ảnh kẹt ở fallback 2 cột).
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerNode) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(containerNode);
    return () => observer.disconnect();
  }, [containerNode]);

  const columns = useColumnCount(containerWidth);
  const itemSize =
    containerWidth > 0 ? (containerWidth - GRID_GAP_PX * (columns - 1)) / columns : 0;
  const rowHeight = itemSize > 0 ? itemSize + GRID_GAP_PX : 160;
  const rowCount = Math.ceil(visiblePhotos.length / columns);

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  const compareTargets = useMemo(
    () => photos.filter((p) => compareSelection.includes(p.id)),
    [photos, compareSelection]
  );

  const lastUpdatedAt = useMemo(() => {
    if (photos.length === 0) return null;
    return photos.reduce(
      (latest, p) => (new Date(p.created_at) > new Date(latest) ? p.created_at : latest),
      photos[0].created_at
    );
  }, [photos]);

  if (error) {
    return (
      <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
        {error}
      </p>
    );
  }

  if (!album) {
    return <p className="text-sm text-[#c1c6d4]">Đang tải...</p>;
  }

  return (
    <div>
      <h1 className="text-[32px] font-semibold tracking-[-0.32px] text-[#e5e2e1]">
        {album.name}
      </h1>
      <p className="mt-2 max-w-2xl text-base text-[#c1c6d4]">
        Duyệt qua tất cả các khoảnh khắc từ sự kiện. Sử dụng công cụ lọc để tìm kiếm dễ dàng hơn.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-[#43474f] bg-[#1c1b1b] px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-[#e5e2e1]">
            🖼 Tổng quan sự kiện
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-4 text-sm text-[#c1c6d4]">
            <span>📷 {photos.length} Ảnh</span>
            {lastUpdatedAt && <span>🕐 Cập nhật {formatRelativeTime(lastUpdatedAt)}</span>}
            <span>❤️ Đã chọn: {selected.size}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
            className="rounded-[4px] border border-[#43474f] bg-[#131313] px-3 py-2 text-sm text-[#e5e2e1] focus:outline-none focus:ring-1 focus:ring-[#a9c7ff]"
          >
            <option value="all">Tất cả ảnh</option>
            <option value="suggested">Ảnh gợi ý AI</option>
            <option value="bursts">Cụm ảnh giống nhau</option>
          </select>
          {album.download_zip_unlocked &&
            (isMobile ? (
              <button
                type="button"
                onClick={openMobileDownload}
                disabled={isLoadingDownloads}
                className="rounded-[4px] border border-[#2d6a3f] bg-[#1a3d24] px-3 py-2 text-sm font-medium text-[#86e8a8] hover:bg-[#204d2c] disabled:opacity-60"
              >
                {isLoadingDownloads ? "Đang lấy danh sách…" : "Lưu ảnh hoàn thiện"}
              </button>
            ) : (
              <a
                href={zipUrl}
                className="rounded-[4px] border border-[#2d6a3f] bg-[#1a3d24] px-3 py-2 text-sm font-medium text-[#86e8a8] hover:bg-[#204d2c]"
              >
                Tải ZIP ảnh hoàn thiện
              </a>
            ))}
          {downloadError && <span className="text-sm text-[#f2b8b5]">{downloadError}</span>}
          <button
            type="button"
            onClick={() => {
              setCompareMode((prev) => !prev);
              setCompareSelection([]);
            }}
            className={`rounded-[4px] border px-3 py-2 text-sm font-medium ${
              compareMode
                ? "border-[#a9c7ff] bg-[#a9c7ff] text-white"
                : "border-[#43474f] text-[#e5e2e1] hover:bg-[#2a2a2a]"
            }`}
          >
            {compareMode ? "Đang chọn ảnh để so sánh" : "So sánh 2 ảnh"}
          </button>
        </div>
      </div>

      {compareMode && compareSelection.length < 2 && (
        <div className="mt-3 rounded-[4px] border border-[#43474f] bg-[#1c1b1b] px-3 py-2 text-sm text-[#c1c6d4]">
          Chọn 2 ảnh ({compareSelection.length}/2 đã chọn) — công cụ so sánh sẽ tự mở khi
          chọn đủ 2 ảnh.
        </div>
      )}

      {filteredPhotos.length === 0 ? (
        <p className="mt-6 text-sm text-[#c1c6d4]">
          {showLikedOnly ? "Bạn chưa thả tim ảnh nào." : "Chưa có ảnh nào trong album."}
        </p>
      ) : (
        <>
          <div
            ref={setContainerNode}
            className="relative mt-6"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const rowPhotos = visiblePhotos.slice(
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
                      className="relative shrink-0 overflow-hidden rounded-[4px] border border-[#43474f] bg-[#1c1b1b]"
                    >
                      <button
                        type="button"
                        onClick={() => handleCardClick(photo)}
                        className="block w-full"
                      >
                        <img
                          src={`${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photo.id}/view?size=thumb`}
                          alt={photo.original_base_filename}
                          loading="lazy"
                          decoding="async"
                          className="aspect-square w-full object-cover"
                        />
                      </button>

                      {photo.burst_cluster_id &&
                        (photo.is_best_in_cluster ? (
                          <span className="absolute left-2 top-2 rounded bg-[#4a3600]/90 px-1.5 py-0.5 text-[10px] font-medium text-[#ffddb8]">
                            ✨ Gợi ý
                          </span>
                        ) : (
                          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-[#e5e2e1]">
                            Cụm ảnh giống
                          </span>
                        ))}

                      {compareMode ? (
                        <span
                          className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold shadow ${
                            compareSelection.includes(photo.id)
                              ? "bg-[#a9c7ff] text-white"
                              : "bg-black/50 text-[#e5e2e1]"
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
                              : "bg-black/50 text-[#e5e2e1]"
                          }`}
                        >
                          {selected.has(photo.id) ? "♥" : "♡"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div ref={setSentinelNode} className="mt-6 flex justify-center py-4">
              <span className="text-sm text-[#c1c6d4]">Đang tải thêm ảnh...</span>
            </div>
          )}
        </>
      )}

      {openPhotoId && albumId && (
        <PhotoAnnotationLightbox
          albumId={albumId}
          photoId={openPhotoId}
          photoName={
            photos.find((p) => p.id === openPhotoId)?.original_base_filename ?? ""
          }
          albumName={album.name}
          currentIndex={filteredPhotos.findIndex((p) => p.id === openPhotoId)}
          totalCount={filteredPhotos.length}
          onNavigate={(direction) => {
            const idx = filteredPhotos.findIndex((p) => p.id === openPhotoId);
            const next = filteredPhotos[idx + direction];
            if (next) setOpenPhotoId(next.id);
          }}
          isSelected={selected.has(openPhotoId)}
          onToggleSelect={() => toggleHeart(openPhotoId)}
          onClose={() => setOpenPhotoId(null)}
        />
      )}

      {downloadList !== null && (
        <BatchDownloadModal
          // Đổi chất lượng -> remount, bắt đầu lại từ nhóm 1 với URL ảnh mới.
          key={downloadQuality}
          isOpen
          onClose={() => setDownloadList(null)}
          selectedPhotos={downloadablePhotos}
          quality={downloadQuality}
          onQualityChange={setDownloadQuality}
          zipFallbackUrl={zipUrl}
        />
      )}

      {compareSelection.length === 2 && compareTargets.length === 2 && albumId && (
        <PhotoCompareView
          albumId={albumId}
          left={compareTargets[0]}
          right={compareTargets[1]}
          isSelected={(id) => selected.has(id)}
          onToggleSelect={toggleHeart}
          onClose={() => {
            setCompareMode(false);
            setCompareSelection([]);
          }}
        />
      )}
    </div>
  );
}
