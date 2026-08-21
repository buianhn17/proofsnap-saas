// Bước 2.2 — modal xem ảnh full-size + vẽ ghi chú khoanh vùng tự do (không phải 1 điểm cố
// định, không phải khung kéo-thả) lên ảnh. Khách kéo chuột/ngón tay để vẽ 1 nét, nhập ghi
// chú, lưu lại. SVG overlay dùng viewBox="0 0 100 100" + preserveAspectRatio="none" đúng
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

interface PhotoAnnotationLightboxProps {
  albumId: string;
  photoId: string;
  photoName: string;
  onClose: () => void;
}

const MAX_PATH_POINTS = 500;

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

export default function PhotoAnnotationLightbox({
  albumId,
  photoId,
  photoName,
  onClose,
}: PhotoAnnotationLightboxProps) {
  const { album } = useClientAlbum();
  const expired = useIsAlbumExpired();

  const [annotations, setAnnotations] = useState<AnnotationDto[]>([]);
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<AnnotationPoint[] | null>(null);
  const [pendingStroke, setPendingStroke] = useState<AnnotationPoint[] | null>(null);
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

  function pointFromEvent(e: ReactPointerEvent<SVGSVGElement>): AnnotationPoint {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
  }

  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (!isDrawMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isPointerDown.current = true;
    setCurrentStroke([pointFromEvent(e)]);
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!isDrawMode || !isPointerDown.current) return;
    setCurrentStroke((prev) => (prev ? [...prev, pointFromEvent(e)] : prev));
  }

  function handlePointerUp() {
    if (!isDrawMode || !isPointerDown.current) return;
    isPointerDown.current = false;
    setCurrentStroke((prev) => {
      if (prev && prev.length > 0) {
        setPendingStroke(downsample(prev, MAX_PATH_POINTS));
      }
      return null;
    });
    setIsDrawMode(false);
  }

  function cancelPendingStroke() {
    setPendingStroke(null);
    setNoteText("");
  }

  async function saveAnnotation() {
    if (!pendingStroke || noteText.trim().length === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      const center = boundingCenter(pendingStroke);
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
      cancelPendingStroke();
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
  const strokeToPoints = (points: AnnotationPoint[]) =>
    points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-200">
        <button type="button" onClick={onClose} className="hover:text-white">
          ← Đóng
        </button>
        <span className="truncate px-2">{photoName}</span>
        <button
          type="button"
          disabled={drawDisabled || pendingStroke !== null}
          onClick={() => setIsDrawMode((prev) => !prev)}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
            isDrawMode
              ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
              : "border-slate-500 text-slate-200 hover:bg-white/10"
          }`}
        >
          {isDrawMode ? "Đang vẽ — kéo trên ảnh" : "Vẽ ghi chú"}
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4">
        <div className="relative inline-block max-h-full max-w-full">
          <img
            src={`${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photoId}/view`}
            alt={photoName}
            className="block max-h-[75vh] max-w-full select-none object-contain"
            draggable={false}
          />
          <svg
            className="absolute inset-0 h-full w-full touch-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ cursor: isDrawMode ? "crosshair" : "default" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {annotations.map((a) => (
              <g key={a.id} opacity={0.85}>
                {a.path_pct && a.path_pct.length > 1 && (
                  <polyline
                    points={strokeToPoints(a.path_pct)}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth={0.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <circle cx={a.pos_x_pct} cy={a.pos_y_pct} r={1} fill="#fbbf24">
                  <title>{a.note_text}</title>
                </circle>
              </g>
            ))}
            {currentStroke && currentStroke.length > 1 && (
              <polyline
                points={strokeToPoints(currentStroke)}
                fill="none"
                stroke="#34d399"
                strokeWidth={0.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {pendingStroke && pendingStroke.length > 1 && (
              <polyline
                points={strokeToPoints(pendingStroke)}
                fill="none"
                stroke="#34d399"
                strokeWidth={0.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>
      </div>

      {pendingStroke && (
        <div className="border-t border-white/10 px-4 py-3">
          <label className="block text-xs font-medium text-slate-300">
            Nhập ghi chú cho nét vừa vẽ
          </label>
          <div className="mt-2 flex items-start gap-2">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={2}
              maxLength={2000}
              autoFocus
              placeholder="Ví dụ: chỉnh sáng vùng này, xóa vết..."
              className="flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-400 focus:outline-none"
            />
            <div className="flex shrink-0 flex-col gap-2">
              <button
                type="button"
                onClick={saveAnnotation}
                disabled={isSaving || noteText.trim().length === 0}
                className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {isSaving ? "Đang lưu..." : "Lưu"}
              </button>
              <button
                type="button"
                onClick={cancelPendingStroke}
                className="rounded-md border border-slate-500 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="border-t border-white/10 px-4 py-2 text-center text-xs text-red-400">
          {error}
        </p>
      )}

      {annotations.length > 0 && (
        <div className="max-h-32 overflow-y-auto border-t border-white/10 px-4 py-3 text-xs text-slate-300">
          <p className="mb-1 font-medium text-slate-400">
            Ghi chú của bạn ({annotations.length})
          </p>
          <ul className="space-y-1">
            {annotations.map((a) => (
              <li key={a.id} className="truncate">
                • {a.note_text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
