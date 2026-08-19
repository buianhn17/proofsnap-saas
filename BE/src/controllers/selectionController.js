const albumModel = require("../models/albumModel");
const clientModel = require("../models/clientModel");

async function listForAlbum(req, res, next) {
  try {
    const album = await albumModel.findByIdForPhotographer(
      req.params.albumId,
      req.photographer.photographerId
    );
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const selections = await clientModel.listSelectionsForAlbum(album.id);
    res.json({ selections });
  } catch (error) {
    next(error);
  }
}

module.exports = { listForAlbum };
