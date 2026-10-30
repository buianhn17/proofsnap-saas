// Bước 1.3/1.4 — lõi xử lý dùng chung: xử lý 1 ảnh (giải mã, độ nét, dHash, phát hiện mắt)
// và các kiểu dữ liệu chia sẻ giữa main thread và Web Worker (Bước 1.5). Bản thân module
// này KHÔNG vòng lặp qua nhiều ảnh và KHÔNG gọi postMessage — phần điều phối (vòng lặp,
// progress, hủy) thuộc về culling.worker.ts, để lõi xử lý có thể dùng lại/test độc lập.

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { LocalPhotoFile } from "../localPhotoFile";
import { computeSharpnessScore } from "./sharpness";
import { computeDHash, computeSimilaritySignature } from "./perceptualHash";
import { detectEyeStatus, classifyEyeStatus } from "./eyeStatus";
import type { FaceDetector } from "./faceDetector";
import {
  EMPTY_METADATA,
  parseJpegHeader,
  parseMetadataFromHeader,
  readFileHeader,
  type PhotoMetadata,
} from "./exifMetadata";
import { extractEmbeddedPreview } from "./embeddedPreview";
import { computeExposure } from "./exposure";
import { computeColorHistogram } from "./colorHistogram";
import type { TimestampSource } from "./sceneGrouping";
import type { AccelerationTier, HardwareInfo } from "./hardwareAcceleration";
import type { CullingMetrics, CullingTimingsMs, EyeStatusThresholds } from "./types";

/** Bước 1.7 — tín hiệu phục vụ gom scene/burst (xem sceneGrouping.ts), tách khỏi
 * CullingMetrics vì đây là mối quan tâm khác (nhóm ảnh) chứ không phải chấm điểm 1 ảnh. */
export interface SceneSignals {
  /** ms epoch từ EXIF DateTimeOriginal (+ SubSecTimeOriginal) — null nếu ảnh không có
   * EXIF/không đọc được, khi đó tầng gọi nên dùng file.lastModified làm phương án dự phòng. */
  capturedAtMs: number | null;
  /** Độ chính xác của capturedAtMs — xem TimestampSource ở sceneGrouping.ts ("file" nghĩa là
   * không có EXIF, tầng gọi đang phải dùng file.lastModified). */
  timestampSource: TimestampSource;
  /** Thông số chụp từ EXIF (tiêu cự, khẩu độ, tốc độ, ISO) — hiển thị/tham khảo. */
  exif: Pick<PhotoMetadata, "focalLengthMm" | "fNumber" | "exposureTimeS" | "iso">;
  /** Histogram màu RGB 64 bin, đã chuẩn hoá — dùng phát hiện đổi khung hình lớn. */
  histogram: number[];
  /** Ảnh xám 16x16 chuẩn hoá (perceptualHash.ts) — so bố cục khi gom burst. Rỗng nếu lỗi. */
  signature: number[];
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
  usedEmbeddedPreview: boolean;
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
  /** Cạnh dài tối thiểu của ảnh preview nhúng trong RAW để dùng thay cho decode JPEG gốc.
   * Preview nhỏ hơn mức này (ví dụ thumbnail 160px) bị bỏ qua. Mặc định 1600 — CR3/NEF/ARW
   * thường nhúng sẵn bản ~1620x1080. */
  minEmbeddedPreviewEdgePx?: number;
}

/**
 * Vẽ lại ảnh đã decode vào canvas nhỏ hơn (giữ tỉ lệ khung), đồng thời xoay/lật theo EXIF
 * Orientation (1-8) nếu cần — dùng cho preview nhúng trong RAW, vốn là JPEG trần không mang
 * Orientation nên trình duyệt không tự xoay. Phép biến đổi theo bảng chuẩn EXIF (giống
 * blueimp-load-image). Orientation 1 (mặc định) = chỉ thu nhỏ.
 */
export function scaledCanvas(
  source: CanvasImageSource & { width: number; height: number },
  maxEdgePx: number,
  orientation = 1
): { canvas: OffscreenCanvas; width: number; height: number } {
  const longEdge = Math.max(source.width, source.height);
  const scale = Math.min(1, maxEdgePx / longEdge);
  const drawWidth = Math.max(1, Math.round(source.width * scale));
  const drawHeight = Math.max(1, Math.round(source.height * scale));
  const swapsAxes = orientation >= 5 && orientation <= 8;
  const width = swapsAxes ? drawHeight : drawWidth;
  const height = swapsAxes ? drawWidth : drawHeight;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Không tạo được canvas context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, drawWidth, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, drawWidth, drawHeight); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, drawHeight); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, drawHeight, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, drawHeight, drawWidth); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, drawWidth); break;
  }
  ctx.drawImage(source, 0, 0, drawWidth, drawHeight);
  return { canvas, width, height };
}

