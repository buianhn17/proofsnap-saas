import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { useAuth } from "../../contexts/AuthContext";
import {
  CULLED_STAT_LABELS,
  PHOTO_ROLES,
  VIDEO_ROLES,
  formatCount,
  formatFolderName,
  isGoogleDriveUrl,
  notifyStudioShowsChanged,
  type CrewType,
  type CulledStats,
  type ShowDetailResponse,
  type ShowSubmission,
} from "../../lib/studioShows";
import Breadcrumbs from "../../components/ui/Breadcrumbs";
import { dialogInputClass, dialogLabelClass, primaryButtonClass, secondaryButtonClass } from "../../components/Dialog";
import { CopyButton, DeadlineCountdown, SubmissionStatusBadge } from "../../components/studio/StudioBits";
import PhotoCullStep from "../../components/studio/PhotoCullStep";
import VideoScanStep from "../../components/studio/VideoScanStep";
import type { StepOutcome } from "../../components/studio/stepOutcome";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckIcon,
  ExternalLinkIcon,
  ShieldCheckIcon,
  VideoIcon,
} from "../../components/Icons";

type Step = 1 | 2 | 3;

const STEPS: { step: Step; title: string; hint: string }[] = [
  { step: 1, title: "Vai trò & thông tin", hint: "Thợ ảnh hay thợ quay, vị trí nào" },
  { step: 2, title: "Quét & lọc trên máy", hint: "100% xử lý tại trình duyệt" },
  { step: 3, title: "Đặt tên & nộp link", hint: "Copy tên chuẩn, dán link Drive" },
];

