// Bước 1.3 — trang thử nghiệm ĐỘC LẬP cho 3 kỹ thuật AI culling (độ nét Laplacian,
// trạng thái mắt qua MediaPipe FaceLandmarker + EAR, trùng lặp/burst qua dHash).
// KHÔNG gắn vào luồng upload/album thật — chỉ dùng để chạy trên ảnh thật của 1 buổi
// chụp (>=200-300 ảnh), đối chiếu với đánh giá bằng mắt, và chốt ngưỡng xanh/vàng/đỏ
// trước khi đưa thuật toán vào UI chính thức.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE,
  isFileSystemAccessSupported,
  pickLocalPhotoFolder,
  type LocalFolderScanResult,
} from "../../lib/localFolderImport";
import type {
  CullingTestItem,
  CullingTestProgress,
  CullingTestSummary,
} from "../../lib/culling/cullingPipeline";
import { runCullingTestInWorker } from "../../lib/culling/cullingWorkerClient";
import { groupByHashDistance } from "../../lib/culling/perceptualHash";
import { groupScenesAndBursts } from "../../lib/culling/sceneGrouping";
import {
  classifyEyeStatus,
  DEFAULT_EYE_THRESHOLDS,
} from "../../lib/culling/eyeStatus";
import type { EyeStatus, EyeStatusThresholds } from "../../lib/culling/types";
import { buildCsv, downloadCsv } from "../../lib/culling/csvExport";
import {
  getHardwareInfo,
  type AccelerationTier,
  type HardwareInfo,
} from "../../lib/culling/hardwareAcceleration";
import {
  DEFAULT_SHARPNESS_THRESHOLDS,
  sharpnessBucket,
  type CullingFlag,
} from "../../lib/culling/cullingFlag";

type ManualSharpness = "unset" | "sharp" | "medium" | "blurry";
type ManualEye = "unset" | "open" | "squint" | "closed" | "no_face";
interface ManualVerdict {
  sharpness: ManualSharpness;
  eye: ManualEye;
}
type ManualVerdicts = Record<string, ManualVerdict>;

type SharpnessBucket = CullingFlag;
type SortKey = "filename" | "sharpness" | "ear" | "group" | "totalMs";

interface CullingRunRecord {
  id: string;
  tier: AccelerationTier;
  eyeMaxEdgePx: number;
  hardwareInfo: HardwareInfo;
  count: number;
  totalElapsedMs: number;
  imagesPerSecond: number;
  avgEyeMs: number;
  avgTotalMs: number;
}

const TIER_LABEL: Record<AccelerationTier, string> = {
  gpu: "GPU (WebGL delegate)",
  wasm: "WASM (CPU delegate)",
};

const MANUAL_VERDICTS_STORAGE_KEY = "lensproof-culling-test-manual-verdicts";
const EMPTY_VERDICT: ManualVerdict = { sharpness: "unset", eye: "unset" };

const MANUAL_SHARPNESS_TO_BUCKET: Record<
  Exclude<ManualSharpness, "unset">,
  SharpnessBucket
> = {
  blurry: "red",
  medium: "yellow",
  sharp: "green",
};

const EYE_STATUS_LABEL: Record<EyeStatus, string> = {
  open: "Mở",
  squint: "Nheo",
  closed: "Nhắm",
  no_face: "Không có mặt",
};

const BUCKET_LABEL: Record<SharpnessBucket, string> = {
  red: "Đỏ (mờ)",
  yellow: "Vàng (trung bình)",
  green: "Xanh (nét)",
};

const BUCKET_CLASS: Record<SharpnessBucket, string> = {
  red: "bg-red-100 text-red-700",
  yellow: "bg-amber-100 text-amber-700",
  green: "bg-emerald-100 text-emerald-700",
};

function loadManualVerdicts(): ManualVerdicts {
  try {
    const raw = localStorage.getItem(MANUAL_VERDICTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ManualVerdicts) : {};
  } catch {
    return {};
  }
}

