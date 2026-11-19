const express = require("express");
const photoImportController = require("../controllers/photoImportController");
const { requireAuth } = require("../middlewares/authMiddleware");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

/**
 * @swagger
 * /api/albums/{albumId}/imports:
 *   get:
 *     summary: 5 lượt nhập ảnh từ Drive gần nhất của album (kèm tiến độ)
 *     tags: [Photo Imports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: "{ imports: PhotoImport[] }"
 *   post:
 *     summary: Nhập ảnh từ link thư mục (hoặc file) Google Drive công khai vào album
 *     description: |
 *       Link phải chia sẻ "Bất kỳ ai có đường liên kết". Server liệt kê ảnh JPG (cả thư mục con
 *       tới 3 cấp, tối đa 5.000 ảnh), rồi chạy nền: tải từng ảnh, nén theo mức nén của album (giữ
 *       EXIF), chép vào Drive của photographer như ảnh upload thường. Nhập lại cùng link chỉ thêm
 *       ảnh mới. Cần GOOGLE_API_KEY trên server. Theo dõi tiến độ bằng GET …/imports/{importId}.
 *     tags: [Photo Imports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url: { type: string, example: "https://drive.google.com/drive/folders/1AbCdEfGhIjK?usp=sharing" }
 *     responses:
 *       202:
 *         description: Đã bắt đầu nhập (chạy nền)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 import: { $ref: '#/components/schemas/PhotoImport' }
 *       400:
 *         description: "Link không phải Drive (DRIVE_LINK_INVALID), không có JPG (DRIVE_NO_IMAGES), quá 5.000 ảnh (DRIVE_IMPORT_TOO_LARGE), album khoá (ALBUM_NOT_ACTIVE)"
 *       404:
 *         description: Link riêng tư / không tồn tại (DRIVE_NOT_PUBLIC) hoặc không có album
 *       409:
 *         description: Album đang có lượt nhập chưa xong (IMPORT_ALREADY_RUNNING)
 *       429:
 *         description: Google Drive giới hạn lượt (DRIVE_QUOTA_EXCEEDED)
 *       503:
 *         description: Server chưa cấu hình GOOGLE_API_KEY (DRIVE_IMPORT_NOT_CONFIGURED) hoặc key sai (DRIVE_API_KEY_INVALID)
 */
router.route("/").get(photoImportController.list).post(photoImportController.create);

/**
 * @swagger
 * /api/albums/{albumId}/imports/{importId}:
 *   get:
 *     summary: Tiến độ 1 lượt nhập
 *     tags: [Photo Imports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *       - name: importId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "{ import: PhotoImport }"
 *       404:
 *         description: Không có lượt nhập (IMPORT_NOT_FOUND)
 * /api/albums/{albumId}/imports/{importId}/cancel:
 *   post:
 *     summary: Huỷ lượt nhập đang chạy (ảnh đã nhập vẫn giữ)
 *     tags: [Photo Imports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *       - name: importId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Đã huỷ
 *       409:
 *         description: Lượt nhập không còn chạy (IMPORT_NOT_RUNNING)
 */
router.get("/:importId", photoImportController.getOne);
router.post("/:importId/cancel", photoImportController.cancel);

module.exports = router;
