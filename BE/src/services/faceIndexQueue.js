// Trích embedding khuôn mặt (AI Face Search) chạy NỀN sau khi upload đã trả lời xong.
//
// Trước đây việc này chạy ngay trong request upload: trình duyệt phải chờ SCRFD + ArcFace
// (CPU) xong mới tính là upload xong, và lỗi thì chỉ ghi log — ảnh vĩnh viễn thiếu trong Face
// Search. Giờ: upload lưu Drive + DB rồi trả lời ngay (photos.face_index_status = 'pending'),
// hàng đợi này xử lý dần, lỗi thì thử lại có giãn cách, quá số lần thì đánh dấu 'failed'.
//
// Vùng cắt khuôn mặt từ ảnh gốc (detectFacesInCrops) được ghi ra thư mục tạm thay vì giữ
// trong RAM: hàng đợi dài không ngốn bộ nhớ, và server khởi động lại vẫn chạy tiếp đúng các
// ảnh còn dở với đủ dữ liệu (resumePendingFaceIndex).

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const photoModel = require("../models/photoModel");
const photoFaceEmbeddingModel = require("../models/photoFaceEmbeddingModel");
const { detectFaces, detectFacesInCrops } = require("./arcfaceService");
const { downloadFileBuffer } = require("./googleDriveService");

// onnxruntime-node đã tự dùng nhiều luồng CPU cho mỗi lần chạy model — xử lý 1 ảnh mỗi lúc.
const CONCURRENCY = 1;
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];
// Ảnh không có vùng cắt (phương án dự phòng: dò mặt trên ảnh đã upload) chỉ được giữ buffer
// trong RAM khi hàng đợi còn ngắn; dài hơn thì lúc tới lượt tải lại từ Drive.
const MAX_BUFFERED_JOBS = 20;
const CROP_ROOT = path.join(os.tmpdir(), "lensproof-face-crops");

const queue = [];
const queuedIds = new Set();
let running = 0;

function cropDir(photoId) {
  return path.join(CROP_ROOT, photoId);
}

/** Ghi vùng cắt ra đĩa — gọi TRƯỚC khi trả lời upload, để chắc chắn không mất dữ liệu. */
async function saveCrops(photoId, crops, imageSize) {
  const dir = cropDir(photoId);
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(crops.map((crop, index) => fs.writeFile(path.join(dir, `${index}.jpg`), crop.buffer)));
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({ imageSize, regions: crops.map((crop) => crop.region) })
  );
}

/** null nếu ảnh không có vùng cắt đã lưu. */
async function loadCrops(photoId) {
  const dir = cropDir(photoId);
  let meta;
  try {
    meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
  } catch {
    return null;
  }
  const crops = await Promise.all(
    meta.regions.map(async (region, index) => ({
      buffer: await fs.readFile(path.join(dir, `${index}.jpg`)),
      region,
    }))
  );
  return { crops, imageSize: meta.imageSize };
}

async function removeCrops(photoId) {
  await fs.rm(cropDir(photoId), { recursive: true, force: true });
}

async function indexPhoto(job) {
  if (!(await photoModel.existsById(job.photoId))) {
    // Ảnh/album đã bị xoá trong lúc chờ.
    await removeCrops(job.photoId);
    return;
  }
  const saved = await loadCrops(job.photoId);
  let faces;
  if (saved) {
    faces = await detectFacesInCrops(saved.crops, saved.imageSize);
  } else {
    const buffer = job.imageBuffer ?? (await downloadFileBuffer(job.photographerId, job.driveFileId));
    faces = await detectFaces(buffer);
  }
  await photoFaceEmbeddingModel.createEmbeddingsForPhoto(job.photoId, faces, { replaceExisting: true });
  await photoModel.setFaceIndexStatus(job.photoId, "done");
  await removeCrops(job.photoId);
}

async function runJob(job) {
  try {
    await indexPhoto(job);
  } catch (err) {
    const attempts = await photoModel.incrementFaceIndexAttempts(job.photoId).catch(() => null);
    if (attempts === null) return;
    if (attempts >= MAX_ATTEMPTS) {
      console.error(`Trích embedding khuôn mặt thất bại hẳn cho photo ${job.photoId}:`, err.message);
      await photoModel.setFaceIndexStatus(job.photoId, "failed").catch(() => {});
      await removeCrops(job.photoId).catch(() => {});
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
    console.warn(
      `Trích embedding khuôn mặt lỗi cho photo ${job.photoId} (lần ${attempts}), thử lại sau ${delay / 1000}s:`,
      err.message
    );
    // Thử lại bằng dữ liệu đã lưu (vùng cắt trên đĩa, hoặc tải lại ảnh từ Drive).
    setTimeout(() => enqueueFaceIndex({ ...job, imageBuffer: null }), delay).unref();
  }
}

function pump() {
  while (running < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    queuedIds.delete(job.photoId);
    running += 1;
    runJob(job).finally(() => {
      running -= 1;
      pump();
    });
  }
}

/**
 * Đưa 1 ảnh vào hàng đợi. imageBuffer (tuỳ chọn): ảnh vừa upload, tránh phải tải lại từ Drive
 * khi ảnh không có vùng cắt.
 * @param {{ photoId: string, photographerId: string, driveFileId: string, imageBuffer?: Buffer|null }} job
 */
function enqueueFaceIndex(job) {
  if (queuedIds.has(job.photoId)) return;
  queuedIds.add(job.photoId);
  queue.push({
    ...job,
    imageBuffer: queue.length < MAX_BUFFERED_JOBS ? job.imageBuffer ?? null : null,
  });
  pump();
}

/** Gọi 1 lần khi server khởi động: chạy tiếp các ảnh còn 'pending' từ lần chạy trước. */
async function resumePendingFaceIndex() {
  const pending = await photoModel.listPendingFaceIndex();
  for (const photo of pending) {
    enqueueFaceIndex({
      photoId: photo.id,
      photographerId: photo.photographer_id,
      driveFileId: photo.drive_file_id,
    });
  }
  return pending.length;
}

module.exports = { saveCrops, enqueueFaceIndex, resumePendingFaceIndex };
