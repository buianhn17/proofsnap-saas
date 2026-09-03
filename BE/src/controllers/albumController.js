const path = require("node:path");
const bcrypt = require("bcryptjs");
const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const {
  createAlbumFolder,
  deleteFolder,
  uploadZipFile,
  deleteFile,
} = require("../services/googleDriveService");

const ALLOWED_UPDATE_FIELDS = new Set([
  "name",
  "pin_enabled",
  "max_selectable_photos",
  "selection_deadline",
  "watermark_enabled",
  "compression_preset_id",
  "is_minor_album",
  "is_locked",
  "status",
  // Bước 4.2 — "mở khóa tải" ZIP cho khách. zip_drive_file_id KHÔNG nằm trong whitelist này
  // (chỉ set được qua uploadZip() bên dưới, phải đi kèm 1 file .zip thật upload lên Drive).
  "download_zip_unlocked",
  "cover_photo_id",
]);

function getPhotographerId(req) {
  return req.photographer.photographerId;
}

function validateName(name) {
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 160) {
    const error = new Error("Tên album phải từ 1 đến 160 ký tự");
    error.statusCode = 400;
    error.code = "INVALID_ALBUM_NAME";
    throw error;
  }
  return name.trim();
}

function validateOptionalInteger(value, fieldName) {
  if (value === null || value === undefined) return value;
  if (!Number.isInteger(value) || value < 1) {
    const error = new Error(`${fieldName} phải là số nguyên dương hoặc null`);
    error.statusCode = 400;
    error.code = "INVALID_ALBUM_VALUE";
    throw error;
  }
  return value;
}

function validateDeadline(value) {
  if (value === null || value === undefined) return value;
  if (Number.isNaN(Date.parse(value))) {
    const error = new Error("selection_deadline phải là ngày ISO hợp lệ hoặc null");
    error.statusCode = 400;
    error.code = "INVALID_SELECTION_DEADLINE";
    throw error;
  }
  return new Date(value).toISOString();
}

function validatePreset(value) {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    const error = new Error("compression_preset_id phải là một trong các giá trị 1, 2, 3, 4");
    error.statusCode = 400;
    error.code = "INVALID_COMPRESSION_PRESET";
    throw error;
  }
  return value;
}

function validateBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    const error = new Error(`${fieldName} phải là boolean`);
    error.statusCode = 400;
    error.code = "INVALID_ALBUM_VALUE";
    throw error;
  }
  return value;
}

async function list(req, res, next) {
  try {
    const albums = await albumModel.listByPhotographerId(getPhotographerId(req));
    res.json({ albums });
  } catch (error) {
    next(error);
  }
}

async function getOne(req, res, next) {
  try {
    const album = await albumModel.findByIdForPhotographer(
      req.params.albumId,
      getPhotographerId(req)
    );
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    res.json({ album });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  let driveFolder;
  try {
    const body = req.body || {};
    const pinEnabled = body.pin_enabled !== false;
    if (pinEnabled && (typeof body.pin !== "string" || !/^\d{4,12}$/.test(body.pin))) {
      const error = new Error("PIN phải là chuỗi số từ 4 đến 12 ký tự");
      error.statusCode = 400;
      error.code = "INVALID_ALBUM_PIN";
      throw error;
    }

    const name = validateName(body.name);
    const compressionPresetId = body.compression_preset_id ?? 2;
    validatePreset(compressionPresetId);
    const maxSelectablePhotos = validateOptionalInteger(
      body.max_selectable_photos,
      "max_selectable_photos"
    );
    const selectionDeadline = validateDeadline(body.selection_deadline);
    const watermarkEnabled = body.watermark_enabled !== false;
    const isMinorAlbum = body.is_minor_album === true;
    const photographerId = getPhotographerId(req);

    driveFolder = await createAlbumFolder(photographerId, name);
    const album = await albumModel.createAlbum({
      photographerId,
      name,
      driveFolderId: driveFolder.id,
      pinEnabled,
      pinHash: pinEnabled ? await bcrypt.hash(body.pin, 12) : null,
      maxSelectablePhotos,
      selectionDeadline,
      watermarkEnabled,
      compressionPresetId,
      isMinorAlbum,
    });

    res.status(201).json({ album });
  } catch (error) {
    if (driveFolder?.id) {
      try {
        await deleteFolder(getPhotographerId(req), driveFolder.id);
      } catch (cleanupError) {
        console.error("Không thể rollback folder album trên Drive:", cleanupError.message);
      }
    }
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const photographerId = getPhotographerId(req);
    const current = await albumModel.findByIdForPhotographer(req.params.albumId, photographerId);
    if (!current) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const body = req.body || {};
    const fields = {};
    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_UPDATE_FIELDS.has(key)) continue;
      fields[key] = value;
    }

    if (fields.name !== undefined) fields.name = validateName(fields.name);
    if (fields.pin_enabled !== undefined) {
      validateBoolean(fields.pin_enabled, "pin_enabled");
      if (!fields.pin_enabled) fields.pin_hash = null;
    }
    if (body.pin !== undefined) {
      if (typeof body.pin !== "string" || !/^\d{4,12}$/.test(body.pin)) {
        const error = new Error("PIN phải là chuỗi số từ 4 đến 12 ký tự");
        error.statusCode = 400;
        error.code = "INVALID_ALBUM_PIN";
        throw error;
      }
      fields.pin_enabled = true;
      fields.pin_hash = await bcrypt.hash(body.pin, 12);
    }
    if (fields.pin_enabled === true && !fields.pin_hash && !current.pin_enabled) {
      const error = new Error("Cần cung cấp PIN khi bật bảo vệ album");
      error.statusCode = 400;
      error.code = "ALBUM_PIN_REQUIRED";
      throw error;
    }
    if (fields.max_selectable_photos !== undefined) {
      fields.max_selectable_photos = validateOptionalInteger(
        fields.max_selectable_photos,
        "max_selectable_photos"
      );
    }
    if (fields.selection_deadline !== undefined) {
      fields.selection_deadline = validateDeadline(fields.selection_deadline);
    }
    if (fields.compression_preset_id !== undefined) {
      fields.compression_preset_id = validatePreset(fields.compression_preset_id);
    }
    for (const key of ["watermark_enabled", "is_minor_album", "is_locked", "download_zip_unlocked"]) {
      if (fields[key] !== undefined) validateBoolean(fields[key], key);
    }
    if (fields.status !== undefined && !["active", "archived"].includes(fields.status)) {
      const error = new Error("status chỉ được là active hoặc archived");
      error.statusCode = 400;
      error.code = "INVALID_ALBUM_STATUS";
      throw error;
    }
    if (fields.cover_photo_id !== undefined && fields.cover_photo_id !== null) {
      const photo = await photoModel.findByAlbumAndId(current.id, fields.cover_photo_id);
      if (!photo) {
        const error = new Error("Ảnh được chọn làm đại diện không thuộc album này");
        error.statusCode = 400;
        error.code = "INVALID_COVER_PHOTO";
        throw error;
      }
    }
    delete fields.pin;

    const album = await albumModel.updateAlbum(req.params.albumId, photographerId, fields);
    res.json({ album });
  } catch (error) {
    next(error);
  }
}

