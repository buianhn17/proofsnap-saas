const pool = require("../config/db");

// Bước 4.1 — hợp toàn bộ ảnh trong album đã được ÍT NHẤT 1 khách thả tim, HOẶC có ít nhất 1
// ghi chú khoanh vùng — đây là "yêu cầu chỉnh sửa" PTG cần xử lý: ảnh khách muốn giữ (dù
// không ghi chú gì thêm) và ảnh có note dù khách quên/không thả tim (annotate rồi mới đổi ý
// không chọn) đều cần có mặt trong danh sách xuất tên file.
async function findEditRequestPhotos(albumId) {
  const result = await pool.query(
    `SELECT id, original_base_filename, created_at
     FROM photos
     WHERE album_id = $1
       AND (
         EXISTS (SELECT 1 FROM selections s WHERE s.photo_id = photos.id)
         OR EXISTS (SELECT 1 FROM annotations a WHERE a.photo_id = photos.id)
       )
     ORDER BY created_at ASC`,
    [albumId]
  );
  return result.rows;
}

async function logExport(albumId, filenameList) {
  const result = await pool.query(
    `INSERT INTO filename_exports (album_id, filename_list)
     VALUES ($1, $2)
     RETURNING id, album_id, generated_at, filename_list`,
    [albumId, filenameList]
  );
  return result.rows[0];
}

module.exports = { findEditRequestPhotos, logExport };
