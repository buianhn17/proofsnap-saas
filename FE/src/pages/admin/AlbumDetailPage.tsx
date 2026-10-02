import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { PIN_PATTERN } from "../../lib/validation";
import {
  COMPRESSION_PRESETS,
  getPresetLabel,
} from "../../lib/compressionPresets";
import type { Album, Photo } from "../../lib/types";
import PhotoUploadPanel, {
  type PhotoUploadPanelHandle,
  type UploadQueueItem,
} from "../../components/PhotoUploadPanel";
import LocalFolderPicker from "../../components/LocalFolderPicker";

function formatDateTime(value: string | null) {
  if (!value) return "Không giới hạn";
  return new Date(value).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const modalInputClass =
  "w-full rounded-xl border border-white/10 bg-zinc-900/80 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 [color-scheme:dark]";

interface AlbumDetailLocationState {
  keptUploadItems?: UploadQueueItem[];
}

export default function AlbumDetailPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const location = useLocation();
  const keptUploadItems = (location.state as AlbumDetailLocationState | null)
    ?.keptUploadItems;
  const [album, setAlbum] = useState<Album | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const uploadPanelRef = useRef<PhotoUploadPanelHandle>(null);

  // Quick preview lightbox
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);

  // Edit album modal state
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPinEnabled, setEditPinEnabled] = useState(true);
  const [editPin, setEditPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [editMaxSelectable, setEditMaxSelectable] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editWatermark, setEditWatermark] = useState(true);
  const [editPreset, setEditPreset] = useState(2);
  const [editStatus, setEditStatus] = useState<"active" | "archived">("active");
  const [editIsLocked, setEditIsLocked] = useState(false);
  const [editDownloadZipUnlocked, setEditDownloadZipUnlocked] = useState(false);

  const [copied, setCopied] = useState(false);
  const [coverSavingId, setCoverSavingId] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);

  const [zipUploading, setZipUploading] = useState(false);
  const [zipUploadError, setZipUploadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ album: Album }>(`/api/albums/${albumId}`)
      .then(({ data }) => setAlbum(data.album))
      .catch((err) =>
        setError(getErrorMessage(err, "Không tải được thông tin album"))
      );
  }, [albumId]);

  useEffect(() => {
    if (!albumId) return;
    api
      .get<{ photos: Photo[] }>(`/api/albums/${albumId}/photos`)
      .then(({ data }) => setPhotos(data.photos))
      .catch(() => {});
  }, [albumId]);

  const filteredPhotos = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return photos;
    return photos.filter((photo) =>
      photo.original_base_filename.toLowerCase().includes(term)
    );
  }, [photos, search]);

  function toggleSelected(photoId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  function handleUploaded(photo: Photo) {
    setPhotos((prev) => [photo, ...prev]);
  }

  function handleDropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    if (event.dataTransfer.files.length > 0) {
      uploadPanelRef.current?.enqueueFiles(event.dataTransfer.files);
    }
  }

  function startEditing() {
    if (!album) return;
    setEditName(album.name);
    setEditPinEnabled(album.pin_enabled);
    setEditPin("");
    setShowPin(false);
    setEditMaxSelectable(
      album.max_selectable_photos ? String(album.max_selectable_photos) : ""
    );
    setEditDeadline(
      album.selection_deadline
        ? toDatetimeLocalValue(album.selection_deadline)
        : ""
    );
    setEditWatermark(album.watermark_enabled);
    setEditPreset(album.compression_preset_id);
    setEditStatus(album.status);
    setEditIsLocked(album.is_locked);
    setEditDownloadZipUnlocked(album.download_zip_unlocked);
    setSaveError(null);
    setIsEditing(true);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!album) return;
    setSaveError(null);

    if (!editName.trim()) {
      setSaveError("Tên album không được để trống");
      return;
    }
    if (editPin && !PIN_PATTERN.test(editPin)) {
      setSaveError("PIN phải là chuỗi số từ 4 đến 12 chữ số");
      return;
    }

    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: editName.trim(),
        pin_enabled: editPinEnabled,
        max_selectable_photos: editMaxSelectable
          ? Number(editMaxSelectable)
          : null,
        selection_deadline: editDeadline
          ? new Date(editDeadline).toISOString()
          : null,
        watermark_enabled: editWatermark,
        compression_preset_id: editPreset,
        status: editStatus,
        is_locked: editIsLocked,
        download_zip_unlocked: editDownloadZipUnlocked,
      };
      if (editPinEnabled && editPin) {
        body.pin = editPin;
      }

      const { data } = await api.patch<{ album: Album }>(
        `/api/albums/${album.id}`,
        body
      );
      setAlbum(data.album);
      setIsEditing(false);
    } catch (err) {
      setSaveError(getErrorMessage(err, "Không thể lưu thay đổi"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleZipUpload(file: File | undefined) {
    if (!album || !file) return;
    setZipUploading(true);
    setZipUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const { data } = await api.post<{ album: Album }>(
        `/api/albums/${album.id}/zip-upload`,
        formData
      );
      setAlbum(data.album);
    } catch (err) {
      setZipUploadError(getErrorMessage(err, "Upload file .zip thất bại"));
    } finally {
      setZipUploading(false);
    }
  }

  async function handleSetCoverPhoto(photoId: string) {
    if (!album) return;
    setCoverSavingId(photoId);
    setCoverError(null);
    try {
      const { data } = await api.patch<{ album: Album }>(
        `/api/albums/${album.id}`,
        { cover_photo_id: photoId }
      );
      setAlbum(data.album);
    } catch (err) {
      setCoverError(getErrorMessage(err, "Không thể đặt ảnh bìa"));
    } finally {
      setCoverSavingId(null);
    }
  }

  async function handleCopyLink() {
    if (!album) return;
    const link = `${window.location.origin}/a/${album.id}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-950/40 p-4 text-sm text-rose-300">
        {error}
      </div>
    );
  }

  if (!album) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-zinc-400">
        <span className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        Đang tải thông tin album...
      </div>
    );
  }

  const canUpload = album.status === "active" && !album.is_locked;

  return (
    <div className="flex flex-col gap-6 animate-fade-in-up">
      {/* Upload background worker/manager panel */}
      <PhotoUploadPanel
        ref={uploadPanelRef}
        albumId={album.id}
        preset={
          COMPRESSION_PRESETS.find((p) => p.id === album.compression_preset_id) ??
          COMPRESSION_PRESETS[1]
        }
        onUploaded={handleUploaded}
        initialItems={keptUploadItems}
      />

      {/* Top Breadcrumbs & Back Link */}
      <div className="flex items-center justify-between">
        <Link
          to="/admin/albums"
          className="group inline-flex items-center gap-2 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
        >
          <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Quay lại danh sách album</span>
        </Link>

        {/* Client Portal Link Button */}
        <button
          type="button"
          onClick={handleCopyLink}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-md transition-all hover:bg-white/10 hover:text-white"
        >
          <svg className="h-3.5 w-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span>{copied ? "Đã sao chép link!" : "Copy link khách"}</span>
        </button>
      </div>

      {/* Main Album Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {album.name}
            </h1>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wider ${
                album.status === "active" && !album.is_locked
                  ? "border border-emerald-500/30 bg-emerald-950/50 text-emerald-300"
                  : "border border-white/10 bg-zinc-800 text-zinc-400"
              }`}
            >
              {album.status === "active" && !album.is_locked ? "Đang mở" : "Đã khóa"}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {photos.length} ảnh trong album • Preset: {getPresetLabel(album.compression_preset_id)} • Hạn chót: {formatDateTime(album.selection_deadline)}
          </p>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to={`/admin/albums/${album.id}/annotations`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/80 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition-all hover:bg-white/10 hover:text-white"
          >
            <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <span>Yêu cầu chỉnh sửa</span>
          </Link>

          <button
            type="button"
            onClick={startEditing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/80 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition-all hover:bg-white/10 hover:text-white"
          >
            <svg className="h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Cấu hình album</span>
          </button>

          {canUpload && (
            <button
              type="button"
              onClick={() => uploadPanelRef.current?.openFileDialog()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-400 hover:to-indigo-500 hover:-translate-y-0.5 active:translate-y-0"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Tải ảnh lên</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-900/50 p-3 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-xl bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-medium text-white">
            Tất cả ({photos.length})
          </span>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20"
            >
              Đã chọn: {selectedIds.size} ảnh (Bỏ chọn)
            </button>
          )}
        </div>

        {/* Search by filename */}
        <div className="relative w-full sm:w-64">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên file (VD: DSC_01)..."
            className="w-full rounded-xl border border-white/10 bg-zinc-950/70 py-1.5 pl-9 pr-8 text-xs text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {coverError && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-xs text-rose-300">
          {coverError}
        </div>
      )}

      {/* Photo Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {filteredPhotos.map((photo) => {
          const isCover = album.cover_photo_id === photo.id;
          const isSavingCover = coverSavingId === photo.id;
          const isSelected = selectedIds.has(photo.id);

          return (
            <div
              key={photo.id}
              className={`group relative aspect-[3/2] overflow-hidden rounded-2xl border bg-zinc-950 transition-all duration-300 ${
                isSelected
                  ? "border-indigo-500 ring-2 ring-indigo-500/50"
                  : isCover
                  ? "border-amber-500/50"
                  : "border-white/10 hover:border-white/30 hover:shadow-lg"
              }`}
            >
              <img
                src={`${import.meta.env.VITE_API_BASE_URL}/api/albums/${albumId}/photos/${photo.id}/view?size=thumb`}
                alt={photo.original_base_filename}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />

              {/* Gradient Scrim */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 opacity-60 group-hover:opacity-90 transition-opacity" />

              {/* Select Checkbox */}
              <button
                type="button"
                onClick={() => toggleSelected(photo.id)}
                aria-label="Chọn ảnh"
                className={`absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-lg border text-xs transition-all ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-600 text-white shadow-md shadow-indigo-500/50"
                    : "border-white/30 bg-black/40 text-transparent hover:border-white/60 group-hover:text-white/40"
                }`}
              >
                ✓
              </button>

              {/* Cover Badge */}
              {isCover && (
                <span className="absolute left-2 top-2 rounded-md border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 backdrop-blur-md">
                  Ảnh bìa
                </span>
              )}

              {/* Quick Preview Button on Hover */}
              <button
                type="button"
                onClick={() => setPreviewPhoto(photo)}
                className="absolute inset-x-4 top-1/2 -translate-y-1/2 flex items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-black/60 py-1.5 text-[11px] font-medium text-white opacity-0 backdrop-blur-md transition-all duration-200 group-hover:opacity-100 hover:bg-black/80"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>Xem lớn</span>
              </button>

              {/* Set Cover Button */}
              {!isCover && (
                <button
                  type="button"
                  onClick={() => handleSetCoverPhoto(photo.id)}
                  disabled={isSavingCover}
                  className="absolute inset-x-2 bottom-7 rounded-lg border border-white/10 bg-zinc-900/90 px-2 py-1 text-[10px] font-medium text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  {isSavingCover ? "Đang lưu..." : "Đặt làm ảnh bìa"}
                </button>
              )}

              {/* Filename Tag */}
              <span className="pointer-events-none absolute inset-x-2 bottom-1.5 truncate text-[10px] font-mono text-zinc-300">
                {photo.original_base_filename}
              </span>
            </div>
          );
        })}

        {/* Dropzone / Upload More Card */}
        {canUpload && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDropFiles}
            onClick={() => uploadPanelRef.current?.openFileDialog()}
            className={`flex aspect-[3/2] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition-all duration-200 ${
              isDraggingOver
                ? "border-indigo-500 bg-indigo-500/10"
                : "border-white/15 bg-zinc-900/30 hover:border-indigo-500/50 hover:bg-zinc-900/60"
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-indigo-400">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <span className="text-xs font-semibold text-zinc-300">Kéo thả thêm ảnh</span>
            <span className="text-[10px] text-zinc-500">hoặc click để chọn</span>
          </div>
        )}
      </div>

      {/* Empty Photo Library Notice */}
      {photos.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-zinc-900/30 p-12 text-center backdrop-blur-xl">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900">
            <svg className="h-7 w-7 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
          </div>
          <h3 className="mt-4 text-sm font-bold text-white">Chưa có ảnh nào trong album</h3>
          <p className="mt-1 max-w-sm text-xs text-zinc-400">
            Hãy tải ảnh lên từ máy tính hoặc sử dụng công cụ lọc ảnh Culling AI bên dưới.
          </p>
          {canUpload && (
            <button
              type="button"
              onClick={() => uploadPanelRef.current?.openFileDialog()}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-400"
            >
              Tải ảnh lên ngay
            </button>
          )}
        </div>
      )}

      {/* Studio Workflow Action Cards */}
      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Card 1: Culling & Local Import */}
        <div className="flex flex-col justify-between rounded-3xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur-xl">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 12h20" />
                  <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6" />
                  <path d="M12 2v20" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Lọc ảnh thông minh AI (Culling)</h3>
                <p className="text-xs text-zinc-400">Phát hiện mắt nhắm, nét mờ, gom chụp liên tiếp trước khi upload</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-zinc-400 leading-relaxed">
              Duyệt qua hàng nghìn bức ảnh RAW/JPG trên máy tính với tốc độ siêu nhanh thông qua Web Worker, gắn cờ giữ/loại và chỉ upload những bức ảnh đẹp nhất.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
            <Link
              to={`/admin/albums/${album.id}/cull`}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 hover:from-indigo-400 hover:to-indigo-500"
            >
              <span>Mở công cụ Culling AI</span>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <LocalFolderPicker />
          </div>
        </div>

        {/* Card 2: Post-Production Finished ZIP */}
        <div className="flex flex-col justify-between rounded-3xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur-xl">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Bàn giao ảnh hoàn thiện (.ZIP)</h3>
                <p className="text-xs text-zinc-400">Tải lên gói ảnh đã retouch để khách hàng tải về trọn bộ</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-zinc-400 leading-relaxed">
              Nếu bỏ qua, khách tải ZIP sẽ nhận ảnh gốc ban đầu. Upload file .zip đã chỉnh sửa để thay thế bản hoàn thiện cho khách hàng khi họ hoàn tất chọn ảnh.
            </p>
          </div>

          <div className="mt-6 border-t border-white/5 pt-4">
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={zipUploading}
              onChange={(e) => handleZipUpload(e.target.files?.[0])}
              className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-white/20 disabled:opacity-50"
            />
            {zipUploading && (
              <p className="mt-2 text-xs text-indigo-400">Đang tải file ZIP lên Google Drive...</p>
            )}
            {zipUploadError && (
              <p className="mt-2 text-xs text-rose-400">{zipUploadError}</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick Lightbox Preview Modal */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-fade-in-up"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="relative flex max-h-[92vh] max-w-[92vw] flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Lightbox Header */}
            <div className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-300">
              <span className="font-mono font-medium truncate max-w-[300px]">
                {previewPhoto.original_base_filename}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleSetCoverPhoto(previewPhoto.id);
                  }}
                  className="rounded-lg border border-white/10 bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20"
                >
                  {album.cover_photo_id === previewPhoto.id ? "Ảnh bìa hiện tại" : "Đặt làm ảnh bìa"}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewPhoto(null)}
                  className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Lightbox Image */}
            <div className="flex max-h-[80vh] items-center justify-center overflow-hidden rounded-xl bg-black">
              <img
                src={`${import.meta.env.VITE_API_BASE_URL}/api/albums/${albumId}/photos/${previewPhoto.id}/view?size=full`}
                alt={previewPhoto.original_base_filename}
                className="max-h-[80vh] max-w-[90vw] object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit Album Configuration Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-in-up">
          <div className="flex max-h-[90vh] w-full max-w-[620px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/80 backdrop-blur-2xl animate-scale-in">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <h2 className="text-base font-bold text-white">Cấu hình bộ sưu tập</h2>
                <p className="text-xs text-zinc-400">Thay đổi thông tin và quyền hạn của album</p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSave} className="flex flex-col overflow-y-auto">
              {/* Share link pill */}
              <div className="m-6 mb-2 flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
                <div className="min-w-0 pr-4">
                  <p className="text-xs font-semibold text-white">Link Client Portal</p>
                  <p className="truncate text-xs font-mono text-zinc-400">
                    {`${window.location.origin}/a/${album.id}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/15"
                >
                  {copied ? "Đã chép!" : "Sao chép"}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-5 p-6 pt-3 sm:grid-cols-2">
                {/* Album Name */}
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                    Tên album
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={modalInputClass}
                  />
                </div>

                {/* PIN Code */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                      Mã PIN
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="text-[11px] text-indigo-400 hover:underline"
                    >
                      {showPin ? "Ẩn" : "Hiện"}
                    </button>
                  </div>
                  <input
                    type={showPin ? "text" : "password"}
                    value={editPin}
                    onChange={(e) => setEditPin(e.target.value)}
                    placeholder="Để trống nếu giữ nguyên PIN cũ"
                    className={modalInputClass}
                  />
                </div>

                {/* Max Selectable Photos */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                    Số ảnh chọn tối đa
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editMaxSelectable}
                    onChange={(e) => setEditMaxSelectable(e.target.value)}
                    placeholder="Không giới hạn"
                    className={modalInputClass}
                  />
                </div>

                {/* Deadline */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                    Hạn chót chọn ảnh
                  </label>
                  <input
                    type="datetime-local"
                    value={editDeadline}
                    onChange={(e) => setEditDeadline(e.target.value)}
                    className={modalInputClass}
                  />
                </div>

                {/* Status */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                    Trạng thái album
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as "active" | "archived")}
                    className={`${modalInputClass} appearance-none`}
                  >
                    <option value="active" className="bg-zinc-900 text-white">Đang hoạt động</option>
                    <option value="archived" className="bg-zinc-900 text-white">Đã lưu trữ</option>
                  </select>
                </div>

                {/* Lock Status Checkbox */}
                <div className="sm:col-span-2">
                  <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/10 bg-zinc-900/50 p-3.5 hover:bg-zinc-900/80">
                    <div>
                      <span className="text-xs font-semibold text-white">Khóa album (Ngừng chọn ảnh)</span>
                      <p className="text-[11px] text-zinc-400">Khách vẫn có thể xem nhưng không thể thả tim hoặc đổi ảnh đã chọn</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={editIsLocked}
                      onChange={(e) => setEditIsLocked(e.target.checked)}
                      className="h-4 w-4 rounded accent-indigo-500"
                    />
                  </label>
                </div>

                {/* Unlock ZIP Download for Client */}
                <div className="sm:col-span-2">
                  <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/10 bg-zinc-900/50 p-3.5 hover:bg-zinc-900/80">
                    <div>
                      <span className="text-xs font-semibold text-white">Mở khóa tải trọn bộ ảnh (.ZIP)</span>
                      <p className="text-[11px] text-zinc-400">Cho phép khách tải gói ảnh đã hoàn thiện về máy tính</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={editDownloadZipUnlocked}
                      onChange={(e) => setEditDownloadZipUnlocked(e.target.checked)}
                      className="h-4 w-4 rounded accent-indigo-500"
                    />
                  </label>
                </div>
              </div>

              {saveError && (
                <div className="mx-6 mb-4 rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-xs text-rose-300">
                  {saveError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-white/10 bg-zinc-900/60 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/5 hover:text-white"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-xl bg-indigo-500 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-400 disabled:opacity-50"
                >
                  {isSaving ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
