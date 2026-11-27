const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const sharp = require("sharp");
const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const clientModel = require("../models/clientModel");
const annotationModel = require("../models/annotationModel");
const photoFaceEmbeddingModel = require("../models/photoFaceEmbeddingModel");
const redis = require("../config/redis");
const { applyWatermark } = require("../services/watermarkService");
const {
  resolveSizePreset,
  resizeToLongEdge,
  DOWNLOAD_OPTIMIZED_PRESET,
} = require("../services/thumbnailService");
const { downloadFileStream, downloadFileBuffer } = require("../services/googleDriveService");
const { detectFaces, largestFace } = require("../services/arcfaceService");
const { streamPhotosAsZip } = require("../services/zipStreamService");
const { setImageResourcePolicy } = require("../utils/imageHeaders");

const WATERMARK_CACHE_TTL_SECONDS = 60 * 60 * 24;

// Bước 3.3 — ngưỡng cosine distance để coi 2 khuôn mặt là "cùng 1 người" (embedding
// ArcFace w600k_mbf 512 chiều, đã chuẩn hóa L2). 0.42 ~ cosine similarity > 0.58. Đo trên ảnh
// sự kiện thật: cùng người ~0.09–0.45, khác người ≥ 0.6. Ghi đè qua env
// FACE_MATCH_MAX_DISTANCE — nới lên (≤ 0.5) nếu khách bỏ sót ảnh của chính mình (selfie
// khác nhiều về góc/ánh sáng), thắt lại nếu trả nhầm ảnh người khác.
const FACE_MATCH_MAX_DISTANCE = Number(process.env.FACE_MATCH_MAX_DISTANCE) || 0.42;
const FACE_MATCH_LIMIT = 300;

// Độ khớp hiển thị cho khách = 1 - cosine distance (FE nhân 100 ra %), chặn trong [0, 1].
// Kết quả đã lọc distance < FACE_MATCH_MAX_DISTANCE nên thực tế luôn ≥ 1 - ngưỡng (~58%).
function distanceToSimilarity(distance) {
  const similarity = 1 - distance;
  return Math.round(Math.max(0, Math.min(1, similarity)) * 1000) / 1000;
}

