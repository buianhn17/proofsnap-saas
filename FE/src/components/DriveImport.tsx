// Nhập ảnh vào album từ link thư mục Google Drive công khai — dialog dán link + thẻ tiến độ.
// Server chạy nền (photo_imports); trang chỉ hỏi tiến độ mỗi 2 giây khi đang có lượt chạy.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { api } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import Dialog, { dialogInputClass, dialogLabelClass, ghostButtonClass, primaryButtonClass } from "./Dialog";
import { AlertTriangleIcon, CheckIcon, FolderIcon, XIcon } from "./Icons";

export interface PhotoImport {
  id: string;
  source_url: string;
  source_kind: "folder" | "file";
  source_name: string | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  total_files: number;
  imported_count: number;
  skipped_existing_count: number;
  unsupported_count: number;
  failed_count: number;
  failed_files: { name: string; reason: string }[];
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
}

const POLL_MS = 2000;
const isActive = (job: PhotoImport | null) => job !== null && (job.status === "queued" || job.status === "running");
const countFormatter = new Intl.NumberFormat("vi-VN");
const fmt = (n: number) => countFormatter.format(n);

// Kiểm tra sơ bộ phía trình duyệt — server vẫn là nơi kiểm tra cuối cùng
function looksLikeDriveLink(value: string): boolean {
  const v = value.trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(v)) return true;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && (url.hostname === "drive.google.com" || url.hostname === "docs.google.com");
  } catch {
    return false;
  }
}

interface DriveImportProps {
  albumId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Có ảnh mới vào album → trang tải lại danh sách ảnh */
  onPhotosChanged: () => void;
}

