// Bước 2 (thợ ảnh) — quét thư mục bàn giao, kiểm tra cấu trúc RAW + JPG, chạy AI culling
// trên folder JPG (100% trong trình duyệt), bắt thợ xử lý sạch ảnh rác trước khi nộp.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { runCullingTestInWorker } from "../../lib/culling/cullingWorkerClient";
import type { CullingTestItem, CullingTestProgress } from "../../lib/culling/cullingPipeline";
import { scorePhoto } from "../../lib/culling/burstScoring";
import {
  FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE,
  isFileSystemAccessSupported,
} from "../../lib/localFolderImport";
import { deleteRejectedPairsFromOriginal } from "../../lib/localFileActions";
import {
  analyzePhotoStructure,
  baseName,
  pickFolderInventory,
  type FolderInventory,
  type PhotoStructure,
} from "../../lib/crewFolderScan";
import { formatCount, type CulledStats } from "../../lib/studioShows";
import Dialog, { ghostButtonClass, primaryButtonClass, secondaryButtonClass } from "../Dialog";
import {
  AlertTriangleIcon,
  CheckIcon,
  EyeOffIcon,
  FocusIcon,
  FolderIcon,
  SparklesIcon,
  SunIcon,
  TrashIcon,
  XIcon,
} from "../Icons";
import type { StepOutcome } from "./stepOutcome";

type Reason = "closed_eyes" | "blurry" | "overexposed" | "unreadable";
type Decision = "keep" | "reject";
type Filter = "issues" | "rejected" | "all";

interface ReviewItem {
  path: string;
  name: string;
  thumbUrl: string | null;
  reasons: Reason[];
}

const REASON_META: Record<Reason, { label: string; icon: React.ReactNode }> = {
  closed_eyes: { label: "Nhắm mắt", icon: <EyeOffIcon size={11} /> },
  blurry: { label: "Nhoè nét", icon: <FocusIcon size={11} /> },
  overexposed: { label: "Cháy/hỏng sáng", icon: <SunIcon size={11} /> },
  unreadable: { label: "Không đọc được", icon: <AlertTriangleIcon size={11} /> },
};

function reasonsFor(item: CullingTestItem): Reason[] {
  if (item.error) return ["unreadable"];
  const reasons: Reason[] = [];
  const score = scorePhoto(item.metrics);
  if (score.reasons.includes("blink")) reasons.push("closed_eyes");
  if (score.reasons.includes("out_of_focus")) reasons.push("blurry");
  if (item.metrics.exposure.overexposed || item.metrics.exposure.underexposed) reasons.push("overexposed");
  return reasons;
}

