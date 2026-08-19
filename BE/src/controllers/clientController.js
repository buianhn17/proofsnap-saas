const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const clientModel = require("../models/clientModel");
const redis = require("../config/redis");
const { applyWatermark } = require("../services/watermarkService");
const { downloadFileStream, downloadFileBuffer } = require("../services/googleDriveService");

const WATERMARK_CACHE_TTL_SECONDS = 60 * 60 * 24;

function invalidAccess(message, code = "INVALID_CLIENT_ACCESS") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function publicAlbum(album) {
  const { pin_hash: ignoredPinHash, drive_folder_id: ignoredDriveFolderId, ...safeAlbum } = album;
  return safeAlbum;
}

function validateClientIdentity(name, phone) {
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 120) {
    throw invalidAccess("Tên khách hàng phải từ 1 đến 120 ký tự", "INVALID_CLIENT_NAME");
  }
  if (typeof phone !== "string" || !/^[+0-9 ()-]{8,25}$/.test(phone.trim())) {
    throw invalidAccess("Số điện thoại khách hàng không hợp lệ", "INVALID_CLIENT_PHONE");
  }
  return { name: name.trim(), phone: phone.trim() };
}

function setClientCookie(res, token) {
  res.cookie("client_session_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function watermarkCacheKey(photoId, name, phone) {
  const identity = crypto.createHash("sha256").update(`${name}|${phone}`).digest("hex");
  return `watermark:${photoId}:${identity}`;
}

async function verifyPin(req, res, next) {
  try {
    const album = await albumModel.findPublicById(req.params.albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    if (album.is_locked) {
      return res.status(423).json({ error: "ALBUM_LOCKED", message: "Album đã bị khóa" });
    }

    const { pin, name, phone } = req.body || {};
    if (album.pin_enabled && (typeof pin !== "string" || !(await bcrypt.compare(pin, album.pin_hash)))) {
      return res.status(401).json({ error: "INVALID_ALBUM_PIN", message: "Mã PIN không đúng" });
    }
    const identity = validateClientIdentity(name, phone);
    const token = jwt.sign(
      {
        role: "client",
        albumId: album.id,
        clientName: identity.name,
        clientPhone: identity.phone,
      },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );
    setClientCookie(res, token);
    res.json({
      message: "Đã truy cập album",
      client: { name: identity.name, phone: identity.phone },
      album: publicAlbum(album),
    });
  } catch (error) {
    next(error);
  }
}

async function getAlbum(req, res, next) {
  try {
    const album = await albumModel.findPublicById(req.params.albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    res.json({ album: publicAlbum(album), client: { name: req.client.clientName, phone: req.client.clientPhone } });
  } catch (error) {
    next(error);
  }
}

async function listPhotos(req, res, next) {
  try {
    const { albumId } = req.params;
    if (req.client.albumId !== albumId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Phiên không thuộc album này" });
    }

    const album = await albumModel.findPublicById(albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const photos = await photoModel.listByAlbumId(albumId);
    // Không trả drive_file_id / các trường chấm điểm nội bộ (sharpness_score,
    // eye_status, culling_flag...) cho client - đó là dữ liệu làm việc của PTG.
    const publicPhotos = photos.map(
      ({ id, original_base_filename, width, height, created_at }) => ({
        id,
        original_base_filename,
        width,
        height,
        created_at,
      })
    );
    res.json({ photos: publicPhotos });
  } catch (error) {
    next(error);
  }
}

async function viewPhoto(req, res, next) {
  try {
    const { albumId, photoId } = req.params;
    if (req.client.albumId !== albumId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Phiên không thuộc album này" });
    }

    const album = await albumModel.findPublicById(albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const photo = await photoModel.findByAlbumAndId(albumId, photoId);
    if (!photo) {
      return res.status(404).json({ error: "PHOTO_NOT_FOUND", message: "Không tìm thấy ảnh" });
    }

    if (!album.watermark_enabled) {
      const stream = await downloadFileStream(album.photographer_id, photo.drive_file_id);
      res.setHeader("Content-Type", "image/jpeg");
      stream.on("error", (err) => next(err));
      stream.pipe(res);
      return;
    }

    const cacheKey = watermarkCacheKey(photoId, req.client.clientName, req.client.clientPhone);
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      res.setHeader("Content-Type", "image/jpeg");
      return res.send(Buffer.from(cached, "base64"));
    }

    const original = await downloadFileBuffer(album.photographer_id, photo.drive_file_id);
    const watermarked = await applyWatermark(
      original,
      `${req.client.clientName} • ${req.client.clientPhone}`
    );

    redis
      .set(cacheKey, watermarked.toString("base64"), "EX", WATERMARK_CACHE_TTL_SECONDS)
      .catch((err) => console.error("Lỗi ghi cache watermark:", err.message));

    res.setHeader("Content-Type", "image/jpeg");
    res.send(watermarked);
  } catch (error) {
    next(error);
  }
}

async function toggleSelection(req, res, next) {
  try {
    const { albumId, photoId } = req.params;
    if (req.client.albumId !== albumId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Phiên không thuộc album này" });
    }

    const album = await albumModel.findPublicById(albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const photo = await photoModel.findByAlbumAndId(albumId, photoId);
    if (!photo) {
      return res.status(404).json({ error: "PHOTO_NOT_FOUND", message: "Không tìm thấy ảnh" });
    }

    const clientAccount = await clientModel.findOrCreateClientAccount({
      name: req.client.clientName,
      phone: req.client.clientPhone,
    });
    const client = await clientModel.findOrCreateClient({
      albumId,
      clientAccountId: clientAccount.id,
    });
    const { selected } = await clientModel.toggleSelection({
      clientId: client.id,
      photoId,
    });

    res.json({ selected });
  } catch (error) {
    next(error);
  }
}

function logout(req, res) {
  res.clearCookie("client_session_token");
  res.json({ message: "Đã đăng xuất khỏi album" });
}

module.exports = { verifyPin, getAlbum, logout, listPhotos, viewPhoto, toggleSelection };