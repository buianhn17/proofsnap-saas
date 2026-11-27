// Truy vấn tổng hợp cho Admin Portal: Bảng điều khiển, danh sách Khách hàng, Cài đặt PTG.
// Mọi truy vấn đều lọc theo photographer_id — PTG chỉ thấy dữ liệu album của chính mình.
const pool = require("../config/db");

async function getDashboard(photographerId) {
  const [albums, totals, deadlines, activity] = await Promise.all([
    pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'active' AND NOT is_locked
           AND (selection_deadline IS NULL OR selection_deadline > now()))::int AS open,
         count(*) FILTER (WHERE status = 'active' AND (is_locked
           OR (selection_deadline IS NOT NULL AND selection_deadline <= now())))::int AS locked,
         count(*) FILTER (WHERE status = 'archived')::int AS archived
       FROM albums WHERE photographer_id = $1`,
      [photographerId]
    ),
    pool.query(
      `SELECT
         (SELECT count(*)::int FROM photos p JOIN albums a ON a.id = p.album_id
            WHERE a.photographer_id = $1) AS photos,
         (SELECT count(*)::int FROM clients c JOIN albums a ON a.id = c.album_id
            WHERE a.photographer_id = $1) AS clients,
         (SELECT count(*)::int FROM album_client_completions comp
            JOIN clients c ON c.id = comp.client_id JOIN albums a ON a.id = c.album_id
            WHERE a.photographer_id = $1 AND comp.completed_at IS NOT NULL) AS completed_clients,
         (SELECT count(*)::int FROM selections s JOIN clients c ON c.id = s.client_id
            JOIN albums a ON a.id = c.album_id WHERE a.photographer_id = $1) AS selections,
         (SELECT count(*)::int FROM annotations an JOIN photos p ON p.id = an.photo_id
            JOIN albums a ON a.id = p.album_id
            WHERE a.photographer_id = $1 AND an.status = 'pending') AS pending_annotations,
         (SELECT count(*)::int FROM clients c JOIN albums a ON a.id = c.album_id
            WHERE a.photographer_id = $1 AND c.payment_status <> 'paid') AS unpaid_clients`,
      [photographerId]
    ),
    pool.query(
      `SELECT a.id, a.name, a.selection_deadline, a.max_selectable_photos,
              (SELECT count(*)::int FROM clients c WHERE c.album_id = a.id) AS client_count,
              (SELECT count(*)::int FROM album_client_completions comp JOIN clients c ON c.id = comp.client_id
                 WHERE c.album_id = a.id AND comp.completed_at IS NOT NULL) AS completed_count
       FROM albums a
       WHERE a.photographer_id = $1 AND a.status = 'active' AND NOT a.is_locked
         AND a.selection_deadline IS NOT NULL AND a.selection_deadline > now()
       ORDER BY a.selection_deadline ASC
       LIMIT 5`,
      [photographerId]
    ),
    pool.query(
      `SELECT * FROM (
         SELECT CASE WHEN comp.auto_locked THEN 'auto_locked' ELSE 'completed' END AS kind, comp.completed_at AS at, ca.full_name AS client_name,
                a.id AS album_id, a.name AS album_name, c.id AS client_id, NULL::text AS detail
         FROM album_client_completions comp
         JOIN clients c ON c.id = comp.client_id
         JOIN client_accounts ca ON ca.id = c.client_account_id
         JOIN albums a ON a.id = c.album_id
         WHERE a.photographer_id = $1 AND comp.completed_at IS NOT NULL
         UNION ALL
         SELECT 'annotation', an.created_at, ca.full_name, a.id, a.name, c.id, left(an.note_text, 120)
         FROM annotations an
         JOIN clients c ON c.id = an.client_id
         JOIN client_accounts ca ON ca.id = c.client_account_id
         JOIN photos p ON p.id = an.photo_id
         JOIN albums a ON a.id = p.album_id
         WHERE a.photographer_id = $1
         UNION ALL
         SELECT 'joined', c.created_at, ca.full_name, a.id, a.name, c.id, NULL
         FROM clients c
         JOIN client_accounts ca ON ca.id = c.client_account_id
         JOIN albums a ON a.id = c.album_id
         WHERE a.photographer_id = $1
       ) feed
       ORDER BY at DESC
       LIMIT 12`,
      [photographerId]
    ),
  ]);
  return {
    albums: albums.rows[0],
    totals: totals.rows[0],
    upcoming_deadlines: deadlines.rows,
    recent_activity: activity.rows,
  };
}

const CLIENT_FILTERS = {
  all: "TRUE",
  completed: "comp.completed_at IS NOT NULL",
  in_progress: "comp.completed_at IS NULL",
  unpaid: "c.payment_status <> 'paid'",
};

// Ký tự % và _ trong từ khoá là ký tự thường, không phải wildcard của LIKE.
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

async function listClients(photographerId, { search = null, filter = "all", albumId = null } = {}) {
  const where = CLIENT_FILTERS[filter] ?? CLIENT_FILTERS.all;
  const pattern = search ? `%${escapeLike(search)}%` : null;
  const result = await pool.query(
    `SELECT c.id, c.album_id, a.name AS album_name, a.max_selectable_photos,
            ca.full_name AS name, ca.phone_number AS phone,
            c.payment_status, c.payment_note, c.payment_updated_at, c.created_at,
            comp.completed_at, COALESCE(comp.auto_locked, false) AS auto_locked,
            (SELECT count(*)::int FROM selections s WHERE s.client_id = c.id) AS selected_count,
            (SELECT count(*)::int FROM annotations an WHERE an.client_id = c.id) AS annotation_count,
            (SELECT count(*)::int FROM annotations an WHERE an.client_id = c.id AND an.status = 'pending')
              AS pending_annotation_count,
            GREATEST(c.created_at, comp.completed_at,
              (SELECT max(s.selected_at) FROM selections s WHERE s.client_id = c.id),
              (SELECT max(an.created_at) FROM annotations an WHERE an.client_id = c.id)) AS last_activity_at
     FROM clients c
     JOIN albums a ON a.id = c.album_id AND a.photographer_id = $1
     JOIN client_accounts ca ON ca.id = c.client_account_id
     LEFT JOIN album_client_completions comp ON comp.client_id = c.id
     WHERE (${where})
       AND ($2::text IS NULL OR ca.full_name ILIKE $2 OR ca.phone_number ILIKE $2 OR a.name ILIKE $2)
       AND ($3::uuid IS NULL OR c.album_id = $3)
     ORDER BY last_activity_at DESC NULLS LAST
     LIMIT 500`,
    [photographerId, pattern, albumId]
  );
  return result.rows;
}

/** Số khách gửi lựa chọn (kể cả tự chốt khi hết hạn) kể từ lần cuối PTG mở trang Khách hàng. */
async function countUnseenCompletions(photographerId) {
  const result = await pool.query(
    `SELECT count(*)::int AS n
     FROM album_client_completions comp
     JOIN clients c ON c.id = comp.client_id
     JOIN albums a ON a.id = c.album_id
     JOIN photographers p ON p.id = a.photographer_id
     WHERE a.photographer_id = $1 AND comp.completed_at IS NOT NULL
       AND (p.clients_seen_at IS NULL OR comp.completed_at > p.clients_seen_at)`,
    [photographerId]
  );
  return result.rows[0].n;
}

async function markClientsSeen(photographerId) {
  await pool.query("UPDATE photographers SET clients_seen_at = now() WHERE id = $1", [photographerId]);
}

/** 1 khách (thuộc album của PTG) + danh sách tên file đã chọn — để copy sang Lightroom. */
async function findClientForPhotographer(clientId, photographerId) {
  const client = await listClientsByIds(photographerId, clientId);
  if (!client) return null;
  const files = await pool.query(
    `SELECT p.id, p.original_base_filename
     FROM selections s JOIN photos p ON p.id = s.photo_id
     WHERE s.client_id = $1
     ORDER BY p.captured_at ASC NULLS LAST, p.original_base_filename ASC`,
    [clientId]
  );
  return { ...client, selected_photos: files.rows };
}

async function listClientsByIds(photographerId, clientId) {
  const result = await pool.query(
    `SELECT c.id, c.album_id, a.name AS album_name, a.max_selectable_photos,
            ca.full_name AS name, ca.phone_number AS phone,
            c.payment_status, c.payment_note, c.payment_updated_at, c.created_at, comp.completed_at,
            COALESCE(comp.auto_locked, false) AS auto_locked
     FROM clients c
     JOIN albums a ON a.id = c.album_id AND a.photographer_id = $1
     JOIN client_accounts ca ON ca.id = c.client_account_id
     LEFT JOIN album_client_completions comp ON comp.client_id = c.id
     WHERE c.id = $2`,
    [photographerId, clientId]
  );
  return result.rows[0] || null;
}

async function updateClientPayment(clientId, photographerId, { paymentStatus, paymentNote }) {
  const result = await pool.query(
    `UPDATE clients c
     SET payment_status = COALESCE($3, c.payment_status),
         payment_note = CASE WHEN $4::boolean THEN $5 ELSE c.payment_note END,
         payment_updated_at = now()
     FROM albums a
     WHERE c.id = $1 AND a.id = c.album_id AND a.photographer_id = $2
     RETURNING c.id`,
    [clientId, photographerId, paymentStatus ?? null, paymentNote !== undefined, paymentNote ?? null]
  );
  if (result.rowCount === 0) return null;
  return listClientsByIds(photographerId, clientId);
}

async function getSettings(photographerId) {
  const result = await pool.query(
    `SELECT id, email, display_name, settings, drive_root_folder_id IS NOT NULL AS drive_connected, created_at
     FROM photographers WHERE id = $1`,
    [photographerId]
  );
  return result.rows[0] || null;
}

async function updateSettings(photographerId, { displayName, settings }) {
  const result = await pool.query(
    `UPDATE photographers
     SET display_name = COALESCE($2, display_name),
         settings = CASE WHEN $3::jsonb IS NULL THEN settings ELSE settings || $3::jsonb END,
         updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [photographerId, displayName ?? null, settings ? JSON.stringify(settings) : null]
  );
  return result.rowCount ? getSettings(photographerId) : null;
}

module.exports = {
  getDashboard,
  listClients,
  countUnseenCompletions,
  markClientsSeen,
  findClientForPhotographer,
  updateClientPayment,
  getSettings,
  updateSettings,
};
