// Bước 3.2 / 3.3 — trích embedding khuôn mặt server-side bằng face-api.js
// (@vladmandic/face-api chạy trên backend tfjs-node). Chạy trong Node nên KHÔNG dùng
// node-canvas (hay lỗi build theo platform) — decode ảnh thẳng qua tf.node.decodeImage
// rồi đưa tensor vào face-api, đúng cách face-api.js khuyến nghị cho môi trường Node.
const util = require("node:util");
// @tensorflow/tfjs-node (bản mới nhất, không còn được cập nhật thường xuyên) vẫn gọi các hàm
// util.is*() đã bị Node.js gỡ bỏ hẳn (không chỉ deprecate) từ Node 22+ (ví dụ
// util.isNullOrUndefined). Polyfill tối thiểu trước khi require tfjs-node, nếu không backend
// sẽ crash ngay khi cast tensor. Phải đặt TRƯỚC dòng require("@tensorflow/tfjs-node") bên dưới.
if (typeof util.isNullOrUndefined !== "function") {
  util.isNullOrUndefined = (value) => value === null || value === undefined;
}

const tf = require("@tensorflow/tfjs-node");
const faceapi = require("@vladmandic/face-api");
const path = require("node:path");

const MODEL_DIR = path.join(__dirname, "..", "..", "models", "face-api");

let modelsReadyPromise = null;

function loadModels() {
  if (!modelsReadyPromise) {
    modelsReadyPromise = Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR),
    ]).catch((err) => {
      // Reset để lần gọi sau thử load lại thay vì kẹt mãi ở promise lỗi (ví dụ lần đầu
      // thiếu file model do chưa chạy `npm run setup:face-models`).
      modelsReadyPromise = null;
      throw err;
    });
  }
  return modelsReadyPromise;
}

/**
 * Phát hiện mọi khuôn mặt trong 1 ảnh JPEG và trích embedding 128 chiều cho từng khuôn mặt.
 * @param {Buffer} jpegBuffer
 * @returns {Promise<Array<{ bbox: {x:number,y:number,w:number,h:number}, embedding: number[] }>>}
 */
async function detectFaces(jpegBuffer) {
  await loadModels();

  // Cách decode + cast float + thêm batch dim này theo đúng ví dụ Node.js chính thức của
  // @vladmandic/face-api (test/test-node.js) — pass thẳng tensor 3D chưa qua batch dim vào
  // detectAllFaces không được hỗ trợ nhất quán giữa các bản build.
  const decoded = tf.node.decodeImage(jpegBuffer, 3);
  const casted = decoded.toFloat();
  const batched = casted.expandDims(0);
  decoded.dispose();
  casted.dispose();

  try {
    const detections = await faceapi
      .detectAllFaces(batched, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    return detections.map((d) => ({
      bbox: {
        x: Math.round(d.detection.box.x),
        y: Math.round(d.detection.box.y),
        w: Math.round(d.detection.box.width),
        h: Math.round(d.detection.box.height),
      },
      embedding: Array.from(d.descriptor),
    }));
  } finally {
    batched.dispose();
  }
}

/** Khuôn mặt có bounding-box lớn nhất — dùng cho ảnh selfie (giả định chủ thể chính chiếm
 * phần lớn khung hình, bỏ qua người lạ/ảnh nền phía sau nếu selfie chụp có người khác). */
function largestFace(faces) {
  if (faces.length === 0) return null;
  return faces.reduce((best, current) =>
    current.bbox.w * current.bbox.h > best.bbox.w * best.bbox.h ? current : best
  );
}

module.exports = { detectFaces, largestFace };
