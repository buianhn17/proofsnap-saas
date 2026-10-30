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
import { createPortal } from "react-dom";
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
import {
  scoreBursts,
  type PhotoAnalysisResult,
  type RejectReason,
} from "../../lib/culling/burstScoring";
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

const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  blink: "Nhắm mắt",
  out_of_focus: "Out nét",
};

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

const FLAG_OVERLAY: Record<CullingFlag, { bg: string; border: string; text: string; label: string }> = {
  green: { bg: "bg-[#1c3325]", border: "border-[#2e5c41]", text: "text-[#93f5b7]", label: "CHẤT LƯỢNG TỐT" },
  yellow: { bg: "bg-[#4a3600]", border: "border-[#805d00]", text: "text-[#ffb95e]", label: "CẦN XEM LẠI" },
  red: { bg: "bg-[#3d1a1a]", border: "border-[#6b2e2e]", text: "text-[#ffb4ab]", label: "MỜ HOẶC NHẮM MẮT" },
};

const EYE_RING: Record<EyeStatus, string> = {
  open: "ring-emerald-500",
  squint: "ring-amber-500",
  closed: "ring-red-500",
  no_face: "ring-neutral-600",
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
  // Vị trí của mỗi ảnh trong danh sách đầu vào — pool worker trả kết quả theo thứ tự xử lý
  // xong (không cố định), dùng map này để chèn ảnh vào `items` đúng thứ tự file gốc.
  const inputIndexRef = useRef(new Map<string, number>());
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  // Màu gợi ý AI đã gán cho từng ảnh — để biết ảnh nào PTG chưa tự đổi màu, khi chấm lại theo
  // chùm burst (sau khi phân tích xong) thì chỉ cập nhật những ảnh đó.
  const aiFlagRef = useRef(new Map<string, CullingFlag>());
  // Bước hiệu năng — 2 bản blob nhẹ hơn nhiều so với file gốc (thường 20-40MB): `thumbnails`
  // (~900px, cho ô lưới) và `previews` (~2000px, cho màn hình xem full-screen). File gốc chỉ
  // cần đụng tới khi thật sự upload (Bước 2.3).
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const thumbnailUrlsRef = useRef<string[]>([]);

  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [autoSkipFlagged, setAutoSkipFlagged] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("scenes");
  // Lọc lưới/lượt duyệt theo quyết định Giữ/Xem lại/Loại. Thành viên của bộ lọc tính theo
  // ẢNH CHỤP NHANH quyết định lúc chọn bộ lọc (filterSnapshot), không theo quyết định hiện
  // tại: đổi màu 1 ảnh khi đang lọc không làm nó biến mất ngay khỏi lưới/lượt duyệt (index
  // ảnh đang xem không bị xô lệch). Ảnh mới phân tích xong sau lúc chụp nhanh thì dùng quyết
  // định hiện tại.
  const [decisionFilter, setDecisionFilter] = useState<Decision | "all">("all");
  const [filterSnapshot, setFilterSnapshot] = useState<Record<string, Decision>>({});
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

  function handleItem(item: CullingTestItem, inputIndex: number) {
    const path = item.file.relativePath;
    inputIndexRef.current.set(path, inputIndex);
    const thumbnailUrl = URL.createObjectURL(item.thumbnailBlob);
    const previewUrl = URL.createObjectURL(item.previewBlob);
    thumbnailUrlsRef.current.push(thumbnailUrl, previewUrl);
    setThumbnails((prev) => ({ ...prev, [path]: thumbnailUrl }));
    setPreviews((prev) => ({ ...prev, [path]: previewUrl }));
    setItems((prev) => {
      const indexOf = (it: CullingTestItem) =>
        inputIndexRef.current.get(it.file.relativePath) ?? 0;
      let lo = 0;
      let hi = prev.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (indexOf(prev[mid]) < inputIndex) lo = mid + 1;
        else hi = mid;
      }
      const next = prev.slice();
      next.splice(lo, 0, item);
      return next;
    });

    // Khởi tạo màu rate = đúng gợi ý AI — PTG ghi đè sau bằng phím tắt/nút bấm.
    const flag = classifyCullingFlag(item.metrics);
    aiFlagRef.current.set(path, flag);
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
    setDecisionFilter("all");
    aiFlagRef.current = new Map();

    inputIndexRef.current = new Map();
    const { promise, abort } = runCullingTestInWorker(jpgFiles, {
      onProgress: setProgress,
      onItem: handleItem,
      // Ảnh có RAW cùng cặp: phân tích trên preview nhúng trong RAW (nhanh hơn decode JPEG).
      pairedRawFile: (jpg) => jpgPathToRaw.get(jpg.relativePath)?.file ?? null,
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
  // (chụp cách nhau <= 1.2s + bố cục giống nhau), để hiển thị "Theo buổi chụp". Mỗi burst
  // được chấm điểm và chọn best pick (burstScoring.ts) — ảnh đại diện của cụm.
  const { scenes, analysisByPath } = useMemo<{
    scenes: SceneGroup[];
    analysisByPath: Map<string, PhotoAnalysisResult>;
  }>(() => {
    if (items.length === 0) return { scenes: [], analysisByPath: new Map() };
    const grouping = groupScenesAndBursts(
      items.map((item) => ({
        id: item.file.relativePath,
        timestampMs:
          item.sceneSignals.capturedAtMs ?? item.file.file.lastModified,
        timestampSource: item.sceneSignals.timestampSource,
        histogram: item.sceneSignals.histogram,
        hash: item.metrics.hash,
        signature: item.sceneSignals.signature,
      }))
    );
    const byPath = new Map(items.map((item) => [item.file.relativePath, item]));
    const analysisByPath = scoreBursts(
      items.map((item) => ({
        photoId: item.file.relativePath,
        burstGroupId: String(grouping.burstId.get(item.file.relativePath) ?? -1),
        metrics: item.metrics,
      }))
    );

    const sceneItemsById = new Map<number, CullingTestItem[]>();
    for (const path of grouping.order) {
      const item = byPath.get(path);
      const sceneId = grouping.sceneId.get(path);
      if (!item || sceneId === undefined) continue;
      if (!sceneItemsById.has(sceneId)) sceneItemsById.set(sceneId, []);
      sceneItemsById.get(sceneId)!.push(item);
    }

    const sceneGroups = Array.from(sceneItemsById.entries()).map(([sceneId, sceneItems]) => {
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
          representative:
            burstItems.find(
              (it) => analysisByPath.get(it.file.relativePath)?.is_best_pick
            ) ?? burstItems[0],
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
    return { scenes: sceneGroups, analysisByPath };
  }, [items]);

  // Phân tích xong -> chấm lại màu gợi ý theo chùm burst (độ mở mắt so tương đối giữa các
  // khung, burstScoring.ts). Trong lúc chạy chùm chưa đủ ảnh nên giữ màu chấm độc lập.
  useEffect(() => {
    if (isRunning || analysisByPath.size === 0) return;
    const updates: { path: string; oldFlag: CullingFlag | undefined; flag: CullingFlag }[] = [];
    for (const item of items) {
      const path = item.file.relativePath;
      const flag = classifyCullingFlag(item.metrics, analysisByPath.get(path));
      const oldFlag = aiFlagRef.current.get(path);
      if (oldFlag !== flag) {
        updates.push({ path, oldFlag, flag });
        aiFlagRef.current.set(path, flag);
      }
    }
    if (updates.length === 0) return;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const { path, oldFlag, flag } of updates) {
        // PTG đã tự đổi màu ảnh này -> giữ quyết định của PTG.
        if (prev[path] === oldFlag) next[path] = flag;
      }
      return next;
    });
  }, [isRunning, analysisByPath, items]);

  // Bug fix — thứ tự ảnh khi duyệt (mở/Trước/Sau trong review) phải khớp với thứ tự ĐANG
  // HIỂN THỊ trên lưới, không phải thứ tự `items` gốc (thứ tự worker xử lý xong từng ảnh —
  // có thể khác thứ tự thời gian chụp). Ở chế độ "Theo buổi chụp", lưới hiển thị theo
  // scene -> burst -> item (đã sắp theo thời gian trong `scenes` ở trên); ở "Lưới phẳng" thì
  // giữ nguyên thứ tự `items`. Trước đây review dùng thẳng `items`/`pathToIndex` theo thứ tự
  // gốc nên bấm vào 1 ảnh trong lưới "Theo buổi chụp" rồi bấm Tiếp/Trước sẽ nhảy sang ảnh
  // không liền kề trên màn hình.
  const matchesFilter = useCallback(
    (item: CullingTestItem) => {
      if (decisionFilter === "all") return true;
      const path = item.file.relativePath;
      return (filterSnapshot[path] ?? decisions[path] ?? "yellow") === decisionFilter;
    },
    [decisionFilter, filterSnapshot, decisions]
  );

  function selectDecisionFilter(filter: Decision | "all") {
    setFilterSnapshot(decisions);
    setDecisionFilter(filter);
  }

  const displayOrderItems = useMemo<CullingTestItem[]>(() => {
    if (viewMode === "flat") return items.filter(matchesFilter);
    const result: CullingTestItem[] = [];
    for (const scene of scenes) {
      for (const burst of scene.bursts) {
        result.push(...burst.items.filter(matchesFilter));
      }
    }
    return result;
  }, [viewMode, items, scenes, matchesFilter]);

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
        // Đang lọc riêng ảnh Loại thì không bỏ qua ảnh loại — nếu không sẽ không duyệt được.
        if (!autoSkipFlagged || decisionFilter === "red" || decision !== "red") {
          setReviewIndex(idx);
          return;
        }
        idx += direction;
      }
      // Không còn ảnh hợp lệ theo hướng này (đã hết hoặc toàn bộ còn lại đều bị loại) — giữ nguyên vị trí.
    },
    [displayOrderItems, decisions, autoSkipFlagged, decisionFilter]
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

    const toItemCard = (item: CullingTestItem): GridCard => ({
      kind: "item",
      key: item.file.relativePath,
      item,
    });

    if (viewMode === "flat") {
      return chunkCards(items.filter(matchesFilter).map(toItemCard), "flat");
    }

    const rows: GridRow[] = [];
    if (decisionFilter !== "all") {
      // Đang lọc: trải phẳng ảnh khớp bộ lọc theo từng buổi chụp, không gộp chùm burst (ảnh
      // đại diện của chùm có thể không khớp bộ lọc).
      for (const scene of scenes) {
        const matched = scene.bursts.flatMap((burst) => burst.items.filter(matchesFilter));
        if (matched.length === 0) continue;
        rows.push({ key: `scene-${scene.sceneId}`, kind: "sceneHeader", scene });
        rows.push(...chunkCards(matched.map(toItemCard), `scene-${scene.sceneId}-filtered`));
      }
      return rows;
    }

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
  }, [viewMode, items, scenes, expandedBursts, columns, decisionFilter, matchesFilter]);

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
    const flag = classifyCullingFlag(item.metrics, analysisByPath.get(path));
    const decision = decisions[path] ?? "yellow";
    // Chỉ hiện chấm gợi ý AI (góc trái) khi PTG đã ghi đè khác với gợi ý ban đầu — tránh lặp
    // lại cùng 1 màu 2 lần ở đa số ảnh (đa số ảnh chưa đổi thì màu rate = đúng gợi ý AI rồi).
    const overridden = decision !== flag;
    return (
      <button
        type="button"
        onClick={() => index !== undefined && setReviewIndex(index)}
        className="group relative block w-full overflow-hidden rounded-[4px] bg-[#201f1f] ring-1 ring-[#414752] transition-transform hover:z-10 hover:scale-[1.03] hover:ring-[#a9c7ff]"
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
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.6px] text-[#a9c7ff]">
            ★ Đại diện
          </span>
        )}
        <span
          className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${DECISION_BADGE[decision]}`}
        >
          {DECISION_LABEL[decision]}
        </span>
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-[rgba(19,19,19,0.9)] to-transparent px-2 py-1.5 text-left font-mono text-[11px] tracking-[0.6px] text-[#e5e2e1]">
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
          className="absolute bottom-9 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.6px] text-[#e5e2e1] hover:bg-black/90"
        >
          +{card.burst.items.length - 1} ảnh giống
        </button>
      </div>
    );
  }

  const currentItem = reviewIndex !== null ? displayOrderItems[reviewIndex] : null;

  // Bước UI — tra cứu nhanh cảnh/cụm chứa ảnh đang xem, để hiện đúng ngữ cảnh thật (không
  // bịa tên cảnh) ở header và dải phim review, dựa trên đúng dữ liệu gom nhóm ở `scenes`.
  const sceneAndBurstByPath = useMemo(() => {
    const map = new Map<
      string,
      { sceneIndex: number; scene: SceneGroup; burst: BurstGroup | null }
    >();
    scenes.forEach((scene, sceneIndex) => {
      for (const burst of scene.bursts) {
        const burst_ = burst.items.length > 1 ? burst : null;
        for (const item of burst.items) {
          map.set(item.file.relativePath, { sceneIndex, scene, burst: burst_ });
        }
      }
    });
    return map;
  }, [scenes]);

  const currentContext = currentItem
    ? sceneAndBurstByPath.get(currentItem.file.relativePath)
    : undefined;

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

  useEffect(() => {
    if (currentItem) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [currentItem]);

  if (!supported) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-md border border-[#805d00] bg-[#4a3600] px-3 py-2 text-sm text-[#ffb95e]">
          {FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE}
        </div>
        <Link
          to={`/admin/albums/${albumId}`}
          className="mt-3 inline-block text-sm text-[#c1c6d4] hover:text-[#e5e2e1]"
        >
          ← Quay lại album
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-end justify-between border-b border-[#414752] pb-[25px]">
        <div>
          <h1 className="text-[32px] font-semibold tracking-[-0.32px] text-[#e5e2e1]">
            Chế độ phân cảnh
          </h1>
          <p className="mt-1 text-base text-[#c1c6d4]">
            {album ? `${album.name} — ` : ""}Duyệt và gộp ảnh theo thời gian thực.
          </p>
        </div>
        <Link
          to={`/admin/albums/${albumId}`}
          className="text-sm text-[#c1c6d4] hover:text-[#e5e2e1]"
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
            className="rounded-[4px] bg-[#5a9cff] px-4 py-2 text-sm font-medium text-[#003369] hover:bg-[#4a8cef] disabled:opacity-50"
          >
            {isScanning ? "Đang quét..." : "Chọn thư mục ảnh gốc trên máy"}
          </button>
          {scanError && (
            <p className="mt-2 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {scanError}
            </p>
          )}
        </div>
      )}

      {scanResult && items.length === 0 && !isRunning && (
        <div className="mt-6 flex items-center gap-3">
          <span className="text-sm text-[#c1c6d4]">
            "{scanResult.folderName}":{" "}
            {scanResult.files.filter((f) => f.kind === "jpg").length} ảnh JPG
            tìm thấy
          </span>
          <button
            type="button"
            onClick={handleAnalyze}
            className="rounded-[4px] bg-[#5a9cff] px-4 py-2 text-sm font-medium text-[#003369] hover:bg-[#4a8cef]"
          >
            Bắt đầu phân tích
          </button>
          <button
            type="button"
            onClick={handlePickFolder}
            className="text-sm text-[#c1c6d4] hover:text-[#e5e2e1]"
          >
            Chọn thư mục khác
          </button>
        </div>
      )}

      {runError && (
        <p className="mt-2 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {runError}
        </p>
      )}

      {isRunning && progress && (
        <div className="mt-4 rounded-[4px] border border-[#414752] bg-[#1c1b1b] p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-[#e5e2e1]">
              Đang phân tích {progress.processed}/{progress.total}:{" "}
              {progress.currentFileName}
            </span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs tracking-[0.6px] text-[#c1c6d4]">
                {progress.imagesPerSecond.toFixed(2)} ảnh/giây
              </span>
              <button
                type="button"
                onClick={handleStopAnalyze}
                className="rounded-[4px] border border-[#6b2e2e] px-2 py-1 text-xs font-medium text-[#ffb4ab] hover:bg-red-950/50"
              >
                Dừng
              </button>
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#2a2a2a]">
            <div
              className="h-full rounded-full bg-[#5a9cff] transition-all"
              style={{
                width: `${(progress.processed / progress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4 rounded-lg border border-[#414752] bg-[#131313] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("flat")}
                className={`rounded-full border px-3 py-1 font-mono tracking-[0.6px] ${
                  viewMode === "flat"
                    ? "border-white bg-white text-[#131313]"
                    : "border-[#414752] text-[#c1c6d4] hover:bg-[#2a2a2a]"
                }`}
              >
                Lưới phẳng
              </button>
              <button
                type="button"
                onClick={() => setViewMode("scenes")}
                className={`rounded-full border px-3 py-1 font-mono tracking-[0.6px] ${
                  viewMode === "scenes"
                    ? "border-white bg-white text-[#131313]"
                    : "border-[#414752] text-[#c1c6d4] hover:bg-[#2a2a2a]"
                }`}
              >
                Theo buổi chụp ({scenes.length})
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(
                [
                  { value: "all", label: "Tất cả", count: counts.total, dot: null },
                  { value: "green", label: "Giữ", count: counts.keep, dot: "bg-emerald-400" },
                  { value: "yellow", label: "Xem lại", count: counts.review, dot: "bg-amber-400" },
                  { value: "red", label: "Loại", count: counts.reject, dot: "bg-red-500" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => selectDecisionFilter(option.value)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono tracking-[0.6px] ${
                    decisionFilter === option.value
                      ? "border-white bg-white text-[#131313]"
                      : "border-[#414752] text-[#c1c6d4] hover:bg-[#2a2a2a]"
                  }`}
                >
                  {option.dot && <span className={`h-2 w-2 rounded-full ${option.dot}`} />}
                  {option.label} {option.count}
                </button>
              ))}
            </div>
          </div>

          {decisionFilter !== "all" && (
            <p className="mt-2 font-mono text-[11px] tracking-[0.6px] text-[#8b919e]">
              Đang hiện {displayOrderItems.length} ảnh. Ảnh đổi màu khi đang lọc vẫn hiện tới khi
              chọn lại bộ lọc.
            </p>
          )}

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
                    <div className="flex items-center gap-4 pb-2 pt-4 first:pt-0">
                      <h3 className="text-xl font-semibold text-[#e5e2e1]">
                        Buổi {row.scene.sceneId + 1} —{" "}
                        {formatTimeRange(row.scene.startMs, row.scene.endMs)}
                      </h3>
                      <span className="border border-[#414752] bg-[#201f1f] px-[9px] py-[5px] font-mono text-xs tracking-[0.6px] text-[#c1c6d4]">
                        {row.scene.items.length} ảnh
                      </span>
                    </div>
                  )}
                  {row.kind === "cards" && (
                    <div className="flex gap-4 pb-4">
                      {row.cards.map((card) => renderGridCard(card))}
                    </div>
                  )}
                  {row.kind === "burstExpanded" && (
                    <div className="mb-4 rounded-lg border border-[#414752] bg-[#1c1b1b] p-3">
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
                          className="font-mono tracking-[0.6px] text-[#c1c6d4] hover:text-[#e5e2e1]"
                        >
                          Thu gọn loạt này
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectRestOfBurst(row.burst)}
                          className="font-mono tracking-[0.6px] text-[#ffb4ab] hover:text-red-300"
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

          <div className="mt-6 rounded-[4px] border border-[#414752] bg-[#1c1b1b] p-4">
            <h3 className="text-sm font-semibold text-[#e5e2e1]">
              Hành động cuối trên file gốc trên máy (tuỳ chọn)
            </h3>
            <p className="mt-1 text-xs text-[#c1c6d4]">
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
                className="rounded-[4px] border border-[#414752] px-3 py-1.5 text-sm font-medium text-[#e5e2e1] hover:bg-[#2a2a2a] disabled:opacity-50"
              >
                Sao chép {keptPairs.length} cặp ảnh "giữ" sang thư mục mới
              </button>
              <button
                type="button"
                onClick={handleDeleteRejected}
                disabled={
                  rejectedPairs.length === 0 || localAction.kind === "running"
                }
                className="rounded-[4px] border border-[#6b2e2e] px-3 py-1.5 text-sm font-medium text-[#ffb4ab] hover:bg-red-950/50 disabled:opacity-50"
              >
                Xoá {rejectedPairs.length} cặp ảnh "loại" khỏi thư mục gốc
              </button>
            </div>

            {localAction.kind === "running" && (
              <p className="mt-3 text-sm text-[#c1c6d4]">
                {localAction.action === "copy" ? "Đang sao chép" : "Đang xoá"}{" "}
                {localAction.done}/{localAction.total} file...
              </p>
            )}
            {localAction.kind === "done" && (
              <p className="mt-3 rounded-md bg-[#1a3d24] px-3 py-2 text-sm text-[#86e8a8]">
                {localAction.message}
              </p>
            )}
            {localAction.kind === "error" && (
              <p className="mt-3 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
                {localAction.message}
              </p>
            )}
          </div>

          <div className="sticky bottom-0 mt-6 flex items-center justify-between rounded-[4px] border border-[#414752] bg-[#0e0e0e]/95 px-4 py-3 text-sm shadow-md backdrop-blur">
            <span className="font-mono tracking-[0.6px] text-[#c1c6d4]">
              {counts.total} ảnh · Giữ {counts.keep} · Xem lại {counts.review} ·
              Loại {counts.reject}
            </span>
            <button
              type="button"
              onClick={handleContinueToUpload}
              disabled={counts.keep === 0}
              className="rounded-[4px] bg-[#5a9cff] px-4 py-2 text-sm font-medium text-[#003369] hover:bg-[#4a8cef] disabled:opacity-50"
            >
              Tiếp tục upload {counts.keep} ảnh đã giữ
            </button>
          </div>
        </div>
      )}

      {currentItem &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex flex-col bg-[#090a0f] text-slate-100 overflow-hidden">
            {/* Top Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-zinc-950/90 px-6 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setReviewIndex(null)}
                  className="flex items-center justify-center rounded-xl p-2 text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"
                  title="Quay lại lưới (Esc)"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                </button>
                {album && (
                  <span className="text-sm font-bold text-white">
                    {album.name}
                  </span>
                )}
                {currentContext && (
                  <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[11px] text-zinc-300">
                    Cảnh {currentContext.sceneIndex + 1}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4">
                <span className="text-xs text-zinc-400 font-mono">
                  {reviewIndex! + 1} / {displayOrderItems.length} ảnh
                  {isRunning && " (đang phân tích...)"}
                  {currentContext?.burst && (
                    <span className="text-amber-400">
                      {" "}
                      • Cụm {currentContext.burst.burstId + 1} ({currentContext.burst.items.length} ảnh)
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setAutoSkipFlagged((prev) => !prev)}
                  className={`rounded-full border px-3 py-1 font-mono text-[11px] tracking-wider transition-colors ${
                    autoSkipFlagged
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-white/10 bg-white/5 text-zinc-400 hover:text-white"
                  }`}
                >
                  Tự động bỏ qua ảnh loại (S): {autoSkipFlagged ? "Bật" : "Tắt"}
                </button>
              </div>
            </div>

            {/* Middle Main Content Area: Large Preview Center + Close-up Panel Right */}
            <div className="relative flex flex-1 min-h-0 overflow-hidden">
              {/* Photo Viewport Container */}
              <div
                ref={reviewImageContainerRef}
                onWheel={handleReviewWheel}
                className="relative flex flex-1 min-h-0 min-w-0 items-center justify-center overflow-hidden p-4 select-none"
              >
                {readyPreviewSrc && (
                  <img
                    key={readyPreviewSrc}
                    src={readyPreviewSrc}
                    alt={currentItem.file.file.name}
                    onDoubleClick={handleReviewImageDoubleClick}
                    className={`max-h-full max-w-full cursor-zoom-in rounded-xl border border-white/10 object-contain shadow-2xl [animation:fade-in_180ms_ease-out] ${
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
                  <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-black/80 px-3 py-1 text-xs font-mono font-medium text-white backdrop-blur-md">
                    Zoom {Math.round((reviewZoom.scale / maxScaleRef.current) * 100)}% — cuộn để zoom, kéo để di chuyển, nhấp đúp/Esc để thoát
                  </span>
                )}

                {/* Left/Right arrow buttons */}
                <button
                  type="button"
                  onClick={() => moveTo(reviewIndex! - 1, -1)}
                  disabled={reviewIndex === 0}
                  className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/70 text-white shadow-xl backdrop-blur-md transition-all hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none"
                  title="Ảnh trước (A hoặc Phím mũi tên trái)"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => moveTo(reviewIndex! + 1, 1)}
                  disabled={reviewIndex === displayOrderItems.length - 1}
                  className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/70 text-white shadow-xl backdrop-blur-md transition-all hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none"
                  title="Ảnh tiếp theo (D hoặc Phím mũi tên phải)"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* Top-Right AI Metric Badges */}
                {!reviewZoom && (() => {
                  const currentAnalysis = analysisByPath.get(currentItem.file.relativePath);
                  const flag = classifyCullingFlag(currentItem.metrics, currentAnalysis);
                  const overlay = FLAG_OVERLAY[flag];
                  return (
                    <div className="absolute right-4 top-4 flex flex-col items-end gap-2 pointer-events-none">
                      <div
                        className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 backdrop-blur-md ${overlay.bg} ${overlay.border}`}
                      >
                        <div>
                          <p className={`font-mono text-[10px] font-bold uppercase tracking-wider ${overlay.text}`}>
                            {overlay.label}
                          </p>
                          {currentAnalysis && (
                            <p className={`text-xs font-semibold ${overlay.text}`}>
                              Điểm: {Math.round(currentAnalysis.overall_score * 100)}/100
                              {currentAnalysis.is_best_pick && " · ★ Đẹp nhất cụm"}
                            </p>
                          )}
                          {currentAnalysis && currentAnalysis.reject_reasons.length > 0 && (
                            <p className={`text-xs ${overlay.text}`}>
                              {currentAnalysis.reject_reasons
                                .map((reason) => REJECT_REASON_LABEL[reason])
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-1.5 backdrop-blur-md">
                        {currentAnalysis?.group_eyes ? (
                          <p className="text-xs text-zinc-300">
                            Ảnh tập thể · Nhắm mắt:{" "}
                            <span className="font-semibold text-white">
                              {currentAnalysis.group_eyes.closed}/{currentAnalysis.group_eyes.total} người (
                              {Math.round(
                                (100 * currentAnalysis.group_eyes.closed) /
                                  currentAnalysis.group_eyes.total
                              )}
                              %)
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-zinc-300">
                            Mắt: <span className="font-semibold text-white">{EYE_LABEL[currentItem.metrics.eyeStatus]}</span>
                            {currentItem.metrics.earValue !== null &&
                              ` (EAR ${currentItem.metrics.earValue.toFixed(2)})`}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Close-up Face Crops Sidebar (Right) */}
              {faceCrops.length > 0 && (
                <div className="flex w-72 shrink-0 flex-col border-l border-white/10 bg-zinc-950/90 backdrop-blur-xl">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono">
                      Bảng cận cảnh ({faceCrops.length} khuôn mặt)
                    </h3>
                  </div>
                  <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
                    {currentItem.metrics.faces.map((face, index) => (
                      <div
                        key={index}
                        className="relative rounded-2xl border border-white/10 bg-zinc-900/60 p-3 transition-colors hover:border-white/20"
                      >
                        <span
                          className={`absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] font-bold shadow ${
                            face.eyeStatus === "open"
                              ? "border-emerald-500/40 bg-emerald-950 text-emerald-300"
                              : face.eyeStatus === "squint"
                              ? "border-amber-500/40 bg-amber-950 text-amber-300"
                              : "border-white/20 bg-zinc-800 text-zinc-300"
                          }`}
                        >
                          {index + 1}
                        </span>
                        {faceCrops[index] && (
                          <img
                            src={faceCrops[index]}
                            alt={`Khuôn mặt ${index + 1}`}
                            className={`aspect-square w-full rounded-xl border object-cover ring-2 ${EYE_RING[face.eyeStatus]}`}
                          />
                        )}
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-zinc-400">Trạng thái mắt</span>
                          <span className="font-semibold text-white">{EYE_LABEL[face.eyeStatus]}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs">
                          <span className="text-zinc-400">Mở mắt / Độ nét</span>
                          <span className="font-mono font-semibold text-white">
                            {Math.round(face.eyeOpenScore * 100)}% / {Math.round(face.focusScore * 100)}%
                          </span>
                        </div>
                        {!face.isMainSubject && (
                          <p className="mt-1 text-[11px] text-zinc-500">Người phụ — không tính khi chấm điểm</p>
                        )}
                        {face.isMainSubject &&
                          analysisByPath.get(currentItem.file.relativePath)?.faces[index]?.is_blinking && (
                            <p className="mt-1 text-[11px] font-semibold text-red-400">Được tính là nhắm mắt</p>
                          )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Filmstrip Section (Fixed Compact Height) */}
            <div className="shrink-0 border-t border-white/10 bg-zinc-950">
              <div className="flex items-center justify-between px-6 py-1.5 text-xs text-zinc-400">
                <span className="font-mono text-[11px] font-medium text-zinc-300">
                  {currentContext
                    ? `Cảnh ${currentContext.sceneIndex + 1} — ${
                        currentContext.burst
                          ? `Cụm ${currentContext.burst.items.length} ảnh`
                          : `${currentContext.scene.items.length} ảnh`
                      }`
                    : `${displayOrderItems.length} ảnh trong lượt duyệt này`}
                </span>
                <div className="flex items-center gap-3 font-mono text-[11px]">
                  <span className="text-zinc-200">{currentItem.file.file.name}</span>
                  {currentItem.metrics.faceCount > 1 && (
                    <span className="text-indigo-400">
                      • {currentItem.metrics.faceCount} khuôn mặt
                    </span>
                  )}
                  {!reviewZoom && (
                    <span className="text-zinc-500">
                      • Cuộn chuột hoặc nhấp đúp để zoom
                    </span>
                  )}
                </div>
              </div>

              {/* Thumbnails list */}
              <div className="flex gap-2 overflow-x-auto px-6 pb-2.5">
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
                      className={`relative aspect-[3/2] h-14 shrink-0 overflow-hidden rounded-lg border transition-all ${
                        isActive
                          ? "border-2 border-indigo-500 ring-2 ring-indigo-500/30 opacity-100 scale-105"
                          : "border-white/10 opacity-60 hover:opacity-100"
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
                      {isActive && (
                        <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-600 text-[9px] text-white">
                          ✓
                        </span>
                      )}
                      <span
                        className={`absolute bottom-1 right-1 h-2 w-2 rounded-full shadow ${DECISION_DOT[decision]}`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Keyboard Shortcuts Footer */}
            <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-black/95 px-6 py-2 text-xs">
              <div className="flex items-center gap-6">
                <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  Phím tắt
                </span>
                <span className="flex items-center gap-1.5 text-zinc-300">
                  <kbd className="rounded border border-white/20 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-400 font-bold">
                    K
                  </kbd>
                  Giữ
                </span>
                <span className="flex items-center gap-1.5 text-zinc-300">
                  <kbd className="rounded border border-white/20 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-amber-400 font-bold">
                    Y
                  </kbd>
                  Xem lại
                </span>
                <span className="flex items-center gap-1.5 text-zinc-300">
                  <kbd className="rounded border border-white/20 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-rose-400 font-bold">
                    X
                  </kbd>
                  Loại
                </span>
                <span className="flex items-center gap-1.5 text-zinc-300">
                  <kbd className="rounded border border-white/20 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-white">
                    A / D
                  </kbd>
                  Ảnh trước / tiếp
                </span>
                <span className="flex items-center gap-1.5 text-zinc-300">
                  <kbd className="rounded border border-white/20 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-white">
                    Esc
                  </kbd>
                  Quay lại lưới
                </span>
              </div>
              <span className="font-mono text-[11px] text-zinc-400">
                Đã chọn: <strong className="text-emerald-400">{counts.keep}</strong> • Tổng: <strong>{counts.total}</strong>
              </span>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}