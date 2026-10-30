function notFoundHandler(req, res) {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `Route ${req.method} ${req.originalUrl} không tồn tại`,
  });
}

function errorHandler(err, req, res, next) {
  const isDriveScopeError = err.code === 403
    && String(err.message).toLowerCase().includes("insufficient authentication scopes");
  // Lỗi multer khác (sai loại file, quá số file...) là lỗi request, không phải lỗi máy chủ —
  // trả 400 để client không coi là lỗi tạm thời rồi tự thử lại.
  const isUploadRequestError = err.name === "MulterError" && err.code !== "LIMIT_FILE_SIZE";
  const statusCode = err.code === "LIMIT_FILE_SIZE"
    ? 413
    : isDriveScopeError
      ? 403
      : isUploadRequestError
        ? 400
        : Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const isProduction = process.env.NODE_ENV === "production";

  console.error(`${req.method} ${req.originalUrl}`, err);

  res.status(statusCode).json({
    error: err.code === "LIMIT_FILE_SIZE"
      ? "FILE_TOO_LARGE"
      : isDriveScopeError ? "DRIVE_SCOPE_REQUIRED" : (typeof err.code === "string" ? err.code : "INTERNAL_SERVER_ERROR"),
    message: isProduction && statusCode >= 500 ? "Đã xảy ra lỗi máy chủ" : (
      err.code === "LIMIT_FILE_SIZE"
        ? "File vượt quá giới hạn 25 MB"
        : isDriveScopeError
          ? "Google Drive chưa được cấp quyền đầy đủ. Hãy đăng nhập Google lại để cấp quyền Drive."
          : err.message
    ),
  });
}

module.exports = { notFoundHandler, errorHandler };
