const albumModel = require("../models/albumModel");
const importModel = require("../models/photoImportModel");
const publicDrive = require("../services/publicDriveService");
const importQueue = require("../services/photoImportQueue");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(statusCode, code, message, extra) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (extra) error.extra = extra;
  return error;
}

async function loadAlbum(req) {
  if (!UUID_PATTERN.test(req.params.albumId)) throw httpError(404, "ALBUM_NOT_FOUND", "Không tìm thấy album");
  const album = await albumModel.findByIdForPhotographer(req.params.albumId, req.photographer.photographerId);
  if (!album) throw httpError(404, "ALBUM_NOT_FOUND", "Không tìm thấy album");
  return album;
}

async function create(req, res, next) {
  try {
    const album = await loadAlbum(req);
    if (album.status !== "active" || album.is_locked) {
      throw httpError(400, "ALBUM_NOT_ACTIVE", "Album đã bị khóa hoặc lưu trữ");
    }
    publicDrive.getApiKey(); // báo thiếu cấu hình trước khi làm gì khác

    const url = (req.body || {}).url;
    const link = publicDrive.parseDriveLink(url);
    if (!link) {
      throw httpError(
        400,
        "DRIVE_LINK_INVALID",
        "Link không phải link Google Drive. Dán link thư mục dạng https://drive.google.com/drive/folders/…"
      );
    }

    const active = await importModel.findActiveImport(album.id);
    if (active) {
      return res.status(409).json({
        error: "IMPORT_ALREADY_RUNNING",
        message: "Album đang có một lượt nhập chưa xong — chờ xong hoặc huỷ trước",
        import: active,
      });
    }

    // Liệt kê ngay để báo lỗi tức thì (link riêng tư, thư mục không có JPG…)
    const listing = await publicDrive.listPublicImages(link);
    if (listing.images.length === 0) {
      throw httpError(
        400,
        "DRIVE_NO_IMAGES",
        listing.unsupportedCount > 0
          ? `Không có ảnh JPG nào (${listing.unsupportedCount} file khác định dạng như RAW, HEIC, video — hiện chỉ nhập được JPG)`
          : "Thư mục trống"
      );
    }

    let job;
    try {
      job = await importModel.createImport({
        albumId: album.id,
        photographerId: req.photographer.photographerId,
        sourceUrl: url.trim(),
        sourceKind: listing.kind,
        sourceId: listing.id,
        sourceName: listing.name,
        totalFiles: listing.images.length,
        unsupportedCount: listing.unsupportedCount,
      });
    } catch (error) {
      // 2 request song song cho cùng album — ràng buộc "1 lượt đang chạy" chặn ở DB
      if (error.code === "23505") {
        return res.status(409).json({
          error: "IMPORT_ALREADY_RUNNING",
          message: "Album đang có một lượt nhập chưa xong — chờ xong hoặc huỷ trước",
          import: await importModel.findActiveImport(album.id),
        });
      }
      throw error;
    }
    importQueue.enqueueImport(job.id, listing);
    res.status(202).json({ import: job });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const album = await loadAlbum(req);
    res.json({ imports: await importModel.listImports(album.id) });
  } catch (error) {
    next(error);
  }
}

async function getOne(req, res, next) {
  try {
    const album = await loadAlbum(req);
    const job = UUID_PATTERN.test(req.params.importId) ? await importModel.findImport(req.params.importId, album.id) : null;
    if (!job) throw httpError(404, "IMPORT_NOT_FOUND", "Không tìm thấy lượt nhập");
    res.json({ import: job });
  } catch (error) {
    next(error);
  }
}

async function cancel(req, res, next) {
  try {
    const album = await loadAlbum(req);
    const job = UUID_PATTERN.test(req.params.importId) ? await importModel.requestCancel(req.params.importId, album.id) : null;
    if (!job) throw httpError(409, "IMPORT_NOT_RUNNING", "Lượt nhập không còn đang chạy");
    res.json({ import: job });
  } catch (error) {
    next(error);
  }
}

module.exports = { create, list, getOne, cancel };
