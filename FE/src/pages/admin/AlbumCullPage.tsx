// Bước 1.6 — gắn kết quả culling vào UI CHÍNH: bước tiền-upload trong luồng Admin.
// PTG chọn thư mục ảnh gốc trên máy, hệ thống phân tích (độ nét/mắt/trùng lặp — Bước
// 1.3-1.5, chạy trong Web Worker để không chặn UI), hiển thị lưới ảnh có nhãn xanh/vàng/đỏ,
// PTG duyệt nhanh bằng phím tắt để chọn giữ/loại, rồi đưa danh sách "giữ" sang upload thật.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import {
  FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE,
  isFileSystemAccessSupported,
  pickLocalPhotoFolder,
  type LocalFolderScanResult,
  type LocalPhotoFile,
} from "../../lib/localFolderImport";
import type {
  CullingTestItem,
  CullingTestProgress,
} from "../../lib/culling/cullingPipeline";
import { runCullingTestInWorker } from "../../lib/culling/cullingWorkerClient";
import { classifyCullingFlag, type CullingFlag } from "../../lib/culling/cullingFlag";
import { groupScenesAndBursts } from "../../lib/culling/sceneGrouping";
import { pickBestInGroup } from "../../lib/culling/burstRepresentative";
import { cropFaceFromFile } from "../../lib/culling/faceCrop";
import {
  copyKeptPairsToNewFolder,
  deleteRejectedPairsFromOriginal,
  type LocalPhotoActionPair,
} from "../../lib/localFileActions";
import type { UploadQueueItem } from "../../components/PhotoUploadPanel";
import type { Album } from "../../lib/types";
import type { EyeStatus } from "../../lib/culling/types";

type Decision = "keep" | "reject" | "undecided";

// Bước 1.9 — trạng thái của hành động copy/xoá file cục bộ đang chạy (nếu có).
type LocalActionKind = "copy" | "delete";
type LocalActionState =
  | { kind: "idle" }
  | { kind: "running"; action: LocalActionKind; done: number; total: number }
  | { kind: "done"; action: LocalActionKind; message: string }
  | { kind: "error"; action: LocalActionKind; message: string };

const EYE_LABEL: Record<EyeStatus, string> = {
  open: "Mở",
  squint: "Nheo",
  closed: "Nhắm",
  no_face: "Không có mặt",
};
type ViewMode = "flat" | "scenes";

interface BurstGroup {
  burstId: number;
  items: CullingTestItem[];
  representative: CullingTestItem;
}

interface SceneGroup {
  sceneId: number;
  items: CullingTestItem[];
  bursts: BurstGroup[];
  startMs: number;
  endMs: number;
}

function formatTimeRange(startMs: number, endMs: number): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return startMs === endMs ? fmt(startMs) : `${fmt(startMs)}–${fmt(endMs)}`;
}

const FLAG_LABEL: Record<CullingFlag, string> = {
  green: "Nét, mắt mở",
  yellow: "Cần xem lại",
  red: "Mờ hoặc nhắm mắt",
};

const FLAG_RING: Record<CullingFlag, string> = {
  green: "ring-emerald-500",
  yellow: "ring-amber-500",
  red: "ring-red-500",
};

const FLAG_BADGE: Record<CullingFlag, string> = {
  green: "bg-emerald-100 text-emerald-700",
  yellow: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
};

const DECISION_BADGE: Record<Decision, string> = {
  keep: "bg-emerald-600 text-white",
  reject: "bg-red-600 text-white",
  undecided: "bg-slate-200 text-slate-600",
};

const DECISION_LABEL: Record<Decision, string> = {
  keep: "Giữ",
  reject: "Loại",
  undecided: "?",
};

