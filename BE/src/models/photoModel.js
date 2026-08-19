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
}) {
  const result = await pool.query(
    `INSERT INTO photos (
      album_id, drive_file_id, original_base_filename, width, height,
      file_size_bytes, captured_at, sharpness_score, eye_status, culling_flag
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    ]
  );
  return result.rows[0];
}

module.exports = { listByAlbumId, createPhoto, findByAlbumAndId };