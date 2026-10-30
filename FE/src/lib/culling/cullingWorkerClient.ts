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
// Trần số worker: mỗi worker tốn ~150-250MB (WASM runtime + 2 model + canvas 2000px) và 1
// WebGPU device cho SCRFD. Phần lớn việc mỗi ảnh là CPU (decode, landmark MediaPipe chạy CPU,
// đo nét, encode JPEG thumbnail/preview); GPU chỉ chạy SCRFD. Đo trên máy 16 luồng (160 ảnh
// 24MP): 8 worker 15.2 ảnh/s, 12 worker 16.3, 15 worker 16.3 (CPU ~75%) — quá 12 không nhanh
// thêm vì tranh decode/GPU process của Chrome, chỉ tốn thêm RAM.
const MAX_POOL_SIZE = 12;
// Phần luồng CPU dành cho worker — chừa lại cho main thread/UI, luồng decode ảnh và GPU
// process của trình duyệt.
const POOL_THREAD_SHARE = 0.75;

/** Số worker mặc định: ~3/4 số luồng CPU, giới hạn theo RAM (navigator.deviceMemory —
 * Chrome báo tối đa 8GB) và MAX_POOL_SIZE. */
export function defaultPoolSize(): number {
  if (typeof navigator === "undefined") return 2;
  const threads = navigator.hardwareConcurrency || 2;
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const byMemory = memoryGb < 4 ? 2 : memoryGb < 8 ? 4 : MAX_POOL_SIZE;
  return Math.max(1, Math.min(MAX_POOL_SIZE, byMemory, Math.round(threads * POOL_THREAD_SHARE)));
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

// Khởi tạo gồm tải WASM MediaPipe + 2 model (~20MB) và biên dịch shader WebGPU — chậm nhất
// ở lần đầu (chưa có cache), nhưng quá mức này coi như worker kẹt, báo lỗi thay vì treo UI.
const INIT_TIMEOUT_MS = 120_000;

function initWorker(pooled: PooledWorker, tier: AccelerationTier): Promise<HardwareInfo> {
  // Worker có thể đã chết TRƯỚC khi gửi init (ví dụ tải module lỗi) — sự kiện "error" lúc
  // đó không có pendingInit nào để reject, nếu cứ chờ sẽ treo mãi.
  if (pooled.fatalError) return Promise.reject(pooled.fatalError);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("Khởi tạo worker phân tích ảnh quá lâu — thử tải lại trang.");
      pooled.pendingInit = null;
      // Đánh dấu chết để lượt chạy sau thay bằng worker mới (getPool) thay vì dùng lại.
      pooled.fatalError = error;
      reject(error);
    }, INIT_TIMEOUT_MS);
    pooled.pendingInit = {
      resolve: (info) => {
        clearTimeout(timer);
        resolve(info);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    };
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
