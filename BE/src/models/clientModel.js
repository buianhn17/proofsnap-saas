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

async function findOrCreateClient({ albumId, clientAccountId }) {
  const result = await pool.query(
    `INSERT INTO clients (album_id, client_account_id)
     VALUES ($1, $2)
     ON CONFLICT (album_id, client_account_id) DO UPDATE SET album_id = EXCLUDED.album_id
     RETURNING id, album_id, client_account_id`,
    [albumId, clientAccountId]
  );
  return result.rows[0];
}

async function toggleSelection({ clientId, photoId }) {
  const deleted = await pool.query(
    "DELETE FROM selections WHERE client_id = $1 AND photo_id = $2 RETURNING id",
    [clientId, photoId]
  );
  if (deleted.rows.length > 0) {
    return { selected: false };
  }

  await pool.query(
    "INSERT INTO selections (client_id, photo_id) VALUES ($1, $2)",
    [clientId, photoId]
  );
  return { selected: true };
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
  toggleSelection,
  listSelectionsForAlbum,
};
