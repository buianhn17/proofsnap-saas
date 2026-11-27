// Bước 2.2 — modal xem ảnh full-size + vẽ ghi chú khoanh vùng lên ảnh. Khách chọn 1 trong 3
// công cụ (bút vẽ tự do / khoanh tròn / khoanh chữ nhật) hoặc ghim 1 điểm, nhập ghi chú, lưu
// lại. Cả 3 công cụ vẽ hình đều quy về CÙNG 1 field `path_pct` sẵn có (đa giác toạ độ %) —
// khoanh tròn/chữ nhật chỉ là cách TẠO ra path_pct khác nhau (lấy mẫu điểm quanh hình), không
// cần đổi schema DB. SVG overlay dùng viewBox="0 0 100 100" + preserveAspectRatio="none" đúng
// bằng kích thước ảnh đang render (không phải kích thước gốc) — nhờ vậy toạ độ % capture từ
// pointer event và toạ độ % lưu trong path_pct luôn khớp nhau mà không cần quy đổi thêm.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isAxiosError } from "axios";
import { api } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  HeartIcon,
  MapPinIcon,
  PencilIcon,
  TrashIcon,
  XIcon,
} from "./Icons";
import { useClientAlbum, useIsAlbumExpired } from "../contexts/clientAlbum";
import { useEscapeKey } from "../lib/useEscapeKey";
import { useFocusTrap } from "../lib/useFocusTrap";
import { hasFinePointer } from "../lib/pointer";

export interface AnnotationPoint {
  x: number;
  y: number;
}

interface AnnotationDto {
  id: string;
  pos_x_pct: number;
  pos_y_pct: number;
  path_pct: AnnotationPoint[] | null;
  note_text: string;
  created_at: string;
}

type DrawTool = "pen" | "circle" | "rectangle";

interface PhotoAnnotationLightboxProps {
  albumId: string;
  photoId: string;
  photoName: string;
  onClose: () => void;
  /** Tên album hiện ở góc trên trái, cạnh nút đóng — bỏ trống nếu không có (vd. FaceSearchPage). */
  albumName?: string;
  /** Điều hướng ảnh trước/sau trong danh sách hiện tại — chỉ hiện khi có đủ cả 3 prop. */
  currentIndex?: number;
  totalCount?: number;
  onNavigate?: (direction: -1 | 1) => void;
  /** Nút "Chọn ảnh này" — chỉ hiện khi truyền đủ 2 prop này. */
  isSelected?: boolean;
  onToggleSelect?: () => void;
  /** L5 — hiện "Đã chọn X / Y ảnh" và khoá nút chọn khi đã đủ hạn mức. */
  selectionSummary?: { selectedCount: number; maxSelectable: number | null };
  /** Khách đã gửi lựa chọn (mục 5.2): chỉ xem, không thả tim/ghi chú tới khi mở lại. */
  readOnly?: boolean;
}

/** Kích thước vùng chứa ảnh, để ảnh co vừa khung (cả khi bottom sheet mở/đóng trên mobile). */
function useElementSize<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1 ? prev : { width, height }
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, size] as const;
}

const MAX_PATH_POINTS = 500;
const CIRCLE_SAMPLE_POINTS = 32;

function downsample(points: AnnotationPoint[], max: number): AnnotationPoint[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const result: AnnotationPoint[] = [];
  for (let i = 0; i < max; i += 1) {
    result.push(points[Math.floor(i * step)]);
  }
  return result;
}

