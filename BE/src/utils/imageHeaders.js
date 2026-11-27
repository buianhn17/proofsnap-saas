// L3 — trang Cull của Admin Portal bật cross-origin isolation (COOP same-origin + COEP
// require-corp) cho WASM đa luồng. Sau khi điều hướng SPA từ trang đó sang trang khác, tài liệu
// vẫn mang COEP nên mọi ảnh <img> tải từ API (khác origin: :3000 so với :5173) bị chặn nếu
// response không có Cross-Origin-Resource-Policy. "same-site" cho phép FE và API cùng site
// (cùng scheme + tên miền đăng ký, khác cổng/subdomain) mà vẫn chặn site lạ nhúng ảnh.
//
// Triển khai FE và API trên 2 site khác nhau (VD *.vercel.app và *.onrender.com) thì phải đặt
// IMAGE_CORP_POLICY=cross-origin, nếu không ảnh sẽ bị chặn trên các trang có COEP.
const ALLOWED_POLICIES = new Set(["same-site", "same-origin", "cross-origin"]);

function imageResourcePolicy() {
  const configured = process.env.IMAGE_CORP_POLICY;
  return ALLOWED_POLICIES.has(configured) ? configured : "same-site";
}

/** Gọi ở đầu mọi handler trả ảnh (/view, /download) — áp dụng cả cho response lỗi JSON. */
function setImageResourcePolicy(res) {
  res.setHeader("Cross-Origin-Resource-Policy", imageResourcePolicy());
}

module.exports = { setImageResourcePolicy };
