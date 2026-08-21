import { useEffect, useState, type FormEvent } from "react";
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
  type UploadQueueItem,
} from "../../components/PhotoUploadPanel";
import LocalFolderPicker from "../../components/LocalFolderPicker";

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

interface AlbumDetailLocationState {
  /** Bước 1.6 / 2.3 — danh sách ảnh "giữ" khi điều hướng về từ trang duyệt culling, kèm
   * scene_id/burst_cluster_id đã tạo trước đó (nếu có). */
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
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPinEnabled, setEditPinEnabled] = useState(true);
  const [editPin, setEditPin] = useState("");
  const [editMaxSelectable, setEditMaxSelectable] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editWatermark, setEditWatermark] = useState(true);
  const [editPreset, setEditPreset] = useState(2);
  const [editStatus, setEditStatus] = useState<"active" | "archived">(
    "active"
  );
  const [editIsLocked, setEditIsLocked] = useState(false);

  const [copied, setCopied] = useState(false);

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

  function handleUploaded(photo: Photo, thumbnailUrl: string) {
    setPhotos((prev) => [photo, ...prev]);
    setThumbnails((prev) => ({ ...prev, [photo.id]: thumbnailUrl }));
  }

  function startEditing() {
    if (!album) return;
    setEditName(album.name);
    setEditPinEnabled(album.pin_enabled);
    setEditPin("");
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

  async function handleCopyLink() {
    if (!album) return;
    const link = `${window.location.origin}/a/${album.id}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }

  if (!album) {
    return <p className="text-sm text-slate-500">Đang tải...</p>;
  }

  const clientLink = `${window.location.origin}/a/${album.id}`;
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
    ["Tạo lúc", formatDateTime(album.created_at)],
  ];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          {album.name}
        </h1>
        <div className="flex items-center gap-4">
          {!isEditing && (
            <button
              type="button"
              onClick={startEditing}
              className="text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              Chỉnh sửa
            </button>
          )}
          <Link
            to="/admin/albums"
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ← Quay lại danh sách
          </Link>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-700">
          Link gửi cho khách
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            readOnly
            value={clientLink}
            onFocus={(e) => e.target.select()}
            className="flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600"
          />
          <button
            type="button"
            onClick={handleCopyLink}
            className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {copied ? "Đã sao chép!" : "Sao chép"}
          </button>
        </div>
      </div>

      {isEditing ? (
        <form
          onSubmit={handleSave}
          className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Tên album
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={editPinEnabled}
              onChange={(e) => setEditPinEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Yêu cầu PIN
          </label>

          {editPinEnabled && (
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Đổi PIN (bỏ trống nếu giữ nguyên PIN hiện tại)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={editPin}
                onChange={(e) => setEditPin(e.target.value)}
                placeholder="123456"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Giới hạn số ảnh được chọn
            </label>
            <input
              type="number"
              min={1}
              value={editMaxSelectable}
              onChange={(e) => setEditMaxSelectable(e.target.value)}
              placeholder="Để trống nếu không giới hạn"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Hạn chọn ảnh (deadline)
            </label>
            <input
              type="datetime-local"
              value={editDeadline}
              onChange={(e) => setEditDeadline(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Mức nén ảnh
            </label>
            <select
              value={editPreset}
              onChange={(e) => setEditPreset(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            >
              {COMPRESSION_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.labelVi} — {preset.jpegQuality}%, cạnh dài tối đa{" "}
                  {preset.maxLongEdgePx}px
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={editWatermark}
              onChange={(e) => setEditWatermark(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Bật watermark động cho khách xem ảnh
          </label>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={editIsLocked}
              onChange={(e) => setEditIsLocked(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Khóa album (khách không xem/chọn được ảnh nữa)
          </label>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Trạng thái album
            </label>
            <select
              value={editStatus}
              onChange={(e) =>
                setEditStatus(e.target.value as "active" | "archived")
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="active">Đang hoạt động</option>
              <option value="archived">Đã lưu trữ</option>
            </select>
          </div>

          {saveError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {saveError}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSaving ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Hủy
            </button>
          </div>
        </form>
      ) : (
        <dl className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between px-4 py-3 text-sm"
            >
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-slate-900">Upload ảnh</h2>
        {canUpload ? (
          <div className="mt-3 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-slate-700">
                Nhập từ thư mục máy tính (RAW + JPG)
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <LocalFolderPicker />
                <Link
                  to={`/admin/albums/${album.id}/cull`}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Duyệt & lọc ảnh trước khi upload
                </Link>
                <Link
                  to={`/admin/albums/${album.id}/annotations`}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Xem ghi chú khách hàng
                </Link>
              </div>
            </div>
            {keptUploadItems && keptUploadItems.length > 0 && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Đã nhận {keptUploadItems.length} ảnh "giữ" từ bước duyệt culling — đang
                tự động thêm vào hàng đợi upload bên dưới.
              </p>
            )}
            <PhotoUploadPanel
              albumId={album.id}
              preset={
                COMPRESSION_PRESETS.find(
                  (p) => p.id === album.compression_preset_id
                ) ?? COMPRESSION_PRESETS[1]
              }
              onUploaded={handleUploaded}
              initialItems={keptUploadItems}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-amber-600">
            Album đã lưu trữ hoặc bị khóa nên không thể upload thêm ảnh.
          </p>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-slate-900">
          Ảnh trong album ({photos.length})
        </h2>
        {photos.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Chưa có ảnh nào.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((photo) => (
              <div
                key={photo.id}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white"
              >
                {thumbnails[photo.id] ? (
                  <img
                    src={thumbnails[photo.id]}
                    alt={photo.original_base_filename}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-slate-100 text-xs text-slate-400">
                    Không có xem trước
                  </div>
                )}
                <p className="truncate px-2 py-1 text-xs text-slate-600">
                  {photo.original_base_filename}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
