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
import { detectFaces, type DetectedFaceBox, type FaceDetector } from "./faceDetector";
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

// Mặt có cạnh ngắn (theo pixel THẬT ở độ phân giải đã đo) nhỏ hơn ngưỡng này bị bỏ qua hoàn
// toàn: mắt chỉ 2-3 pixel, không đo được gì. Mặt từ ngưỡng này tới LOW_DETAIL_FACE_PX vẫn
// được đo nhưng chỉ dùng để gợi ý "Xem lại" (lowDetail).
const MIN_FACE_SIZE_PX = 28;
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

export function getFaceLandmarker(
  tier: AccelerationTier
): Promise<FaceLandmarker> {
  let promise = landmarkerPromises.get(tier);
  if (!promise) {
    promise = createFaceLandmarker().catch((err) => {
      // Cho phép gọi lại (ví dụ sau khi đổi cấu hình) thay vì kẹt promise lỗi vĩnh viễn.
      landmarkerPromises.delete(tier);
      throw err;
    });
    landmarkerPromises.set(tier, promise);
  }
  return promise;
}

async function createFaceLandmarker(): Promise<FaceLandmarker> {
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
      // LUÔN chạy CPU (XNNPACK), kể cả tầng "gpu": GPU giờ dành cho SCRFD (faceDetector.ts).
      // Mọi lệnh WebGL/WebGPU của mọi worker đều đi qua 1 GPU process của Chrome — đo trên
      // máy 16 luồng: landmark bằng GPU delegate (mỗi mặt 1 lần upload texture + readback,
      // ảnh tập thể ~50 lần) làm GPU process nghẽn, thêm worker còn chậm đi (4 worker 8.2
      // ảnh/s, 12 worker 6.6). Chuyển sang CPU: 8 worker 11.6 ảnh/s, 12 worker 12.1 — vùng
      // cắt mặt nhỏ (160-768px) nên CPU xử lý nhẹ, lại dùng tới phần CPU đang rảnh.
      delegate: "CPU",
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

// --- Phát hiện mặt theo ô (tiling) ---
// Detector trong face_landmarker.task là BlazeFace SHORT-RANGE: thu cả ảnh về ~128x128 rồi
// mới tìm mặt, thiết kế cho mặt to cỡ selfie. Ảnh tập thể 4 người đứng cách máy vài mét,
// mỗi mặt chỉ ~5-8% bề ngang khung -> còn ~6-10px ở 128px -> bị bỏ sót hoàn toàn. Khâu
// landmark thì không có vấn đề (crop vùng mặt ở độ phân giải gốc), chỉ khâu PHÁT HIỆN hỏng.
// Cách xử lý: chạy thêm landmarker trên các ô cắt chồng lấn — trong mỗi ô mặt chiếm tỉ lệ
// lớn hơn nhiều — rồi quy landmark về toạ độ ảnh gốc và gộp các mặt trùng nhau.

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RawFace {
  landmarks: NormalizedLandmark[];
  blendshapes?: { categoryName: string; score: number }[];
}

// Tầng 1 (luôn chạy): ô vuông cạnh = 1/2 cạnh dài ảnh, chồng 50% -> ảnh 3:2 là 3x2 = 6 ô.
// Mặt chiếm ~5% khung thành ~10% ô — đủ cho detector short-range.
const TILE_LEVEL1_FRACTION = 0.5;
const TILE_LEVEL1_OVERLAP = 0.5;
// Tầng 2 (chỉ chạy khi ảnh có mặt nhỏ — dấu hiệu ảnh tập thể đông người, có thể còn mặt
// nhỏ hơn bị sót): ô = 1/4 cạnh dài, chồng 35%. Tốn ~20+ lần chạy model nên không chạy đại trà.
const TILE_LEVEL2_FRACTION = 0.25;
const TILE_LEVEL2_OVERLAP = 0.35;
const TILE_LEVEL2_TRIGGER_FACE_WIDTH_RATIO = 0.08;
// Mặt chạm mép ô (không phải mép ảnh) là mặt bị cắt dở — landmark sai, bỏ; phần chồng lấn
// đảm bảo mặt đó nằm trọn trong 1 ô khác.
const TILE_EDGE_MARGIN = 0.01;
// 2 detection (từ 2 ô/tầng khác nhau) là cùng 1 mặt nếu IoU vượt ngưỡng này hoặc tâm của
// mặt này nằm trong hộp mặt kia.
const DUPLICATE_IOU = 0.3;

function axisPositions(length: number, tileLength: number, overlap: number): number[] {
  if (length <= tileLength) return [0];
  const stride = tileLength * (1 - overlap);
  const count = Math.ceil((length - tileLength) / stride) + 1;
  return Array.from({ length: count }, (_, i) =>
    Math.round((i * (length - tileLength)) / (count - 1))
  );
}

function tileRegions(width: number, height: number, fraction: number, overlap: number): Region[] {
  const tileSize = Math.round(Math.max(width, height) * fraction);
  const tileWidth = Math.min(width, tileSize);
  const tileHeight = Math.min(height, tileSize);
  const regions: Region[] = [];
  for (const y of axisPositions(height, tileHeight, overlap)) {
    for (const x of axisPositions(width, tileWidth, overlap)) {
      regions.push({ x, y, width: tileWidth, height: tileHeight });
    }
  }
  return regions;
}

/** Chạy landmarker trên 1 ô của ảnh, trả landmark đã quy về toạ độ chuẩn hoá của ẢNH GỐC. */
function detectInTile(
  landmarker: FaceLandmarker,
  image: OffscreenCanvas,
  region: Region,
  tileCanvas: OffscreenCanvas
): RawFace[] {
  if (tileCanvas.width !== region.width) tileCanvas.width = region.width;
  if (tileCanvas.height !== region.height) tileCanvas.height = region.height;
  const ctx = tileCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(
    image,
    region.x, region.y, region.width, region.height,
    0, 0, region.width, region.height
  );
  const result = landmarker.detect(tileCanvas);
  const touchesLeft = region.x > 0;
  const touchesTop = region.y > 0;
  const touchesRight = region.x + region.width < image.width;
  const touchesBottom = region.y + region.height < image.height;

  const faces: RawFace[] = [];
  (result.faceLandmarks ?? []).forEach((landmarks, index) => {
    const box = landmarkPixelBox(landmarks, 1, 1);
    const cutOff =
      (touchesLeft && box.x < TILE_EDGE_MARGIN) ||
      (touchesTop && box.y < TILE_EDGE_MARGIN) ||
      (touchesRight && box.x + box.width > 1 - TILE_EDGE_MARGIN) ||
      (touchesBottom && box.y + box.height > 1 - TILE_EDGE_MARGIN);
    if (cutOff) return;
    faces.push({
      landmarks: landmarks.map((p) => ({
        ...p,
        x: (region.x + p.x * region.width) / image.width,
        y: (region.y + p.y * region.height) / image.height,
      })),
      blendshapes: result.faceBlendshapes?.[index]?.categories,
    });
  });
  return faces;
}

function isDuplicate(a: PixelBox, b: PixelBox): boolean {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  if (union > 0 && inter / union > DUPLICATE_IOU) return true;
  const contains = (outer: PixelBox, inner: PixelBox) => {
    const cx = inner.x + inner.width / 2;
    const cy = inner.y + inner.height / 2;
    return cx > outer.x && cx < outer.x + outer.width && cy > outer.y && cy < outer.y + outer.height;
  };
  return contains(a, b) || contains(b, a);
}

/** Phát hiện mặt trên cả ảnh + các ô (tiling), đã gộp trùng. Detection đến trước (cả ảnh,
 * rồi tầng ô lớn, rồi tầng ô nhỏ) được giữ khi trùng. */
function detectFacesTiled(
  landmarker: FaceLandmarker,
  image: OffscreenCanvas,
  width: number,
  height: number
): RawFace[] {
  const accepted: { face: RawFace; box: PixelBox }[] = [];
  const addFaces = (faces: RawFace[]) => {
    for (const face of faces) {
      const box = landmarkPixelBox(face.landmarks, width, height);
      if (!accepted.some((a) => isDuplicate(a.box, box))) accepted.push({ face, box });
    }
  };

  const full = landmarker.detect(image);
  addFaces(
    (full.faceLandmarks ?? []).map((landmarks, index) => ({
      landmarks,
      blendshapes: full.faceBlendshapes?.[index]?.categories,
    }))
  );

  const tileCanvas = new OffscreenCanvas(1, 1);
  for (const region of tileRegions(width, height, TILE_LEVEL1_FRACTION, TILE_LEVEL1_OVERLAP)) {
    addFaces(detectInTile(landmarker, image, region, tileCanvas));
  }

  const longEdge = Math.max(width, height);
  const hasSmallFaces = accepted.some(
    (a) => a.box.width < longEdge * TILE_LEVEL2_TRIGGER_FACE_WIDTH_RATIO
  );
  if (hasSmallFaces) {
    for (const region of tileRegions(width, height, TILE_LEVEL2_FRACTION, TILE_LEVEL2_OVERLAP)) {
      addFaces(detectInTile(landmarker, image, region, tileCanvas));
    }
  }
  return accepted.map((a) => a.face);
}

// --- Đo chất lượng 1 khuôn mặt ---

interface MeasuredFace {
  earValue: number;
  eyeOpenScore: number;
  focusScore: number;
  /** Hộp đã đệm, chuẩn hoá theo ảnh (Close-up Panel). */
  box: NormalizedFaceBox;
  /** Hộp sát landmark, chuẩn hoá theo ảnh — dùng gộp trùng và xác định người chính. */
  tightBox: PixelBox;
  /** Bề rộng mặt theo pixel ở độ phân giải đã đo (ảnh gốc nếu cắt từ bản full-res). */
  sourceWidthPx: number;
}

/**
 * Đo EAR/độ mở mắt/độ nét của 1 mặt trên `canvas` chứa nó. `landmarks` chuẩn hoá theo
 * canvas đó; `toImage` quy 1 điểm về toạ độ chuẩn hoá của ẢNH; `sourcePxPerCanvasPx` > 1
 * nếu canvas là bản phóng to từ vùng cắt nhỏ hơn (để so ngưỡng theo pixel thật).
 */
function measureFace(
  canvas: OffscreenCanvas,
  landmarks: NormalizedLandmark[],
  blendshapes: RawFace["blendshapes"],
  toImage: (p: NormalizedLandmark) => { x: number; y: number },
  sourcePxPerCanvasPx = 1
): MeasuredFace | null {
  const { width, height } = canvas;
  const pixelBox = landmarkPixelBox(landmarks, width, height);
  const sourceWidthPx = pixelBox.width * sourcePxPerCanvasPx;
  if (Math.min(pixelBox.width, pixelBox.height) * sourcePxPerCanvasPx < MIN_FACE_SIZE_PX) {
    return null;
  }

  const rightEar = eyeAspectRatio(landmarks, RIGHT_EYE_IDX, width, height);
  const leftEar = eyeAspectRatio(landmarks, LEFT_EYE_IDX, width, height);
  const earValue = (rightEar + leftEar) / 2;
  const faceMeasure = measureRegionFocus(canvas, pixelBox) ?? 0;
  const eyeMeasure = measureRegionFocus(canvas, eyeRegionBox(landmarks, width, height));

  const imageLandmarks = landmarks.map((p) => ({ ...p, ...toImage(p) }));
  return {
    earValue,
    eyeOpenScore: eyeOpenScore(earValue, blinkScoreOf(blendshapes)),
    focusScore: faceFocusScore(faceMeasure, eyeMeasure),
    box: computeFaceBox(imageLandmarks),
    tightBox: landmarkPixelBox(imageLandmarks, 1, 1),
    sourceWidthPx,
  };
}

// --- Luồng chính: SCRFD tìm mặt -> cắt từng mặt -> MediaPipe landmark trên vùng cắt ---

// Mặt hẹp hơn mức này ở bản phân tích (~2000px) được cắt từ ảnh FULL-RES: ảnh tập thể cả
// lớp có mặt ~18px ở 2000px nhưng ~55px ở ảnh gốc 6048px — chỉ ở ảnh gốc mới đủ pixel cho
// landmark mắt.
const HIRES_FACE_BELOW_PX = 96;
// Vùng cắt vuông = hệ số này x cạnh lớn hộp SCRFD: mặt chiếm ~1/2 vùng cắt — đủ lớn để
// detector bên trong FaceLandmarker bắt chắc, đủ rộng để lưới landmark không chạm mép.
const CROP_CONTEXT_SCALE = 2;
// Vùng cắt nhỏ được phóng lên tối thiểu mức này (detector MediaPipe kém với input quá
// nhỏ); vùng lớn thu về tối đa mức kia (mặt vẫn > 256px — đúng thang hiệu chỉnh độ nét ở
// faceQuality.ts).
const CROP_MIN_PX = 160;
const CROP_MAX_PX = 768;
// Mặt hẹp hơn mức này (pixel thật) -> lowDetail: mắt chỉ vài pixel, kết quả nhắm mắt/độ nét
// chỉ đủ tin để đưa vào "Xem lại", không tự động loại (burstScoring.ts).
const LOW_DETAIL_FACE_PX = 80;

/** Cắt vùng quanh 1 hộp SCRFD từ `source`, chạy landmarker trên vùng cắt, đo mặt nằm giữa
 * vùng cắt. null nếu landmarker không xác nhận được mặt. */
function analyzeFaceCrop(
  landmarker: FaceLandmarker,
  source: CanvasImageSource & { width: number; height: number },
  box: DetectedFaceBox,
  cropCanvas: OffscreenCanvas
): MeasuredFace | null {
  const side = CROP_CONTEXT_SCALE * Math.max(box.width * source.width, box.height * source.height);
  const sx = (box.x + box.width / 2) * source.width - side / 2;
  const sy = (box.y + box.height / 2) * source.height - side / 2;
  const outSize = Math.round(Math.min(CROP_MAX_PX, Math.max(CROP_MIN_PX, side)));

  cropCanvas.width = outSize;
  cropCanvas.height = outSize;
  const ctx = cropCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Phần vùng cắt tràn ra ngoài ảnh để đen — drawImage tự cắt nguồn và co đích tương ứng.
  ctx.drawImage(source, sx, sy, side, side, 0, 0, outSize, outSize);

  const result = landmarker.detect(cropCanvas);
  let best: RawFace | null = null;
  let bestDist = Infinity;
  (result.faceLandmarks ?? []).forEach((landmarks, index) => {
    const b = landmarkPixelBox(landmarks, 1, 1);
    // Ảnh tập thể đứng sát nhau: vùng cắt có cả mặt hàng xóm — chỉ lấy mặt ở giữa.
    const d = Math.hypot(b.x + b.width / 2 - 0.5, b.y + b.height / 2 - 0.5);
    if (d < 0.2 && d < bestDist) {
      bestDist = d;
      best = { landmarks, blendshapes: result.faceBlendshapes?.[index]?.categories };
    }
  });
  if (!best) return null;
  const { landmarks, blendshapes } = best as RawFace;

  return measureFace(
    cropCanvas,
    landmarks,
    blendshapes,
    (p) => ({
      x: (sx + p.x * side) / source.width,
      y: (sy + p.y * side) / source.height,
    }),
    side / outSize
  );
}

// Bản full-res ảnh 24-45MP tốn ~100-180MB RAM — mỗi worker chỉ giữ 1 bản tại 1 thời điểm
// (worker chạy 2 ảnh xen kẽ, không khoá thì 2 ảnh tập thể có thể cùng giải mã full-res).
let fullResolutionLock: Promise<void> = Promise.resolve();

async function withFullResolutionLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = fullResolutionLock;
  let release!: () => void;
  fullResolutionLock = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function measureFacesWithDetector(
  detector: FaceDetector,
  landmarker: FaceLandmarker,
  image: OffscreenCanvas,
  loadFullResolution: (() => Promise<ImageBitmap>) | undefined
): Promise<MeasuredFace[]> {
  const boxes = await detectFaces(detector, image);
  const isSmall = (b: DetectedFaceBox) => b.width * image.width < HIRES_FACE_BELOW_PX;
  const cropCanvas = new OffscreenCanvas(1, 1);
  const measured: MeasuredFace[] = [];
  const add = (face: MeasuredFace | null) => {
    if (face && !measured.some((m) => isDuplicate(m.tightBox, face.tightBox))) measured.push(face);
  };

  for (const box of boxes.filter((b) => !isSmall(b))) {
    add(analyzeFaceCrop(landmarker, image, box, cropCanvas));
  }

  const smallBoxes = boxes.filter(isSmall);
  if (smallBoxes.length > 0) {
    const measureSmall = (source: CanvasImageSource & { width: number; height: number }) => {
      for (const box of smallBoxes) add(analyzeFaceCrop(landmarker, source, box, cropCanvas));
    };
    if (loadFullResolution) {
      await withFullResolutionLock(async () => {
        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await loadFullResolution();
        } catch {
          bitmap = null; // không decode được full-res — đo trên bản phân tích
        }
        try {
          measureSmall(bitmap && bitmap.width > image.width ? bitmap : image);
        } finally {
          bitmap?.close();
        }
      });
    } else {
      measureSmall(image);
    }
  }
  return measured;
}

