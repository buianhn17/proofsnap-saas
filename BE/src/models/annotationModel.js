const pool = require("../config/db");

async function createAnnotation({ photoId, clientId, posXPct, posYPct, pathPct, noteText }) {
  const result = await pool.query(
    `INSERT INTO annotations (photo_id, client_id, pos_x_pct, pos_y_pct, path_pct, note_text)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, photo_id, client_id, pos_x_pct, pos_y_pct, path_pct, note_text, status, created_at`,
    [photoId, clientId, posXPct, posYPct, pathPct ? JSON.stringify(pathPct) : null, noteText]
  );
  return result.rows[0];
}

// Bước 2.2 — chỉ trả về ghi chú của CHÍNH client đang đăng nhập, không lộ ghi chú của
// khách khác trong cùng album (mỗi gia đình/khách mời có thể xem chung 1 album).
async function listByPhotoAndClient(photoId, clientId) {
  const result = await pool.query(
    `SELECT id, photo_id, client_id, pos_x_pct, pos_y_pct, path_pct, note_text, status, created_at
     FROM annotations
     WHERE photo_id = $1 AND client_id = $2
     ORDER BY created_at ASC`,
    [photoId, clientId]
  );
  return result.rows;
}

// Photographer-side: toàn bộ ghi chú trong album, kèm tên/SĐT khách — mẫu giống
// clientModel.listSelectionsForAlbum.
async function listByAlbum(albumId) {
  const result = await pool.query(
    `SELECT
       a.id, a.photo_id, a.pos_x_pct, a.pos_y_pct, a.path_pct, a.note_text, a.status, a.created_at,
       ca.full_name AS client_name, ca.phone_number AS client_phone
     FROM annotations a
     JOIN photos p ON p.id = a.photo_id
     JOIN clients c ON c.id = a.client_id
     JOIN client_accounts ca ON ca.id = c.client_account_id
     WHERE p.album_id = $1
     ORDER BY a.created_at DESC`,
    [albumId]
  );
  return result.rows;
}

// Bước — PTG đánh dấu 1 yêu cầu chỉnh sửa cụ thể là đã xử lý/chưa xử lý. Join qua
// photos->albums để xác thực annotation thuộc đúng album VÀ đúng photographer đang đăng
// nhập (tránh 1 PTG sửa annotation của album khác qua đoán UUID).
async function updateStatus(annotationId, albumId, photographerId, status) {
  const result = await pool.query(
    `UPDATE annotations a SET status = $4
     FROM photos p, albums al
     WHERE a.id = $1
       AND a.photo_id = p.id
       AND p.album_id = $2
       AND p.album_id = al.id
       AND al.photographer_id = $3
     RETURNING a.id, a.photo_id, a.pos_x_pct, a.pos_y_pct, a.path_pct, a.note_text, a.status, a.created_at`,
    [annotationId, albumId, photographerId, status]
  );
  return result.rows[0] || null;
}

// "Hoàn tất chỉnh sửa" — đánh dấu TOÀN BỘ yêu cầu (annotation) của 1 ảnh là đã xử lý cùng lúc.
async function markAllDoneForPhoto(photoId, albumId, photographerId) {
  const result = await pool.query(
    `UPDATE annotations a SET status = 'done'
     FROM photos p, albums al
     WHERE a.photo_id = $1
       AND a.photo_id = p.id
       AND p.album_id = $2
       AND p.album_id = al.id
       AND al.photographer_id = $3
     RETURNING a.id`,
    [photoId, albumId, photographerId]
  );
  return result.rows.length;
}

module.exports = {
  createAnnotation,
  listByPhotoAndClient,
  listByAlbum,
  updateStatus,
  markAllDoneForPhoto,
};
