const path = require("node:path");
const sharp = require("sharp");
const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const sceneModel = require("../models/sceneModel");
const burstClusterModel = require("../models/burstClusterModel");
const redis = require("../config/redis");
const { resolveSizePreset, resizeToLongEdge } = require("../services/thumbnailService");
const { saveCrops, enqueueFaceIndex } = require("../services/faceIndexQueue");
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseClientUploadId(value) {
  if (value === undefined || value === "" || value === null) return null;
  if (!UUID_PATTERN.test(value)) throw badRequest("client_upload_id không hợp lệ");
  return value.toLowerCase();
}

// Vị trí vùng cắt khuôn mặt, chuẩn hoá theo kích thước ảnh. Vùng cắt quanh mặt sát mép ảnh
// được phép tràn ra ngoài [0, 1] một chút.
function parseFaceCropRegions(value, cropCount) {
  let regions;
  try {
    regions = JSON.parse(value ?? "[]");
  } catch {
    throw badRequest("face_crop_regions không hợp lệ");
  }
  const inRange = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  const valid = Array.isArray(regions)
    && regions.length === cropCount
    && regions.every((r) => r && inRange(r.x, -1, 2) && inRange(r.y, -1, 2) && inRange(r.w, 0.0001, 3) && inRange(r.h, 0.0001, 3));
  if (!valid) throw badRequest("face_crop_regions không khớp với face_crops");
  return regions.map(({ x, y, w, h }) => ({ x, y, w, h }));
}

// Kích thước hiển thị (đã xoay theo EXIF Orientation) — hệ toạ độ của bbox khuôn mặt.
async function getDisplaySize(buffer) {
  const metadata = await sharp(buffer).metadata();
  const swapsAxes = metadata.orientation >= 5 && metadata.orientation <= 8;
  return {
    width: swapsAxes ? metadata.height : metadata.width,
    height: swapsAxes ? metadata.width : metadata.height,
  };
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
    const file = req.files?.file?.[0];
    if (!file) throw badRequest("Cần gửi một file JPG trong field 'file'");
    const extension = path.extname(file.originalname).toLowerCase();
    const isJpeg = extension === ".jpg" || extension === ".jpeg";
    const hasJpegSignature = file.buffer.length >= 3
      && file.buffer[0] === 0xff
      && file.buffer[1] === 0xd8
      && file.buffer[2] === 0xff;
    if (!isJpeg || file.mimetype !== "image/jpeg" || !hasJpegSignature) {
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

    // Trình duyệt thử lại sau khi mất mạng lúc chờ phản hồi: ảnh lần trước có thể đã tạo xong
    // — trả lại ảnh đó thay vì upload trùng.
    const clientUploadId = parseClientUploadId(req.body.client_upload_id);
    if (clientUploadId) {
      const existing = await photoModel.findByClientUploadId(album.id, clientUploadId);
      if (existing) return res.status(200).json({ photo: existing });
    }

    // Vùng cắt khuôn mặt lấy từ ảnh gốc (xem detectFacesInCrops). face_crops_provided=true
    // với 0 vùng cắt = client đã dò, ảnh không có mặt người.
    const cropFiles = req.files?.face_crops ?? [];
    const faceCropRegions = req.body.face_crops_provided === "true"
      ? parseFaceCropRegions(req.body.face_crop_regions, cropFiles.length)
      : null;

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

    const displaySize = await getDisplaySize(file.buffer);
    const photographerId = req.photographer.photographerId;

    driveFile = await uploadJpeg(photographerId, album.drive_folder_id, file);
    let photo;
    try {
      photo = await photoModel.createPhoto({
        albumId: album.id,
        driveFileId: driveFile.id,
        originalBaseFilename: getBaseFilename(file, req.body.original_base_filename),
        width: width ?? displaySize.width,
        height: height ?? displaySize.height,
        fileSizeBytes: file.size,
        capturedAt,
        sharpnessScore,
        eyeStatus,
        cullingFlag,
        sceneId,
        burstClusterId,
        isBestInCluster,
        clientUploadId,
      });
    } catch (insertError) {
      // 2 request cùng client_upload_id chạy chồng nhau: request kia đã tạo ảnh trước — xoá
      // file vừa upload thừa (khối catch ngoài), trả về ảnh đã có.
      const existing = insertError.code === "23505" && clientUploadId
        ? await photoModel.findByClientUploadId(album.id, clientUploadId)
        : null;
      if (!existing) throw insertError;
      await deleteFile(photographerId, driveFile.id).catch((cleanupError) =>
        console.error("Không thể xoá file ảnh upload trùng trên Drive:", cleanupError.message)
      );
      return res.status(200).json({ photo: existing });
    }
    // Từ đây file Drive đã thuộc về 1 dòng photos — lỗi phía sau không được xoá nó.
    driveFile = null;

    if (burstClusterId && isBestInCluster) {
      await burstClusterModel.setBestPhoto(burstClusterId, photo.id);
    }

    // Bước 3.2 — embedding khuôn mặt cho AI Face Search (Bước 3.3) trích NỀN sau khi trả lời
    // (faceIndexQueue.js), không bắt trình duyệt chờ. Vùng cắt ghi ra đĩa trước khi trả lời để
    // không mất nếu server tắt ngang; ghi lỗi thì hàng đợi dò mặt trên ảnh đã upload.
    if (faceCropRegions) {
      await saveCrops(
        photo.id,
        cropFiles.map((crop, index) => ({ buffer: crop.buffer, region: faceCropRegions[index] })),
        displaySize
      ).catch((cropError) => console.error(`Không lưu được vùng cắt khuôn mặt cho photo ${photo.id}:`, cropError.message));
    }
    enqueueFaceIndex({
      photoId: photo.id,
      photographerId,
      driveFileId: photo.drive_file_id,
      imageBuffer: faceCropRegions ? null : file.buffer,
    });

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
