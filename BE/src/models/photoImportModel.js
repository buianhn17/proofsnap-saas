const pool = require("../config/db");

const IMPORT_COLUMNS = `
  id, album_id, source_url, source_kind, source_name, status, total_files, imported_count,
  skipped_existing_count, unsupported_count, failed_count, failed_files, error_message,
  created_at, started_at, finished_at
`;
const MAX_FAILED_FILES_KEPT = 50;

async function createImport({ albumId, photographerId, sourceUrl, sourceKind, sourceId, sourceName, totalFiles, unsupportedCount }) {
  const result = await pool.query(
    `INSERT INTO photo_imports
       (album_id, photographer_id, source_url, source_kind, source_id, source_name, total_files, unsupported_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${IMPORT_COLUMNS}`,
    [albumId, photographerId, sourceUrl, sourceKind, sourceId, sourceName, totalFiles, unsupportedCount]
  );
  return result.rows[0];
}

/** Bản đầy đủ cho worker (có photographer_id, source_id). */
async function findImportForWorker(importId) {
  const result = await pool.query(
    `SELECT ${IMPORT_COLUMNS}, photographer_id, source_id FROM photo_imports WHERE id = $1`,
    [importId]
  );
  return result.rows[0] || null;
}

async function findImport(importId, albumId) {
  const result = await pool.query(
    `SELECT ${IMPORT_COLUMNS} FROM photo_imports WHERE id = $1 AND album_id = $2`,
    [importId, albumId]
  );
  return result.rows[0] || null;
}

async function listImports(albumId, limit = 5) {
  const result = await pool.query(
    `SELECT ${IMPORT_COLUMNS} FROM photo_imports WHERE album_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [albumId, limit]
  );
  return result.rows;
}

async function findActiveImport(albumId) {
  const result = await pool.query(
    `SELECT ${IMPORT_COLUMNS} FROM photo_imports WHERE album_id = $1 AND status IN ('queued', 'running')`,
    [albumId]
  );
  return result.rows[0] || null;
}

async function getStatus(importId) {
  const result = await pool.query("SELECT status FROM photo_imports WHERE id = $1", [importId]);
  return result.rows[0]?.status ?? null;
}

async function markRunning(importId, { totalFiles, skippedExisting, unsupportedCount }) {
  await pool.query(
    `UPDATE photo_imports
     SET status = 'running', started_at = COALESCE(started_at, now()), total_files = $2,
         skipped_existing_count = $3, unsupported_count = $4,
         -- Chạy (lại) từ đầu: ảnh của lần chạy trước đã nằm trong skipped_existing_count,
         -- lỗi cũ được thử lại — đếm lại để imported + skipped + failed = total
         imported_count = 0, failed_count = 0, failed_files = '[]'::jsonb
     WHERE id = $1 AND status IN ('queued', 'running')`,
    [importId, totalFiles, skippedExisting, unsupportedCount]
  );
}

async function addImported(importId) {
  await pool.query("UPDATE photo_imports SET imported_count = imported_count + 1 WHERE id = $1", [importId]);
}

/** Cộng dồn tiến độ theo lô (đỡ 1 câu UPDATE cho mỗi ảnh). */
async function addProgress(importId, { imported = 0, skipped = 0 }) {
  await pool.query(
    `UPDATE photo_imports
     SET imported_count = imported_count + $2, skipped_existing_count = skipped_existing_count + $3
     WHERE id = $1`,
    [importId, imported, skipped]
  );
}

async function addSkippedExisting(importId) {
  await pool.query(
    "UPDATE photo_imports SET skipped_existing_count = skipped_existing_count + 1 WHERE id = $1",
    [importId]
  );
}

async function addFailed(importId, { name, reason }) {
  await pool.query(
    `UPDATE photo_imports
     SET failed_count = failed_count + 1,
         failed_files = CASE WHEN jsonb_array_length(failed_files) < $3
                             THEN failed_files || jsonb_build_array(jsonb_build_object('name', $2::text, 'reason', $4::text))
                             ELSE failed_files END
     WHERE id = $1`,
    [importId, name, MAX_FAILED_FILES_KEPT, reason]
  );
}

/** Kết thúc lượt nhập — không ghi đè nếu PTG đã bấm huỷ. */
async function finishImport(importId, status, errorMessage = null) {
  await pool.query(
    `UPDATE photo_imports
     SET status = CASE WHEN status = 'cancelled' THEN status ELSE $2 END,
         error_message = COALESCE($3, error_message),
         finished_at = now()
     WHERE id = $1`,
    [importId, status, errorMessage]
  );
}

async function requestCancel(importId, albumId) {
  const result = await pool.query(
    `UPDATE photo_imports SET status = 'cancelled', finished_at = now()
     WHERE id = $1 AND album_id = $2 AND status IN ('queued', 'running')
     RETURNING ${IMPORT_COLUMNS}`,
    [importId, albumId]
  );
  return result.rows[0] || null;
}

/** Lượt nhập còn dở khi server tắt — chạy tiếp khi khởi động lại. */
async function listResumable() {
  const result = await pool.query(
    "SELECT id FROM photo_imports WHERE status IN ('queued', 'running') ORDER BY created_at"
  );
  return result.rows.map((row) => row.id);
}

async function findCompressionPreset(presetId) {
  const result = await pool.query(
    "SELECT id, jpeg_quality, max_long_edge_px FROM compression_presets WHERE id = $1",
    [presetId]
  );
  return result.rows[0] || null;
}

module.exports = {
  createImport,
  findImportForWorker,
  findImport,
  listImports,
  findActiveImport,
  getStatus,
  markRunning,
  addImported,
  addProgress,
  addSkippedExisting,
  addFailed,
  finishImport,
  requestCancel,
  listResumable,
  findCompressionPreset,
};
