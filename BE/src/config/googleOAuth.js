const { google } = require("googleapis");

const requiredOAuthConfig = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
];
const missingOAuthConfig = requiredOAuthConfig.filter((key) => !process.env[key]);
const isGoogleOAuthConfigured = missingOAuthConfig.length === 0;

if (missingOAuthConfig.length > 0) {
  console.warn(
    `Google OAuth chưa được cấu hình đầy đủ: thiếu ${missingOAuthConfig.join(", ")}`
  );
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Dùng drive.file thay vì drive đầy đủ: chỉ truy cập file/folder do chính app
// tạo ra trên Drive của PTG, không đụng tới các file khác đã có sẵn — an toàn
// hơn cho dữ liệu cá nhân của PTG mà vẫn đủ quyền cho tính năng tạo album/upload.
const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
];

module.exports = { oauth2Client, GOOGLE_OAUTH_SCOPES, isGoogleOAuthConfigured };
