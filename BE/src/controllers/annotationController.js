const albumModel = require("../models/albumModel");
const annotationModel = require("../models/annotationModel");

async function listForAlbum(req, res, next) {
  try {
    const album = await albumModel.findByIdForPhotographer(
      req.params.albumId,
      req.photographer.photographerId
    );
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const annotations = await annotationModel.listByAlbum(album.id);
    res.json({ annotations });
  } catch (error) {
    next(error);
  }
}

// Bước — PTG đánh dấu 1 yêu cầu chỉnh sửa của khách là đã xử lý ("Đánh dấu hoàn tất") hoặc
// mở lại thành chưa xử lý.
async function updateStatus(req, res, next) {
  try {
    const { status } = req.body || {};
    if (!["pending", "done"].includes(status)) {
      const error = new Error("status chỉ được là pending hoặc done");
      error.statusCode = 400;
      error.code = "INVALID_ANNOTATION_STATUS";
      throw error;
    }

    const annotation = await annotationModel.updateStatus(
      req.params.annotationId,
      req.params.albumId,
      req.photographer.photographerId,
      status
    );
    if (!annotation) {
      return res
        .status(404)
        .json({ error: "ANNOTATION_NOT_FOUND", message: "Không tìm thấy yêu cầu chỉnh sửa" });
    }
    res.json({ annotation });
  } catch (error) {
    next(error);
  }
}

module.exports = { listForAlbum, updateStatus };
