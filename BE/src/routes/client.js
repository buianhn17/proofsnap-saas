const express = require("express");
const multer = require("multer");
const clientController = require("../controllers/clientController");
const { requireClientAuth } = require("../middlewares/clientAuthMiddleware");
const { enforceAlbumNotExpired } = require("../middlewares/albumDeadlineMiddleware");

const router = express.Router();

// Bước 3.3 — upload ảnh selfie khách để tìm ảnh. Giới hạn nhỏ hơn ảnh gốc PTG upload (đủ
// cho 1 khuôn mặt rõ nét, không cần ảnh chụp studio full-res).
const uploadSelfie = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const extension = file.originalname.toLowerCase();
    if (
      file.mimetype !== "image/jpeg" ||
      !(extension.endsWith(".jpg") || extension.endsWith(".jpeg"))
    ) {
      return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "file"));
    }
    callback(null, true);
  },
});

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
 * /api/public/albums/{albumId}/face-search/consent:
 *   get:
 *     summary: Trạng thái đồng ý AI Face Search của khách đang đăng nhập (Bước 3.1)
 *     tags: [Client Portal - Face Search]
 *     security:
 *       - clientCookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: feature_available=false nếu album/khách bị đánh dấu vị thành niên
 *       401:
 *         description: Client chưa xác thực
 *       403:
 *         description: Phiên không thuộc album này
 *       404:
 *         description: Không tìm thấy album
 *   post:
 *     summary: Ghi nhận đồng ý xử lý dữ liệu khuôn mặt (Bước 3.1) — bắt buộc trước khi upload selfie
 *     tags: [Client Portal - Face Search]
 *     security:
 *       - clientCookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [agree]
 *             properties:
 *               agree: { type: boolean, description: "Bắt buộc = true, không được tick sẵn phía FE" }
 *     responses:
 *       200:
 *         description: Đã ghi nhận đồng ý
 *       400:
 *         description: agree không phải true
 *       403:
 *         description: Vị thành niên (tính năng bị khóa) hoặc phiên không thuộc album này
 *       404:
 *         description: Không tìm thấy album
 */
router.get(
  "/:albumId/face-search/consent",
  requireClientAuth,
  clientController.getFaceSearchConsentStatus
);
router.post(
  "/:albumId/face-search/consent",
  requireClientAuth,
  clientController.giveFaceSearchConsent
);

/**
 * @swagger
 * /api/public/albums/{albumId}/face-search/consent/revoke:
 *   post:
 *     summary: Rút lại đồng ý xử lý dữ liệu khuôn mặt của khách (xóa mốc đồng ý)
 *     tags: [Client Portal - Face Search]
 *     security:
 *       - clientCookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: Đã rút lại đồng ý (idempotent — không lỗi nếu chưa từng đồng ý)
 *       401:
 *         description: Client chưa xác thực
 *       403:
 *         description: Phiên không thuộc album này
 *       404:
 *         description: Không tìm thấy album
 */
router.post(
  "/:albumId/face-search/consent/revoke",
  requireClientAuth,
  clientController.revokeFaceSearchConsent
);

/**
 * @swagger
 * /api/public/albums/{albumId}/face-search:
 *   post:
 *     summary: Upload ảnh selfie, tìm ảnh trong album có khuôn mặt khớp (Bước 3.3)
 *     tags: [Client Portal - Face Search]
 *     security:
 *       - clientCookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary, description: "Ảnh selfie JPG/JPEG tối đa 8 MB" }
 *     responses:
 *       200:
 *         description: Danh sách ảnh khớp (kèm similarity), có thể rỗng
 *       400:
 *         description: Thiếu file, sai định dạng, hoặc không phát hiện được khuôn mặt
 *       403:
 *         description: Chưa đồng ý (CONSENT_REQUIRED), vị thành niên, hoặc phiên không thuộc album này
 *       404:
 *         description: Không tìm thấy album
 */
router.post(
  "/:albumId/face-search",
  requireClientAuth,
  uploadSelfie.single("file"),
  clientController.searchByFace
);

/**
 * @swagger
 * /api/public/albums/{albumId}/download-zip:
 *   get:
 *     summary: Tải ZIP ảnh hoàn thiện (Bước 4.2) — cần album đã "mở khóa tải"
 *     tags: [Client Portal]
 *     security:
 *       - clientCookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/AlbumId'
 *     responses:
 *       200:
 *         description: File .zip (application/zip)
 *       401:
 *         description: Client chưa xác thực
 *       403:
 *         description: Phiên không thuộc album này, hoặc chưa mở khóa tải (ZIP_NOT_UNLOCKED)
 *       404:
 *         description: Không tìm thấy album, hoặc chưa có ảnh nào được chọn (NO_SELECTED_PHOTOS)
 */
router.get("/:albumId/download-zip", requireClientAuth, clientController.downloadZip);

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