const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const clientModel = require("../models/clientModel");
const annotationModel = require("../models/annotationModel");
const photoFaceEmbeddingModel = require("../models/photoFaceEmbeddingModel");
const redis = require("../config/redis");
const { applyWatermark } = require("../services/watermarkService");
const { resolveSizePreset, resizeToLongEdge } = require("../services/thumbnailService");
const { downloadFileStream, downloadFileBuffer } = require("../services/googleDriveService");
const { detectFaces, largestFace } = require("../services/arcfaceService");
const { streamPhotosAsZip } = require("../services/zipStreamService");

const WATERMARK_CACHE_TTL_SECONDS = 60 * 60 * 24;

// Bước 3.3 — ngưỡng cosine distance để coi 2 khuôn mặt là "cùng 1 người" (embedding
// ArcFace w600k_mbf 512 chiều, đã chuẩn hóa L2). 0.42 ~ cosine similarity > 0.58. Đo trên ảnh
// sự kiện thật: cùng người ~0.09–0.45, khác người ≥ 0.6. Ghi đè qua env
// FACE_MATCH_MAX_DISTANCE — nới lên (≤ 0.5) nếu khách bỏ sót ảnh của chính mình (selfie
// khác nhiều về góc/ánh sáng), thắt lại nếu trả nhầm ảnh người khác.
const FACE_MATCH_MAX_DISTANCE = Number(process.env.FACE_MATCH_MAX_DISTANCE) || 0.42;
const FACE_MATCH_LIMIT = 300;

function invalidAccess(message, code = "INVALID_CLIENT_ACCESS") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
// Độ khớp hiển thị cho khách = 1 - cosine distance (FE nhân 100 ra %), chặn trong [0, 1].
// Kết quả đã lọc distance < FACE_MATCH_MAX_DISTANCE nên thực tế luôn ≥ 1 - ngưỡng (~58%).
function distanceToSimilarity(distance) {
  const similarity = 1 - distance;
  return Math.round(Math.max(0, Math.min(1, similarity)) * 1000) / 1000;
}

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
    res.json({
      album: publicAlbum(album),
      client: { name: req.client.clientName, phone: req.client.clientPhone },
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
    const { selected } = await clientModel.toggleSelection({
      clientId: client.id,
      photoId,
    });

    res.json({ selected });
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

// Bước 3.1/3.3 — trạng thái hiệu lực vị thành niên của 1 client: ưu tiên override riêng
// (clients.is_minor_flagged), NULL thì lấy theo mặc định của cả album (albums.is_minor_album)
// — đúng quy tắc đã ghi ở mục 11 lensproof_schema.sql.
function effectiveIsMinor(album, client) {
  if (client && client.is_minor_flagged !== null && client.is_minor_flagged !== undefined) {
    return client.is_minor_flagged;
  }
  return album.is_minor_album;
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
  createAnnotation,
  listAnnotationsForPhoto,
  getFaceSearchConsentStatus,
  giveFaceSearchConsent,
  revokeFaceSearchConsent,
  searchByFace,
  downloadZip,
};