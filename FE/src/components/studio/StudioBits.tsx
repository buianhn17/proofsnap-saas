// Mảnh UI nhỏ dùng chung cho tính năng Bàn Giao Show: nút Copy, đồng hồ 24h, avatar ekip.
import { useEffect, useRef, useState } from "react";
import { useNow } from "../../lib/useNow";
import {
  SUBMISSION_STATUS_META,
  formatDateTime,
  type ShowSubmitter,
  type SubmissionStatus,
  type SubmissionType,
} from "../../lib/studioShows";
import { CameraIcon, CheckIcon, CopyIcon, PencilIcon, VideoIcon } from "../Icons";

// ------------------------------------------------------------------ CopyButton

export function CopyButton({
  value,
  label = "Sao chép",
  copiedLabel = "Đã chép",
  className = "",
  size = "sm",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
  }

  const sizeClass = size === "md" ? "px-4 py-2.5 text-sm" : "px-2.5 py-1.5 text-xs";
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`relative z-10 inline-flex shrink-0 items-center gap-1.5 rounded-lg border font-semibold transition ${sizeClass} ${
        copied
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
      } ${className}`}
    >
      {copied ? <CheckIcon size={size === "md" ? 16 : 13} /> : <CopyIcon size={size === "md" ? 16 : 13} />}
      <span aria-live="polite">{copied ? copiedLabel : failed ? "Không chép được" : label}</span>
    </button>
  );
}

// ------------------------------------------------------------------ DeadlineCountdown

const HOUR = 3_600_000;
const WINDOW = 24 * HOUR;

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatLate(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} giờ ${minutes % 60} phút`;
  return `${Math.floor(hours / 24)} ngày`;
}

/** Đồng hồ hạn bàn giao: shoot_end_time → +24h. */
export function DeadlineCountdown({
  shootEndTime,
  deadlineAt,
  variant = "card",
}: {
  shootEndTime: string;
  deadlineAt: string;
  variant?: "card" | "inline";
}) {
  const now = useNow();
  const end = Date.parse(shootEndTime);
  const deadline = Date.parse(deadlineAt);

  let tone: "idle" | "ok" | "warn" | "danger" | "late";
  let headline: string;
  let clock: string | null = null;
  let progress = 0;

  if (now < end) {
    tone = "idle";
    headline = "Chưa kết thúc chụp";
    clock = formatClock(end - now);
  } else if (now <= deadline) {
    const remaining = deadline - now;
    tone = remaining > 6 * HOUR ? "ok" : remaining > 2 * HOUR ? "warn" : "danger";
    headline = "Còn lại để nộp";
    clock = formatClock(remaining);
    progress = (now - end) / WINDOW;
  } else {
    tone = "late";
    headline = `Quá hạn ${formatLate(now - deadline)}`;
    progress = 1;
  }

  const toneClass = {
    idle: "text-zinc-300",
    ok: "text-emerald-300",
    warn: "text-amber-300",
    danger: "text-rose-300",
    late: "text-rose-300",
  }[tone];
  const barClass = {
    idle: "bg-zinc-600",
    ok: "bg-emerald-400",
    warn: "bg-amber-400",
    danger: "bg-rose-400",
    late: "bg-rose-500",
  }[tone];
  const label =
    tone === "idle"
      ? `Show kết thúc sau ${clock}, hạn nộp ${formatDateTime(deadlineAt)}`
      : tone === "late"
        ? `${headline}, hạn là ${formatDateTime(deadlineAt)}`
        : `Còn ${clock} để nộp, hạn ${formatDateTime(deadlineAt)}`;

  if (variant === "inline") {
    return (
      <span role="timer" aria-label={label} className={`inline-flex items-center gap-1.5 text-xs font-semibold ${toneClass}`}>
        <span className={`size-1.5 rounded-full ${barClass} ${tone === "danger" ? "animate-pulse" : ""}`} aria-hidden="true" />
        <span aria-hidden="true">
          {tone === "idle" ? "Chưa kết thúc" : tone === "late" ? headline : <span className="tabular-nums">{clock}</span>}
        </span>
      </span>
    );
  }

  return (
    <div role="timer" aria-label={label} className="rounded-xl border border-white/10 bg-zinc-950/60 px-3.5 py-3">
      <div aria-hidden="true" className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium text-zinc-400">{headline}</span>
        {clock && (
          <span className={`font-mono text-lg font-bold tabular-nums tracking-tight ${toneClass}`}>{clock}</span>
        )}
        {!clock && <span className={`text-xs font-semibold ${toneClass}`}>Hết hạn</span>}
      </div>
      <div aria-hidden="true" className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${barClass}`}
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>
      <p aria-hidden="true" className="mt-1.5 text-[11px] tabular-nums text-zinc-500">
        Hạn nộp {formatDateTime(deadlineAt)}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ Avatars

function crewInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  // Tên Việt: gọi theo tên cuối ("Nguyễn Văn An" → "A"), thêm chữ đệm nếu có
  const last = words[words.length - 1][0];
  const middle = words.length > 1 ? words[words.length - 2][0] : "";
  return (middle + last).toUpperCase();
}

const STATUS_RING: Record<SubmissionStatus, string> = {
  submitted: "ring-amber-400/70",
  approved: "ring-emerald-400/70",
  rejected: "ring-rose-400/70",
};

const AVATAR_GRADIENT: Record<SubmissionType, string> = {
  photo: "bg-gradient-to-br from-indigo-500/50 to-violet-700/50",
  video: "bg-gradient-to-br from-cyan-500/50 to-sky-700/50",
  retouch: "bg-gradient-to-br from-fuchsia-500/50 to-rose-700/50",
};

/** Badge vai trò trong ekip: Thợ ảnh · Thợ quay · Editor */
const MEMBER_BADGE = {
  photo: { label: "Thợ ảnh", className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-200" },
  video: { label: "Thợ quay", className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200" },
  editor: { label: "Editor", className: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200" },
  crew: { label: "Thợ · chưa nộp", className: "border-white/10 bg-white/5 text-zinc-400" },
} as const;

export function MemberBadge({ kind }: { kind: keyof typeof MEMBER_BADGE }) {
  const meta = MEMBER_BADGE[kind];
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}

export function CrewAvatar({
  name,
  crewType,
  status,
  size = "md",
}: {
  name: string;
  crewType: SubmissionType;
  status?: SubmissionStatus;
  size?: "sm" | "md";
}) {
  const dimension = size === "sm" ? "size-7 text-[10px]" : "size-9 text-xs";
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`flex ${dimension} items-center justify-center rounded-full border border-zinc-950 font-bold text-white ring-2 ${
          status ? STATUS_RING[status] : "ring-white/10"
        } ${AVATAR_GRADIENT[crewType]}`}
        aria-hidden="true"
      >
        {crewInitials(name)}
      </span>
      <span
        className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border border-zinc-950 bg-zinc-800 text-zinc-300"
        aria-hidden="true"
      >
        {crewType === "video" ? <VideoIcon size={8} /> : crewType === "retouch" ? <PencilIcon size={8} /> : <CameraIcon size={8} />}
      </span>
    </span>
  );
}

export function CrewAvatarStack({ submitters, max = 6 }: { submitters: ShowSubmitter[]; max?: number }) {
  if (submitters.length === 0) {
    return <span className="text-xs text-zinc-500">Chưa ai nộp bài</span>;
  }
  const shown = submitters.slice(0, max);
  const rest = submitters.length - shown.length;
  return (
    <ul className="flex items-center -space-x-2" aria-label={`${submitters.length} bài đã nộp`}>
      {shown.map((s) => (
        <li
          key={`${s.crew_user_id}-${s.role_position}`}
          title={`${s.crew_name} · ${s.role_position} · ${SUBMISSION_STATUS_META[s.status].label}${s.is_on_time_24h === false ? " · Trễ hạn" : ""}`}
        >
          <CrewAvatar name={s.crew_name} crewType={s.crew_type} status={s.status} size="sm" />
          <span className="sr-only">
            {s.crew_name}, {s.role_position}, {SUBMISSION_STATUS_META[s.status].label}
          </span>
        </li>
      ))}
      {rest > 0 && (
        <li className="flex size-7 items-center justify-center rounded-full border border-zinc-950 bg-zinc-800 text-[10px] font-semibold tabular-nums text-zinc-300 ring-2 ring-white/10">
          +{rest}
        </li>
      )}
    </ul>
  );
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const meta = SUBMISSION_STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}>
      <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
