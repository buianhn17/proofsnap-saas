const express = require("express");
const albumController = require("../controllers/albumController");
const selectionController = require("../controllers/selectionController");
const annotationController = require("../controllers/annotationController");
const sceneController = require("../controllers/sceneController");
const burstClusterController = require("../controllers/burstClusterController");
const { requireAuth } = require("../middlewares/authMiddleware");

const router = express.Router();

/**
 * @swagger
 * /api/albums:
 *   get:
 *     summary: Liệt kê album của photographer hiện tại
 *     tags: [Albums]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Danh sách album
 *       401:
 *         description: Chưa đăng nhập
 *   post:
 *     summary: Tạo album và folder tương ứng trên Google Drive
 *     tags: [Albums]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAlbumRequest'
 *     responses:
 *       201:
 *         description: Album đã được tạo
 *       400:
 *         description: Dữ liệu album không hợp lệ
 *       401:
 *         description: Chưa đăng nhập
 *       500:
 *         description: Không thể tạo album hoặc folder Drive
 */
router.route("/").get(requireAuth, albumController.list).post(requireAuth, albumController.create);

/**
 * @swagger
 * /api/albums/{albumId}:
 *   get:
 *     summary: Lấy chi tiết một album của photographer hiện tại
 *     tags: [Albums]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: Chi tiết album
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy album
 *   patch:
 *     summary: Cập nhật cấu hình album
 *     tags: [Albums]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAlbumRequest'
 *     responses:
 *       200:
 *         description: Album đã được cập nhật
 *       400:
 *         description: Dữ liệu album không hợp lệ
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy album
 *   delete:
 *     summary: Lưu trữ album (không xóa dữ liệu Drive)
 *     tags: [Albums]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: Album đã được lưu trữ
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy album
 */
router
  .route("/:albumId")
  .get(requireAuth, albumController.getOne)
  .patch(requireAuth, albumController.update)
  .delete(requireAuth, albumController.archive);

/**
 * @swagger
 * /api/albums/{albumId}/selections:
 *   get:
 *     summary: Xem danh sách khách đã thả tim ảnh nào trong album
 *     tags: [Albums]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: Danh sách lượt thả tim (kèm tên/SĐT khách)
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy album
 */
router.get("/:albumId/selections", requireAuth, selectionController.listForAlbum);

/**
 * @swagger
 * /api/albums/{albumId}/annotations:
 *   get:
 *     summary: Xem toàn bộ ghi chú khoanh vùng của khách trong album (Bước 2.2)
 *     tags: [Albums]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: Danh sách ghi chú (kèm tên/SĐT khách, vị trí, nét vẽ)
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy album
 */
router.get("/:albumId/annotations", requireAuth, annotationController.listForAlbum);

/**
 * @swagger
 * /api/albums/{albumId}/scenes:
 *   post:
 *     summary: Tạo hàng loạt scene (buổi chụp) cho album — dùng bởi luồng upload sau AI Culling
 *     tags: [Albums]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       201:
 *         description: Danh sách scene đã tạo (đúng thứ tự gửi lên)
 *       400:
 *         description: Dữ liệu scene không hợp lệ
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy album
 */
router.post("/:albumId/scenes", requireAuth, sceneController.create);

/**
 * @swagger
 * /api/albums/{albumId}/burst-clusters:
 *   post:
 *     summary: Tạo hàng loạt burst cluster cho album — dùng bởi luồng upload sau AI Culling
 *     tags: [Albums]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       201:
 *         description: Danh sách burst cluster đã tạo (đúng thứ tự gửi lên)
 *       400:
 *         description: Dữ liệu burst cluster không hợp lệ
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy album
 */
router.post("/:albumId/burst-clusters", requireAuth, burstClusterController.create);

module.exports = router;