interface DecodedSource {
  bitmap: ImageBitmap;
  /** Orientation còn phải tự áp khi vẽ (trình duyệt đã tự xoay thì = 1). */
  pendingOrientation: number;
  metadata: PhotoMetadata;
  usedEmbeddedPreview: boolean;
}

/**
 * Lấy ảnh nguồn cho phân tích, rẻ nhất có thể:
 * 1. Có file RAW cùng cặp và RAW nhúng preview đủ lớn -> decode preview (~1600px, vài trăm
 *    KB) thay cho JPEG gốc 24-60MP. Nhanh hơn hàng chục lần.
 * 2. Không thì decode JPEG nhưng yêu cầu trình duyệt trả bitmap đã thu nhỏ sẵn
 *    (resizeWidth), không giữ bản full-res trong bộ nhớ suốt quá trình xử lý.
 * Metadata ưu tiên đọc từ JPEG (cùng 1 lần chụp với RAW), thiếu thì lấy từ RAW.
 */
async function decodeSource(
  file: File,
  rawFile: File | null,
  targetEdgePx: number,
  minEmbeddedPreviewEdgePx: number
): Promise<DecodedSource> {
  const jpegHeader = await readFileHeader(file).catch(() => new Uint8Array());
  let metadata = parseMetadataFromHeader(jpegHeader);

  if (rawFile) {
    const [preview, rawMetadata] = await Promise.all([
      extractEmbeddedPreview(rawFile, minEmbeddedPreviewEdgePx),
      metadata.capturedAtMs === null
        ? readFileHeader(rawFile).then(parseMetadataFromHeader, () => EMPTY_METADATA)
        : Promise.resolve(null),
    ]);
    if (rawMetadata) metadata = rawMetadata;
    if (preview) {
      try {
        const bitmap = await createImageBitmap(preview.blob);
        return {
          bitmap,
          // Preview có EXIF riêng -> trình duyệt đã tự xoay; không thì xoay theo metadata
          // (JPEG và RAW cùng 1 lần chụp nên Orientation như nhau).
          pendingOrientation: preview.hasOwnExif ? 1 : metadata.orientation,
          metadata,
          usedEmbeddedPreview: true,
        };
      } catch {
        // Preview hỏng/định dạng lạ — rơi xuống decode JPEG bên dưới.
      }
    }
  }

  // Kích thước SOF là chiều LƯU TRỮ; Orientation 5-8 hoán đổi rộng/cao khi hiển thị.
  const sof = jpegHeader.length
    ? parseJpegHeader(new DataView(jpegHeader.buffer, jpegHeader.byteOffset, jpegHeader.byteLength), 0)
    : null;
  let bitmap: ImageBitmap | null = null;
  if (sof && Math.max(sof.width, sof.height) > targetEdgePx) {
    const displayWidth = metadata.orientation >= 5 ? sof.height : sof.width;
    const scale = targetEdgePx / Math.max(sof.width, sof.height);
    try {
      // Chỉ truyền resizeWidth — chiều cao tự tính theo tỉ lệ, nên dù trình duyệt áp
      // resize trước hay sau khi xoay EXIF thì ảnh vẫn không bị méo.
      bitmap = await createImageBitmap(file, {
        resizeWidth: Math.max(1, Math.round(displayWidth * scale)),
        resizeQuality: "high",
      });
    } catch {
      bitmap = null; // trình duyệt không hỗ trợ resize options — decode thường
    }
  }
  bitmap ??= await createImageBitmap(file);
  // createImageBitmap mặc định imageOrientation "from-image": đã tự xoay theo EXIF JPEG.
  return { bitmap, pendingOrientation: 1, metadata, usedEmbeddedPreview: false };
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
  /** true nếu phân tích trên preview nhúng của file RAW thay vì decode JPEG. */
  usedEmbeddedPreview: boolean;
}

