const path = require("node:path");
const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const sceneModel = require("../models/sceneModel");
const burstClusterModel = require("../models/burstClusterModel");
const photoFaceEmbeddingModel = require("../models/photoFaceEmbeddingModel");
const redis = require("../config/redis");
const { resolveSizePreset, resizeToLongEdge } = require("../services/thumbnailService");
const { detectFaces } = require("../services/arcfaceService");
const {
  uploadJpeg,
  deleteFile,
  downloadFileStream,
  downloadFileBuffer,
} = require("../services/googleDriveService");

const ADMIN_THUMBNAIL_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

function badRequest(message, code = "INVALID_PHOTO") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function parseOptionalInteger(value, fieldName, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === "" || value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw badRequest(`${fieldName} không hợp lệ`);
  }
  return parsed;
}

function parseCapturedAt(value) {
  if (value === undefined || value === "" || value === null) return null;
  if (Number.isNaN(Date.parse(value))) {
    throw badRequest("captured_at phải là ngày ISO hợp lệ");
  }
  return new Date(value).toISOString();
}

function getBaseFilename(file, requestedName) {
  const sourceName = requestedName || file.originalname;
  const baseName = path.basename(sourceName, path.extname(sourceName)).trim();
  if (!baseName || baseName.length > 255) {
    throw badRequest("original_base_filename không hợp lệ");
  }
  return baseName;
}

async function list(req, res, next) {
  try {
    const album = await albumModel.findByIdForPhotographer(
      req.params.albumId,
      req.photographer.photographerId
    );
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    const photos = await photoModel.listByAlbumId(album.id);
    res.json({ photos });
  } catch (error) {
    next(error);
  }
}

async function upload(req, res, next) {
  let driveFile;
  try {
    if (!req.file) throw badRequest("Cần gửi một file JPG trong field 'file'");
    const extension = path.extname(req.file.originalname).toLowerCase();
    const isJpeg = extension === ".jpg" || extension === ".jpeg";
    const hasJpegSignature = req.file.buffer.length >= 3
      && req.file.buffer[0] === 0xff
      && req.file.buffer[1] === 0xd8
      && req.file.buffer[2] === 0xff;
    if (!isJpeg || req.file.mimetype !== "image/jpeg" || !hasJpegSignature) {
      throw badRequest("Chỉ chấp nhận file JPG/JPEG hợp lệ", "INVALID_JPEG_FILE");
    }

    const album = await albumModel.findByIdForPhotographer(
      req.params.albumId,
      req.photographer.photographerId
    );
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    if (album.status !== "active" || album.is_locked) {
      throw badRequest("Album đã bị khóa hoặc lưu trữ", "ALBUM_NOT_ACTIVE");
    }

    const sharpnessScore = parseOptionalInteger(req.body.sharpness_score, "sharpness_score", 0, 100);
    const width = parseOptionalInteger(req.body.width, "width", 1);
    const height = parseOptionalInteger(req.body.height, "height", 1);
    const capturedAt = parseCapturedAt(req.body.captured_at);
    const eyeStatus = req.body.eye_status || null;
    const cullingFlag = req.body.culling_flag || null;
    if (eyeStatus !== null && !["open", "squint", "closed"].includes(eyeStatus)) {
      throw badRequest("eye_status không hợp lệ");
    }
    if (cullingFlag !== null && !["green", "yellow", "red"].includes(cullingFlag)) {
      throw badRequest("culling_flag không hợp lệ");
    }

    // Bước 2.3 (nền) — scene_id/burst_cluster_id trỏ tới các row đã tạo trước qua
    // POST /:albumId/scenes và /:albumId/burst-clusters (AlbumCullPage gọi 2 API đó trước
    // khi upload). Xác thực chúng thuộc đúng album này trước khi gắn vào photo, tránh 1
    // photographer gắn nhầm/cố ý gắn scene của album khác.
    const sceneId = req.body.scene_id || null;
    const burstClusterId = req.body.burst_cluster_id || null;
    const isBestInCluster = req.body.is_best_in_cluster === "true" || req.body.is_best_in_cluster === true;

    if (sceneId) {
      const scene = await sceneModel.findByIdAndAlbum(sceneId, album.id);
      if (!scene) throw badRequest("scene_id không thuộc album này");
    }
    if (burstClusterId) {
      const cluster = await burstClusterModel.findByIdWithScene(burstClusterId);
      if (!cluster || (cluster.scene_album_id && cluster.scene_album_id !== album.id)) {
        throw badRequest("burst_cluster_id không thuộc album này");
      }
    }

    driveFile = await uploadJpeg(
      req.photographer.photographerId,
      album.drive_folder_id,
      req.file
    );
    const photo = await photoModel.createPhoto({
      albumId: album.id,
      driveFileId: driveFile.id,
      originalBaseFilename: getBaseFilename(req.file, req.body.original_base_filename),
      width,
      height,
      fileSizeBytes: req.file.size,
      capturedAt,
      sharpnessScore,
      eyeStatus,
      cullingFlag,
      sceneId,
      burstClusterId,
      isBestInCluster,
    });

    if (burstClusterId && isBestInCluster) {
      await burstClusterModel.setBestPhoto(burstClusterId, photo.id);
    }

    // Bước 3.2 — trích embedding khuôn mặt ngay lúc PTG upload, dùng cho AI Face Search
    // (Bước 3.3). Best-effort: ảnh không có mặt người, hoặc lỗi model, không được làm hỏng
    // luồng upload chính (ảnh vẫn đã lưu thành công lên Drive + DB) — chỉ log lỗi lại.
    try {
      const faces = await detectFaces(req.file.buffer);
      if (faces.length > 0) {
        await photoFaceEmbeddingModel.createEmbeddingsForPhoto(photo.id, faces);
      }
    } catch (faceError) {
      console.error(
        `Trích embedding khuôn mặt thất bại cho photo ${photo.id}:`,
        faceError.message
      );
    }

    res.status(201).json({ photo });
  } catch (error) {
    if (driveFile?.id) {
      try {
        await deleteFile(req.photographer.photographerId, driveFile.id);
      } catch (cleanupError) {
        console.error("Không thể rollback file ảnh trên Drive:", cleanupError.message);
      }
    }
    next(error);
  }
}

