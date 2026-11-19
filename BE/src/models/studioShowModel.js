const pool = require("../config/db");

// shoot_date trả về dạng chuỗi 'YYYY-MM-DD' — để node-pg tự đổi DATE sang Date thì bị lệch
// ngày theo múi giờ của server.
const SHOW_COLUMNS = `
  s.id, s.studio_user_id, s.invite_code,
  to_char(s.shoot_date, 'YYYY-MM-DD') AS shoot_date,
  s.shoot_end_time, s.shoot_end_time + interval '24 hours' AS deadline_at,
  s.class_name, s.school_name, s.status, s.created_at
`;

// Thống kê của cả lớp. "File gốc" (photo/video) và "ảnh đã hậu kỳ" (retouch) tách riêng —
// total_files / submitted_crew_count chỉ tính file gốc của thợ chụp/quay.
const SHOW_STATS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      count(*)::int                                                    AS submission_count,
      count(DISTINCT sub.crew_user_id) FILTER (WHERE sub.crew_type <> 'retouch')::int AS submitted_crew_count,
      count(*) FILTER (WHERE sub.status = 'submitted')::int            AS pending_count,
      count(*) FILTER (WHERE sub.status = 'approved')::int             AS approved_count,
      count(*) FILTER (WHERE sub.status = 'rejected')::int             AS rejected_count,
      count(*) FILTER (WHERE sub.is_on_time_24h = false)::int          AS late_count,
      COALESCE(sum(sub.total_files) FILTER (WHERE sub.crew_type <> 'retouch'), 0)::int AS total_files,
      COALESCE(sum(sub.total_files) FILTER (WHERE sub.crew_type = 'photo'), 0)::int AS total_photo_files,
      COALESCE(sum(sub.total_files) FILTER (WHERE sub.crew_type = 'video'), 0)::int AS total_video_clips,
      count(*) FILTER (WHERE sub.crew_type = 'retouch')::int           AS retouch_count,
      COALESCE(sum(sub.total_files) FILTER (WHERE sub.crew_type = 'retouch'), 0)::int AS total_retouch_files
    FROM show_submissions sub
    WHERE sub.show_id = s.id
  ) stats ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS member_count,
           count(*) FILTER (WHERE m.role_type = 'crew')::int AS crew_member_count,
           count(*) FILTER (WHERE m.role_type = 'editor')::int AS editor_count
    FROM show_members m WHERE m.show_id = s.id
  ) members ON true
`;

const STATS_COLUMNS = `
  stats.submission_count, stats.submitted_crew_count, stats.pending_count,
  stats.approved_count, stats.rejected_count, stats.late_count, stats.total_files,
  stats.total_photo_files, stats.total_video_clips, stats.retouch_count,
  stats.total_retouch_files, members.member_count, members.crew_member_count,
  members.editor_count