/** Xử lý 1 ảnh (JPG + RAW cùng cặp nếu có): decode, độ nét toàn ảnh, dHash, phơi sáng,
 * phát hiện mặt + chấm độ nét/độ mở mắt từng mặt. Ném lỗi nếu cả preview lẫn JPEG đều
 * không decode được — bên gọi (worker) chịu trách nhiệm bắt lỗi và tạo item lỗi tương ứng. */
export async function processOneImage(
  file: File,
  rawFile: File | null,
  options: CullingPipelineOptions,
  landmarker: FaceLandmarker,
  faceDetector: FaceDetector | null
): Promise<ProcessedImage> {
  const maxEdgePx = options.maxEdgePx ?? 900;
  const previewMaxEdgePx = options.previewMaxEdgePx ?? 2000;
  const minEmbeddedPreviewEdgePx = options.minEmbeddedPreviewEdgePx ?? 1600;
  // Bước hiệu năng — mặc định bằng previewMaxEdgePx vì mặt nhỏ/xa máy ảnh trong ảnh nhóm
  // đông người cần nhiều pixel hơn để detector nhận ra. Khi trùng previewMaxEdgePx, dùng lại
  // thẳng canvas đã vẽ cho preview thay vì vẽ thêm 1 canvas riêng.
  const eyeMaxEdgePx = options.eyeMaxEdgePx ?? previewMaxEdgePx;
  const itemStart = performance.now();

  const decodeStart = performance.now();
  const source = await decodeSource(
    file,
    rawFile,
    Math.max(previewMaxEdgePx, eyeMaxEdgePx),
    minEmbeddedPreviewEdgePx
  );
  // Canvas preview (đã xoay đúng chiều) là nguồn cho mọi bước sau — không vẽ lại từ bitmap
  // gốc nhiều lần.
  const previewScaled = scaledCanvas(
    source.bitmap,
    previewMaxEdgePx,
    source.pendingOrientation
  );
  const eyeScaled =
    eyeMaxEdgePx === previewMaxEdgePx
      ? previewScaled
      : scaledCanvas(source.bitmap, eyeMaxEdgePx, source.pendingOrientation);
  source.bitmap.close();
  const decodeMs = performance.now() - decodeStart;

  const { canvas, width, height } = scaledCanvas(previewScaled.canvas, maxEdgePx);
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, width, height);

  const sharpnessStart = performance.now();
  const sharpnessScore = computeSharpnessScore(imageData);
  // Bước 1.7 — tính luôn trên imageData đã có sẵn ở đây, không decode/vẽ lại canvas.
  const histogram = computeColorHistogram(imageData);
  const exposure = computeExposure(imageData);
  const sharpnessMs = performance.now() - sharpnessStart;

  const hashStart = performance.now();
  const hash = computeDHash(canvas, width, height);
  const signature = computeSimilaritySignature(canvas, width, height);
  const hashMs = performance.now() - hashStart;

  // Thumbnail lưới ảnh (900px) và preview full-screen (2000px) — UI không phải decode lại
  // file gốc (thường 20-40MB) cho mỗi ô lưới/mỗi lần chuyển ảnh.
  const thumbnailBlobPromise = canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
  const previewBlobPromise = previewScaled.canvas.convertToBlob({
    type: "image/jpeg",
    quality: 0.85,
  });

  const eyeStart = performance.now();
  const { faceCount, earValue, faces } = await detectEyeStatus(landmarker, eyeScaled.canvas, {
    thresholds: options.eyeThresholds,
    detector: faceDetector,
    // createImageBitmap mặc định tự xoay theo EXIF JPEG -> cùng khung hình với eyeScaled.
    loadFullResolution: () => createImageBitmap(file),
  });
  const eyeMs = performance.now() - eyeStart;

  const [thumbnailBlob, previewBlob] = await Promise.all([
    thumbnailBlobPromise,
    previewBlobPromise,
  ]);

  const totalMs = performance.now() - itemStart;
  const { metadata } = source;

  return {
    width,
    height,
    metrics: {
      sharpnessScore,
      exposure,
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
      capturedAtMs: metadata.capturedAtMs,
      timestampSource:
        metadata.capturedAtMs === null ? "file" : metadata.hasSubSecond ? "exif_subsec" : "exif",
      exif: {
        focalLengthMm: metadata.focalLengthMm,
        fNumber: metadata.fNumber,
        exposureTimeS: metadata.exposureTimeS,
        iso: metadata.iso,
      },
      histogram,
      signature,
    },
    usedEmbeddedPreview: source.usedEmbeddedPreview,
    thumbnailBlob,
    previewBlob,
  };
}
