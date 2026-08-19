import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

interface PublicPhoto {
  id: string;
  original_base_filename: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

interface PublicAlbum {
  id: string;
  name: string;
  watermark_enabled: boolean;
}

export default function AlbumGalleryPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<PublicAlbum | null>(null);
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!albumId) return;
    Promise.all([
      api.get<{ album: PublicAlbum }>(`/api/public/albums/${albumId}`),
      api.get<{ photos: PublicPhoto[] }>(
        `/api/public/albums/${albumId}/photos`
      ),
    ])
      .then(([albumRes, photosRes]) => {
        setAlbum(albumRes.data.album);
        setPhotos(photosRes.data.photos);
      })
      .catch((err) => {
        if (
          isAxiosError(err) &&
          (err.response?.status === 401 || err.response?.status === 403)
        ) {
          navigate(`/a/${albumId}`, { replace: true });
          return;
        }
        setError(getErrorMessage(err, "Không tải được album"));
      });
  }, [albumId, navigate]);

  async function toggleHeart(photoId: string) {
    try {
      const { data } = await api.post<{ selected: boolean }>(
        `/api/public/albums/${albumId}/photos/${photoId}/select`
      );
      setSelected((prev) => {
        const next = new Set(prev);
        if (data.selected) {
          next.add(photoId);
        } else {
          next.delete(photoId);
        }
        return next;
      });
    } catch {
      // Bỏ qua lỗi 1 lượt thả tim, không chặn xem ảnh còn lại.
    }
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

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">{album.name}</h1>

      {photos.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          Chưa có ảnh nào trong album.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              <img
                src={`${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photo.id}/view`}
                alt={photo.original_base_filename}
                className="aspect-square w-full object-cover"
              />
              <button
                type="button"
                onClick={() => toggleHeart(photo.id)}
                aria-label="Thả tim"
                className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-lg shadow ${
                  selected.has(photo.id)
                    ? "bg-red-500 text-white"
                    : "bg-white/90 text-slate-500"
                }`}
              >
                ♥
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