`;

function submissionColumns(alias) {
  return [
    "id", "show_id", "crew_user_id", "crew_name", "crew_type", "role_position",
    "formatted_folder_name", "drive_url", "total_files", "raw_count", "jpg_count",
    "video_count", "culled_stats", "has_valid_structure", "backup_committed_45d",
    "is_on_time_24h", "status", "studio_note", "submitted_at", "reviewed_at",
  ].map((column) => `${alias}.${column}`).join(", ");
}

async function createShow({ studioUserId, inviteCode, shootDate, shootEndTime, className, schoolName }) {
  const result = await pool.query(
    `WITH s AS (
       INSERT INTO studio_shows (studio_user_id, invite_code, shoot_date, shoot_end_time, class_name, school_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *
     )
     SELECT ${SHOW_COLUMNS} FROM s`,
    [studioUserId, inviteCode, shootDate, shootEndTime, className, schoolName]
  );
  return result.rows[0];
}

/** Mọi show user là chủ Studio hoặc đã tham gia (thợ / editor), kèm thống kê cả lớp. */
async function listShowsForUser(userId) {
  const result = await pool.query(
    `SELECT ${SHOW_COLUMNS}, ${STATS_COLUMNS},
            (s.studio_user_id = $1) AS is_owner,
            COALESCE(owner.display_name, owner.email) AS studio_name,
            me.joined_at, me.role_type AS member_role,
            (SELECT count(*)::int FROM show_submissions mine
              WHERE mine.show_id = s.id AND mine.crew_user_id = $1) AS my_submission_count,
            subs.submitters
     FROM studio_shows s
     JOIN photographers owner ON owner.id = s.studio_user_id
     LEFT JOIN show_members me ON me.show_id = s.id AND me.user_id = $1
     ${SHOW_STATS_JOIN}
     -- Ai đã nộp (để card hiện avatar) — không kèm drive_url
     LEFT JOIN LATERAL (
       SELECT COALESCE(json_agg(json_build_object(
                'crew_user_id', sub.crew_user_id,
                'crew_name', sub.crew_name,
                'crew_type', sub.crew_type,
                'role_position', sub.role_position,
                'status', sub.status,
                'is_on_time_24h', sub.is_on_time_24h
              ) ORDER BY sub.submitted_at), '[]'::json) AS submitters
       FROM show_submissions sub
       WHERE sub.show_id = s.id
     ) subs ON true
     WHERE s.studio_user_id = $1 OR me.user_id IS NOT NULL
     ORDER BY s.shoot_date DESC, s.created_at DESC`,
    [userId]
  );
  return result.rows;
}

/** Show mà user được xem (chủ Studio hoặc thành viên); null nếu không có quyền. */
async function findShowForUser(showId, userId) {
  const result = await pool.query(
    `SELECT ${SHOW_COLUMNS}, ${STATS_COLUMNS},
            (s.studio_user_id = $2) AS is_owner,
            (me.user_id IS NOT NULL) AS is_member,
            me.role_type AS member_role,
            COALESCE(owner.display_name, owner.email) AS studio_name
     FROM studio_shows s
     JOIN photographers owner ON owner.id = s.studio_user_id
     LEFT JOIN show_members me ON me.show_id = s.id AND me.user_id = $2
     ${SHOW_STATS_JOIN}
     WHERE s.id = $1 AND (s.studio_user_id = $2 OR me.user_id IS NOT NULL)`,
    [showId, userId]
  );
  return result.rows[0] || null;
}

async function findShowByInviteCode(inviteCode, userId) {
  const result = await pool.query(
    `SELECT ${SHOW_COLUMNS}, ${STATS_COLUMNS},
            (s.studio_user_id = $2) AS is_owner,
            (me.user_id IS NOT NULL) AS is_member,
            me.role_type AS member_role,
            COALESCE(owner.display_name, owner.email) AS studio_name
     FROM studio_shows s
     JOIN photographers owner ON owner.id = s.studio_user_id
     LEFT JOIN show_members me ON me.show_id = s.id AND me.user_id = $2
     ${SHOW_STATS_JOIN}
     WHERE s.invite_code = $1`,
    [inviteCode, userId]
  );
  return result.rows[0] || null;
}

/**
 * Thêm thành viên, hoặc đổi vai trò nếu người đó CHƯA nộp bài nào (nộp rồi thì vai trò bị khoá,
 * vì bài nộp gắn với vai trò: thợ nộp photo/video, editor nộp retouch).
 * Trả về { member, joined: true nếu mới vào, changed: true nếu đổi vai trò } hoặc
 * { locked: true, member } nếu không đổi được.
 */
async function upsertMember(showId, userId, roleType) {
  const inserted = await pool.query(
    `INSERT INTO show_members (show_id, user_id, role_type) VALUES ($1, $2, $3)
     ON CONFLICT ON CONSTRAINT uq_show_members_show_user DO NOTHING
     RETURNING id, show_id, user_id, role_type, joined_at`,
    [showId, userId, roleType]
  );
  if (inserted.rows[0]) return { member: inserted.rows[0], joined: true, changed: false };

  const updated = await pool.query(
    `UPDATE show_members m SET role_type = $3
     WHERE m.show_id = $1 AND m.user_id = $2 AND m.role_type <> $3
       AND NOT EXISTS (SELECT 1 FROM show_submissions sub WHERE sub.show_id = $1 AND sub.crew_user_id = $2)
     RETURNING id, show_id, user_id, role_type, joined_at`,
    [showId, userId, roleType]
  );
  if (updated.rows[0]) return { member: updated.rows[0], joined: false, changed: true };

  const current = await pool.query(
    `SELECT id, show_id, user_id, role_type, joined_at FROM show_members WHERE show_id = $1 AND user_id = $2`,
    [showId, userId]
  );
  const member = current.rows[0];
  return member.role_type === roleType
    ? { member, joined: false, changed: false }
    : { member, locked: true };
}

async function listSubmissions(showId) {
  const result = await pool.query(
    `SELECT ${submissionColumns("sub")}
     FROM show_submissions sub
     WHERE sub.show_id = $1
     ORDER BY sub.crew_type, sub.submitted_at`,
    [showId]
  );
  return result.rows;
}

async function listSubmissionsForCrew(showId, crewUserId) {
  const result = await pool.query(
    `SELECT ${submissionColumns("sub")}
     FROM show_submissions sub
     WHERE sub.show_id = $1 AND sub.crew_user_id = $2
     ORDER BY sub.submitted_at`,
    [showId, crewUserId]
  );
  return result.rows;
}

/**
 * Thành viên ekip kèm vai trò và số bài đã nộp — để hiện badge (Thợ ảnh / Thợ quay / Editor)
 * và để Studio thấy ai CHƯA nộp. crew_types: các loại file người đó đã nộp.
 */
async function listMembers(showId) {
  const result = await pool.query(
    `SELECT m.id, m.user_id, m.role_type, p.display_name, p.email, m.joined_at,
            count(sub.id)::int AS submission_count,
            COALESCE(array_agg(DISTINCT sub.crew_type) FILTER (WHERE sub.id IS NOT NULL), '{}') AS crew_types
     FROM show_members m
     JOIN photographers p ON p.id = m.user_id
     LEFT JOIN show_submissions sub ON sub.show_id = m.show_id AND sub.crew_user_id = m.user_id
     WHERE m.show_id = $1
     GROUP BY m.id, p.display_name, p.email
     ORDER BY m.role_type, m.joined_at`,
    [showId]
  );
  return result.rows;
}

/**
 * Nộp mới, hoặc nộp lại cùng vai trò (cập nhật dòng cũ, quay về 'submitted', tính lại đúng hạn).
 * Bài đã 'approved' thì không ghi đè — trả về null.
 * is_on_time_24h tính trong SQL bằng cùng now() với submitted_at, không lệch đồng hồ app/DB.
 */
async function upsertSubmission({
  showId, crewUserId, crewName, crewType, rolePosition, formattedFolderName, driveUrl,
  totalFiles, rawCount, jpgCount, videoCount, culledStats, hasValidStructure, backupCommitted45d,
}) {
  const result = await pool.query(
    `INSERT INTO show_submissions AS sub (
       show_id, crew_user_id, crew_name, crew_type, role_position, formatted_folder_name,
       drive_url, total_files, raw_count, jpg_count, video_count, culled_stats,
       has_valid_structure, backup_committed_45d, is_on_time_24h, status, submitted_at
     )
     SELECT s.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14,
            -- Hạn 24h chỉ áp dụng file gốc; ảnh hậu kỳ (retouch) không tính đúng/trễ hạn
            CASE WHEN $4 = 'retouch' THEN NULL ELSE now() <= s.shoot_end_time + interval '24 hours' END,
            'submitted', now()
     FROM studio_shows s
     WHERE s.id = $1
     ON CONFLICT ON CONSTRAINT uq_show_submission_role DO UPDATE SET
       crew_name = EXCLUDED.crew_name,
       crew_type = EXCLUDED.crew_type,
       formatted_folder_name = EXCLUDED.formatted_folder_name,
       drive_url = EXCLUDED.drive_url,
       total_files = EXCLUDED.total_files,
       raw_count = EXCLUDED.raw_count,
       jpg_count = EXCLUDED.jpg_count,
       video_count = EXCLUDED.video_count,
       culled_stats = EXCLUDED.culled_stats,
       has_valid_structure = EXCLUDED.has_valid_structure,
       backup_committed_45d = EXCLUDED.backup_committed_45d,
       is_on_time_24h = EXCLUDED.is_on_time_24h,
       status = 'submitted',
       studio_note = NULL,
       submitted_at = EXCLUDED.submitted_at,
       reviewed_at = NULL
     WHERE sub.status <> 'approved'
     RETURNING ${submissionColumns("sub")}, (xmax = 0) AS is_new`,
    [
      showId, crewUserId, crewName, crewType, rolePosition, formattedFolderName, driveUrl,
      totalFiles, rawCount, jpgCount, videoCount, JSON.stringify(culledStats),
      hasValidStructure, backupCommitted45d,
    ]
  );
  return result.rows[0] || null;
}

/**
 * Bài nộp kèm quyền của user trên show chứa nó: is_owner (chủ Studio) / is_member.
 * null nếu không có bài, hoặc user không liên quan gì tới show (để trả 404, không lộ bài).
 */
async function findSubmissionWithAccess(submissionId, userId) {
  const result = await pool.query(
    `SELECT ${submissionColumns("sub")},
            (s.studio_user_id = $2) AS is_owner,
            EXISTS (SELECT 1 FROM show_members m WHERE m.show_id = s.id AND m.user_id = $2) AS is_member
     FROM show_submissions sub
     JOIN studio_shows s ON s.id = sub.show_id
     WHERE sub.id = $1`,
    [submissionId, userId]
  );
  const row = result.rows[0];
  return row && (row.is_owner || row.is_member) ? row : null;
}

/** Chỉ chủ Studio mới xoá được — trả về true nếu đã xoá. */
async function deleteShowForStudio(showId, studioUserId) {
  const result = await pool.query(
    "DELETE FROM studio_shows WHERE id = $1 AND studio_user_id = $2",
    [showId, studioUserId]
  );
  return result.rowCount === 1;
}

async function reviewSubmission(submissionId, { status, studioNote }) {
  const result = await pool.query(
    `UPDATE show_submissions sub
     SET status = $2, studio_note = $3, reviewed_at = now()
     WHERE sub.id = $1
     RETURNING ${submissionColumns("sub")}`,
    [submissionId, status, studioNote]
  );
  return result.rows[0] || null;
}

module.exports = {
  createShow,
  listShowsForUser,
  findShowForUser,
  findShowByInviteCode,
  upsertMember,
  deleteShowForStudio,
  listSubmissions,
  listSubmissionsForCrew,
  listMembers,
  upsertSubmission,
  findSubmissionWithAccess,
  reviewSubmission,
};
