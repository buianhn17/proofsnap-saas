const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const { oauth2Client, GOOGLE_OAUTH_SCOPES } = require("../config/googleOAuth");
const { encrypt } = require("../utils/crypto");
const photographerModel = require("../models/photographerModel");

// Bước 1: PTG bấm "Đăng nhập bằng Google" -> redirect sang màn hình đồng ý của Google
function googleLogin(req, res) {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline", // bắt buộc để nhận được refresh_token
    prompt: "consent", // bắt buộc để Google luôn trả refresh_token, kể cả các lần đăng nhập sau
    scope: GOOGLE_OAUTH_SCOPES,
  });
  res.redirect(url);
}

// Bước 2: Google gọi lại endpoint này kèm ?code=...
async function googleCallback(req, res) {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: "Thiếu authorization code từ Google" });
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    let photographer = await photographerModel.findByGoogleId(profile.id);

    if (!tokens.refresh_token && !photographer) {
      // Trường hợp hiếm: PTG đăng nhập lần đầu mà Google không trả refresh_token.
      // Thường do trình duyệt cache lại consent cũ - yêu cầu thử lại.
      return res.status(500).json({
        error:
          "Không nhận được refresh_token từ Google. Vào https://myaccount.google.com/permissions gỡ quyền truy cập của app rồi đăng nhập lại.",
      });
    }

    if (!photographer) {
      const encryptedRefreshToken = encrypt(tokens.refresh_token);
      photographer = await photographerModel.createPhotographer({
        googleId: profile.id,
        email: profile.email,
        displayName: profile.name,
        encryptedRefreshToken,
      });
    } else if (tokens.refresh_token) {
      // Có refresh_token mới -> cập nhật (VD: PTG từng thu hồi quyền rồi đăng nhập lại)
      const encryptedRefreshToken = encrypt(tokens.refresh_token);
      await photographerModel.updateRefreshToken(photographer.id, encryptedRefreshToken);
    }

    const sessionToken = jwt.sign(
      { photographerId: photographer.id, email: photographer.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("session_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Chưa có frontend nên tạm trả JSON để test qua Swagger/trình duyệt.
    // Khi có frontend, đổi dòng dưới thành: res.redirect(process.env.CLIENT_URL)
    res.json({
      message: "Đăng nhập Google thành công",
      photographer: {
        id: photographer.id,
        email: photographer.email,
        display_name: photographer.display_name,
      },
    });
  } catch (err) {
    console.error("Lỗi Google OAuth callback:", err.message);
    res.status(500).json({ error: "Xác thực Google thất bại", detail: err.message });
  }
}

// Trả thông tin PTG đang đăng nhập (yêu cầu qua middleware requireAuth trước)
async function me(req, res) {
  const photographer = await photographerModel.findById(req.photographer.photographerId);
  if (!photographer) {
    return res.status(404).json({ error: "Không tìm thấy nhiếp ảnh gia" });
  }
  res.json({
    photographer: {
      id: photographer.id,
      email: photographer.email,
      display_name: photographer.display_name,
    },
  });
}

function logout(req, res) {
  res.clearCookie("session_token");
  res.json({ message: "Đã đăng xuất" });
}

module.exports = { googleLogin, googleCallback, me, logout };
