import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { useAuth } from "../../contexts/AuthContext";
import {
  CULLED_STAT_LABELS,
  PHOTO_ROLES,
  RETOUCH_ROLE,
  VIDEO_ROLES,
  formatCount,
  formatDateTime,
  formatDisplayDate,
  formatFolderName,
  inviteLink,
  isGoogleDriveUrl,
  notifyStudioShowsChanged,
  type CulledStats,
  type ShowDetailResponse,
  type ShowMember,
  type ShowStatus,
  type ShowSubmission,
  type StudioShow,
  type ViewerRole,
} from "../../lib/studioShows";
import Dialog, { dialogInputClass, dialogLabelClass, ghostButtonClass, primaryButtonClass } from "../../components/Dialog";
import Breadcrumbs from "../../components/ui/Breadcrumbs";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import {
  CopyButton,
  CrewAvatar,
  DeadlineCountdown,
  MemberBadge,
  SubmissionStatusBadge,
} from "../../components/studio/StudioBits";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckIcon,
  ExternalLinkIcon,
  PencilIcon,
  ShieldCheckIcon,
  TrashIcon,
  UsersIcon,
  VideoIcon,
  XIcon,
} from "../../components/Icons";

const ROLE_ORDER: string[] = [...PHOTO_ROLES, ...VIDEO_ROLES];
function roleRank(role: string) {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

export default function ShowDetailPage() {
  const { showId } = useParams<{ showId: string }>();
  const { photographer } = useAuth();
  const [data, setData] = useState<ShowDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ShowSubmission | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retouchOpen, setRetouchOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(() => {
    api
      .get<ShowDetailResponse>(`/api/studio/shows/${showId}`)
      .then(({ data }) => setData(data))
      .catch((err) => setError(getErrorMessage(err, "Không tải được show")));
  }, [showId]);
  useEffect(load, [load]);

  function applyChanged() {
    notifyStudioShowsChanged();
    load(); // cập nhật bài nộp + thống kê
  }

  async function approve(submission: ShowSubmission) {
    setApprovingId(submission.id);
    setActionError(null);
    try {
      await api.patch(`/api/studio/submissions/${submission.id}/review`, { status: "approved" });
      applyChanged();
    } catch (err) {
      setActionError(getErrorMessage(err, "Không duyệt được bài này, thử lại."));
    } finally {
      setApprovingId(null);
    }
  }

  const groups = useMemo(() => {
    const sorted = [...(data?.submissions ?? [])].sort(
      (a, b) => roleRank(a.role_position) - roleRank(b.role_position) || a.submitted_at.localeCompare(b.submitted_at)
    );
    return {
      photo: sorted.filter((s) => s.crew_type === "photo"),
      video: sorted.filter((s) => s.crew_type === "video"),
      retouch: sorted.filter((s) => s.crew_type === "retouch"),
    };
  }, [data]);

  if (error) {
    return (
      <div className="flex flex-col items-start gap-4">
        <BackLink current="Không tải được" />
        <p role="alert" className="rounded-2xl border border-rose-500/20 bg-rose-950/40 p-4 text-sm text-rose-300">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Đang tải">
        <div className="h-8 w-1/3 animate-pulse rounded-lg bg-white/5" />
        <div className="h-28 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-64 animate-pulse rounded-2xl bg-white/5" />
      </div>
    );
  }

  const { show, viewer_role: viewerRole, members } = data;
  const isStudio = viewerRole === "studio";
  const isEditor = viewerRole === "editor";
  const tableProps = { viewerRole, approvingId, onApprove: approve, onReject: setReviewTarget };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <BackLink tab={isEditor ? "editor" : isStudio ? "studio" : "crew"} current={`${show.class_name} — ${show.school_name}`} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs tabular-nums text-zinc-400">
              {formatDisplayDate(show.shoot_date)} · kết thúc chụp {formatDateTime(show.shoot_end_time)}
            </p>
            <title>{`${show.class_name} — ${show.school_name} · LensProof`}</title>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {show.class_name} <span className="text-zinc-500">—</span> {show.school_name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              {isStudio ? "Bạn là chủ Studio của show này" : `Studio: ${show.studio_name}`}
              {isEditor && <MemberBadge kind="editor" />}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isStudio && (
              <>
                <span className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 font-mono text-sm font-semibold tracking-wider text-indigo-300" translate="no">
                  {show.invite_code}
                </span>
                <CopyButton value={inviteLink(show.invite_code)} label="Copy link mời" size="md" />
              </>
            )}
            {isEditor && (
              <button type="button" onClick={() => setRetouchOpen(true)} className={primaryButtonClass}>
                <PencilIcon size={15} /> Nộp link ảnh đã hậu kỳ
              </button>
            )}
            {viewerRole === "crew" && (
              <Link to={`/admin/shows/${show.id}/submit`} className={primaryButtonClass}>
                Nộp / cập nhật bài của tôi
              </Link>
            )}
          </div>
        </div>
      </div>

      {isStudio && <ShowAdminBar show={show} onChanged={applyChanged} onDelete={() => setDeleteOpen(true)} />}

      {isEditor && (
        <p className="flex items-start gap-2 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-950/20 p-4 text-sm text-fuchsia-100">
          <ShieldCheckIcon size={16} className="mt-0.5 shrink-0 text-fuchsia-300" />
          Bạn tham gia với tư cách Editor: mở Drive của từng thợ để tải file gốc, chỉnh xong thì bấm “Nộp link ảnh đã hậu kỳ” để Studio nhận.
        </p>
      )}

      {/* Countdown + KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="col-span-2 lg:col-span-1">
          <DeadlineCountdown shootEndTime={show.shoot_end_time} deadlineAt={show.deadline_at} />
        </div>
        <Kpi label="Thợ đã nộp" value={`${show.stats.submitted_crew_count}/${show.stats.crew_member_count}`} />
        <Kpi label="Ảnh · Clip" value={`${formatCount(show.stats.total_photo_files)} · ${formatCount(show.stats.total_video_clips)}`} />
        <Kpi label="Ảnh đã hậu kỳ" value={formatCount(show.stats.total_retouch_files)} />
        <Kpi
          label="Chờ duyệt / Trễ hạn"
          value={`${show.stats.pending_count} / ${show.stats.late_count}`}
          tone={show.stats.pending_count || show.stats.late_count ? "amber" : undefined}
        />
      </div>

      <CrewSection members={members} isStudio={isStudio} showId={show.id} onChanged={applyChanged} />

      {actionError && (
        <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-sm text-rose-300">{actionError}</p>
      )}

      <SubmissionTable kind="photo" title="Thợ ảnh" icon={<CameraIcon size={16} />} submissions={groups.photo} {...tableProps} />
      <SubmissionTable kind="video" title="Thợ quay phim" icon={<VideoIcon size={16} />} submissions={groups.video} {...tableProps} />
      {(isStudio || isEditor || groups.retouch.length > 0) && (
        <SubmissionTable kind="retouch" title="Ảnh đã hậu kỳ" icon={<PencilIcon size={16} />} submissions={groups.retouch} {...tableProps} />
      )}
      {viewerRole === "crew" && (
        <p className="text-xs text-zinc-500">Link Drive và ghi chú của Studio dành cho từng thợ chỉ người đó, Studio và Editor xem được.</p>
      )}

      <RejectDialog submission={reviewTarget} onClose={() => setReviewTarget(null)} onDone={applyChanged} />
      {isEditor && (
        <RetouchDialog
          open={retouchOpen}
          onClose={() => setRetouchOpen(false)}
          show={show}
          existing={groups.retouch.find((s) => s.crew_user_id === photographer?.id) ?? null}
          onDone={applyChanged}
        />
      )}
      {isStudio && <DeleteShowDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} show={show} />}
    </div>
  );
}

function BackLink({ tab = "studio", current }: { tab?: string; current: string }) {
  return <Breadcrumbs items={[{ label: "Bàn giao Ekip", to: `/admin/shows?tab=${tab}` }, { label: current }]} />;
}

// ------------------------------------------------------------------ quản lý show (chủ Studio)

const STATUS_META: Record<ShowStatus, { label: string; hint: string; className: string; dot: string }> = {
  open: {
    label: "Đang nhận bàn giao",
    hint: "Thợ và editor vào được bằng mã mời",
    className: "border-emerald-500/30 bg-emerald-950/60 text-emerald-300",
    dot: "bg-emerald-400",
  },
  completed: {
    label: "Đã chốt file gốc",
    hint: "Không nhận thợ mới; editor vẫn vào và nộp ảnh hậu kỳ",
    className: "border-indigo-500/30 bg-indigo-950/60 text-indigo-200",
    dot: "bg-indigo-400",
  },
  archived: {
    label: "Lưu trữ",
    hint: "Không nhận thêm thành viên hay bài nộp",
    className: "border-white/10 bg-zinc-800/80 text-zinc-300",
    dot: "bg-zinc-400",
  },
};

const STATUS_ACTIONS: Record<ShowStatus, { to: ShowStatus; label: string }[]> = {
  open: [
    { to: "completed", label: "Chốt file gốc" },
    { to: "archived", label: "Lưu trữ" },
  ],
  completed: [
    { to: "open", label: "Mở lại nhận file gốc" },
    { to: "archived", label: "Lưu trữ" },
  ],
  archived: [{ to: "open", label: "Mở lại show" }],
};

function ShowAdminBar({ show, onChanged, onDelete }: { show: StudioShow; onChanged: () => void; onDelete: () => void }) {
  const [busyStatus, setBusyStatus] = useState<ShowStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const meta = STATUS_META[show.status];

  async function changeStatus(status: ShowStatus) {
    setBusyStatus(status);
    setError(null);
    try {
      await api.patch(`/api/studio/shows/${show.id}`, { status });
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, "Không đổi được trạng thái show, thử lại."));
    } finally {
      setBusyStatus(null);
    }
  }

  return (
    <section aria-label="Quản lý show" className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-900/50 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold ${meta.className}`}>
          <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          {meta.label}
        </span>
        <span className="truncate text-xs text-zinc-400">{meta.hint}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_ACTIONS[show.status].map((action) => (
          <button
            key={action.to}
            type="button"
            onClick={() => changeStatus(action.to)}
            disabled={busyStatus !== null}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            {busyStatus === action.to ? "Đang lưu…" : action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRotateOpen(true)}
          className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/5 hover:text-white"
        >
          Đổi mã mời
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10"
        >
          <TrashIcon size={13} /> Xoá show
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-rose-300 lg:basis-full">{error}</p>}
      <ConfirmDialog
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        title="Đổi mã mời?"
        description={`Mã hiện tại: ${show.invite_code}`}
        confirmLabel="Đổi mã mới"
        onConfirm={async () => {
          try {
            await api.post(`/api/studio/shows/${show.id}/rotate-invite`);
          } catch (err) {
            throw new Error(getErrorMessage(err, "Không đổi được mã mời, thử lại."));
          }
          onChanged();
        }}
      >
        <p>Mã và link mời cũ hết hiệu lực ngay. Người đã tham gia vẫn giữ nguyên — nhớ gửi mã mới vào nhóm ekip.</p>
      </ConfirmDialog>
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === "amber" ? "border-amber-500/20 bg-amber-950/10" : "border-white/10 bg-zinc-900/40"}`}>
      <p className={`text-xs font-medium ${tone === "amber" ? "text-amber-300/90" : "text-zinc-400"}`}>{label}</p>
      <p className={`mt-2 truncate text-2xl font-bold tabular-nums tracking-tight ${tone === "amber" ? "text-amber-200" : "text-white"}`}>{value}</p>
    </div>
  );
}

// ------------------------------------------------------------------ ekip

function memberBadges(member: ShowMember): ("photo" | "video" | "editor" | "crew")[] {
  if (member.role_type === "editor") return ["editor"];
  const kinds = member.crew_types.filter((t): t is "photo" | "video" => t === "photo" || t === "video");
  return kinds.length > 0 ? kinds : ["crew"];
}

function CrewSection({
  members,
  isStudio,
  showId,
  onChanged,
}: {
  members: ShowMember[];
  isStudio: boolean;
  showId: string;
  onChanged: () => void;
}) {
  const { photographer } = useAuth();
  const [kickTarget, setKickTarget] = useState<ShowMember | null>(null);
  const waiting = members.filter((m) => m.role_type === "crew" && m.submission_count === 0).length;
  return (
    <section aria-labelledby="crew-heading" className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="crew-heading" className="flex items-center gap-2 text-sm font-semibold text-white">
          <UsersIcon size={16} className="text-indigo-300" /> Ekip
          <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-medium tabular-nums text-zinc-300">{members.length}</span>
        </h2>
        {waiting > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
            <AlertTriangleIcon size={13} /> {waiting} thợ đã vào nhưng chưa nộp
          </span>
        )}
      </div>
      {members.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">Chưa ai nhập mã mời.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => {
            const name = m.display_name || m.email || "Thành viên";
            const badges = memberBadges(m);
            return (
              <li key={m.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-2.5">
                <CrewAvatar name={name} crewType={m.role_type === "editor" ? "retouch" : badges[0] === "video" ? "video" : "photo"} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100" title={isStudio ? m.email : undefined}>
                    {name}
                    {m.user_id === photographer?.id && <span className="ml-1.5 text-[10px] font-medium text-indigo-300">(bạn)</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {badges.map((b) => (
                      <MemberBadge key={b} kind={b} />
                    ))}
                  </div>
                </div>
                {m.submission_count > 0 && (
                  <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{m.submission_count} bài</span>
                )}
                {isStudio && m.user_id !== photographer?.id && (
                  <button
                    type="button"
                    onClick={() => setKickTarget(m)}
                    aria-label={`Mời ${name} ra khỏi show`}
                    title="Mời ra khỏi show"
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                  >
                    <XIcon size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={kickTarget !== null}
        onClose={() => setKickTarget(null)}
        tone="danger"
        title={`Mời ${kickTarget?.display_name || kickTarget?.email || "thành viên"} ra khỏi show?`}
        confirmLabel="Mời ra"
        onConfirm={async () => {
          if (!kickTarget) return;
          try {
            await api.delete(`/api/studio/shows/${showId}/members/${kickTarget.id}`);
          } catch (err) {
            throw new Error(getErrorMessage(err, "Không mời ra được, thử lại."));
          }
          onChanged();
        }}
      >
        {kickTarget && kickTarget.submission_count > 0 ? (
          <p>
            <strong className="text-rose-200">
              <span className="tabular-nums">{kickTarget.submission_count}</span> bài người này đã nộp sẽ bị xoá theo.
            </strong>{" "}
            File trên Google Drive của họ không bị ảnh hưởng.
          </p>
        ) : (
          <p>Người này chưa nộp bài nào.</p>
        )}
        <p className="text-xs text-zinc-400">Nếu mã mời bị lộ, hãy “Đổi mã mời” để họ không vào lại được.</p>
      </ConfirmDialog>
    </section>
  );
}

// ------------------------------------------------------------------ bảng bài nộp

function CulledChips({ stats }: { stats: CulledStats }) {
  const entries = (Object.keys(CULLED_STAT_LABELS) as (keyof CulledStats)[])
    .map((key) => [key, stats[key] ?? 0] as const)
    .filter(([, count]) => count > 0);
  if (entries.length === 0) return <span className="text-xs text-zinc-500">Không có ảnh lỗi</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {entries.map(([key, count]) => (
        <li key={key} className="whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-300">
          {CULLED_STAT_LABELS[key]} <span className="font-semibold tabular-nums text-white">{count}</span>
        </li>
      ))}
    </ul>
  );
}

function YesNo({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${ok ? "text-emerald-300" : "text-rose-300"}`}>
      {ok ? <CheckIcon size={13} /> : <XIcon size={13} />}
      {ok ? yes : no}
    </span>
  );
}

function SubmissionTable({
  kind,
  title,
  icon,
  submissions,
  viewerRole,
  approvingId,
  onApprove,
  onReject,
}: {
  kind: "photo" | "video" | "retouch";
  title: string;
  icon: React.ReactNode;
  submissions: ShowSubmission[];
  viewerRole: ViewerRole;
  approvingId: string | null;
  onApprove: (s: ShowSubmission) => void;
  onReject: (s: ShowSubmission) => void;
}) {
  const { photographer } = useAuth();
  const isStudio = viewerRole === "studio";
  const isRaw = kind !== "retouch";
  return (
    <section aria-label={title} className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur-xl">
      <h2 className="flex items-center gap-2 border-b border-white/10 px-5 py-3.5 text-sm font-semibold text-white">
        <span className={kind === "retouch" ? "text-fuchsia-300" : "text-indigo-300"}>{icon}</span>
        {title}
        <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-medium tabular-nums text-zinc-300">{submissions.length}</span>
      </h2>
      {submissions.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-zinc-500">
          {kind === "retouch" ? "Editor chưa nộp ảnh đã hậu kỳ." : `Chưa có ${title.toLowerCase()} nào nộp bài.`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full text-left text-xs text-zinc-300 ${isRaw ? "min-w-[980px]" : "min-w-[720px]"}`}>
            <thead className="border-b border-white/10 bg-white/[0.02] font-mono text-[11px] uppercase tracking-wider text-zinc-400">
              <tr>
                <th scope="col" className="px-5 py-3">{kind === "retouch" ? "Editor" : "Thợ · vai trò"} · tên chuẩn</th>
                <th scope="col" className="px-4 py-3 text-right">{kind === "video" ? "Số clip" : kind === "retouch" ? "Ảnh đã chỉnh" : "Số file"}</th>
                {isRaw && <th scope="col" className="px-4 py-3">{kind === "photo" ? "Lọc AI" : "Footage"}</th>}
                {isRaw && <th scope="col" className="px-4 py-3">Cấu trúc</th>}
                {isRaw && <th scope="col" className="px-4 py-3">Backup 45 ngày</th>}
                <th scope="col" className="px-4 py-3">{isRaw ? "Hạn 24h" : "Nộp lúc"}</th>
                <th scope="col" className="px-4 py-3">Trạng thái</th>
                <th scope="col" className="px-5 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {submissions.map((s) => {
                const isMine = s.crew_user_id === photographer?.id;
                return (
                  <tr key={s.id} className="align-top transition-colors hover:bg-white/[0.03]">
                    <td className="px-5 py-3.5">
                      <div className="flex items-start gap-3">
                        <CrewAvatar name={s.crew_name} crewType={s.crew_type} status={s.status} />
                        <div className="min-w-0">
                          <p className="font-semibold text-white">
                            {s.crew_name}
                            {isMine && <span className="ml-1.5 text-[10px] font-medium text-indigo-300">(bạn)</span>}
                          </p>
                          {kind !== "retouch" && <p className="text-[11px] text-zinc-400">{s.role_position}</p>}
                          <div className="mt-1.5 flex max-w-[320px] items-center gap-2">
                            <code className="min-w-0 truncate text-[10px] text-zinc-500" title={s.formatted_folder_name} translate="no">
                              {s.formatted_folder_name}
                            </code>
                            {s.drive_url && (
                              <CopyButton value={s.formatted_folder_name} label="Copy tên chuẩn" copiedLabel="Đã copy" className="px-2 py-1 text-[10px]" />
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <p className="text-sm font-semibold tabular-nums text-white">{formatCount(s.total_files)}</p>
                      {kind === "photo" && (
                        <p className="whitespace-nowrap text-[10px] tabular-nums text-zinc-500">
                          RAW {formatCount(s.raw_count)} · JPG {formatCount(s.jpg_count)}
                        </p>
                      )}
                    </td>
                    {isRaw && (
                      <td className="px-4 py-3.5">
                        {kind === "photo" ? <CulledChips stats={s.culled_stats} /> : <span className="text-xs tabular-nums text-zinc-400">{formatCount(s.video_count)} clip gốc</span>}
                      </td>
                    )}
                    {isRaw && (
                      <td className="px-4 py-3.5">
                        <YesNo ok={s.has_valid_structure} yes="Đủ" no="Thiếu" />
                      </td>
                    )}
                    {isRaw && (
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                          <ShieldCheckIcon size={13} /> Đã cam kết
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3.5">
                      {s.is_on_time_24h !== null && <YesNo ok={s.is_on_time_24h} yes="Đúng hạn" no="Trễ hạn" />}
                      <p className="mt-0.5 whitespace-nowrap text-[10px] tabular-nums text-zinc-500">{formatDateTime(s.submitted_at)}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <SubmissionStatusBadge status={s.status} />
                      {s.status === "rejected" && s.studio_note && (
                        <p className="mt-1.5 max-w-[200px] text-[11px] text-rose-300/90">“{s.studio_note}”</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {s.drive_url && (
                          <a
                            href={s.drive_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/15 hover:text-white"
                          >
                            {viewerRole === "editor" && kind !== "retouch" ? "Mở Drive tải file" : "Mở Drive"} <ExternalLinkIcon size={12} />
                            <span className="sr-only">của {s.crew_name} (mở tab mới)</span>
                          </a>
                        )}
                        {isStudio && s.status !== "approved" && (
                          <button
                            type="button"
                            onClick={() => onApprove(s)}
                            disabled={approvingId === s.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            <CheckIcon size={12} />
                            {approvingId === s.id ? "Đang duyệt…" : "Duyệt"}
                            <span className="sr-only">bài của {s.crew_name}</span>
                          </button>
                        )}
                        {isStudio && (
                          <button
                            type="button"
                            onClick={() => onReject(s)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10"
                          >
                            Yêu cầu sửa
                            <span className="sr-only">bài của {s.crew_name}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ dialogs

function RejectDialog({
  submission,
  onClose,
  onDone,
}: {
  submission: ShowSubmission | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mở cho bài khác thì làm mới ô ghi chú
  const [lastId, setLastId] = useState<string | null>(null);
  if ((submission?.id ?? null) !== lastId) {
    setLastId(submission?.id ?? null);
    setNote("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!submission) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.patch(`/api/studio/submissions/${submission.id}/review`, { status: "rejected", studio_note: note });
      onDone();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Không gửi được yêu cầu sửa, thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={submission !== null}
      onClose={onClose}
      dismissible={!isSubmitting}
      size="sm"
      title={submission?.crew_type === "retouch" ? "Yêu cầu editor sửa lại" : "Yêu cầu thợ sửa lại"}
      description={submission ? `${submission.crew_name} · ${submission.role_position}` : undefined}
      icon={<AlertTriangleIcon size={18} />}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={isSubmitting} className={ghostButtonClass}>
            Hủy
          </button>
          <button type="submit" form={`${id}-form`} disabled={isSubmitting || note.trim().length === 0} className={primaryButtonClass}>
            {isSubmitting ? "Đang gửi…" : "Gửi yêu cầu sửa"}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor={`${id}-note`} className={dialogLabelClass}>Cần sửa gì?</label>
        <textarea
          id={`${id}-note`}
          name="studio_note"
          rows={4}
          maxLength={1000}
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            submission?.crew_type === "retouch"
              ? "VD: Da mặt hơi bệt, giảm smooth lại; ảnh tập thể cần cân sáng đều…"
              : "VD: Thiếu folder RAW nén, còn 12 ảnh nhắm mắt trong folder JPG…"
          }
          className={`${dialogInputClass} resize-y`}
        />
        <p className="text-[11px] text-zinc-500">Người nộp sẽ thấy ghi chú này khi mở lại show.</p>
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      </form>
    </Dialog>
  );
}

/** Editor nộp (hoặc nộp lại) link thư mục ảnh đã hậu kỳ. */
function RetouchDialog({
  open,
  onClose,
  show,
  existing,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  show: StudioShow;
  existing: ShowSubmission | null;
  onDone: () => void;
}) {
  const { photographer } = useAuth();
  const id = useId();
  const [name, setName] = useState(existing?.crew_name ?? photographer?.display_name ?? "");
  const [count, setCount] = useState(existing ? String(existing.total_files) : "");
  const [driveUrl, setDriveUrl] = useState(existing?.drive_url ?? "");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = Number(count);
  const countValid = Number.isInteger(total) && total > 0;
  const urlValid = isGoogleDriveUrl(driveUrl);
  const locked = existing?.status === "approved";
  const canSubmit = !locked && name.trim() !== "" && countValid && urlValid && !isSubmitting;
  const folderName = formatFolderName({
    shootDate: show.shoot_date,
    crewName: name || "Tên editor",
    rolePosition: RETOUCH_ROLE,
    totalFiles: countValid ? total : 0,
    crewType: "retouch",
    className: show.class_name,
    schoolName: show.school_name,
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/studio/shows/${show.id}/submit`, {
        crew_type: "retouch",
        crew_name: name,
        drive_url: driveUrl.trim(),
        total_files: total,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Không gửi được link ảnh hậu kỳ, thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const showUrlError = touched && driveUrl.trim() !== "" && !urlValid;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!isSubmitting}
      title="Nộp link ảnh đã hậu kỳ"
      description={`${show.class_name} — ${show.school_name}`}
      icon={<PencilIcon size={18} />}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={isSubmitting} className={ghostButtonClass}>
            Hủy
          </button>
          <button type="submit" form={`${id}-form`} disabled={!canSubmit} className={primaryButtonClass}>
            {isSubmitting ? "Đang gửi…" : existing ? "Gửi lại cho Studio" : "Gửi cho Studio"}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {existing && (
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-zinc-900/60 p-3 text-xs text-zinc-300">
            <div className="flex items-center justify-between gap-2">
              <span>Bài đã nộp lúc <span className="tabular-nums">{formatDateTime(existing.submitted_at)}</span></span>
              <SubmissionStatusBadge status={existing.status} />
            </div>
            {existing.status === "rejected" && existing.studio_note && (
              <p className="text-rose-200">Studio yêu cầu sửa: {existing.studio_note}</p>
            )}
            {locked && <p className="text-emerald-300">Studio đã duyệt bài này — không cần nộp lại.</p>}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_9rem]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-name`} className={dialogLabelClass}>Tên editor</label>
            <input id={`${id}-name`} name="crew_name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={dialogInputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-count`} className={dialogLabelClass}>Số ảnh đã chỉnh</label>
            <input
              id={`${id}-count`}
              name="total_files"
              type="number"
              inputMode="numeric"
              min={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-invalid={touched && !countValid ? true : undefined}
              className={`${dialogInputClass} tabular-nums`}
            />
          </div>
        </div>
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
          <p className={dialogLabelClass}>Tên folder chuẩn</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 break-words font-mono text-sm font-semibold text-white" translate="no">{folderName}</p>
            <CopyButton value={folderName} label="Copy tên chuẩn" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-drive`} className={dialogLabelClass}>Link Google Drive thư mục ảnh đã chỉnh</label>
          <input
            id={`${id}-drive`}
            name="drive_url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="https://drive.google.com/drive/folders/…"
            aria-invalid={showUrlError || undefined}
            aria-describedby={`${id}-drive-hint`}
            className={dialogInputClass}
          />
          <p id={`${id}-drive-hint`} className={`text-xs ${showUrlError ? "text-rose-300" : "text-zinc-500"}`}>
            {showUrlError ? "Chỉ nhận link Google Drive (https://drive.google.com/…)" : "Nhớ chia sẻ folder ở chế độ “Bất kỳ ai có đường liên kết”"}
          </p>
        </div>
        {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
      </form>
    </Dialog>
  );
}

/** Xoá show — gõ lại tên lớp để xác nhận vì không hoàn tác được. */
function DeleteShowDialog({ open, onClose, show }: { open: boolean; onClose: () => void; show: StudioShow }) {
  const navigate = useNavigate();
  const id = useId();
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const matches = confirmText.trim().toLowerCase() === show.class_name.trim().toLowerCase();

  async function handleDelete(event: FormEvent) {
    event.preventDefault();
    if (!matches) return;
    setIsDeleting(true);
    setError(null);
    try {
      await api.delete(`/api/studio/shows/${show.id}`);
      notifyStudioShowsChanged();
      navigate("/admin/shows?tab=studio", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Không xoá được show, thử lại."));
      setIsDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!isDeleting}
      size="sm"
      title="Xoá show này?"
      description={`${show.class_name} — ${show.school_name}`}
      icon={<TrashIcon size={18} />}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={isDeleting} className={ghostButtonClass}>
            Hủy
          </button>
          <button
            type="submit"
            form={`${id}-form`}
            disabled={!matches || isDeleting}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? "Đang xoá…" : "Xoá vĩnh viễn"}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={handleDelete} className="flex flex-col gap-3 text-sm text-zinc-300">
        <p>
          Toàn bộ thành viên, <span className="font-semibold tabular-nums text-white">{show.stats.submission_count}</span> bài nộp và mã mời{" "}
          <span className="font-mono text-white" translate="no">{show.invite_code}</span> sẽ bị xoá. File trên Google Drive của thợ và editor không bị ảnh hưởng.
        </p>
        <label htmlFor={`${id}-confirm`} className={dialogLabelClass}>
          Gõ “{show.class_name}” để xác nhận
        </label>
        <input
          id={`${id}-confirm`}
          name="confirm"
          autoComplete="off"
          spellCheck={false}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className={dialogInputClass}
        />
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      </form>
    </Dialog>
  );
}
