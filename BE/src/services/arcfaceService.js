// Bước 3.2 / 3.3 — phát hiện khuôn mặt + trích embedding server-side bằng InsightFace (chạy
// qua onnxruntime-node trên CPU, model tải bằng `npm run setup:face-models`):
//   1. SCRFD-500M (det_500m.onnx): bbox + 5 điểm mốc (2 mắt, mũi, 2 khóe miệng) mỗi mặt.
//   2. Căn chỉnh mặt về khung chuẩn 112x112 của ArcFace theo 5 điểm mốc (similarity
//      transform) — ArcFace được huấn luyện trên mặt đã căn chỉnh kiểu này, chỉ crop bbox
//      rồi resize sẽ làm embedding lệch đi đáng kể.
//   3. ArcFace MobileFaceNet (w600k_mbf.onnx): embedding 512 chiều, chuẩn hóa L2 để so bằng
//      cosine distance (toán tử <=> của pgvector, xem photoFaceEmbeddingModel.js).
// Thay cho face-api.js (128 chiều) trước đây — phân biệt khuôn mặt châu Á kém, khớp nhầm
// nhiều.
const ort = require("onnxruntime-node");
const sharp = require("sharp");
const path = require("node:path");

const MODEL_DIR = path.join(__dirname, "..", "..", "models", "insightface");
const DETECTOR_MODEL_PATH = path.join(MODEL_DIR, "det_500m.onnx");
const RECOGNIZER_MODEL_PATH = path.join(MODEL_DIR, "w600k_mbf.onnx");

// Ảnh được thu nhỏ (giữ tỉ lệ, pad phần thừa) về khung vuông này trước khi đưa vào SCRFD —
// kích thước mặc định InsightFace dùng cho det_500m.
const DET_INPUT_SIZE = 640;
// SCRFD dự đoán trên 3 feature map (stride 8/16/32), mỗi ô lưới có 2 anchor. Thứ tự output
// của model: [score x3, bbox x3, keypoint x3], mỗi nhóm theo đúng thứ tự stride này.
const DET_STRIDES = [8, 16, 32];
const DET_ANCHORS_PER_CELL = 2;
const NMS_IOU_THRESHOLD = 0.4;

// Detection dưới ngưỡng này thường là mặt khuất/nghiêng quá nhiều hoặc vật thể bị bắt nhầm.
const MIN_DETECTION_CONFIDENCE = 0.6;
// Khuôn mặt quá nhỏ (người đứng xa trong ảnh đám đông) cho embedding nhiễu, hay "khớp" nhầm
// với bất kỳ ai — bỏ qua thay vì lưu vào DB. Tính theo pixel cạnh ngắn của bbox, trên ảnh gốc.
const MIN_FACE_SIZE_PX = 40;

const ARCFACE_INPUT_SIZE = 112;
const EMBEDDING_DIM = 512;
// Số mặt tối đa đưa vào ArcFace trong 1 lần inference (ảnh tập thể có thể có vài chục mặt).
const RECOGNIZER_BATCH_SIZE = 16;
// Vị trí chuẩn của 5 điểm mốc trong khung 112x112 mà ArcFace được huấn luyện (giá trị
// arcface_dst trong insightface/utils/face_align.py).
const ARCFACE_REFERENCE_LANDMARKS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

let sessionsPromise = null;

// Singleton: mỗi InferenceSession tốn vài chục MB RAM và vài trăm ms để khởi tạo, chỉ tạo
// 1 lần cho cả process rồi dùng chung (session.run an toàn khi gọi song song).
function loadSessions() {
  if (!sessionsPromise) {
    const options = {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
      // w600k_mbf.onnx khai báo output cố định {1,512} trong metadata dù input nhận batch
      // động — chạy batch >1 vẫn đúng (đã kiểm chứng bằng so sánh với chạy từng mặt) nhưng
      // ORT log warning VerifyOutputSizes mỗi lần. Chỉ log từ mức error trở lên.
      logSeverityLevel: 3,
    };
    sessionsPromise = Promise.all([
      ort.InferenceSession.create(DETECTOR_MODEL_PATH, options),
      ort.InferenceSession.create(RECOGNIZER_MODEL_PATH, options),
    ])
      .then(([detector, recognizer]) => ({ detector, recognizer }))
      .catch((err) => {
        // Reset để lần gọi sau thử load lại thay vì kẹt mãi ở promise lỗi (ví dụ lần đầu
        // thiếu file model do chưa chạy `npm run setup:face-models`).
        sessionsPromise = null;
        throw err;
      });
  }
  return sessionsPromise;
}

