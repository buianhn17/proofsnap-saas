// Bước 3.2 — tải model ONNX InsightFace về máy để chạy face detection + embedding
// server-side bằng onnxruntime-node (xem src/services/arcfaceService.js). File binary,
// không commit vào git (xem .gitignore) — chạy script này 1 lần sau khi clone repo hoặc khi
// deploy (npm run setup:face-models).
//
// Dùng gói "buffalo_sc" (bản nhẹ nhất của InsightFace model zoo, ~15 MB):
// - det_500m.onnx  — SCRFD-500M: phát hiện khuôn mặt + 5 điểm mốc (mắt, mũi, khóe miệng)
//                    dùng để căn chỉnh mặt trước khi trích embedding.
// - w600k_mbf.onnx — ArcFace MobileFaceNet huấn luyện trên WebFace600K: embedding 512 chiều.
//
// LƯU Ý BẢN QUYỀN: model pretrained của InsightFace chỉ được cấp phép cho mục đích nghiên
// cứu phi thương mại. Dùng cho sản phẩm thương mại cần liên hệ InsightFace để mua license
// (https://github.com/deepinsight/insightface#license), hoặc tự huấn luyện/đổi model khác
// cùng định dạng đầu vào/đầu ra.
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");

const MODEL_DIR = path.join(__dirname, "..", "models", "insightface");
const PACK_URL =
  "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip";

// SHA-256 của từng file trong buffalo_sc.zip (release v0.7) — chặn trường hợp file tải về
// bị hỏng/bị thay thế, vì model sai sẽ cho embedding sai mà không báo lỗi gì.
const FILES = {
  "det_500m.onnx": "5e4447f50245bbd7966bd6c0fa52938c61474a04ec7def48753668a9d8b4ea3a",
  "w600k_mbf.onnx": "9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f",
};

const MAX_REDIRECTS = 5;

// GitHub release trả 302 sang objects.githubusercontent.com — https.get không tự theo
// redirect nên phải xử lý tay.
function downloadBuffer(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft === 0) {
            reject(new Error(`GET ${url} -> quá nhiều redirect`));
            return;
          }
          resolve(downloadBuffer(new URL(res.headers.location, url).href, redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  fs.mkdirSync(MODEL_DIR, { recursive: true });

  console.log(`Đang tải ${PACK_URL}...`);
  const zip = new AdmZip(await downloadBuffer(PACK_URL));

  for (const [name, expectedHash] of Object.entries(FILES)) {
    const entry = zip.getEntry(name);
    if (!entry) throw new Error(`Không tìm thấy ${name} trong gói model`);
    const data = entry.getData();
    const actualHash = sha256(data);
    if (actualHash !== expectedHash) {
      throw new Error(`${name} sai checksum (nhận ${actualHash}, cần ${expectedHash})`);
    }
    fs.writeFileSync(path.join(MODEL_DIR, name), data);
    console.log(`Đã lưu ${name}`);
  }
  console.log(`Xong. Model đã lưu tại ${MODEL_DIR}`);
}

main().catch((err) => {
  console.error("Tải model thất bại:", err.message);
  process.exit(1);
});
