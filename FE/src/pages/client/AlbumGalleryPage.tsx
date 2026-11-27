import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useSearchParams } from "react-router-dom";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { CameraIcon, CheckIcon, ClockIcon, HeartIcon, ImagesIcon, PlusIcon, SparklesIcon } from "../../components/Icons";
import SegmentedControl from "../../components/ios/SegmentedControl";
import ActionSheet from "../../components/ios/ActionSheet";
import { useClientSelection } from "../../contexts/clientSelection";
import { useClientAlbum } from "../../contexts/clientAlbum";
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
  // L5 — khách hiện tại đã thả tim ảnh này chưa (BE trả kèm để giữ trạng thái khi tải lại trang).
  is_selected?: boolean;
}

interface PhotoListResponse {
  photos: PublicPhoto[];
  selection?: { selected_count: number; max_selectable_photos: number | null; completed_at?: string | null };
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
  const { album } = useClientAlbum();
  const {
    selected,
    selectedCount,
    maxSelectable,
    limitReached,
    completedAt,
    expired,
    hydrate,
    toggle: toggleHeart,
    complete,
    reopen,
  } = useClientSelection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchParams] = useSearchParams();
  const showLikedOnly = searchParams.get("view") === "liked";
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  // Số ảnh đang render, gắn với "khoá" danh sách hiện tại (bộ lọc + chế độ Yêu thích): đổi
  // bộ lọc thì khoá đổi và số ảnh tự về PAGE_SIZE ngay trong lúc render — không cần effect.
  const listKey = `${showLikedOnly ? "liked" : "all"}|${filter}`;
  const [paging, setPaging] = useState({ key: listKey, count: PAGE_SIZE });
  const visibleCount = paging.key === listKey ? paging.count : PAGE_SIZE;

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
      .get<PhotoListResponse>(`/api/public/albums/${albumId}/photos`)
      .then(({ data }) => {
        setPhotos(data.photos);
        hydrate(
          data.photos.filter((p) => p.is_selected).map((p) => p.id),
          data.selection?.max_selectable_photos ?? null,
          data.selection?.completed_at ?? null
        );
      })
      .catch((err) => {
        if (
          isAxiosError(err) &&
          (err.response?.status === 401 || err.response?.status === 403)
        ) {
          return; // ClientAlbumContext đã lo redirect về trang PIN.
        }
        setError(getErrorMessage(err, "Không tải được danh sách ảnh"));
      });
  }, [albumId, hydrate]);

  async function submitSelection() {
    setIsSubmitting(true);
    const ok = await complete();
    setIsSubmitting(false);
    if (ok) setConfirmOpen(false);
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
          setPaging((p) => ({
            key: listKey,
            count: (p.key === listKey ? p.count : PAGE_SIZE) + PAGE_SIZE,
          }));
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(sentinelNode);
    return () => observer.disconnect();
  }, [sentinelNode, hasMore, listKey]);

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
      <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
        {error}
      </div>
    );
  }

  if (!album) {
    return <GallerySkeleton />;
  }

  const selectionLabel =
    maxSelectable !== null ? `${selectedCount} / ${maxSelectable} ảnh` : `${selectedCount} ảnh`;
  const selectionProgress = maxSelectable ? Math.min(1, selectedCount / maxSelectable) : 0;
  const completedText = completedAt
    ? new Date(completedAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <div>
      {/* Tiêu đề lớn kiểu iOS */}
      <h1 className="text-balance text-[28px] font-bold leading-tight tracking-tight text-white sm:text-3xl">
        {showLikedOnly ? "Ảnh đã chọn" : album.name}
      </h1>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <CameraIcon size={14} className="text-zinc-500" />
          {photos.length} ảnh
        </span>
        {lastUpdatedAt && (
          <span className="inline-flex items-center gap-1.5">
            <ClockIcon size={14} className="text-zinc-500" />
            Cập nhật {formatRelativeTime(lastUpdatedAt)}
          </span>
        )}
        {showLikedOnly && <span className="truncate text-zinc-500">{album.name}</span>}
      </p>

      {completedAt && (
        <div
          role="status"
          className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-emerald-950">
              <CheckIcon size={16} />
            </span>
            <div>
              <p className="font-semibold text-emerald-100">Đã gửi lựa chọn cho nhiếp ảnh gia</p>
              <p className="mt-0.5 text-pretty text-sm text-emerald-200/80">
                {selectedCount} ảnh · lúc {completedText}. Nhiếp ảnh gia sẽ hậu kỳ theo lựa chọn và ghi chú của bạn.
              </p>
            </div>
          </div>
          {!expired && (
            <button
              type="button"
              onClick={() => void reopen()}
              className="h-11 shrink-0 rounded-xl border border-emerald-400/30 px-4 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-900/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 sm:h-10"
            >
              Mở lại để chỉnh sửa
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl<FilterKey>
          label="Lọc ảnh"
          value={filter}
          onChange={setFilter}
          className="sm:max-w-md"
          segments={[
            { value: "all", label: "Tất cả" },
            { value: "suggested", label: "Gợi ý AI" },
            { value: "bursts", label: "Ảnh giống" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={compareMode}
            onClick={() => {
              setCompareMode((prev) => !prev);
              setCompareSelection([]);
            }}
            className={`h-10 flex-1 rounded-[10px] px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 sm:flex-none ${
              compareMode ? "bg-indigo-500 text-white" : "bg-white/[0.08] text-zinc-100 hover:bg-white/[0.12]"
            }`}
          >
            {compareMode ? "Thoát so sánh" : "So sánh 2 ảnh"}
          </button>
          {album.download_zip_unlocked &&
            (isMobile ? (
              <button
                type="button"
                onClick={openMobileDownload}
                disabled={isLoadingDownloads}
                className="h-10 flex-1 rounded-[10px] bg-emerald-500/15 px-3 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:opacity-60 sm:flex-none"
              >
                {isLoadingDownloads ? "Đang lấy danh sách…" : "Lưu ảnh hoàn thiện"}
              </button>
            ) : (
              <a
                href={zipUrl}
                className="inline-flex h-10 items-center rounded-[10px] bg-emerald-500/15 px-3 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              >
                Tải ZIP ảnh hoàn thiện
              </a>
            ))}
        </div>
      </div>
      {downloadError && (
        <p role="alert" className="mt-2 text-sm text-rose-300">
          {downloadError}
        </p>
      )}

      {compareMode && compareSelection.length < 2 && (
        <p className="mt-3 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
          Chọn 2 ảnh ({compareSelection.length}/2 đã chọn) — công cụ so sánh sẽ tự mở khi chọn đủ 2 ảnh.
        </p>
      )}

      {filteredPhotos.length === 0 ? (
        <EmptyGallery liked={showLikedOnly} filtered={filter !== "all"} hasPhotos={photos.length > 0} />
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
                  {rowPhotos.map((photo) => {
                    const isPhotoSelected = selected.has(photo.id);
                    const heartLocked = Boolean(completedAt) || (!isPhotoSelected && limitReached);
                    const inCompare = compareSelection.includes(photo.id);
                    return (
                      <div
                        key={photo.id}
                        style={{ width: itemSize || undefined, aspectRatio: "1 / 1" }}
                        className={`group relative shrink-0 overflow-hidden rounded-lg border bg-zinc-900 ${
                          isPhotoSelected ? "border-rose-400/70" : "border-white/10"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleCardClick(photo)}
                          aria-label={
                            compareMode
                              ? `${inCompare ? "Bỏ" : "Chọn"} ảnh ${photo.original_base_filename} để so sánh`
                              : `Xem ảnh ${photo.original_base_filename}`
                          }
                          className="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-400"
                        >
                          <img
                            src={`${API_BASE_URL}/api/public/albums/${albumId}/photos/${photo.id}/view?size=thumb`}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            width={320}
                            height={320}
                            className="size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.02]"
                          />
                        </button>

                        {photo.burst_cluster_id &&
                          (photo.is_best_in_cluster ? (
                            <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-amber-400/95 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950">
                              <SparklesIcon size={10} />
                              Gợi ý
                            </span>
                          ) : (
                            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-zinc-100">
                              Cụm ảnh giống
                            </span>
                          ))}

                        {compareMode ? (
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none absolute right-2 top-2 flex size-9 items-center justify-center rounded-full shadow ${
                              inCompare ? "bg-indigo-500 text-white" : "bg-black/60 text-zinc-100"
                            }`}
                          >
                            {inCompare ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleHeart(photo.id)}
                            disabled={expired || heartLocked}
                            aria-pressed={isPhotoSelected}
                            aria-label={
                              isPhotoSelected
                                ? `Bỏ chọn ảnh ${photo.original_base_filename}`
                                : `Chọn ảnh ${photo.original_base_filename}`
                            }
                            title={
                              expired
                                ? "Đã hết hạn chọn ảnh"
                                : completedAt
                                  ? "Đã gửi lựa chọn — mở lại để thay đổi"
                                  : heartLocked
                                  ? `Đã chọn đủ ${maxSelectable} ảnh`
                                  : isPhotoSelected
                                    ? "Bỏ chọn"
                                    : "Thả tim"
                            }
                            className={`absolute right-1.5 top-1.5 flex size-11 items-center justify-center rounded-full shadow transition-[transform,background-color] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40 md:size-10 ${
                              isPhotoSelected
                                ? "bg-rose-500 text-white hover:bg-rose-400"
                                : "bg-black/55 text-zinc-100 hover:bg-black/75"
                            }`}
                          >
                            <HeartIcon size={18} fill={isPhotoSelected ? "currentColor" : "none"} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div ref={setSentinelNode} className="mt-6 flex justify-center py-4">
              <span className="text-sm text-zinc-400">Đang tải thêm ảnh…</span>
            </div>
          )}
        </>
      )}

      {openPhotoId && albumId && (
        <PhotoAnnotationLightbox
          albumId={albumId}
          photoId={openPhotoId}
          photoName={photos.find((p) => p.id === openPhotoId)?.original_base_filename ?? ""}
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
          selectionSummary={{ selectedCount, maxSelectable }}
          readOnly={Boolean(completedAt)}
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

      {/* Thanh hành động đáy: mobile nằm ngay trên thanh tab, desktop là thanh nổi giữa màn hình. */}
      <div data-fixed-bar className="fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-30 px-3 pb-2 md:bottom-5 md:px-6 md:pb-0">
        <div className="mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/85 p-2 pl-4 shadow-2xl shadow-black/50 backdrop-blur-xl backdrop-saturate-150">
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-zinc-100">
              <HeartIcon size={15} className="text-rose-400" fill="currentColor" />
              Đã chọn {selectionLabel}
            </p>
            {maxSelectable !== null ? (
              <div
                className="mt-1.5 h-1 w-full max-w-[12rem] overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-label="Tiến độ chọn ảnh"
                aria-valuemin={0}
                aria-valuemax={maxSelectable}
                aria-valuenow={selectedCount}
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${limitReached ? "bg-amber-400" : "bg-rose-400"}`}
                  style={{ width: `${selectionProgress * 100}%` }}
                />
              </div>
            ) : (
              <p className="mt-0.5 truncate text-xs text-zinc-500">Không giới hạn số ảnh</p>
            )}
          </div>
          {completedAt ? (
            <span className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500/15 px-3 text-sm font-semibold text-emerald-300">
              <CheckIcon size={16} /> Đã gửi
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={expired || selectedCount === 0}
              className="h-11 shrink-0 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-[background-color,transform] hover:bg-indigo-400 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:shadow-none"
            >
              Gửi lựa chọn
            </button>
          )}
        </div>
      </div>

      <ActionSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Gửi ${selectedCount} ảnh đã chọn cho nhiếp ảnh gia?`}
        message={
          <>
            Sau khi gửi, bạn không thể thả tim hay thêm ghi chú. Bạn vẫn có thể{" "}
            <strong className="font-semibold text-zinc-300">mở lại để chỉnh sửa</strong> trước hạn chót.
            {maxSelectable !== null && selectedCount < maxSelectable && (
              <> Bạn mới chọn {selectedCount}/{maxSelectable} ảnh.</>
            )}
          </>
        }
        actions={[
          {
            label: isSubmitting ? "Đang gửi…" : "Gửi lựa chọn",
            tone: "primary",
            disabled: isSubmitting,
            onSelect: () => void submitSelection(),
          },
        ]}
      />
    </div>
  );
}

function GallerySkeleton() {
  return (
    <div aria-busy="true" aria-label="Đang tải album">
      <div className="h-8 w-2/3 max-w-sm animate-pulse rounded-lg bg-white/10" />
      <div className="mt-3 h-4 w-full max-w-lg animate-pulse rounded bg-white/5" />
      <div className="mt-6 h-24 animate-pulse rounded-2xl bg-white/5" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/5" />
        ))}
      </div>
    </div>
  );
}

function EmptyGallery({ liked, filtered, hasPhotos }: { liked: boolean; filtered: boolean; hasPhotos: boolean }) {
  const title = liked
    ? "Bạn chưa thả tim ảnh nào"
    : filtered && hasPhotos
      ? "Không có ảnh khớp bộ lọc"
      : "Album chưa có ảnh";
  const hint = liked
    ? "Bấm biểu tượng trái tim trên ảnh để chọn ảnh bạn muốn nhiếp ảnh gia hoàn thiện."
    : filtered && hasPhotos
      ? "Thử chọn “Tất cả ảnh” để xem toàn bộ album."
      : "Nhiếp ảnh gia đang tải ảnh lên — hãy quay lại sau ít phút.";
  return (
    <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-white/5 text-zinc-400">
        {liked ? <HeartIcon size={22} /> : <ImagesIcon size={22} />}
      </span>
      <p className="mt-4 text-base font-semibold text-zinc-100">{title}</p>
      <p className="mt-1 max-w-sm text-pretty text-sm text-zinc-400">{hint}</p>
    </div>
  );
}
