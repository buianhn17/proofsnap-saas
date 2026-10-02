// Bước 2.2 — trang Admin xem lại toàn bộ ghi chú khoanh vùng khách đã vẽ trong album: vị trí
// đã khoanh (marker + nét vẽ, vẽ lại bằng SVG overlay giống PhotoAnnotationLightbox.tsx bên
// Client Portal) và nội dung ghi chú, gom theo từng ảnh.
// Bước 4.1 — mở rộng thành trang tổng hợp toàn bộ "yêu cầu chỉnh sửa": không chỉ ảnh có ghi
// chú, mà cả ảnh khách đã thả tim (dù chưa ghi chú gì) — cùng nút copy chuỗi tên file dán vào
// Lightroom/Photoshop. Gọi POST /filename-export thay vì 2 request GET photos+annotations
// riêng — BE trả sẵn cả 2 gộp theo từng ảnh.
// Bước — chuyển từ "liệt kê tất cả ảnh trên 1 trang dài" sang xem TỪNG ảnh một kèm sidebar
// chi tiết yêu cầu: đánh dấu hoàn tất từng yêu cầu, hoàn tất cả loạt, và ghi chú nội
// bộ/phản hồi khách theo ảnh (xem migration 005_annotation_status_and_notes.sql).
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import type { Album } from "../../lib/types";

interface AnnotationPoint {
  x: number;
  y: number;
}

interface AnnotationDto {
  id: string;
  photo_id: string;
  pos_x_pct: number;
  pos_y_pct: number;
  path_pct: AnnotationPoint[] | null;
  note_text: string;
  status: "pending" | "done";
  created_at: string;
  client_name: string;
  client_phone: string;
}

interface PhotoNoteDto {
  id: string;
  photo_id: string;
  kind: "internal" | "client_reply";
  note_text: string;
  created_at: string;
}

interface EditRequestPhoto {
  id: string;
  original_base_filename: string;
  created_at: string;
  annotations: AnnotationDto[];
  notes: PhotoNoteDto[];
}

interface FilenameExportResponse {
  photos: EditRequestPhoto[];
  filename_list: string[];
  search_string: string;
  exported_at: string;
}

const MARKER_COLORS = [
  { border: "#f87171", dot: "#f87171" },
  { border: "#fbbf24", dot: "#fbbf24" },
  { border: "#818cf8", dot: "#818cf8" },
  { border: "#34d399", dot: "#34d399" },
];

function formatTime(value: string) {
  const d = new Date(value);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isToday) {
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  }
  if (d.toDateString() === yesterday.toDateString()) return "Hôm qua";
  return d.toLocaleDateString("vi-VN");
}

