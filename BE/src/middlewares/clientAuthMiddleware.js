const jwt = require("jsonwebtoken");

function requireClientAuth(req, res, next) {
  const token = req.cookies?.client_session_token;
  if (!token) {
    return res.status(401).json({ error: "CLIENT_NOT_AUTHENTICATED", message: "Khách hàng chưa nhập PIN" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "client" || payload.albumId !== req.params.albumId) {
      return res.status(403).json({ error: "CLIENT_ALBUM_MISMATCH", message: "Phiên không thuộc album này" });
    }
    req.client = payload;
    next();
  } catch {
    return res.status(401).json({ error: "CLIENT_SESSION_INVALID", message: "Phiên khách hàng không hợp lệ hoặc đã hết hạn" });
  }
}

module.exports = { requireClientAuth };
