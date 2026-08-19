const path = require("node:path");
const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const { uploadJpeg, deleteFile } = require("../services/googleDriveService");

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

module.exports = { list, upload };
