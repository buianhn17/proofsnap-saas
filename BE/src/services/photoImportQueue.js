// Chạy nền các lượt nhập ảnh từ link Drive công khai (photo_imports) — chế độ LIÊN KẾT:
// không tải ảnh gốc, không nén, không upload lại; chỉ ghi mỗi ảnh 1 dòng photos trỏ tới file
// trên Drive công khai (storage = 'public_link'). Ảnh được xem/tải qua CDN ảnh của Google đúng
// cỡ cần dùng (photoFileService.js). 1.000 ảnh nhập xong trong vài giây.
//
// Trước đây chép từng ảnh (tải gốc → nén → upload Drive PTG): ~3 giây/ảnh, và API tải file
// của Google chặn IP máy chủ (trang "Sorry…" 403) khi tải hàng trăm ảnh liên tục.
//
// Trích khuôn mặt cho Face Search vẫn chạy nền sau đó (faceIndexQueue), lấy ảnh 2560px qua CDN.
// Server khởi động lại thì resumeImports() chạy tiếp lượt còn dở.
const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const importModel = require("../models/photoImportModel");
// Gọi qua object module (không destructure) để test thay được bằng bản giả
const publicDrive = require("./publicDriveService");
const faceIndexQueue = require("./faceIndexQueue");

const PROGRESS_FLUSH_EVERY = 50;
const queue = [];
const queued = new Set();
const idleWaiters = new Set();
let pumping = false;

function baseName(fileName) {
  const withoutExt = fileName.replace(/\.[^.]+$/, "").trim();
  return (withoutExt || fileName).slice(0, 255);
}

async function runImport({ id, listing }) {
  const job = await importModel.findImportForWorker(id);
  if (!job || !["queued", "running"].includes(job.status)) return;

  const album = await albumModel.findByIdForPhotographer(job.album_id, job.photographer_id);
  if (!album || album.status !== "active" || album.is_locked) {
    await importModel.finishImport(id, "failed", "Album đã khoá hoặc lưu trữ — dừng nhập ảnh");
    return;
  }

  // Lượt mới đã liệt kê sẵn lúc tạo; lượt chạy tiếp sau khi server khởi động lại thì liệt kê lại
  const source = listing ?? (await publicDrive.listPublicImages({ kind: job.source_kind, id: job.source_id }));
  const existing = new Set(await photoModel.listSourceDriveFileIds(album.id));
  const todo = source.images.filter((image) => !existing.has(image.id));
  await importModel.markRunning(id, {
    totalFiles: source.images.length,
    skippedExisting: source.images.length - todo.length,
    unsupportedCount: source.unsupportedCount,
  });

  let imported = 0;
  let skipped = 0;
  const flush = async () => {
    if (imported || skipped) await importModel.addProgress(id, { imported, skipped });
    imported = 0;
    skipped = 0;
  };

  for (let i = 0; i < todo.length; i++) {
    if (i % PROGRESS_FLUSH_EVERY === 0 && (await importModel.getStatus(id)) === "cancelled") {
      await flush();
      return;
    }
    const image = todo[i];
    try {
      const photo = await photoModel.createPhoto({
        albumId: album.id,
        driveFileId: image.id,
        originalBaseFilename: baseName(image.name),
        width: image.width,
        height: image.height,
        fileSizeBytes: image.size,
        capturedAt: image.capturedAt,
        sourceDriveFileId: image.id,
        storage: "public_link",
      });
      faceIndexQueue.enqueueFaceIndex({
        photoId: photo.id,
        photographerId: job.photographer_id,
        driveFileId: image.id,
        storage: "public_link",
      });
      imported += 1;
    } catch (error) {
      if (error.code === "23505") {
        skipped += 1; // đã có trong album (2 lượt chồng nhau hoặc file trùng trong thư mục con)
      } else {
        console.error(`Liên kết ảnh ${image.name} thất bại:`, error.message);
        await importModel.addFailed(id, { name: image.name, reason: "Không lưu được ảnh" });
      }
    }
    if ((i + 1) % PROGRESS_FLUSH_EVERY === 0) await flush();
  }
  await flush();

  const final = await importModel.findImportForWorker(id);
  if (final.status === "cancelled") return;
  const nothingWorked = todo.length > 0 && final.imported_count === 0 && final.failed_count > 0;
  await importModel.finishImport(
    id,
    nothingWorked ? "failed" : "done",
    nothingWorked ? "Không nhập được ảnh nào — xem danh sách lỗi" : null
  );
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try {
      await runImport(job);
    } catch (error) {
      console.error(`Lượt nhập ảnh ${job.id} lỗi:`, error.message);
      await importModel
        .finishImport(job.id, "failed", error.statusCode && error.statusCode < 500 ? error.message : "Lỗi máy chủ khi nhập ảnh")
        .catch(() => {});
    } finally {
      queued.delete(job.id);
    }
  }
  pumping = false;
  for (const resolve of idleWaiters) resolve();
  idleWaiters.clear();
}

function enqueueImport(importId, listing = null) {
  if (queued.has(importId)) return;
  queued.add(importId);
  queue.push({ id: importId, listing });
  pump();
}

/** Gọi 1 lần khi server khởi động. */
async function resumeImports() {
  const ids = await importModel.listResumable();
  ids.forEach((id) => enqueueImport(id));
  return ids.length;
}

/** Cho test: chờ hàng đợi chạy hết. */
function whenIdle() {
  if (!pumping && queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.add(resolve));
}

module.exports = { enqueueImport, resumeImports, whenIdle };