export default function CrewSubmitPage() {
  const { showId } = useParams<{ showId: string }>();
  const { photographer } = useAuth();
  const [data, setData] = useState<ShowDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [crewType, setCrewType] = useState<CrewType>("photo");
  const [role, setRole] = useState<string>("Lead");
  const [crewName, setCrewName] = useState(photographer?.display_name ?? "");
  const [outcome, setOutcome] = useState<StepOutcome | null>(null);
  const [result, setResult] = useState<ShowSubmission | null>(null);

  useEffect(() => {
    api
      .get<ShowDetailResponse>(`/api/studio/shows/${showId}`)
      .then(({ data }) => setData(data))
      .catch((err) => setLoadError(getErrorMessage(err, "Không tải được show. Bạn đã nhập mã mời chưa?")));
  }, [showId]);

  const mySubmissions = useMemo(
    () => (data?.submissions ?? []).filter((s) => s.crew_user_id === photographer?.id),
    [data, photographer]
  );
  const sameRole = mySubmissions.find((s) => s.role_position === role);
  const roleLocked = sameRole?.status === "approved";
  const step1Valid = crewName.trim().length > 0 && role !== "" && !roleLocked;
  const step2Ready = outcome?.ready === true;

  const handleOutcome = useCallback((next: StepOutcome | null) => setOutcome(next), []);

  function chooseType(next: CrewType) {
    setCrewType(next);
    setOutcome(null);
    const roles: readonly string[] = next === "photo" ? PHOTO_ROLES : VIDEO_ROLES;
    if (!roles.includes(role)) setRole(roles[0]);
  }

  function canOpen(target: Step) {
    if (target === 1) return true;
    if (target === 2) return step1Valid;
    return step1Valid && step2Ready;
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <BackLink />
        <p role="alert" className="rounded-2xl border border-rose-500/20 bg-rose-950/40 p-4 text-sm text-rose-300">{loadError}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Đang tải">
        <div className="h-8 w-1/2 animate-pulse rounded-lg bg-white/5" />
        <div className="h-16 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-80 animate-pulse rounded-2xl bg-white/5" />
      </div>
    );
  }

  // Editor không nộp file gốc — chuyển sang trang chi tiết (tải file gốc, nộp ảnh hậu kỳ)
  if (data.viewer_role === "editor") {
    return <Navigate to={`/admin/shows/${data.show.id}`} replace />;
  }

  const { show } = data;
  const closed = show.status !== "open";

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <BackLink show={show} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-400">Studio: {show.studio_name}</p>
            <title>{`Nộp file ${show.class_name} · LensProof`}</title>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">Kiểm duyệt & Nộp file</h1>
            <p className="mt-1 text-sm text-zinc-300">
              {show.class_name} <span className="text-zinc-600">—</span> {show.school_name}
            </p>
          </div>
          <div className="w-full lg:w-72">
            <DeadlineCountdown shootEndTime={show.shoot_end_time} deadlineAt={show.deadline_at} />
          </div>
        </div>
      </div>

      {closed && (
        <p role="alert" className="rounded-2xl border border-amber-500/20 bg-amber-950/30 p-4 text-sm text-amber-200">
          Show đã đóng — Studio không nhận bàn giao mới cho lớp này.
        </p>
      )}

      {mySubmissions.length > 0 && <MySubmissions submissions={mySubmissions} />}

      {result ? (
        <SuccessPanel submission={result} showId={show.id} onAnother={() => {
          setResult(null);
          setStep(1);
          setOutcome(null);
        }} />
      ) : (
        <>
          {/* Stepper */}
          <nav aria-label="Các bước nộp file">
            <ol className="grid grid-cols-3 gap-2">
              {STEPS.map(({ step: s, title, hint }) => {
                const current = s === step;
                const done = s < step || (s === 2 && step2Ready && step !== 2);
                const enabled = canOpen(s);
                return (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => setStep(s)}
                      disabled={!enabled}
                      aria-current={current ? "step" : undefined}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed ${
                        current
                          ? "border-indigo-500/40 bg-indigo-500/10"
                          : enabled
                            ? "border-white/10 bg-zinc-900/50 hover:border-white/20"
                            : "border-white/5 bg-zinc-900/20 opacity-60"
                      }`}
                    >
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums ${
                          done ? "bg-emerald-500/20 text-emerald-300" : current ? "bg-indigo-500 text-white" : "bg-white/5 text-zinc-400"
                        }`}
                        aria-hidden="true"
                      >
                        {done ? <CheckIcon size={15} /> : s}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">{title}</span>
                        <span className="hidden truncate text-[11px] text-zinc-500 sm:block">{hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* Step 1 — giữ cả 3 bước trong DOM (ẩn bằng hidden) để quay lại không mất kết quả AI */}
          <section hidden={step !== 1} aria-labelledby="step-1" className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-zinc-900/40 p-5 sm:p-6">
            <h2 id="step-1" className="text-base font-bold text-white">Bước 1 — Chọn vai trò & thông tin thợ</h2>
            <RoleForm
              crewType={crewType}
              onCrewType={chooseType}
              role={role}
              onRole={setRole}
              crewName={crewName}
              onCrewName={setCrewName}
              sameRole={sameRole}
            />
            <div className="flex justify-end">
              <button type="button" disabled={!step1Valid} onClick={() => setStep(2)} className={primaryButtonClass}>
                Tiếp tục quét thư mục
              </button>
            </div>
          </section>

          <section hidden={step !== 2} aria-labelledby="step-2" className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-zinc-900/40 p-5 sm:p-6">
            <div>
              <h2 id="step-2" className="text-base font-bold text-white">
                Bước 2 — {crewType === "photo" ? "Quét thư mục & AI lọc ảnh rác" : "Quét footage gốc"}
              </h2>
              <p className="mt-1 text-xs text-zinc-400">
                {crewType === "photo"
                  ? "AI bắt ảnh nhắm mắt, nhoè nét, cháy/hỏng sáng. Bạn tự gắn cờ pháo hoa xịt. Xử lý sạch mới mở khoá bước 3."
                  : "Không chạy AI ảnh tĩnh — chỉ đếm clip, dung lượng và kiểm tra lỗi copy."}
              </p>
            </div>
            {/* key theo loại hình: đổi ảnh ↔ quay thì làm lại từ đầu */}
            {crewType === "photo" ? (
              <PhotoCullStep key="photo" onOutcome={handleOutcome} />
            ) : (
              <VideoScanStep key="video" onOutcome={handleOutcome} />
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => setStep(1)} className={secondaryButtonClass}>
                Quay lại
              </button>
              <div className="flex flex-col items-end gap-1">
                <button type="button" disabled={!step2Ready} onClick={() => setStep(3)} className={primaryButtonClass}>
                  Tiếp tục đặt tên & nộp
                </button>
                {!step2Ready && outcome && (
                  <span className="text-[11px] text-zinc-500">
                    {outcome.hasValidStructure ? "Xử lý hết ảnh rác / checklist để mở khoá" : "Sửa cấu trúc thư mục để mở khoá"}
                  </span>
                )}
              </div>
            </div>
          </section>

          <section hidden={step !== 3} aria-labelledby="step-3" className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-zinc-900/40 p-5 sm:p-6">
            <h2 id="step-3" className="text-base font-bold text-white">Bước 3 — Copy tên chuẩn & dán link Google Drive</h2>
            {outcome?.ready && (
              <SubmitForm
                showId={show.id}
                folderName={formatFolderName({
                  shootDate: show.shoot_date,
                  crewName,
                  rolePosition: role,
                  totalFiles: outcome.totalFiles,
                  crewType,
                  className: show.class_name,
                  schoolName: show.school_name,
                })}
                crewType={crewType}
                role={role}
                crewName={crewName}
                outcome={outcome}
                disabled={closed}
                resubmitting={sameRole !== undefined}
                onBack={() => setStep(2)}
                onSubmitted={(s) => {
                  setResult(s);
                  setData((prev) => prev && {
                    ...prev,
                    submissions: [...prev.submissions.filter((x) => x.id !== s.id), s],
                  });
                }}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BackLink({ show }: { show?: { id: string; class_name: string } }) {
  return (
    <Breadcrumbs
      items={[
        { label: "Bàn giao Ekip", to: "/admin/shows?tab=crew" },
        ...(show ? [{ label: show.class_name, to: `/admin/shows/${show.id}` }] : []),
        { label: "Nộp file" },
      ]}
    />
  );
}

function MySubmissions({ submissions }: { submissions: ShowSubmission[] }) {
  return (
    <section aria-labelledby="my-submissions" className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
      <h2 id="my-submissions" className="text-sm font-semibold text-white">Bài bạn đã nộp cho lớp này</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {submissions.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 rounded-xl border border-white/5 bg-zinc-950/40 p-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100">
                {s.role_position} · <span className="tabular-nums">{formatCount(s.total_files)}</span> {s.crew_type === "video" ? "clip" : "file"}
                {s.is_on_time_24h === false && <span className="ml-1.5 text-xs text-rose-300">· trễ hạn</span>}
              </p>
              <p className="truncate font-mono text-[11px] text-zinc-500">{s.formatted_folder_name}</p>
              {s.status === "rejected" && s.studio_note && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-500/20 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-200">
                  <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
                  <span>Studio yêu cầu sửa: {s.studio_note}</span>
                </p>
              )}
            </div>
            <SubmissionStatusBadge status={s.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleForm({
  crewType,
  onCrewType,
  role,
  onRole,
  crewName,
  onCrewName,
  sameRole,
}: {
  crewType: CrewType;
  onCrewType: (t: CrewType) => void;
  role: string;
  onRole: (r: string) => void;
  crewName: string;
  onCrewName: (n: string) => void;
  sameRole: ShowSubmission | undefined;
}) {
  const id = useId();
  const roles = crewType === "photo" ? PHOTO_ROLES : VIDEO_ROLES;
  const types: { value: CrewType; label: string; hint: string; icon: React.ReactNode }[] = [
    { value: "photo", label: "Thợ Ảnh", hint: "RAW + JPG, chạy AI lọc ảnh rác", icon: <CameraIcon size={20} /> },
    { value: "video", label: "Thợ Quay Phim", hint: "Footage gốc, đếm clip & dung lượng", icon: <VideoIcon size={20} /> },
  ];
  return (
    <div className="flex flex-col gap-6">
      <fieldset>
        <legend className={dialogLabelClass}>Loại hình</legend>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {types.map((t) => (
            <label
              key={t.value}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400 ${
                crewType === t.value ? "border-indigo-500/50 bg-indigo-500/10" : "border-white/10 bg-zinc-950/40 hover:border-white/20"
              }`}
            >
              <input type="radio" name={`${id}-type`} value={t.value} checked={crewType === t.value} onChange={() => onCrewType(t.value)} className="sr-only" />
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${crewType === t.value ? "bg-indigo-500 text-white" : "bg-white/5 text-zinc-400"}`}>
                {t.icon}
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">{t.label}</span>
                <span className="block text-xs text-zinc-400">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={dialogLabelClass}>Vị trí</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {roles.map((r) => (
            <label
              key={r}
              className={`cursor-pointer rounded-xl border px-4 py-2 text-sm font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400 ${
                role === r ? "border-indigo-500/50 bg-indigo-500/15 text-white" : "border-white/10 text-zinc-300 hover:bg-white/5"
              }`}
            >
              <input type="radio" name={`${id}-role`} value={r} checked={role === r} onChange={() => onRole(r)} className="sr-only" />
              {r}
            </label>
          ))}
        </div>
        {sameRole && (
          <p className={`mt-2 text-xs ${sameRole.status === "approved" ? "text-rose-300" : "text-amber-300"}`}>
            {sameRole.status === "approved"
              ? `Bài vị trí “${role}” đã được Studio duyệt — không nộp lại được. Chọn vị trí khác nếu bạn kiêm nhiệm.`
              : `Bạn đã nộp vị trí “${role}” — nộp lần này sẽ thay bài cũ.`}
          </p>
        )}
      </fieldset>

      <div className="flex max-w-md flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className={dialogLabelClass}>Tên thợ (hiển thị trên tên folder)</label>
        <input
          id={`${id}-name`}
          name="crew_name"
          autoComplete="name"
          maxLength={80}
          value={crewName}
          onChange={(e) => onCrewName(e.target.value)}
          placeholder="VD: Trần Đức Chuối"
          className={dialogInputClass}
        />
      </div>
    </div>
  );
}

function SubmitForm({
  showId,
  folderName,
  crewType,
  role,
  crewName,
  outcome,
  disabled,
  resubmitting,
  onBack,
  onSubmitted,
}: {
  showId: string;
  folderName: string;
  crewType: CrewType;
  role: string;
  crewName: string;
  outcome: StepOutcome;
  disabled: boolean;
  resubmitting: boolean;
  onBack: () => void;
  onSubmitted: (s: ShowSubmission) => void;
}) {
  const id = useId();
  const [driveUrl, setDriveUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlValid = isGoogleDriveUrl(driveUrl);
  const showUrlError = touched && driveUrl.trim() !== "" && !urlValid;
  const canSubmit = urlValid && committed && !isSubmitting && !disabled;
  const culledEntries = (Object.keys(CULLED_STAT_LABELS) as (keyof CulledStats)[]).filter((k) => (outcome.culledStats[k] ?? 0) > 0);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<{ submission: ShowSubmission }>(`/api/studio/shows/${showId}/submit`, {
        crew_type: crewType,
        crew_name: crewName,
        role_position: role,
        drive_url: driveUrl.trim(),
        total_files: outcome.totalFiles,
        raw_count: crewType === "photo" ? outcome.rawCount : undefined,
        jpg_count: crewType === "photo" ? outcome.jpgCount : undefined,
        video_count: crewType === "video" ? outcome.videoCount : undefined,
        culled_stats: outcome.culledStats,
        has_valid_structure: outcome.hasValidStructure,
        backup_committed_45d: committed,
      });
      notifyStudioShowsChanged();
      onSubmitted(data.submission);
    } catch (err) {
      setError(getErrorMessage(err, "Không gửi được bàn giao. Kiểm tra mạng rồi thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {/* Tên chuẩn */}
      <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5">
        <p className={dialogLabelClass}>Tên folder chuẩn trên Drive của bạn</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 break-words font-mono text-base font-semibold text-white sm:text-lg" translate="no">
            {folderName}
          </p>
          <CopyButton value={folderName} label="Copy 1 chạm" copiedLabel="Đã copy tên" size="md" />
        </div>
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-zinc-400">
          <li>Tải thư mục đã lọc lên Google Drive cá nhân, đổi tên folder đúng như trên.</li>
          <li>Chia sẻ folder ở chế độ “Bất kỳ ai có đường liên kết”.</li>
          <li>Dán link folder vào ô bên dưới.</li>
        </ol>
      </div>

      {/* Tóm tắt */}
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Summary label="Vị trí" value={`${crewType === "photo" ? "Ảnh" : "Quay"} · ${role}`} />
        <Summary label={crewType === "photo" ? "Số ảnh" : "Số clip"} value={formatCount(outcome.totalFiles)} />
        {crewType === "photo" ? (
          <Summary label="RAW / JPG" value={`${formatCount(outcome.rawCount)} / ${formatCount(outcome.jpgCount)}`} />
        ) : (
          <Summary label="Footage" value="Gốc, đã kiểm tra" />
        )}
        <Summary label="Cấu trúc" value={outcome.hasValidStructure ? "Hợp lệ" : "Chưa đạt"} />
      </dl>
      {crewType === "photo" && (
        <p className="text-xs text-zinc-400">
          Ảnh rác đã lọc:{" "}
          {culledEntries.length === 0
            ? "không có"
            : culledEntries.map((k) => `${CULLED_STAT_LABELS[k]} ${outcome.culledStats[k]}`).join(" · ")}
        </p>
      )}

      {/* Link Drive */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-drive`} className={dialogLabelClass}>Link Google Drive</label>
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
          {showUrlError ? "Chỉ nhận link Google Drive (https://drive.google.com/…) — không nhận Dropbox, OneDrive, Fshare…" : "Chỉ nhận link drive.google.com"}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-zinc-950/40 p-4 text-sm text-zinc-200">
        <input
          type="checkbox"
          name="backup_committed_45d"
          checked={committed}
          onChange={(e) => setCommitted(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded accent-indigo-500"
        />
        <span className="flex items-start gap-2">
          <ShieldCheckIcon size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          Cam kết lưu trữ bản backup tối thiểu 45 ngày trên máy cá nhân kể từ ngày trả file
        </span>
      </label>

      {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onBack} className={secondaryButtonClass}>
          Quay lại
        </button>
        <button type="submit" disabled={!canSubmit} className={primaryButtonClass}>
          {isSubmitting && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />}
          {isSubmitting ? "Đang gửi…" : resubmitting ? "Gửi lại về Studio" : "Gửi về Studio"}
        </button>
      </div>
    </form>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-2.5">
      <dt className="text-[11px] text-zinc-500">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold tabular-nums text-zinc-100">{value}</dd>
    </div>
  );
}

function SuccessPanel({ submission, showId, onAnother }: { submission: ShowSubmission; showId: string; onAnother: () => void }) {
  return (
    <section role="status" className="flex flex-col items-center gap-4 rounded-3xl border border-emerald-500/20 bg-emerald-950/10 p-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
        <CheckIcon size={28} />
      </span>
      <div>
        <h2 className="text-xl font-bold text-white">Đã gửi về Studio</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {submission.is_on_time_24h !== false ? "Nộp đúng hạn 24 giờ." : "Bài được ghi nhận nộp trễ hạn 24 giờ."} Studio sẽ duyệt hoặc báo sửa trên trang này.
        </p>
      </div>
      <p className="max-w-full break-words rounded-xl border border-white/10 bg-zinc-950/60 px-4 py-2 font-mono text-sm text-zinc-200">
        {submission.formatted_folder_name}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {submission.drive_url && (
          <a href={submission.drive_url} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>
            Mở Drive <ExternalLinkIcon size={14} />
            <span className="sr-only">(mở tab mới)</span>
          </a>
        )}
        <Link to={`/admin/shows/${showId}`} className={secondaryButtonClass}>
          Xem ekip
        </Link>
        <button type="button" onClick={onAnother} className={primaryButtonClass}>
          Nộp thêm vị trí kiêm nhiệm
        </button>
      </div>
    </section>
  );
}
