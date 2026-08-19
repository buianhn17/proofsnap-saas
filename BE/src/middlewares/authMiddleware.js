const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const token = req.cookies?.session_token;
  if (!token) {
    return res.status(401).json({ error: "Chưa đăng nhập" });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.photographer = payload; // { photographerId, email }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });
  }
}

module.exports = { requireAuth };
