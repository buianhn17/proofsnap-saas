const express = require("express");
const { registerUuidParams } = require("../middlewares/validateUuidParams");
const overviewController = require("../controllers/overviewController");
const { requireAuth } = require("../middlewares/authMiddleware");

// Admin Portal: Bảng điều khiển, Khách hàng, Cài đặt — mount tại /api.
const router = express.Router();
registerUuidParams(router, ["clientId"]);

/**
 * @swagger
 * /api/dashboard:
 *   get:
 *     summary: Số liệu tổng quan của PTG (album, khách, ảnh đã chọn, ghi chú chờ xử lý, hạn sắp tới, hoạt động gần đây)
 *     tags: [Admin Overview]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Số liệu tổng quan
 */
router.get("/dashboard", requireAuth, overviewController.dashboard);

/**
 * @swagger
 * /api/clients:
 *   get:
 *     summary: Khách hàng trong các album của PTG, kèm tiến độ chọn ảnh và trạng thái thanh toán
 *     tags: [Admin Overview]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: filter, schema: { type: string, enum: [all, completed, in_progress, unpaid] } }
 *       - { in: query, name: album_id, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Danh sách khách
 */
router.get("/clients", requireAuth, overviewController.listClients);

/**
 * @swagger
 * /api/clients/unseen-count:
 *   get:
 *     summary: Số khách đã gửi lựa chọn (hoặc tự chốt khi hết hạn) mà PTG chưa xem — huy hiệu tab Khách hàng
 *     tags: [Admin Overview]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200: { description: "{ count }" }
 * /api/clients/seen:
 *   post:
 *     summary: Đánh dấu PTG đã xem danh sách khách (xoá huy hiệu)
 *     tags: [Admin Overview]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       204: { description: Đã ghi nhận }
 */
router.get("/clients/unseen-count", requireAuth, overviewController.unseenCount);
router.post("/clients/seen", requireAuth, overviewController.markSeen);

/**
 * @swagger
 * /api/clients/{clientId}:
 *   get:
 *     summary: Chi tiết 1 khách + danh sách tên file đã chọn
 *     tags: [Admin Overview]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - { in: path, name: clientId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Chi tiết khách }
 *       404: { description: Không tìm thấy }
 *   patch:
 *     summary: PTG tự đánh dấu trạng thái thanh toán (unpaid/deposit/paid) — không tích hợp cổng thanh toán
 *     tags: [Admin Overview]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - { in: path, name: clientId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               payment_status: { type: string, enum: [unpaid, deposit, paid] }
 *               payment_note: { type: string, maxLength: 500, nullable: true }
 *     responses:
 *       200: { description: Đã cập nhật }
 */
router.route("/clients/:clientId")
  .get(requireAuth, overviewController.getClient)
  .patch(requireAuth, overviewController.updateClientPayment);

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Hồ sơ + cài đặt mặc định khi tạo album
 *     tags: [Admin Overview]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200: { description: Cài đặt }
 *   patch:
 *     summary: Cập nhật tên hiển thị và cài đặt mặc định (preset nén, watermark, số ảnh tối đa, số ngày hạn chọn)
 *     tags: [Admin Overview]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200: { description: Đã cập nhật }
 */
router.route("/settings")
  .get(requireAuth, overviewController.getSettings)
  .patch(requireAuth, overviewController.updateSettings);

module.exports = router;