export default function DriveImport({ albumId, open, onOpenChange, onPhotosChanged }: DriveImportProps) {
  const [job, setJob] = useState<PhotoImport | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const lastImported = useRef(0);
  const onPhotosChangedRef = useRef(onPhotosChanged);
  useEffect(() => {
    onPhotosChangedRef.current = onPhotosChanged;
  });

  // Lượt nhập gần nhất — để tải lại trang giữa chừng vẫn thấy tiến độ
  useEffect(() => {
    api
      .get<{ imports: PhotoImport[] }>(`/api/albums/${albumId}/imports`)
      .then(({ data }) => {
        const latest = data.imports[0] ?? null;
        // Chỉ hiện lượt đã xong nếu vừa xong trong 10 phút qua
        const recent = latest && (isActive(latest) || (latest.finished_at && Date.now() - Date.parse(latest.finished_at) < 10 * 60_000));
        if (recent) {
          lastImported.current = latest.imported_count;
          setJob(latest);
        }
      })
      .catch(() => {});
  }, [albumId]);

  // Hỏi tiến độ khi đang chạy; ảnh mới vào thì báo trang tải lại lưới (để lưới đầy dần)
  const jobId = job?.id ?? null;
  const active = isActive(job);
  useEffect(() => {
    if (!jobId || !active) return;
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.get<{ import: PhotoImport }>(`/api/albums/${albumId}/imports/${jobId}`);
        setJob(data.import);
        const finished = !isActive(data.import);
        if (data.import.imported_count - lastImported.current >= 12 || (finished && data.import.imported_count !== lastImported.current)) {
          lastImported.current = data.import.imported_count;
          onPhotosChangedRef.current();
        }
      } catch {
        // mạng chập chờn — lần hỏi sau thử lại
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [albumId, jobId, active]);

  const handleStarted = useCallback((started: PhotoImport) => {
    lastImported.current = 0;
    setDismissedId(null);
    setJob(started);
  }, []);

  async function cancel() {
    if (!job) return;
    setCancelling(true);
    try {
      const { data } = await api.post<{ import: PhotoImport }>(`/api/albums/${albumId}/imports/${job.id}/cancel`);
      setJob(data.import);
      onPhotosChangedRef.current();
    } catch {
      // đã xong trước khi kịp huỷ — lần hỏi tiến độ sau sẽ cập nhật
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      {job && job.id !== dismissedId && (
        <ImportProgressCard job={job} cancelling={cancelling} onCancel={cancel} onDismiss={() => setDismissedId(job.id)} />
      )}
      <ImportDialog
        albumId={albumId}
        open={open}
        onClose={() => onOpenChange(false)}
        onStarted={(started) => {
          handleStarted(started);
          onOpenChange(false);
        }}
      />
    </>
  );
}

function ImportProgressCard({
  job,
  cancelling,
  onCancel,
  onDismiss,
}: {
  job: PhotoImport;
  cancelling: boolean;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const active = isActive(job);
  const processed = job.imported_count + job.skipped_existing_count + job.failed_count;
  const percent = job.total_files > 0 ? Math.min(100, Math.round((processed / job.total_files) * 100)) : 0;
  const source = job.source_name ? `“${job.source_name}”` : "Google Drive";
  const title = active
    ? job.status === "queued"
      ? `Chuẩn bị nhập từ ${source}…`
      : `Đang nhập ảnh từ ${source}`
    : job.status === "done"
      ? `Đã nhập xong từ ${source}`
      : job.status === "cancelled"
        ? `Đã huỷ nhập từ ${source}`
        : `Nhập từ ${source} thất bại`;
  const tone =
    job.status === "failed"
      ? "border-rose-500/20 bg-rose-950/30"
      : job.status === "done"
        ? "border-emerald-500/20 bg-emerald-950/20"
        : "border-indigo-500/20 bg-indigo-500/5";

  return (
    <section role="status" aria-label="Tiến độ nhập ảnh từ Google Drive" className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${
              job.status === "done" ? "bg-emerald-500/15 text-emerald-300" : job.status === "failed" ? "bg-rose-500/15 text-rose-300" : "bg-indigo-500/15 text-indigo-300"
            }`}
            aria-hidden="true"
          >
            {job.status === "done" ? <CheckIcon size={16} /> : job.status === "failed" ? <AlertTriangleIcon size={15} /> : <FolderIcon size={15} />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{title}</p>
            <p className="mt-0.5 text-xs tabular-nums text-zinc-400">
              {active ? `${fmt(processed)} / ${fmt(job.total_files)} ảnh` : `Đã thêm ${fmt(job.imported_count)} ảnh vào album`}
              {job.skipped_existing_count > 0 && ` · ${fmt(job.skipped_existing_count)} đã có sẵn`}
              {job.unsupported_count > 0 && ` · bỏ qua ${fmt(job.unsupported_count)} file không phải JPG`}
              {job.failed_count > 0 && <span className="text-rose-300"> · {fmt(job.failed_count)} lỗi</span>}
            </p>
            {job.error_message && <p className="mt-1 text-xs text-rose-300">{job.error_message}</p>}
          </div>
        </div>
        {active ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
          >
            {cancelling ? "Đang huỷ…" : "Huỷ"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Ẩn thông báo nhập ảnh"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/10 hover:text-white"
          >
            <XIcon size={15} />
          </button>
        )}
      </div>

      {active && (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5"
          role="progressbar"
          aria-label="Tiến độ nhập ảnh"
          aria-valuemin={0}
          aria-valuemax={job.total_files}
          aria-valuenow={processed}
        >
          <div className="h-full rounded-full bg-indigo-400 transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
      )}

      {job.failed_files.length > 0 && !active && (
        <details className="mt-3 text-xs text-zinc-400">
          <summary className="cursor-pointer select-none font-medium text-zinc-300 hover:text-white">Xem ảnh lỗi</summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {job.failed_files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex justify-between gap-3">
                <span className="truncate font-mono" translate="no">{f.name}</span>
                <span className="shrink-0 text-rose-300/90">{f.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ImportDialog({
  albumId,
  open,
  onClose,
  onStarted,
}: {
  albumId: string;
  open: boolean;
  onClose: () => void;
  onStarted: (job: PhotoImport) => void;
}) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const valid = looksLikeDriveLink(url);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) {
      setError("Đây không phải link Google Drive. Link thư mục có dạng https://drive.google.com/drive/folders/…");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<{ import: PhotoImport }>(`/api/albums/${albumId}/imports`, { url: url.trim() });
      setUrl("");
      onStarted(data.import);
    } catch (err) {
      // Đang có lượt chạy dở → hiện luôn tiến độ lượt đó
      if (isAxiosError(err) && err.response?.status === 409 && err.response.data?.import) {
        onStarted(err.response.data.import as PhotoImport);
        return;
      }
      setError(getErrorMessage(err, "Không bắt đầu nhập được, thử lại sau."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!submitting}
      title="Nhập ảnh từ Google Drive"
      description="Dán link thư mục Drive đã chia sẻ công khai"
      icon={<FolderIcon size={18} />}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={submitting} className={ghostButtonClass}>
            Hủy
          </button>
          <button type="submit" form={`${id}-form`} disabled={submitting || url.trim() === ""} className={primaryButtonClass}>
            {submitting && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />}
            {submitting ? "Đang đọc thư mục…" : "Bắt đầu nhập"}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <ol className="list-decimal space-y-1.5 rounded-xl border border-white/10 bg-zinc-900/60 py-3 pl-8 pr-4 text-xs text-zinc-300">
          <li>
            Trên Google Drive, bấm <strong className="text-white">Chia sẻ</strong> ở thư mục ảnh → chọn{" "}
            <strong className="text-white">Bất kỳ ai có đường liên kết</strong> → vai trò Người xem.
          </li>
          <li>
            Bấm <strong className="text-white">Sao chép đường liên kết</strong> rồi dán vào ô bên dưới.
          </li>
        </ol>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-url`} className={dialogLabelClass}>Link thư mục hoặc ảnh trên Drive</label>
          <input
            id={`${id}-url`}
            name="drive_url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="https://drive.google.com/drive/folders/…"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint`}
            className={dialogInputClass}
          />
          <p id={`${id}-hint`} className={`text-xs ${error ? "text-rose-300" : "text-zinc-500"}`} role={error ? "alert" : undefined}>
            {error ??
              "Nhận ảnh JPG (cả thư mục con), tối đa 5.000 ảnh; RAW, HEIC, video được bỏ qua. Ảnh được nén theo mức nén của album rồi chép vào Drive của bạn. Nhập lại cùng link chỉ thêm ảnh mới."}
          </p>
        </div>
      </form>
    </Dialog>
  );
}
