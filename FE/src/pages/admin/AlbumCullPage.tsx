// Bước 1.6 — gắn kết quả culling vào UI CHÍNH: bước tiền-upload trong luồng Admin.
// PTG chọn thư mục ảnh gốc trên máy, hệ thống phân tích (độ nét/mắt/trùng lặp — Bước
// 1.3-1.5, chạy trong Web Worker để không chặn UI), hiển thị lưới ảnh có nhãn xanh/vàng/đỏ,
// PTG duyệt nhanh bằng phím tắt để chọn giữ/loại, rồi đưa danh sách "giữ" sang upload thật.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent as ReactSyntheticEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
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

// Bước rate màu — quyết định của PTG giờ CHÍNH LÀ 1 trong 3 màu (trùng với CullingFlag của
// AI), không còn tách riêng "chưa quyết" nữa: mỗi ảnh luôn có 1 màu ngay từ lúc phân tích
// xong (khởi tạo = gợi ý AI), PTG ghi đè bằng phím tắt G/Y/R hoặc bấm nút. Xanh = giữ (sẽ
// upload), Đỏ = loại, Vàng = cần xem lại (giữ nguyên trên lưới, không tự upload/xoá).
type Decision = CullingFlag;

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

// Bước hiệu năng — đơn vị "hàng" để virtualize lưới ảnh: gom thẻ ảnh/header buổi chụp/khối
// burst mở rộng thành 1 danh sách phẳng theo view mode hiện tại (xem gridRows bên dưới),
// chỉ những hàng này mới được mount vào DOM khi nằm trong (hoặc gần) viewport.
type GridCard =
  | { kind: "item"; key: string; item: CullingTestItem }
  | { kind: "burstCollapsed"; key: string; burst: BurstGroup };

type GridRow =
  | { key: string; kind: "sceneHeader"; scene: SceneGroup }
  | { key: string; kind: "cards"; cards: GridCard[] }
  | { key: string; kind: "burstExpanded"; burst: BurstGroup };

const GRID_GAP_PX = 16;