// Decode ảnh ra raw RGB 8-bit. sharp().rotate() xoay pixel theo EXIF orientation trước —
// ảnh chụp dọc từ điện thoại/máy ảnh nếu không xoay sẽ nằm ngang, detector bỏ sót mặt.
async function decodeImage(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .rotate()
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Thu nhỏ ảnh giữ tỉ lệ cho cạnh dài = DET_INPUT_SIZE, đặt ở góc trên-trái khung vuông, phần
// còn lại pad pixel đen — giống hệt cách InsightFace chuẩn bị ảnh cho SCRFD. Chuẩn hóa
// (pixel - 127.5) / 128, NCHW, thứ tự kênh RGB.
async function buildDetectorInput(image) {
  const scale = DET_INPUT_SIZE / Math.max(image.width, image.height);
  const resizedWidth = Math.max(1, Math.round(image.width * scale));
  const resizedHeight = Math.max(1, Math.round(image.height * scale));

  const resized = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
    .resize(resizedWidth, resizedHeight, { fit: "fill" })
    .raw()
    .toBuffer();

  const plane = DET_INPUT_SIZE * DET_INPUT_SIZE;
  const input = new Float32Array(3 * plane).fill(-127.5 / 128);
  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const src = (y * resizedWidth + x) * 3;
      const dst = y * DET_INPUT_SIZE + x;
      input[dst] = (resized[src] - 127.5) / 128;
      input[plane + dst] = (resized[src + 1] - 127.5) / 128;
      input[2 * plane + dst] = (resized[src + 2] - 127.5) / 128;
    }
  }

  return {
    tensor: new ort.Tensor("float32", input, [1, 3, DET_INPUT_SIZE, DET_INPUT_SIZE]),
    scale,
  };
}

function intersectionOverUnion(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return intersection / (areaA + areaB - intersection);
}

function nonMaxSuppression(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const candidate of sorted) {
    if (kept.every((face) => intersectionOverUnion(face, candidate) <= NMS_IOU_THRESHOLD)) {
      kept.push(candidate);
    }
  }
  return kept;
}

// Giải mã output SCRFD: mỗi anchor có điểm tin cậy, khoảng cách từ tâm anchor tới 4 cạnh
// bbox và độ lệch của 5 điểm mốc (đơn vị = stride). Quy đổi ngược về tọa độ ảnh gốc.
async function detectFaceCandidates(detector, image) {
  const { tensor, scale } = await buildDetectorInput(image);
  const outputs = await detector.run({ [detector.inputNames[0]]: tensor });
  const names = detector.outputNames;

  const candidates = [];
  DET_STRIDES.forEach((stride, level) => {
    const scores = outputs[names[level]].data;
    const boxes = outputs[names[level + DET_STRIDES.length]].data;
    const keypoints = outputs[names[level + 2 * DET_STRIDES.length]].data;
    const gridWidth = Math.ceil(DET_INPUT_SIZE / stride);

    for (let i = 0; i < scores.length; i++) {
      if (scores[i] < MIN_DETECTION_CONFIDENCE) continue;

      const cell = Math.floor(i / DET_ANCHORS_PER_CELL);
      const centerX = (cell % gridWidth) * stride;
      const centerY = Math.floor(cell / gridWidth) * stride;

      const landmarks = [];
      for (let k = 0; k < 5; k++) {
        landmarks.push([
          (centerX + keypoints[i * 10 + 2 * k] * stride) / scale,
          (centerY + keypoints[i * 10 + 2 * k + 1] * stride) / scale,
        ]);
      }

      candidates.push({
        score: scores[i],
        x1: Math.max(0, (centerX - boxes[i * 4] * stride) / scale),
        y1: Math.max(0, (centerY - boxes[i * 4 + 1] * stride) / scale),
        x2: Math.min(image.width, (centerX + boxes[i * 4 + 2] * stride) / scale),
        y2: Math.min(image.height, (centerY + boxes[i * 4 + 3] * stride) / scale),
        landmarks,
      });
    }
  });

  return nonMaxSuppression(candidates).filter(
    (face) => Math.min(face.x2 - face.x1, face.y2 - face.y1) >= MIN_FACE_SIZE_PX
  );
}

// Ước lượng similarity transform (xoay + co giãn đều + tịnh tiến, bình phương tối thiểu)
// ánh xạ điểm trong khung chuẩn 112x112 -> điểm mốc tương ứng trên ảnh gốc:
//   x' = a*x - b*y + tx,   y' = b*x + a*y + ty
function estimateAlignmentTransform(landmarks) {
  const n = ARCFACE_REFERENCE_LANDMARKS.length;
  let refMeanX = 0;
  let refMeanY = 0;
  let srcMeanX = 0;
  let srcMeanY = 0;
  for (let i = 0; i < n; i++) {
    refMeanX += ARCFACE_REFERENCE_LANDMARKS[i][0] / n;
    refMeanY += ARCFACE_REFERENCE_LANDMARKS[i][1] / n;
    srcMeanX += landmarks[i][0] / n;
    srcMeanY += landmarks[i][1] / n;
  }

  let dot = 0;
  let cross = 0;
  let refVariance = 0;
  for (let i = 0; i < n; i++) {
    const rx = ARCFACE_REFERENCE_LANDMARKS[i][0] - refMeanX;
    const ry = ARCFACE_REFERENCE_LANDMARKS[i][1] - refMeanY;
    const sx = landmarks[i][0] - srcMeanX;
    const sy = landmarks[i][1] - srcMeanY;
    dot += rx * sx + ry * sy;
    cross += rx * sy - ry * sx;
    refVariance += rx * rx + ry * ry;
  }

  const a = dot / refVariance;
  const b = cross / refVariance;
  return {
    a,
    b,
    tx: srcMeanX - (a * refMeanX - b * refMeanY),
    ty: srcMeanY - (b * refMeanX + a * refMeanY),
  };
}

