import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { getPresetLabel } from "../../lib/compressionPresets";
import type { Album } from "../../lib/types";

function formatDeadline(value: string | null) {
  if (!value) return "Không giới hạn";
  return new Date(value).toLocaleString("vi-VN");
}

export default function AlbumsPage() {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ albums: Album[] }>("/api/albums")
      .then(({ data }) => setAlbums(data.albums))
      .catch((err) =>
        setError(getErrorMessage(err, "Không tải được danh sách album"))
      );
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Album</h1>
        <Link
          to="/admin/albums/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          + Tạo album
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!albums && !error && (
        <p className="mt-6 text-sm text-slate-500">Đang tải...</p>
      )}

      {albums && albums.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">Chưa có album nào.</p>
      )}

      {albums && albums.length > 0 && (
        <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {albums.map((album) => (
            <li key={album.id}>
              <Link
                to={`/admin/albums/${album.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="font-medium text-slate-900">{album.name}</p>
                  <p className="text-xs text-slate-500">
                    {getPresetLabel(album.compression_preset_id)} · Hạn chọn
                    ảnh: {formatDeadline(album.selection_deadline)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                    album.status === "active"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {album.status === "active" ? "Đang hoạt động" : "Đã lưu trữ"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
