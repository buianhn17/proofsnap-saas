const albumModel = require("../models/albumModel");
const annotationModel = require("../models/annotationModel");
const photoNotesModel = require("../models/photoNotesModel");
const filenameExportModel = require("../models/filenameExportModel");

// Bước 4.1 — tổng hợp toàn bộ ảnh đã chọn/có ghi chú trong album + sinh chuỗi tên file dán
// được vào thanh tìm kiếm Lightroom/Photoshop. Lightroom Classic hỗ trợ toán tử OR trong Text
// Search (lọc theo Filename) — nối các tên file gốc (không đuôi mở rộng, đúng
// original_base_filename đã lưu, khớp cả JPG lẫn RAW cùng cặp) bằng " OR " là dán thẳng dùng
// được ngay, không cần khách/PTG chỉnh sửa gì thêm.
async function generate(req, res, next) {
  try {
    const album = await albumModel.findByIdForPhotographer(
      req.params.albumId,
      req.photographer.photographerId
    );
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const [photos, annotations, notes] = await Promise.all([
      filenameExportModel.findEditRequestPhotos(album.id),
      annotationModel.listByAlbum(album.id),
      photoNotesModel.listByAlbum(album.id),
    ]);

    const annotationsByPhoto = new Map();
    for (const annotation of annotations) {
      if (!annotationsByPhoto.has(annotation.photo_id)) {
        annotationsByPhoto.set(annotation.photo_id, []);
      }
      annotationsByPhoto.get(annotation.photo_id).push(annotation);
    }

    const notesByPhoto = new Map();
    for (const note of notes) {
      if (!notesByPhoto.has(note.photo_id)) {
        notesByPhoto.set(note.photo_id, []);
      }
      notesByPhoto.get(note.photo_id).push(note);
    }

    const filenameList = photos.map((p) => p.original_base_filename);
    const exportLog = await filenameExportModel.logExport(album.id, filenameList);

    res.json({
      photos: photos.map((p) => ({
        id: p.id,
        original_base_filename: p.original_base_filename,
        created_at: p.created_at,
        annotations: annotationsByPhoto.get(p.id) ?? [],
        notes: notesByPhoto.get(p.id) ?? [],
      })),
      filename_list: filenameList,
      search_string: filenameList.join(" OR "),
      exported_at: exportLog.generated_at,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { generate };
