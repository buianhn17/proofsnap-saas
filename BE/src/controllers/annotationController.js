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

module.exports = { listForAlbum };
