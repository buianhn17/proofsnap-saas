// Bước 1.5 — API phía main thread để chạy pipeline culling trong Web Worker thay vì
// chặn main thread. Đây là điểm gọi DUY NHẤT mà UI (AlbumCullPage, CullingTestPage) nên
// dùng — không còn đường nào chạy pipeline trực tiếp trên main thread nữa.
//
// Chạy 1 POOL nhiều worker song song (mỗi worker 1 FaceLandmarker riêng) với hàng đợi
// work-stealing: worker nào xong ảnh thì lấy ảnh kế tiếp, nên ảnh nặng/nhẹ xen kẽ không làm
// worker nào ngồi chờ. Mỗi worker giữ sẵn 2 ảnh "đang bay" để phần decode bất đồng bộ của
// ảnh sau chạy chồng lên phần tính toán đồng bộ (phát hiện mặt, Laplacian) của ảnh trước.

import type { LocalPhotoFile } from "../localPhotoFile";
import type {
  CullingPipelineOptions,
  CullingTestItem,
  CullingTestProgress,
  CullingTestSummary,
} from "./cullingPipeline";
import type { AccelerationTier, HardwareInfo } from "./hardwareAcceleration";
import type {
  WorkerItemResult,
  WorkerRequest,
  WorkerResponse,
} from "./cullingWorkerProtocol";
import { errorItemResult } from "./errorItemResult";

const JOBS_IN_FLIGHT_PER_WORKER = 2;
// Trần số worker: mỗi worker tốn ~150-250MB (WASM runtime + model + canvas 2000px) và 1
// WebGL context; quá 4 thì GPU bị tranh chấp, không nhanh thêm mà dễ hết bộ nhớ trên máy
// RAM thấp.
const MAX_POOL_SIZE = 4;

/** Số worker mặc định: nửa số luồng CPU (chừa cho main thread/UI và trình duyệt), 1-4. */
export function defaultPoolSize(): number {
  const threads = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(MAX_POOL_SIZE, Math.floor(threads / 2)));
}

interface PooledWorker {
  worker: Worker;
  pendingJobs: Map<number, (result: WorkerItemResult) => void>;
  pendingInit: { resolve: (info: HardwareInfo) => void; reject: (err: Error) => void } | null;
  /** Lỗi không hồi phục được (worker crash) — mọi job sau đó thất bại ngay. */
  fatalError: Error | null;
}

// Pool dùng lại cho nhiều lần chạy trong cùng phiên — khởi tạo FaceLandmarker (tải WASM +
// model) khá tốn, không muốn trả giá đó lại mỗi lần bấm "Phân tích".
const pool: PooledWorker[] = [];
let nextJobId = 1;

function createPooledWorker(): PooledWorker {
  const pooled: PooledWorker = {
    worker: new Worker(new URL("./culling.worker.ts", import.meta.url), { type: "module" }),
    pendingJobs: new Map(),
    pendingInit: null,
    fatalError: null,
  };

  pooled.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    switch (message.type) {
      case "ready":
        pooled.pendingInit?.resolve(message.hardwareInfo);
        pooled.pendingInit = null;
        break;
      case "initError":
        pooled.pendingInit?.reject(new Error(message.message));
        pooled.pendingInit = null;
        break;
      case "result":
        pooled.pendingJobs.get(message.jobId)?.(message.result);
        pooled.pendingJobs.delete(message.jobId);
        break;
    }
  });

  pooled.worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Worker phân tích ảnh bị lỗi");
    pooled.fatalError = error;
    pooled.pendingInit?.reject(error);
    pooled.pendingInit = null;
    // Job đang chờ của worker chết không bao giờ có kết quả — trả về item lỗi để lượt chạy
    // vẫn kết thúc được thay vì treo mãi.
    for (const resolve of pooled.pendingJobs.values()) resolve(errorItemResult(error.message));
    pooled.pendingJobs.clear();
  });

  return pooled;
}

function getPool(size: number): PooledWorker[] {
  // Bỏ worker đã chết khỏi pool để lượt chạy sau tạo worker mới thay thế.
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    if (pool[i].fatalError) {
      pool[i].worker.terminate();
      pool.splice(i, 1);
    }
  }
  while (pool.length < size) pool.push(createPooledWorker());
  return pool.slice(0, size);
}

