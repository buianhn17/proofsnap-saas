// Bước 1.5 — hợp đồng postMessage giữa main thread (cullingWorkerClient.ts) và
// Web Worker (culling.worker.ts). Chỉ chứa kiểu dữ liệu thuần (không import code chạy),
// để cả 2 phía import mà không kéo theo lib WebWorker-only hay DOM-only vào nhau.
//
// Mô hình pool: client giữ hàng đợi ảnh và phát TỪNG ẢNH cho từng worker rảnh ("process"),
// worker trả kết quả theo jobId. Worker không biết gì về cả lượt chạy (tổng số ảnh, tiến
// độ, huỷ) — phần điều phối đó nằm hết ở client.

import type { AccelerationTier, HardwareInfo } from "./hardwareAcceleration";
import type { CullingMetrics, CullingTimingsMs } from "./types";
import type { CullingPipelineOptions, SceneSignals } from "./cullingPipeline";

export type WorkerRequest =
  /** Khởi tạo FaceLandmarker cho tầng tăng tốc (worker cache lại, gọi lại nhiều lần rẻ). */
  | { type: "init"; accelerationTier: AccelerationTier }
  | {
      type: "process";
      jobId: number;
      file: File;
      /** File RAW cùng cặp (nếu có) — dùng để lấy preview nhúng thay vì decode JPEG. */
      rawFile: File | null;
      options: CullingPipelineOptions;
    };

export interface WorkerItemResult {
  width: number;
  height: number;
  metrics: CullingMetrics;
  timingsMs: CullingTimingsMs;
  sceneSignals: SceneSignals;
  thumbnailBlob: Blob;
  previewBlob: Blob;
  usedEmbeddedPreview: boolean;
  error?: string;
}

export type WorkerResponse =
  | { type: "ready"; hardwareInfo: HardwareInfo }
  | { type: "initError"; message: string }
  | { type: "result"; jobId: number; result: WorkerItemResult };
