// Bước 1.3 — trạng thái mắt bằng MediaPipe FaceLandmarker (Tasks Vision) + eye aspect ratio (EAR).
// Tải WASM runtime từ jsdelivr (mirror 1:1 gói npm @mediapipe/tasks-vision đã cài) và model
// face_landmarker chính thức từ Google Cloud Storage — đây là 2 tài nguyên do MediaPipe công bố
// công khai, dùng trong chính hướng dẫn chính thức của họ.

import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type {
  DetectedFace,
  EyeStatus,
  EyeStatusThresholds,
  NormalizedFaceBox,
} from "./types";
import type { AccelerationTier } from "./hardwareAcceleration";

const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Chỉ số landmark viền mắt trong lưới 468 điểm chuẩn của MediaPipe FaceMesh, thứ tự
// [góc ngoài, mí trên 1, mí trên 2, góc trong, mí dưới 2, mí dưới 1] — dùng công thức EAR
// gốc của Soukupová & Čech (2016).
const RIGHT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const LEFT_EYE_IDX = [362, 385, 387, 263, 373, 380];

export const DEFAULT_EYE_THRESHOLDS: EyeStatusThresholds = {
  closedBelow: 0.15,
  squintBelow: 0.22,
};

// Bước 1.4 — cache riêng theo từng tầng tăng tốc (thay vì 1 singleton auto-fallback im lặng
// như trước) để công cụ test có thể chủ động chạy CẢ HAI tầng lần lượt và so sánh số liệu,
// đúng yêu cầu "đo lại tốc độ ở cả 2 tầng" thay vì chỉ âm thầm chọn 1 tầng rồi thôi.
const landmarkerPromises = new Map<AccelerationTier, Promise<FaceLandmarker>>();

const DELEGATE_BY_TIER: Record<AccelerationTier, "GPU" | "CPU"> = {
  gpu: "GPU",
  wasm: "CPU",
};

export function getFaceLandmarker(
  tier: AccelerationTier
): Promise<FaceLandmarker> {
  let promise = landmarkerPromises.get(tier);
  if (!promise) {
    promise = createFaceLandmarker(tier).catch((err) => {
      // Cho phép gọi lại (ví dụ sau khi đổi cấu hình) thay vì kẹt promise lỗi vĩnh viễn.
      landmarkerPromises.delete(tier);
      throw err;
    });
    landmarkerPromises.set(tier, promise);
  }
  return promise;
}

async function createFaceLandmarker(
  tier: AccelerationTier
): Promise<FaceLandmarker> {
  // Bước 1.5 — hàm này giờ chỉ chạy trong culling.worker.ts (module worker). Emscripten
  // glue script mặc định (useModule=false) nạp bằng importScripts()/<script> tag; trong
  // module worker, importScripts() ném TypeError và MediaPipe fallback sang import() động
  // — nhưng file glue mặc định không tương thích ESM nên self.ModuleFactory không được set
  // ("ModuleFactory not set."). useModule=true chọn biến thể vision_wasm_module_internal.js
  // tương thích với import() động.
  const filesetResolver = await FilesetResolver.forVisionTasks(
    WASM_BASE_URL,
    true
  );
  return FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: DELEGATE_BY_TIER[tier],
    },
    runningMode: "IMAGE",
    // Bước 1.8 — nâng lên 20 để không bỏ sót mặt trong ảnh nhóm đông người (Close-up Panel).
    numFaces: 20,
    // Bước hiệu năng — hạ từ mặc định 0.5 xuống 0.3 để bắt thêm mặt nhỏ/ở biên khung hình
    // (ảnh nhóm đông người, người đứng xa máy ảnh) — đánh đổi lấy khả năng dương tính giả
    // cao hơn một chút, chấp nhận được vì đây là gợi ý duyệt, không phải quyết định cuối.
    minFaceDetectionConfidence: 0.3,
    minFacePresenceConfidence: 0.3,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

function dist(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  width: number,
  height: number
) {
  const dx = (a.x - b.x) * width;
  const dy = (a.y - b.y) * height;
  return Math.sqrt(dx * dx + dy * dy);
}

function eyeAspectRatio(
  landmarks: NormalizedLandmark[],
  idx: number[],
  width: number,
  height: number
): number {
  const [p1, p2, p3, p4, p5, p6] = idx.map((i) => landmarks[i]);
  const vertical =
    dist(p2, p6, width, height) + dist(p3, p5, width, height);
  const horizontal = dist(p1, p4, width, height);
  if (horizontal === 0) return 0;
  return vertical / (2 * horizontal);
}

export function classifyEyeStatus(
  earValue: number | null,
  thresholds: EyeStatusThresholds = DEFAULT_EYE_THRESHOLDS
): EyeStatus {
  if (earValue === null) return "no_face";
  if (earValue < thresholds.closedBelow) return "closed";
  if (earValue < thresholds.squintBelow) return "squint";
  return "open";
}

// Bước 1.8 — hộp bao khuôn mặt từ toàn bộ 478 điểm landmark (min/max x,y), cộng biên rộng
// ra vì lưới landmark chỉ bám sát các đặc điểm khuôn mặt (mắt/mũi/miệng/viền hàm), crop
// đúng khung đó sẽ cắt mất tóc/cằm — cần đệm thêm để có 1 close-up nhìn tự nhiên.
const FACE_BOX_PADDING_RATIO = 0.35;

function computeFaceBox(landmarks: NormalizedLandmark[]): NormalizedFaceBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;
  const padX = rawWidth * FACE_BOX_PADDING_RATIO;
  const padY = rawHeight * FACE_BOX_PADDING_RATIO;
  const x0 = Math.max(0, minX - padX);
  const y0 = Math.max(0, minY - padY);
  const x1 = Math.min(1, maxX + padX);
  const y1 = Math.min(1, maxY + padY);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export interface EyeDetectionResult {
  faceCount: number;
  /** EAR nhỏ nhất trong số các khuôn mặt phát hiện được (worst case — ai nhắm mắt cũng bị bắt). */
  earValue: number | null;
  /** Bước 1.8 — chi tiết từng khuôn mặt, phục vụ Close-up Panel trên ảnh nhóm đông người. */
  faces: DetectedFace[];
}

export async function detectEyeStatus(
  landmarker: FaceLandmarker,
  image: OffscreenCanvas,
  width: number,
  height: number,
  thresholds?: EyeStatusThresholds
): Promise<EyeDetectionResult> {
  const result = landmarker.detect(image);
  const faceLandmarks = result.faceLandmarks;
  if (!faceLandmarks || faceLandmarks.length === 0) {
    return { faceCount: 0, earValue: null, faces: [] };
  }

  const faces: DetectedFace[] = faceLandmarks.map((landmarks) => {
    const rightEar = eyeAspectRatio(landmarks, RIGHT_EYE_IDX, width, height);
    const leftEar = eyeAspectRatio(landmarks, LEFT_EYE_IDX, width, height);
    const earValue = (rightEar + leftEar) / 2;
    return {
      earValue,
      eyeStatus: classifyEyeStatus(earValue, thresholds),
      box: computeFaceBox(landmarks),
    };
  });

  const minEar = Math.min(...faces.map((f) => f.earValue));
  return { faceCount: faces.length, earValue: minEar, faces };
}