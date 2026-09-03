const pool = require("../config/db");

async function createNote({ photoId, photographerId, kind, noteText }) {
  const result = await pool.query(
    `INSERT INTO photo_notes (photo_id, photographer_id, kind, note_text)
     VALUES ($1, $2, $3, $4)
     RETURNING id, photo_id, photographer_id, kind, note_text, created_at`,
    [photoId, photographerId, kind, noteText]
  );
  return result.rows[0];
}

// Bundle theo album cho trang "Yêu cầu chỉnh sửa" (giống annotationModel.listByAlbum) —
// tránh phải gọi riêng 1 request /notes cho từng ảnh.
async function listByAlbum(albumId) {
  const result = await pool.query(
    `SELECT n.id, n.photo_id, n.kind, n.note_text, n.created_at
     FROM photo_notes n
     JOIN photos p ON p.id = n.photo_id
     WHERE p.album_id = $1
     ORDER BY n.created_at ASC`,
    [albumId]
  );
  return result.rows;
}

module.exports = { createNote, listByAlbum };
