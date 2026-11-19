import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import PageSpinner from "../../components/ui/PageSpinner";
import { GridIcon, HeartIcon, ImagesIcon, SparklesIcon } from "../../components/Icons";
import { useClientAlbum, useIsAlbumExpired } from "../../contexts/ClientAlbumContext";
import PhotoAnnotationLightbox from "../../components/PhotoAnnotationLightbox";
import PhotoCompareView from "../../components/PhotoCompareView";
import PhotoViewer, { type ViewerPhoto } from "../../components/client/PhotoViewer";
import PhotoTile from "../../components/client/PhotoTile";
import BatchDownloadModal, {
  type DownloadQuality,
  type DownloadablePhoto,
} from "../../components/BatchDownloadModal";
import { isMobileDevice } from "../../lib/mobileDownloadService";
import { runViewTransition, tapFeedback } from "../../lib/photoViewing";

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
  /** Khách đã thả tim ảnh này (lưu trên server) */
  selected: boolean;
}

type FilterKey = "all" | "suggested" | "bursts";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "suggested", label: "Gợi ý AI" },
  { key: "bursts", label: "Cụm giống" },
];

// GET /api/public/albums/:albumId/downloads — tập ảnh hoàn thiện (giống nội dung ZIP).
interface DownloadListResponse {
  mode: "per_photo" | "zip_only";
  photos: { id: string; filename: string }[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const PAGE_SIZE = 60;
// Điện thoại: chụm 2 ngón để đổi cỡ lưới như app Ảnh (2 · 3 · 5 cột), nhớ lựa chọn
const PHONE_COLUMN_STEPS = [2, 3, 5] as const;
const COLUMNS_STORAGE_KEY = "lensproof:gallery-columns";
const PHONE_MAX_WIDTH = 640;

function readStoredColumns(): number {
  try {
    const value = Number(localStorage.getItem(COLUMNS_STORAGE_KEY));
    return (PHONE_COLUMN_STEPS as readonly number[]).includes(value) ? value : 3;
  } catch {
    return 3;
  }
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

export default function AlbumGalleryPage() {
  const { album, refetch } = useClientAlbum();
  const expired = useIsAlbumExpired();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const showLikedOnly = searchParams.get("view") === "liked";
  const openPhotoParam = searchParams.get("photo");
  const [photos, setPhotos] = useState<PublicPhoto[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [annotatePhotoId, setAnnotatePhotoId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [phoneColumns, setPhoneColumns] = useState(readStoredColumns);
  // Danh sách "đóng băng" lúc mở trình xem — bỏ tim trong tab Yêu thích không làm ảnh biến mất giữa chừng
  const [viewerList, setViewerList] = useState<PublicPhoto[] | null>(null);
  const pushedViewerEntry = useRef(false);

  const albumId = album?.id ?? null;
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });

  // Tải ảnh hoàn thiện: PC giữ link ZIP như cũ; điện thoại mở BatchDownloadModal để lưu thẳng
  // vào Thư viện ảnh theo từng nhóm 10 ảnh.
  const isMobile = useMemo(() => isMobileDevice(), []);
  const [downloadList, setDownloadList] = useState<{ id: string; filename: string }[] | null>(null);
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
      const { data } = await api.get<DownloadListResponse>(`/api/public/albums/${albumId}/downloads`);
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
      .then(({ data }) => {
        setPhotos(data.photos);
        // Tải lại trang vẫn nhớ ảnh đã thả tim
        setSelected(new Set(data.photos.filter((p) => p.selected).map((p) => p.id)));
      })
      .catch((err) => {
        if (isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
          return; // ClientAlbumContext đã lo redirect về trang PIN.
        }
        setError(getErrorMessage(err, "Không tải được danh sách ảnh"));
      });
  }, [albumId]);

  // Thả tim phản hồi ngay (lạc quan), lỗi thì trả lại như cũ
  const toggleHeart = useCallback(
    async (photoId: string) => {
      if (!albumId || expired) return;
      const wasSelected = selectedRef.current.has(photoId);
      setSelected((prev) => {
        const next = new Set(prev);
        if (wasSelected) next.delete(photoId);
        else next.add(photoId);
        return next;
      });
      try {
        const { data } = await api.post<{ selected: boolean }>(`/api/public/albums/${albumId}/photos/${photoId}/select`);
        setSelected((prev) => {
          if (prev.has(photoId) === data.selected) return prev;
          const next = new Set(prev);
          if (data.selected) next.add(photoId);
          else next.delete(photoId);
          return next;
        });
      } catch (err) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (wasSelected) next.add(photoId);
          else next.delete(photoId);
          return next;
        });
        if (isAxiosError(err) && err.response?.status === 403) refetch();
      }
    },
    [albumId, expired, refetch]
  );

  const filteredPhotos = useMemo(() => {
    let result = photos ?? [];
    if (showLikedOnly) result = result.filter((p) => selected.has(p.id));
    if (filter === "suggested") result = result.filter((p) => p.is_best_in_cluster);
    if (filter === "bursts") result = result.filter((p) => p.burst_cluster_id !== null);
    return result;
  }, [photos, showLikedOnly, filter, selected]);

  // ------------------------------------------------------------------ trình xem ảnh (?photo=id)
  // Mở ảnh = thêm 1 mục lịch sử → nút Back của điện thoại đóng trình xem, không rời album.
  const viewerPhotos = viewerList ?? filteredPhotos;
  const viewerIndex = openPhotoParam ? viewerPhotos.findIndex((p) => p.id === openPhotoParam) : -1;
  const viewerItems = useMemo<ViewerPhoto[]>(
    () => viewerPhotos.map((p) => ({ id: p.id, name: p.original_base_filename })),
    [viewerPhotos]
  );

  const openPhoto = useCallback(
    (photoId: string) => {
      setViewerList(filteredPhotos);
      pushedViewerEntry.current = true;
      runViewTransition(() =>
        setSearchParams((params) => {
          params.set("photo", photoId);
          return params;
        })
      );
    },
    [filteredPhotos, setSearchParams]
  );

  const changeViewerIndex = useCallback(
    (index: number) => {
      const photo = viewerPhotos[index];
      if (!photo) return;
      setSearchParams(
        (params) => {
          params.set("photo", photo.id);
          return params;
        },
        { replace: true }
      );
    },
    [viewerPhotos, setSearchParams]
  );

  const scrollToPhotoRef = useRef<(photoId: string) => void>(() => {});
  const closeViewer = useCallback(() => {
    // Như app Ảnh: đóng xong lưới đang ở đúng chỗ ảnh vừa xem (kể cả khi đã vuốt sang ảnh khác)
    const lastPhotoId = openPhotoParam;
    if (lastPhotoId) requestAnimationFrame(() => scrollToPhotoRef.current(lastPhotoId));
    setViewerList(null);
    if (pushedViewerEntry.current) {
      pushedViewerEntry.current = false;
      navigate(-1);
    } else {
      // Mở thẳng từ link chia sẻ có ?photo= → bỏ tham số, không lùi ra khỏi trang
      setSearchParams(
        (params) => {
          params.delete("photo");
          return params;
        },
        { replace: true }
      );
    }
  }, [navigate, setSearchParams, openPhotoParam]);

  // Đóng bằng nút Back → bỏ danh sách đóng băng (derive trong render, không cần effect)
  if (!openPhotoParam && viewerList !== null) setViewerList(null);

  // ------------------------------------------------------------------ chọn ảnh để so sánh
  const handleTileOpen = useCallback(
    (photoId: string) => {
      if (!compareMode) {
        openPhoto(photoId);
        return;
      }
      tapFeedback();
      setCompareSelection((prev) => {
        if (prev.includes(photoId)) return prev.filter((id) => id !== photoId);
        if (prev.length >= 2) return [prev[1], photoId];
        return [...prev, photoId];
      });
    },
    [compareMode, openPhoto]
  );

  function exitCompare() {
    setCompareMode(false);
    setCompareSelection([]);
    setComparing(false);
  }

  // ------------------------------------------------------------------ lưới ảo hoá
  const visiblePhotos = filteredPhotos.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPhotos.length;

  // Dùng ref dạng callback vì sentinel chỉ mount khi hasMore === true — useRef + effect deps
  // rỗng sẽ gắn observer đúng 1 lần, có thể lúc sentinel chưa tồn tại.
  const [sentinelNode, setSentinelNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinelNode || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setVisibleCount((c) => c + PAGE_SIZE);
      },
      { rootMargin: "1200px 0px" }
    );
    observer.observe(sentinelNode);
    return () => observer.disconnect();
  }, [sentinelNode, hasMore]);

  const [lastFilterKey, setLastFilterKey] = useState(`${showLikedOnly}-${filter}`);
  if (lastFilterKey !== `${showLikedOnly}-${filter}`) {
    setLastFilterKey(`${showLikedOnly}-${filter}`);
    setVisibleCount(PAGE_SIZE);
  }

  // Div lưới chỉ mount sau khi có ảnh → ref dạng callback để ResizeObserver chắc chắn được gắn
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    if (!containerNode) return;
    const observer = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width));
    observer.observe(containerNode);
    return () => observer.disconnect();
  }, [containerNode]);

  const isPhone = containerWidth > 0 && containerWidth < PHONE_MAX_WIDTH;
  const columns = containerWidth === 0 ? 3 : isPhone ? phoneColumns : containerWidth < 1024 ? 4 : containerWidth < 1280 ? 5 : 6;
  const gap = isPhone ? 2 : 6;
  const itemSize = containerWidth > 0 ? (containerWidth - gap * (columns - 1)) / columns : 0;
  const rowHeight = itemSize > 0 ? itemSize + gap : 120;
  const rowCount = Math.ceil(visiblePhotos.length / columns);

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan: 4,
    scrollMargin: containerNode?.offsetTop ?? 0,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, columns, rowVirtualizer]);

  useEffect(() => {
    scrollToPhotoRef.current = (photoId: string) => {
      const index = filteredPhotos.findIndex((p) => p.id === photoId);
      if (index < 0) return;
      if (index >= visibleCount) setVisibleCount(index + PAGE_SIZE);
      rowVirtualizer.scrollToIndex(Math.floor(index / columns), { align: "auto" });
    };
  });

  const changePhoneColumns = useCallback((next: number) => {
    runViewTransition(() => setPhoneColumns(next));
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, String(next));
    } catch {
      // trình duyệt chặn lưu trữ — vẫn đổi được trong phiên này
    }
  }, []);

  function cyclePhoneColumns() {
    const steps = PHONE_COLUMN_STEPS as readonly number[];
    changePhoneColumns(steps[(steps.indexOf(phoneColumns) + 1) % steps.length]);
  }

  // Chụm 2 ngón trên lưới: tách ra → ít cột hơn (ảnh to), chụm lại → nhiều cột hơn
  useEffect(() => {
    if (!containerNode || !isPhone) return;
    let startDist = 0;
    let decided = false;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e.touches);
        decided = false;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || decided || !startDist) return;
      const ratio = dist(e.touches) / startDist;
      const steps = PHONE_COLUMN_STEPS as readonly number[];
      const at = steps.indexOf(phoneColumns);
      if (ratio > 1.18 && at > 0) {
        decided = true;
        changePhoneColumns(steps[at - 1]);
      } else if (ratio < 0.85 && at < steps.length - 1) {
        decided = true;
        changePhoneColumns(steps[at + 1]);
      }
    };
    containerNode.addEventListener("touchstart", onStart, { passive: true });
    containerNode.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      containerNode.removeEventListener("touchstart", onStart);
      containerNode.removeEventListener("touchmove", onMove);
    };
  }, [containerNode, isPhone, phoneColumns, changePhoneColumns]);

  // ------------------------------------------------------------------ tiêu đề lớn thu gọn khi cuộn
  const [titleNode, setTitleNode] = useState<HTMLHeadingElement | null>(null);
  const [titleHidden, setTitleHidden] = useState(false);
  useEffect(() => {
    if (!titleNode) return;
    const observer = new IntersectionObserver(([entry]) => setTitleHidden(!entry.isIntersecting), {
      rootMargin: "-8px 0px 0px 0px",
    });
    observer.observe(titleNode);
    return () => observer.disconnect();
  }, [titleNode]);

  const compareTargets = useMemo(
    () => (photos ?? []).filter((p) => compareSelection.includes(p.id)),
    [photos, compareSelection]
  );

  const lastUpdatedAt = useMemo(() => {
    if (!photos || photos.length === 0) return null;
    return photos.reduce((latest, p) => (p.created_at > latest ? p.created_at : latest), photos[0].created_at);
  }, [photos]);

  if (error) {
    return (
      <p role="alert" className="rounded-2xl border border-rose-500/20 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
        {error}
      </p>
    );
  }

  if (!album || !photos) {
    return <PageSpinner fullHeight />;
  }

  const title = showLikedOnly ? "Yêu thích" : album.name;
  const selectButton = (
    <button
      type="button"
      onClick={() => (compareMode ? exitCompare() : setCompareMode(true))}
      aria-pressed={compareMode}
      className={`min-h-9 rounded-full px-3.5 text-sm font-semibold transition active:scale-95 ${
        compareMode ? "bg-white text-zinc-950" : "bg-white/10 text-white hover:bg-white/15"
      }`}
    >
      {compareMode ? "Huỷ" : "Chọn"}
    </button>
  );

  return (
    <div>
      <title>{`${title} · LensProof`}</title>

      {/* Thanh tiêu đề thu gọn (điện thoại) — hiện khi tiêu đề lớn đã cuộn khỏi màn hình */}
      <div
        aria-hidden={!titleHidden}
        className={`fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-zinc-950/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 transition-opacity duration-200 sm:hidden ${
          titleHidden ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="flex h-11 items-center justify-between gap-3 px-4">
          <span className="w-16" aria-hidden="true" />
          <p className="min-w-0 truncate text-[15px] font-semibold text-white">{title}</p>
          <div className="flex w-16 justify-end">{titleHidden ? selectButton : null}</div>
        </div>
      </div>

      {/* Tiêu đề lớn */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 ref={setTitleNode} className="truncate text-[28px] font-bold leading-tight tracking-tight text-white sm:text-3xl">
            {title}
          </h1>
          <p className="mt-1 text-sm tabular-nums text-zinc-400">
            {filteredPhotos.length} ảnh
            {!showLikedOnly && <> · {selected.size} đã thích</>}
            {lastUpdatedAt && !showLikedOnly && <span className="hidden sm:inline"> · cập nhật {formatRelativeTime(lastUpdatedAt)}</span>}
          </p>
        </div>
        <div className="shrink-0">{selectButton}</div>
      </div>

      {/* Bộ lọc + hành động */}
      <div className="no-scrollbar -mx-4 mt-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="group" aria-label="Lọc ảnh" className="flex shrink-0 rounded-full bg-white/[0.06] p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`min-h-8 rounded-full px-3.5 text-[13px] font-semibold transition ${
                filter === f.key ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-300 hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={cyclePhoneColumns}
          aria-label={`Cỡ lưới: ${phoneColumns} cột — bấm để đổi`}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-zinc-300 transition hover:text-white active:scale-95 sm:hidden"
        >
          <GridIcon size={17} />
        </button>
        {album.download_zip_unlocked &&
          (isMobile ? (
            <button
              type="button"
              onClick={openMobileDownload}
              disabled={isLoadingDownloads}
              className="min-h-10 shrink-0 rounded-full bg-emerald-500/15 px-4 text-[13px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25 active:scale-95 disabled:opacity-60"
            >
              {isLoadingDownloads ? "Đang lấy danh sách…" : "Lưu ảnh hoàn thiện"}
            </button>
          ) : (
            <a
              href={zipUrl}
              className="flex min-h-10 shrink-0 items-center rounded-full bg-emerald-500/15 px-4 text-[13px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
            >
              Tải ZIP ảnh hoàn thiện
            </a>
          ))}
      </div>
      {downloadError && <p role="alert" className="mt-2 text-sm text-rose-300">{downloadError}</p>}

      {filteredPhotos.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-20 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-white/[0.06] text-zinc-400">
            {showLikedOnly ? <HeartIcon size={26} /> : <ImagesIcon size={26} />}
          </span>
          <p className="mt-4 text-base font-semibold text-white">{showLikedOnly ? "Chưa có ảnh yêu thích" : "Chưa có ảnh"}</p>
          <p className="mt-1 max-w-xs text-sm text-zinc-400">
            {showLikedOnly
              ? "Mở một ảnh và bấm trái tim để chọn ảnh bạn thích."
              : filter === "all"
                ? "Nhiếp ảnh gia chưa tải ảnh lên album này."
                : "Không có ảnh nào khớp bộ lọc này."}
          </p>
        </div>
      ) : (
        <>
          {/* Lưới tràn viền trên điện thoại như app Ảnh; chụm 2 ngón để đổi cỡ */}
          <div
            ref={setContainerNode}
            className="relative -mx-4 mt-4 touch-pan-y sm:mx-0 sm:mt-6"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const rowPhotos = visiblePhotos.slice(virtualRow.index * columns, virtualRow.index * columns + columns);
              return (
                <div
                  key={virtualRow.key}
                  className="absolute inset-x-0 top-0 flex"
                  style={{
                    height: itemSize || undefined,
                    gap,
                    transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                  }}
                >
                  {rowPhotos.map((photo) => (
                    <div key={photo.id} className="shrink-0" style={{ width: itemSize || undefined }}>
                      <PhotoTile
                        albumId={album.id}
                        photoId={photo.id}
                        name={photo.original_base_filename}
                        liked={selected.has(photo.id)}
                        onOpen={handleTileOpen}
                        picking={compareMode}
                        picked={compareSelection.includes(photo.id)}
                        onHeart={toggleHeart}
                        heartDisabled={expired}
                        transition={photo.id !== openPhotoParam}
                        badge={
                          photo.is_best_in_cluster ? (
                            <span className="pointer-events-none absolute left-1 top-1 flex items-center gap-1 rounded-full bg-amber-400/95 p-1 text-amber-950 sm:left-2 sm:top-2 sm:px-2 sm:py-0.5">
                              <SparklesIcon size={11} />
                              <span className="hidden text-[10px] font-semibold sm:inline">Gợi ý</span>
                            </span>
                          ) : undefined
                        }
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div ref={setSentinelNode} className="flex justify-center py-8">
              <span className="size-5 animate-spin rounded-full border-2 border-white/15 border-t-indigo-400" aria-label="Đang tải thêm ảnh" />
            </div>
          )}
        </>
      )}

      {/* Thanh hành động khi đang chọn ảnh (nằm trên thanh tab) */}
      {compareMode && !comparing && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-30 px-4 sm:bottom-6">
          <div className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-900/90 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur-xl animate-fade-in-up">
            <p className="text-sm text-zinc-200" aria-live="polite">
              {compareSelection.length === 2 ? "Đã chọn 2 ảnh" : `Chọn ${2 - compareSelection.length} ảnh nữa để so sánh`}
            </p>
            <button
              type="button"
              disabled={compareSelection.length !== 2}
              onClick={() => setComparing(true)}
              className="min-h-10 rounded-full bg-indigo-500 px-4 text-sm font-semibold text-white transition hover:bg-indigo-400 active:scale-95 disabled:opacity-40"
            >
              So sánh
            </button>
          </div>
        </div>
      )}

      {viewerIndex >= 0 && (
        <PhotoViewer
          albumId={album.id}
          photos={viewerItems}
          index={viewerIndex}
          onIndexChange={changeViewerIndex}
          onClose={closeViewer}
          isSelected={(id) => selected.has(id)}
          onToggleSelect={toggleHeart}
          selectDisabled={expired}
          onAnnotate={setAnnotatePhotoId}
          suspended={annotatePhotoId !== null}
        />
      )}

      {annotatePhotoId && (
        <PhotoAnnotationLightbox
          albumId={album.id}
          photoId={annotatePhotoId}
          photoName={photos.find((p) => p.id === annotatePhotoId)?.original_base_filename ?? ""}
          albumName={album.name}
          isSelected={selected.has(annotatePhotoId)}
          onToggleSelect={() => toggleHeart(annotatePhotoId)}
          onClose={() => setAnnotatePhotoId(null)}
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

      {comparing && compareTargets.length === 2 && (
        <PhotoCompareView
          albumId={album.id}
          left={compareTargets[0]}
          right={compareTargets[1]}
          isSelected={(id) => selected.has(id)}
          onToggleSelect={toggleHeart}
          onClose={exitCompare}
        />
      )}
    </div>
  );
}