function boundingCenter(points: AnnotationPoint[]): AnnotationPoint {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function rectanglePath(start: AnnotationPoint, end: AnnotationPoint): AnnotationPoint[] {
  return [
    { x: start.x, y: start.y },
    { x: end.x, y: start.y },
    { x: end.x, y: end.y },
    { x: start.x, y: end.y },
    { x: start.x, y: start.y },
  ];
}

function circlePath(center: AnnotationPoint, edge: AnnotationPoint): AnnotationPoint[] {
  const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
  const points: AnnotationPoint[] = [];
  for (let i = 0; i <= CIRCLE_SAMPLE_POINTS; i += 1) {
    const angle = (i / CIRCLE_SAMPLE_POINTS) * Math.PI * 2;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

const TOOLS: { key: DrawTool; label: string; icon: React.ReactNode }[] = [
  { key: "pen", label: "Vẽ tự do", icon: <PencilIcon /> },
  {
    key: "circle",
    label: "Khoanh tròn",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    key: "rectangle",
    label: "Khoanh vuông",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
      </svg>
    ),
  },
];

export default function PhotoAnnotationLightbox({
  albumId,
  photoId,
  photoName,
  onClose,
  albumName,
  currentIndex,
  totalCount,
  onNavigate,
  isSelected,
  onToggleSelect,
  selectionSummary,
  readOnly = false,
}: PhotoAnnotationLightboxProps) {
  useEscapeKey(onClose);
  const { album } = useClientAlbum();
  const expired = useIsAlbumExpired();

  const [annotations, setAnnotations] = useState<AnnotationDto[]>([]);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isPinMode, setIsPinMode] = useState(false);
  const [dragStart, setDragStart] = useState<AnnotationPoint | null>(null);
  const [currentStroke, setCurrentStroke] = useState<AnnotationPoint[] | null>(null);
  const [pendingStroke, setPendingStroke] = useState<AnnotationPoint[] | null>(null);
  const [pendingPoint, setPendingPoint] = useState<AnnotationPoint | null>(null);
  const [noteText, setNoteText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPointerDown = useRef(false);
  // Mobile (< md): khung ghi chú là bottom sheet thu gọn được; desktop luôn là sidebar.
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [setStageNode, stageSize] = useElementSize<HTMLDivElement>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [finePointer] = useState(hasFinePointer);
  const sheetId = useId();
  const titleId = useId();

  // Mở lightbox: đưa focus vào nút Đóng (bàn phím/screen reader bắt đầu trong dialog), trả
  // focus về phần tử đã mở khi đóng.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    api
      .get<{ annotations: AnnotationDto[] }>(
        `/api/public/albums/${albumId}/photos/${photoId}/annotations`
      )
      .then(({ data }) => setAnnotations(data.annotations))
      .catch(() => {
        // Không chặn xem ảnh nếu riêng việc tải ghi chú cũ lỗi.
      });
  }, [albumId, photoId]);

  const sortedAnnotations = [...annotations].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  function pointFromEvent(e: ReactPointerEvent<SVGSVGElement>): AnnotationPoint {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
  }

  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    const point = pointFromEvent(e);
    if (isPinMode) {
      setPendingPoint(point);
      setIsPinMode(false);
      setIsSheetOpen(true);
      return;
    }
    if (!isDrawMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isPointerDown.current = true;
    setDragStart(point);
    setCurrentStroke([point]);
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!isDrawMode || !isPointerDown.current) return;
    // Tính điểm NGAY trong handler (khi e.currentTarget còn hợp lệ) rồi mới đưa vào updater —
    // React trả currentTarget về null ngay sau khi handler đồng bộ kết thúc, còn pointermove
    // bắn liên tục có thể khiến React hoãn chạy updater này ra ngoài lượt dispatch gốc, lúc
    // đó gọi lại pointFromEvent(e) bên trong updater sẽ crash vì currentTarget đã là null.
    const point = pointFromEvent(e);
    if (tool === "pen") {
      setCurrentStroke((prev) => (prev ? [...prev, point] : prev));
    } else if (dragStart) {
      setCurrentStroke(
        tool === "rectangle" ? rectanglePath(dragStart, point) : circlePath(dragStart, point)
      );
    }
  }

  function handlePointerUp() {
    if (!isDrawMode || !isPointerDown.current) return;
    isPointerDown.current = false;
    setCurrentStroke((prev) => {
      if (prev && prev.length > 1) {
        setPendingStroke(tool === "pen" ? downsample(prev, MAX_PATH_POINTS) : prev);
        setIsSheetOpen(true);
      }
      return null;
    });
    setDragStart(null);
    setIsDrawMode(false);
  }

  function cancelPending() {
    setPendingStroke(null);
    setPendingPoint(null);
    setNoteText("");
  }

  async function saveAnnotation(overridePoint?: AnnotationPoint) {
    if (noteText.trim().length === 0) return;
    if (!pendingStroke && !pendingPoint && !overridePoint) return;
    setIsSaving(true);
    setError(null);
    try {
      const center = pendingStroke
        ? boundingCenter(pendingStroke)
        : (pendingPoint ?? overridePoint)!;
      const { data } = await api.post<{ annotation: AnnotationDto }>(
        `/api/public/albums/${albumId}/photos/${photoId}/annotations`,
        {
          pos_x_pct: center.x,
          pos_y_pct: center.y,
          path_pct: pendingStroke,
          note_text: noteText.trim(),
        }
      );
      setAnnotations((prev) => [...prev, data.annotation]);
      cancelPending();
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 403) {
        setError("Đã hết hạn hoặc album bị khóa — không thể thêm ghi chú mới.");
      } else {
        setError(getErrorMessage(err, "Không lưu được ghi chú"));
      }
    } finally {
      setIsSaving(false);
    }
  }

  const drawDisabled = expired || album?.is_locked === true || readOnly;
  const hasPending = pendingStroke !== null || pendingPoint !== null;
  const strokeToPoints = (points: AnnotationPoint[]) =>
    points.map((p) => `${p.x},${p.y}`).join(" ");
  const showNav =
    currentIndex !== undefined && totalCount !== undefined && onNavigate !== undefined;

  const selectionLocked =
    !isSelected &&
    selectionSummary !== undefined &&
    selectionSummary.maxSelectable !== null &&
    selectionSummary.selectedCount >= selectionSummary.maxSelectable;
  const selectDisabled = expired || selectionLocked || readOnly;
  const selectTitle = expired
    ? "Đã hết hạn chọn ảnh"
    : readOnly
      ? "Đã gửi lựa chọn — mở lại để thay đổi"
    : selectionLocked
      ? `Đã chọn đủ ${selectionSummary?.maxSelectable} ảnh`
      : isSelected
        ? "Bỏ chọn ảnh này"
        : "Chọn ảnh này";
  const selectionText =
    selectionSummary === undefined
      ? null
      : selectionSummary.maxSelectable !== null
        ? `Đã chọn ${selectionSummary.selectedCount} / ${selectionSummary.maxSelectable} ảnh`
        : `Đã chọn ${selectionSummary.selectedCount} ảnh`;

  // Ảnh co vừa vùng sân khấu (trừ padding) — tính bằng px để lớp SVG vẽ ghi chú phủ đúng ảnh.
  const STAGE_PADDING_PX = 16;
  const imageMaxWidth = stageSize.width > 0 ? stageSize.width - STAGE_PADDING_PX * 2 : undefined;
  const imageMaxHeight = stageSize.height > 0 ? stageSize.height - STAGE_PADDING_PX * 2 : undefined;

  const iconButton =
    "flex size-11 shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:pointer-events-none disabled:opacity-30 md:size-10";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col bg-zinc-950 pt-[env(safe-area-inset-top)]"
    >
      {/* Thanh tiêu đề: luôn 1 hàng, mọi phần tử co lại được (min-w-0 + truncate) nên không
          bao giờ đè lên nhau ở 375px. */}
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-white/10 bg-zinc-900 px-2 sm:gap-2 sm:px-4 md:h-16">
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Đóng xem ảnh"
          className={iconButton}
        >
          <XIcon size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-sm font-semibold text-zinc-100 md:text-base">
            {albumName ? (
              <>
                <span className="hidden md:inline">{albumName} · </span>
                <span className="md:font-normal md:text-zinc-400">{photoName}</span>
              </>
            ) : (
              photoName
            )}
          </h2>
          {selectionText && (
            <p className="truncate text-xs tabular-nums text-zinc-400 md:hidden" aria-live="polite">
              {selectionText}
            </p>
          )}
        </div>

        {showNav && (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => onNavigate!(-1)}
              disabled={currentIndex === 0}
              aria-label="Ảnh trước"
              className={iconButton}
            >
              <ChevronLeftIcon size={20} />
            </button>
            <span className="hidden min-w-14 text-center text-sm tabular-nums text-zinc-400 sm:inline">
              {currentIndex! + 1} / {totalCount}
            </span>
            <button
              type="button"
              onClick={() => onNavigate!(1)}
              disabled={currentIndex === totalCount! - 1}
              aria-label="Ảnh tiếp theo"
              className={iconButton}
            >
              <ChevronRightIcon size={20} />
            </button>
          </div>
        )}

        {selectionText && (
          <span className="hidden shrink-0 text-sm tabular-nums text-zinc-400 md:inline" aria-live="polite">
            {selectionText}
          </span>
        )}

        {onToggleSelect && (
          <button
            type="button"
            onClick={onToggleSelect}
            disabled={selectDisabled}
            aria-pressed={isSelected}
            aria-label={selectTitle}
            title={selectTitle}
            className={`flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:px-4 ${
              isSelected
                ? "bg-rose-500 text-white hover:bg-rose-400"
                : "border border-white/15 text-zinc-100 hover:bg-zinc-800"
            }`}
          >
            <HeartIcon size={18} fill={isSelected ? "currentColor" : "none"} />
            <span className="hidden sm:inline">{isSelected ? "Đã chọn" : "Chọn ảnh này"}</span>
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Sân khấu ảnh — mobile: chiếm phần còn lại, tối thiểu 60% chiều cao màn hình. */}
        <div className="relative flex min-h-[60dvh] flex-1 flex-col md:min-h-0">
          <div ref={setStageNode} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <div className="relative inline-block">
              <img
                src={`${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photoId}/view?size=preview`}
                alt={photoName}
                style={{ maxWidth: imageMaxWidth, maxHeight: imageMaxHeight }}
                width={1600}
                height={1067}
                className="block h-auto max-h-[60dvh] w-auto max-w-full select-none object-contain"
                draggable={false}
              />
              <svg
                className="absolute inset-0 h-full w-full touch-none"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
                style={{ cursor: isDrawMode || isPinMode ? "crosshair" : "default" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {sortedAnnotations.map((a) => {
                  if (!a.path_pct || a.path_pct.length <= 1) return null;
                  return <StrokeLine key={a.id} points={strokeToPoints(a.path_pct)} />;
                })}
                {currentStroke && currentStroke.length > 1 && (
                  <StrokeLine points={strokeToPoints(currentStroke)} />
                )}
                {pendingStroke && pendingStroke.length > 1 && (
                  <StrokeLine points={strokeToPoints(pendingStroke)} />
                )}
              </svg>

              {/* Badge số đánh dấu render bằng HTML tròn thật (không dùng SVG circle) vì
                  viewBox 100x100 + preserveAspectRatio="none" kéo giãn không đều theo 2 trục
                  khi ảnh không vuông, khiến circle bị méo thành hình elip. */}
              <div className="pointer-events-none absolute inset-0">
                {sortedAnnotations.map((a, index) => {
                  const center = a.path_pct ? boundingCenter(a.path_pct) : { x: a.pos_x_pct, y: a.pos_y_pct };
                  return (
                    <span
                      key={a.id}
                      style={{ left: `${center.x}%`, top: `${center.y}%`, transform: "translate(-50%, -50%)" }}
                      className="absolute flex size-6 items-center justify-center rounded-full border-2 border-black bg-zinc-800 text-xs font-semibold text-zinc-100"
                    >
                      {index + 1}
                    </span>
                  );
                })}
                {pendingPoint && (
                  <span
                    style={{ left: `${pendingPoint.x}%`, top: `${pendingPoint.y}%`, transform: "translate(-50%, -50%)" }}
                    className="absolute size-4 rounded-full border-2 border-black bg-indigo-400"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Thanh công cụ vẽ: nằm trong luồng bố cục (không absolute) để không bao giờ đè lên
              ảnh hay thanh tiêu đề. */}
          {!drawDisabled && !hasPending && (
            <div className="flex shrink-0 justify-center px-3 pb-3 pt-1 md:pb-5">
              <div
                role="toolbar"
                aria-label="Công cụ khoanh vùng"
                className="flex items-center gap-1 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-lg"
              >
                {TOOLS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    title={t.label}
                    aria-label={t.label}
                    aria-pressed={isDrawMode && tool === t.key}
                    onClick={() => {
                      setTool(t.key);
                      setIsDrawMode(true);
                      setIsPinMode(false);
                    }}
                    className={`flex size-11 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 md:size-10 ${
                      isDrawMode && tool === t.key ? "bg-indigo-500 text-white" : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {t.icon}
                  </button>
                ))}
                <button
                  type="button"
                  title="Ghim 1 điểm"
                  aria-label="Ghim 1 điểm lên ảnh"
                  aria-pressed={isPinMode}
                  onClick={() => {
                    setIsPinMode((v) => !v);
                    setIsDrawMode(false);
                  }}
                  className={`flex size-11 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 md:size-10 ${
                    isPinMode ? "bg-indigo-500 text-white" : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  <MapPinIcon />
                </button>
                <div className="mx-1 h-6 w-px bg-zinc-700" aria-hidden="true" />
                <button
                  type="button"
                  title="Huỷ công cụ đang chọn"
                  aria-label="Huỷ công cụ đang chọn"
                  onClick={() => {
                    setIsDrawMode(false);
                    setIsPinMode(false);
                    setCurrentStroke(null);
                  }}
                  className="flex size-11 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 md:size-10"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          )}
          {(isDrawMode || isPinMode) && (
            <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-zinc-100" aria-live="polite">
              {isPinMode ? "Chạm vào ảnh để ghim vị trí" : "Kéo trên ảnh để khoanh vùng"}
            </p>
          )}
        </div>

        {/* Ghi chú — mobile: bottom sheet (tối đa 40% màn hình, ảnh luôn ≥ 60%); md+: sidebar. */}
        <aside
          aria-label="Ghi chú chỉnh sửa"
          className="flex max-h-[calc(40dvh-3.5rem)] shrink-0 flex-col rounded-t-2xl border-t border-white/10 bg-zinc-900 pb-[env(safe-area-inset-bottom)] md:max-h-none md:w-[340px] md:rounded-none md:border-l md:border-t-0 md:pb-0"
        >
          {/* Mobile: tiêu đề sheet là nút thu gọn/mở rộng. Desktop: tiêu đề tĩnh của sidebar. */}
          <button
            type="button"
            onClick={() => setIsSheetOpen((v) => !v)}
            aria-expanded={isSheetOpen}
            aria-controls={sheetId}
            className="flex min-h-12 w-full shrink-0 items-center justify-between gap-3 px-4 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-400 md:hidden"
          >
            <span className="flex items-center gap-2">
              <span className="text-base font-semibold text-zinc-100">Ghi chú chỉnh sửa</span>
              <span className="rounded-full border border-white/10 bg-zinc-800 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-400">
                {annotations.length}
              </span>
            </span>
            <ChevronUpIcon
              size={18}
              className={`text-zinc-400 transition-transform ${isSheetOpen ? "rotate-180" : ""}`}
            />
          </button>
          <div className="hidden shrink-0 items-center justify-between border-b border-white/10 px-6 py-5 md:flex">
            <h3 className="text-xl font-semibold text-zinc-100">Ghi chú chỉnh sửa</h3>
            <span className="rounded-full border border-white/10 bg-zinc-800 px-2.5 py-1 text-xs font-medium tabular-nums text-zinc-400">
              {annotations.length} ghi chú
            </span>
          </div>

          <div
            id={sheetId}
            className={`${isSheetOpen ? "flex" : "hidden"} min-h-0 flex-1 flex-col md:flex`}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 md:p-4">
              {error && (
                <p role="alert" className="mb-3 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              )}
              {sortedAnnotations.length === 0 && (
                <p className="text-pretty text-sm text-zinc-400">
                  Chưa có ghi chú nào — dùng công cụ dưới ảnh để khoanh vùng hoặc ghim 1 điểm.
                </p>
              )}
              <ol className="flex flex-col gap-3">
                {sortedAnnotations.map((a, index) => (
                  <li key={a.id} className="rounded-lg border border-white/10 bg-zinc-950 p-3 md:p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm text-zinc-100">{a.note_text}</p>
                        <p className="mt-1.5 text-xs text-zinc-500">{formatRelativeTime(a.created_at)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Ô soạn ghi chú: trên mobile chỉ hiện khi sheet mở hoặc đang có vùng chờ lưu. */}
          {!drawDisabled && (
            <div
              className={`${isSheetOpen || hasPending ? "block" : "hidden"} shrink-0 border-t border-white/10 p-3 md:block`}
            >
              <label htmlFor={`${sheetId}-note`} className="sr-only">
                {hasPending ? "Nội dung ghi chú cho vùng đã khoanh" : "Ghi chú chung cho ảnh"}
              </label>
              <textarea
                id={`${sheetId}-note`}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                maxLength={2000}
                autoFocus={hasPending && finePointer}
                placeholder={hasPending ? "Ví dụ: chỉnh sáng vùng này, xoá vết…" : "Viết ghi chú chung cho ảnh…"}
                className="w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-indigo-400 md:text-sm"
              />
              <div className="mt-2 flex gap-2">
                {hasPending && (
                  <button
                    type="button"
                    onClick={cancelPending}
                    className="h-11 flex-1 rounded-lg border border-white/10 px-3 text-sm text-zinc-100 transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 md:h-10"
                  >
                    Huỷ
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (hasPending ? saveAnnotation() : saveAnnotation({ x: 50, y: 50 }))}
                  disabled={isSaving || noteText.trim().length === 0}
                  className="h-11 flex-1 rounded-lg bg-indigo-500 px-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:opacity-50 md:h-10"
                >
                  {isSaving ? "Đang lưu…" : hasPending ? "Lưu ghi chú" : "Thêm ghi chú chung"}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function StrokeLine({ points }: { points: string }) {
  return (
    <polyline
      points={points}
      fill="none"
      stroke="#000000"
      strokeWidth={1.4}
      strokeDasharray="2,1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}
