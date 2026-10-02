import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { getPresetLabel } from "../../lib/compressionPresets";
import type { Album } from "../../lib/types";

type FilterKey = "all" | "open" | "archived";
type ViewMode = "grid" | "list";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "open", label: "Đang mở" },
  { key: "archived", label: "Lưu trữ" },
];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function deadlineDays(deadline: string | null) {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
}

function getStatusBadge(album: Album) {
  if (album.status === "archived") {
    return {
      label: "LƯU TRỮ",
      className: "border-white/10 bg-zinc-800/80 text-zinc-300",
      dot: "bg-zinc-400",
    };
  }
  if (album.is_locked) {
    return {
      label: "ĐÃ KHÓA",
      className: "border-rose-500/30 bg-rose-950/60 text-rose-300",
      dot: "bg-rose-400",
    };
  }
  const days = deadlineDays(album.selection_deadline);
  if (days !== null && days <= 3) {
    return {
      label: days <= 0 ? "HẾT HẠN" : "SẮP HẾT HẠN",
      className: "border-amber-500/30 bg-amber-950/60 text-amber-300",
      dot: "bg-amber-400",
    };
  }
  return {
    label: "ĐANG MỞ",
    className: "border-emerald-500/30 bg-emerald-950/60 text-emerald-300",
    dot: "bg-emerald-400",
  };
}

function formatDeadline(deadline: string | null) {
  const days = deadlineDays(deadline);
  if (days === null) return { text: "Không giới hạn", color: "text-zinc-400", alert: false };
  if (days < 0) return { text: "Đã quá hạn", color: "text-rose-400", alert: true };
  if (days === 0) return { text: "Hết hạn hôm nay", color: "text-rose-400", alert: true };
  if (days <= 3) return { text: `Còn ${days} ngày`, color: "text-amber-400", alert: true };
  return { text: `Còn ${days} ngày`, color: "text-zinc-300", alert: false };
}