export default function CullingTestPage() {
  const supported = isFileSystemAccessSupported();

  const [scanResult, setScanResult] = useState<LocalFolderScanResult | null>(
    null
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<CullingTestProgress | null>(null);
  const [summary, setSummary] = useState<CullingTestSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const [sharpnessThresholds, setSharpnessThresholds] = useState(
    DEFAULT_SHARPNESS_THRESHOLDS
  );
  const [eyeThresholds, setEyeThresholds] = useState<EyeStatusThresholds>(
    DEFAULT_EYE_THRESHOLDS
  );
  const [maxHashDistance, setMaxHashDistance] = useState(6);
  const [eyeMaxEdgePx, setEyeMaxEdgePx] = useState(1600);
  const [accelerationTier, setAccelerationTier] =
    useState<AccelerationTier>("gpu");
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | null>(null);
  const [runHistory, setRunHistory] = useState<CullingRunRecord[]>([]);

  const [manualVerdicts, setManualVerdicts] = useState<ManualVerdicts>(
    loadManualVerdicts
  );

  const [sortKey, setSortKey] = useState<SortKey>("filename");
  const [sortAsc, setSortAsc] = useState(true);

  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [lastRunEyeMaxEdgePx, setLastRunEyeMaxEdgePx] = useState<
    number | null
  >(null);

  useEffect(() => {
    localStorage.setItem(
      MANUAL_VERDICTS_STORAGE_KEY,
      JSON.stringify(manualVerdicts)
    );
  }, [manualVerdicts]);

  useEffect(() => {
    getHardwareInfo().then(setHardwareInfo);
  }, []);

  // Sinh thumbnail cho bảng kết quả, huỷ URL cũ khi có kết quả mới / rời trang.
  useEffect(() => {
    if (!summary) return;
    const urls: Record<string, string> = {};
    for (const item of summary.items) {
      urls[item.file.relativePath] = URL.createObjectURL(item.file.file);
    }
    setThumbnails(urls);
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [summary]);

  async function handlePickFolder() {
    setScanError(null);
    setIsScanning(true);
    setSummary(null);
    try {
      const result = await pickLocalPhotoFolder();
      if (result) setScanResult(result);
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : "Không đọc được thư mục"
      );
    } finally {
      setIsScanning(false);
    }
  }

  async function handleRun() {
    if (!scanResult) return;
    const jpgFiles = scanResult.files.filter((f) => f.kind === "jpg");
    if (jpgFiles.length === 0) {
      setRunError("Thư mục không có file JPG nào để chạy thử nghiệm.");
      return;
    }

    setRunError(null);
    setIsRunning(true);
    setProgress(null);
    setSummary(null);

    const { promise, abort } = runCullingTestInWorker(jpgFiles, {
      maxEdgePx: 900,
      eyeMaxEdgePx,
      eyeThresholds,
      accelerationTier,
      onProgress: setProgress,
    });
    abortRef.current = abort;

    try {
      const result = await promise;
      setSummary(result);
      setLastRunEyeMaxEdgePx(eyeMaxEdgePx);

      const avgEyeMs =
        result.items.reduce((acc, item) => acc + item.timingsMs.eye, 0) /
        (result.items.length || 1);
      const avgTotalMs =
        result.items.reduce((acc, item) => acc + item.timingsMs.total, 0) /
        (result.items.length || 1);
      setRunHistory((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          tier: result.accelerationTier,
          eyeMaxEdgePx,
          hardwareInfo: result.hardwareInfo,
          count: result.items.length,
          totalElapsedMs: result.totalElapsedMs,
          imagesPerSecond: result.imagesPerSecond,
          avgEyeMs,
          avgTotalMs,
        },
      ]);
    } catch (err) {
      setRunError(
        err instanceof Error ? err.message : "Lỗi không xác định khi chạy thử nghiệm"
      );
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.();
  }

  function setManualSharpness(path: string, value: ManualSharpness) {
    setManualVerdicts((prev) => ({
      ...prev,
      [path]: { ...(prev[path] ?? EMPTY_VERDICT), sharpness: value },
    }));
  }

  function setManualEye(path: string, value: ManualEye) {
    setManualVerdicts((prev) => ({
      ...prev,
      [path]: { ...(prev[path] ?? EMPTY_VERDICT), eye: value },
    }));
  }

  const burstGroups = useMemo(() => {
    if (!summary) return new Map<string, number>();
    return groupByHashDistance(
      summary.items.map((item) => ({
        id: item.file.relativePath,
        hash: item.metrics.hash,
      })),
      maxHashDistance
    );
  }, [summary, maxHashDistance]);

  const groupSizes = useMemo(() => {
    const sizes = new Map<number, number>();
    for (const groupId of burstGroups.values()) {
      sizes.set(groupId, (sizes.get(groupId) ?? 0) + 1);
    }
    return sizes;
  }, [burstGroups]);

  // Bước 1.7 — gom scene (buổi chụp)/burst LIÊN TIẾP, khác với burstGroups ở trên (dHash
  // toàn cục, dùng để bắt trùng lặp bất kỳ vị trí nào, phục vụ hiệu chỉnh maxHashDistance).
  const sceneAndBurst = useMemo(() => {
    if (!summary) {
      return { sceneId: new Map<string, number>(), burstId: new Map<string, number>() };
    }
    return groupScenesAndBursts(
      summary.items.map((item) => ({
        id: item.file.relativePath,
        timestampMs: item.sceneSignals.capturedAtMs ?? item.file.file.lastModified,
        timestampSource: item.sceneSignals.timestampSource,
        histogram: item.sceneSignals.histogram,
        hash: item.metrics.hash,
        signature: item.sceneSignals.signature,
      }))
    );
  }, [summary]);

  const stats = useMemo(() => {
    if (!summary) return null;
    const items = summary.items;
    const n = items.length || 1;
    const avg = (fn: (item: CullingTestItem) => number) =>
      items.reduce((acc, item) => acc + fn(item), 0) / n;

    const bucketCounts: Record<SharpnessBucket, number> = {
      red: 0,
      yellow: 0,
      green: 0,
    };
    for (const item of items) {
      bucketCounts[
        sharpnessBucket(item.metrics.sharpnessScore, sharpnessThresholds)
      ] += 1;
    }

    const eyeCounts: Record<EyeStatus, number> = {
      open: 0,
      squint: 0,
      closed: 0,
      no_face: 0,
    };
    for (const item of items) {
      eyeCounts[classifyEyeStatus(item.metrics.earValue, eyeThresholds)] += 1;
    }

    const burstClusterCount = Array.from(groupSizes.values()).filter(
      (size) => size > 1
    ).length;
    const imagesInBursts = Array.from(groupSizes.values())
      .filter((size) => size > 1)
      .reduce((a, b) => a + b, 0);

    let sharpnessLabeled = 0;
    let sharpnessMatched = 0;
    let eyeLabeled = 0;
    let eyeMatched = 0;
    for (const item of items) {
      const verdict = manualVerdicts[item.file.relativePath];
      if (verdict?.sharpness && verdict.sharpness !== "unset") {
        sharpnessLabeled += 1;
        const autoBucket = sharpnessBucket(
          item.metrics.sharpnessScore,
          sharpnessThresholds
        );
        if (MANUAL_SHARPNESS_TO_BUCKET[verdict.sharpness] === autoBucket) {
          sharpnessMatched += 1;
        }
      }
      if (verdict?.eye && verdict.eye !== "unset") {
        eyeLabeled += 1;
        if (
          verdict.eye ===
          classifyEyeStatus(item.metrics.earValue, eyeThresholds)
        ) {
          eyeMatched += 1;
        }
      }
    }

    return {
      count: items.length,
      totalElapsedMs: summary.totalElapsedMs,
      imagesPerSecond: summary.imagesPerSecond,
      avgDecodeMs: avg((i) => i.timingsMs.decode),
      avgSharpnessMs: avg((i) => i.timingsMs.sharpness),
      avgHashMs: avg((i) => i.timingsMs.hash),
      avgEyeMs: avg((i) => i.timingsMs.eye),
      avgTotalMs: avg((i) => i.timingsMs.total),
      bucketCounts,
      eyeCounts,
      burstClusterCount,
      imagesInBursts,
      sharpnessLabeled,
      sharpnessMatched,
      eyeLabeled,
      eyeMatched,
      errorCount: items.filter((i) => i.error).length,
    };
  }, [summary, sharpnessThresholds, eyeThresholds, groupSizes, manualVerdicts]);

  const sortedItems = useMemo(() => {
    if (!summary) return [];
    const items = [...summary.items];
    const dir = sortAsc ? 1 : -1;
    items.sort((a, b) => {
      switch (sortKey) {
        case "sharpness":
          return (
            (a.metrics.sharpnessScore - b.metrics.sharpnessScore) * dir
          );
        case "ear":
          return (
            ((a.metrics.earValue ?? -1) - (b.metrics.earValue ?? -1)) * dir
          );
        case "group":
          return (
            ((burstGroups.get(a.file.relativePath) ?? 0) -
              (burstGroups.get(b.file.relativePath) ?? 0)) *
            dir
          );
        case "totalMs":
          return (a.timingsMs.total - b.timingsMs.total) * dir;
        case "filename":
        default:
          return (
            a.file.relativePath.localeCompare(b.file.relativePath) * dir
          );
      }
    });
    return items;
  }, [summary, sortKey, sortAsc, burstGroups]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function handleExportCsv() {
    if (!summary) return;
    const headers = [
      "relativePath",
      "width",
      "height",
      "sharpnessScore",
      "sharpnessBucket",
      "hash",
      "burstGroup",
      "sceneId",
      "consecutiveBurstId",
      "capturedAtMs",
      "faceCount",
      "earValue",
      "eyeStatus",
      "decodeMs",
      "sharpnessMs",
      "hashMs",
      "eyeMs",
      "totalMs",
      "manualSharpness",
      "manualEye",
      "error",
    ];
    const rows = sortedItems.map((item) => {
      const verdict = manualVerdicts[item.file.relativePath] ?? EMPTY_VERDICT;
      return [
        item.file.relativePath,
        item.width,
        item.height,
        item.metrics.sharpnessScore.toFixed(2),
        sharpnessBucket(item.metrics.sharpnessScore, sharpnessThresholds),
        item.metrics.hash,
        burstGroups.get(item.file.relativePath) ?? "",
        sceneAndBurst.sceneId.get(item.file.relativePath) ?? "",
        sceneAndBurst.burstId.get(item.file.relativePath) ?? "",
        item.sceneSignals.capturedAtMs ?? "",
        item.metrics.faceCount,
        item.metrics.earValue?.toFixed(4) ?? "",
        classifyEyeStatus(item.metrics.earValue, eyeThresholds),
        item.timingsMs.decode.toFixed(1),
        item.timingsMs.sharpness.toFixed(1),
        item.timingsMs.hash.toFixed(1),
        item.timingsMs.eye.toFixed(1),
        item.timingsMs.total.toFixed(1),
        verdict.sharpness,
        verdict.eye,
        item.error ?? "",
      ];
    });
    downloadCsv(
      `culling-test-${scanResult?.folderName ?? "result"}.csv`,
      buildCsv(headers, rows)
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
        <p className="font-medium">
          Bước 1.3 — Công cụ thử nghiệm thuật toán AI culling (nội bộ)
        </p>
        <p className="mt-1">
          Trang này KHÔNG thuộc luồng upload/album thật, chỉ để chạy thử độ
          nét (Laplacian), trạng thái mắt (MediaPipe + EAR) và trùng lặp/burst
          (dHash) trên ảnh JPG thật, đối chiếu với đánh giá bằng mắt để chốt
          ngưỡng xanh/vàng/đỏ trước khi đưa vào UI chính thức.
        </p>
      </div>

      {hardwareInfo && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Phần cứng: </span>
          navigator.gpu: {hardwareInfo.webGpuFlagPresent ? "có" : "không"} ·
          WebGPU adapter: {hardwareInfo.webGpuAdapterAvailable ? "có" : "không"}{" "}
          · crossOriginIsolated (cần cho WASM đa luồng):{" "}
          {hardwareInfo.crossOriginIsolated ? "có" : "không"} · CPU logic:{" "}
          {hardwareInfo.hardwareConcurrency} luồng
          {!hardwareInfo.crossOriginIsolated && (
            <span className="text-amber-700">
              {" "}
              — trang chưa cross-origin isolated, WASM sẽ chạy đơn luồng
              (chậm hơn).
            </span>
          )}
        </div>
      )}

      {!supported && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE}
        </div>
      )}

      {supported && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePickFolder}
            disabled={isScanning || isRunning}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isScanning ? "Đang quét..." : "Chọn thư mục ảnh buổi chụp thật"}
          </button>

          {scanResult && (
            <span className="text-sm text-slate-600">
              "{scanResult.folderName}":{" "}
              {scanResult.files.filter((f) => f.kind === "jpg").length} JPG
              tìm thấy
            </span>
          )}

          {scanResult && !isRunning && (
            <>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Tầng tăng tốc
                <select
                  value={accelerationTier}
                  onChange={(e) =>
                    setAccelerationTier(e.target.value as AccelerationTier)
                  }
                  className="rounded-md border border-slate-300 px-2 py-1"
                >
                  <option value="gpu">{TIER_LABEL.gpu}</option>
                  <option value="wasm">{TIER_LABEL.wasm}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Cạnh dài ảnh cho bước phát hiện mắt (px)
                <input
                  type="number"
                  min={900}
                  step={100}
                  value={eyeMaxEdgePx}
                  onChange={(e) => setEyeMaxEdgePx(Number(e.target.value))}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
              <button
                type="button"
                onClick={handleRun}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Chạy thử nghiệm 3 kỹ thuật
              </button>
            </>
          )}

          {isRunning && (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Dừng
            </button>
          )}
        </div>
      )}

      {scanError && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {scanError}
        </p>
      )}
      {runError && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {runError}
        </p>
      )}

      {isRunning && progress && (
        <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-700">
              Đang xử lý {progress.processed}/{progress.total}:{" "}
              {progress.currentFileName}
            </span>
            <span className="text-slate-500">
              {progress.imagesPerSecond.toFixed(2)} ảnh/giây
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{
                width: `${(progress.processed / progress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {runHistory.length > 0 && (
        <div className="mt-6 rounded-md border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-medium text-slate-900">
            Bước 1.4 — So sánh tốc độ giữa các lần chạy (GPU vs WASM)
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Chạy cùng 1 thư mục bằng cả 2 tầng tăng tốc (đổi "Tầng tăng tốc"
            rồi bấm chạy lại) để so sánh trực tiếp bên dưới.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-100 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Tầng</th>
                  <th className="px-2 py-2">Ảnh</th>
                  <th className="px-2 py-2">Ảnh/giây</th>
                  <th className="px-2 py-2">TB mắt (ms)</th>
                  <th className="px-2 py-2">TB tổng (ms)</th>
                  <th className="px-2 py-2">Ảnh mắt (px)</th>
                  <th className="px-2 py-2">crossOriginIsolated</th>
                  <th className="px-2 py-2">CPU luồng</th>
                </tr>
              </thead>
              <tbody>
                {runHistory.map((run, index) => (
                  <tr key={run.id} className="border-t border-slate-200">
                    <td className="px-2 py-2">{index + 1}</td>
                    <td className="px-2 py-2 font-medium text-slate-800">
                      {TIER_LABEL[run.tier]}
                    </td>
                    <td className="px-2 py-2">{run.count}</td>
                    <td className="px-2 py-2">
                      {run.imagesPerSecond.toFixed(2)}
                    </td>
                    <td className="px-2 py-2">{run.avgEyeMs.toFixed(0)}</td>
                    <td className="px-2 py-2">{run.avgTotalMs.toFixed(0)}</td>
                    <td className="px-2 py-2">{run.eyeMaxEdgePx}</td>
                    <td className="px-2 py-2">
                      {run.hardwareInfo.crossOriginIsolated ? "có" : "không"}
                    </td>
                    <td className="px-2 py-2">
                      {run.hardwareInfo.hardwareConcurrency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stats && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">
            <h3 className="font-medium text-slate-900">Tốc độ xử lý</h3>
            <p className="mt-1 text-slate-600">
              {stats.count} ảnh · {(stats.totalElapsedMs / 1000).toFixed(1)}s
              tổng · {stats.imagesPerSecond.toFixed(2)} ảnh/giây
            </p>
            <p className="mt-1 text-xs text-slate-500">
              TB/ảnh: decode {stats.avgDecodeMs.toFixed(0)}ms · nét{" "}
              {stats.avgSharpnessMs.toFixed(0)}ms · hash{" "}
              {stats.avgHashMs.toFixed(0)}ms · mắt {stats.avgEyeMs.toFixed(0)}
              ms{" "}
              {lastRunEyeMaxEdgePx && `(ảnh ${lastRunEyeMaxEdgePx}px)`} · tổng{" "}
              {stats.avgTotalMs.toFixed(0)}ms
            </p>
            {stats.errorCount > 0 && (
              <p className="mt-1 text-xs text-red-600">
                {stats.errorCount} ảnh lỗi khi xử lý
              </p>
            )}
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">
            <h3 className="font-medium text-slate-900">Độ nét (ngưỡng hiện tại)</h3>
            <p className="mt-1 text-slate-600">
              Xanh {stats.bucketCounts.green} · Vàng {stats.bucketCounts.yellow}{" "}
              · Đỏ {stats.bucketCounts.red}
            </p>
            {stats.sharpnessLabeled > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Độ khớp với đánh giá bằng mắt: {stats.sharpnessMatched}/
                {stats.sharpnessLabeled} (
                {((stats.sharpnessMatched / stats.sharpnessLabeled) * 100).toFixed(
                  0
                )}
                %)
              </p>
            )}
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">
            <h3 className="font-medium text-slate-900">Mắt & Burst</h3>
            <p className="mt-1 text-slate-600">
              Mở {stats.eyeCounts.open} · Nheo {stats.eyeCounts.squint} ·
              Nhắm {stats.eyeCounts.closed} · Không mặt {stats.eyeCounts.no_face}
            </p>
            <p className="mt-1 text-slate-600">
              {stats.burstClusterCount} cụm burst ({stats.imagesInBursts} ảnh)
            </p>
            {stats.eyeLabeled > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Độ khớp mắt với đánh giá bằng mắt: {stats.eyeMatched}/
                {stats.eyeLabeled} (
                {((stats.eyeMatched / stats.eyeLabeled) * 100).toFixed(0)}%)
              </p>
            )}
          </div>
        </div>
      )}

      {summary && (
        <div className="mt-6 rounded-md border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-medium text-slate-900">
            Ngưỡng phân loại — chỉnh để chốt điểm xanh/vàng/đỏ
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="text-xs text-slate-600">
              Độ nét — dưới ngưỡng này là ĐỎ
              <input
                type="number"
                value={sharpnessThresholds.redBelow}
                onChange={(e) =>
                  setSharpnessThresholds((prev) => ({
                    ...prev,
                    redBelow: Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Độ nét — dưới ngưỡng này là VÀNG (trên là XANH)
              <input
                type="number"
                value={sharpnessThresholds.yellowBelow}
                onChange={(e) =>
                  setSharpnessThresholds((prev) => ({
                    ...prev,
                    yellowBelow: Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Khoảng cách Hamming tối đa để coi là cùng cụm burst
              <input
                type="number"
                min={0}
                max={64}
                value={maxHashDistance}
                onChange={(e) => setMaxHashDistance(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              EAR — dưới ngưỡng này là NHẮM
              <input
                type="number"
                step="0.01"
                value={eyeThresholds.closedBelow}
                onChange={(e) =>
                  setEyeThresholds((prev) => ({
                    ...prev,
                    closedBelow: Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              EAR — dưới ngưỡng này là NHEO (trên là MỞ)
              <input
                type="number"
                step="0.01"
                value={eyeThresholds.squintBelow}
                onChange={(e) =>
                  setEyeThresholds((prev) => ({
                    ...prev,
                    squintBelow: Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Mọi ngưỡng ở trên áp dụng ngay lập tức lên bảng và số liệu bên
            dưới — không cần chạy lại thử nghiệm khi chỉ đổi ngưỡng.
          </p>
        </div>
      )}

      {summary && (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex flex-wrap gap-2 text-xs">
            {(
              [
                ["filename", "Tên file"],
                ["sharpness", "Độ nét"],
                ["ear", "EAR"],
                ["group", "Cụm burst"],
                ["totalMs", "Thời gian xử lý"],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleSort(key)}
                className={`rounded-md border px-2 py-1 ${
                  sortKey === key
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                Sắp xếp: {label} {sortKey === key ? (sortAsc ? "↑" : "↓") : ""}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Xuất CSV
          </button>
        </div>
      )}

      {summary && (
        <div className="mt-3 max-h-[70vh] overflow-y-auto rounded-md border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="px-2 py-2">Ảnh</th>
                <th className="px-2 py-2">File</th>
                <th className="px-2 py-2">Độ nét (auto)</th>
                <th className="px-2 py-2">Đánh giá của bạn</th>
                <th className="px-2 py-2">Mắt (auto)</th>
                <th className="px-2 py-2">Đánh giá của bạn</th>
                <th className="px-2 py-2">Cụm burst</th>
                <th className="px-2 py-2">Buổi chụp</th>
                <th className="px-2 py-2">Loạt liên tiếp</th>
                <th className="px-2 py-2">Xử lý (ms)</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => {
                const path = item.file.relativePath;
                const verdict = manualVerdicts[path] ?? EMPTY_VERDICT;
                const bucket = sharpnessBucket(
                  item.metrics.sharpnessScore,
                  sharpnessThresholds
                );
                const groupId = burstGroups.get(path);
                const groupSize = groupId ? groupSizes.get(groupId) : 1;
                const eyeStatus = classifyEyeStatus(
                  item.metrics.earValue,
                  eyeThresholds
                );
                return (
                  <tr key={path} className="border-t border-slate-200">
                    <td className="px-2 py-2">
                      {thumbnails[path] && (
                        <img
                          src={thumbnails[path]}
                          alt={path}
                          className="h-12 w-12 rounded object-cover"
                        />
                      )}
                    </td>
                    <td className="max-w-[220px] px-2 py-2">
                      <span className="block truncate text-slate-700">
                        {path}
                      </span>
                      {item.error && (
                        <span className="text-red-600">{item.error}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 ${BUCKET_CLASS[bucket]}`}
                      >
                        {item.metrics.sharpnessScore.toFixed(0)} ·{" "}
                        {BUCKET_LABEL[bucket]}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={verdict.sharpness}
                        onChange={(e) =>
                          setManualSharpness(
                            path,
                            e.target.value as ManualSharpness
                          )
                        }
                        className="rounded-md border border-slate-300 px-1 py-0.5"
                      >
                        <option value="unset">Chưa đánh giá</option>
                        <option value="sharp">Nét</option>
                        <option value="medium">Trung bình</option>
                        <option value="blurry">Mờ</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      {EYE_STATUS_LABEL[eyeStatus]}
                      {item.metrics.earValue !== null && (
                        <span className="text-slate-400">
                          {" "}
                          ({item.metrics.earValue.toFixed(3)})
                        </span>
                      )}
                      {item.metrics.faceCount > 0 && (
                        <span className="text-slate-400">
                          {" "}
                          · {item.metrics.faceCount} mặt
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={verdict.eye}
                        onChange={(e) =>
                          setManualEye(path, e.target.value as ManualEye)
                        }
                        className="rounded-md border border-slate-300 px-1 py-0.5"
                      >
                        <option value="unset">Chưa đánh giá</option>
                        <option value="open">Mở</option>
                        <option value="squint">Nheo</option>
                        <option value="closed">Nhắm</option>
                        <option value="no_face">Không có mặt</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      #{groupId}
                      {groupSize && groupSize > 1 ? ` (${groupSize} ảnh)` : ""}
                    </td>
                    <td className="px-2 py-2">
                      #{sceneAndBurst.sceneId.get(path)}
                    </td>
                    <td className="px-2 py-2">
                      #{sceneAndBurst.burstId.get(path)}
                    </td>
                    <td className="px-2 py-2 text-slate-500">
                      {item.timingsMs.total.toFixed(0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}