function useGridColumnCount(containerWidth: number): number {
  if (containerWidth === 0) return 2;
  if (containerWidth < 640) return 2;
  if (containerWidth < 768) return 3;
  if (containerWidth < 1024) return 4;
  return 6;
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

const FLAG_DOT: Record<CullingFlag, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

const FLAG_BADGE: Record<CullingFlag, string> = {
  green: "bg-emerald-500/20 text-emerald-300",
  yellow: "bg-amber-500/20 text-amber-300",
  red: "bg-red-500/20 text-red-300",
};

const DECISION_BADGE: Record<Decision, string> = {
  green: "bg-emerald-600 text-white",
  yellow: "bg-amber-500 text-white",
  red: "bg-red-600 text-white",
};

const DECISION_LABEL: Record<Decision, string> = {
  green: "Giữ",
  yellow: "Xem lại",
  red: "Loại",
};

const DECISION_DOT: Record<Decision, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
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
  // Bước hiệu năng — 2 bản blob nhẹ hơn nhiều so với file gốc (thường 20-40MB): `thumbnails`
  // (~900px, cho ô lưới) và `previews` (~2000px, cho màn hình xem full-screen). File gốc chỉ
  // cần đụng tới khi thật sự upload (Bước 2.3).
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
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
    const thumbnailUrl = URL.createObjectURL(item.thumbnailBlob);
    const previewUrl = URL.createObjectURL(item.previewBlob);
    thumbnailUrlsRef.current.push(thumbnailUrl, previewUrl);
    setThumbnails((prev) => ({ ...prev, [path]: thumbnailUrl }));
    setPreviews((prev) => ({ ...prev, [path]: previewUrl }));
    setItems((prev) => [...prev, item]);

    // Khởi tạo màu rate = đúng gợi ý AI — PTG ghi đè sau bằng phím tắt/nút bấm.
    const flag = classifyCullingFlag(item.metrics);
    setDecisions((prev) => ({ ...prev, [path]: flag }));
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
    let review = 0;
    for (const item of items) {
      const d = decisions[item.file.relativePath] ?? "yellow";
      if (d === "green") keep += 1;
      else if (d === "red") reject += 1;
      else review += 1;
    }
    return { keep, reject, review, total: items.length };
  }, [items, decisions]);

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
      const decision = decisions[path] ?? "yellow";
      const pair: LocalPhotoActionPair = {
        jpg: item.file,
        raw: jpgPathToRaw.get(path) ?? null,
      };
      if (decision === "green") kept.push(pair);
      else if (decision === "red") rejected.push(pair);
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

  // Bug fix — thứ tự ảnh khi duyệt (mở/Trước/Sau trong review) phải khớp với thứ tự ĐANG
  // HIỂN THỊ trên lưới, không phải thứ tự `items` gốc (thứ tự worker xử lý xong từng ảnh —
  // có thể khác thứ tự thời gian chụp). Ở chế độ "Theo buổi chụp", lưới hiển thị theo
  // scene -> burst -> item (đã sắp theo thời gian trong `scenes` ở trên); ở "Lưới phẳng" thì
  // giữ nguyên thứ tự `items`. Trước đây review dùng thẳng `items`/`pathToIndex` theo thứ tự
  // gốc nên bấm vào 1 ảnh trong lưới "Theo buổi chụp" rồi bấm Tiếp/Trước sẽ nhảy sang ảnh
  // không liền kề trên màn hình.
  const displayOrderItems = useMemo<CullingTestItem[]>(() => {
    if (viewMode === "flat") return items;
    const result: CullingTestItem[] = [];
    for (const scene of scenes) {
      for (const burst of scene.bursts) {
        result.push(...burst.items);
      }
    }
    return result;
  }, [viewMode, items, scenes]);

  const pathToIndex = useMemo(() => {
    const map = new Map<string, number>();
    displayOrderItems.forEach((item, index) => map.set(item.file.relativePath, index));
    return map;
  }, [displayOrderItems]);

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
          next[item.file.relativePath] = "red";
        }
      }
      return next;
    });
  }

  const moveTo = useCallback(
    (startIndex: number, direction: 1 | -1) => {
      let idx = startIndex;
      while (idx >= 0 && idx < displayOrderItems.length) {
        const path = displayOrderItems[idx].file.relativePath;
        const decision = decisions[path] ?? "yellow";
        if (!autoSkipFlagged || decision !== "red") {
          setReviewIndex(idx);
          return;
        }
        idx += direction;
      }
      // Không còn ảnh hợp lệ theo hướng này (đã hết hoặc toàn bộ còn lại đều bị loại) — giữ nguyên vị trí.
    },
    [displayOrderItems, decisions, autoSkipFlagged]
  );

  function decideCurrent(decision: Decision) {
    if (reviewIndex === null) return;
    const path = displayOrderItems[reviewIndex].file.relativePath;
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
          decideCurrent("green");
          break;
        case "y":
        case "Y":
          e.preventDefault();
          decideCurrent("yellow");
          break;
        case "x":
        case "X":
        case "Backspace":
          e.preventDefault();
          decideCurrent("red");
          break;
        case "s":
        case "S":
          e.preventDefault();
          setAutoSkipFlagged((prev) => !prev);
          break;
        case "Escape":
          e.preventDefault();
          if (reviewZoomRef.current) {
            exitReviewZoom();
          } else {
            setReviewIndex(null);
          }
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
      .filter((item) => (decisions[item.file.relativePath] ?? "yellow") === "green")
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

  // Bước hiệu năng — đo bề rộng vùng lưới để tự tính số cột (thay Tailwind grid-cols-*
  // breakpoint) và bề rộng mỗi ô, dùng cho cả layout hàng (flex) lẫn ước lượng chiều cao
  // hàng khi virtualize. Dùng ref dạng callback (thay vì useRef + effect deps rỗng) vì div
  // này chỉ mount SAU KHI có ảnh đầu tiên (`items.length > 0`) — effect deps rỗng sẽ chạy
  // ngay lúc component mount, khi div đó còn chưa tồn tại, nên ResizeObserver không bao giờ
  // được gắn và bề rộng mãi mãi bằng 0 (mọi ô ảnh co về 0px, chỉ còn chấm cờ AI nổi lên).
  const [gridContainerNode, setGridContainerNode] = useState<HTMLDivElement | null>(null);
  const [gridContainerWidth, setGridContainerWidth] = useState(0);
  useEffect(() => {
    if (!gridContainerNode) return;
    const observer = new ResizeObserver((entries) => {
      setGridContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(gridContainerNode);
    return () => observer.disconnect();
  }, [gridContainerNode]);
  const columns = useGridColumnCount(gridContainerWidth);
  const itemSize =
    gridContainerWidth > 0
      ? (gridContainerWidth - GRID_GAP_PX * (columns - 1)) / columns
      : 0;
  const rowHeight = itemSize > 0 ? itemSize + GRID_GAP_PX : 160;

  // Bước hiệu năng — gom thẻ ảnh thành các hàng cố định `columns` ô/hàng (lưới phẳng), hoặc
  // xen kẽ header buổi chụp + khối burst mở rộng (theo buổi chụp), để virtualize theo hàng
  // thay vì mount hết toàn bộ ảnh trong 1 lưới CSS như trước.
  const gridRows = useMemo<GridRow[]>(() => {
    if (columns <= 0) return [];

    function chunkCards(cards: GridCard[], keyPrefix: string): GridRow[] {
      const rows: GridRow[] = [];
      for (let i = 0; i < cards.length; i += columns) {
        rows.push({
          key: `${keyPrefix}-${i}`,
          kind: "cards",
          cards: cards.slice(i, i + columns),
        });
      }
      return rows;
    }

    if (viewMode === "flat") {
      const cards: GridCard[] = items.map((item) => ({
        kind: "item",
        key: item.file.relativePath,
        item,
      }));
      return chunkCards(cards, "flat");
    }

    const rows: GridRow[] = [];
    for (const scene of scenes) {
      rows.push({ key: `scene-${scene.sceneId}`, kind: "sceneHeader", scene });
      let pending: GridCard[] = [];
      let flushCount = 0;
      const flushPending = () => {
        if (pending.length === 0) return;
        rows.push(
          ...chunkCards(pending, `scene-${scene.sceneId}-${flushCount}`)
        );
        flushCount += 1;
        pending = [];
      };
      for (const burst of scene.bursts) {
        if (burst.items.length === 1) {
          pending.push({
            kind: "item",
            key: burst.items[0].file.relativePath,
            item: burst.items[0],
          });
          continue;
        }
        if (!expandedBursts.has(burst.burstId)) {
          pending.push({
            kind: "burstCollapsed",
            key: `burst-${burst.burstId}`,
            burst,
          });
          continue;
        }
        flushPending();
        rows.push({
          key: `burst-expanded-${burst.burstId}`,
          kind: "burstExpanded",
          burst,
        });
      }
      flushPending();
    }
    return rows;
  }, [viewMode, items, scenes, expandedBursts, columns]);

  const rowVirtualizer = useWindowVirtualizer({
    count: gridRows.length,
    estimateSize: (index) => {
      const row = gridRows[index];
      if (!row) return rowHeight;
      if (row.kind === "sceneHeader") return 44;
      if (row.kind === "burstExpanded") {
        return (
          rowHeight * Math.ceil(row.burst.items.length / columns) + 56
        );
      }
      return rowHeight;
    },
    overscan: 3,
  });

  function renderPhotoCard(
    item: CullingTestItem,
    opts: { isRepresentative?: boolean } = {}
  ) {
    const path = item.file.relativePath;
    const index = pathToIndex.get(path);
    const flag = classifyCullingFlag(item.metrics);
    const decision = decisions[path] ?? "yellow";
    // Chỉ hiện chấm gợi ý AI (góc trái) khi PTG đã ghi đè khác với gợi ý ban đầu — tránh lặp
    // lại cùng 1 màu 2 lần ở đa số ảnh (đa số ảnh chưa đổi thì màu rate = đúng gợi ý AI rồi).
    const overridden = decision !== flag;
    return (
      <button
        type="button"
        onClick={() => index !== undefined && setReviewIndex(index)}
        className="group relative block w-full overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-800 transition-transform hover:z-10 hover:scale-[1.03] hover:ring-neutral-600"
      >
        {thumbnails[path] && (
          <img
            src={thumbnails[path]}
            alt={path}
            loading="lazy"
            decoding="async"
            className="aspect-square w-full object-cover"
          />
        )}
        {overridden && (
          <span
            title={`AI gợi ý: ${FLAG_LABEL[flag]}`}
            className={`absolute left-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-black/50 ${FLAG_DOT[flag]}`}
          />
        )}
        {opts.isRepresentative && (
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            ★ Đại diện
          </span>
        )}
        <span
          className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${DECISION_BADGE[decision]}`}
        >
          {DECISION_LABEL[decision]}
        </span>
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-left text-[11px] text-neutral-200 opacity-0 transition-opacity group-hover:opacity-100">
          {item.file.file.name}
        </span>
      </button>
    );
  }

  function renderGridCard(card: GridCard) {
    if (card.kind === "item") {
      return (
        <div key={card.key} className="shrink-0" style={{ width: itemSize || undefined }}>
          {renderPhotoCard(card.item)}
        </div>
      );
    }
    return (
      <div
        key={card.key}
        className="relative shrink-0"
        style={{ width: itemSize || undefined }}
      >
        {renderPhotoCard(card.burst.representative, { isRepresentative: true })}
        <button
          type="button"
          onClick={() => toggleBurst(card.burst.burstId)}
          className="absolute bottom-9 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/90"
        >
          +{card.burst.items.length - 1} ảnh giống
        </button>
      </div>
    );
  }

  const currentItem = reviewIndex !== null ? displayOrderItems[reviewIndex] : null;

  // Bước hiệu năng — chỉ đổi ảnh hiển thị SAU KHI đã decode xong bản preview mới (thay vì
  // đổi src ngay rồi để trình duyệt decode lúc paint), tránh khựng/giật khi chuyển ảnh
  // liên tục. Ảnh đang hiện giữ nguyên cho tới khi ảnh mới sẵn sàng, tạo cảm giác chuyển
  // mượt kiểu crossfade thay vì đổi khựng.
  const [readyPreviewSrc, setReadyPreviewSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!currentItem) return;
    const target = previews[currentItem.file.relativePath];
    if (!target) return;
    let cancelled = false;
    const img = new Image();
    img.src = target;
    const markReady = () => {
      if (!cancelled) setReadyPreviewSrc(target);
    };
    if (typeof img.decode === "function") {
      img.decode().then(markReady).catch(markReady);
    } else {
      img.onload = markReady;
    }
    return () => {
      cancelled = true;
    };
  }, [currentItem, previews]);

  // Bước hiệu năng — prefetch + decode trước bản preview của ảnh liền kề (trước/sau) để khi
  // người dùng bấm phím điều hướng, ảnh gần như đã sẵn sàng trong cache decode của trình
  // duyệt thay vì phải tải/giải mã lại từ đầu.
  useEffect(() => {
    if (reviewIndex === null) return;
    [reviewIndex - 1, reviewIndex + 1].forEach((idx) => {
      const neighbor = displayOrderItems[idx];
      if (!neighbor) return;
      const src = previews[neighbor.file.relativePath];
      if (!src) return;
      const img = new Image();
      img.src = src;
      img.decode?.().catch(() => {});
    });
  }, [reviewIndex, displayOrderItems, previews]);

  // Zoom kiểu Narrative Select — cuộn chuột/trackpad để phóng to mượt dần quanh đúng vị trí
  // con trỏ (không giật cấp tới thẳng 1 mức), kéo để pan khi đang zoom, nhấp đúp để nhảy
  // nhanh tới 100% thật (1 pixel ảnh gốc = 1 pixel màn hình) hoặc thoát zoom. Bản preview
  // (~2000px) không đủ chi tiết thật để soi nét — chỉ khi zoom mới tải file gốc qua object
  // URL (rẻ vì là file local, không phải tải mạng), huỷ ngay khi zoom ra/đổi ảnh.
  const REVIEW_MIN_SCALE = 1;
  const [reviewZoom, setReviewZoom] = useState<{
    scale: number;
    tx: number;
    ty: number;
  } | null>(null);
  const [zoomFullSrc, setZoomFullSrc] = useState<string | null>(null);
  const zoomFullSrcRef = useRef<string | null>(null);
  const reviewImageContainerRef = useRef<HTMLDivElement>(null);
  // Tỉ lệ zoom tương ứng đúng 100% thật (native), chỉ biết được sau khi ảnh gốc load xong.
  const maxScaleRef = useRef(REVIEW_MIN_SCALE);
  const pendingZoomAnchorRef = useRef<{
    rect: DOMRect;
    clickX: number;
    clickY: number;
    targetScale?: number;
  } | null>(null);
  const zoomDragRef = useRef<{
    startX: number;
    startY: number;
    originTx: number;
    originTy: number;
  } | null>(null);
  const [isZoomDragging, setIsZoomDragging] = useState(false);
  const reviewZoomRef = useRef<typeof reviewZoom>(null);
  useEffect(() => {
    reviewZoomRef.current = reviewZoom;
  }, [reviewZoom]);

  const exitReviewZoom = useCallback(() => {
    setReviewZoom(null);
    setZoomFullSrc(null);
    setIsZoomDragging(false);
    pendingZoomAnchorRef.current = null;
    zoomDragRef.current = null;
    maxScaleRef.current = REVIEW_MIN_SCALE;
    if (zoomFullSrcRef.current) {
      URL.revokeObjectURL(zoomFullSrcRef.current);
      zoomFullSrcRef.current = null;
    }
  }, []);

  // Đổi ảnh đang xem thì luôn thoát zoom — mỗi ảnh mới bắt đầu ở chế độ fit như cũ.
  useEffect(() => {
    exitReviewZoom();
  }, [currentItem, exitReviewZoom]);

  // Bắt đầu tải bản gốc + ghi lại điểm neo (vị trí con trỏ) để zoom quanh đúng điểm đó
  // ngay khi ảnh gốc load xong (handleZoomImageLoaded). targetScale bỏ trống = zoom tới
  // 100% thật (nhấp đúp); có giá trị = mức zoom vừa phải hơn (bắt đầu cuộn chuột để zoom).
  function beginZoom(clientX: number, clientY: number, targetScale?: number) {
    if (!currentItem || pendingZoomAnchorRef.current) return;
    const container = reviewImageContainerRef.current;
    if (!container) return;
    pendingZoomAnchorRef.current = {
      rect: container.getBoundingClientRect(),
      clickX: clientX,
      clickY: clientY,
      targetScale,
    };
    const url = URL.createObjectURL(currentItem.file.file);
    zoomFullSrcRef.current = url;
    setZoomFullSrc(url);
  }

  function handleReviewImageDoubleClick(e: ReactMouseEvent<HTMLImageElement>) {
    if (reviewZoom) {
      exitReviewZoom();
      return;
    }
    beginZoom(e.clientX, e.clientY);
  }

  function handleZoomImageLoaded(e: ReactSyntheticEvent<HTMLImageElement>) {
    const pending = pendingZoomAnchorRef.current;
    const container = reviewImageContainerRef.current;
    if (!pending || !container) return;
    pendingZoomAnchorRef.current = null;
    const img = e.currentTarget;
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    const { rect, clickX, clickY, targetScale } = pending;
    if (!naturalW || !naturalH || rect.width === 0 || rect.height === 0) return;
    // fitScale = tỉ lệ trình duyệt đang thu nhỏ ảnh gốc để vừa khung (object-contain).
    // 1/fitScale đưa ảnh về đúng 100% — 1 pixel ảnh gốc = 1 pixel màn hình.
    const fitScale = Math.min(rect.width / naturalW, rect.height / naturalH);
    if (!fitScale) return;
    maxScaleRef.current = 1 / fitScale;
    const scale = Math.min(targetScale ?? maxScaleRef.current, maxScaleRef.current);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clickX - centerX;
    const dy = clickY - centerY;
    // Dịch ảnh để đúng điểm vừa nhấp/cuộn đứng yên trên màn hình sau khi phóng to quanh tâm ảnh.
    setReviewZoom({ scale, tx: dx * (1 - scale), ty: dy * (1 - scale) });
  }

  // Cuộn chuột/trackpad để zoom mượt dần, luôn giữ đúng điểm dưới con trỏ đứng yên — giống
  // Photoshop/Lightroom thay vì nhảy cấp tới thẳng 1 mức như double-click.
  const WHEEL_ZOOM_SENSITIVITY = 0.0018;

  function handleReviewWheel(e: ReactWheelEvent<HTMLDivElement>) {
    if (!currentItem) return;
    if (!zoomFullSrc) {
      if (e.deltaY >= 0) return; // đang ở fit, cuộn ra thì không có gì để làm
      e.preventDefault();
      // Chưa biết maxScale (cần load ảnh gốc trước) — bắt đầu ở mức zoom vừa phải, sẽ tự
      // kẹp lại theo maxScale thật trong handleZoomImageLoaded nếu ảnh có độ phân giải thấp.
      beginZoom(e.clientX, e.clientY, 1.8);
      return;
    }
    e.preventDefault();
    const container = reviewImageContainerRef.current;
    if (!container) return;
    setReviewZoom((prev) => {
      if (!prev) return prev;
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      const nextScale = Math.min(
        Math.max(prev.scale * factor, REVIEW_MIN_SCALE),
        maxScaleRef.current
      );
      if (nextScale === prev.scale) return prev;
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      // Điểm đang nằm dưới con trỏ, tính theo transform HIỆN TẠI (trước khi đổi scale).
      const localX = (e.clientX - centerX - prev.tx) / prev.scale;
      const localY = (e.clientY - centerY - prev.ty) / prev.scale;
      return {
        scale: nextScale,
        tx: e.clientX - centerX - localX * nextScale,
        ty: e.clientY - centerY - localY * nextScale,
      };
    });
  }

  function handleZoomPointerDown(e: ReactPointerEvent<HTMLImageElement>) {
    if (!reviewZoom) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsZoomDragging(true);
    zoomDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originTx: reviewZoom.tx,
      originTy: reviewZoom.ty,
    };
  }

  function handleZoomPointerMove(e: ReactPointerEvent<HTMLImageElement>) {
    const drag = zoomDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setReviewZoom((prev) =>
      prev ? { ...prev, tx: drag.originTx + dx, ty: drag.originTy + dy } : prev
    );
  }

  function handleZoomPointerUp() {
    zoomDragRef.current = null;
    setIsZoomDragging(false);
  }

  // Filmstrip dưới màn hình review — tự cuộn ảnh đang xem vào giữa khung nhìn mỗi khi đổi.
  const activeThumbRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [reviewIndex]);

  // Bước 1.8 — Close-up Panel: crop riêng từng khuôn mặt cho ảnh nhóm đông người (>1 mặt),
  // chỉ khi đang xem ảnh đó (không crop trước hàng loạt), huỷ URL cũ khi đổi ảnh/rời trang.
  const [faceCrops, setFaceCrops] = useState<string[]>([]);
  // Bước hiệu năng — cache theo path để quay lại ảnh đã xem không phải decode/crop lại
  // file gốc lần nữa. URL được revoke chung 1 lần khi rời trang (cùng effect với
  // thumbnailUrlsRef bên trên), không revoke riêng lẻ để còn tái dùng được.
  const faceCropCacheRef = useRef<Map<string, string[]>>(new Map());
  useEffect(() => {
    if (!currentItem || currentItem.metrics.faces.length <= 1) {
      setFaceCrops([]);
      return;
    }
    const path = currentItem.file.relativePath;
    const cached = faceCropCacheRef.current.get(path);
    if (cached) {
      setFaceCrops(cached);
      return;
    }
    let cancelled = false;
    Promise.all(
      currentItem.metrics.faces.map((face) =>
        cropFaceFromFile(currentItem.file.file, face.box)
      )
    ).then((results) => {
      if (cancelled) return;
      faceCropCacheRef.current.set(path, results);
      thumbnailUrlsRef.current.push(...results);
      setFaceCrops(results);
    });
    return () => {
      cancelled = true;
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
        <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("flat")}
              className={`rounded-full border px-3 py-1 ${
                viewMode === "flat"
                  ? "border-white bg-white text-neutral-900"
                  : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              Lưới phẳng
            </button>
            <button
              type="button"
              onClick={() => setViewMode("scenes")}
              className={`rounded-full border px-3 py-1 ${
                viewMode === "scenes"
                  ? "border-white bg-white text-neutral-900"
                  : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              Theo buổi chụp ({scenes.length})
            </button>
          </div>

          <div
            ref={setGridContainerNode}
            className="relative mt-3"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = gridRows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={row.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.kind === "sceneHeader" && (
                    <h3 className="pb-2 pt-4 text-sm font-semibold text-neutral-300 first:pt-0">
                      Buổi {row.scene.sceneId + 1} —{" "}
                      {formatTimeRange(row.scene.startMs, row.scene.endMs)} (
                      {row.scene.items.length} ảnh)
                    </h3>
                  )}
                  {row.kind === "cards" && (
                    <div className="flex gap-4 pb-4">
                      {row.cards.map((card) => renderGridCard(card))}
                    </div>
                  )}
                  {row.kind === "burstExpanded" && (
                    <div className="mb-4 rounded-lg border border-neutral-800 p-3">
                      <div className="flex flex-wrap gap-4">
                        {row.burst.items.map((it) => (
                          <div
                            key={it.file.relativePath}
                            className="shrink-0"
                            style={{ width: itemSize || undefined }}
                          >
                            {renderPhotoCard(it, {
                              isRepresentative: it === row.burst.representative,
                            })}
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => toggleBurst(row.burst.burstId)}
                          className="text-neutral-400 hover:text-neutral-200"
                        >
                          Thu gọn loạt này
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectRestOfBurst(row.burst)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Loại {row.burst.items.length - 1} ảnh còn lại (giữ
                          đại diện ★)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-6 rounded-md border border-neutral-800 bg-neutral-900 p-4">
            <h3 className="text-sm font-semibold text-neutral-100">
              Hành động cuối trên file gốc trên máy (tuỳ chọn)
            </h3>
            <p className="mt-1 text-xs text-neutral-400">
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
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
              >
                Sao chép {keptPairs.length} cặp ảnh "giữ" sang thư mục mới
              </button>
              <button
                type="button"
                onClick={handleDeleteRejected}
                disabled={
                  rejectedPairs.length === 0 || localAction.kind === "running"
                }
                className="rounded-md border border-red-900 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-950 disabled:opacity-50"
              >
                Xoá {rejectedPairs.length} cặp ảnh "loại" khỏi thư mục gốc
              </button>
            </div>

            {localAction.kind === "running" && (
              <p className="mt-3 text-sm text-neutral-400">
                {localAction.action === "copy" ? "Đang sao chép" : "Đang xoá"}{" "}
                {localAction.done}/{localAction.total} file...
              </p>
            )}
            {localAction.kind === "done" && (
              <p className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                {localAction.message}
              </p>
            )}
            {localAction.kind === "error" && (
              <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {localAction.message}
              </p>
            )}
          </div>

          <div className="sticky bottom-0 mt-6 flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/95 px-4 py-3 text-sm shadow-md backdrop-blur">
            <span className="text-neutral-300">
              {counts.total} ảnh · Giữ {counts.keep} · Xem lại {counts.review} ·
              Loại {counts.reject}
            </span>
            <button
              type="button"
              onClick={handleContinueToUpload}
              disabled={counts.keep === 0}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
            >
              Tiếp tục upload {counts.keep} ảnh đã giữ
            </button>
          </div>
        </div>
      )}

      {currentItem && (
        <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
          <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-4 py-3 text-sm text-neutral-200 backdrop-blur">
            <button
              type="button"
              onClick={() => setReviewIndex(null)}
              className="hover:text-white"
            >
              ← Quay lại lưới (Esc)
            </button>
            <span className="text-neutral-400">
              {reviewIndex! + 1} / {displayOrderItems.length}
              {isRunning && " (đang phân tích thêm...)"}
            </span>
            <button
              type="button"
              onClick={() => setAutoSkipFlagged((prev) => !prev)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                autoSkipFlagged
                  ? "border-emerald-400 text-emerald-300"
                  : "border-neutral-600 text-neutral-400"
              }`}
            >
              Tự động bỏ qua ảnh loại (S):{" "}
              {autoSkipFlagged ? "Bật" : "Tắt"}
            </button>
          </div>

          <div
            ref={reviewImageContainerRef}
            onWheel={handleReviewWheel}
            className="relative flex flex-1 items-center justify-center overflow-hidden px-4"
          >
            {readyPreviewSrc && (
              <img
                key={readyPreviewSrc}
                src={readyPreviewSrc}
                alt={currentItem.file.file.name}
                onDoubleClick={handleReviewImageDoubleClick}
                className={`max-h-full max-w-full cursor-zoom-in object-contain [animation:fade-in_180ms_ease-out] ${
                  reviewZoom ? "invisible" : ""
                }`}
              />
            )}
            {zoomFullSrc && (
              <img
                src={zoomFullSrc}
                alt={currentItem.file.file.name}
                draggable={false}
                onLoad={handleZoomImageLoaded}
                onDoubleClick={handleReviewImageDoubleClick}
                onPointerDown={handleZoomPointerDown}
                onPointerMove={handleZoomPointerMove}
                onPointerUp={handleZoomPointerUp}
                onPointerLeave={handleZoomPointerUp}
                style={
                  reviewZoom
                    ? {
                        transform: `translate(${reviewZoom.tx}px, ${reviewZoom.ty}px) scale(${reviewZoom.scale})`,
                        transformOrigin: "center center",
                        // Tắt transition lúc đang kéo để pan bám sát chuột ngay lập tức
                        // (không trễ/dính), chỉ bật lại khi zoom bằng cuộn chuột/nhấp đúp.
                        transition: isZoomDragging
                          ? "none"
                          : "transform 150ms cubic-bezier(0.22, 1, 0.36, 1)",
                      }
                    : undefined
                }
                className={`absolute inset-0 h-full w-full object-contain ${
                  reviewZoom ? "cursor-grab active:cursor-grabbing" : "invisible"
                }`}
              />
            )}
            {reviewZoom && (
              <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white">
                Zoom {Math.round((reviewZoom.scale / maxScaleRef.current) * 100)}% — cuộn để
                zoom, kéo để xem, nhấp đúp/Esc để thoát
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-2 text-xs">
            <span className="max-w-xs truncate text-neutral-300">
              {currentItem.file.file.name}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                FLAG_BADGE[classifyCullingFlag(currentItem.metrics)]
              }`}
            >
              {currentItem.metrics.sharpnessScore.toFixed(0)} điểm nét ·{" "}
              {FLAG_LABEL[classifyCullingFlag(currentItem.metrics)]}
            </span>
            <span className="text-neutral-500">
              Mắt: {EYE_LABEL[currentItem.metrics.eyeStatus]}
              {currentItem.metrics.faceCount > 1 &&
                ` · ${currentItem.metrics.faceCount} khuôn mặt`}
            </span>
            {!reviewZoom && (
              <span className="text-neutral-600">
                Cuộn chuột hoặc nhấp đúp vào ảnh để zoom
              </span>
            )}
          </div>

          {faceCrops.length > 1 && (
            <div className="border-t border-white/10 px-4 py-3">
              <p className="mb-2 text-center text-xs text-neutral-500">
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
                    <p className="mt-1 text-xs text-neutral-500">
                      {EYE_LABEL[face.eyeStatus]}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-3 px-4 py-4">
            <button
              type="button"
              onClick={() => moveTo(reviewIndex! - 1, -1)}
              className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-white/10"
            >
              ← <span className="rounded bg-white/10 px-1 text-[10px]">A</span>
            </button>
            <button
              type="button"
              onClick={() => decideCurrent("red")}
              className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Loại <span className="rounded bg-black/20 px-1 text-[10px]">X</span>
            </button>
            <button
              type="button"
              onClick={() => decideCurrent("yellow")}
              className="flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              Xem lại <span className="rounded bg-black/20 px-1 text-[10px]">Y</span>
            </button>
            <button
              type="button"
              onClick={() => decideCurrent("green")}
              className="flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Giữ <span className="rounded bg-black/20 px-1 text-[10px]">K</span>
            </button>
            <button
              type="button"
              onClick={() => moveTo(reviewIndex! + 1, 1)}
              className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-white/10"
            >
              <span className="rounded bg-white/10 px-1 text-[10px]">D</span> →
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto border-t border-white/10 bg-black/60 px-4 py-3">
            {displayOrderItems.map((it, idx) => {
              const path = it.file.relativePath;
              const decision = decisions[path] ?? "yellow";
              const isActive = idx === reviewIndex;
              return (
                <button
                  key={path}
                  ref={isActive ? activeThumbRef : undefined}
                  type="button"
                  onClick={() => setReviewIndex(idx)}
                  className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md ring-2 transition-opacity ${
                    isActive
                      ? "opacity-100 ring-white"
                      : "opacity-60 ring-transparent hover:opacity-90"
                  }`}
                >
                  {thumbnails[path] && (
                    <img
                      src={thumbnails[path]}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  )}
                  <span
                    className={`absolute inset-x-0 bottom-0 h-1 ${DECISION_DOT[decision]}`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}