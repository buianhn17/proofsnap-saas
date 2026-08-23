// Bước 2.2 — trang Admin xem lại toàn bộ ghi chú khoanh vùng khách đã vẽ trong album: vị trí
// đã khoanh (marker + nét vẽ, vẽ lại bằng SVG overlay giống PhotoAnnotationLightbox.tsx bên
// Client Portal) và nội dung ghi chú, gom theo từng ảnh.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import type { Album, Photo } from "../../lib/types";

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
  created_at: string;
  client_name: string;
  client_phone: string;
}

export default function AlbumAnnotationsPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!albumId) return;
    Promise.all([
      api.get<{ album: Album }>(`/api/albums/${albumId}`),
      api.get<{ photos: Photo[] }>(`/api/albums/${albumId}/photos`),
      api.get<{ annotations: AnnotationDto[] }>(`/api/albums/${albumId}/annotations`),
    ])
      .then(([albumRes, photosRes, annotationsRes]) => {
        setAlbum(albumRes.data.album);
        setPhotos(photosRes.data.photos);
        setAnnotations(annotationsRes.data.annotations);
      })
      .catch((err) => setError(getErrorMessage(err, "Không tải được ghi chú")));
  }, [albumId]);

  const annotationsByPhoto = useMemo(() => {
    const map = new Map<string, AnnotationDto[]>();
    for (const annotation of annotations) {
      if (!map.has(annotation.photo_id)) map.set(annotation.photo_id, []);
      map.get(annotation.photo_id)!.push(annotation);
    }
    return map;
  }, [annotations]);

  const photosWithAnnotations = useMemo(
    () => photos.filter((photo) => annotationsByPhoto.has(photo.id)),
    [photos, annotationsByPhoto]
  );

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          Ghi chú khách hàng {album ? `— ${album.name}` : ""}
        </h1>
        <Link
          to={`/admin/albums/${albumId}`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Quay lại album
        </Link>
      </div>

      {photosWithAnnotations.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          Chưa có ghi chú nào từ khách.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {photosWithAnnotations.map((photo) => {
            const photoAnnotations = annotationsByPhoto.get(photo.id) ?? [];
            return (
              <div
                key={photo.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <p className="text-sm font-medium text-slate-700">
                  {photo.original_base_filename} ({photoAnnotations.length} ghi
                  chú)
                </p>
                <div className="mt-2 flex flex-col gap-4 sm:flex-row">
                  <div className="relative inline-block w-full max-w-xs shrink-0 overflow-hidden rounded-md border border-slate-200">
                    <img
                      src={`${import.meta.env.VITE_API_BASE_URL}/api/albums/${albumId}/photos/${photo.id}/view?size=preview`}
                      alt={photo.original_base_filename}
                      loading="lazy"
                      decoding="async"
                      className="block w-full object-contain"
                    />
                    <svg
                      className="pointer-events-none absolute inset-0 h-full w-full"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      {photoAnnotations.map((a) => (
                        <g key={a.id} opacity={0.85}>
                          {a.path_pct && a.path_pct.length > 1 && (
                            <polyline
                              points={a.path_pct.map((p) => `${p.x},${p.y}`).join(" ")}
                              fill="none"
                              stroke="#f59e0b"
                              strokeWidth={0.6}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          <circle cx={a.pos_x_pct} cy={a.pos_y_pct} r={1} fill="#f59e0b" />
                        </g>
                      ))}
                    </svg>
                  </div>
                  <ul className="flex-1 space-y-2 text-sm">
                    {photoAnnotations.map((a) => (
                      <li
                        key={a.id}
                        className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2"
                      >
                        <p className="text-slate-800">{a.note_text}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {a.client_name} · {a.client_phone} ·{" "}
                          {new Date(a.created_at).toLocaleString("vi-VN")}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
