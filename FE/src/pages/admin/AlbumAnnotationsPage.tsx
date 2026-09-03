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
  { border: "#ffb4ab", dot: "#ffb4ab" },
  { border: "#ffb95e", dot: "#ffb95e" },
  { border: "#a9c7ff", dot: "#a9c7ff" },
  { border: "#86e8a8", dot: "#86e8a8" },
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
      <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
        {error}
      </p>
    );
  }

  if (!exportData || !album) {
    return <p className="text-sm text-[#c1c6d4]">Đang tải...</p>;
  }

  return (
    <div className="-m-8 flex h-screen flex-col bg-[#131313]">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#43474f] bg-[#201f1f] px-6">
        <div className="flex items-center gap-1.5 text-sm text-[#c1c6d4]">
          <Link to="/admin/albums" className="hover:text-[#e5e2e1]">
            Bộ sưu tập
          </Link>
          <span>›</span>
          <Link to={`/admin/albums/${albumId}`} className="hover:text-[#e5e2e1]">
            {album.name}
          </Link>
          <span>›</span>
          <span className="text-[#e5e2e1]">Yêu cầu chỉnh sửa</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setNoteMode("client_reply")}
            className="rounded-[4px] border border-[#43474f] px-4 py-2 text-sm font-medium text-[#e5e2e1] hover:bg-[#2a2a2a]"
          >
            Phản hồi khách hàng
          </button>
          <button
            type="button"
            onClick={handleCompleteEdits}
            disabled={!currentPhoto || isCompleting}
            className="rounded-[4px] bg-[#a9c7ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#93b6f5] disabled:opacity-50"
          >
            {isCompleting ? "Đang lưu..." : "Hoàn tất chỉnh sửa"}
          </button>
        </div>
      </div>

      {photos.length === 0 ? (
        <p className="p-6 text-sm text-[#c1c6d4]">
          Chưa có ảnh nào được khách thả tim hoặc ghi chú.
        </p>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#2a2a2a] px-6 py-3">
              <div className="rounded-[4px] border border-[#43474f] bg-[#1c1b1b] px-3 py-1.5 text-xs text-[#c1c6d4]">
                Chuỗi tìm kiếm Lightroom: {exportData.filename_list.length} tên file
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!exportData.search_string}
                  className="rounded-[4px] border border-[#43474f] px-3 py-1.5 text-xs font-medium text-[#e5e2e1] hover:bg-[#2a2a2a] disabled:opacity-50"
                >
                  {copied ? "Đã sao chép!" : "Sao chép chuỗi tên file"}
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoIndex((i) => Math.max(0, i - 1))}
                  disabled={photoIndex === 0}
                  className="rounded-[4px] border border-[#43474f] px-2 py-1 text-[#e5e2e1] hover:bg-[#2a2a2a] disabled:opacity-30"
                >
                  ←
                </button>
                <span className="text-xs text-[#c1c6d4]">
                  {photoIndex + 1} / {photos.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPhotoIndex((i) => Math.min(photos.length - 1, i + 1))}
                  disabled={photoIndex === photos.length - 1}
                  className="rounded-[4px] border border-[#43474f] px-2 py-1 text-[#e5e2e1] hover:bg-[#2a2a2a] disabled:opacity-30"
                >
                  →
                </button>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-center overflow-auto p-6">
              {currentPhoto && (
                <div
                  className="relative min-h-[400px] shrink-0 border border-[#2a2a2a] bg-[#1c1b1b]"
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
                      className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white"
                    >
                      #{index + 1}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-center gap-2 border-t border-[#2a2a2a] px-6 py-3">
              <div className="flex items-center gap-2 rounded-[4px] border border-[#43474f] bg-[#1c1b1b] px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(25, z - 25))}
                  className="text-[#c1c6d4] hover:text-[#e5e2e1]"
                >
                  🔍-
                </button>
                <span className="w-12 text-center text-sm text-[#e5e2e1]">{zoom}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(300, z + 25))}
                  className="text-[#c1c6d4] hover:text-[#e5e2e1]"
                >
                  🔍+
                </button>
              </div>
            </div>
          </div>

          <div className="flex w-[375px] shrink-0 flex-col border-l border-[#43474f] bg-[#1c1b1b]">
            <div className="border-b border-[#43474f] px-6 py-5">
              <h2 className="text-xl font-semibold text-[#e5e2e1]">Chi tiết yêu cầu</h2>
              {currentPhoto && (
                <p className="mt-1 text-sm text-[#c1c6d4]">
                  Ảnh {currentPhoto.original_base_filename}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {actionError && (
                <p className="mb-3 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
                  {actionError}
                </p>
              )}

              {sortedAnnotations.length === 0 && (
                <p className="text-sm text-[#c1c6d4]">
                  Ảnh này chưa có ghi chú khoanh vùng nào từ khách.
                </p>
              )}

              <div className="flex flex-col gap-4">
                {sortedAnnotations.map((a, index) => {
                  const color = MARKER_COLORS[index % MARKER_COLORS.length];
                  const isDone = a.status === "done";
                  const isBusy = pendingStatusIds.has(a.id);
                  return (
                    <div
                      key={a.id}
                      className="rounded-[4px] border border-[#43474f] bg-[#131313] p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="flex size-5 items-center justify-center rounded-full text-[10px] font-semibold text-[#131313]"
                            style={{ backgroundColor: color.dot }}
                          >
                            {index + 1}
                          </span>
                          <span
                            className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.6px] ${
                              isDone
                                ? "border-[#2d6a3f] bg-[#1a3d24] text-[#86e8a8]"
                                : "border-[#6b2e2e] bg-[#3d1a1a] text-[#ffb4ab]"
                            }`}
                          >
                            {isDone ? "Done" : "Pending"}
                          </span>
                        </div>
                        <span className="text-xs text-[#8b919e]">
                          {formatTime(a.created_at)}
                        </span>
                      </div>
                      <p
                        className={`mt-2 text-sm ${
                          isDone ? "text-[#5a5f68] line-through" : "text-[#e5e2e1]"
                        }`}
                      >
                        {a.note_text}
                      </p>
                      <p className="mt-1 text-xs text-[#8b919e]">
                        {a.client_name} · {a.client_phone}
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleAnnotationStatus(a)}
                        disabled={isBusy}
                        className={`mt-2 text-xs font-medium hover:underline disabled:opacity-50 ${
                          isDone ? "text-[#86e8a8]" : "text-[#a9c7ff]"
                        }`}
                      >
                        {isBusy
                          ? "Đang lưu..."
                          : isDone
                            ? "✓ Đã xử lý — bấm để mở lại"
                            : "✓ Đánh dấu hoàn tất"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {currentPhoto && currentPhoto.notes.length > 0 && (
                <div className="mt-6 flex flex-col gap-3 border-t border-[#2a2a2a] pt-4">
                  <p className="text-xs font-medium uppercase tracking-[0.6px] text-[#8b919e]">
                    Ghi chú & phản hồi
                  </p>
                  {currentPhoto.notes.map((note) => (
                    <div key={note.id} className="rounded-[4px] bg-[#131313] p-3">
                      <p className="text-sm text-[#e5e2e1]">{note.note_text}</p>
                      <p className="mt-1 text-xs text-[#8b919e]">
                        {note.kind === "client_reply" ? "Phản hồi gửi khách" : "Ghi chú nội bộ"}{" "}
                        · {formatTime(note.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[#43474f] p-3">
              {noteMode === "client_reply" && (
                <p className="mb-1.5 px-1 text-xs font-medium text-[#a9c7ff]">
                  Đang soạn phản hồi gửi khách —{" "}
                  <button
                    type="button"
                    onClick={() => setNoteMode("internal")}
                    className="underline"
                  >
                    chuyển về ghi chú nội bộ
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
                      ? "Viết phản hồi gửi khách..."
                      : "Thêm ghi chú nội bộ..."
                  }
                  className="flex-1 rounded-[4px] border border-[#43474f] bg-[#131313] px-3 py-2 text-sm text-[#e5e2e1] placeholder:text-[#5a5958] focus:outline-none focus:ring-1 focus:ring-[#a9c7ff]"
                />
                <button
                  type="button"
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || isPostingNote}
                  className="flex size-9 shrink-0 items-center justify-center rounded-[4px] bg-[#a9c7ff] text-white hover:bg-[#93b6f5] disabled:opacity-50"
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
