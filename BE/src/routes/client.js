const express = require("express");
const clientController = require("../controllers/clientController");
const { requireClientAuth } = require("../middlewares/clientAuthMiddleware");

const router = express.Router();

/**
 * @swagger
 * /api/public/albums/{albumId}/verify-pin:
 *   post:
 *     summary: Xác thực PIN và tạo phiên khách hàng cho album
 *     tags: [Client Portal]
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ClientAccessRequest'
 *     responses:
 *       200:
 *         description: Truy cập album thành công và set client cookie
 *       401:
 *         description: PIN không đúng
 *       404:
 *         description: Không tìm thấy album
 *       423:
 *         description: Album đã bị khóa
 */
router.post("/:albumId/verify-pin", clientController.verifyPin);

/**
 * @swagger
 * /api/public/albums/{albumId}:
 *   get:
 *     summary: Lấy thông tin album sau khi client xác thực PIN
 *     tags: [Client Portal]
 *     security:
 *       - clientCookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: Thông tin album an toàn cho client
 *       401:
 *         description: Client chưa xác thực
 *       403:
 *         description: Phiên không thuộc album
 *       404:
 *         description: Không tìm thấy album
 */
router.get("/:albumId", requireClientAuth, clientController.getAlbum);

/**
 * @swagger
 * /api/public/albums/{albumId}/photos/{photoId}/view:
 *   get:
 *     summary: Xem 1 ảnh trong album qua proxy backend (chưa có watermark ở bước này)
 *     tags: [Client Portal]
 *     security:
 *       - clientCookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *       - in: path
 *         name: photoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dữ liệu ảnh JPEG
 *       403:
 *         description: Phiên không thuộc album
 *       404:
 *         description: Không tìm thấy ảnh hoặc album
 */
router.get("/:albumId/photos/:photoId/view", requireClientAuth, clientController.viewPhoto);

/**
 * @swagger
 * /api/public/client/logout:
 *   post:
 *     summary: Đăng xuất phiên Client Portal
 *     tags: [Client Portal]
 *     responses:
 *       200:
 *         description: Đã đăng xuất
 */
router.post("/client/logout", clientController.logout);

module.exports = router;