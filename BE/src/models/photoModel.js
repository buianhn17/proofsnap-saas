const pool = require("../config/db");

const PHOTO_COLUMNS = `
  id, album_id, scene_id, burst_cluster_id, drive_file_id,
  original_base_filename, width, height, file_size_bytes, captured_at,
  sharpness_score, eye_status, culling_flag, is_best_in_cluster, face_index_status, created_at
`;

// Thứ tự ảnh trong album: theo giờ chụp (EXIF), ảnh không có giờ chụp xếp sau theo tên file
// (thứ tự máy ảnh đánh số). Không sắp theo created_at — trình duyệt upload song song nên ảnh
// upload xong không theo thứ tự chụp.
const ALBUM_PHOTO_ORDER = "captured_at ASC NULLS LAST, original_base_filename ASC, created_at ASC";

async function listByAlbumId(albumId) {
  const result = await pool.query(
    `SELECT ${PHOTO_COLUMNS} FROM photos WHERE album_id = $1 ORDER BY ${ALBUM_PHOTO_ORDER}`,
    [albumId]
  );
  return result.rows;
}

async function findByClientUploadId(albumId, clientUploadId) {
  const result = await pool.query(
    `SELECT ${PHOTO_COLUMNS} FROM photos WHERE album_id = $1 AND client_upload_id = $2`,
    [albumId, clientUploadId]
  );
  return result.rows[0] || null;
}

async function findByAlbumAndId(albumId, photoId) {
  const result = await pool.query(
    `SELECT ${PHOTO_COLUMNS} FROM photos WHERE album_id = $1 AND id = $2`,
    [albumId, photoId]
  );
  return result.rows[0] || null;
}

async function createPhoto({
  albumId,
  driveFileId,
  originalBaseFilename,
  width,
  height,
  fileSizeBytes,
  capturedAt,
  sharpnessScore,
  eyeStatus,
  cullingFlag,
  sceneId,
  burstClusterId,
  isBestInCluster,
  clientUploadId,
}) {
  // face_index_status = 'pending': embedding khuôn mặt được trích nền sau khi trả lời upload
  // (faceIndexQueue.js).
  const result = await pool.query(
    `INSERT INTO photos (
      album_id, drive_file_id, original_base_filename, width, height,
      file_size_bytes, captured_at, sharpness_score, eye_status, culling_flag,
      scene_id, burst_cluster_id, is_best_in_cluster, client_upload_id, face_index_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending')
    RETURNING ${PHOTO_COLUMNS}`,
    [
      albumId,
      driveFileId,
      originalBaseFilename,
      width,
      height,
      fileSizeBytes,
      capturedAt,
      sharpnessScore,
      eyeStatus,
      cullingFlag,
      sceneId ?? null,
      burstClusterId ?? null,
      isBestInCluster ?? false,
      clientUploadId ?? null,
    ]
  );
  return result.rows[0];
}

// --- Hàng đợi trích embedding khuôn mặt (faceIndexQueue.js) ---

async function setFaceIndexStatus(photoId, status) {
  await pool.query("UPDATE photos SET face_index_status = $2 WHERE id = $1", [photoId, status]);
}

/** Tăng số lần thử, trả về số lần đã thử (null nếu ảnh đã bị xoá). */
async function incrementFaceIndexAttempts(photoId) {
  const result = await pool.query(
    `UPDATE photos SET face_index_attempts = face_index_attempts + 1
     WHERE id = $1 RETURNING face_index_attempts`,
    [photoId]
  );
  return result.rows[0]?.face_index_attempts ?? null;
}

/** Ảnh còn chờ trích embedding — chạy tiếp khi server khởi động lại. */
async function listPendingFaceIndex() {
  const result = await pool.query(
    `SELECT p.id, p.drive_file_id, a.photographer_id
     FROM photos p
     JOIN albums a ON a.id = p.album_id
     WHERE p.face_index_status = 'pending'
     ORDER BY p.created_at ASC`
  );
  return result.rows;
}

async function existsById(photoId) {
  const result = await pool.query("SELECT 1 FROM photos WHERE id = $1", [photoId]);
  return result.rowCount > 0;
}

// Bước 4.2 — ảnh nguồn cho ZIP dynamic (khi album chưa có zip_drive_file_id do PTG upload
// riêng): hợp toàn bộ ảnh ĐÃ ĐƯỢC ÍT NHẤT 1 KHÁCH chọn trong album — không chỉ ảnh của 1
// khách cụ thể, vì download_zip_unlocked/zip_drive_file_id là cấu hình chung cho CẢ album
// (không phải theo từng khách), khớp cách Bước 4.1 tổng hợp "toàn bộ ảnh đã chọn theo album".
async function listSelectedForAlbum(albumId) {
  const result = await pool.query(
    `SELECT id, drive_file_id, original_base_filename
     FROM photos
     WHERE album_id = $1 AND EXISTS (SELECT 1 FROM selections s WHERE s.photo_id = photos.id)
     ORDER BY ${ALBUM_PHOTO_ORDER}`,
    [albumId]
  );
  return result.rows;
}

// Bước 4.2 (tải từng ảnh trên mobile) — 1 ảnh trong tập ZIP dynamic ở trên (đã được ít nhất
// 1 khách chọn). null nếu ảnh không thuộc album hoặc chưa ai chọn — chặn khách đoán photoId
// để tải ảnh gốc không watermark của ảnh nằm ngoài tập được mở khóa.
async function findSelectedInAlbum(albumId, photoId) {
  const result = await pool.query(
    `SELECT id, drive_file_id, original_base_filename
     FROM photos
     WHERE album_id = $1 AND id = $2
       AND EXISTS (SELECT 1 FROM selections s WHERE s.photo_id = photos.id)`,
    [albumId, photoId]
  );
  return result.rows[0] || null;
}

module.exports = {
  listByAlbumId,
  createPhoto,
  findByAlbumAndId,
  findByClientUploadId,
  listSelectedForAlbum,
  findSelectedInAlbum,
  setFaceIndexStatus,
  incrementFaceIndexAttempts,
  listPendingFaceIndex,
  existsById,
};