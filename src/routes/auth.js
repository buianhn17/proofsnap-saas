const express = require("express");
const authController = require("../controllers/authController");
const { requireAuth } = require("../middlewares/authMiddleware");

const router = express.Router();

/**
 * @swagger
 * /api/auth/google:
 *   get:
 *     summary: Bắt đầu luồng đăng nhập Google OAuth cho nhiếp ảnh gia
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: Redirect sang màn hình đồng ý của Google
 */
router.get("/google", authController.googleLogin);

/**
 * @swagger
 * /api/auth/google/callback:
 *   get:
 *     summary: Google gọi lại endpoint này sau khi PTG đồng ý cấp quyền
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Đăng nhập thành công, trả về thông tin PTG và set cookie session
 *       400:
 *         description: Thiếu authorization code
 *       500:
 *         description: Xác thực thất bại
 */
router.get("/google/callback", authController.googleCallback);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Lấy thông tin nhiếp ảnh gia đang đăng nhập
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Thông tin PTG
 *       401:
 *         description: Chưa đăng nhập
 */
router.get("/me", requireAuth, authController.me);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Đăng xuất, xóa cookie session
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Đã đăng xuất
 */
router.post("/logout", authController.logout);

module.exports = router;