export default function AlbumAnnotationsPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [exportData, setExportData] = useState<FilenameExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [noteText, setNoteText] = useState("");
  const [noteMode, setNoteMode] = useState<"internal" | "client_reply">("internal");
  const [isPostingNote, setIsPostingNote] = useState(false);
  const [pendingStatusIds, setPendingStatusIds] = useState<Set<string>>(new Set());
  const [isCompleting, setIsCompleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!albumId) return;
    Promise.all([
      api.get<{ album: Album }>(`/api/albums/${albumId}`),
      api.post<FilenameExportResponse>(`/api/albums/${albumId}/filename-export`),
    ])
      .then(([albumRes, exportRes]) => {
        setAlbum(albumRes.data.album);
        setExportData(exportRes.data);
      })
      .catch((err) => setError(getErrorMessage(err, "Không tải được yêu cầu chỉnh sửa")));
  }, [albumId]);

  const photos = exportData?.photos ?? [];
  const currentPhoto = photos[photoIndex] ?? null;

  const sortedAnnotations = useMemo(() => {
    if (!currentPhoto) return [];
    return [...currentPhoto.annotations].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [currentPhoto]);

  async function handleCopy() {
    if (!exportData || !exportData.search_string) return;
    await navigator.clipboard.writeText(exportData.search_string);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function updateAnnotationInState(photoId: string, updated: AnnotationDto) {
    setExportData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        photos: prev.photos.map((p) =>
          p.id !== photoId
            ? p
            : {
                ...p,
                annotations: p.annotations.map((a) => (a.id === updated.id ? updated : a)),
              }
        ),
      };
    });
  }

  async function toggleAnnotationStatus(annotation: AnnotationDto) {
    if (!albumId) return;
    const nextStatus = annotation.status === "done" ? "pending" : "done";
    setPendingStatusIds((prev) => new Set(prev).add(annotation.id));
    setActionError(null);
    try {
      const { data } = await api.patch<{ annotation: AnnotationDto }>(
        `/api/albums/${albumId}/annotations/${annotation.id}`,
        { status: nextStatus }
      );
      updateAnnotationInState(annotation.photo_id, data.annotation);
    } catch (err) {
      setActionError(getErrorMessage(err, "Không thể cập nhật trạng thái"));
    } finally {
      setPendingStatusIds((prev) => {
        const next = new Set(prev);
        next.delete(annotation.id);
        return next;
      });
    }
  }

  async function handleCompleteEdits() {
    if (!albumId || !currentPhoto) return;
    setIsCompleting(true);
    setActionError(null);
    try {
      await api.post(`/api/albums/${albumId}/photos/${currentPhoto.id}/complete-edits`);
      setExportData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          photos: prev.photos.map((p) =>
            p.id !== currentPhoto.id
              ? p
              : { ...p, annotations: p.annotations.map((a) => ({ ...a, status: "done" })) }
          ),
        };
      });
    } catch (err) {
      setActionError(getErrorMessage(err, "Không thể hoàn tất chỉnh sửa"));
    } finally {
      setIsCompleting(false);
    }
  }

  async function handleAddNote() {
    if (!albumId || !currentPhoto || !noteText.trim()) return;
    setIsPostingNote(true);
    setActionError(null);
    try {
      const { data } = await api.post<{ note: PhotoNoteDto }>(
        `/api/albums/${albumId}/photos/${currentPhoto.id}/notes`,
        { kind: noteMode, note_text: noteText.trim() }
      );
      setExportData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          photos: prev.photos.map((p) =>
            p.id !== currentPhoto.id ? p : { ...p, notes: [...p.notes, data.note] }
          ),
        };
      });
      setNoteText("");
      setNoteMode("internal");
    } catch (err) {
      setActionError(getErrorMessage(err, "Không thể lưu ghi chú"));
    } finally {
      setIsPostingNote(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-950/40 p-4 text-sm text-rose-300">
        {error}
      </div>
    );
  }

  if (!exportData || !album) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-zinc-400">
        <span className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        Đang tải yêu cầu chỉnh sửa...
      </div>
    );
  }

  return (
    <div className="-m-6 sm:-m-8 lg:-m-10 flex h-screen flex-col bg-[#090a0f] text-slate-100">
      {/* Top Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-zinc-950/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
          <Link to="/admin/albums" className="hover:text-white transition-colors">
            Kho Album
          </Link>
          <span className="text-zinc-600">/</span>
          <Link to={`/admin/albums/${albumId}`} className="hover:text-white transition-colors">
            {album.name}
          </Link>
          <span className="text-zinc-600">/</span>
          <span className="text-indigo-400 font-semibold">Yêu cầu chỉnh sửa</span>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setNoteMode("client_reply")}
            className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
          >
            Phản hồi khách hàng
          </button>
          <button
            type="button"
            onClick={handleCompleteEdits}
            disabled={!currentPhoto || isCompleting}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-400 hover:to-indigo-500 disabled:opacity-50"
          >
            {isCompleting ? "Đang lưu..." : "Hoàn tất ảnh này"}
          </button>
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-zinc-400">
          <svg className="h-12 w-12 text-zinc-600 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <p className="text-sm font-semibold text-zinc-300">Chưa có ảnh nào có yêu cầu chỉnh sửa</p>
          <p className="text-xs text-zinc-500 mt-1">Khi khách hàng thả tim hoặc vẽ ghi chú khoanh vùng, danh sách sẽ xuất hiện tại đây.</p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Center Image Canvas */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Toolbar for Lightroom export & Photo pagination */}
            <div className="flex items-center justify-between border-b border-white/10 bg-zinc-900/40 px-6 py-2.5 backdrop-blur-sm">
              <div className="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-1 text-xs text-zinc-300 font-mono">
                Tìm kiếm Lightroom: {exportData.filename_list.length} ảnh đã chọn
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!exportData.search_string}
                  className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:opacity-50"
                >
                  {copied ? "✓ Đã sao chép chuỗi!" : "Copy chuỗi tìm kiếm Lightroom"}
                </button>
                <div className="h-4 w-px bg-white/10 mx-1" />
                <button
                  type="button"
                  onClick={() => setPhotoIndex((i) => Math.max(0, i - 1))}
                  disabled={photoIndex === 0}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white hover:bg-white/10 disabled:opacity-30"
                >
                  ←
                </button>
                <span className="text-xs text-zinc-400 font-mono">
                  {photoIndex + 1} / {photos.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPhotoIndex((i) => Math.min(photos.length - 1, i + 1))}
                  disabled={photoIndex === photos.length - 1}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white hover:bg-white/10 disabled:opacity-30"
                >
                  →
                </button>
              </div>
            </div>

            {/* Canvas Viewport */}
            <div className="flex flex-1 items-center justify-center overflow-auto p-6 bg-zinc-950/40">
              {currentPhoto && (
                <div
                  className="relative min-h-[400px] shrink-0 rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl transition-all"
                  style={{ width: `${zoom}%`, maxWidth: "100%" }}
                >
                  <img
                    src={`${import.meta.env.VITE_API_BASE_URL}/api/albums/${albumId}/photos/${currentPhoto.id}/view?size=preview`}
                    alt={currentPhoto.original_base_filename}
                    className="block w-full"
                  />
                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    {sortedAnnotations.map((a, index) => {
                      const color = MARKER_COLORS[index % MARKER_COLORS.length];
                      return (
                        <g key={a.id}>
                          {a.path_pct && a.path_pct.length > 1 && (
                            <polyline
                              points={a.path_pct.map((p) => `${p.x},${p.y}`).join(" ")}
                              fill="none"
                              stroke={color.border}
                              strokeWidth={0.6}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          <rect
                            x={a.pos_x_pct - 4}
                            y={a.pos_y_pct - 4}
                            width={8}
                            height={8}
                            fill="none"
                            stroke={color.border}
                            strokeWidth={0.5}
                            vectorEffect="non-scaling-stroke"
                          />
                          <circle cx={a.pos_x_pct} cy={a.pos_y_pct} r={0.8} fill={color.dot} />
                        </g>
                      );
                    })}
                  </svg>
                  {sortedAnnotations.map((a, index) => (
                    <span
                      key={`label-${a.id}`}
                      style={{
                        position: "absolute",
                        left: `${a.pos_x_pct}%`,
                        top: `${a.pos_y_pct}%`,
                        transform: "translate(-50%, -170%)",
                      }}
                      className="rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white border border-white/20 shadow-md backdrop-blur-md"
                    >
                      #{index + 1}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Zoom controls */}
            <div className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 bg-zinc-950/60 px-6 py-2.5">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/80 px-3 py-1">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(25, z - 25))}
                  className="text-zinc-400 hover:text-white"
                >
                  🔍-
                </button>
                <span className="w-12 text-center text-xs font-mono text-zinc-200">{zoom}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(300, z + 25))}
                  className="text-zinc-400 hover:text-white"
                >
                  🔍+
                </button>
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="flex w-[380px] shrink-0 flex-col border-l border-white/10 bg-zinc-950/90 backdrop-blur-xl">
            <div className="border-b border-white/10 px-6 py-4">
              <h2 className="text-sm font-bold text-white">Yêu cầu & Ghi chú</h2>
              {currentPhoto && (
                <p className="mt-0.5 text-xs font-mono text-zinc-400">
                  {currentPhoto.original_base_filename}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {actionError && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-950/40 p-2.5 text-xs text-rose-300">
                  {actionError}
                </div>
              )}

              {sortedAnnotations.length === 0 && (
                <p className="text-xs text-zinc-500 text-center py-6">
                  Ảnh này chưa có ghi chú khoanh vùng từ khách hàng.
                </p>
              )}

              {sortedAnnotations.map((a, index) => {
                const color = MARKER_COLORS[index % MARKER_COLORS.length];
                const isDone = a.status === "done";
                const isBusy = pendingStatusIds.has(a.id);
                return (
                  <div
                    key={a.id}
                    className="rounded-2xl border border-white/10 bg-zinc-900/50 p-3.5 transition-colors hover:border-white/20"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-black font-mono"
                          style={{ backgroundColor: color.dot }}
                        >
                          {index + 1}
                        </span>
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider font-mono ${
                            isDone
                              ? "border-emerald-500/30 bg-emerald-950/60 text-emerald-300"
                              : "border-amber-500/30 bg-amber-950/60 text-amber-300"
                          }`}
                        >
                          {isDone ? "Đã xong" : "Chờ sửa"}
                        </span>
                      </div>
                      <span className="text-[11px] text-zinc-500 font-mono">
                        {formatTime(a.created_at)}
                      </span>
                    </div>
                    <p
                      className={`mt-2 text-xs leading-relaxed ${
                        isDone ? "text-zinc-500 line-through" : "text-zinc-200"
                      }`}
                    >
                      {a.note_text}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {a.client_name} • {a.client_phone}
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleAnnotationStatus(a)}
                      disabled={isBusy}
                      className={`mt-2.5 text-xs font-semibold hover:underline disabled:opacity-50 ${
                        isDone ? "text-emerald-400" : "text-indigo-400"
                      }`}
                    >
                      {isBusy
                        ? "Đang lưu..."
                        : isDone
                        ? "✓ Đã xử lý (Click để mở lại)"
                        : "✓ Đánh dấu hoàn tất"}
                    </button>
                  </div>
                );
              })}

              {currentPhoto && currentPhoto.notes.length > 0 && (
                <div className="mt-6 flex flex-col gap-2.5 border-t border-white/10 pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
                    Lịch sử phản hồi
                  </p>
                  {currentPhoto.notes.map((note) => (
                    <div key={note.id} className="rounded-xl border border-white/5 bg-zinc-900/30 p-3">
                      <p className="text-xs text-zinc-200">{note.note_text}</p>
                      <p className="mt-1 text-[10px] text-zinc-500 font-mono">
                        {note.kind === "client_reply" ? "Phản hồi khách" : "Ghi chú nội bộ"} • {formatTime(note.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reply / Internal Note Input Box */}
            <div className="border-t border-white/10 p-4 bg-zinc-950/60">
              {noteMode === "client_reply" && (
                <p className="mb-2 text-[11px] font-medium text-indigo-400">
                  Đang soạn phản hồi gửi khách —{" "}
                  <button
                    type="button"
                    onClick={() => setNoteMode("internal")}
                    className="underline text-zinc-400 hover:text-white"
                  >
                    chuyển sang ghi chú nội bộ
                  </button>
                </p>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddNote();
                  }}
                  placeholder={
                    noteMode === "client_reply"
                      ? "Viết phản hồi cho khách..."
                      : "Thêm ghi chú nội bộ thợ..."
                  }
                  className="flex-1 rounded-xl border border-white/10 bg-zinc-900/80 px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || isPostingNote}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                  aria-label="Gửi"
                >
                  ➤
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
