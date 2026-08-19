const pool = require("../config/db");

const ALBUM_COLUMNS = `
  id, photographer_id, name, drive_folder_id, pin_enabled, max_selectable_photos,
  selection_deadline, is_locked, watermark_enabled, compression_preset_id,
  download_zip_unlocked, zip_drive_file_id, is_minor_album, status, created_at, updated_at
`;

async function listByPhotographerId(photographerId) {
  const result = await pool.query(
    `SELECT ${ALBUM_COLUMNS} FROM albums WHERE photographer_id = $1 ORDER BY created_at DESC`,
    [photographerId]
  );
  return result.rows;
}

async function findByIdForPhotographer(albumId, photographerId) {
  const result = await pool.query(
    `SELECT ${ALBUM_COLUMNS} FROM albums WHERE id = $1 AND photographer_id = $2`,
    [albumId, photographerId]
  );
  return result.rows[0] || null;
}

async function findPublicById(albumId) {
  const result = await pool.query(
    `SELECT ${ALBUM_COLUMNS}, pin_hash FROM albums WHERE id = $1`,
    [albumId]
  );
  return result.rows[0] || null;
}

async function createAlbum({
  photographerId,
  name,
  driveFolderId,
  pinEnabled,
  pinHash,
  maxSelectablePhotos,
  selectionDeadline,
  watermarkEnabled,
  compressionPresetId,
  isMinorAlbum,
}) {
  const result = await pool.query(
    `INSERT INTO albums (
      photographer_id, name, drive_folder_id, pin_enabled, pin_hash,
      max_selectable_photos, selection_deadline, watermark_enabled,
      compression_preset_id, is_minor_album
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING ${ALBUM_COLUMNS}`,
    [
      photographerId,
      name,
      driveFolderId,
      pinEnabled,
      pinHash,
      maxSelectablePhotos,
      selectionDeadline,
      watermarkEnabled,
      compressionPresetId,
      isMinorAlbum,
    ]
  );
  return result.rows[0];
}

async function updateAlbum(albumId, photographerId, fields) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return findByIdForPhotographer(albumId, photographerId);
  }

  const fieldValues = entries.map(([, value]) => value);
  const assignments = entries.map(([key], index) => `${key} = $${index + 3}`);

  const result = await pool.query(
    `UPDATE albums SET ${assignments.join(", ")}, updated_at = now()
     WHERE id = $1 AND photographer_id = $2
     RETURNING ${ALBUM_COLUMNS}`,
    [albumId, photographerId, ...fieldValues]
  );
  return result.rows[0] || null;
}

async function archiveAlbum(albumId, photographerId) {
  const result = await pool.query(
    `UPDATE albums SET status = 'archived', updated_at = now()
     WHERE id = $1 AND photographer_id = $2
     RETURNING ${ALBUM_COLUMNS}`,
    [albumId, photographerId]
  );
  return result.rows[0] || null;
}

module.exports = {
  listByPhotographerId,
  findByIdForPhotographer,
  findPublicById,
  createAlbum,
  updateAlbum,
  archiveAlbum,
};
