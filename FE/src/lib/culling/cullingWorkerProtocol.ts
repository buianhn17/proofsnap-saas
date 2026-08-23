// Bước 1.5 — hợp đồng postMessage giữa main thread (cullingWorkerClient.ts) và
// Web Worker (culling.worker.ts). Chỉ chứa kiểu dữ liệu thuần (không import code chạy),
// để cả 2 phía import mà không kéo theo lib WebWorker-only hay DOM-only vào nhau.

import type { LocalPhotoFile } from "../localPhotoFile";
import type { AccelerationTier, HardwareInfo } from "./hardwareAcceleration";
import type { CullingMetrics, CullingTimingsMs } from "./types";
import type { CullingPipelineOptions, SceneSignals } from "./cullingPipeline";

export type WorkerRequest =
  | { type: "run"; files: LocalPhotoFile[]; options: CullingPipelineOptions }
  | { type: "abort" };

export interface WorkerItemResult {
  /** Vị trí trong mảng files đã gửi — dùng để client ghép lại với LocalPhotoFile gốc
   * (client giữ sẵn mảng đó nên không cần gửi File ngược lại qua postMessage). */
  index: number;
  width: number;
  height: number;
  metrics: CullingMetrics;
  timingsMs: CullingTimingsMs;
  sceneSignals: SceneSignals;
  thumbnailBlob: Blob;
  previewBlob: Blob;
  error?: string;
}

export type WorkerResponse =
  | {
      type: "progress";
      processed: number;
      total: number;
      currentFileName: string;
      elapsedMs: number;
      imagesPerSecond: number;
    }
  | { type: "item"; result: WorkerItemResult }
  | {
      type: "done";
      itemCount: number;
      totalElapsedMs: number;
      imagesPerSecond: number;
      accelerationTier: AccelerationTier;
      hardwareInfo: HardwareInfo;
    }
  | { type: "error"; message: string };