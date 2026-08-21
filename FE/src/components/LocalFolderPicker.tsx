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
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
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
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {isScanning ? "Đang quét thư mục..." : "Chọn thư mục ảnh gốc trên máy"}
      </button>

      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {result && !error && (
        <div className="mt-3 space-y-3">
          <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
            <p className="font-medium text-slate-900">
              Thư mục "{result.folderName}": {result.files.length} ảnh tìm
              thấy
            </p>
            <p className="mt-1 text-slate-600">
              RAW: {rawCount} · JPG: {jpgCount}
              {result.skippedCount > 0 &&
                ` · Bỏ qua ${result.skippedCount} file khác định dạng`}
            </p>
            <p className="mt-1 text-slate-600">
              Đã ghép {result.pairing.pairs.length} cặp RAW+JPG
            </p>
          </div>

          {unmatched.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-800">
                {unmatched.length} file lẻ không có cặp (chỉ RAW hoặc chỉ
                JPG):
              </p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {unmatched.map((f) => (
                  <li
                    key={f.relativePath}
                    className="flex items-center justify-between gap-2 text-amber-700"
                  >
                    <span className="truncate">{f.relativePath}</span>
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs uppercase">
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