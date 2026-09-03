// Bước 3.2 — tải trọng số model face-api.js (@vladmandic/face-api) về máy để chạy face
// detection + embedding server-side. File binary, không commit vào git (xem .gitignore) —
// chạy script này 1 lần sau khi clone repo hoặc khi deploy (npm run setup:face-models).
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const MODEL_DIR = path.join(__dirname, "..", "models", "face-api");
const BASE_URL = "https://raw.githubusercontent.com/vladmandic/face-api/master/model";

// SSD MobileNet v1 (phát hiện khuôn mặt) + Face Landmark 68 (căn chỉnh khuôn mặt trước khi
// trích embedding) + Face Recognition (embedding 128 chiều) — 3 model tối thiểu cần cho
// pipeline "phát hiện -> căn chỉnh -> trích embedding" của face-api.js.
const FILES = [
  "ssd_mobilenetv1_model-weights_manifest.json",
  "ssd_mobilenetv1_model.bin",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
];

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  for (const name of FILES) {
    const destPath = path.join(MODEL_DIR, name);
    console.log(`Đang tải ${name}...`);
    await download(`${BASE_URL}/${name}`, destPath);
  }
  console.log(`Xong. Model đã lưu tại ${MODEL_DIR}`);
}

main().catch((err) => {
  console.error("Tải model thất bại:", err.message);
  process.exit(1);
});
