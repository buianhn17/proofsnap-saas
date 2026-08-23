// Bước 1.3/1.4 — lõi xử lý dùng chung: xử lý 1 ảnh (giải mã, độ nét, dHash, phát hiện mắt)
// và các kiểu dữ liệu chia sẻ giữa main thread và Web Worker (Bước 1.5). Bản thân module
// này KHÔNG vòng lặp qua nhiều ảnh và KHÔNG gọi postMessage — phần điều phối (vòng lặp,
// progress, hủy) thuộc về culling.worker.ts, để lõi xử lý có thể dùng lại/test độc lập.

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { LocalPhotoFile } from "../localPhotoFile";
import { computeSharpnessScore } from "./sharpness";
import { computeDHash } from "./perceptualHash";
import { detectEyeStatus, classifyEyeStatus } from "./eyeStatus";
import { readExifDateTimeOriginal } from "./exifTimestamp";
import { computeColorHistogram } from "./colorHistogram";
import type { AccelerationTier, HardwareInfo } from "./hardwareAcceleration";
import type { CullingMetrics, CullingTimingsMs, EyeStatusThresholds } from "./types";

/** Bước 1.7 — tín hiệu phục vụ gom scene/burst (xem sceneGrouping.ts), tách khỏi
 * CullingMetrics vì đây là mối quan tâm khác (nhóm ảnh) chứ không phải chấm điểm 1 ảnh. */
export interface SceneSignals {
  /** ms epoch từ EXIF DateTimeOriginal — null nếu ảnh không có EXIF/không đọc được, khi đó
   * tầng gọi nên dùng file.lastModified làm phương án dự phòng. */
  capturedAtMs: number | null;
  /** Histogram màu RGB 64 bin, đã chuẩn hoá — dùng phát hiện đổi khung hình lớn. */
  histogram: number[];
}

export interface CullingTestItem {
  file: LocalPhotoFile;
  width: number;
  height: number;
  metrics: CullingMetrics;
  timingsMs: CullingTimingsMs;
  sceneSignals: SceneSignals;
  thumbnailBlob: Blob;
  previewBlob: Blob;
  error?: string;
}

export interface CullingTestProgress {
  processed: number;
  total: number;
  currentFileName: string;
  elapsedMs: number;
  imagesPerSecond: number;
}

export interface CullingTestSummary {
  items: CullingTestItem[];
  totalElapsedMs: number;
  imagesPerSecond: number;
  accelerationTier: AccelerationTier;
  hardwareInfo: HardwareInfo;
}

export interface CullingPipelineOptions {
  /** Cạnh dài mục tiêu cho bước độ nét/hash, theo đúng yêu cầu Bước 1.3 (~800-1000px). */
  maxEdgePx?: number;
  /**
   * Cạnh dài mục tiêu RIÊNG cho bước phát hiện mắt. Cần lớn hơn maxEdgePx vì mặt ở
   * ảnh chụp xa vốn đã nhỏ trong khung gốc — nếu dùng chung bản 900px với bước nét/hash,
   * mặt co lại dưới ngưỡng MediaPipe còn nhận diện được. Đánh đổi: ảnh lớn hơn -> chậm hơn.
   */
  eyeMaxEdgePx?: number;
  eyeThresholds?: EyeStatusThresholds;
  /** Bước 1.4 — tầng tăng tốc cho bước phát hiện mắt: "gpu" (delegate WebGL) hay
   * "wasm" (delegate CPU, đa luồng nếu trang cross-origin isolated). Mặc định "gpu". */
  accelerationTier?: AccelerationTier;
  /** Cạnh dài mục tiêu cho bản preview dùng khi xem full-screen trong màn hình duyệt —
   * đủ nét để xem, nhẹ hơn nhiều so với file gốc (thường 20-40MB, full-frame). */
  previewMaxEdgePx?: number;
}

/** Vẽ lại một ImageBitmap đã decode vào canvas kích thước nhỏ hơn (giữ tỉ lệ khung). */
export function scaledCanvas(
  source: ImageBitmap,
  maxEdgePx: number
): { canvas: OffscreenCanvas; width: number; height: number } {
  const longEdge = Math.max(source.width, source.height);
  const scale = Math.min(1, maxEdgePx / longEdge);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Không tạo được canvas context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return { canvas, width, height };
}

