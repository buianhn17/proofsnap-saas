// Bước 2 (thợ quay) — không chạy AI ảnh tĩnh: quét file video, đếm clip, tổng dung lượng,
// phát hiện clip 0 byte / file proxy, và checklist footage gốc thợ tự xác nhận.
import { useEffect, useId, useMemo, useState } from "react";
import {
  FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE,
  isFileSystemAccessSupported,
} from "../../lib/localFolderImport";
import { analyzeVideoFolder, pickFolderInventory, type FolderInventory, type VideoScan } from "../../lib/crewFolderScan";
import { formatBytes, formatCount } from "../../lib/studioShows";
import { primaryButtonClass, secondaryButtonClass } from "../Dialog";
import { AlertTriangleIcon, CheckIcon, FolderIcon, VideoIcon } from "../Icons";
import type { StepOutcome } from "./stepOutcome";

const CHECKLIST = [
  { id: "original", label: "Footage gốc copy thẳng từ thẻ nhớ — không convert, không nén lại" },
  { id: "complete", label: "Đủ clip cả buổi, không thiếu đoạn quan trọng (vào lớp, tiết mục, chụp tập thể)" },
  { id: "playback", label: "Đã xem nhanh: không clip lỗi, mất tiếng hay giật hình" },
] as const;

export default function VideoScanStep({ onOutcome }: { onOutcome: (outcome: StepOutcome | null) => void }) {
  const supported = isFileSystemAccessSupported();
  const id = useId();
  const [inventory, setInventory] = useState<FolderInventory | null>(null);
  const [scan, setScan] = useState<VideoScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  async function handlePick() {
    setError(null);
    setScanning(true);
    try {
      const picked = await pickFolderInventory();
      if (!picked) return;
      setInventory(picked);
      setScan(analyzeVideoFolder(picked));
      setChecked({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đọc được thư mục đã chọn");
    } finally {
      setScanning(false);
    }
  }

  const autoChecks = useMemo(() => {
    if (!scan) return [];
    return [
      { id: "has-clips", ok: scan.clips.length > 0, label: "Có file video gốc", detail: scan.clips.length ? `${formatCount(scan.clips.length)} clip` : "Không thấy .mp4/.mov/.mxf… nào", blocking: true },
      {
        id: "zero",
        ok: scan.zeroByteClips.length === 0,
        label: "Không có clip 0 byte (copy lỗi)",
        detail: scan.zeroByteClips.length ? scan.zeroByteClips.slice(0, 3).map((c) => c.relativePath).join(", ") : undefined,
        blocking: true,
      },
      {
        id: "proxy",
        ok: scan.proxyFiles.length === 0,
        label: "Không lẫn file proxy (.lrv/.thm)",
        detail: scan.proxyFiles.length ? `${formatCount(scan.proxyFiles.length)} file proxy — nên xoá trước khi up` : undefined,
        blocking: false,
      },
    ];
  }, [scan]);

  const structureOk = autoChecks.length > 0 && autoChecks.every((c) => c.ok || !c.blocking);
  const checklistDone = CHECKLIST.every((item) => checked[item.id]);

  const outcome = useMemo<StepOutcome | null>(() => {
    if (!scan) return null;
    return {
      ready: structureOk && checklistDone,
      totalFiles: scan.clips.length,
      rawCount: 0,
      jpgCount: 0,
      videoCount: scan.clips.length,
      culledStats: {},
      hasValidStructure: structureOk,
    };
  }, [scan, structureOk, checklistDone]);

  useEffect(() => onOutcome(outcome), [outcome, onOutcome]);

  if (!supported) {
    return (
      <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
        {FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-white/15 bg-zinc-950/40 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-cyan-300">
            <FolderIcon size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">
              {inventory ? `Thư mục “${inventory.folderName}”` : "Chọn folder footage gốc"}
            </p>
            <p className="text-xs text-zinc-400">
              {inventory ? `${formatCount(inventory.files.length)} file đã quét` : "Hệ thống chỉ đọc tên và dung lượng file — video không rời khỏi máy bạn."}
            </p>
          </div>
        </div>
        <button type="button" onClick={handlePick} disabled={scanning} className={inventory ? secondaryButtonClass : primaryButtonClass}>
          {scanning ? "Đang quét…" : inventory ? "Quét lại" : "Chọn thư mục"}
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}

      {scan && (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Tổng số clip" value={formatCount(scan.clips.length)} />
            <Tile label="Tổng dung lượng" value={formatBytes(scan.totalBytes)} />
            <Tile label="Định dạng" value={scan.byExtension.map((e) => `${e.extension.toUpperCase()} ${e.count}`).join(" · ") || "—"} small />
            <Tile label="File khác (bỏ qua)" value={formatCount(scan.otherFileCount)} />
          </dl>

          <section aria-labelledby={`${id}-auto`} className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
            <h3 id={`${id}-auto`} className="text-sm font-semibold text-white">Kiểm tra tự động</h3>
            <ul className="mt-3 flex flex-col gap-2">
              {autoChecks.map((check) => (
                <li key={check.id} className="flex items-start gap-2.5 text-sm">
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                      check.ok ? "bg-emerald-500/15 text-emerald-300" : check.blocking ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"
                    }`}
                    aria-hidden="true"
                  >
                    {check.ok ? <CheckIcon size={12} /> : <AlertTriangleIcon size={11} />}
                  </span>
                  <span className="min-w-0">
                    <span className="text-zinc-200">{check.label}</span>
                    <span className="sr-only">{check.ok ? ": đạt" : ": chưa đạt"}</span>
                    {check.detail && <span className="block truncate text-xs tabular-nums text-zinc-500">{check.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {scan.byFolder.length > 0 && (
            <section aria-labelledby={`${id}-folders`} className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/50">
              <h3 id={`${id}-folders`} className="flex items-center gap-2 border-b border-white/10 px-5 py-3 text-sm font-semibold text-white">
                <VideoIcon size={15} className="text-cyan-300" /> Clip theo thư mục
              </h3>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-900 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th scope="col" className="px-5 py-2">Thư mục</th>
                      <th scope="col" className="px-5 py-2 text-right">Clip</th>
                      <th scope="col" className="px-5 py-2 text-right">Dung lượng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-zinc-300">
                    {scan.byFolder.map((f) => (
                      <tr key={f.folder}>
                        <td className="max-w-0 truncate px-5 py-2 font-mono" title={f.folder}>{f.folder}</td>
                        <td className="px-5 py-2 text-right tabular-nums">{formatCount(f.count)}</td>
                        <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums">{formatBytes(f.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <fieldset className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
            <legend className="px-1 text-sm font-semibold text-white">Checklist chất lượng footage</legend>
            <div className="mt-2 flex flex-col gap-3">
              {CHECKLIST.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    name={item.id}
                    checked={checked[item.id] ?? false}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                    className="mt-0.5 size-4 shrink-0 rounded accent-indigo-500"
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
      <dt className="text-xs font-medium text-zinc-400">{label}</dt>
      <dd className={`mt-1.5 font-bold tabular-nums tracking-tight text-white ${small ? "truncate text-sm" : "text-2xl"}`} title={small ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}
