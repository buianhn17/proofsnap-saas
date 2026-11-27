const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const pool = require("../config/db");

function normalizePhone(phone) {
  return phone.replace(/[\s()-]/g, "");
}

// Luồng hiện tại xác thực khách bằng PIN + tên/SĐT (không có email/mật khẩu),
// nhưng bảng client_accounts (schema) yêu cầu email UNIQUE NOT NULL và
// password_hash NOT NULL cho hướng phát triển tài khoản khách dùng chung
// nền tảng sau này. Vì vậy tạo email/password nội bộ suy ra từ SĐT đã chuẩn
// hóa — không dùng để đăng nhập, chỉ để thỏa mãn schema và khớp đúng khách
// quay lại theo cùng SĐT. account.clients chỉ được tạo lúc khách bấm tim lần
// đầu (không tạo khi chỉ xem ảnh) — đúng theo ghi chú trong lensproof_schema.sql.
async function findOrCreateClientAccount({ name, phone }) {
  const normalizedPhone = normalizePhone(phone);
  const email = `${normalizedPhone}@client.lensproof.local`;
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

  const result = await pool.query(
    `INSERT INTO client_accounts (email, password_hash, full_name, phone_number)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id, email, full_name, phone_number`,
    [email, passwordHash, name, normalizedPhone]
  );
  return result.rows[0];
}

// Bước 2.2 — tra cứu thuần đọc, KHÔNG tạo mới, dùng cho các endpoint chỉ xem (ví dụ liệt kê
// ghi chú của chính khách) để không vô tình tạo client_accounts/clients khi khách chưa từng
// bấm tim/ghi chú lần nào — đúng theo ghi chú thiết kế trong lensproof_schema.sql mục 11.
async function findClientAccountByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  const email = `${normalizedPhone}@client.lensproof.local`;
  const result = await pool.query(
    "SELECT id, email, full_name, phone_number FROM client_accounts WHERE email = $1",
    [email]
  );
  return result.rows[0] || null;
}

async function findClient({ albumId, clientAccountId }) {
  const result = await pool.query(
    `SELECT id, album_id, client_account_id, face_search_consent_at, is_minor_flagged
     FROM clients WHERE album_id = $1 AND client_account_id = $2`,
    [albumId, clientAccountId]
  );
  return result.rows[0] || null;
}

async function findOrCreateClient({ albumId, clientAccountId }) {
  const result = await pool.query(
    `INSERT INTO clients (album_id, client_account_id)
     VALUES ($1, $2)
     ON CONFLICT (album_id, client_account_id) DO UPDATE SET album_id = EXCLUDED.album_id
     RETURNING id, album_id, client_account_id, face_search_consent_at, is_minor_flagged`,
    [albumId, clientAccountId]
  );
  return result.rows[0];
}

class SelectionLimitError extends Error {
  constructor({ maxSelectable, selectedCount }) {
    super(`Bạn đã chọn đủ ${maxSelectable} ảnh — bỏ chọn bớt 1 ảnh để chọn ảnh khác`);
    this.statusCode = 409;
    this.code = "SELECTION_LIMIT_REACHED";
    this.maxSelectable = maxSelectable;
    this.selectedCount = selectedCount;
  }
}

/**
 * L5 (FR-07) — thả/bỏ tim trong 1 transaction có khoá, để 2 lượt bấm song song (2 tab, bấm
 * nhanh liên tiếp) không vượt được albums.max_selectable_photos:
 *   - FOR UPDATE trên dòng clients: các lượt thả tim của CÙNG 1 khách chạy tuần tự.
 *   - FOR SHARE trên dòng albums: PTG không đổi hạn mức giữa lúc đếm và lúc ghi.
 * Bỏ chọn luôn được phép (kể cả khi PTG vừa hạ hạn mức xuống thấp hơn số đã chọn).
 * @returns {Promise<{ selected: boolean, selectedCount: number, maxSelectable: number|null }>}
 */
async function toggleSelection({ albumId, clientId, photoId }) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const album = await db.query(
      "SELECT max_selectable_photos FROM albums WHERE id = $1 FOR SHARE",
      [albumId]
    );
    await db.query("SELECT id FROM clients WHERE id = $1 FOR UPDATE", [clientId]);
    const maxSelectable = album.rows[0]?.max_selectable_photos ?? null;

    const deleted = await db.query(
      "DELETE FROM selections WHERE client_id = $1 AND photo_id = $2 RETURNING id",
      [clientId, photoId]
    );
    const countResult = await db.query(
      "SELECT count(*)::int AS n FROM selections WHERE client_id = $1",
      [clientId]
    );
    let selectedCount = countResult.rows[0].n;

    if (deleted.rows.length > 0) {
      await db.query("COMMIT");
      return { selected: false, selectedCount, maxSelectable };
    }
    if (maxSelectable !== null && selectedCount >= maxSelectable) {
      throw new SelectionLimitError({ maxSelectable, selectedCount });
    }
    await db.query("INSERT INTO selections (client_id, photo_id) VALUES ($1, $2)", [clientId, photoId]);
    selectedCount += 1;
    await db.query("COMMIT");
    return { selected: true, selectedCount, maxSelectable };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

