import { useState } from "react";
import {
  FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE,
  isFileSystemAccessSupported,
  pickLocalPhotoFolder,
  type LocalFolderScanResult,
} from "../lib/localFolderImport";

interface LocalFolderPickerProps {
  onScanned?: (result: LocalFolderScanResult) => void;
}

export default function LocalFolderPicker({
  onScanned,
}: LocalFolderPickerProps) {
  const supported = isFileSystemAccessSupported();
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LocalFolderScanResult | null>(null);

  async function handlePick() {
    setError(null);
    setIsScanning(true);
    try {
      const scanned = await pickLocalPhotoFolder();
      if (scanned) {
        setResult(scanned);
        onScanned?.(scanned);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Không đọc được thư mục đã chọn"
      );
    } finally {
      setIsScanning(false);
    }
  }

  if (!supported) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/50 px-3.5 py-2.5 text-sm text-amber-200">
        {FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE}
      </div>
    );
  }

  const rawCount = result?.files.filter((f) => f.kind === "raw").length ?? 0;
  const jpgCount = result?.files.filter((f) => f.kind === "jpg").length ?? 0;
  const unmatched = result
    ? [...result.pairing.unmatchedRaw, ...result.pairing.unmatchedJpg].sort(
        (a, b) => a.relativePath.localeCompare(b.relativePath)
      )
    : [];

  return (
    <div>
      <button
        type="button"
        onClick={handlePick}
        disabled={isScanning}
        className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isScanning ? "Đang quét thư mục…" : "Chọn thư mục ảnh gốc trên máy"}
      </button>

      {error && (
        <p className="mt-2 rounded-xl border border-rose-500/20 bg-rose-950/50 px-3.5 py-2.5 text-sm text-rose-300">
          {error}
        </p>
      )}

      {result && !error && (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3.5 text-sm">
            <p className="font-medium text-zinc-100">
              Thư mục “{result.folderName}”: {result.files.length} ảnh tìm
              thấy
            </p>
            <p className="mt-1 text-zinc-400 tabular-nums">
              RAW: {rawCount} · JPG: {jpgCount}
              {result.skippedCount > 0 &&
                ` · Bỏ qua ${result.skippedCount} file khác định dạng`}
            </p>
            <p className="mt-1 text-zinc-400 tabular-nums">
              Đã ghép {result.pairing.pairs.length} cặp RAW+JPG
            </p>
          </div>

          {unmatched.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/40 p-3.5 text-sm">
              <p className="font-medium text-amber-200">
                {unmatched.length} file lẻ không có cặp (chỉ RAW hoặc chỉ
                JPG):
              </p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {unmatched.map((f) => (
                  <li
                    key={f.relativePath}
                    className="flex min-w-0 items-center justify-between gap-2 text-amber-300/90"
                  >
                    <span className="truncate">{f.relativePath}</span>
                    <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase">
                      {f.kind}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}