// Warp vùng mặt về khung 112x112 (nội suy bilinear, ngoài biên ảnh = pixel đen) và ghi thẳng
// vào buffer NCHW tại vị trí batchIndex, chuẩn hóa (pixel - 127.5) / 127.5, thứ tự kênh RGB.
function writeAlignedFace(image, landmarks, target, batchIndex) {
  const { a, b, tx, ty } = estimateAlignmentTransform(landmarks);
  const plane = ARCFACE_INPUT_SIZE * ARCFACE_INPUT_SIZE;
  const offset = batchIndex * 3 * plane;
  const { data, width, height } = image;

  const pixel = (x, y, channel) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : data[(y * width + x) * 3 + channel];

  for (let v = 0; v < ARCFACE_INPUT_SIZE; v++) {
    for (let u = 0; u < ARCFACE_INPUT_SIZE; u++) {
      const srcX = a * u - b * v + tx;
      const srcY = b * u + a * v + ty;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const fx = srcX - x0;
      const fy = srcY - y0;

      for (let c = 0; c < 3; c++) {
        const value =
          pixel(x0, y0, c) * (1 - fx) * (1 - fy) +
          pixel(x0 + 1, y0, c) * fx * (1 - fy) +
          pixel(x0, y0 + 1, c) * (1 - fx) * fy +
          pixel(x0 + 1, y0 + 1, c) * fx * fy;
        target[offset + c * plane + v * ARCFACE_INPUT_SIZE + u] = (value - 127.5) / 127.5;
      }
    }
  }
}

// Chuẩn hóa L2 (v / ||v||) — bắt buộc trước khi lưu/so khớp, để cosine distance chỉ còn phụ
// thuộc vào hướng của vector.
function l2Normalize(vector) {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const norm = Math.sqrt(sumSquares) || 1;
  return Array.from(vector, (value) => value / norm);
}

async function extractEmbeddings(recognizer, image, faces) {
  const embeddings = [];
  const plane = 3 * ARCFACE_INPUT_SIZE * ARCFACE_INPUT_SIZE;

  for (let start = 0; start < faces.length; start += RECOGNIZER_BATCH_SIZE) {
    const batch = faces.slice(start, start + RECOGNIZER_BATCH_SIZE);
    const input = new Float32Array(batch.length * plane);
    batch.forEach((face, index) => writeAlignedFace(image, face.landmarks, input, index));

    const tensor = new ort.Tensor("float32", input, [
      batch.length,
      3,
      ARCFACE_INPUT_SIZE,
      ARCFACE_INPUT_SIZE,
    ]);
    const outputs = await recognizer.run({ [recognizer.inputNames[0]]: tensor });
    const raw = outputs[recognizer.outputNames[0]].data;

    for (let i = 0; i < batch.length; i++) {
      embeddings.push(l2Normalize(raw.subarray(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM)));
    }
  }
  return embeddings;
}

/**
 * Phát hiện mọi khuôn mặt (đủ lớn, đủ tin cậy) trong 1 ảnh và trích embedding 512 chiều đã
 * chuẩn hóa L2 cho từng khuôn mặt.
 * @param {Buffer} imageBuffer ảnh JPEG/PNG/... (mọi định dạng sharp đọc được)
 * @returns {Promise<Array<{ bbox: {x:number,y:number,w:number,h:number}, score: number, embedding: number[] }>>}
 */
async function detectFaces(imageBuffer) {
  const { detector, recognizer } = await loadSessions();
  const image = await decodeImage(imageBuffer);
  const faces = await detectFaceCandidates(detector, image);
  if (faces.length === 0) return [];

  const embeddings = await extractEmbeddings(recognizer, image, faces);
  return faces.map((face, index) => ({
    bbox: {
      x: Math.round(face.x1),
      y: Math.round(face.y1),
      w: Math.round(face.x2 - face.x1),
      h: Math.round(face.y2 - face.y1),
    },
    score: face.score,
    embedding: embeddings[index],
  }));
}

/** Khuôn mặt có bounding-box lớn nhất — dùng cho ảnh selfie (giả định chủ thể chính chiếm
 * phần lớn khung hình, bỏ qua người lạ/ảnh nền phía sau nếu selfie chụp có người khác). */
function largestFace(faces) {
  if (faces.length === 0) return null;
  return faces.reduce((best, current) =>
    current.bbox.w * current.bbox.h > best.bbox.w * best.bbox.h ? current : best
  );
}

module.exports = { detectFaces, largestFace, EMBEDDING_DIM };