// Bước 4.2 — PTG upload 1 file .zip ảnh đã hậu kỳ (retouch xong ở Lightroom/Photoshop theo
// đúng chuỗi tên file từ Bước 4.1), lưu lên Drive và gắn vào album làm nguồn ZIP ưu tiên khi
// khách tải (xem clientController.downloadZip). Album CHƯA làm bước hậu kỳ riêng thì bỏ qua
// endpoint này — khách vẫn tải được ZIP tự nén từ ảnh gốc đã chọn khi PTG mở khóa tải.
async function uploadZip(req, res, next) {
  let driveFile;
  try {
    if (!req.file) {
      const error = new Error("Cần gửi một file .zip trong field 'file'");
      error.statusCode = 400;
      error.code = "MISSING_ZIP_FILE";
      throw error;
    }
    const isZip = path.extname(req.file.originalname).toLowerCase() === ".zip";
    const hasZipSignature = req.file.buffer.length >= 4
      && req.file.buffer[0] === 0x50
      && req.file.buffer[1] === 0x4b
      && (req.file.buffer[2] === 0x03 || req.file.buffer[2] === 0x05 || req.file.buffer[2] === 0x07);
    if (!isZip || !hasZipSignature) {
      const error = new Error("Chỉ chấp nhận file .zip hợp lệ");
      error.statusCode = 400;
      error.code = "INVALID_ZIP_FILE";
      throw error;
    }

    const photographerId = getPhotographerId(req);
    const album = await albumModel.findByIdForPhotographer(req.params.albumId, photographerId);
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    driveFile = await uploadZipFile(photographerId, album.drive_folder_id, req.file);
    const updated = await albumModel.updateAlbum(album.id, photographerId, {
      zip_drive_file_id: driveFile.id,
    });

    // Dọn file .zip cũ trên Drive nếu PTG re-upload bản mới — best-effort, không chặn
    // response nếu xóa lỗi (ví dụ file cũ đã bị xóa tay từ trước).
    if (album.zip_drive_file_id && album.zip_drive_file_id !== driveFile.id) {
      try {
        await deleteFile(photographerId, album.zip_drive_file_id);
      } catch (cleanupError) {
        console.error("Không thể xóa file .zip cũ trên Drive:", cleanupError.message);
      }
    }

    res.status(201).json({ album: updated });
  } catch (error) {
    if (driveFile?.id) {
      try {
        await deleteFile(getPhotographerId(req), driveFile.id);
      } catch (cleanupError) {
        console.error("Không thể rollback file .zip trên Drive:", cleanupError.message);
      }
    }
    next(error);
  }
}

async function archive(req, res, next) {
  try {
    const album = await albumModel.archiveAlbum(req.params.albumId, getPhotographerId(req));
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    res.json({ message: "Đã lưu trữ album", album });
  } catch (error) {
    next(error);
  }
}

module.exports = { list, getOne, create, update, archive, uploadZip };
