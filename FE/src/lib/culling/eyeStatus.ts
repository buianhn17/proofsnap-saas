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
import {
  eyeOpenScore,
  faceFocusScore,
  focusCropSize,
  focusMeasure,
  grayFromRgba,
} from "./faceQuality";

const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Chỉ số landmark viền mắt trong lưới 468 điểm chuẩn của MediaPipe FaceMesh, thứ tự
// [góc ngoài, mí trên 1, mí trên 2, góc trong, mí dưới 2, mí dưới 1] — dùng công thức EAR
// gốc của Soukupová & Čech (2016).
const RIGHT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const LEFT_EYE_IDX = [362, 385, 387, 263, 373, 380];
// Toàn bộ viền 2 mắt (16 điểm mỗi mắt) — dùng xác định vùng crop đo độ nét vùng mắt.
const EYE_CONTOUR_IDX = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
  362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398,
];

// Mặt có cạnh ngắn (theo pixel ảnh phân tích) nhỏ hơn ngưỡng này bị bỏ qua hoàn toàn: quá
// ít pixel để đo độ nét/độ mở mắt tin cậy, thường là người đứng xa phía sau.
const MIN_FACE_SIZE_PX = 40;
// Mặt có chiều rộng >= tỉ lệ này so với mặt lớn nhất trong ảnh được coi là "người chính".
const MAIN_SUBJECT_MIN_WIDTH_RATIO = 0.5;

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
    // 0.6: bỏ detection rác (vật thể/hoa văn giống mặt) — trước đây hạ xuống 0.3 để bắt mặt
    // nhỏ ở xa, nhưng mặt nhỏ < MIN_FACE_SIZE_PX giờ bị loại khỏi chấm điểm, còn detection
    // giả ở ngưỡng thấp lại có thể khiến cả ảnh bị đề xuất loại oan (mặt giả "nhắm mắt").
    minFaceDetectionConfidence: 0.6,
    minFacePresenceConfidence: 0.6,
    // Blendshape eyeBlinkLeft/Right — tín hiệu nháy mắt thứ 2 ngoài EAR (faceQuality.ts).
    outputFaceBlendshapes: true,
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

interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Hộp bao (pixel, không đệm) của 1 tập landmark. */
function landmarkPixelBox(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  indices?: number[]
): PixelBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of indices ? indices.map((i) => landmarks[i]) : landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX * width,
    y: minY * height,
    width: (maxX - minX) * width,
    height: (maxY - minY) * height,
  };
}

/** Cắt 1 vùng của ảnh phân tích, thu nhỏ theo focusCropSize rồi đo focusMeasure. null nếu
 * vùng nằm ngoài ảnh/quá nhỏ. */
function measureRegionFocus(
  source: OffscreenCanvas,
  box: PixelBox
): number | null {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(source.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(source.height, Math.ceil(box.y + box.height));
  const cropWidth = x1 - x0;
  const cropHeight = y1 - y0;
  if (cropWidth < 8 || cropHeight < 6) return null;

  const size = focusCropSize(cropWidth, cropHeight);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, x0, y0, cropWidth, cropHeight, 0, 0, size.width, size.height);
  const { data } = ctx.getImageData(0, 0, size.width, size.height);
  return focusMeasure(grayFromRgba(data, size.width, size.height));
}

/** Vùng 2 mắt, đệm thêm để lấy cả mí/lông mi (chi tiết sắc nhất khi lấy nét đúng mắt). */
function eyeRegionBox(landmarks: NormalizedLandmark[], width: number, height: number): PixelBox {
  const box = landmarkPixelBox(landmarks, width, height, EYE_CONTOUR_IDX);
  const padX = box.width * 0.15;
  const padY = Math.max(box.height, box.width * 0.12);
  return {
    x: box.x - padX,
    y: box.y - padY,
    width: box.width + 2 * padX,
    height: box.height + 2 * padY,
  };
}

function blinkScoreOf(categories: { categoryName: string; score: number }[] | undefined) {
  if (!categories) return null;
  const left = categories.find((c) => c.categoryName === "eyeBlinkLeft")?.score;
  const right = categories.find((c) => c.categoryName === "eyeBlinkRight")?.score;
  if (left === undefined || right === undefined) return null;
  // Chỉ cần 1 mắt nhắm là ảnh đã hỏng -> lấy mắt "nhắm" nhiều hơn.
  return Math.max(left, right);
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
  const faceLandmarks = result.faceLandmarks ?? [];

  const candidates = faceLandmarks
    .map((landmarks, index) => ({
      landmarks,
      blendshapes: result.faceBlendshapes?.[index]?.categories,
      pixelBox: landmarkPixelBox(landmarks, width, height),
    }))
    .filter((c) => Math.min(c.pixelBox.width, c.pixelBox.height) >= MIN_FACE_SIZE_PX);
  if (candidates.length === 0) {
    return { faceCount: 0, earValue: null, faces: [] };
  }

  const largestWidth = Math.max(...candidates.map((c) => c.pixelBox.width));

  const faces: DetectedFace[] = candidates.map(({ landmarks, blendshapes, pixelBox }) => {
    const rightEar = eyeAspectRatio(landmarks, RIGHT_EYE_IDX, width, height);
    const leftEar = eyeAspectRatio(landmarks, LEFT_EYE_IDX, width, height);
    const earValue = (rightEar + leftEar) / 2;

    const faceMeasure = measureRegionFocus(image, pixelBox) ?? 0;
    const eyeMeasure = measureRegionFocus(image, eyeRegionBox(landmarks, width, height));

    return {
      earValue,
      eyeStatus: classifyEyeStatus(earValue, thresholds),
      box: computeFaceBox(landmarks),
      eyeOpenScore: eyeOpenScore(earValue, blinkScoreOf(blendshapes)),
      focusScore: faceFocusScore(faceMeasure, eyeMeasure),
      isMainSubject: pixelBox.width >= largestWidth * MAIN_SUBJECT_MIN_WIDTH_RATIO,
    };
  });

  const minEar = Math.min(...faces.map((f) => f.earValue));
  return { faceCount: faces.length, earValue: minEar, faces };
}
