const express = require("express");
const pool = require("../config/db");
const { getSchemaStatus } = require("../config/migrations");

const router = express.Router();

// GET /api/health
// Dùng để test nhanh: server có chạy không, DB có kết nối được không.
/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Kiểm tra tình trạng server và kết nối database
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: >
 *           Server và database đều hoạt động bình thường. Trường `schema` cho biết số
 *           migration đã áp dụng (bảng schema_migrations) và các file còn chờ.
 *       500:
 *         description: Server chạy nhưng không kết nối được database
 */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");
    const schema = await getSchemaStatus().catch((err) => ({ error: err.message }));
    res.json({
      status: "ok",
      server: "running",
      database: "connected",
      db_time: result.rows[0].current_time,
      schema,
    });
  } catch (err) {
    console.error("Health check thất bại - lỗi kết nối DB:", err.message);
    res.status(500).json({
      status: "error",
      server: "running",
      database: "disconnected",
      error: err.message,
    });
  }
});

module.exports = router;