export default function AlbumsPage() {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    api
      .get<{ albums: Album[] }>("/api/albums")
      .then(({ data }) => setAlbums(data.albums))
      .catch((err) =>
        setError(getErrorMessage(err, "Không tải được danh sách album"))
      );
  }, []);

  const stats = useMemo(() => {
    if (!albums) return { total: 0, open: 0, archived: 0 };
    return {
      total: albums.length,
      open: albums.filter((a) => a.status === "active" && !a.is_locked).length,
      archived: albums.filter((a) => a.status === "archived" || a.is_locked).length,
    };
  }, [albums]);

  const filteredAlbums = useMemo(() => {
    if (!albums) return [];
    return albums
      .filter((album) => {
        if (filter === "open") return album.status === "active" && !album.is_locked;
        if (filter === "archived") return album.status === "archived" || album.is_locked;
        return true;
      })
      .filter((album) =>
        album.name.toLowerCase().includes(search.trim().toLowerCase())
      );
  }, [albums, filter, search]);

  return (
    <div className="flex flex-col gap-8">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 font-mono">
            <span>Workspace</span>
            <span className="text-zinc-600">/</span>
            <span className="text-indigo-400 font-semibold">Kho Album</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Danh sách bộ sưu tập
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Quản lý các bộ sưu tập ảnh cưới, sự kiện và tiến độ chọn ảnh của khách hàng.
          </p>
        </div>

        <Link
          to="/admin/albums/new"
          className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 border border-indigo-400/30 transition-all duration-200 hover:from-indigo-400 hover:to-indigo-500 hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0"
        >
          <svg
            className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Tạo album mới</span>
        </Link>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Total Albums */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 p-5 backdrop-blur-xl transition-all duration-200 hover:border-white/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Tổng số album</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-zinc-300">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 9h18" />
              </svg>
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {albums ? stats.total : "..."}
            </span>
            <span className="text-xs text-zinc-400 font-mono">bộ sưu tập</span>
          </div>
        </div>

        {/* Active Albums */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5 backdrop-blur-xl transition-all duration-200 hover:border-emerald-500/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-400/80">Đang mở chọn ảnh</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-emerald-300">
              {albums ? stats.open : "..."}
            </span>
            <span className="text-xs text-emerald-400/70 font-mono">khách đang duyệt</span>
          </div>
        </div>

        {/* Archived / Locked */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 p-5 backdrop-blur-xl transition-all duration-200 hover:border-white/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Đã chốt / Lưu trữ</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-zinc-400">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-zinc-300">
              {albums ? stats.archived : "..."}
            </span>
            <span className="text-xs text-zinc-400 font-mono">hoàn tất</span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar & Search */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-900/50 p-3 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        {/* Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
                filter === f.key
                  ? "bg-white/15 text-white shadow-sm border border-white/10"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              {f.label}
              {albums && f.key === "all" && (
                <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.2 text-[10px] text-zinc-300">
                  {albums.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search & View Mode */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
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
              placeholder="Tìm kiếm album..."
              className="w-full rounded-xl border border-white/10 bg-zinc-950/70 py-1.5 pl-9 pr-8 text-xs text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center rounded-xl border border-white/10 bg-zinc-950/60 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              title="Dạng lưới thẻ"
              className={`rounded-lg p-1.5 transition-colors ${
                viewMode === "grid"
                  ? "bg-white/15 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="7" height="7" x="3" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="14" rx="1" />
                <rect width="7" height="7" x="3" y="14" rx="1" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              title="Dạng bảng danh sách"
              className={`rounded-lg p-1.5 transition-colors ${
                viewMode === "list"
                  ? "bg-white/15 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-950/40 p-4 text-sm text-rose-300 backdrop-blur-xl">
          <svg className="h-5 w-5 shrink-0 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Loading Skeletons */}
      {!albums && !error && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 p-4 backdrop-blur-xl"
            >
              <div className="h-44 w-full rounded-xl bg-white/5 animate-pulse" />
              <div className="mt-4 h-5 w-3/4 rounded-md bg-white/5 animate-pulse" />
              <div className="mt-2 h-4 w-1/2 rounded-md bg-white/5 animate-pulse" />
              <div className="mt-6 h-8 w-full rounded-xl bg-white/5 animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {albums && filteredAlbums.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-zinc-900/30 p-12 text-center backdrop-blur-xl">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900 shadow-inner">
            <svg className="h-8 w-8 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-semibold text-white">
            {albums.length === 0 ? "Chưa có album nào" : "Không tìm thấy kết quả phù hợp"}
          </h3>
          <p className="mt-1 max-w-sm text-xs text-zinc-400">
            {albums.length === 0
              ? "Tạo album đầu tiên để bắt đầu tải ảnh, chia sẻ với khách hàng và sử dụng tính năng lọc ảnh AI."
              : `Không có album nào khớp với từ khóa "${search}". Hãy thử tìm với từ khóa khác.`}
          </p>
          {albums.length === 0 && (
            <Link
              to="/admin/albums/new"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-400"
            >
              + Tạo album đầu tiên
            </Link>
          )}
        </div>
      )}

      {/* Grid View */}
      {albums && filteredAlbums.length > 0 && viewMode === "grid" && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredAlbums.map((album) => {
            const badge = getStatusBadge(album);
            const deadlineInfo = formatDeadline(album.selection_deadline);
            const isArchived = album.status === "archived";

            return (
              <Link
                key={album.id}
                to={`/admin/albums/${album.id}`}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur-xl transition-all duration-300 hover:border-indigo-500/40 hover:shadow-2xl hover:shadow-indigo-500/10 hover:-translate-y-1 ${
                  isArchived ? "opacity-75" : ""
                }`}
              >
                {/* Top Subtle Highlight Line */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                {/* Cover Photo Container */}
                <div className="relative aspect-[16/10] overflow-hidden bg-zinc-950">
                  {album.cover_photo_id ? (
                    <img
                      src={`${import.meta.env.VITE_API_BASE_URL}/api/albums/${album.id}/photos/${album.cover_photo_id}/view?size=thumb`}
                      alt={album.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-950">
                      <span className="text-4xl font-extrabold text-zinc-700 select-none group-hover:text-indigo-400/50 transition-colors">
                        {album.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}

                  {/* Gradient Overlay */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-black/30" />

                  {/* Top Badges */}
                  <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {album.pin_enabled && (
                        <span
                          title="Bảo vệ bằng PIN"
                          className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/50 px-2 py-0.5 text-[10px] font-medium text-amber-300 backdrop-blur-md"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          PIN
                        </span>
                      )}
                      {album.watermark_enabled && (
                        <span
                          title="Đang bật Watermark"
                          className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/50 px-2 py-0.5 text-[10px] font-medium text-cyan-300 backdrop-blur-md"
                        >
                          WM
                        </span>
                      )}
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[10px] font-semibold tracking-wider backdrop-blur-md ${badge.className}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                      {badge.label}
                    </span>
                  </div>
                </div>

                {/* Card Body */}
                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <h3 className="truncate text-base font-bold text-white transition-colors group-hover:text-indigo-300">
                      {album.name}
                    </h3>
                    <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                      <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                        {getPresetLabel(album.compression_preset_id)}
                      </span>
                      <span>•</span>
                      <span>
                        {album.max_selectable_photos
                          ? `Tối đa ${album.max_selectable_photos} ảnh`
                          : "Không giới hạn"}
                      </span>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <svg
                        className={`h-3.5 w-3.5 ${deadlineInfo.alert ? "text-amber-400" : "text-zinc-500"}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span className={`text-[11px] font-medium ${deadlineInfo.color}`}>
                        {deadlineInfo.text}
                      </span>
                    </div>

                    <span className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-white">
                      Chi tiết
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* List / Table View */}
      {albums && filteredAlbums.length > 0 && viewMode === "list" && (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur-xl">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="border-b border-white/10 bg-white/[0.02] text-[11px] uppercase tracking-wider text-zinc-400 font-mono">
              <tr>
                <th className="py-3.5 px-5">Tên Album</th>
                <th className="py-3.5 px-4">Cấu hình nén</th>
                <th className="py-3.5 px-4">Hạn chọn ảnh</th>
                <th className="py-3.5 px-4">Trạng thái</th>
                <th className="py-3.5 px-5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredAlbums.map((album) => {
                const badge = getStatusBadge(album);
                const deadlineInfo = formatDeadline(album.selection_deadline);
                return (
                  <tr key={album.id} className="group transition-colors hover:bg-white/[0.03]">
                    <td className="py-3.5 px-5">
                      <Link
                        to={`/admin/albums/${album.id}`}
                        className="font-semibold text-white group-hover:text-indigo-300 transition-colors"
                      >
                        {album.name}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-zinc-500">
                        <span>Tạo ngày {formatDate(album.created_at)}</span>
                        {album.pin_enabled && (
                          <span className="text-amber-400 font-mono text-[10px]">
                            [PIN]
                          </span>
                        )}
                        {album.watermark_enabled && (
                          <span className="text-cyan-400 font-mono text-[10px]">
                            [WM]
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-zinc-400">
                      {getPresetLabel(album.compression_preset_id)}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`font-medium ${deadlineInfo.color}`}>
                        {deadlineInfo.text}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${badge.className}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <Link
                        to={`/admin/albums/${album.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-zinc-200 transition-all hover:bg-white/15 hover:text-white"
                      >
                        Xem
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
