import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { useAuth } from "../../contexts/AuthContext";
import {
  OVERNIGHT_BEFORE,
  buildShootEndTime,
  formatCount,
  formatDisplayDate,
  inviteLink,
  notifyStudioShowsChanged,
  todayInVietnam,
  type MemberRole,
  type StudioShow,
} from "../../lib/studioShows";
import Dialog, {
  dialogInputClass,
  dialogLabelClass,
  ghostButtonClass,
  primaryButtonClass,
} from "../../components/Dialog";
import {
  CopyButton,
  CrewAvatarStack,
  DeadlineCountdown,
  MemberBadge,
  SubmissionStatusBadge,
} from "../../components/studio/StudioBits";
import { AlertTriangleIcon, CameraIcon, PencilIcon, PlusIcon, TicketIcon, UsersIcon, VideoIcon } from "../../components/Icons";

type Tab = "studio" | "crew" | "editor";
const TABS: Tab[] = ["studio", "crew", "editor"];

interface ShowsResponse {
  owned: StudioShow[];
  /** Tham gia làm thợ chụp/quay */
  joined: StudioShow[];
  /** Tham gia làm editor hậu kỳ */
  editing: StudioShow[];
}

export default function StudioShowsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "studio";
  const inviteCodeFromLink = searchParams.get("code");
  const [data, setData] = useState<ShowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(inviteCodeFromLink !== null);
  const tabsId = useId();

  const load = useCallback(() => {
    api
      .get<ShowsResponse>("/api/studio/shows")
      .then(({ data }) => {
        setData(data);
        setError(null);
      })
      .catch((err) => setError(getErrorMessage(err, "Không tải được danh sách show")));
  }, []);

  useEffect(load, [load]);

  function selectTab(next: Tab) {
    setSearchParams((params) => {
      params.set("tab", next);
      params.delete("code");
      return params;
    });
  }

  function closeJoin() {
    setJoinOpen(false);
    if (inviteCodeFromLink) {
      setSearchParams((params) => {
        params.delete("code");
        return params;
      });
    }
  }

  const studioStats = useMemo(() => {
    const owned = data?.owned ?? [];
    return {
      open: owned.filter((s) => s.status === "open").length,
      pending: owned.reduce((sum, s) => sum + s.stats.pending_count, 0),
      photos: owned.reduce((sum, s) => sum + s.stats.total_photo_files, 0),
      clips: owned.reduce((sum, s) => sum + s.stats.total_video_clips, 0),
    };
  }, [data]);

  const schoolSuggestions = useMemo(
    () => [...new Set((data?.owned ?? []).map((s) => s.school_name))],
    [data]
  );

  const tabs: { key: Tab; label: string; hint: string; count: number | null; badge?: number }[] = [
    { key: "studio", label: "Show của Studio", hint: "Dành cho chủ Studio", count: data ? data.owned.length : null, badge: studioStats.pending },
    { key: "crew", label: "Nộp file về Studio", hint: "Dành cho thợ ảnh & thợ quay", count: data ? data.joined.length : null },
    { key: "editor", label: "Hậu kỳ (Editor)", hint: "Nhận file gốc & trả ảnh chỉnh", count: data ? data.editing.length : null },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs font-medium text-zinc-400">
            <span>Workspace</span>
            <span className="text-zinc-600">/</span>
            <span className="font-semibold text-indigo-400">Bàn giao Ekip</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">Bàn giao Show Kỷ Yếu</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Mỗi lớp là một show. Ekip vào bằng mã mời, tự lọc ảnh rác trên máy rồi nộp link Drive trong 24 giờ.
          </p>
        </div>
        {tab === "studio" ? (
          <button type="button" onClick={() => setCreateOpen(true)} className={primaryButtonClass}>
            <PlusIcon size={16} strokeWidth={2.5} />
            Tạo Show / Lớp mới
          </button>
        ) : (
          <button type="button" onClick={() => setJoinOpen(true)} className={primaryButtonClass}>
            <TicketIcon size={16} />
            Nhập mã Show
          </button>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Vai trò" className="flex gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-zinc-900/50 p-1.5 backdrop-blur-xl">
        {tabs.map((t) => {
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${tabsId}-${t.key}`}
              aria-selected={selected}
              aria-controls={`${tabsId}-${t.key}-panel`}
              onClick={() => selectTab(t.key)}
              className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-left transition ${
                selected ? "border border-white/10 bg-white/10 text-white shadow-sm" : "border border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {t.label}
                  {t.count !== null && (
                    <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-medium tabular-nums text-zinc-300">{t.count}</span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-zinc-500">{t.hint}</span>
              </span>
              {t.badge ? (
                <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300">
                  {t.badge} chờ duyệt
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-950/40 p-4 text-sm text-rose-300">
          <AlertTriangleIcon size={18} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={load} className="text-xs font-semibold underline underline-offset-2 hover:text-rose-200">
            Thử lại
          </button>
        </div>
      )}

      <div role="tabpanel" id={`${tabsId}-${tab}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="flex flex-col gap-6">
        {!data && !error && <ShowGridSkeleton />}

        {data && tab === "studio" && (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard label="Show đang mở" value={studioStats.open} unit="lớp" />
              <KpiCard label="Bài chờ duyệt" value={studioStats.pending} unit="bài" tone={studioStats.pending ? "amber" : undefined} />
              <KpiCard label="Ảnh đã nhận" value={studioStats.photos} unit="file" />
              <KpiCard label="Clip đã nhận" value={studioStats.clips} unit="clip" />
            </div>
            {data.owned.length === 0 ? (
              <EmptyState
                title="Chưa có show nào"
                body="Tạo show cho một lớp, hệ thống sinh mã mời để bạn gửi vào nhóm ekip."
                action={
                  <button type="button" onClick={() => setCreateOpen(true)} className={primaryButtonClass}>
                    <PlusIcon size={16} /> Tạo show đầu tiên
                  </button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {data.owned.map((show) => (
                  <StudioShowCard key={show.id} show={show} />
                ))}
              </div>
            )}
          </>
        )}

        {data && tab === "crew" &&
          (data.joined.length === 0 ? (
            <EmptyState
              title="Bạn chưa được phân công lớp nào"
              body="Nhập mã show Studio gửi trong nhóm (VD: KL12A5-89) để bắt đầu nộp file."
              action={
                <button type="button" onClick={() => setJoinOpen(true)} className={primaryButtonClass}>
                  <TicketIcon size={16} /> Nhập mã Show
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {data.joined.map((show) => (
                <CrewShowCard key={show.id} show={show} />
              ))}
            </div>
          ))}

        {data && tab === "editor" &&
          (data.editing.length === 0 ? (
            <EmptyState
              title="Bạn chưa nhận hậu kỳ lớp nào"
              body="Nhập mã show và chọn “Tôi là Editor” để xem link Drive file gốc của cả ekip và nộp lại ảnh đã chỉnh."
              action={
                <button type="button" onClick={() => setJoinOpen(true)} className={primaryButtonClass}>
                  <TicketIcon size={16} /> Nhập mã Show
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {data.editing.map((show) => (
                <EditorShowCard key={show.id} show={show} />
              ))}
            </div>
          ))}
      </div>

      <CreateShowDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
        schoolSuggestions={schoolSuggestions}
      />
      <JoinShowDialog
        open={joinOpen}
        onClose={closeJoin}
        initialCode={inviteCodeFromLink ?? ""}
        defaultRole={tab === "editor" ? "editor" : "crew"}
      />
    </div>
  );
}

// ------------------------------------------------------------------ cards

function KpiCard({ label, value, unit, tone }: { label: string; value: number; unit: string; tone?: "amber" }) {
  return (
    <div
      className={`rounded-2xl border p-4 backdrop-blur-xl sm:p-5 ${
        tone === "amber" ? "border-amber-500/20 bg-amber-950/10" : "border-white/10 bg-zinc-900/40"
      }`}
    >
      <span className={`text-xs font-medium ${tone === "amber" ? "text-amber-300/90" : "text-zinc-400"}`}>{label}</span>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold tabular-nums tracking-tight sm:text-3xl ${tone === "amber" ? "text-amber-200" : "text-white"}`}>
          {formatCount(value)}
        </span>
        <span className="font-mono text-xs text-zinc-500">{unit}</span>
      </div>
    </div>
  );
}

const SHOW_STATUS_LABEL = { open: "Đang mở", completed: "Đã chốt", archived: "Lưu trữ" } as const;

function ShowCardShell({ show, children, footer }: { show: StudioShow; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-2xl hover:shadow-indigo-500/10 focus-within:border-indigo-500/40">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 font-mono tabular-nums text-zinc-300">
            {formatDisplayDate(show.shoot_date)}
          </span>
          <span
            className={`rounded-lg border px-2 py-0.5 font-semibold ${
              show.status === "open"
                ? "border-emerald-500/30 bg-emerald-950/60 text-emerald-300"
                : "border-white/10 bg-zinc-800/80 text-zinc-300"
            }`}
          >
            {SHOW_STATUS_LABEL[show.status]}
          </span>
        </div>
        {children}
      </div>
      {footer && <div className="border-t border-white/5 px-5 py-3">{footer}</div>}
    </article>
  );
}

function ShowTitle({ show, to }: { show: StudioShow; to: string }) {
  return (
    <div className="min-w-0">
      <h3 className="truncate text-lg font-bold text-white">
        {/* Stretched link: cả card bấm được, nhưng nút Copy bên trong vẫn là nút riêng (không lồng button trong a) */}
        <Link to={to} className="outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-indigo-400">
          {show.class_name}
        </Link>
      </h3>
      <p className="truncate text-sm text-zinc-400">{show.school_name}</p>
    </div>
  );
}

function StudioShowCard({ show }: { show: StudioShow }) {
  const { stats } = show;
  return (
    <ShowCardShell
      show={show}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-sm font-semibold tracking-wider text-indigo-300" translate="no">
            {show.invite_code}
          </span>
          <CopyButton value={inviteLink(show.invite_code)} label="Copy link mời" />
        </div>
      }
    >
      <ShowTitle show={show} to={`/admin/shows/${show.id}`} />
      <DeadlineCountdown shootEndTime={show.shoot_end_time} deadlineAt={show.deadline_at} />
      <div className="flex items-center justify-between gap-3">
        <CrewAvatarStack submitters={show.submitters ?? []} />
        {stats.pending_count > 0 && (
          <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300">
            {stats.pending_count} chờ duyệt
          </span>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat icon={<UsersIcon size={13} />} label="Thợ đã nộp" value={`${stats.submitted_crew_count}/${stats.member_count}`} />
        <Stat icon={<CameraIcon size={13} />} label="Ảnh" value={formatCount(stats.total_photo_files)} />
        <Stat icon={<VideoIcon size={13} />} label="Clip" value={formatCount(stats.total_video_clips)} />
      </dl>
      {(stats.editor_count > 0 || stats.retouch_count > 0) && (
        <p className="flex items-center gap-1.5 text-xs text-fuchsia-200/90">
          <PencilIcon size={12} />
          <span className="tabular-nums">
            {stats.editor_count} editor · {formatCount(stats.total_retouch_files)} ảnh đã hậu kỳ
          </span>
        </p>
      )}
    </ShowCardShell>
  );
}

function CrewShowCard({ show }: { show: StudioShow }) {
  const { photographer } = useAuth();
  const mine = (show.submitters ?? []).filter((s) => s.crew_user_id === photographer?.id);
  const needsFix = mine.some((s) => s.status === "rejected");
  return (
    <ShowCardShell
      show={show}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Link to={`/admin/shows/${show.id}`} className="relative z-10 text-xs font-semibold text-zinc-400 transition-colors hover:text-white">
            Xem ekip
          </Link>
          <Link to={`/admin/shows/${show.id}/submit`} className={`${primaryButtonClass} relative z-10 px-4 py-2 text-xs`}>
            Kiểm duyệt & Nộp file
          </Link>
        </div>
      }
    >
      <div>
        <ShowTitle show={show} to={`/admin/shows/${show.id}/submit`} />
        <p className="mt-0.5 truncate text-xs text-zinc-500">Studio: {show.studio_name}</p>
      </div>
      <DeadlineCountdown shootEndTime={show.shoot_end_time} deadlineAt={show.deadline_at} />
      {mine.length === 0 ? (
        <p className="text-xs text-zinc-400">Bạn chưa nộp bài cho lớp này.</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Bài bạn đã nộp">
          {mine.map((s) => (
            <li key={s.role_position} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-zinc-300">
                {s.role_position}
                {s.is_on_time_24h === false && <span className="ml-1.5 text-rose-300">· trễ hạn</span>}
              </span>
              <SubmissionStatusBadge status={s.status} />
            </li>
          ))}
        </ul>
      )}
      {needsFix && (
        <p className="flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-300">
          <AlertTriangleIcon size={13} /> Studio yêu cầu sửa lại — mở để xem ghi chú
        </p>
      )}
    </ShowCardShell>
  );
}

function EditorShowCard({ show }: { show: StudioShow }) {
  const { photographer } = useAuth();
  const { stats } = show;
  const myRetouch = (show.submitters ?? []).find((s) => s.crew_user_id === photographer?.id && s.crew_type === "retouch");
  return (
    <ShowCardShell
      show={show}
      footer={
        <div className="flex items-center justify-between gap-3">
          <MemberBadge kind="editor" />
          <Link to={`/admin/shows/${show.id}`} className={`${primaryButtonClass} relative z-10 px-4 py-2 text-xs`}>
            Mở file gốc & nộp ảnh chỉnh
          </Link>
        </div>
      }
    >
      <div>
        <ShowTitle show={show} to={`/admin/shows/${show.id}`} />
        <p className="mt-0.5 truncate text-xs text-zinc-500">Studio: {show.studio_name}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat icon={<UsersIcon size={13} />} label="Thợ đã nộp" value={`${stats.submitted_crew_count}/${stats.crew_member_count}`} />
        <Stat icon={<CameraIcon size={13} />} label="Ảnh gốc" value={formatCount(stats.total_photo_files)} />
        <Stat icon={<VideoIcon size={13} />} label="Clip" value={formatCount(stats.total_video_clips)} />
      </dl>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-2 text-xs">
        <span className="text-zinc-400">Ảnh đã hậu kỳ của bạn</span>
        {myRetouch ? <SubmissionStatusBadge status={myRetouch.status} /> : <span className="text-zinc-500">Chưa nộp</span>}
      </div>
    </ShowCardShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-2 py-2">
      <dt className="flex items-center justify-center gap-1 text-[10px] text-zinc-500">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-100">{value}</dd>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-zinc-900/30 p-12 text-center backdrop-blur-xl">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900 text-zinc-500 shadow-inner">
        <UsersIcon size={28} strokeWidth={1.5} />
      </div>
      <h2 className="mt-4 text-base font-semibold text-white">{title}</h2>
      <p className="mt-1 max-w-sm text-xs text-zinc-400">{body}</p>
      <div className="mt-5">{action}</div>
    </div>
  );
}

function ShowGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Đang tải">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-zinc-900/40 p-5">
          <div className="h-4 w-1/3 animate-pulse rounded bg-white/5" />
          <div className="h-6 w-2/3 animate-pulse rounded bg-white/5" />
          <div className="h-16 animate-pulse rounded-xl bg-white/5" />
          <div className="h-10 animate-pulse rounded-xl bg-white/5" />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ dialogs

function CreateShowDialog({
  open,
  onClose,
  onCreated,
  schoolSuggestions,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  schoolSuggestions: string[];
}) {
  const navigate = useNavigate();
  const id = useId();
  const [shootDate, setShootDate] = useState(todayInVietnam);
  const [endTime, setEndTime] = useState("17:00");
  const [className, setClassName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [created, setCreated] = useState<StudioShow | null>(null);

  function handleClose() {
    onClose();
    // Để dialog đóng hẳn rồi mới reset, tránh nháy nội dung
    setTimeout(() => {
      setCreated(null);
      setClassName("");
      setError(null);
    }, 200);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { data } = await api.post<{ show: StudioShow }>("/api/studio/shows", {
        shoot_date: shootDate,
        shoot_end_time: buildShootEndTime(shootDate, endTime),
        class_name: className,
        school_name: schoolName,
      });
      setCreated(data.show);
      onCreated();
      notifyStudioShowsChanged();
    } catch (err) {
      setError(getErrorMessage(err, "Không tạo được show. Kiểm tra lại thông tin rồi thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (created) {
    const link = inviteLink(created.invite_code);
    const message = [
      `📸 Show kỷ yếu ${created.class_name} — ${created.school_name} (${formatDisplayDate(created.shoot_date)})`,
      `Mã show: ${created.invite_code}`,
      `Vào nộp file: ${link}`,
      `Hạn bàn giao: 24 giờ sau khi kết thúc chụp.`,
    ].join("\n");
    return (
      <Dialog
        open={open}
        onClose={handleClose}
        title="Đã tạo show"
        description={`${created.class_name} — ${created.school_name}`}
        icon={<TicketIcon size={18} />}
        footer={
          <>
            <button type="button" onClick={handleClose} className={ghostButtonClass}>
              Đóng
            </button>
            <button type="button" onClick={() => navigate(`/admin/shows/${created.id}`)} className={primaryButtonClass}>
              Mở show
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 text-center">
            <p className={dialogLabelClass}>Mã mời ekip</p>
            <p className="mt-2 font-mono text-3xl font-bold tracking-widest text-white" translate="no">
              {created.invite_code}
            </p>
            <div className="mt-3 flex justify-center">
              <CopyButton value={created.invite_code} label="Copy mã" size="md" />
            </div>
          </div>
          <div>
            <p className={dialogLabelClass}>Link mời</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-zinc-900/80 px-3 py-2.5 text-xs text-zinc-300">{link}</code>
              <CopyButton value={link} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <p className={dialogLabelClass}>Tin nhắn gửi nhóm ekip</p>
              <CopyButton value={message} label="Copy tin nhắn" />
            </div>
            <pre className="mt-1.5 whitespace-pre-wrap rounded-xl border border-white/10 bg-zinc-900/80 p-3 font-sans text-xs leading-relaxed text-zinc-300">{message}</pre>
          </div>
        </div>
      </Dialog>
    );
  }

  const overnight = endTime !== "" && endTime < OVERNIGHT_BEFORE;
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      dismissible={!isSubmitting}
      title="Tạo Show / Lớp mới"
      description="Mỗi lớp một show — hạn bàn giao tính 24 giờ từ giờ kết thúc chụp"
      icon={<PlusIcon size={18} />}
      footer={
        <>
          <button type="button" onClick={handleClose} disabled={isSubmitting} className={ghostButtonClass}>
            Hủy
          </button>
          <button type="submit" form={`${id}-form`} disabled={isSubmitting} className={primaryButtonClass}>
            {isSubmitting && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />}
            {isSubmitting ? "Đang tạo…" : "Tạo show & sinh mã mời"}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={handleSubmit} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-date`} className={dialogLabelClass}>Ngày chụp</label>
          <input id={`${id}-date`} name="shoot_date" type="date" required value={shootDate} onChange={(e) => setShootDate(e.target.value)} className={dialogInputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-end`} className={dialogLabelClass}>Giờ kết thúc chụp</label>
          <input
            id={`${id}-end`}
            name="shoot_end_time"
            type="time"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            aria-describedby={`${id}-end-hint`}
            className={`${dialogInputClass} tabular-nums`}
          />
          <p id={`${id}-end-hint`} className="text-[11px] text-zinc-500">
            {overnight ? "Hiểu là rạng sáng hôm sau (giờ Việt Nam)" : "Giờ Việt Nam · mốc bắt đầu đếm 24h"}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-class`} className={dialogLabelClass}>Lớp</label>
          <input
            id={`${id}-class`}
            name="class_name"
            required
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            placeholder="VD: 12A5"
            className={dialogInputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-school`} className={dialogLabelClass}>Trường</label>
          <input
            id={`${id}-school`}
            name="school_name"
            required
            maxLength={160}
            autoComplete="off"
            list={`${id}-schools`}
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            placeholder="VD: THPT Kim Liên"
            className={dialogInputClass}
          />
          <datalist id={`${id}-schools`}>
            {schoolSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        {error && (
          <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-xs text-rose-300 sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

const JOIN_ROLES: { value: MemberRole; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: "crew", label: "Tôi là Thợ ảnh / Thợ quay", hint: "Nộp file gốc", icon: <CameraIcon size={18} /> },
  { value: "editor", label: "Tôi là Editor", hint: "Nhận file gốc & trả ảnh chỉnh", icon: <PencilIcon size={18} /> },
];

function JoinShowDialog({
  open,
  onClose,
  initialCode,
  defaultRole,
}: {
  open: boolean;
  onClose: () => void;
  initialCode: string;
  defaultRole: MemberRole;
}) {
  const navigate = useNavigate();
  const id = useId();
  const [code, setCode] = useState(initialCode);
  const [role, setRole] = useState<MemberRole>(defaultRole);

  // Mở dialog từ tab Editor thì chọn sẵn vai trò Editor
  const [lastDefault, setLastDefault] = useState(defaultRole);
  if (defaultRole !== lastDefault) {
    setLastDefault(defaultRole);
    setRole(defaultRole);
  }
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mở từ link mời mới (?code=…) thì điền sẵn mã đó
  const [lastInitial, setLastInitial] = useState(initialCode);
  if (initialCode !== lastInitial) {
    setLastInitial(initialCode);
    if (initialCode) setCode(initialCode);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { data } = await api.post<{ show: StudioShow; member_role: MemberRole }>("/api/studio/shows/join", {
        invite_code: code,
        role_type: role,
      });
      notifyStudioShowsChanged();
      // Thợ vào thẳng trang nộp file; editor vào trang chi tiết để lấy link Drive của ekip
      navigate(data.member_role === "editor" ? `/admin/shows/${data.show.id}` : `/admin/shows/${data.show.id}/submit`);
    } catch (err) {
      setError(getErrorMessage(err, "Không vào được show. Kiểm tra lại mã rồi thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!isSubmitting}
      size="sm"
      title="Nhập mã Show"
      description="Mã do Studio gửi trong nhóm ekip"
      icon={<TicketIcon size={18} />}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={isSubmitting} className={ghostButtonClass}>
            Hủy
          </button>
          <button type="submit" form={`${id}-form`} disabled={isSubmitting || code.trim().length < 4} className={primaryButtonClass}>
            {isSubmitting ? "Đang kiểm tra…" : "Vào show"}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={handleSubmit} className="flex flex-col gap-2">
        <fieldset className="mb-3">
          <legend className={dialogLabelClass}>Bạn tham gia với tư cách</legend>
          <div className="mt-2 flex flex-col gap-2">
            {JOIN_ROLES.map((r) => (
              <label
                key={r.value}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400 ${
                  role === r.value ? "border-indigo-500/50 bg-indigo-500/10" : "border-white/10 hover:border-white/20"
                }`}
              >
                <input type="radio" name={`${id}-role`} value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} className="sr-only" />
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${role === r.value ? "bg-indigo-500 text-white" : "bg-white/5 text-zinc-400"}`}>
                  {r.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{r.label}</span>
                  <span className="block text-xs text-zinc-400">({r.hint})</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor={`${id}-code`} className={dialogLabelClass}>Mã show</label>
        <input
          id={`${id}-code`}
          name="invite_code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="KL12A5-89"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${dialogInputClass} text-center font-mono text-xl tracking-widest`}
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="text-xs text-rose-300">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

