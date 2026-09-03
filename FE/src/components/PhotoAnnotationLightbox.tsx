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
import { useClientAlbum, useIsAlbumExpired } from "../contexts/ClientAlbumContext";

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

const TOOLS: { key: DrawTool; label: string; icon: string }[] = [
  { key: "pen", label: "Vẽ tự do", icon: "✏️" },
  { key: "circle", label: "Khoanh tròn", icon: "◯" },
  { key: "rectangle", label: "Khoanh vuông", icon: "▢" },
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
    <div className="fixed inset-0 z-50 flex flex-col bg-[#131313]">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#43474f] bg-[#1c1b1b] px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="text-xl text-[#e5e2e1] hover:text-white"
          >
            ✕
          </button>
          {albumName && (
            <span className="text-base font-semibold text-[#e5e2e1]">{albumName}</span>
          )}
          <span className="truncate text-sm text-[#c1c6d4]">{photoName}</span>
        </div>
        <div className="flex items-center gap-4">
          {showNav && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate!(-1)}
                disabled={currentIndex === 0}
                className="text-[#c1c6d4] hover:text-[#e5e2e1] disabled:opacity-30"
              >
                ‹
              </button>
              <span className="text-sm text-[#c1c6d4]">
                {currentIndex! + 1} / {totalCount}
              </span>
              <button
                type="button"
                onClick={() => onNavigate!(1)}
                disabled={currentIndex === totalCount! - 1}
                className="text-[#c1c6d4] hover:text-[#e5e2e1] disabled:opacity-30"
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
              className={`flex items-center gap-2 rounded-[4px] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? "bg-[#a9c7ff] text-white hover:bg-[#93b6f5]"
                  : "border border-[#43474f] text-[#e5e2e1] hover:bg-[#2a2a2a]"
              }`}
            >
              <span className={isSelected ? "text-red-400" : ""}>
                {isSelected ? "♥" : "♡"}
              </span>
              {isSelected ? "Đã chọn ảnh này" : "Chọn ảnh này"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
          <div className="relative inline-block max-h-full max-w-full">
            <img
              src={`${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photoId}/view?size=preview`}
              alt={photoName}
              className="block max-h-[75vh] max-w-full select-none object-contain"
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
                    className="absolute flex size-6 items-center justify-center rounded-full border-2 border-black bg-[#2a2a2a] text-xs font-semibold text-[#e5e2e1]"
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
                  className="absolute size-4 rounded-full border-2 border-black bg-[#93b6f5]"
                />
              )}
            </div>
          </div>

          {!drawDisabled && !hasPending && (
            <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[8px] border border-[#43474f] bg-[#1c1b1b] p-1.5 shadow-lg">
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
                  className={`flex size-9 items-center justify-center rounded-[6px] text-base ${
                    isDrawMode && tool === t.key
                      ? "bg-[#a9c7ff] text-white"
                      : "text-[#c1c6d4] hover:bg-[#2a2a2a]"
                  }`}
                >
                  {t.icon}
                </button>
              ))}
              <div className="mx-1 h-6 w-px bg-[#43474f]" />
              <button
                type="button"
                title="Hủy công cụ đang chọn"
                onClick={() => {
                  setIsDrawMode(false);
                  setCurrentStroke(null);
                }}
                className="flex size-9 items-center justify-center rounded-[6px] text-base text-[#c1c6d4] hover:bg-[#2a2a2a]"
              >
                🗑️
              </button>
            </div>
          )}
        </div>

        <div className="flex w-[340px] shrink-0 flex-col border-l border-[#43474f] bg-[#1c1b1b]">
          <div className="flex items-center justify-between border-b border-[#43474f] px-6 py-5">
            <h2 className="text-xl font-semibold text-[#e5e2e1]">Ghi chú chỉnh sửa</h2>
            <span className="rounded-full border border-[#43474f] bg-[#2a2a2a] px-2.5 py-1 text-xs font-medium text-[#c1c6d4]">
              {annotations.length} Ghi chú
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {error && (
              <p className="mb-3 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            {sortedAnnotations.length === 0 && (
              <p className="text-sm text-[#c1c6d4]">
                Chưa có ghi chú nào — dùng công cụ bên dưới ảnh hoặc ghim 1 điểm để bắt đầu.
              </p>
            )}
            <div className="flex flex-col gap-3">
              {sortedAnnotations.map((a, index) => (
                <div
                  key={a.id}
                  className="rounded-[4px] border border-[#43474f] bg-[#131313] p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#a9c7ff] text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#e5e2e1]">{a.note_text}</p>
                      <p className="mt-1.5 text-xs text-[#8b919e]">
                        {formatRelativeTime(a.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!drawDisabled && (
            <div className="border-t border-[#43474f] p-3">
              {hasPending ? (
                <>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    autoFocus
                    placeholder="Ví dụ: chỉnh sáng vùng này, xóa vết..."
                    className="w-full resize-none rounded-[4px] border border-[#43474f] bg-[#131313] px-3 py-2 text-sm text-[#e5e2e1] placeholder:text-[#5a5958] focus:outline-none focus:ring-1 focus:ring-[#a9c7ff]"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={cancelPending}
                      className="flex-1 rounded-[4px] border border-[#43474f] px-3 py-2 text-sm text-[#e5e2e1] hover:bg-[#2a2a2a]"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={() => saveAnnotation()}
                      disabled={isSaving || noteText.trim().length === 0}
                      className="flex-1 rounded-[4px] bg-[#a9c7ff] px-3 py-2 text-sm font-semibold text-white hover:bg-[#93b6f5] disabled:opacity-50"
                    >
                      {isSaving ? "Đang lưu..." : "Lưu ghi chú"}
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
                    placeholder="Nhấn vào ảnh để ghim vị trí hoặc viết ghi chú chung..."
                    className="w-full resize-none rounded-[4px] border border-[#43474f] bg-[#131313] px-3 py-2 text-sm text-[#e5e2e1] placeholder:text-[#5a5958] focus:outline-none focus:ring-1 focus:ring-[#a9c7ff]"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsPinMode((v) => !v);
                        setIsDrawMode(false);
                      }}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[4px] border px-3 py-2 text-sm ${
                        isPinMode
                          ? "border-[#a9c7ff] text-[#a9c7ff]"
                          : "border-[#43474f] text-[#c1c6d4] hover:bg-[#2a2a2a]"
                      }`}
                    >
                      📍 {isPinMode ? "Nhấn vào ảnh..." : "Click ảnh để ghim"}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveAnnotation({ x: 50, y: 50 })}
                      disabled={isSaving || noteText.trim().length === 0}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-[4px] bg-[#a9c7ff] px-3 py-2 text-sm font-semibold text-white hover:bg-[#93b6f5] disabled:opacity-50"
                    >
                      {isSaving ? "Đang lưu..." : "+ Thêm ghi chú mới"}
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
