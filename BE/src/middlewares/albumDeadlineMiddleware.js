const albumModel = require("../models/albumModel");

// Bước 2.1 — chặn các API ghi (thả tim, thêm ghi chú) khi album đã hết hạn chọn ảnh hoặc
// đã bị khóa, dựa trên giờ SERVER (albumModel.lockAlbumIfExpired dùng now() của Postgres),
// không tin giờ máy khách gửi lên. Phải đứng sau requireClientAuth (cần req.client.albumId
// và req.params.albumId khớp nhau, đã được requireClientAuth xác nhận).
async function enforceAlbumNotExpired(req, res, next) {
  try {
    const { albumId } = req.params;
    const album = await albumModel.findPublicById(albumId);
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    if (album.is_locked) {
      return res.status(403).json({ error: "ALBUM_LOCKED", message: "Album đã bị khóa, không thể thao tác thêm" });
    }

    const justExpired = await albumModel.lockAlbumIfExpired(albumId);
    if (justExpired) {
      return res.status(403).json({
        error: "SELECTION_DEADLINE_PASSED",
        message: "Đã hết hạn chọn ảnh cho album này",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { enforceAlbumNotExpired };
