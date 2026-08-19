const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";

// ENCRYPTION_KEY trong .env phải là chuỗi hex 64 ký tự (32 byte).
// Tạo bằng lệnh: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY thiếu hoặc sai độ dài — phải là chuỗi hex 64 ký tự (32 byte). Xem README."
    );
  }
  return Buffer.from(key, "hex");
}

// Mã hóa 1 chuỗi plaintext (VD: refresh_token) thành 1 chuỗi hex để lưu vào cột TEXT.
// Gộp iv + authTag + ciphertext vào cùng 1 chuỗi để không cần thêm cột phụ trong DB.
function encrypt(plainText) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("hex");
}

// Giải mã ngược lại chuỗi hex đã lưu trong DB về plaintext gốc.
function decrypt(encryptedHex) {
  const key = getKey();
  const data = Buffer.from(encryptedHex, "hex");
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };
