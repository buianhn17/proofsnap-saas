// Bước 1.5 — API phía main thread để chạy pipeline culling trong Web Worker thay vì
// chặn main thread. Đây là điểm gọi DUY NHẤT mà UI (CullingTestPage) nên dùng — không
// còn đường nào chạy pipeline trực tiếp trên main thread nữa.

import type { LocalPhotoFile } from "../localPhotoFile";
import type {
  CullingPipelineOptions,
  CullingTestItem,
  CullingTestProgress,
  CullingTestSummary,
} from "./cullingPipeline";
import type { WorkerRequest, WorkerResponse } from "./cullingWorkerProtocol";

// Một worker dùng lại cho nhiều lần chạy trong cùng phiên — khởi tạo FaceLandmarker
// (tải WASM + model) khá tốn, không muốn trả giá đó lại mỗi lần bấm "Chạy thử nghiệm".
let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./culling.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

export interface RunCullingTestInWorkerOptions extends CullingPipelineOptions {
  onProgress?: (progress: CullingTestProgress) => void;
  /** Gọi ngay khi từng ảnh xử lý xong, không cần đợi cả batch — cho phép UI hiển thị
   * kết quả dần dần thay vì đứng hình tới khi xong hết. */
  onItem?: (item: CullingTestItem) => void;
}

export interface CullingWorkerRun {
  promise: Promise<CullingTestSummary>;
  abort: () => void;
}

export function runCullingTestInWorker(
  files: LocalPhotoFile[],
  options: RunCullingTestInWorkerOptions = {}
): CullingWorkerRun {
  const activeWorker = getWorker();
  const items: CullingTestItem[] = new Array(files.length);

  const promise = new Promise<CullingTestSummary>((resolve, reject) => {
    function handleMessage(event: MessageEvent<WorkerResponse>) {
      const message = event.data;
      switch (message.type) {
        case "progress":
          options.onProgress?.({
            processed: message.processed,
            total: message.total,
            currentFileName: message.currentFileName,
            elapsedMs: message.elapsedMs,
            imagesPerSecond: message.imagesPerSecond,
          });
          break;
        case "item": {
          const file = files[message.result.index];
          const item: CullingTestItem = {
            file,
            width: message.result.width,
            height: message.result.height,
            metrics: message.result.metrics,
            timingsMs: message.result.timingsMs,
            sceneSignals: message.result.sceneSignals,
            error: message.result.error,
          };
          items[message.result.index] = item;
          options.onItem?.(item);
          break;
        }
        case "done":
          cleanup();
          resolve({
            items: items.slice(0, message.itemCount),
            totalElapsedMs: message.totalElapsedMs,
            imagesPerSecond: message.imagesPerSecond,
            accelerationTier: message.accelerationTier,
            hardwareInfo: message.hardwareInfo,
          });
          break;
        case "error":
          cleanup();
          reject(new Error(message.message));
          break;
      }
    }

    function cleanup() {
      activeWorker.removeEventListener("message", handleMessage);
    }

    activeWorker.addEventListener("message", handleMessage);

    const { onProgress: _onProgress, onItem: _onItem, ...pipelineOptions } =
      options;
    const request: WorkerRequest = {
      type: "run",
      files,
      options: pipelineOptions,
    };
    activeWorker.postMessage(request);
  });

  function abort() {
    activeWorker.postMessage({ type: "abort" } satisfies WorkerRequest);
  }

  return { promise, abort };
}