function invalidAccess(message, code = "INVALID_CLIENT_ACCESS") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function publicAlbum(album) {
  const {
    pin_hash: ignoredPinHash,
    drive_folder_id: ignoredDriveFolderId,
    // Bước 4.2 — id file Drive nội bộ, FE chỉ cần biết download_zip_unlocked (đã mở khóa
    // hay chưa), không cần/không nên lộ id file thật.
    zip_drive_file_id: ignoredZipDriveFileId,
    ...safeAlbum
  } = album;
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

function watermarkCacheKey(photoId, name, phone, size) {
  const identity = crypto.createHash("sha256").update(`${name}|${phone}`).digest("hex");
  return size ? `watermark:${photoId}:${size}:${identity}` : `watermark:${photoId}:${identity}`;
}

// L8 (NFR-02) — chống dò PIN: sai quá PIN_MAX_FAILED_ATTEMPTS lần → khoá PIN_LOCK_SECONDS
// theo cặp (album, IP). Đếm trong Redis: key pin_fail:{albumId}:{ip}. Cửa sổ đếm 15 phút tính
// từ lần sai đầu tiên; lần sai thứ 10 đặt lại TTL để khoá trọn 15 phút kể từ lúc đó.
const PIN_MAX_FAILED_ATTEMPTS = 10;
const PIN_LOCK_SECONDS = 15 * 60;

function pinFailKey(albumId, ip) {
  return `pin_fail:${albumId}:${ip || "unknown"}`;
}

/** Số giây còn khoá, hoặc 0 nếu chưa bị khoá. Redis lỗi → không khoá (ghi log), tránh chặn mọi khách. */
async function pinLockRemainingSeconds(key) {
  try {
    const [count, ttl] = await redis.multi().get(key).ttl(key).exec().then((rows) => rows.map(([, v]) => v));
    if (Number(count) >= PIN_MAX_FAILED_ATTEMPTS) return ttl > 0 ? ttl : PIN_LOCK_SECONDS;
    return 0;
  } catch (error) {
    console.error("Không đọc được bộ đếm sai PIN từ Redis:", error.message);
    return 0;
  }
}

async function recordPinFailure(key) {
  try {
    // SET NX EX tạo key kèm TTL ở lần sai đầu tiên (không ghi đè TTL ở các lần sau).
    const rows = await redis.multi().set(key, 0, "EX", PIN_LOCK_SECONDS, "NX").incr(key).exec();
    const count = Number(rows[1][1]);
    if (count >= PIN_MAX_FAILED_ATTEMPTS) await redis.expire(key, PIN_LOCK_SECONDS);
    return count;
  } catch (error) {
    console.error("Không ghi được bộ đếm sai PIN vào Redis:", error.message);
    return null;
  }
}

function sendPinLocked(res, retryAfterSeconds) {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  return res.status(429).json({
    error: "TOO_MANY_PIN_ATTEMPTS",
    message: `Bạn đã nhập sai PIN quá ${PIN_MAX_FAILED_ATTEMPTS} lần. Vui lòng thử lại sau ${Math.ceil(retryAfterSeconds / 60)} phút.`,
    retry_after_seconds: retryAfterSeconds,
  });
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
    if (album.pin_enabled) {
      const failKey = pinFailKey(album.id, req.ip);
      const lockedFor = await pinLockRemainingSeconds(failKey);
      if (lockedFor > 0) return sendPinLocked(res, lockedFor);

      if (typeof pin !== "string" || !(await bcrypt.compare(pin, album.pin_hash))) {
        const failures = await recordPinFailure(failKey);
        if (failures !== null && failures >= PIN_MAX_FAILED_ATTEMPTS) {
          return sendPinLocked(res, PIN_LOCK_SECONDS);
        }
        return res.status(401).json({
          error: "INVALID_ALBUM_PIN",
          message: "Mã PIN không đúng",
          attempts_remaining: failures === null ? undefined : PIN_MAX_FAILED_ATTEMPTS - failures,
        });
      }
      await redis.del(failKey).catch(() => {});
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

// Khách hiện tại (chỉ đọc, KHÔNG tạo mới) — null nếu khách chưa từng tương tác trong album.
async function findCurrentClient(req, albumId) {
  const clientAccount = await clientModel.findClientAccountByPhone(req.client.clientPhone);
  return clientAccount ? clientModel.findClient({ albumId, clientAccountId: clientAccount.id }) : null;
}

function sendSelectionCompleted(res, completion) {
  return res.status(409).json({
    error: "SELECTION_COMPLETED",
    message: "Bạn đã xác nhận hoàn tất chọn ảnh. Mở lại lựa chọn để thay đổi.",
    completed_at: completion.completed_at,
  });
}

async function getAlbum(req, res, next) {
  try {
    const album = await albumModel.findPublicById(req.params.albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    const client = await findCurrentClient(req, album.id);
    const completion = client ? await clientModel.findCompletion(client.id) : null;
    res.json({
      album: publicAlbum(album),
      client: { name: req.client.clientName, phone: req.client.clientPhone },
      // Mục 5.2 — khách đã xác nhận hoàn tất chọn ảnh chưa (null = đang chọn).
      completion: completion ? { completed_at: completion.completed_at } : null,
      // Bước 2.1 — FE tính lệch giờ máy khách so với server từ trường này, để đồng hồ đếm
      // ngược không phụ thuộc vào giờ hệ thống của trình duyệt (BE vẫn là nơi chốt hạn thật).
      server_time: new Date().toISOString(),
    });
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
    // burst_cluster_id thì trả ra (Bước 2.3) để FE gom nhóm/gợi ý ảnh giống nhau cho công cụ
    // so sánh song song — không lộ thông tin nội bộ, chỉ là 1 id để nhóm ảnh trong gallery.
    // is_best_in_cluster cũng trả ra để FE gợi ý sẵn ảnh AI chọn là đại diện tốt nhất trong
    // 1 cụm ảnh giống nhau — không lộ thêm dữ liệu chấm điểm nội bộ nào khác.
    const publicPhotos = photos.map(
      ({
        id,
        original_base_filename,
        width,
        height,
        created_at,
        burst_cluster_id,
        is_best_in_cluster,
      }) => ({
        id,
        original_base_filename,
        width,
        height,
        created_at,
        burst_cluster_id,
        is_best_in_cluster,
      })
    );
    // L5 — trạng thái thả tim của CHÍNH khách này (chỉ đọc, không tạo client record), để
    // gallery hiện lại đúng tim + "Đã chọn X / Y ảnh" sau khi tải lại trang/đổi thiết bị.
    const client = await findCurrentClient(req, albumId);
    const selectedIds = new Set(client ? await clientModel.listSelectedPhotoIds(client.id) : []);
    const completion = client ? await clientModel.findCompletion(client.id) : null;
    res.json({
      photos: publicPhotos.map((photo) => ({ ...photo, is_selected: selectedIds.has(photo.id) })),
      selection: {
        selected_count: selectedIds.size,
        max_selectable_photos: album.max_selectable_photos ?? null,
        completed_at: completion?.completed_at ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function viewPhoto(req, res, next) {
  setImageResourcePolicy(res);
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

    // Bước hiệu năng — ?size=thumb|preview trả bản resize nhẹ (cache theo đúng pattern
    // watermark bên dưới) thay vì luôn tải ảnh gốc full-size, giúp lưới ảnh/lightbox của
    // Client Portal mượt hơn với album nhiều ảnh. Không truyền size => giữ hành vi cũ.
    const sizePreset = resolveSizePreset(req.query.size);

    if (!album.watermark_enabled) {
      if (!sizePreset) {
        const stream = await downloadFileStream(album.photographer_id, photo.drive_file_id);
        res.setHeader("Content-Type", "image/jpeg");
        stream.on("error", (err) => next(err));
        stream.pipe(res);
        return;
      }

      const cacheKey = `photo:${photoId}:${req.query.size}`;
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        res.setHeader("Content-Type", "image/jpeg");
        return res.send(Buffer.from(cached, "base64"));
      }

      const original = await downloadFileBuffer(album.photographer_id, photo.drive_file_id);
      const resized = await resizeToLongEdge(original, sizePreset.maxEdgePx, sizePreset.quality);
      redis
        .set(cacheKey, resized.toString("base64"), "EX", WATERMARK_CACHE_TTL_SECONDS)
        .catch((err) => console.error("Lỗi ghi cache thumbnail:", err.message));
      res.setHeader("Content-Type", "image/jpeg");
      return res.send(resized);
    }

    const cacheKey = watermarkCacheKey(
      photoId,
      req.client.clientName,
      req.client.clientPhone,
      req.query.size
    );
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      res.setHeader("Content-Type", "image/jpeg");
      return res.send(Buffer.from(cached, "base64"));
    }

    let original = await downloadFileBuffer(album.photographer_id, photo.drive_file_id);
    if (sizePreset) {
      // Resize trước rồi mới watermark — nhẹ hơn (composite SVG lên ảnh nhỏ hơn) và tile
      // watermark vẫn đọc được ở kích thước thumbnail/preview.
      original = await resizeToLongEdge(original, sizePreset.maxEdgePx, sizePreset.quality);
    }
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
    const completion = await clientModel.findCompletion(client.id);
    if (completion) return sendSelectionCompleted(res, completion);

    try {
      const { selected, selectedCount, maxSelectable } = await clientModel.toggleSelection({
        albumId,
        clientId: client.id,
        photoId,
      });
      res.json({ selected, selected_count: selectedCount, max_selectable_photos: maxSelectable });
    } catch (error) {
      if (error instanceof clientModel.SelectionLimitError) {
        return res.status(409).json({
          error: error.code,
          message: error.message,
          selected_count: error.selectedCount,
          max_selectable_photos: error.maxSelectable,
        });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
}

// Bước 2.2 — validate payload ghi chú khoanh vùng gửi lên từ Client Portal.
const MAX_PATH_POINTS = 500;

function isPercent(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validateAnnotationInput(body) {
  const { pos_x_pct: posXPct, pos_y_pct: posYPct, path_pct: pathPct, note_text: noteText } = body || {};

  if (!isPercent(posXPct) || !isPercent(posYPct)) {
    throw invalidAccess("pos_x_pct/pos_y_pct phải là số từ 0 đến 100", "INVALID_ANNOTATION_POSITION");
  }

  let normalizedPath = null;
  if (pathPct !== undefined && pathPct !== null) {
    if (!Array.isArray(pathPct) || pathPct.length === 0 || pathPct.length > MAX_PATH_POINTS) {
      throw invalidAccess(
        `path_pct phải là mảng có từ 1 đến ${MAX_PATH_POINTS} điểm`,
        "INVALID_ANNOTATION_PATH"
      );
    }
    normalizedPath = pathPct.map((point) => {
      if (!point || !isPercent(point.x) || !isPercent(point.y)) {
        throw invalidAccess("Mỗi điểm trong path_pct phải có x,y là số từ 0 đến 100", "INVALID_ANNOTATION_PATH");
      }
      return { x: point.x, y: point.y };
    });
  }

  if (typeof noteText !== "string" || noteText.trim().length < 1 || noteText.trim().length > 2000) {
    throw invalidAccess("Ghi chú phải từ 1 đến 2000 ký tự", "INVALID_ANNOTATION_NOTE");
  }

  return { posXPct, posYPct, pathPct: normalizedPath, noteText: noteText.trim() };
}

async function createAnnotation(req, res, next) {
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

    const { posXPct, posYPct, pathPct, noteText } = validateAnnotationInput(req.body);

    const clientAccount = await clientModel.findOrCreateClientAccount({
      name: req.client.clientName,
      phone: req.client.clientPhone,
    });
    const client = await clientModel.findOrCreateClient({
      albumId,
      clientAccountId: clientAccount.id,
    });

    const completion = await clientModel.findCompletion(client.id);
    if (completion) return sendSelectionCompleted(res, completion);

    const annotation = await annotationModel.createAnnotation({
      photoId,
      clientId: client.id,
      posXPct,
      posYPct,
      pathPct,
      noteText,
    });

    res.status(201).json({ annotation });
  } catch (error) {
    next(error);
  }
}

async function listAnnotationsForPhoto(req, res, next) {
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

    // Chỉ đọc, không tạo client_accounts/clients — khách chưa từng bấm tim/ghi chú thì
    // chắc chắn chưa có ghi chú nào, trả mảng rỗng ngay mà không đụng tới DB ghi.
    const clientAccount = await clientModel.findClientAccountByPhone(req.client.clientPhone);
    const client = clientAccount
      ? await clientModel.findClient({ albumId, clientAccountId: clientAccount.id })
      : null;

    const annotations = client
      ? await annotationModel.listByPhotoAndClient(photoId, client.id)
      : [];
    res.json({ annotations });
  } catch (error) {
    next(error);
  }
}

// Bước 4.2 — tải ZIP ảnh hoàn thiện. Nguồn ảnh ưu tiên theo thứ tự:
//  1) album.zip_drive_file_id — nếu PTG đã upload riêng 1 file .zip đã hậu kỳ (xem
//     albumController.uploadZip) thì dùng thẳng file đó, PROXY nguyên văn từ Drive.
//  2) Nếu chưa có, tự nén ZIP "động" từ ảnh GỐC (chưa hậu kỳ riêng) đã được ít nhất 1 khách
//     trong album thả tim — đúng 2 nguồn ảnh mục 4.2 đã nêu, ưu tiên ảnh hậu kỳ nếu PTG có
//     làm bước đó, fallback về ảnh gốc nếu chưa.
async function downloadZip(req, res, next) {
  setImageResourcePolicy(res);
  try {
    const { albumId } = req.params;
    if (req.client.albumId !== albumId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Phiên không thuộc album này" });
    }

    const album = await albumModel.findPublicById(albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    if (!album.download_zip_unlocked) {
      return res.status(403).json({
        error: "ZIP_NOT_UNLOCKED",
        message: "Nhiếp ảnh gia chưa mở khóa tải ảnh hoàn thiện cho album này",
      });
    }

    const zipFilename = (album.name || "album").replace(/[^a-zA-Z0-9 _-]/g, "_");

    if (album.zip_drive_file_id) {
      const stream = await downloadFileStream(album.photographer_id, album.zip_drive_file_id);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}.zip"`);
      stream.on("error", (err) => res.destroy(err));
      stream.pipe(res);
      return;
    }

    const photos = await photoModel.listSelectedForAlbum(albumId);
    if (photos.length === 0) {
      return res.status(404).json({
        error: "NO_SELECTED_PHOTOS",
        message: "Album chưa có ảnh nào được khách chọn để đóng gói",
      });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}.zip"`);
    await streamPhotosAsZip(res, album.photographer_id, photos);
  } catch (error) {
    next(error);
  }
}

// Bước 4.2 (mobile) — cùng điều kiện truy cập với downloadZip: đúng album của phiên, album
// đang hoạt động, PTG đã mở khóa tải. Trả album nếu hợp lệ, hoặc null sau khi đã gửi lỗi.
async function loadUnlockedAlbumForDownload(req, res) {
  const { albumId } = req.params;
  if (req.client.albumId !== albumId) {
    res.status(403).json({ error: "FORBIDDEN", message: "Phiên không thuộc album này" });
    return null;
  }
  const album = await albumModel.findPublicById(albumId);
  if (!album || album.status !== "active") {
    res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    return null;
  }
  if (!album.download_zip_unlocked) {
    res.status(403).json({
      error: "ZIP_NOT_UNLOCKED",
      message: "Nhiếp ảnh gia chưa mở khóa tải ảnh hoàn thiện cho album này",
    });
    return null;
  }
  return album;
}

function downloadFilename(photo) {
  const base = (photo.original_base_filename || photo.id).replace(/[^a-zA-Z0-9 _.-]/g, "_");
  return `${base}.jpg`;
}

// Bước 4.2 (mobile) — danh sách ảnh hoàn thiện tải được từng tấm (để lưu thẳng vào Thư viện
// ảnh qua Web Share API), đúng tập ảnh mà downloadZip sẽ nén. mode = "zip_only" khi PTG đã
// upload ZIP hậu kỳ riêng: ảnh trong ZIP đó là bản đã chỉnh sửa, KHÁC ảnh gốc trong DB, nên
// không có bản tải từng tấm tương ứng — FE phải dùng ZIP.
async function listDownloadablePhotos(req, res, next) {
  try {
    const album = await loadUnlockedAlbumForDownload(req, res);
    if (!album) return;

    if (album.zip_drive_file_id) {
      return res.json({ mode: "zip_only", photos: [] });
    }
    const photos = await photoModel.listSelectedForAlbum(album.id);
    res.json({
      mode: "per_photo",
      photos: photos.map((p) => ({ id: p.id, filename: downloadFilename(p) })),
    });
  } catch (error) {
    next(error);
  }
}

// Bước 4.2 (mobile) — tải 1 ảnh hoàn thiện, KHÔNG watermark (cùng nội dung với ảnh trong ZIP
// dynamic). ?quality=original (mặc định) stream nguyên file gốc từ Drive; ?quality=optimized
// trả bản thu nhỏ DOWNLOAD_OPTIMIZED_PRESET.
async function downloadPhoto(req, res, next) {
  setImageResourcePolicy(res);
  try {
    const album = await loadUnlockedAlbumForDownload(req, res);
    if (!album) return;
    if (album.zip_drive_file_id) {
      return res.status(409).json({
        error: "ZIP_ONLY",
        message: "Album này chỉ hỗ trợ tải ảnh hoàn thiện dạng file ZIP",
      });
    }

    const photo = await photoModel.findSelectedInAlbum(album.id, req.params.photoId);
    if (!photo) {
      return res.status(404).json({ error: "PHOTO_NOT_FOUND", message: "Không tìm thấy ảnh" });
    }

    const filename = downloadFilename(photo);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Ảnh gốc không watermark, chỉ dành cho phiên này — không cho proxy/CDN dùng chung cache.
    res.setHeader("Cache-Control", "private, max-age=3600");

    if (req.query.quality === "optimized") {
      const original = await downloadFileBuffer(album.photographer_id, photo.drive_file_id);
      const { width = 0, height = 0 } = await sharp(original).metadata();
      // Ảnh gốc đã nhỏ hơn bản tối ưu: nén JPEG lại không giảm kích thước mà còn nặng hơn
      // + giảm chất lượng — trả nguyên ảnh gốc.
      if (Math.max(width, height) <= DOWNLOAD_OPTIMIZED_PRESET.maxEdgePx) {
        return res.send(original);
      }
      const resized = await resizeToLongEdge(
        original,
        DOWNLOAD_OPTIMIZED_PRESET.maxEdgePx,
        DOWNLOAD_OPTIMIZED_PRESET.quality
      );
      return res.send(resized);
    }

    const stream = await downloadFileStream(album.photographer_id, photo.drive_file_id);
    stream.on("error", (err) => res.destroy(err));
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}

// Bước 3.1/3.3 — trạng thái hiệu lực vị thành niên của 1 client.
// L9 — cờ album "có người dưới 18 tuổi" là TUYỆT ĐỐI: khách tự khai "Trên 18 tuổi" không được
// mở lại face search trong album đó (trước đây override của khách thắng cờ album theo cả 2
// chiều). Override riêng (clients.is_minor_flagged = true) chỉ còn tác dụng siết thêm: khách tự
// khai "Dưới 18 tuổi" trong album thường thì bị chặn.
function effectiveIsMinor(album, client) {
  return album.is_minor_album === true || client?.is_minor_flagged === true;
}

// Bước 3.1 — GET trạng thái đồng ý, để FE quyết định hiện màn hình đồng ý hay cho vào thẳng
// upload selfie. Chỉ đọc, không tạo client_accounts/clients (giống listAnnotationsForPhoto)
// — khách chưa từng tương tác thì chắc chắn chưa đồng ý.
async function getFaceSearchConsentStatus(req, res, next) {
  try {
    const { albumId } = req.params;
    if (req.client.albumId !== albumId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Phiên không thuộc album này" });
    }

    const album = await albumModel.findPublicById(albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const clientAccount = await clientModel.findClientAccountByPhone(req.client.clientPhone);
    const client = clientAccount
      ? await clientModel.findClient({ albumId, clientAccountId: clientAccount.id })
      : null;

    res.json({
      // Vị thành niên (album kỷ yếu...): tính năng AI Face Search bị khóa hoàn toàn — chưa
      // có quy trình xin đồng ý qua phụ huynh/giáo viên nên an toàn nhất là không cho dùng.
      feature_available: !effectiveIsMinor(album, client),
      consented: Boolean(client?.face_search_consent_at),
      consented_at: client?.face_search_consent_at ?? null,
    });
  } catch (error) {
    next(error);
  }
}

// Bước 3.1 — ghi nhận đồng ý. Đây LÀ hành động ghi (tạo client_accounts/clients nếu khách
// mới), khác các endpoint chỉ đọc ở trên — đúng theo quy ước "chỉ tạo client record lúc
// khách chủ động tương tác lần đầu" của lensproof_schema.sql mục 11 (đồng ý xử lý dữ liệu
// sinh trắc học rõ ràng là 1 hành động chủ động, tương tự thả tim/ghi chú).
async function giveFaceSearchConsent(req, res, next) {
  try {
    const { albumId } = req.params;
    if (req.client.albumId !== albumId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Phiên không thuộc album này" });
    }
    if (req.body?.agree !== true) {
      throw invalidAccess("Cần xác nhận đồng ý (agree=true) để dùng tính năng này", "CONSENT_NOT_AGREED");
    }

    const album = await albumModel.findPublicById(albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const clientAccount = await clientModel.findOrCreateClientAccount({
      name: req.client.clientName,
      phone: req.client.clientPhone,
    });
    let client = await clientModel.findOrCreateClient({
      albumId,
      clientAccountId: clientAccount.id,
    });

    // Bước — khách tự khai độ tuổi ngay trong màn hình xin phép ("Xác nhận độ tuổi"). Ghi
    // nhận TRƯỚC khi kiểm tra effectiveIsMinor bên dưới, để tự khai "Dưới 18 tuổi" chặn được
    // đồng ý ngay lượt này, không cần khách bấm lại lần 2.
    if (req.body?.is_minor === true || req.body?.is_minor === false) {
      client = await clientModel.setMinorFlagged(client.id, req.body.is_minor);
    }

    if (effectiveIsMinor(album, client)) {
      return res.status(403).json({
        error: "FACE_SEARCH_DISABLED_MINOR",
        message: "Tính năng Tìm ảnh bằng khuôn mặt không khả dụng cho album này",
      });
    }

    client = await clientModel.setFaceSearchConsent(client.id);
    // Bằng chứng tuân thủ (mục 9.1) — log MỌI lần xác nhận, kể cả xác nhận lại, kèm IP/UA.
    await clientModel.recordFaceSearchConsentLog({
      clientId: client.id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      feature_available: true,
      consented: true,
      consented_at: client.face_search_consent_at,
    });
  } catch (error) {
    next(error);
  }
}

// "Rút lại đồng ý và xóa dữ liệu khuôn mặt của tôi" — không có embedding/ảnh selfie lưu trữ
// nào khác cần xóa (xem searchByFace bên dưới: chỉ giữ trong bộ nhớ 1 request rồi bỏ), nên
// hành động này chỉ xóa MỐC đồng ý để khách phải xác nhận lại nếu muốn dùng lại tính năng.
async function revokeFaceSearchConsent(req, res, next) {
  try {
    const { albumId } = req.params;
    if (req.client.albumId !== albumId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Phiên không thuộc album này" });
    }

    const album = await albumModel.findPublicById(albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const clientAccount = await clientModel.findClientAccountByPhone(req.client.clientPhone);
    const client = clientAccount
      ? await clientModel.findClient({ albumId, clientAccountId: clientAccount.id })
      : null;

    if (client) {
      await clientModel.revokeFaceSearchConsent(client.id);
    }

    res.json({
      feature_available: !effectiveIsMinor(album, client),
      consented: false,
      consented_at: null,
    });
  } catch (error) {
    next(error);
  }
}

// Bước 3.3 — nhận ảnh selfie của khách, trích embedding, tìm ảnh trong album có khuôn mặt
// gần nhất theo pgvector. KHÔNG lưu embedding/ảnh selfie xuống DB hay đĩa ở bất kỳ đâu (mục
// 9.1 lensproof_schema.sql) — chỉ giữ trong bộ nhớ cho 1 request rồi bỏ.
async function searchByFace(req, res, next) {
  try {
    const { albumId } = req.params;
    if (req.client.albumId !== albumId) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Phiên không thuộc album này" });
    }
    if (!req.file) {
      throw invalidAccess("Cần gửi một ảnh selfie trong field 'file'", "MISSING_SELFIE");
    }

    const album = await albumModel.findPublicById(albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const clientAccount = await clientModel.findClientAccountByPhone(req.client.clientPhone);
    const client = clientAccount
      ? await clientModel.findClient({ albumId, clientAccountId: clientAccount.id })
      : null;

    if (effectiveIsMinor(album, client)) {
      return res.status(403).json({
        error: "FACE_SEARCH_DISABLED_MINOR",
        message: "Tính năng Tìm ảnh bằng khuôn mặt không khả dụng cho album này",
      });
    }
    if (!client?.face_search_consent_at) {
      return res.status(403).json({
        error: "CONSENT_REQUIRED",
        message: "Cần đồng ý xử lý dữ liệu khuôn mặt trước khi dùng tính năng này",
      });
    }

    const faces = await detectFaces(req.file.buffer);
    const bestFace = largestFace(faces);
    if (!bestFace) {
      throw invalidAccess(
        "Không phát hiện được khuôn mặt nào trong ảnh, vui lòng chụp lại rõ mặt hơn",
        "NO_FACE_DETECTED"
      );
    }

    const matches = await photoFaceEmbeddingModel.findMatchingPhotos({
      albumId,
      embedding: bestFace.embedding,
      maxDistance: FACE_MATCH_MAX_DISTANCE,
      limit: FACE_MATCH_LIMIT,
    });

    await clientModel.recordSelfieSearch({
      clientId: client.id,
      matchedPhotoCount: matches.length,
    });

    res.json({
      photos: matches.map((m) => ({
        id: m.id,
        original_base_filename: m.original_base_filename,
        width: m.width,
        height: m.height,
        created_at: m.created_at,
        burst_cluster_id: m.burst_cluster_id,
        is_best_in_cluster: m.is_best_in_cluster,
        similarity: distanceToSimilarity(m.distance),
      })),
    });
  } catch (error) {
    next(error);
  }
}

// Mục 5.2 — khách xác nhận hoàn tất chọn ảnh. Sau khi hoàn tất, thả tim/ghi chú bị khoá cho
// tới khi khách mở lại (chỉ được mở lại khi album chưa hết hạn/khoá — enforceAlbumNotExpired).
// PTG thấy ngay ở Bảng điều khiển / Khách hàng, kèm chuỗi tên file đã chọn.
async function completeSelection(req, res, next) {
  try {
    const { albumId } = req.params;
    const album = await albumModel.findPublicById(albumId);
    if (!album || album.status !== "active") {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    const client = await findCurrentClient(req, albumId);
    const selectedIds = client ? await clientModel.listSelectedPhotoIds(client.id) : [];
    if (!client || selectedIds.length === 0) {
      return res.status(409).json({
        error: "NO_SELECTION",
        message: "Bạn cần chọn ít nhất 1 ảnh trước khi xác nhận hoàn tất.",
      });
    }
    const completion = await clientModel.markCompleted(client.id);
    res.json({
      completion: { completed_at: completion.completed_at },
      selected_count: selectedIds.length,
      max_selectable_photos: album.max_selectable_photos ?? null,
    });
  } catch (error) {
    next(error);
  }
}

async function reopenSelection(req, res, next) {
  try {
    const client = await findCurrentClient(req, req.params.albumId);
    if (client) await clientModel.reopenCompletion(client.id);
    res.json({ completion: null });
  } catch (error) {
    next(error);
  }
}

function logout(req, res) {
  res.clearCookie("client_session_token");
  res.json({ message: "Đã đăng xuất khỏi album" });
}

module.exports = {
  verifyPin,
  getAlbum,
  logout,
  listPhotos,
  viewPhoto,
  toggleSelection,
  completeSelection,
  reopenSelection,
  createAnnotation,
  listAnnotationsForPhoto,
  getFaceSearchConsentStatus,
  giveFaceSearchConsent,
  revokeFaceSearchConsent,
  searchByFace,
  downloadZip,
  listDownloadablePhotos,
  downloadPhoto,
};