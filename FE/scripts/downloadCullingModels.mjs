// Tải model SCRFD-10G (InsightFace, gói buffalo_l) cho bước phát hiện khuôn mặt trong
// culling worker (src/lib/culling/faceDetector.ts). File binary ~16MB, không commit vào git
// (xem .gitignore) — chạy 1 lần sau khi clone repo hoặc khi deploy:
//   npm run setup:culling-models
// Thiếu file thì culling vẫn chạy, chỉ rơi về detector MediaPipe (bỏ sót mặt nhỏ trong ảnh
// tập thể đông người).
//
// LƯU Ý BẢN QUYỀN: model pretrained của InsightFace chỉ được cấp phép cho mục đích nghiên
// cứu phi thương mại (https://github.com/deepinsight/insightface#license).
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "models");
const MODELS = [
  {
    name: "det_10g.onnx",
    url: "https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/det_10g.onnx",
    // SHA-256 của det_10g.onnx trong buffalo_l — chặn file tải về hỏng/bị thay thế.
    sha256: "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91",
  },
];

await mkdir(MODEL_DIR, { recursive: true });
for (const model of MODELS) {
  console.log(`Đang tải ${model.url}...`);
  const res = await fetch(model.url);
  if (!res.ok) throw new Error(`GET ${model.url} -> HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const hash = createHash("sha256").update(data).digest("hex");
  if (hash !== model.sha256) {
    throw new Error(`${model.name} sai checksum (nhận ${hash}, cần ${model.sha256})`);
  }
  await writeFile(path.join(MODEL_DIR, model.name), data);
  console.log(`Đã lưu ${model.name}`);
}
console.log(`Xong. Model đã lưu tại ${MODEL_DIR}`);