/** Mốc khách xác nhận hoàn tất chọn ảnh (null nếu chưa hoặc đã mở lại). */
async function findCompletion(clientId) {
  const result = await pool.query(
    "SELECT completed_at, auto_locked FROM album_client_completions WHERE client_id = $1",
    [clientId]
  );
  return result.rows[0]?.completed_at ? result.rows[0] : null;
}

/** Khách xác nhận hoàn tất (mục 5.2 tài liệu gốc). Trả về { completed_at } mới. */
async function markCompleted(clientId) {
  const result = await pool.query(
    `INSERT INTO album_client_completions (client_id, completed_at, auto_locked)
     VALUES ($1, now(), false)
     ON CONFLICT (client_id) DO UPDATE SET completed_at = now(), auto_locked = false
     RETURNING completed_at, auto_locked`,
    [clientId]
  );
  return result.rows[0];
}

/** Khách mở lại để sửa lựa chọn (chỉ khi album chưa hết hạn/khoá — kiểm tra ở route). */
async function reopenCompletion(clientId) {
  await pool.query("UPDATE album_client_completions SET completed_at = NULL WHERE client_id = $1", [clientId]);
}

/** Id các ảnh khách này đã thả tim trong album (để Client Portal hiện lại trạng thái sau khi tải lại trang). */
async function listSelectedPhotoIds(clientId) {
  const result = await pool.query("SELECT photo_id FROM selections WHERE client_id = $1", [clientId]);
  return result.rows.map((row) => row.photo_id);
}

// Bước 3.1 — set mốc đồng ý lần đầu (idempotent: không ghi đè nếu đã đồng ý từ trước, giữ
// đúng thời điểm đồng ý ĐẦU TIÊN làm bằng chứng). Log chi tiết từng lần xác nhận (kể cả xác
// nhận lại) nằm ở face_search_consent_logs — xem recordFaceSearchConsentLog bên dưới.
async function setFaceSearchConsent(clientId) {
  const result = await pool.query(
    `UPDATE clients SET face_search_consent_at = COALESCE(face_search_consent_at, now())
     WHERE id = $1
     RETURNING id, album_id, client_account_id, face_search_consent_at, is_minor_flagged`,
    [clientId]
  );
  return result.rows[0];
}

// Bước — khách tự khai độ tuổi ngay trong màn hình xin phép (Trên 18 / Dưới 18 tuổi). Ghi
// đè is_minor_flagged của CHÍNH client này (không đụng albums.is_minor_album, vốn là mặc
// định PTG đặt cho cả album). Từ L9, effectiveIsMinor() ở clientController.js coi cờ album là
// tuyệt đối: giá trị này chỉ siết thêm (true chặn khách), không mở lại album đã đánh dấu <18.
async function setMinorFlagged(clientId, isMinor) {
  const result = await pool.query(
    `UPDATE clients SET is_minor_flagged = $2 WHERE id = $1
     RETURNING id, album_id, client_account_id, face_search_consent_at, is_minor_flagged`,
    [clientId, isMinor]
  );
  return result.rows[0];
}

// "Rút lại đồng ý và xóa dữ liệu khuôn mặt của tôi" — chỉ xóa MỐC đồng ý (không có embedding/
// ảnh selfie nào được lưu trữ để xóa thêm, xem searchByFace ở clientController.js), khách
// phải đồng ý lại từ đầu nếu muốn dùng lại tính năng.
async function revokeFaceSearchConsent(clientId) {
  const result = await pool.query(
    `UPDATE clients SET face_search_consent_at = NULL WHERE id = $1
     RETURNING id, album_id, client_account_id, face_search_consent_at, is_minor_flagged`,
    [clientId]
  );
  return result.rows[0] || null;
}

async function recordFaceSearchConsentLog({ clientId, ipAddress, userAgent }) {
  await pool.query(
    `INSERT INTO face_search_consent_logs (client_id, ip_address, user_agent) VALUES ($1, $2, $3)`,
    [clientId, ipAddress || null, userAgent || null]
  );
}

async function findClientById(clientId) {
  const result = await pool.query(
    "SELECT id, album_id, client_account_id, face_search_consent_at, is_minor_flagged FROM clients WHERE id = $1",
    [clientId]
  );
  return result.rows[0] || null;
}

async function recordSelfieSearch({ clientId, matchedPhotoCount }) {
  await pool.query(
    "INSERT INTO client_selfie_searches (client_id, matched_photo_count) VALUES ($1, $2)",
    [clientId, matchedPhotoCount]
  );
}

async function listSelectionsForAlbum(albumId) {
  const result = await pool.query(
    `SELECT
       s.id, s.photo_id, s.selected_at,
       ca.full_name AS client_name, ca.phone_number AS client_phone
     FROM selections s
     JOIN clients c ON c.id = s.client_id
     JOIN client_accounts ca ON ca.id = c.client_account_id
     WHERE c.album_id = $1
     ORDER BY s.selected_at DESC`,
    [albumId]
  );
  return result.rows;
}

module.exports = {
  findOrCreateClientAccount,
  findOrCreateClient,
  findClientAccountByPhone,
  findClient,
  findClientById,
  toggleSelection,
  listSelectedPhotoIds,
  findCompletion,
  markCompleted,
  reopenCompletion,
  SelectionLimitError,
  listSelectionsForAlbum,
  setFaceSearchConsent,
  setMinorFlagged,
  revokeFaceSearchConsent,
  recordFaceSearchConsentLog,
  recordSelfieSearch,
};
