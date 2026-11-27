// Bảng điều khiển — tổng quan công việc của PTG: album đang mở, khách đã gửi lựa chọn, ghi
// chú chờ sửa, khách chưa thanh toán, hạn chọn ảnh sắp tới và hoạt động gần đây.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { useAuth } from "../../contexts/auth";
import type { DashboardData } from "../../lib/types";
import { formatRelativeTime, formatTimeUntil, initials } from "../../lib/formatTime";
import { ListRow, ListSection } from "../../components/ios/GroupedList";
import { CheckIcon, ClockIcon, HeartIcon, ImagesIcon, PencilIcon, PlusIcon, UsersIcon } from "../../components/Icons";

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 11) return "Chào buổi sáng";
  if (h < 14) return "Chào buổi trưa";
  if (h < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  tone: string;
  to?: string;
}) {
  const body = (
    <>
      <span className={`flex size-8 items-center justify-center rounded-[9px] ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span className="mt-3 block text-[26px] font-bold leading-none tabular-nums text-white">{value}</span>
      <span className="mt-1.5 block text-[13px] font-medium text-zinc-300">{label}</span>
      {hint && <span className="mt-0.5 block truncate text-xs text-zinc-500">{hint}</span>}
    </>
  );
  const cls =
    "block min-w-0 rounded-2xl border border-white/[0.06] bg-zinc-900/80 p-4 transition-[background-color,transform] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";
  return to ? (
    <Link to={to} className={`${cls} hover:bg-zinc-900 active:scale-[0.98]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const ACTIVITY_META = {
  completed: { label: "đã gửi lựa chọn", color: "bg-emerald-500", icon: <CheckIcon size={14} /> },
  auto_locked: { label: "được tự chốt khi album hết hạn", color: "bg-zinc-500", icon: <ClockIcon size={12} /> },
  annotation: { label: "thêm ghi chú chỉnh sửa", color: "bg-amber-500", icon: <PencilIcon size={13} /> },
  joined: { label: "bắt đầu chọn ảnh", color: "bg-indigo-500", icon: <HeartIcon size={13} /> },
} as const;

export default function DashboardPage() {
  const { photographer } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mốc thời gian cố định cho 1 lần hiển thị (render phải thuần, không gọi Date.now() trực tiếp).
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    api
      .get<DashboardData>("/api/dashboard")
      .then(({ data: d }) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(getErrorMessage(err, "Không tải được số liệu tổng quan")));
    return () => {
      cancelled = true;
    };
  }, []);

  const name = photographer?.display_name?.split(" ").slice(-1)[0] ?? "";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium uppercase tracking-wide text-zinc-500">
            {new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="mt-0.5 text-balance text-[28px] font-bold leading-tight tracking-tight text-white sm:text-3xl">
            {greeting()}
            {name ? `, ${name}` : ""}
          </h1>
        </div>
        <Link
          to="/admin/albums/new"
          className="hidden h-10 shrink-0 items-center gap-1.5 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-colors hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 sm:inline-flex"
        >
          <PlusIcon size={16} /> Tạo album
        </Link>
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {!data && !error && (
        <div aria-busy="true" aria-label="Đang tải tổng quan" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-[134px] animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
            <StatCard
              to="/admin/albums"
              label="Album đang mở"
              value={data.albums.open}
              hint={`${data.albums.total} album · ${data.totals.photos} ảnh`}
              icon={<ImagesIcon size={17} />}
              tone="bg-indigo-500/20 text-indigo-300"
            />
            <StatCard
              to="/admin/clients?filter=completed"
              label="Khách đã gửi lựa chọn"
              value={
                <>
                  {data.totals.completed_clients}
                  <span className="text-base font-semibold text-zinc-500">/{data.totals.clients}</span>
                </>
              }
              hint={`${data.totals.selections} ảnh được chọn`}
              icon={<CheckIcon size={17} />}
              tone="bg-emerald-500/20 text-emerald-300"
            />
            <StatCard
              to="/admin/albums"
              label="Ghi chú chờ sửa"
              value={data.totals.pending_annotations}
              hint="Yêu cầu chỉnh sửa của khách"
              icon={<PencilIcon size={16} />}
              tone="bg-amber-500/20 text-amber-300"
            />
            <StatCard
              to="/admin/clients?filter=unpaid"
              label="Chưa thanh toán đủ"
              value={data.totals.unpaid_clients}
              hint="Khách chưa đánh dấu đã thanh toán"
              icon={<UsersIcon size={17} />}
              tone="bg-rose-500/20 text-rose-300"
            />
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
            <ListSection
              title="Hạn chọn ảnh sắp tới"
              footer={data.upcoming_deadlines.length === 0 ? undefined : "Album tự khoá khi hết hạn — khách không thể thả tim hay ghi chú."}
            >
              {data.upcoming_deadlines.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-zinc-500">Không có album nào sắp hết hạn chọn ảnh.</li>
              ) : (
                data.upcoming_deadlines.map((album) => {
                  const soon = new Date(album.selection_deadline).getTime() - now < 48 * 3600_000;
                  return (
                    <ListRow
                      key={album.id}
                      to={`/admin/albums/${album.id}`}
                      icon={
                        <span
                          className={`flex size-9 items-center justify-center rounded-full ${soon ? "bg-amber-500/20 text-amber-300" : "bg-white/[0.06] text-zinc-400"}`}
                          aria-hidden="true"
                        >
                          <ClockIcon size={16} />
                        </span>
                      }
                      title={album.name}
                      subtitle={`${album.completed_count}/${album.client_count} khách đã gửi lựa chọn`}
                      value={<span className={soon ? "text-amber-300" : undefined}>{formatTimeUntil(album.selection_deadline, now)}</span>}
                    />
                  );
                })
              )}
            </ListSection>

            <ListSection title="Hoạt động gần đây">
              {data.recent_activity.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-zinc-500">
                  Chưa có hoạt động nào. Gửi link album cho khách để bắt đầu.
                </li>
              ) : (
                data.recent_activity.map((item, index) => {
                  const meta = ACTIVITY_META[item.kind];
                  return (
                    <ListRow
                      key={`${item.kind}-${item.client_id}-${index}`}
                      to={`/admin/clients?client=${item.client_id}`}
                      icon={
                        <span className="relative" aria-hidden="true">
                          <span className="flex size-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
                            {initials(item.client_name)}
                          </span>
                          <span className={`absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full text-white ring-2 ring-zinc-900 ${meta.color}`}>
                            {meta.icon}
                          </span>
                        </span>
                      }
                      title={
                        <>
                          <span className="font-semibold">{item.client_name}</span>{" "}
                          <span className="text-zinc-400">{meta.label}</span>
                        </>
                      }
                      subtitle={item.detail ? `“${item.detail}”` : item.album_name}
                      value={<span className="text-[13px]">{formatRelativeTime(item.at, now)}</span>}
                    />
                  );
                })
              )}
            </ListSection>
          </div>

          {data.albums.total === 0 && (
            <div className="mt-8 rounded-2xl border border-dashed border-white/10 p-6 text-center">
              <p className="font-semibold text-zinc-100">Bắt đầu với album đầu tiên</p>
              <p className="mx-auto mt-1 max-w-sm text-pretty text-sm text-zinc-400">
                Tạo album, lọc ảnh bằng AI ngay trên máy và gửi link kèm mã PIN cho khách chọn ảnh.
              </p>
              <Link
                to="/admin/albums/new"
                className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-xl bg-indigo-500 px-5 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                <PlusIcon size={16} /> Tạo album
              </Link>
            </div>
          )}
        </>
      )}

      {/* Nút tạo nhanh trên mobile (iOS: nút nổi cạnh tiêu đề không đủ chỗ) */}
      <Link
        to="/admin/albums/new"
        aria-label="Tạo album mới"
        className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-full bg-indigo-500 text-white shadow-xl shadow-indigo-500/30 transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 sm:hidden"
      >
        <PlusIcon size={24} />
      </Link>
    </div>
  );
}
