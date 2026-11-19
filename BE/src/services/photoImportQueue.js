// Chạy nền các lượt nhập ảnh từ link Drive công khai (photo_imports).
// Mỗi ảnh: tải từ Drive công khai → nén theo mức nén của album (giữ EXIF) → chép vào Drive
// của PTG như ảnh upload thường → tạo dòng photos → đưa vào hàng đợi trích khuôn mặt.
// Lượt nhập chạy lần lượt (1 lượt một lúc trên server), trong 1 lượt tải 3 ảnh song song.
// Tiến độ ghi vào DB sau từng ảnh; server khởi động lại thì resumeImports() chạy tiếp.
const sharp = require("sharp");
const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const importModel = require("../models/photoImportModel");
// Gọi qua object module (không destructure) để test thay được bằng bản giả
const publicDrive = require("./publicDriveService");
const driveService = require("./googleDriveService");
const faceIndexQueue = require("./faceIndexQueue");

const CONCURRENCY = 3;
const queue = [];
const queued = new Set();
const idleWaiters = new Set();
let pumping = false;

function importError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function displaySize(buffer) {
  const meta = await sharp(buffer).metadata();
  const swapsAxes = meta.orientation >= 5 && meta.orientation <= 8;
  return { width: swapsAxes ? meta.height : meta.width, height: swapsAxes ? meta.width : meta.height };
}

/** Nén theo mức nén của album, giữ EXIF (giờ chụp, hướng xoay) như ảnh upload từ trình duyệt. */
async function prepareJpeg(buffer, preset) {
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: 300_000_000 }).metadata();
  } catch {
    throw importError("NOT_AN_IMAGE", "File hỏng hoặc không phải ảnh");
  }
  if (meta.format !== "jpeg") throw importError("NOT_JPEG", "Không phải ảnh JPG");
  return sharp(buffer, { limitInputPixels: 300_000_000 })
    .resize({
      width: preset.max_long_edge_px,
      height: preset.max_long_edge_px,
      fit: "inside",
      withoutEnlargement: true,
    })
    .withMetadata()
    .jpeg({ quality: preset.jpeg_quality, mozjpeg: true })
    .toBuffer();
}

function baseName(fileName) {
  const withoutExt = fileName.replace(/\.[^.]+$/, "").trim();
  return (withoutExt || fileName).slice(0, 255);
}

async function importOne({ album, photographerId, preset, image }) {
  const original = await publicDrive.downloadPublicFile(image.id, { expectedSize: image.size });
  const prepared = await prepareJpeg(original, preset);
  const size = await displaySize(prepared);

  const driveFile = await driveService.uploadJpeg(photographerId, album.drive_folder_id, {
    originalname: image.name,
    buffer: prepared,
  });
  let photo;
  try {
    photo = await photoModel.createPhoto({
      albumId: album.id,
      driveFileId: driveFile.id,
      originalBaseFilename: baseName(image.name),
      width: size.width,
      height: size.height,
      fileSizeBytes: prepared.length,
      capturedAt: image.capturedAt,
      sourceDriveFileId: image.id,
    });
  } catch (error) {
    // Bản chép trên Drive của PTG không còn dòng photos nào trỏ tới → xoá cho khỏi rác
    await driveService.deleteFile(photographerId, driveFile.id).catch(() => {});
    if (error.code === "23505") throw importError("ALREADY_IMPORTED", "Ảnh đã có trong album");
    throw error;
  }
  faceIndexQueue.enqueueFaceIndex({
    photoId: photo.id,
    photographerId,
    driveFileId: photo.drive_file_id,
    imageBuffer: prepared,
  });
}

function failureReason(error) {
  if (error.code === "NOT_JPEG" || error.code === "NOT_AN_IMAGE") return error.message;
  if (error.code === "DRIVE_FILE_TOO_LARGE") return error.message;
  if (error.code === "DRIVE_NOT_PUBLIC") return "Không còn quyền xem file này trên Drive";
  if (error.code === "DRIVE_QUOTA_EXCEEDED") return "Google Drive giới hạn lượt tải";
  return "Lỗi khi tải hoặc lưu ảnh";
}

async function runImport({ id, listing }) {
  const job = await importModel.findImportForWorker(id);
  if (!job || !["queued", "running"].includes(job.status)) return;

  const album = await albumModel.findByIdForPhotographer(job.album_id, job.photographer_id);
  if (!album || album.status !== "active" || album.is_locked) {
    await importModel.finishImport(id, "failed", "Album đã khoá hoặc lưu trữ — dừng nhập ảnh");
    return;
  }
  const preset = await importModel.findCompressionPreset(album.compression_preset_id);

  // Lượt mới đã liệt kê sẵn lúc tạo; lượt chạy tiếp sau khi server khởi động lại thì liệt kê lại
  const source = listing ?? (await publicDrive.listPublicImages({ kind: job.source_kind, id: job.source_id }));
  const existing = new Set(await photoModel.listSourceDriveFileIds(album.id));
  const todo = source.images.filter((image) => !existing.has(image.id));
  await importModel.markRunning(id, {
    totalFiles: source.images.length,
    skippedExisting: source.images.length - todo.length,
    unsupportedCount: source.unsupportedCount,
  });

  let cursor = 0;
  let cancelled = false;
  const worker = async () => {
    while (cursor < todo.length && !cancelled) {
      if ((await importModel.getStatus(id)) === "cancelled") {
        cancelled = true;
        return;
      }
      const image = todo[cursor++];
      try {
        await importOne({ album, photographerId: job.photographer_id, preset, image });
        await importModel.addImported(id);
      } catch (error) {
        if (error.code === "ALREADY_IMPORTED") {
          await importModel.addSkippedExisting(id);
        } else {
          console.error(`Nhập ảnh ${image.name} thất bại:`, error.message);
          await importModel.addFailed(id, { name: image.name, reason: failureReason(error) });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, todo.length)) }, worker));

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

module.exports = { enqueueImport, resumeImports, whenIdle, prepareJpeg };