/** Đường cũ khi không có SCRFD: MediaPipe quét cả ảnh + theo ô, đo ngay trên bản phân tích. */
function measureFacesMediaPipeOnly(
  landmarker: FaceLandmarker,
  image: OffscreenCanvas
): MeasuredFace[] {
  return detectFacesTiled(landmarker, image, image.width, image.height)
    .map(({ landmarks, blendshapes }) => measureFace(image, landmarks, blendshapes, (p) => p))
    .filter((f): f is MeasuredFace => f !== null);
}

export interface EyeDetectionResult {
  faceCount: number;
  /** EAR nhỏ nhất trong số các khuôn mặt phát hiện được (worst case — ai nhắm mắt cũng bị bắt). */
  earValue: number | null;
  /** Bước 1.8 — chi tiết từng khuôn mặt, phục vụ Close-up Panel trên ảnh nhóm đông người. */
  faces: DetectedFace[];
}

export interface EyeDetectionOptions {
  thresholds?: EyeStatusThresholds;
  /** SCRFD (faceDetector.ts) — null thì dùng detector MediaPipe theo ô. */
  detector: FaceDetector | null;
  /** Giải mã ảnh ở độ phân giải gốc (đã xoay đúng chiều, cùng khung với `image`) — chỉ gọi
   * khi có mặt quá nhỏ ở bản phân tích. */
  loadFullResolution?: () => Promise<ImageBitmap>;
}

