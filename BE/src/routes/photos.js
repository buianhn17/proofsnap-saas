const express = require("express");
const multer = require("multer");
const photoController = require("../controllers/photoController");
const photoNotesController = require("../controllers/photoNotesController");
const { requireAuth } = require("../middlewares/authMiddleware");

const router = express.Router({ mergeParams: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const extension = file.originalname.toLowerCase();
    if (file.mimetype !== "image/jpeg" || !(extension.endsWith(".jpg") || extension.endsWith(".jpeg"))) {
      return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "file"));
    }
    callback(null, true);
  },
});

/**
 * @swagger
 * /api/albums/{albumId}/photos:
 *   get:
 *     summary: Liệt kê ảnh đã upload trong album
 *     tags: [Photos]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: Danh sách ảnh
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy album
 *   post:
 *     summary: Upload một ảnh JPG đã được xử lý lên Google Drive
 *     tags: [Photos]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/UploadPhotoRequest'
 *     responses:
 *       201:
 *         description: Ảnh đã upload và lưu metadata
 *       400:
 *         description: File hoặc metadata không hợp lệ
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy album
 *       413:
 *         description: File vượt quá 25 MB
 */
router
  .route("/")
  .get(requireAuth, photoController.list)
  .post(requireAuth, upload.single("file"), photoController.upload);

/**
 * @swagger
 * /api/albums/{albumId}/photos/{photoId}/view:
 *   get:
 *     summary: Xem ảnh gốc (không watermark) đã upload — dùng bởi Admin Portal
 *     tags: [Photos]
 *     security:
 *       - cookieAuth: []
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
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy ảnh hoặc album
 */
router.get("/:photoId/view", requireAuth, photoController.view);

/**
 * @swagger
 * /api/albums/{albumId}/photos/{photoId}/notes:
 *   post:
 *     summary: Thêm ghi chú nội bộ hoặc phản hồi gửi khách cho 1 ảnh (trang Yêu cầu chỉnh sửa)
 *     tags: [Photos]
 *     security:
 *       - cookieAuth: []
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
 *         description: note_text không hợp lệ
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy ảnh hoặc album
 */
router.post("/:photoId/notes", requireAuth, photoNotesController.addNote);

/**
 * @swagger
 * /api/albums/{albumId}/photos/{photoId}/complete-edits:
 *   post:
 *     summary: Đánh dấu toàn bộ yêu cầu chỉnh sửa của 1 ảnh là đã xử lý ("Hoàn tất chỉnh sửa")
 *     tags: [Photos]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *       - in: path
 *         name: photoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Số lượng annotation vừa được đánh dấu hoàn tất
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không tìm thấy ảnh hoặc album
 */
router.post("/:photoId/complete-edits", requireAuth, photoNotesController.completeEdits);

module.exports = router;
