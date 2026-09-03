const albumModel = require("../models/albumModel");
const photoModel = require("../models/photoModel");
const photoNotesModel = require("../models/photoNotesModel");
const annotationModel = require("../models/annotationModel");

async function findOwnedPhoto(req) {
  const album = await albumModel.findByIdForPhotographer(
    req.params.albumId,
    req.photographer.photographerId
  );
  if (!album) return { album: null, photo: null };
  const photo = await photoModel.findByAlbumAndId(album.id, req.params.photoId);
  return { album, photo };
}

// "Thêm ghi chú nội bộ" / "Phản hồi khách hàng" trên trang Yêu cầu chỉnh sửa — cùng 1 bảng
// lưu trữ, phân biệt bằng `kind` (xem migration 005).
async function addNote(req, res, next) {
  try {
    const { album, photo } = await findOwnedPhoto(req);
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    if (!photo) {
      return res.status(404).json({ error: "PHOTO_NOT_FOUND", message: "Không tìm thấy ảnh" });
    }

    const kind = req.body?.kind === "client_reply" ? "client_reply" : "internal";
    const noteText = typeof req.body?.note_text === "string" ? req.body.note_text.trim() : "";
    if (!noteText) {
      const error = new Error("note_text không được để trống");
      error.statusCode = 400;
      error.code = "INVALID_NOTE_TEXT";
      throw error;
    }

    const note = await photoNotesModel.createNote({
      photoId: photo.id,
      photographerId: req.photographer.photographerId,
      kind,
      noteText,
    });
    res.status(201).json({ note });
  } catch (error) {
    next(error);
  }
}

// "Hoàn tất chỉnh sửa" — đánh dấu mọi yêu cầu (annotation) của ảnh đang xem là đã xử lý.
async function completeEdits(req, res, next) {
  try {
    const { album, photo } = await findOwnedPhoto(req);
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }
    if (!photo) {
      return res.status(404).json({ error: "PHOTO_NOT_FOUND", message: "Không tìm thấy ảnh" });
    }

    const updatedCount = await annotationModel.markAllDoneForPhoto(
      photo.id,
      album.id,
      req.photographer.photographerId
    );
    res.json({ updated_count: updatedCount });
  } catch (error) {
    next(error);
  }
}

module.exports = { addNote, completeEdits };