export default function AlbumCullPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const supported = isFileSystemAccessSupported();

  const [album, setAlbum] = useState<Album | null>(null);

  const [scanResult, setScanResult] = useState<LocalFolderScanResult | null>(
    null
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<CullingTestProgress | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const [items, setItems] = useState<CullingTestItem[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const thumbnailUrlsRef = useRef<string[]>([]);

  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [autoSkipFlagged, setAutoSkipFlagged] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("scenes");
  const [expandedBursts, setExpandedBursts] = useState<Set<number>>(
    new Set()
  );

  useEffect(() => {
    if (!albumId) return;
    api
      .get<{ album: Album }>(`/api/albums/${albumId}`)
      .then(({ data }) => setAlbum(data.album))
      .catch(() => {
        // Không chặn trang duyệt nếu riêng tên album lỗi tải.
      });
  }, [albumId]);

  useEffect(() => {
    return () => {
      thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  async function handlePickFolder() {
    setScanError(null);
    setIsScanning(true);
    setScanResult(null);
    setItems([]);
    setDecisions({});
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

  function handleItem(item: CullingTestItem) {
    const path = item.file.relativePath;
    const url = URL.createObjectURL(item.file.file);
    thumbnailUrlsRef.current.push(url);
    setThumbnails((prev) => ({ ...prev, [path]: url }));
    setItems((prev) => [...prev, item]);

    const flag = classifyCullingFlag(item.metrics);
    setDecisions((prev) => ({
      ...prev,
      [path]: flag === "red" ? "reject" : flag === "green" ? "keep" : "undecided",
    }));
  }

  async function handleAnalyze() {
    if (!scanResult) return;
    const jpgFiles = scanResult.files.filter((f) => f.kind === "jpg");
    if (jpgFiles.length === 0) {
      setRunError("Thư mục không có file JPG nào để phân tích.");
      return;
    }

    setRunError(null);
    setIsRunning(true);
    setProgress(null);
    setItems([]);
    setDecisions({});

    const { promise, abort } = runCullingTestInWorker(jpgFiles, {
      onProgress: setProgress,
      onItem: handleItem,
    });
    abortRef.current = abort;

    try {
      await promise;
    } catch (err) {
      setRunError(
        err instanceof Error ? err.message : "Lỗi không xác định khi phân tích ảnh"
      );
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }

  function handleStopAnalyze() {
    abortRef.current?.();
  }

  const counts = useMemo(() => {
    let keep = 0;
    let reject = 0;
    let undecided = 0;
    for (const item of items) {
      const d = decisions[item.file.relativePath] ?? "undecided";
      if (d === "keep") keep += 1;
      else if (d === "reject") reject += 1;
      else undecided += 1;
    }
    return { keep, reject, undecided, total: items.length };
  }, [items, decisions]);

  const pathToIndex = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, index) => map.set(item.file.relativePath, index));
    return map;
  }, [items]);

  // Bước 1.9 — ghép mỗi ảnh JPG đã duyệt với file RAW cùng cặp (nếu có, theo kết quả ghép
  // cặp ở Bước 1.2) để hành động copy/xoá áp dụng trên cả cặp RAW+JPG, không chỉ riêng JPG.
  const jpgPathToRaw = useMemo(() => {
    const map = new Map<string, LocalPhotoFile>();
    if (!scanResult) return map;
    for (const pair of scanResult.pairing.pairs) {
      map.set(pair.jpg.relativePath, pair.raw);
    }
    return map;
  }, [scanResult]);

  const { keptPairs, rejectedPairs } = useMemo(() => {
    const kept: LocalPhotoActionPair[] = [];
    const rejected: LocalPhotoActionPair[] = [];
    for (const item of items) {
      const path = item.file.relativePath;
      const decision = decisions[path] ?? "undecided";
      const pair: LocalPhotoActionPair = {
        jpg: item.file,
        raw: jpgPathToRaw.get(path) ?? null,
      };
      if (decision === "keep") kept.push(pair);
      else if (decision === "reject") rejected.push(pair);
    }
    return { keptPairs: kept, rejectedPairs: rejected };
  }, [items, decisions, jpgPathToRaw]);

  const [localAction, setLocalAction] = useState<LocalActionState>({
    kind: "idle",
  });

  async function handleCopyKept() {
    if (keptPairs.length === 0) return;
    setLocalAction({
      kind: "running",
      action: "copy",
      done: 0,
      total: keptPairs.length,
    });
    try {
      const result = await copyKeptPairsToNewFolder(keptPairs, (p) =>
        setLocalAction({
          kind: "running",
          action: "copy",
          done: p.copiedFiles,
          total: p.totalFiles,
        })
      );
      if (result) {
        setLocalAction({
          kind: "done",
          action: "copy",
          message: `Đã sao chép ${result.copiedFiles} file sang thư mục "${result.folderName}".`,
        });
      } else {
        setLocalAction({ kind: "idle" });
      }
    } catch (err) {
      setLocalAction({
        kind: "error",
        action: "copy",
        message: err instanceof Error ? err.message : "Sao chép thất bại",
      });
    }
  }

  async function handleDeleteRejected() {
    if (!scanResult || rejectedPairs.length === 0) return;
    const fileCount = rejectedPairs.reduce(
      (sum, p) => sum + 1 + (p.raw ? 1 : 0),
      0
    );
    const confirmed = window.confirm(
      `Xoá vĩnh viễn ${fileCount} file (RAW+JPG) đã bị loại khỏi thư mục gốc trên máy?\n\n` +
        `Hành động này KHÔNG THỂ HOÀN TÁC.`
    );
    if (!confirmed) return;

    setLocalAction({
      kind: "running",
      action: "delete",
      done: 0,
      total: rejectedPairs.length,
    });
    try {
      const result = await deleteRejectedPairsFromOriginal(
        scanResult.rootHandle,
        rejectedPairs,
        (p) =>
          setLocalAction({
            kind: "running",
            action: "delete",
            done: p.deletedFiles,
            total: p.totalFiles,
          })
      );
      setLocalAction({
        kind: "done",
        action: "delete",
        message: `Đã xoá ${result.deletedFiles} file khỏi thư mục gốc.`,
      });
    } catch (err) {
      setLocalAction({
        kind: "error",
        action: "delete",
        message: err instanceof Error ? err.message : "Xoá thất bại",
      });
    }
  }

  // Bước 1.7 — gom scene (buổi chụp) theo thời gian EXIF + đổi khung hình lớn, và burst
  // (loạt ảnh liên tiếp giống nhau) theo dHash, để hiển thị "Theo buổi chụp".
  const scenes = useMemo<SceneGroup[]>(() => {
    if (items.length === 0) return [];
    const grouping = groupScenesAndBursts(
      items.map((item) => ({
        id: item.file.relativePath,
        timestampMs:
          item.sceneSignals.capturedAtMs ?? item.file.file.lastModified,
        histogram: item.sceneSignals.histogram,
        hash: item.metrics.hash,
      }))
    );
    const byPath = new Map(items.map((item) => [item.file.relativePath, item]));

    const sceneItemsById = new Map<number, CullingTestItem[]>();
    for (const path of grouping.order) {
      const item = byPath.get(path);
      const sceneId = grouping.sceneId.get(path);
      if (!item || sceneId === undefined) continue;
      if (!sceneItemsById.has(sceneId)) sceneItemsById.set(sceneId, []);
      sceneItemsById.get(sceneId)!.push(item);
    }

    return Array.from(sceneItemsById.entries()).map(([sceneId, sceneItems]) => {
      const burstItemsById = new Map<number, CullingTestItem[]>();
      for (const item of sceneItems) {
        const burstId = grouping.burstId.get(item.file.relativePath);
        if (burstId === undefined) continue;
        if (!burstItemsById.has(burstId)) burstItemsById.set(burstId, []);
        burstItemsById.get(burstId)!.push(item);
      }
      const bursts: BurstGroup[] = Array.from(burstItemsById.entries()).map(
        ([burstId, burstItems]) => ({
          burstId,
          items: burstItems,
          representative: pickBestInGroup(burstItems, (it) => it.metrics)!,
        })
      );
      const timestamps = sceneItems.map(
        (it) => it.sceneSignals.capturedAtMs ?? it.file.file.lastModified
      );
      return {
        sceneId,
        items: sceneItems,
        bursts,
        startMs: Math.min(...timestamps),
        endMs: Math.max(...timestamps),
      };
    });
  }, [items]);

  function toggleBurst(burstId: number) {
    setExpandedBursts((prev) => {
      const next = new Set(prev);
      if (next.has(burstId)) next.delete(burstId);
      else next.add(burstId);
      return next;
    });
  }

  function rejectRestOfBurst(burst: BurstGroup) {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const item of burst.items) {
        if (item !== burst.representative) {
          next[item.file.relativePath] = "reject";
        }
      }
      return next;
    });
  }

  const moveTo = useCallback(
    (startIndex: number, direction: 1 | -1) => {
      let idx = startIndex;
      while (idx >= 0 && idx < items.length) {
        const path = items[idx].file.relativePath;
        const decision = decisions[path] ?? "undecided";
        if (!autoSkipFlagged || decision !== "reject") {
          setReviewIndex(idx);
          return;
        }
        idx += direction;
      }
      // Không còn ảnh hợp lệ theo hướng này (đã hết hoặc toàn bộ còn lại đều bị loại) — giữ nguyên vị trí.
    },
    [items, decisions, autoSkipFlagged]
  );

  function decideCurrent(decision: "keep" | "reject") {
    if (reviewIndex === null) return;
    const path = items[reviewIndex].file.relativePath;
    setDecisions((prev) => ({ ...prev, [path]: decision }));
    moveTo(reviewIndex + 1, 1);
  }

  useEffect(() => {
    if (reviewIndex === null) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (reviewIndex === null) return;
      switch (e.key) {
        case "ArrowRight":
        case "d":
        case "D":
          e.preventDefault();
          moveTo(reviewIndex + 1, 1);
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          e.preventDefault();
          moveTo(reviewIndex - 1, -1);
          break;
        case "Enter":
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          decideCurrent("keep");
          break;
        case "x":
        case "X":
        case "Backspace":
          e.preventDefault();
          decideCurrent("reject");
          break;
        case "s":
        case "S":
          e.preventDefault();
          setAutoSkipFlagged((prev) => !prev);
          break;
        case "Escape":
          e.preventDefault();
          setReviewIndex(null);
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewIndex, moveTo]);

  // Bước 2.3 (nền) — trước khi điều hướng sang upload, materialize scenes/burst_clusters đã
  // gom ở Bước 1.7 (hiện chỉ là id tạm trong state của trang này) thành row thật trên BE, để
  // mỗi ảnh "giữ" upload kèm đúng scene_id/burst_cluster_id/is_best_in_cluster — cho phép
  // Client Portal nhận diện ảnh cùng cụm (công cụ so sánh song song, Bước 2.3).
  async function handleContinueToUpload() {
    const sceneIdMap = new Map<number, string>();
    const burstIdMap = new Map<number, string>();

    try {
      if (albumId && scenes.length > 0) {
        const { data: sceneRes } = await api.post<{
          scenes: { id: string }[];
        }>(`/api/albums/${albumId}/scenes`, {
          scenes: scenes.map((scene) => ({
            started_at: new Date(scene.startMs).toISOString(),
            ended_at: new Date(scene.endMs).toISOString(),
            sort_order: scene.sceneId,
          })),
        });
        scenes.forEach((scene, index) => {
          sceneIdMap.set(scene.sceneId, sceneRes.scenes[index].id);
        });

        const burstEntries = scenes.flatMap((scene) =>
          scene.bursts.map((burst) => ({
            localSceneId: scene.sceneId,
            localBurstId: burst.burstId,
          }))
        );
        if (burstEntries.length > 0) {
          const { data: burstRes } = await api.post<{
            clusters: { id: string }[];
          }>(`/api/albums/${albumId}/burst-clusters`, {
            clusters: burstEntries.map((entry) => ({
              scene_id: sceneIdMap.get(entry.localSceneId) ?? null,
            })),
          });
          burstEntries.forEach((entry, index) => {
            burstIdMap.set(entry.localBurstId, burstRes.clusters[index].id);
          });
        }
      }
    } catch (err) {
      // Không chặn upload nếu riêng bước lưu scene/burst lỗi — ảnh vẫn upload bình thường,
      // chỉ là Client Portal sẽ không gom được nhóm "ảnh giống nhau" cho công cụ so sánh.
      console.error("Không lưu được scene/burst cluster:", err);
    }

    const groupingByPath = new Map<
      string,
      { localSceneId: number; localBurstId: number; isBest: boolean }
    >();
    for (const scene of scenes) {
      for (const burst of scene.bursts) {
        for (const item of burst.items) {
          groupingByPath.set(item.file.relativePath, {
            localSceneId: scene.sceneId,
            localBurstId: burst.burstId,
            isBest: item === burst.representative,
          });
        }
      }
    }

    const keptUploadItems: UploadQueueItem[] = items
      .filter((item) => (decisions[item.file.relativePath] ?? "undecided") === "keep")
      .map((item) => {
        const grouping = groupingByPath.get(item.file.relativePath);
        return {
          file: item.file.file,
          sceneId: grouping ? sceneIdMap.get(grouping.localSceneId) : undefined,
          burstClusterId: grouping ? burstIdMap.get(grouping.localBurstId) : undefined,
          isBestInCluster: grouping?.isBest ?? false,
        };
      });

    navigate(`/admin/albums/${albumId}`, { state: { keptUploadItems } });
  }

  function renderPhotoCard(
    item: CullingTestItem,
    opts: { isRepresentative?: boolean } = {}
  ) {
    const path = item.file.relativePath;
    const index = pathToIndex.get(path);
    const flag = classifyCullingFlag(item.metrics);
    const decision = decisions[path] ?? "undecided";
    return (
      <button
        key={path}
        type="button"
        onClick={() => index !== undefined && setReviewIndex(index)}
        className={`group relative overflow-hidden rounded-lg ring-2 ${FLAG_RING[flag]}`}
      >
        {thumbnails[path] && (
          <img
            src={thumbnails[path]}
            alt={path}
            loading="lazy"
            className="aspect-square w-full object-cover"
          />
        )}
        {opts.isRepresentative && (
          <span className="absolute left-1 top-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-xs font-medium text-white">
            ★ Đại diện
          </span>
        )}
        <span
          className={`absolute right-1 top-1 rounded px-1.5 py-0.5 text-xs font-medium ${DECISION_BADGE[decision]}`}
        >
          {DECISION_LABEL[decision]}
        </span>
        <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-1 text-left text-xs text-white">
          {item.file.file.name}
        </span>
      </button>
    );
  }

  const currentItem = reviewIndex !== null ? items[reviewIndex] : null;

  // Bước 1.8 — Close-up Panel: crop riêng từng khuôn mặt cho ảnh nhóm đông người (>1 mặt),
  // chỉ khi đang xem ảnh đó (không crop trước hàng loạt), huỷ URL cũ khi đổi ảnh/rời trang.
  const [faceCrops, setFaceCrops] = useState<string[]>([]);
  useEffect(() => {
    if (!currentItem || currentItem.metrics.faces.length <= 1) {
      setFaceCrops([]);
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    Promise.all(
      currentItem.metrics.faces.map((face) =>
        cropFaceFromFile(currentItem.file.file, face.box)
      )
    ).then((results) => {
      if (cancelled) return;
      urls.push(...results);
      setFaceCrops(results);
    });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [currentItem]);

  if (!supported) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE}
        </div>
        <Link
          to={`/admin/albums/${albumId}`}
          className="mt-3 inline-block text-sm text-slate-500 hover:text-slate-700"
        >
          ← Quay lại album
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          Duyệt & lọc ảnh {album ? `— ${album.name}` : ""}
        </h1>
        <Link
          to={`/admin/albums/${albumId}`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Quay lại album
        </Link>
      </div>

      {!scanResult && (
        <div className="mt-6">
          <button
            type="button"
            onClick={handlePickFolder}
            disabled={isScanning}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isScanning ? "Đang quét..." : "Chọn thư mục ảnh gốc trên máy"}
          </button>
          {scanError && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {scanError}
            </p>
          )}
        </div>
      )}

      {scanResult && items.length === 0 && !isRunning && (
        <div className="mt-6 flex items-center gap-3">
          <span className="text-sm text-slate-600">
            "{scanResult.folderName}":{" "}
            {scanResult.files.filter((f) => f.kind === "jpg").length} ảnh JPG
            tìm thấy
          </span>
          <button
            type="button"
            onClick={handleAnalyze}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Bắt đầu phân tích
          </button>
          <button
            type="button"
            onClick={handlePickFolder}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Chọn thư mục khác
          </button>
        </div>
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
              Đang phân tích {progress.processed}/{progress.total}:{" "}
              {progress.currentFileName}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-slate-500">
                {progress.imagesPerSecond.toFixed(2)} ảnh/giây
              </span>
              <button
                type="button"
                onClick={handleStopAnalyze}
                className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Dừng
              </button>
            </div>
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

      {items.length > 0 && (
        <>
          <div className="mt-4 flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("flat")}
              className={`rounded-md border px-2 py-1 ${
                viewMode === "flat"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Lưới phẳng
            </button>
            <button
              type="button"
              onClick={() => setViewMode("scenes")}
              className={`rounded-md border px-2 py-1 ${
                viewMode === "scenes"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Theo buổi chụp ({scenes.length})
            </button>
          </div>

          {viewMode === "flat" ? (
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {items.map((item) => renderPhotoCard(item))}
            </div>
          ) : (
            <div className="mt-3 space-y-8">
              {scenes.map((scene) => (
                <div key={scene.sceneId}>
                  <h3 className="text-sm font-semibold text-slate-700">
                    Buổi {scene.sceneId + 1} —{" "}
                    {formatTimeRange(scene.startMs, scene.endMs)} (
                    {scene.items.length} ảnh)
                  </h3>
                  <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {scene.bursts.map((burst) => {
                      if (burst.items.length === 1) {
                        return renderPhotoCard(burst.items[0]);
                      }
                      const isExpanded = expandedBursts.has(burst.burstId);
                      if (!isExpanded) {
                        return (
                          <div key={`burst-${burst.burstId}`} className="relative">
                            {renderPhotoCard(burst.representative, {
                              isRepresentative: true,
                            })}
                            <button
                              type="button"
                              onClick={() => toggleBurst(burst.burstId)}
                              className="absolute bottom-7 left-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-xs font-medium text-white"
                            >
                              +{burst.items.length - 1} ảnh giống
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={`burst-${burst.burstId}`}
                          className="col-span-full rounded-lg border border-slate-200 p-2"
                        >
                          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                            {burst.items.map((it) =>
                              renderPhotoCard(it, {
                                isRepresentative: it === burst.representative,
                              })
                            )}
                          </div>
                          <div className="mt-2 flex items-center gap-3 text-xs">
                            <button
                              type="button"
                              onClick={() => toggleBurst(burst.burstId)}
                              className="text-slate-500 hover:text-slate-700"
                            >
                              Thu gọn loạt này
                            </button>
                            <button
                              type="button"
                              onClick={() => rejectRestOfBurst(burst)}
                              className="text-red-600 hover:text-red-700"
                            >
                              Loại {burst.items.length - 1} ảnh còn lại (giữ
                              đại diện ★)
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 rounded-md border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Hành động cuối trên file gốc trên máy (tuỳ chọn)
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Áp dụng cho cả cặp RAW+JPG theo quyết định giữ/loại ở trên. Có
              thể bỏ qua và bấm thẳng "Tiếp tục upload" bên dưới nếu không cần
              đụng tới thư mục gốc.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCopyKept}
                disabled={
                  keptPairs.length === 0 || localAction.kind === "running"
                }
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Sao chép {keptPairs.length} cặp ảnh "giữ" sang thư mục mới
              </button>
              <button
                type="button"
                onClick={handleDeleteRejected}
                disabled={
                  rejectedPairs.length === 0 || localAction.kind === "running"
                }
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Xoá {rejectedPairs.length} cặp ảnh "loại" khỏi thư mục gốc
              </button>
            </div>

            {localAction.kind === "running" && (
              <p className="mt-3 text-sm text-slate-600">
                {localAction.action === "copy" ? "Đang sao chép" : "Đang xoá"}{" "}
                {localAction.done}/{localAction.total} file...
              </p>
            )}
            {localAction.kind === "done" && (
              <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {localAction.message}
              </p>
            )}
            {localAction.kind === "error" && (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {localAction.message}
              </p>
            )}
          </div>

          <div className="sticky bottom-0 mt-6 flex items-center justify-between rounded-md border border-slate-200 bg-white/95 px-4 py-3 text-sm shadow-md backdrop-blur">
            <span className="text-slate-600">
              {counts.total} ảnh · Giữ {counts.keep} · Loại {counts.reject} ·
              Chưa quyết {counts.undecided}
            </span>
            <button
              type="button"
              onClick={handleContinueToUpload}
              disabled={counts.keep === 0}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Tiếp tục upload {counts.keep} ảnh đã giữ
            </button>
          </div>
        </>
      )}

      {currentItem && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-200">
            <button
              type="button"
              onClick={() => setReviewIndex(null)}
              className="hover:text-white"
            >
              ← Quay lại lưới (Esc)
            </button>
            <span>
              {reviewIndex! + 1} / {items.length}
              {isRunning && " (đang phân tích thêm...)"}
            </span>
            <button
              type="button"
              onClick={() => setAutoSkipFlagged((prev) => !prev)}
              className={`rounded-md border px-2 py-1 text-xs ${
                autoSkipFlagged
                  ? "border-emerald-400 text-emerald-300"
                  : "border-slate-500 text-slate-300"
              }`}
            >
              Tự động bỏ qua ảnh loại (S):{" "}
              {autoSkipFlagged ? "Bật" : "Tắt"}
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-hidden px-4">
            <img
              src={thumbnails[currentItem.file.relativePath]}
              alt={currentItem.file.file.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <div className="px-4 py-3 text-center text-sm text-slate-300">
            <p className="truncate">{currentItem.file.file.name}</p>
            <p className="mt-1">
              <span
                className={`rounded px-1.5 py-0.5 ${
                  FLAG_BADGE[classifyCullingFlag(currentItem.metrics)]
                }`}
              >
                {currentItem.metrics.sharpnessScore.toFixed(0)} điểm nét ·{" "}
                {FLAG_LABEL[classifyCullingFlag(currentItem.metrics)]}
              </span>
              <span className="ml-2 text-slate-400">
                Mắt: {EYE_LABEL[currentItem.metrics.eyeStatus]}
                {currentItem.metrics.faceCount > 1 &&
                  ` · ${currentItem.metrics.faceCount} khuôn mặt`}
              </span>
            </p>
          </div>

          {faceCrops.length > 1 && (
            <div className="border-t border-white/10 px-4 py-3">
              <p className="mb-2 text-center text-xs text-slate-400">
                Close-up từng khuôn mặt ({faceCrops.length})
              </p>
              <div className="flex justify-center gap-3 overflow-x-auto">
                {currentItem.metrics.faces.map((face, index) => (
                  <div key={index} className="shrink-0 text-center">
                    {faceCrops[index] && (
                      <img
                        src={faceCrops[index]}
                        alt={`Khuôn mặt ${index + 1}`}
                        className={`h-20 w-20 rounded-lg object-cover ring-2 ${
                          face.eyeStatus === "closed"
                            ? "ring-red-500"
                            : face.eyeStatus === "squint"
                              ? "ring-amber-500"
                              : "ring-emerald-500"
                        }`}
                      />
                    )}
                    <p className="mt-1 text-xs text-slate-400">
                      {EYE_LABEL[face.eyeStatus]}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-3 px-4 pb-6">
            <button
              type="button"
              onClick={() => moveTo(reviewIndex! - 1, -1)}
              className="rounded-md border border-slate-500 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
            >
              ← Trước (←/A)
            </button>
            <button
              type="button"
              onClick={() => decideCurrent("reject")}
              className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Loại (X)
            </button>
            <button
              type="button"
              onClick={() => decideCurrent("keep")}
              className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Giữ (K/Space)
            </button>
            <button
              type="button"
              onClick={() => moveTo(reviewIndex! + 1, 1)}
              className="rounded-md border border-slate-500 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
            >
              Sau (→/D)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}