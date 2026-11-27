// L4 — ID sai định dạng trên URL (VD /api/albums/abc) trước đây lọt xuống PostgreSQL và nổ
// lỗi 22P02 "invalid input syntax for type uuid" → 500. Kiểm tra sớm, trả 404 JSON gọn: với
// người gọi, "id không đúng định dạng" và "không có bản ghi" là cùng 1 nghĩa.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tên tham số route → mã lỗi + thông báo (khớp mã lỗi các controller đang trả khi không thấy bản ghi).
const UUID_PARAMS = {
  albumId: { error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" },
  photoId: { error: "PHOTO_NOT_FOUND", message: "Không tìm thấy ảnh" },
  annotationId: { error: "ANNOTATION_NOT_FOUND", message: "Không tìm thấy ghi chú" },
  showId: { error: "SHOW_NOT_FOUND", message: "Không tìm thấy show" },
  submissionId: { error: "SUBMISSION_NOT_FOUND", message: "Không tìm thấy lượt bàn giao" },
  clientId: { error: "CLIENT_NOT_FOUND", message: "Không tìm thấy khách hàng" },
};

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function sendNotFound(res, name) {
  const { error, message } = UUID_PARAMS[name];
  return res.status(404).json({ error, message });
}

/** Middleware: kiểm tra mọi tham số UUID đã biết có trong req.params. */
function validateUuidParams(req, res, next) {
  for (const name of Object.keys(UUID_PARAMS)) {
    const value = req.params?.[name];
    if (value !== undefined && !isUuid(value)) return sendNotFound(res, name);
  }
  next();
}

/**
 * Gắn kiểm tra vào router bằng router.param — chạy trước mọi handler (kể cả requireAuth) của
 * route có tham số tương ứng. Tham số đến từ đường dẫn mount (mergeParams) không kích hoạt
 * router.param: dùng validateUuidParams ở app.use() cho trường hợp đó.
 */
function registerUuidParams(router, names = Object.keys(UUID_PARAMS)) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => (isUuid(value) ? next() : sendNotFound(res, name)));
  }
  return router;
}

module.exports = { validateUuidParams, registerUuidParams, isUuid, UUID_PATTERN };