function initWorker(pooled: PooledWorker, tier: AccelerationTier): Promise<HardwareInfo> {
  return new Promise((resolve, reject) => {
    pooled.pendingInit = { resolve, reject };
    pooled.worker.postMessage({ type: "init", accelerationTier: tier } satisfies WorkerRequest);
  });
}

function processInWorker(
  pooled: PooledWorker,
  file: File,
  rawFile: File | null,
  options: CullingPipelineOptions
): Promise<WorkerItemResult> {
  if (pooled.fatalError) return Promise.resolve(errorItemResult(pooled.fatalError.message));
  return new Promise((resolve) => {
    const jobId = nextJobId;
    nextJobId += 1;
    pooled.pendingJobs.set(jobId, resolve);
    pooled.worker.postMessage({
      type: "process",
      jobId,
      file,
      rawFile,
      options,
    } satisfies WorkerRequest);
  });
}

export interface RunCullingTestInWorkerOptions extends CullingPipelineOptions {
  onProgress?: (progress: CullingTestProgress) => void;
  /** Gọi ngay khi từng ảnh xử lý xong (theo thứ tự HOÀN THÀNH, không phải thứ tự đầu vào —
   * các worker chạy song song), cho phép UI hiển thị kết quả dần dần. */
  onItem?: (item: CullingTestItem, index: number) => void;
  /** File RAW cùng cặp với 1 ảnh JPG (nếu có) — pipeline lấy preview nhúng trong RAW thay
   * vì decode JPEG gốc, nhanh hơn nhiều. */
  pairedRawFile?: (file: LocalPhotoFile) => File | null;
  /** Số worker chạy song song. Mặc định defaultPoolSize(). */
  concurrency?: number;
}

export interface CullingWorkerRun {
  promise: Promise<CullingTestSummary>;
  /** Dừng phát ảnh mới; các ảnh đang xử lý dở vẫn chạy xong, promise resolve với phần đã
   * xử lý. */
  abort: () => void;
}

export function runCullingTestInWorker(
  files: LocalPhotoFile[],
  options: RunCullingTestInWorkerOptions = {}
): CullingWorkerRun {
  const { onProgress, onItem, pairedRawFile, concurrency, ...pipelineOptions } = options;
  const accelerationTier = pipelineOptions.accelerationTier ?? "gpu";
  const workers = getPool(Math.max(1, Math.min(MAX_POOL_SIZE, concurrency ?? defaultPoolSize())));
  let aborted = false;

  const promise = (async (): Promise<CullingTestSummary> => {
    const hardwareInfos = await Promise.all(workers.map((w) => initWorker(w, accelerationTier)));

    const items: (CullingTestItem | undefined)[] = new Array(files.length);
    const startedAt = performance.now();
    let nextIndex = 0;
    let processedCount = 0;

    async function drain(pooled: PooledWorker) {
      while (!aborted && nextIndex < files.length) {
        const index = nextIndex;
        nextIndex += 1;
        const localFile = files[index];
        const result = await processInWorker(
          pooled,
          localFile.file,
          pairedRawFile?.(localFile) ?? null,
          pipelineOptions
        );
        const item: CullingTestItem = { file: localFile, ...result };
        items[index] = item;
        processedCount += 1;
        onItem?.(item, index);

        const elapsedMs = performance.now() - startedAt;
        onProgress?.({
          processed: processedCount,
          total: files.length,
          currentFileName: localFile.file.name,
          elapsedMs,
          imagesPerSecond: processedCount / (elapsedMs / 1000),
        });
      }
    }

    await Promise.all(
      workers.flatMap((w) => Array.from({ length: JOBS_IN_FLIGHT_PER_WORKER }, () => drain(w)))
    );

    const totalElapsedMs = performance.now() - startedAt;
    return {
      items: items.filter((item): item is CullingTestItem => item !== undefined),
      totalElapsedMs,
      imagesPerSecond: processedCount / (totalElapsedMs / 1000),
      accelerationTier,
      hardwareInfo: hardwareInfos[0],
    };
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
    },
  };
}
