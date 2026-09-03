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
import closeIcon from "../../assets/icons/close.svg";
import linkIcon from "../../assets/icons/link.svg";
import copyIcon from "../../assets/icons/copy.svg";
import eyeIcon from "../../assets/icons/eye.svg";
import chevronDownIcon from "../../assets/icons/chevron-down.svg";
import searchIcon from "../../assets/icons/search.svg";
import settingsIcon from "../../assets/icons/nav-settings.svg";
import plusIcon from "../../assets/icons/plus.svg";

function formatDateTime(value: string | null) {
  if (!value) return "Không giới hạn";
  return new Date(value).toLocaleString("vi-VN");
}

// Chuyển ISO string sang định dạng input[type=datetime-local] (giờ local, không có giây/timezone).
function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const modalInputClass =
  "w-full rounded-[4px] border border-[#43474f] bg-[#0a0a0a] px-[17px] py-[9px] text-sm text-[#e5e2e1] placeholder:text-[#5a5958] focus:outline-none focus:ring-1 focus:ring-[#a9c7ff]";

interface AlbumDetailLocationState {
  /** Bước 1.6 / 2.3 — danh sách ảnh "giữ" khi điều hướng về từ trang duyệt culling, kèm
   * scene_id/burst_cluster_id đã tạo trước đó (nếu có). */
  keptUploadItems?: UploadQueueItem[];
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-4">
      <path
        d="M10 3v10m0-10 4 4m-4-4-4 4M4 14v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4">
      <path
        d="M11.3 2.3a1.5 1.5 0 0 1 2.1 2.1L5.5 12.3l-2.8.7.7-2.8 7.9-7.9Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  const [editStatus, setEditStatus] = useState<"active" | "archived">(
    "active"
  );
  const [editIsLocked, setEditIsLocked] = useState(false);
  const [editDownloadZipUnlocked, setEditDownloadZipUnlocked] = useState(false);

  const [copied, setCopied] = useState(false);
  const [coverSavingId, setCoverSavingId] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);

  // Bước 4.2 — upload file .zip ảnh đã hậu kỳ (tùy chọn). Không dùng PhotoUploadPanel vì
  // đây chỉ 1 file .zip, không phải hàng đợi nhiều ảnh JPG.
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
      .catch(() => {
        // Không chặn xem chi tiết album nếu riêng danh sách ảnh lỗi.
      });
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
      setSaveError("PIN phải là chuỗi số từ 4 đến 12 ký tự");
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
      setCoverError(getErrorMessage(err, "Không thể đặt ảnh đại diện"));
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
      <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
        {error}
      </p>
    );
  }

  if (!album) {
    return <p className="text-sm text-[#c1c6d4]">Đang tải...</p>;
  }

  const canUpload = album.status === "active" && !album.is_locked;

  const rows: [string, string][] = [
    [
      "Trạng thái",
      album.status === "active" ? "Đang hoạt động" : "Đã lưu trữ",
    ],
    ["Yêu cầu PIN", album.pin_enabled ? "Có" : "Không"],
    [
      "Giới hạn số ảnh chọn",
      album.max_selectable_photos
        ? String(album.max_selectable_photos)
        : "Không giới hạn",
    ],
    ["Hạn chọn ảnh", formatDateTime(album.selection_deadline)],
    ["Watermark", album.watermark_enabled ? "Bật" : "Tắt"],
    ["Mức nén ảnh", getPresetLabel(album.compression_preset_id)],
    ["Album vị thành niên", album.is_minor_album ? "Có" : "Không"],
    ["Khóa album", album.is_locked ? "Đã khóa" : "Chưa khóa"],
    [
      "Tải ZIP ảnh hoàn thiện",
      album.download_zip_unlocked ? "Đã mở khóa cho khách" : "Chưa mở khóa",
    ],
    ["Tạo lúc", formatDateTime(album.created_at)],
  ];

  return (
    <div>
      <PhotoUploadPanel
        ref={uploadPanelRef}
        albumId={album.id}
        preset={
          COMPRESSION_PRESETS.find(
            (p) => p.id === album.compression_preset_id
          ) ?? COMPRESSION_PRESETS[1]
        }
        onUploaded={handleUploaded}
        initialItems={keptUploadItems}
      />

      <Link
        to="/admin/albums"
        className="inline-flex items-center gap-1.5 text-sm text-[#c1c6d4] hover:text-[#e5e2e1]"
      >
        ← Quay lại danh sách
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-[32px] font-semibold tracking-[-0.32px] text-[#e5e2e1]">
          {album.name}
        </h1>
        <div className="flex items-center gap-3">
          <span className="rounded-[4px] border border-[#43474f] bg-[#1c1b1b] px-4 py-2 text-sm font-medium text-[#e5e2e1]">
            {photos.length} Ảnh
          </span>
          {canUpload && (
            <button
              type="button"
              onClick={() => uploadPanelRef.current?.openFileDialog()}
              className="flex items-center gap-2 rounded-[4px] bg-[#a9c7ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#93b6f5]"
            >
              <UploadIcon />
              Tải ảnh lên
            </button>
          )}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between border-b border-[#43474f] pb-4">
        <div className="flex items-center gap-2">
          <span className="rounded-[4px] bg-[#2a2a2a] px-4 py-2 text-sm font-semibold text-[#e5e2e1]">
            Tất cả
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="rounded-[4px] px-4 py-2 text-sm text-[#c1c6d4] hover:bg-[#1c1b1b]"
          >
            Đã chọn ({selectedIds.size})
          </button>
          <Link
            to={`/admin/albums/${album.id}/annotations`}
            className="flex items-center gap-1.5 rounded-[4px] px-4 py-2 text-sm text-[#c1c6d4] hover:bg-[#1c1b1b]"
          >
            <PencilIcon />
            Yêu cầu chỉnh sửa
          </Link>
          <button
            type="button"
            onClick={startEditing}
            className="flex items-center gap-1.5 rounded-[4px] px-4 py-2 text-sm text-[#c1c6d4] hover:bg-[#1c1b1b]"
          >
            <img src={settingsIcon} alt="" className="size-4 opacity-70" />
            Cấu hình album
          </button>
        </div>
        <div className="relative w-64">
          <img
            src={searchIcon}
            alt=""
            className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 opacity-70"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm kiếm tên file..."
            className="w-full border border-[#43474f] bg-[#1c1b1b] py-[11px] pl-[41px] pr-[13px] text-sm text-[#e5e2e1] placeholder:text-[#c1c6d4] focus:outline-none focus:ring-1 focus:ring-[#a9c7ff]"
          />
        </div>
      </div>

      {coverError && (
        <p className="mt-4 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {coverError}
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {filteredPhotos.map((photo) => {
          const isCover = album.cover_photo_id === photo.id;
          const isSaving = coverSavingId === photo.id;
          const isSelected = selectedIds.has(photo.id);
          return (
            <div
              key={photo.id}
              className={`group relative aspect-[3/2] overflow-hidden rounded-[4px] border bg-[#201f1f] ${
                isSelected ? "border-[#a9c7ff] ring-2 ring-[#a9c7ff]" : "border-[#43474f]"
              }`}
            >
              <img
                src={`${import.meta.env.VITE_API_BASE_URL}/api/albums/${albumId}/photos/${photo.id}/view?size=thumb`}
                alt={photo.original_base_filename}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
              <button
                type="button"
                onClick={() => toggleSelected(photo.id)}
                className={`absolute right-2 top-2 z-10 flex size-5 items-center justify-center rounded border text-[11px] ${
                  isSelected
                    ? "border-[#a9c7ff] bg-[#a9c7ff] text-white"
                    : "border-white/60 bg-black/40 opacity-0 group-hover:opacity-100"
                }`}
              >
                {isSelected && "✓"}
              </button>
              {isCover && (
                <span className="absolute left-2 top-2 rounded bg-[#a9c7ff] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.6px] text-white">
                  Ảnh bìa
                </span>
              )}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-[rgba(19,19,19,0.9)] to-transparent px-2 py-1.5 text-left text-[11px] text-[#e5e2e1]">
                {photo.original_base_filename}
              </span>
              {!isCover && (
                <button
                  type="button"
                  onClick={() => handleSetCoverPhoto(photo.id)}
                  disabled={isSaving}
                  className="absolute inset-x-2 bottom-8 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
                >
                  {isSaving ? "Đang lưu..." : "Đặt làm ảnh bìa"}
                </button>
              )}
            </div>
          );
        })}

        {canUpload && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDropFiles}
            onClick={() => uploadPanelRef.current?.openFileDialog()}
            className={`flex aspect-[3/2] cursor-pointer flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed transition-colors ${
              isDraggingOver
                ? "border-[#a9c7ff] bg-[#1c1b1b]"
                : "border-[#43474f] hover:border-[#5a5f68]"
            }`}
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-[#2a2a2a]">
              <img src={plusIcon} alt="" className="size-3.5" />
            </span>
            <span className="text-sm text-[#c1c6d4]">Kéo thả thêm ảnh</span>
          </div>
        )}
      </div>

      {photos.length === 0 && !canUpload && (
        <p className="mt-6 text-sm text-[#c1c6d4]">
          Album đã lưu trữ hoặc bị khóa nên không thể upload thêm ảnh.
        </p>
      )}

      <div className="mt-10 flex flex-col gap-6 border-t border-[#43474f] pt-8">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.6px] text-[#c1c6d4]">
            Nhập từ thư mục máy tính (RAW + JPG)
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <LocalFolderPicker />
            <Link
              to={`/admin/albums/${album.id}/cull`}
              className="rounded-md border border-[#43474f] px-3 py-1.5 text-sm font-medium text-[#e5e2e1] hover:bg-[#1c1b1b]"
            >
              Duyệt & lọc ảnh trước khi upload
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-[#43474f] bg-[#1c1b1b] p-4">
          <label className="block text-sm font-medium text-[#e5e2e1]">
            Upload ZIP ảnh đã hậu kỳ (tùy chọn — Bước 4.2)
          </label>
          <p className="mt-1 text-xs text-[#c1c6d4]">
            Nếu bỏ qua, khách tải ZIP sẽ nhận ảnh gốc (chưa hậu kỳ) đã được chọn trong album.
            Upload 1 file .zip ở đây để thay bằng bản đã chỉnh sửa hoàn chỉnh.
          </p>
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={zipUploading}
            onChange={(e) => handleZipUpload(e.target.files?.[0])}
            className="mt-2 block text-sm text-[#c1c6d4] file:mr-4 file:rounded-md file:border-0 file:bg-[#a9c7ff] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#93b6f5] disabled:opacity-50"
          />
          {zipUploading && <p className="mt-2 text-xs text-[#c1c6d4]">Đang upload lên Drive...</p>}
          {zipUploadError && <p className="mt-2 text-xs text-red-400">{zipUploadError}</p>}
        </div>

        <details className="rounded-lg border border-[#43474f] bg-[#1c1b1b]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#e5e2e1]">
            Chi tiết cấu hình album
          </summary>
          <dl className="divide-y divide-[#2a2a2a] border-t border-[#43474f]">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between px-4 py-3 text-sm">
                <dt className="text-[#c1c6d4]">{label}</dt>
                <dd className="font-medium text-[#e5e2e1]">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>

      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]">
          <div className="flex max-h-[90vh] w-full max-w-[600px] flex-col overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#201f1f] shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)]">
            <div className="flex shrink-0 items-center justify-between border-b border-[#2a2a2a] bg-[#1c1b1b] px-6 pb-[17px] pt-4">
              <h2 className="text-xl font-semibold text-[#e5e2e1]">
                Cấu hình album
              </h2>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                aria-label="Đóng"
                className="flex size-8 items-center justify-center rounded hover:bg-[#2a2a2a]"
              >
                <img src={closeIcon} alt="" className="size-3.5" />
              </button>
            </div>

            <form
              onSubmit={handleSave}
              className="flex flex-col gap-6 overflow-auto p-6"
            >
              <div className="flex items-center justify-between rounded-[4px] border border-[#2a2a2a] bg-[#0e0e0e] p-[17px]">
                <div className="flex items-center gap-4">
                  <img src={linkIcon} alt="" className="h-2.5 w-5" />
                  <div>
                    <p className="text-sm font-semibold text-[#e5e2e1]">
                      Link chia sẻ album
                    </p>
                    <p className="max-w-[256px] truncate text-sm text-[#c1c6d4]">
                      {`${window.location.origin}/a/${album.id}`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex shrink-0 items-center gap-2 rounded-[4px] border border-[#484949] bg-[rgba(72,73,73,0.2)] px-[17px] py-[9px] text-xs tracking-[0.6px] text-[#e5e2e1] hover:bg-[rgba(72,73,73,0.4)]"
                >
                  <img src={copyIcon} alt="" className="size-3" />
                  {copied ? "Đã sao chép!" : "Sao chép"}
                </button>
              </div>

              <div className="border-t border-[#2a2a2a]" />

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium tracking-[0.6px] text-[#c1c6d4]">
                    Tên Album
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={modalInputClass}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium tracking-[0.6px] text-[#c1c6d4]">
                        Mã PIN bảo mật
                      </label>
                      <label className="flex items-center gap-1.5 text-[10px] text-[#c1c6d4]">
                        <input
                          type="checkbox"
                          checked={editPinEnabled}
                          onChange={(e) => setEditPinEnabled(e.target.checked)}
                          className="size-3 rounded border-[#2a2a2a]"
                        />
                        Yêu cầu PIN
                      </label>
                    </div>
                    <div className="relative">
                      <input
                        type={showPin ? "text" : "password"}
                        inputMode="numeric"
                        value={editPin}
                        onChange={(e) => setEditPin(e.target.value)}
                        placeholder={
                          editPinEnabled ? "Giữ nguyên PIN hiện tại" : "Không yêu cầu PIN"
                        }
                        disabled={!editPinEnabled}
                        className={`${modalInputClass} pr-10 disabled:opacity-50`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPin((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-[#2a2a2a]"
                      >
                        <img src={eyeIcon} alt="" className="h-[12.5px] w-[18.33px]" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium tracking-[0.6px] text-[#c1c6d4]">
                      Giới hạn chọn ảnh
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
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium tracking-[0.6px] text-[#c1c6d4]">
                    Hạn chót chọn ảnh (Deadline)
                  </label>
                  <input
                    type="datetime-local"
                    value={editDeadline}
                    onChange={(e) => setEditDeadline(e.target.value)}
                    className={`${modalInputClass} [color-scheme:dark]`}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium tracking-[0.6px] text-[#c1c6d4]">
                    Chất lượng nén ảnh khi tải lên
                  </label>
                  <div className="relative">
                    <select
                      value={editPreset}
                      onChange={(e) => setEditPreset(Number(e.target.value))}
                      className={`${modalInputClass} appearance-none pr-10`}
                    >
                      {COMPRESSION_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.labelVi} — {preset.jpegQuality}%, cạnh dài tối đa{" "}
                          {preset.maxLongEdgePx}px
                        </option>
                      ))}
                    </select>
                    <img
                      src={chevronDownIcon}
                      alt=""
                      className="pointer-events-none absolute right-4 top-1/2 h-[6.17px] w-[10px] -translate-y-1/2"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-[#2a2a2a]" />

              <label className="flex items-center justify-between gap-4">
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-[#e5e2e1]">
                    Bảo vệ bằng Watermark
                  </span>
                  <span className="text-sm text-[#c1c6d4]">
                    Tự động chèn chéo "Tên KH - SĐT" (Opacity 15%) lên ảnh preview.
                  </span>
                </span>
                <span className="relative inline-flex h-6 w-11 shrink-0">
                  <input
                    type="checkbox"
                    checked={editWatermark}
                    onChange={(e) => setEditWatermark(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="absolute inset-0 rounded-full bg-[#43474f] transition-colors peer-checked:bg-[#a9c7ff]" />
                  <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
                </span>
              </label>

              <div className="border-t border-[#2a2a2a]" />

              <div className="flex flex-col gap-4">
                <p className="text-xs font-medium uppercase tracking-[0.6px] text-[#c1c6d4]">
                  Cài đặt nâng cao
                </p>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-sm font-semibold text-[#e5e2e1]">
                    Khóa album (khách không xem/chọn được ảnh nữa)
                  </span>
                  <span className="relative inline-flex h-6 w-11 shrink-0">
                    <input
                      type="checkbox"
                      checked={editIsLocked}
                      onChange={(e) => setEditIsLocked(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="absolute inset-0 rounded-full bg-[#43474f] transition-colors peer-checked:bg-[#a9c7ff]" />
                    <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
                  </span>
                </label>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-sm font-semibold text-[#e5e2e1]">
                    Mở khóa tải ZIP ảnh hoàn thiện cho khách
                  </span>
                  <span className="relative inline-flex h-6 w-11 shrink-0">
                    <input
                      type="checkbox"
                      checked={editDownloadZipUnlocked}
                      onChange={(e) => setEditDownloadZipUnlocked(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="absolute inset-0 rounded-full bg-[#43474f] transition-colors peer-checked:bg-[#a9c7ff]" />
                    <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
                  </span>
                </label>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium tracking-[0.6px] text-[#c1c6d4]">
                    Trạng thái album
                  </label>
                  <div className="relative">
                    <select
                      value={editStatus}
                      onChange={(e) =>
                        setEditStatus(e.target.value as "active" | "archived")
                      }
                      className={`${modalInputClass} appearance-none pr-10`}
                    >
                      <option value="active">Đang hoạt động</option>
                      <option value="archived">Đã lưu trữ</option>
                    </select>
                    <img
                      src={chevronDownIcon}
                      alt=""
                      className="pointer-events-none absolute right-4 top-1/2 h-[6.17px] w-[10px] -translate-y-1/2"
                    />
                  </div>
                </div>
              </div>

              {saveError && (
                <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
                  {saveError}
                </p>
              )}
            </form>

            <div className="flex shrink-0 items-center justify-end gap-4 border-t border-[#2a2a2a] bg-[#1c1b1b] px-6 py-4">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="rounded-[4px] border border-[#2a2a2a] px-[25px] py-[9px] text-xs tracking-[0.6px] text-[#e5e2e1] hover:bg-[#2a2a2a]"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-[4px] bg-[#a9c7ff] px-6 py-2 text-xs font-medium tracking-[0.6px] text-white shadow-[0px_10px_15px_-3px_rgba(169,199,255,0.2),0px_4px_6px_-4px_rgba(169,199,255,0.2)] hover:bg-[#93b6f5] disabled:opacity-50"
              >
                {isSaving ? "Đang lưu..." : "Lưu cấu hình"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
