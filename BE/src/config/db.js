const { Pool } = require("pg");

// Pool tái sử dụng kết nối, tránh mở/đóng connection liên tục cho mỗi request.
// Đọc DATABASE_URL từ .env — xem .env.example.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // Lỗi ở connection đang idle trong pool (không phải lỗi của 1 query cụ thể)
  console.error("Lỗi không mong muốn từ Postgres pool:", err);
});

module.exports = pool;