// Bước 2.2 — trang Admin xem lại ghi chú khách hàng (AlbumAnnotationsPage.tsx) cần vẽ vị trí
// đã khoanh lên đúng ảnh gốc, nhưng Admin Portal trước giờ chưa từng có endpoint nào để tải
// lại ảnh đã upload (gallery hiện tại chỉ hiện được thumbnail blob URL tạo lúc upload, mất
// ngay khi tải lại trang) — thêm route xem ảnh gốc qua Drive, không watermark vì đây là ảnh
// PTG xem cho chính mình, khác endpoint /view có watermark của Client Portal.
async function view(req, res, next) {
  try {
    const album = await albumModel.findByIdForPhotographer(
      req.params.albumId,
      req.photographer.photographerId
    );
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const photo = await photoModel.findByAlbumAndId(album.id, req.params.photoId);
    if (!photo) {
      return res.status(404).json({ error: "PHOTO_NOT_FOUND", message: "Không tìm thấy ảnh" });
    }

    // Bước hiệu năng — cùng cơ chế ?size= như Client Portal (thumbnailService.js), cache
    // trong Redis vì ảnh gốc không đổi sau upload nên TTL để dài hơn cache watermark.
    const sizePreset = resolveSizePreset(req.query.size);
    if (!sizePreset) {
      const stream = await downloadFileStream(req.photographer.photographerId, photo.drive_file_id);
      res.setHeader("Content-Type", "image/jpeg");
      stream.on("error", (err) => next(err));
      stream.pipe(res);
      return;
    }

    const cacheKey = `admin-thumb:${photo.id}:${req.query.size}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      res.setHeader("Content-Type", "image/jpeg");
      return res.send(Buffer.from(cached, "base64"));
    }

    const original = await downloadFileBuffer(req.photographer.photographerId, photo.drive_file_id);
    const resized = await resizeToLongEdge(original, sizePreset.maxEdgePx, sizePreset.quality);
    redis
      .set(cacheKey, resized.toString("base64"), "EX", ADMIN_THUMBNAIL_CACHE_TTL_SECONDS)
      .catch((err) => console.error("Lỗi ghi cache thumbnail admin:", err.message));
    res.setHeader("Content-Type", "image/jpeg");
    res.send(resized);
  } catch (error) {
    next(error);
  }
}

module.exports = { list, upload, view };
