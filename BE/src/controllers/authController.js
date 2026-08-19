const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const {
  oauth2Client,
  GOOGLE_OAUTH_SCOPES,
  isGoogleOAuthConfigured,
} = require("../config/googleOAuth");
const { encrypt } = require("../utils/crypto");
const photographerModel = require("../models/photographerModel");

function redirectToLoginWithError(res, code) {
  const url = new URL("/admin/login", process.env.CLIENT_URL);
  url.searchParams.set("error", code);
  res.redirect(url.toString());
}

// Bước 1: PTG bấm "Đăng nhập bằng Google" -> redirect sang màn hình đồng ý của Google
function googleLogin(req, res) {
  if (!isGoogleOAuthConfigured) {
    return res.status(500).json({
      error: "Google OAuth chưa được cấu hình",
      detail: "Hãy điền GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET trong file .env",
    });
  }

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
    return redirectToLoginWithError(res, "missing_code");
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
      return redirectToLoginWithError(res, "missing_refresh_token");
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

    res.redirect(new URL("/admin/albums", process.env.CLIENT_URL).toString());
  } catch (err) {
    console.error("Lỗi Google OAuth callback:", err.message);
    redirectToLoginWithError(res, "oauth_failed");
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