export interface ProcessedImage {
  width: number;
  height: number;
  metrics: CullingMetrics;
  timingsMs: CullingTimingsMs;
  sceneSignals: SceneSignals;
  /** Bước hiệu năng — bản JPEG nhỏ (~900px cạnh dài, tái dùng canvas đã resize cho bước
   * độ nét) dùng làm thumbnail lưới ảnh, thay vì decode cả file gốc cho mỗi ô lưới. */
  thumbnailBlob: Blob;
  /** Bản JPEG vừa (mặc định ~2000px cạnh dài) dùng khi xem full-screen — đủ nét để đánh
   * giá bố cục/độ nét bằng mắt, nhẹ hơn nhiều so với file gốc nên chuyển ảnh mượt hơn. */
  previewBlob: Blob;
}

/** Xử lý 1 ảnh JPG (đã có File) qua cả 3 kỹ thuật. Ném lỗi nếu decode/xử lý thất bại —
 * bên gọi (vòng lặp trong worker) chịu trách nhiệm bắt lỗi và tạo item lỗi tương ứng. */
export async function processOneImage(
  file: File,
  options: CullingPipelineOptions,
  landmarker: FaceLandmarker
): Promise<ProcessedImage> {
  const maxEdgePx = options.maxEdgePx ?? 900;
  const previewMaxEdgePx = options.previewMaxEdgePx ?? 2000;
  // Bước hiệu năng — mặc định bằng previewMaxEdgePx (trước là 1600, thấp hơn hẳn bản
  // preview 2000px) vì mặt nhỏ/xa máy ảnh trong ảnh nhóm đông người cần nhiều pixel hơn để
  // detector nhận ra. Khi trùng previewMaxEdgePx, dùng lại thẳng canvas đã vẽ cho preview
  // thay vì vẽ thêm 1 canvas riêng (xem bên dưới) — vừa tăng độ phân giải, vừa đỡ tốn hơn.
  const eyeMaxEdgePx = options.eyeMaxEdgePx ?? previewMaxEdgePx;
  const itemStart = performance.now();

  const decodeStart = performance.now();
  const [full, capturedAtMs] = await Promise.all([
    createImageBitmap(file),
    readExifDateTimeOriginal(file),
  ]);
  const decodeMs = performance.now() - decodeStart;

  const { canvas, width, height } = scaledCanvas(full, maxEdgePx);
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, width, height);

  const sharpnessStart = performance.now();
  const sharpnessScore = computeSharpnessScore(imageData);
  // Bước 1.7 — tính luôn trên imageData đã có sẵn ở đây, không decode/vẽ lại canvas.
  const histogram = computeColorHistogram(imageData);
  const sharpnessMs = performance.now() - sharpnessStart;

  const hashStart = performance.now();
  const hash = computeDHash(canvas, width, height);
  const hashMs = performance.now() - hashStart;

  // Bước hiệu năng — tái dùng canvas 900px đã resize cho bước độ nét làm thumbnail lưới
  // ảnh, và vẽ thêm 1 canvas cỡ vừa cho bản preview full-screen, thay vì UI phải decode
  // file gốc (thường 20-40MB) cho mỗi ô lưới/mỗi lần chuyển ảnh.
  const thumbnailBlobPromise = canvas.convertToBlob({
    type: "image/jpeg",
    quality: 0.72,
  });
  const previewScaled = scaledCanvas(full, previewMaxEdgePx);
  const previewBlobPromise = previewScaled.canvas.convertToBlob({
    type: "image/jpeg",
    quality: 0.85,
  });

  const eyeStart = performance.now();
  const eyeScaled =
    eyeMaxEdgePx === previewMaxEdgePx
      ? previewScaled
      : scaledCanvas(full, eyeMaxEdgePx);
  const { faceCount, earValue, faces } = await detectEyeStatus(
    landmarker,
    eyeScaled.canvas,
    eyeScaled.width,
    eyeScaled.height,
    options.eyeThresholds
  );
  const eyeMs = performance.now() - eyeStart;
  full.close();

  const [thumbnailBlob, previewBlob] = await Promise.all([
    thumbnailBlobPromise,
    previewBlobPromise,
  ]);

  const totalMs = performance.now() - itemStart;

  return {
    width,
    height,
    metrics: {
      sharpnessScore,
      hash,
      faceCount,
      earValue,
      eyeStatus: classifyEyeStatus(earValue, options.eyeThresholds),
      faces,
    },
    timingsMs: {
      decode: decodeMs,
      sharpness: sharpnessMs,
      hash: hashMs,
      eye: eyeMs,
      total: totalMs,
    },
    sceneSignals: {
      capturedAtMs,
      histogram,
    },
    thumbnailBlob,
    previewBlob,
  };
}