// Bước 2.2 — modal xem ảnh full-size + vẽ ghi chú khoanh vùng lên ảnh. Khách chọn 1 trong 3
// công cụ (bút vẽ tự do / khoanh tròn / khoanh chữ nhật) hoặc ghim 1 điểm, nhập ghi chú, lưu
// lại. Cả 3 công cụ vẽ hình đều quy về CÙNG 1 field `path_pct` sẵn có (đa giác toạ độ %) —
// khoanh tròn/chữ nhật chỉ là cách TẠO ra path_pct khác nhau (lấy mẫu điểm quanh hình), không
// cần đổi schema DB. SVG overlay dùng viewBox="0 0 100 100" + preserveAspectRatio="none" đúng
// bằng kích thước ảnh đang render (không phải kích thước gốc) — nhờ vậy toạ độ % capture từ
// pointer event và toạ độ % lưu trong path_pct luôn khớp nhau mà không cần quy đổi thêm.

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isAxiosError } from "axios";
import { api } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { HeartIcon, MapPinIcon, PencilIcon, TrashIcon, XIcon } from "./Icons";
import { useClientAlbum, useIsAlbumExpired } from "../contexts/ClientAlbumContext";
import { useEscapeKey } from "../lib/useEscapeKey";

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

  const drawDisabled = expired || album?.is_locked === true;
  const hasPending = pendingStroke !== null || pendingPoint !== null;
  const strokeToPoints = (points: AnnotationPoint[]) =>
    points.map((p) => `${p.x},${p.y}`).join(" ");
  const showNav =
    currentIndex !== undefined && totalCount !== undefined && onNavigate !== undefined;

  return (
    <div role="dialog" aria-modal="true" aria-label="Xem ảnh và ghi chú" className="fixed inset-0 z-50 flex flex-col bg-zinc-950">
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-zinc-900 px-2 pt-[env(safe-area-inset-top)] sm:h-16 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-100 transition hover:bg-white/10 active:scale-90"
          >
            <XIcon size={20} />
          </button>
          <div className="min-w-0">
            {albumName && <p className="hidden truncate text-base font-semibold text-zinc-100 sm:block">{albumName}</p>}
            <p className="truncate text-sm text-zinc-400" translate="no">{photoName}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          {showNav && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate!(-1)}
                disabled={currentIndex === 0}
                aria-label="Ảnh trước"
                className="flex size-8 items-center justify-center rounded-lg text-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                ‹
              </button>
              <span className="text-sm tabular-nums text-zinc-400">
                {currentIndex! + 1} / {totalCount}
              </span>
              <button
                type="button"
                onClick={() => onNavigate!(1)}
                disabled={currentIndex === totalCount! - 1}
                aria-label="Ảnh tiếp theo"
                className="flex size-8 items-center justify-center rounded-lg text-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                ›
              </button>
            </div>
          )}
          {onToggleSelect && (
            <button
              type="button"
              onClick={onToggleSelect}
              disabled={expired}
              title={expired ? "Đã hết hạn chọn ảnh" : "Thả tim"}
              aria-pressed={isSelected}
              className={`flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 ${
                isSelected
                  ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                  : "bg-white/10 text-zinc-100 hover:bg-white/15"
              }`}
            >
              <HeartIcon size={17} fill={isSelected ? "currentColor" : "none"} />
              <span className="hidden sm:inline">{isSelected ? "Đã thích" : "Thả tim"}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-6">
          <div className="relative inline-block max-h-full max-w-full">
            <img
              src={`${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photoId}/view?size=preview`}
              alt={photoName}
              className="block max-h-[52dvh] max-w-full select-none object-contain lg:max-h-[75vh]"
              draggable={false}
            />
            <svg
              className="absolute inset-0 h-full w-full touch-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ cursor: isDrawMode || isPinMode ? "crosshair" : "default" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {sortedAnnotations.map((a) => {
                if (!a.path_pct || a.path_pct.length <= 1) return null;
                return (
                  <polyline
                    key={a.id}
                    points={strokeToPoints(a.path_pct)}
                    fill="none"
                    stroke="#000000"
                    strokeWidth={1.4}
                    strokeDasharray="2,1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {currentStroke && currentStroke.length > 1 && (
                <polyline
                  points={strokeToPoints(currentStroke)}
                  fill="none"
                  stroke="#000000"
                  strokeWidth={1.4}
                  strokeDasharray="2,1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {pendingStroke && pendingStroke.length > 1 && (
                <polyline
                  points={strokeToPoints(pendingStroke)}
                  fill="none"
                  stroke="#000000"
                  strokeWidth={1.4}
                  strokeDasharray="2,1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/* Bước fix — badge số đánh dấu render bằng HTML tròn thật (không dùng SVG
                circle) vì viewBox 100x100 + preserveAspectRatio="none" kéo giãn không đều
                theo 2 trục khi ảnh không vuông, khiến circle bị méo thành hình elip. */}
            <div className="pointer-events-none absolute inset-0">
              {sortedAnnotations.map((a, index) => {
                const center = a.path_pct
                  ? boundingCenter(a.path_pct)
                  : { x: a.pos_x_pct, y: a.pos_y_pct };
                return (
                  <span
                    key={a.id}
                    style={{
                      left: `${center.x}%`,
                      top: `${center.y}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                    className="absolute flex size-6 items-center justify-center rounded-full border-2 border-black bg-zinc-800 text-xs font-semibold text-zinc-100"
                  >
                    {index + 1}
                  </span>
                );
              })}
              {pendingPoint && (
                <span
                  style={{
                    left: `${pendingPoint.x}%`,
                    top: `${pendingPoint.y}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                  className="absolute size-4 rounded-full border-2 border-black bg-indigo-400"
                />
              )}
            </div>
          </div>

          {!drawDisabled && !hasPending && (
            <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-zinc-900 p-1.5 shadow-lg">
              {TOOLS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  title={t.label}
                  onClick={() => {
                    setTool(t.key);
                    setIsDrawMode(true);
                    setIsPinMode(false);
                  }}
                  className={`flex size-9 items-center justify-center rounded-lg text-base ${
                    isDrawMode && tool === t.key
                      ? "bg-indigo-500 text-white"
                      : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {t.icon}
                </button>
              ))}
              <div className="mx-1 h-6 w-px bg-zinc-700" />
              <button
                type="button"
                title="Hủy công cụ đang chọn"
                onClick={() => {
                  setIsDrawMode(false);
                  setCurrentStroke(null);
                }}
                className="flex size-9 items-center justify-center rounded-lg text-base text-zinc-400 hover:bg-zinc-800"
              >
                <TrashIcon />
              </button>
            </div>
          )}
        </div>

        {/* Điện thoại: ghi chú nằm dưới ảnh; màn lớn: cột bên phải */}
        <div className="flex max-h-[42dvh] w-full shrink-0 flex-col border-t border-white/10 bg-zinc-900 pb-[env(safe-area-inset-bottom)] lg:max-h-none lg:w-[340px] lg:border-l lg:border-t-0 lg:pb-0">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6 sm:py-5">
            <h2 className="text-base font-semibold text-zinc-100 sm:text-xl">Ghi chú chỉnh sửa</h2>
            <span className="rounded-full border border-white/10 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-400">
              {annotations.length} Ghi chú
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {error && (
              <p className="mb-3 rounded-md bg-rose-950/50 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            )}
            {sortedAnnotations.length === 0 && (
              <p className="text-sm text-zinc-400">
                Chưa có ghi chú nào — dùng công cụ bên dưới ảnh hoặc ghim 1 điểm để bắt đầu.
              </p>
            )}
            <div className="flex flex-col gap-3">
              {sortedAnnotations.map((a, index) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-white/10 bg-zinc-950 p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-100">{a.note_text}</p>
                      <p className="mt-1.5 text-xs text-zinc-500">
                        {formatRelativeTime(a.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!drawDisabled && (
            <div className="border-t border-white/10 p-3">
              {hasPending ? (
                <>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    autoFocus
                    aria-label="Nội dung ghi chú tại điểm ghim"
                    placeholder="Ví dụ: chỉnh sáng vùng này, xóa vết…"
                    className="w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={cancelPending}
                      className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={() => saveAnnotation()}
                      disabled={isSaving || noteText.trim().length === 0}
                      className="flex-1 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
                    >
                      {isSaving ? "Đang lưu…" : "Lưu ghi chú"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    aria-label="Ghi chú chung cho ảnh"
                    placeholder="Nhấn vào ảnh để ghim vị trí hoặc viết ghi chú chung…"
                    className="w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsPinMode((v) => !v);
                        setIsDrawMode(false);
                      }}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${
                        isPinMode
                          ? "border-indigo-500 text-indigo-300"
                          : "border-white/10 text-zinc-400 hover:bg-zinc-800"
                      }`}
                    >
                      <MapPinIcon size={14} /> {isPinMode ? "Nhấn vào ảnh…" : "Nhấn ảnh để ghim"}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveAnnotation({ x: 50, y: 50 })}
                      disabled={isSaving || noteText.trim().length === 0}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
                    >
                      {isSaving ? "Đang lưu…" : "+ Thêm ghi chú mới"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
