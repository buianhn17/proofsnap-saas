const express = require("express");
const multer = require("multer");
const photoController = require("../controllers/photoController");
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

module.exports = router;
