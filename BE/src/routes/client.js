const express = require("express");
const clientController = require("../controllers/clientController");
const { requireClientAuth } = require("../middlewares/clientAuthMiddleware");
const { enforceAlbumNotExpired } = require("../middlewares/albumDeadlineMiddleware");

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
 * /api/public/albums/{albumId}/photos:
 *   get:
 *     summary: Liệt kê ảnh trong album cho client (không kèm trường nội bộ của PTG)
 *     tags: [Client Portal]
 *     security:
 *       - clientCookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: Danh sách ảnh an toàn cho client
 *       401:
 *         description: Client chưa xác thực
 *       403:
 *         description: Phiên không thuộc album
 *       404:
 *         description: Không tìm thấy album
 */
router.get("/:albumId/photos", requireClientAuth, clientController.listPhotos);

/**
 * @swagger
 * /api/public/albums/{albumId}/photos/{photoId}/view:
 *   get:
 *     summary: Xem 1 ảnh trong album qua proxy backend (có watermark động nếu album bật watermark)
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
 * /api/public/albums/{albumId}/photos/{photoId}/select:
 *   post:
 *     summary: Toggle thả tim/bỏ thả tim 1 ảnh trong album
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
 *         description: Trạng thái thả tim sau khi toggle
 *       401:
 *         description: Client chưa xác thực
 *       403:
 *         description: Phiên không thuộc album, hoặc đã hết hạn/bị khóa (Bước 2.1)
 *       404:
 *         description: Không tìm thấy ảnh hoặc album
 */
router.post(
  "/:albumId/photos/:photoId/select",
  requireClientAuth,
  enforceAlbumNotExpired,
  clientController.toggleSelection
);

/**
 * @swagger
 * /api/public/albums/{albumId}/photos/{photoId}/annotations:
 *   post:
 *     summary: Khách vẽ ghi chú khoanh vùng lên 1 ảnh (Bước 2.2)
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
 *       201:
 *         description: Ghi chú đã tạo
 *       400:
 *         description: Dữ liệu ghi chú không hợp lệ
 *       401:
 *         description: Client chưa xác thực
 *       403:
 *         description: Phiên không thuộc album, hoặc đã hết hạn/bị khóa
 *       404:
 *         description: Không tìm thấy ảnh hoặc album
 *   get:
 *     summary: Liệt kê ghi chú của chính khách đang đăng nhập trên 1 ảnh
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
 *         description: Danh sách ghi chú của khách trên ảnh này
 *       401:
 *         description: Client chưa xác thực
 *       403:
 *         description: Phiên không thuộc album
 *       404:
 *         description: Không tìm thấy ảnh hoặc album
 */
router.post(
  "/:albumId/photos/:photoId/annotations",
  requireClientAuth,
  enforceAlbumNotExpired,
  clientController.createAnnotation
);
router.get(
  "/:albumId/photos/:photoId/annotations",
  requireClientAuth,
  clientController.listAnnotationsForPhoto
);

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