export async function detectEyeStatus(
  landmarker: FaceLandmarker,
  image: OffscreenCanvas,
  options: EyeDetectionOptions
): Promise<EyeDetectionResult> {
  let measured: MeasuredFace[];
  if (options.detector) {
    try {
      measured = await measureFacesWithDetector(
        options.detector,
        landmarker,
        image,
        options.loadFullResolution
      );
    } catch (err) {
      // WebGPU mất thiết bị/lỗi suy luận — không để hỏng cả ảnh.
      console.warn("SCRFD lỗi, dùng detector MediaPipe cho ảnh này:", err);
      measured = measureFacesMediaPipeOnly(landmarker, image);
    }
  } else {
    measured = measureFacesMediaPipeOnly(landmarker, image);
  }
  if (measured.length === 0) {
    return { faceCount: 0, earValue: null, faces: [] };
  }

  const largestWidth = Math.max(...measured.map((m) => m.tightBox.width));
  const faces: DetectedFace[] = measured.map((m) => ({
    earValue: m.earValue,
    eyeStatus: classifyEyeStatus(m.earValue, options.thresholds),
    box: m.box,
    eyeOpenScore: m.eyeOpenScore,
    focusScore: m.focusScore,
    isMainSubject: m.tightBox.width >= largestWidth * MAIN_SUBJECT_MIN_WIDTH_RATIO,
    lowDetail: m.sourceWidthPx < LOW_DETAIL_FACE_PX,
  }));

  const minEar = Math.min(...faces.map((f) => f.earValue));
  return { faceCount: faces.length, earValue: minEar, faces };
}

