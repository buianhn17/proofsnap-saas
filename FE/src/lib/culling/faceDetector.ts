// Phát hiện khuôn mặt bằng SCRFD-10G (InsightFace, det_10g.onnx) qua ONNX Runtime Web —
// thay cho detector BlazeFace short-range nằm trong FaceLandmarker của MediaPipe.
//
// Vì sao: BlazeFace short-range thu cả ảnh về ~128px, thiết kế cho mặt cỡ selfie — ảnh tập
// thể cả lớp (~50 người, mỗi mặt ~1% bề ngang khung) nó không thấy mặt nào. SCRFD được huấn
// luyện cho ảnh đám đông (WIDER FACE), bắt được mặt ~10px ở kích thước input. Đo trên ảnh
// tập thể thật 6048x4024 (54 người, mặt ~55px ở ảnh gốc): input 1280/1600/2016px đều bắt
// đủ 53-54 mặt.
//
// Model chạy bằng WebGPU nếu có (rơi về WASM CPU nếu không). File model không commit vào
// git — tải bằng `npm run setup:culling-models` (scripts/downloadCullingModels.mjs). Thiếu
// file thì getFaceDetector() trả null và eyeStatus.ts dùng lại đường MediaPipe cũ.
//
// LƯU Ý BẢN QUYỀN: model pretrained InsightFace chỉ cấp phép phi thương mại — giữ đúng hợp
// đồng input/output SCRFD (xem decode bên dưới) để thay bằng model tự huấn luyện sau này.

import * as ort from "onnxruntime-web/webgpu";
import type { AccelerationTier } from "./hardwareAcceleration";

// WASM runtime lấy từ jsdelivr đúng phiên bản gói npm đang cài (giống cách MediaPipe tải
// runtime ở eyeStatus.ts) — tránh phụ thuộc cách Vite xử lý file .wasm trong worker.
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
// Pool đã chạy nhiều worker song song (cullingWorkerClient.ts) — mỗi worker thêm luồng WASM
// riêng chỉ làm tranh chấp CPU.
ort.env.wasm.numThreads = 1;

export const SCRFD_MODEL_URL = "/models/det_10g.onnx";

/** Cạnh dài ảnh đưa vào SCRFD. Ảnh tập thể 54 người bắt đủ mặt ở cả 1280 lẫn 1600, nhưng
 * 1280 ít hơn ~36% pixel — đo cả pipeline 8 worker: 5.7 -> 7.5 ảnh/s. */
const INPUT_LONG_EDGE = 1280;
const SCORE_THRESHOLD = 0.5;
const NMS_IOU = 0.4;
// Cấu hình chuẩn của SCRFD-10G: 3 tầng feature (stride 8/16/32), 2 anchor mỗi ô. Output
// theo đúng thứ tự [score x3, bbox x3, kps x3] (giống insightface/model_zoo/scrfd.py).
const STRIDES = [8, 16, 32];
const ANCHORS_PER_CELL = 2;

export type FaceDetector = ort.InferenceSession;

/** Hộp mặt chuẩn hoá 0-1 theo kích thước ảnh nguồn. */
export interface DetectedFaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

const sessions = new Map<AccelerationTier, Promise<FaceDetector | null>>();

/** Session SCRFD dùng chung trong 1 worker. null nếu không tải được model (thiếu file,
 * trình duyệt lỗi) — tầng gọi rơi về detector MediaPipe. */
export function getFaceDetector(tier: AccelerationTier): Promise<FaceDetector | null> {
  let promise = sessions.get(tier);
  if (!promise) {
    promise = ort.InferenceSession.create(SCRFD_MODEL_URL, {
      executionProviders: tier === "gpu" ? ["webgpu", "wasm"] : ["wasm"],
      graphOptimizationLevel: "all",
      // 3 = error. det_10g khai báo shape output cố định cho input 640x640 — mỗi lần chạy
      // input khác cỡ ORT in cảnh báo VerifyOutputSizes (bằng console.error, đỏ cả Console)
      // dù kết quả đúng.
      logSeverityLevel: 3,
    }).catch((err: unknown) => {
      console.warn("Không tải được SCRFD, dùng detector MediaPipe:", err);
      return null;
    });
    sessions.set(tier, promise);
  }
  return promise;
}

interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

function iou(a: Detection, b: Detection): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
}

function nms(detections: Detection[]): Detection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (kept.every((k) => iou(k, d) <= NMS_IOU)) kept.push(d);
  }
  return kept;
}

// ONNX Runtime Web KHÔNG cho gọi run() song song trên cùng 1 session — với WebGPU, lượt gọi
// thứ 2 chen vào khi lượt đầu chưa xong làm cả 2 treo vĩnh viễn, không ném lỗi (đã tái hiện:
// worker chạy 2 ảnh xen kẽ, xem JOBS_IN_FLIGHT_PER_WORKER ở cullingWorkerClient.ts). Xếp
// hàng mọi lượt run theo từng session.
const runQueues = new WeakMap<FaceDetector, Promise<unknown>>();

function runExclusive<T>(detector: FaceDetector, fn: () => Promise<T>): Promise<T> {
  const previous = runQueues.get(detector) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Hàng đợi chỉ cần biết lượt trước đã kết thúc (thành công hay lỗi đều được).
  runQueues.set(detector, next.catch(() => undefined));
  return next;
}

export async function detectFaces(
  detector: FaceDetector,
  image: CanvasImageSource & { width: number; height: number }
): Promise<DetectedFaceBox[]> {
  const scale = Math.min(1, INPUT_LONG_EDGE / Math.max(image.width, image.height));
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  // Kích thước input phải chia hết cho stride lớn nhất; phần đệm phải/dưới để đen (RGB 0)
  // như insightface.
  const inputWidth = Math.ceil(drawWidth / 32) * 32;
  const inputHeight = Math.ceil(drawHeight / 32) * 32;

  const canvas = new OffscreenCanvas(inputWidth, inputHeight);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, drawWidth, drawHeight);
  const { data } = ctx.getImageData(0, 0, inputWidth, inputHeight);

  // NCHW, RGB, (pixel - 127.5) / 128.
  const plane = inputWidth * inputHeight;
  const input = new Float32Array(3 * plane);
  for (let p = 0, i = 0; p < plane; p += 1, i += 4) {
    input[p] = (data[i] - 127.5) / 128;
    input[plane + p] = (data[i + 1] - 127.5) / 128;
    input[2 * plane + p] = (data[i + 2] - 127.5) / 128;
  }

  const outputs = await runExclusive(detector, () =>
    detector.run({
      [detector.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, inputHeight, inputWidth]),
    })
  );

  const detections: Detection[] = [];
  STRIDES.forEach((stride, level) => {
    const scores = outputs[detector.outputNames[level]].data as Float32Array;
    const boxes = outputs[detector.outputNames[level + STRIDES.length]].data as Float32Array;
    const cellsPerRow = inputWidth / stride;
    for (let a = 0; a < scores.length; a += 1) {
      if (scores[a] < SCORE_THRESHOLD) continue;
      const cell = Math.floor(a / ANCHORS_PER_CELL);
      const cx = (cell % cellsPerRow) * stride;
      const cy = Math.floor(cell / cellsPerRow) * stride;
      detections.push({
        x1: cx - boxes[a * 4] * stride,
        y1: cy - boxes[a * 4 + 1] * stride,
        x2: cx + boxes[a * 4 + 2] * stride,
        y2: cy + boxes[a * 4 + 3] * stride,
        score: scores[a],
      });
    }
  });
  for (const tensor of Object.values(outputs)) tensor.dispose();

  return nms(detections).map((d) => {
    const x1 = Math.max(0, d.x1 / drawWidth);
    const y1 = Math.max(0, d.y1 / drawHeight);
    const x2 = Math.min(1, d.x2 / drawWidth);
    const y2 = Math.min(1, d.y2 / drawHeight);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1, score: d.score };
  });
}