export default function PhotoCullStep({ onOutcome }: { onOutcome: (outcome: StepOutcome | null) => void }) {
  const supported = isFileSystemAccessSupported();
  const [inventory, setInventory] = useState<FolderInventory | null>(null);
  const [structure, setStructure] = useState<PhotoStructure | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CullingTestProgress | null>(null);
  const [items, setItems] = useState<Map<string, ReviewItem>>(() => new Map());
  // Kết quả AI về theo từng ảnh → gom vào hàng đợi, đổ vào state 5 lần/giây
  const pendingRef = useRef<ReviewItem[]>([]);
  const processedRef = useRef(new Set<string>());
  const urlsRef = useRef(new Set<string>());
  const abortRef = useRef<(() => void) | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [fireworks, setFireworks] = useState<Record<string, true>>({});
  const [deleted, setDeleted] = useState<Record<string, true>>({});
  const [deletedRawCount, setDeletedRawCount] = useState(0);
  const [filter, setFilter] = useState<Filter>("issues");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState<{ done: number; total: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const revokeAll = useCallback(() => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = new Set();
    pendingRef.current = [];
    processedRef.current = new Set();
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.();
      if (flushTimer.current) clearTimeout(flushTimer.current);
      revokeAll();
    },
    [revokeAll]
  );

  const flush = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const batch = pendingRef.current;
    if (batch.length === 0) return;
    pendingRef.current = [];
    setItems((prev) => {
      const next = new Map(prev);
      for (const item of batch) next.set(item.path, item);
      return next;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!flushTimer.current) flushTimer.current = setTimeout(flush, 200);
  }, [flush]);

  const runAnalysis = useCallback(
    async (target: PhotoStructure) => {
      const todo = target.jpgs.filter((jpg) => !processedRef.current.has(jpg.relativePath));
      if (todo.length === 0) return;
      setRunError(null);
      setRunning(true);
      const { promise, abort } = runCullingTestInWorker(todo, {
        onProgress: setProgress,
        onItem: (item) => {
          const path = item.file.relativePath;
          const thumbUrl = item.thumbnailBlob?.size ? URL.createObjectURL(item.thumbnailBlob) : null;
          if (thumbUrl) urlsRef.current.add(thumbUrl);
          processedRef.current.add(path);
          pendingRef.current.push({ path, name: item.file.file.name, thumbUrl, reasons: reasonsFor(item) });
          scheduleFlush();
        },
        // RAW để dạng folder: lấy preview nhúng trong RAW cho nhanh
        pairedRawFile: (jpg) => target.rawByBaseName.get(baseName(jpg.relativePath))?.file ?? null,
      });
      abortRef.current = abort;
      try {
        await promise;
      } catch (err) {
        setRunError(err instanceof Error ? err.message : "Lỗi khi chạy AI lọc ảnh");
      } finally {
        abortRef.current = null;
        flush();
        setRunning(false);
      }
    },
    [flush, scheduleFlush]
  );

  async function handlePick() {
    setScanError(null);
    setScanning(true);
    try {
      const picked = await pickFolderInventory();
      if (!picked) return;
      abortRef.current?.();
      revokeAll();
      setDecisions({});
      setFireworks({});
      setDeleted({});
      setDeletedRawCount(0);
      setProgress(null);
      setItems(new Map());
      const analyzed = await analyzePhotoStructure(picked);
      setInventory(picked);
      setStructure(analyzed);
      if (analyzed.jpgs.length > 0) void runAnalysis(analyzed);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Không đọc được thư mục đã chọn");
    } finally {
      setScanning(false);
    }
  }

  // ---------------------------------------------------------------- derived

  const allItems = useMemo(
    () => [...items.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })),
    [items]
  );

  const decisionOf = useCallback(
    (item: ReviewItem): Decision | undefined => (fireworks[item.path] ? "reject" : decisions[item.path]),
    [decisions, fireworks]
  );

  const derived = useMemo(() => {
    const live = allItems.filter((i) => !deleted[i.path]);
    const flagged = live.filter((i) => i.reasons.length > 0 || fireworks[i.path]);
    const unresolved = flagged.filter((i) => decisionOf(i) === undefined);
    const toDelete = live.filter((i) => decisionOf(i) === "reject");
    return { live, flagged, unresolved, toDelete };
  }, [allItems, deleted, fireworks, decisionOf]);

  const visible = useMemo(() => {
    if (filter === "all") return derived.live;
    if (filter === "rejected") return derived.toDelete;
    return derived.flagged;
  }, [filter, derived]);

  const totalJpg = structure?.jpgs.length ?? 0;
  const analysisComplete = structure !== null && !running && allItems.length >= totalJpg && totalJpg > 0;
  const remainingJpg = totalJpg - Object.keys(deleted).length;

  const culledStats = useMemo<CulledStats>(() => {
    const stats = { closed_eyes: 0, blurry: 0, overexposed: 0, failed_fireworks: 0 };
    for (const path of Object.keys(deleted)) {
      const item = items.get(path);
      if (fireworks[path]) stats.failed_fireworks += 1;
      for (const reason of item?.reasons ?? []) {
        if (reason !== "unreadable") stats[reason] += 1;
      }
    }
    return stats;
  }, [deleted, fireworks, items]);

  const outcome = useMemo<StepOutcome | null>(() => {
    if (!structure) return null;
    const rawCount =
      structure.rawContainer?.kind === "folder"
        ? structure.rawContainer.raws.length - deletedRawCount
        : structure.rawContainer?.rawCount ?? 0;
    return {
      ready:
        structure.valid &&
        analysisComplete &&
        derived.unresolved.length === 0 &&
        derived.toDelete.length === 0 &&
        remainingJpg > 0,
      totalFiles: remainingJpg,
      rawCount: Math.max(0, rawCount),
      jpgCount: remainingJpg,
      videoCount: 0,
      culledStats,
      hasValidStructure: structure.valid,
    };
  }, [structure, deletedRawCount, analysisComplete, derived, remainingJpg, culledStats]);

  useEffect(() => onOutcome(outcome), [outcome, onOutcome]);

  // ---------------------------------------------------------------- actions

  const decide = useCallback((path: string, decision: Decision | null) => {
    setDecisions((prev) => {
      const next = { ...prev };
      if (decision) next[path] = decision;
      else delete next[path];
      return next;
    });
  }, []);

  const toggleFireworks = useCallback((path: string) => {
    setFireworks((prev) => {
      const next = { ...prev };
      if (next[path]) delete next[path];
      else next[path] = true;
      return next;
    });
  }, []);

  function rejectAllUnresolved() {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const item of derived.unresolved) next[item.path] = "reject";
      return next;
    });
  }

  async function handleDelete() {
    if (!inventory || !structure) return;
    const jpgByPath = new Map(structure.jpgs.map((j) => [j.relativePath, j]));
    const pairs = derived.toDelete.flatMap((item) => {
      const jpg = jpgByPath.get(item.path);
      if (!jpg) return [];
      return [{ jpg, raw: structure.rawByBaseName.get(baseName(item.path)) ?? null }];
    });
    setDeleteError(null);
    setDeleting({ done: 0, total: pairs.length });
    try {
      await deleteRejectedPairsFromOriginal(inventory.rootHandle, pairs, (p) =>
        setDeleting({ done: p.deletedFiles, total: p.totalFiles })
      );
      setDeleted((prev) => {
        const next = { ...prev };
        for (const pair of pairs) next[pair.jpg.relativePath] = true;
        return next;
      });
      setDeletedRawCount((n) => n + pairs.filter((p) => p.raw).length);
      setConfirmDelete(false);
    } catch (err) {
      setDeleteError(
        (err instanceof Error ? err.message : "Xoá file thất bại") +
          " — một phần ảnh có thể đã bị xoá. Bấm “Quét lại” để cập nhật."
      );
    } finally {
      setDeleting(null);
    }
  }

  // ---------------------------------------------------------------- render

  if (!supported) {
    return (
      <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
        {FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE}
      </p>
    );
  }

  const rawSummary =
    structure?.rawContainer?.kind === "archive"
      ? structure.rawContainer.rawCount === null
        ? "RAW trong file nén (không đếm được .rar/.7z)"
        : `RAW ${formatCount(structure.rawContainer.rawCount)} (trong file nén)`
      : structure?.rawContainer?.kind === "folder"
        ? `RAW ${formatCount(structure.rawContainer.raws.length - deletedRawCount)}`
        : "RAW —";

  return (
    <div className="flex flex-col gap-6">
      {/* Picker */}
      <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-white/15 bg-zinc-950/40 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-indigo-300">
            <FolderIcon size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">
              {inventory ? `Thư mục “${inventory.folderName}”` : "Chọn thư mục bàn giao trên máy"}
            </p>
            <p className="text-xs text-zinc-400">
              {inventory
                ? `${formatCount(inventory.files.length)} file · ${rawSummary} · JPG ${formatCount(remainingJpg)}`
                : "Bên trong cần: 01 file nén RAW (hoặc folder RAW) + 01 folder JPG không nén. Ảnh không rời khỏi máy bạn."}
            </p>
          </div>
        </div>
        <button type="button" onClick={handlePick} disabled={scanning || running || deleting !== null} className={inventory ? secondaryButtonClass : primaryButtonClass}>
          {scanning ? "Đang quét…" : inventory ? "Quét lại" : "Chọn thư mục"}
        </button>
      </div>
      {scanError && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-sm text-rose-300">{scanError}</p>}

      {/* Structure checklist */}
      {structure && (
        <section aria-labelledby="structure-heading" className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
          <h3 id="structure-heading" className="flex items-center justify-between gap-2 text-sm font-semibold text-white">
            Cấu trúc thư mục
            <span className={`text-xs font-semibold ${structure.valid ? "text-emerald-300" : "text-rose-300"}`}>
              {structure.valid ? "Hợp lệ" : "Chưa đạt — sửa trên máy rồi bấm Quét lại"}
            </span>
          </h3>
          <ul className="mt-3 flex flex-col gap-2">
            {structure.checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2.5 text-sm">
                <span
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                    check.ok ? "bg-emerald-500/15 text-emerald-300" : check.blocking ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"
                  }`}
                  aria-hidden="true"
                >
                  {check.ok ? <CheckIcon size={12} /> : check.blocking ? <XIcon size={12} /> : <AlertTriangleIcon size={11} />}
                </span>
                <span className="min-w-0">
                  <span className="text-zinc-200">{check.label}</span>
                  <span className="sr-only">{check.ok ? ": đạt" : check.blocking ? ": chưa đạt" : ": cảnh báo"}</span>
                  {check.detail && <span className="block truncate text-xs tabular-nums text-zinc-500">{check.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* AI progress */}
      {structure && totalJpg > 0 && (running || !analysisComplete) && (
        <section aria-label="Tiến độ AI lọc ảnh" className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 font-semibold text-indigo-200">
              <SparklesIcon size={15} /> {running ? "AI đang lọc ảnh trên máy bạn…" : "Đã dừng phân tích"}
            </span>
            <span className="tabular-nums text-zinc-300" aria-live="polite">
              {formatCount(allItems.length)}/{formatCount(totalJpg)}
            </span>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5"
            role="progressbar"
            aria-label="Tiến độ phân tích"
            aria-valuemin={0}
            aria-valuemax={totalJpg}
            aria-valuenow={allItems.length}
          >
            <div className="h-full rounded-full bg-indigo-400 transition-[width] duration-300" style={{ width: `${(allItems.length / totalJpg) * 100}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-400">
            <span className="tabular-nums">
              {progress && running
                ? `${progress.imagesPerSecond.toFixed(1)} ảnh/giây · còn khoảng ${Math.ceil((totalJpg - allItems.length) / Math.max(progress.imagesPerSecond, 0.1) / 60)} phút`
                : "Bấm tiếp tục để phân tích nốt"}
            </span>
            {running ? (
              <button type="button" onClick={() => abortRef.current?.()} className="font-semibold text-zinc-300 underline underline-offset-2 hover:text-white">
                Tạm dừng
              </button>
            ) : (
              <button type="button" onClick={() => runAnalysis(structure)} className="font-semibold text-indigo-300 underline underline-offset-2 hover:text-indigo-200">
                Tiếp tục
              </button>
            )}
          </div>
          {runError && <p role="alert" className="mt-2 text-xs text-rose-300">{runError}</p>}
        </section>
      )}

      {/* Review */}
      {allItems.length > 0 && (
        <section aria-labelledby="review-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 id="review-heading" className="text-sm font-semibold text-white">Xử lý ảnh rác</h3>
              <p className="text-xs tabular-nums text-zinc-400">
                {derived.unresolved.length > 0
                  ? `Còn ${formatCount(derived.unresolved.length)} ảnh AI đánh dấu chưa xử lý`
                  : derived.toDelete.length > 0
                    ? `${formatCount(derived.toDelete.length)} ảnh đã chọn loại — xoá khỏi máy để mở khoá bước 3`
                    : analysisComplete
                      ? "Sạch — không còn ảnh rác"
                      : "Đang chờ AI phân tích xong"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {derived.unresolved.length > 0 && (
                <button type="button" onClick={rejectAllUnresolved} className={`${secondaryButtonClass} px-3 py-2 text-xs`}>
                  Loại tất cả {formatCount(derived.unresolved.length)} ảnh chưa xử lý
                </button>
              )}
              {derived.toDelete.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={running}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
                >
                  <TrashIcon size={14} /> Xoá {formatCount(derived.toDelete.length)} ảnh đã loại khỏi máy
                </button>
              )}
            </div>
          </div>

          <div role="group" aria-label="Lọc ảnh hiển thị" className="flex flex-wrap gap-1.5">
            {(
              [
                ["issues", "Ảnh lỗi", derived.flagged.length],
                ["rejected", "Đã chọn loại", derived.toDelete.length],
                ["all", "Tất cả", derived.live.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-medium transition ${
                  filter === key ? "border border-white/10 bg-white/15 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                {label} <span className="tabular-nums text-zinc-400">{formatCount(count)}</span>
              </button>
            ))}
            <span className="ml-auto self-center text-[11px] text-zinc-500">Mở “Tất cả” để gắn cờ pháo hoa xịt</span>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-zinc-900/40 p-8 text-center text-sm text-zinc-400">
              {filter === "issues" ? "AI không thấy ảnh lỗi nào." : "Không có ảnh nào."}
            </p>
          ) : (
            <VirtualPhotoGrid
              items={visible}
              decisionOf={decisionOf}
              fireworks={fireworks}
              onDecide={decide}
              onToggleFireworks={toggleFireworks}
              onPreview={setPreviewPath}
            />
          )}
        </section>
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        dismissible={deleting === null}
        size="sm"
        title={`Xoá ${formatCount(derived.toDelete.length)} ảnh khỏi máy?`}
        description="Xoá vĩnh viễn, không vào thùng rác, không hoàn tác"
        icon={<TrashIcon size={18} />}
        footer={
          <>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting !== null} className={ghostButtonClass}>
              Hủy
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
            >
              {deleting ? `Đang xoá ${deleting.done}/${deleting.total}…` : "Xoá vĩnh viễn"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-zinc-300">
          <p>
            Trình duyệt sẽ xin quyền ghi vào thư mục <strong className="text-white">“{inventory?.folderName}”</strong> rồi xoá các ảnh JPG đã loại
            {structure?.rawContainer?.kind === "folder" ? " cùng file RAW cùng tên." : "."}
          </p>
          {structure?.rawContainer?.kind === "archive" && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-950/30 p-3 text-xs text-amber-200">
              RAW đang nằm trong file nén nên không bị đụng tới. Nếu Studio yêu cầu RAW khớp JPG, hãy nén lại sau khi xoá.
            </p>
          )}
          {deleteError && <p role="alert" className="text-xs text-rose-300">{deleteError}</p>}
        </div>
      </Dialog>

      <PhotoPreview structure={structure} path={previewPath} onClose={() => setPreviewPath(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ virtualized grid

const MIN_CARD = 176;
const GAP = 12;
const CARD_INFO_HEIGHT = 104;

function VirtualPhotoGrid({
  items,
  decisionOf,
  fireworks,
  onDecide,
  onToggleFireworks,
  onPreview,
}: {
  items: ReviewItem[];
  decisionOf: (item: ReviewItem) => Decision | undefined;
  fireworks: Record<string, true>;
  onDecide: (path: string, decision: Decision | null) => void;
  onToggleFireworks: (path: string) => void;
  onPreview: (path: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(2, Math.floor((width + GAP) / (MIN_CARD + GAP)));
  const cardWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CARD;
  const rowHeight = Math.round((cardWidth * 2) / 3 + CARD_INFO_HEIGHT + GAP);
  const rowCount = Math.ceil(items.length / columns);

  // TanStack Virtual trả về hàm không memo hoá được — chỉ ảnh hưởng React Compiler (dự án
  // không bật). Ảo hoá danh sách là bắt buộc cho thư mục vài nghìn ảnh.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  return (
    <div
      ref={scrollRef}
      className="max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-zinc-950/40 p-3"
      role="list"
      aria-label={`${items.length} ảnh`}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="absolute inset-x-0 grid"
            style={{
              top: row.start,
              height: rowHeight - GAP,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: GAP,
            }}
          >
            {items.slice(row.index * columns, row.index * columns + columns).map((item) => (
              <PhotoCard
                key={item.path}
                item={item}
                decision={decisionOf(item)}
                isFireworks={fireworks[item.path] === true}
                onDecide={onDecide}
                onToggleFireworks={onToggleFireworks}
                onPreview={onPreview}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const PhotoCard = memo(function PhotoCard({
  item,
  decision,
  isFireworks,
  onDecide,
  onToggleFireworks,
  onPreview,
}: {
  item: ReviewItem;
  decision: Decision | undefined;
  isFireworks: boolean;
  onDecide: (path: string, decision: Decision | null) => void;
  onToggleFireworks: (path: string) => void;
  onPreview: (path: string) => void;
}) {
  const flagged = item.reasons.length > 0;
  const rejected = decision === "reject";
  return (
    <div
      role="listitem"
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-zinc-900 transition-colors ${
        rejected ? "border-rose-500/50" : decision === "keep" ? "border-emerald-500/40" : flagged ? "border-amber-500/40" : "border-white/10"
      }`}
    >
      <button
        type="button"
        onClick={() => onPreview(item.path)}
        aria-label={`Xem lớn ${item.name}`}
        className="relative aspect-[3/2] w-full shrink-0 overflow-hidden bg-zinc-950"
      >
        {item.thumbUrl ? (
          <img src={item.thumbUrl} alt="" width={300} height={200} decoding="async" className={`size-full object-cover transition ${rejected ? "opacity-40 grayscale" : ""}`} />
        ) : (
          <span className="flex size-full items-center justify-center text-xs text-zinc-600">Không có ảnh xem trước</span>
        )}
        {rejected && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">LOẠI</span>
        )}
      </button>
      <div className="flex min-h-0 flex-1 flex-col justify-between gap-1.5 p-2">
        <p className="truncate font-mono text-[11px] text-zinc-300" title={item.path}>{item.name}</p>
        <div className="flex h-5 items-center gap-1 overflow-hidden">
          {item.reasons.map((reason) => (
            <span key={reason} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
              {REASON_META[reason].icon}
              {REASON_META[reason].label}
            </span>
          ))}
          {isFireworks && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-200">
              <SparklesIcon size={11} /> Pháo hoa xịt
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {flagged && !isFireworks ? (
            <>
              <button
                type="button"
                aria-pressed={decision === "reject"}
                onClick={() => onDecide(item.path, decision === "reject" ? null : "reject")}
                className={`flex-1 rounded-lg px-1 py-1 text-[11px] font-semibold transition ${
                  decision === "reject" ? "bg-rose-600 text-white" : "border border-white/10 text-zinc-300 hover:bg-rose-500/15 hover:text-rose-200"
                }`}
              >
                Loại<span className="sr-only"> {item.name}</span>
              </button>
              <button
                type="button"
                aria-pressed={decision === "keep"}
                onClick={() => onDecide(item.path, decision === "keep" ? null : "keep")}
                className={`flex-1 rounded-lg px-1 py-1 text-[11px] font-semibold transition ${
                  decision === "keep" ? "bg-emerald-600 text-white" : "border border-white/10 text-zinc-300 hover:bg-emerald-500/15 hover:text-emerald-200"
                }`}
              >
                Giữ<span className="sr-only"> {item.name} (AI nhầm)</span>
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-pressed={isFireworks}
            onClick={() => onToggleFireworks(item.path)}
            title="Gắn cờ pháo hoa xịt"
            className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${flagged && !isFireworks ? "" : "flex-1"} ${
              isFireworks ? "bg-rose-600/80 text-white" : "border border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <SparklesIcon size={11} />
              {flagged && !isFireworks ? <span className="sr-only">Pháo hoa xịt</span> : isFireworks ? "Bỏ cờ pháo hoa" : "Pháo hoa xịt"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
});

function PhotoPreview({ structure, path, onClose }: { structure: PhotoStructure | null; path: string | null; onClose: () => void }) {
  const file = useMemo(() => structure?.jpgs.find((j) => j.relativePath === path)?.file ?? null, [structure, path]);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  return (
    <Dialog open={path !== null} onClose={onClose} size="lg" title={file?.name ?? "Xem ảnh"} description={path ?? undefined}>
      {url && <img src={url} alt={file?.name ?? ""} width={1600} height={1067} className="mx-auto h-auto max-h-[70dvh] w-auto rounded-xl object-contain" />}
    </Dialog>
  );
}
