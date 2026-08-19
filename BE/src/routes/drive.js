const express = require("express");
const driveController = require("../controllers/driveController");
const { requireAuth } = require("../middlewares/authMiddleware");

const router = express.Router();

/**
 * @swagger
 * /api/drive/status:
 *   get:
 *     summary: Kiểm tra kết nối Google Drive của photographer
 *     tags: [Google Drive]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Kết nối Drive hợp lệ
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy photographer
 *       500:
 *         description: Không thể kết nối Google Drive
 */
router.get("/status", requireAuth, driveController.status);

/**
 * @swagger
 * /api/drive/setup:
 *   post:
 *     summary: Tạo hoặc tìm thư mục LensProof và Albums trên Google Drive
 *     tags: [Google Drive]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       201:
 *         description: Đã khởi tạo thư mục Drive
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy photographer
 *       500:
 *         description: Không thể khởi tạo thư mục Drive
 */
router.post("/setup", requireAuth, driveController.setup);

module.exports = router;
