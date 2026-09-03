import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { getPresetLabel } from "../../lib/compressionPresets";
import type { Album } from "../../lib/types";
import plusIcon from "../../assets/icons/plus.svg";
import searchIcon from "../../assets/icons/search.svg";
import chevronRightIcon from "../../assets/icons/chevron-right.svg";
import lockIcon from "../../assets/icons/lock.svg";
import clockWarnIcon from "../../assets/icons/clock-warn.svg";
import clockDangerIcon from "../../assets/icons/clock-danger.svg";

type FilterKey = "all" | "open" | "archived";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "open", label: "Đang mở" },
  { key: "archived", label: "Lưu trữ" },
];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("vi-VN");
}

function getStatusBadge(album: Album) {
  if (album.status === "archived") {
    return { label: "LƯU TRỮ", bg: "bg-[#2a2a2a]", border: "border-[#43474f]", text: "text-[#c1c6d4]" };
  }
  if (album.is_locked) {
    return { label: "ĐÃ KHÓA", bg: "bg-[#3d1a1a]", border: "border-[#6b2e2e]", text: "text-[#ffb4ab]" };
  }
  const days = deadlineDays(album.selection_deadline);
  if (days !== null && days <= 3) {
    return { label: "SẮP HẾT HẠN", bg: "bg-[#4a3600]", border: "border-[#805d00]", text: "text-[#ffddb8]" };
  }
  return { label: "ĐANG MỞ", bg: "bg-[#1a3d24]", border: "border-[#2d6a3f]", text: "text-[#86e8a8]" };
}

function deadlineDays(deadline: string | null) {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
}

function getDeadlineInfo(deadline: string | null) {
  const days = deadlineDays(deadline);
  if (days === null) return { text: "Không giới hạn thời gian", icon: clockWarnIcon, color: "text-[#c1c6d4]" };
  if (days < 0) return { text: "Đã hết hạn chọn ảnh", icon: clockDangerIcon, color: "text-[#ffb4ab]" };
  if (days === 0) return { text: "Hết hạn hôm nay", icon: clockDangerIcon, color: "text-[#ffb4ab]" };
  if (days <= 3) return { text: `Hết hạn trong ${days} ngày`, icon: clockDangerIcon, color: "text-[#ffb4ab]" };
  return { text: `Hết hạn trong ${days} ngày`, icon: clockWarnIcon, color: "text-[#ffddb8]" };
}

export default function AlbumsPage() {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .get<{ albums: Album[] }>("/api/albums")
      .then(({ data }) => setAlbums(data.albums))
      .catch((err) =>
        setError(getErrorMessage(err, "Không tải được danh sách album"))
      );
  }, []);

  const filteredAlbums = useMemo(() => {
    if (!albums) return [];
    return albums
      .filter((album) => {
        if (filter === "open") return album.status === "active" && !album.is_locked;
        if (filter === "archived") return album.status === "archived";
        return true;
      })
      .filter((album) =>
        album.name.toLowerCase().includes(search.trim().toLowerCase())
      );
  }, [albums, filter, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 pb-10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium tracking-[0.6px] text-[#c1c6d4]">
            Workspace
          </span>
          <img src={chevronRightIcon} alt="" className="h-[7px] w-[4px]" />
          <span className="text-xs font-bold tracking-[0.6px] text-[#d6e2ff]">
            Bộ sưu tập
          </span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-[32px] font-semibold tracking-[-0.32px] text-[#e5e2e1]">
            Danh sách bộ sưu tập
          </h1>
          <Link
            to="/admin/albums/new"
            className="flex items-center gap-2 bg-[#a9c7ff] px-4 py-2 text-base font-semibold text-white hover:bg-[#93b6f5]"
          >
            <img src={plusIcon} alt="" className="size-3.5" />
            Tạo album mới
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-[#43474f] pb-[9px]">
        <div className="flex gap-6 overflow-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`shrink-0 pb-[9px] text-sm ${
                filter === f.key
                  ? "border-b-2 border-[#d6e2ff] pb-[calc(9px-2px)] font-semibold text-[#d6e2ff]"
                  : "text-[#c1c6d4]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <img
            src={searchIcon}
            alt=""
            className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm kiếm album..."
            className="w-full border border-[#43474f] bg-[#1c1b1b] py-[11px] pl-[41px] pr-[13px] text-sm text-[#e5e2e1] placeholder:text-[#c1c6d4] focus:outline-none focus:ring-1 focus:ring-[#a9c7ff]"
          />
        </div>
      </div>

      <div className="flex-1 pt-6">
        {error && (
          <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {!albums && !error && (
          <p className="text-sm text-[#c1c6d4]">Đang tải...</p>
        )}

        {albums && filteredAlbums.length === 0 && (
          <p className="text-sm text-[#c1c6d4]">
            {albums.length === 0 ? "Chưa có album nào." : "Không tìm thấy album phù hợp."}
          </p>
        )}

        {filteredAlbums.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAlbums.map((album) => {
              const badge = getStatusBadge(album);
              const deadlineInfo = getDeadlineInfo(album.selection_deadline);
              const isArchived = album.status === "archived";

              return (
                <Link
                  key={album.id}
                  to={`/admin/albums/${album.id}`}
                  className={`flex min-h-[300px] flex-col overflow-hidden rounded border border-[#43474f] bg-[#201f1f] transition-colors hover:border-[#a9c7ff] ${
                    isArchived ? "opacity-75" : ""
                  }`}
                >
                  <div className="relative h-[144px] shrink-0 overflow-hidden bg-gradient-to-br from-[#2a2a2a] to-[#141414]">
                    {album.cover_photo_id ? (
                      <img
                        src={`${import.meta.env.VITE_API_BASE_URL}/api/albums/${album.id}/photos/${album.cover_photo_id}/view?size=thumb`}
                        alt={album.name}
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-3">
                        <span className="text-4xl font-semibold text-[#43474f]">
                          {album.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div
                      className={`absolute right-3 top-3 border px-[9px] py-[5px] text-xs font-medium tracking-[0.6px] backdrop-blur-[2px] ${badge.bg} ${badge.border} ${badge.text}`}
                    >
                      {badge.label}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col justify-between p-4">
                    <div>
                      <h3
                        className={`truncate text-xl font-semibold ${
                          isArchived ? "text-[#c1c6d4]" : "text-[#e5e2e1]"
                        }`}
                      >
                        {album.name}
                      </h3>
                      <p className="mt-1 text-sm text-[#c1c6d4]">
                        {getPresetLabel(album.compression_preset_id)} · Tạo ngày{" "}
                        {formatDate(album.created_at)}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[#43474f] pt-[17px]">
                      {isArchived ? (
                        <div className="flex items-center gap-1.5">
                          <img src={lockIcon} alt="" className="h-3.5 w-[10.67px]" />
                          <span className="text-xs font-medium tracking-[0.6px] text-[#c1c6d4]">
                            Đã lưu trữ
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <img src={deadlineInfo.icon} alt="" className="h-3.5 w-3" />
                          <span
                            className={`text-xs font-medium tracking-[0.6px] ${deadlineInfo.color}`}
                          >
                            {deadlineInfo.text}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
