const pool = require("../config/db");

const PHOTO_COLUMNS = `
  id, album_id, scene_id, burst_cluster_id, drive_file_id,
  original_base_filename, width, height, file_size_bytes, captured_at,
  sharpness_score, eye_status, culling_flag, is_best_in_cluster, created_at
`;

async function listByAlbumId(albumId) {
  const result = await pool.query(
    `SELECT ${PHOTO_COLUMNS} FROM photos WHERE album_id = $1 ORDER BY created_at ASC`,
    [albumId]
  );
  return result.rows;
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
}) {
  const result = await pool.query(
    `INSERT INTO photos (
      album_id, drive_file_id, original_base_filename, width, height,
      file_size_bytes, captured_at, sharpness_score, eye_status, culling_flag,
      scene_id, burst_cluster_id, is_best_in_cluster
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
    ]
  );
  return result.rows[0];
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
     ORDER BY created_at ASC`,
    [albumId]
  );
  return result.rows;
}

module.exports = { listByAlbumId, createPhoto, findByAlbumAndId, listSelectedForAlbum };