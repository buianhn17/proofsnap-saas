const pool = require("../config/db");

async function createAnnotation({ photoId, clientId, posXPct, posYPct, pathPct, noteText }) {
  const result = await pool.query(
    `INSERT INTO annotations (photo_id, client_id, pos_x_pct, pos_y_pct, path_pct, note_text)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, photo_id, client_id, pos_x_pct, pos_y_pct, path_pct, note_text, created_at`,
    [photoId, clientId, posXPct, posYPct, pathPct ? JSON.stringify(pathPct) : null, noteText]
  );
  return result.rows[0];
}

// Bước 2.2 — chỉ trả về ghi chú của CHÍNH client đang đăng nhập, không lộ ghi chú của
// khách khác trong cùng album (mỗi gia đình/khách mời có thể xem chung 1 album).
async function listByPhotoAndClient(photoId, clientId) {
  const result = await pool.query(
    `SELECT id, photo_id, client_id, pos_x_pct, pos_y_pct, path_pct, note_text, created_at
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
       a.id, a.photo_id, a.pos_x_pct, a.pos_y_pct, a.path_pct, a.note_text, a.created_at,
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

module.exports = { createAnnotation, listByPhotoAndClient, listByAlbum };
