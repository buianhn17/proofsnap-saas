const express = require("express");
const studioShowController = require("../controllers/studioShowController");
const { requireAuth } = require("../middlewares/authMiddleware");

const router = express.Router();

// Chủ Studio và thợ ảnh/thợ quay đều dùng tài khoản photographer hiện có (cookie session_token).
router.use(requireAuth);

/**
 * @swagger
 * tags:
 *   - name: Studio Shows
 *     description: |
 *       Show kỷ yếu nhiều thợ — chủ Studio tạo show, ekip vào bằng mã mời và nộp link Drive bàn giao.
 *       Vai trò: studio (chủ show, duyệt bài, xoá show) · crew (thợ chụp/quay, nộp photo/video) ·
 *       editor (hậu kỳ, xem link Drive của mọi thợ, nộp retouch).
 *
 * /api/studio/shows:
 *   get:
 *     summary: Danh sách show — tách show tôi làm chủ Studio / tham gia làm thợ / tham gia làm editor
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Ba danh sách owned / joined (thợ) / editing (editor), mỗi show kèm thống kê cả lớp
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 owned:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/StudioShow' }
 *                 joined:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/JoinedShow' }
 *                 editing:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/JoinedShow' }
 *       401:
 *         description: Chưa đăng nhập
 *   post:
 *     summary: Chủ Studio tạo show cho 1 lớp — hệ thống sinh mã mời (VD KL12A5-89) để gửi vào nhóm ekip
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateShowRequest'
 *     responses:
 *       201:
 *         description: Show đã tạo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 show: { $ref: '#/components/schemas/StudioShow' }
 *       400:
 *         description: "Dữ liệu không hợp lệ (INVALID_SHOOT_DATE, INVALID_SHOOT_END_TIME, INVALID_CLASS_NAME, INVALID_SCHOOL_NAME)"
 *       401:
 *         description: Chưa đăng nhập
 */
router.route("/shows").get(studioShowController.list).post(studioShowController.create);

/**
 * @swagger
 * /api/studio/shows/join:
 *   post:
 *     summary: Nhập mã mời để tham gia show — làm Thợ (crew, nộp file gốc) hoặc Editor (nhận file gốc, trả ảnh chỉnh)
 *     description: |
 *       Gọi lại với mã đã tham gia vẫn trả 200 (already_joined = true).
 *       Đổi vai trò được nếu chưa nộp bài nào (role_changed = true); đã nộp thì 409 MEMBER_ROLE_LOCKED.
 *       Show 'completed' vẫn nhận Editor mới (hậu kỳ làm sau khi chốt file gốc), không nhận thợ mới.
 *       Nhập SAI mã quá 10 lần trong 15 phút sẽ bị chặn tạm thời (429).
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/JoinShowRequest'
 *     responses:
 *       200:
 *         description: Đã tham gia show
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 show: { $ref: '#/components/schemas/StudioShow' }
 *                 viewer_role: { type: string, enum: [studio, crew, editor] }
 *                 member_role: { type: string, enum: [crew, editor] }
 *                 already_joined: { type: boolean }
 *                 role_changed: { type: boolean }
 *                 my_submissions:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ShowSubmission' }
 *       400:
 *         description: Mã mời sai định dạng (INVALID_INVITE_CODE)
 *       404:
 *         description: Mã mời không tồn tại (INVITE_CODE_NOT_FOUND)
 *       409:
 *         description: Show đã đóng (SHOW_NOT_OPEN) hoặc đã nộp bài nên không đổi vai trò được (MEMBER_ROLE_LOCKED)
 *       429:
 *         description: Nhập sai mã quá nhiều lần (TOO_MANY_JOIN_ATTEMPTS)
 */
router.post("/shows/join", studioShowController.join);

/**
 * @swagger
 * /api/studio/shows/{showId}:
 *   get:
 *     summary: Chi tiết show — danh sách bàn giao tách theo từng thợ, link Drive, trạng thái đúng hạn 24h
 *     description: |
 *       - Chủ Studio: thấy toàn bộ bài nộp, members kèm email.
 *       - Editor: thấy drive_url + formatted_folder_name của MỌI thợ để tải file gốc; không thấy studio_note của người khác.
 *       - Thợ: thấy bài nộp của cả ekip, nhưng drive_url và studio_note chỉ thấy của chính mình.
 *       members (mọi vai trò) để hiện badge Thợ ảnh / Thợ quay / Editor — email chỉ trả cho chủ Studio.
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/ShowId'
 *     responses:
 *       200:
 *         description: Chi tiết show
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 show: { $ref: '#/components/schemas/StudioShow' }
 *                 viewer_role: { type: string, enum: [studio, crew, editor] }
 *                 my_member_role: { type: string, enum: [crew, editor], nullable: true }
 *                 submissions:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ShowSubmission' }
 *                 members:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ShowMember' }
 *       401:
 *         description: Chưa đăng nhập
 *       404:
 *         description: Không có show hoặc chưa tham gia (SHOW_NOT_FOUND)
 *   patch:
 *     summary: Đổi trạng thái show — chỉ chủ Studio
 *     description: |
 *       open: đang nhận bàn giao · completed: đã chốt file gốc (không nhận thợ mới, vẫn nhận Editor + ảnh hậu kỳ)
 *       · archived: lưu trữ, không nhận gì thêm.
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/ShowId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [open, completed, archived] }
 *     responses:
 *       200:
 *         description: Show sau khi đổi
 *       400:
 *         description: Trạng thái không hợp lệ (INVALID_SHOW_STATUS)
 *       403:
 *         description: Không phải chủ Studio (STUDIO_OWNER_ONLY)
 *       404:
 *         description: Không có show hoặc chưa tham gia (SHOW_NOT_FOUND)
 *   delete:
 *     summary: Xoá show (kèm toàn bộ thành viên và bài nộp) — chỉ chủ Studio
 *     description: Không đụng tới file trên Google Drive của thợ/editor.
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/ShowId'
 *     responses:
 *       204:
 *         description: Đã xoá
 *       403:
 *         description: Là thành viên nhưng không phải chủ Studio (STUDIO_OWNER_ONLY)
 *       404:
 *         description: Không có show hoặc chưa tham gia (SHOW_NOT_FOUND)
 */
router
  .route("/shows/:showId")
  .get(studioShowController.getOne)
  .patch(studioShowController.updateStatus)
  .delete(studioShowController.remove);

/**
 * @swagger
 * /api/studio/shows/{showId}/rotate-invite:
 *   post:
 *     summary: Đổi mã mời mới (mã cũ hết hiệu lực) — chỉ chủ Studio
 *     description: Dùng khi mã bị lộ / có người lạ vào. Thành viên đã tham gia vẫn giữ nguyên.
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/ShowId'
 *     responses:
 *       200:
 *         description: "Mã mới, VD { invite_code: KL12A5-41 }"
 *       403:
 *         description: Không phải chủ Studio (STUDIO_OWNER_ONLY)
 *       404:
 *         description: Không có show hoặc chưa tham gia (SHOW_NOT_FOUND)
 */
router.post("/shows/:showId/rotate-invite", studioShowController.rotateInvite);

/**
 * @swagger
 * /api/studio/shows/{showId}/members/{memberId}:
 *   delete:
 *     summary: Mời 1 thành viên ra khỏi show (bài nộp của người đó bị xoá theo) — chỉ chủ Studio
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/ShowId'
 *       - name: memberId
 *         in: path
 *         required: true
 *         description: show_members.id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Đã mời ra
 *       403:
 *         description: Không phải chủ Studio (STUDIO_OWNER_ONLY)
 *       404:
 *         description: Không có show / thành viên (SHOW_NOT_FOUND, MEMBER_NOT_FOUND)
 */
router.delete("/shows/:showId/members/:memberId", studioShowController.removeMember);

/**
 * @swagger
 * /api/studio/shows/{showId}/submit:
 *   post:
 *     summary: Thợ bàn giao file gốc, hoặc Editor nộp link ảnh đã hậu kỳ (mỗi vai trò 1 bài; nộp lại sẽ cập nhật bài cũ)
 *     description: |
 *       - Thợ (crew): crew_type photo/video, show phải đang open.
 *       - Editor: crew_type = retouch, chỉ cần drive_url + total_files (số ảnh đã chỉnh); role_position luôn là "Hậu kỳ";
 *         không áp dụng hạn 24h (is_on_time_24h = null) và không bắt buộc cam kết backup. Show open hoặc completed.
 *       - drive_url chỉ nhận https://drive.google.com/… (chặn mọi cloud khác).
 *       - backup_committed_45d bắt buộc true.
 *       - is_on_time_24h = submitted_at <= shoot_end_time + 24h (server tự tính, nộp lại thì tính lại).
 *       - formatted_folder_name do server tự format:
 *         ảnh "DD/MM/YYYY {crew_name} {role_position} {total_files} file {class_name} {school_name}",
 *         quay "DD/MM/YYYY {crew_name} {role_position} {total_files} clip {class_name} {school_name}".
 *       - role_position chuẩn hoá: "phu 1" → "Phụ 1", "quay chinh" → "Quay chính"; vai trò khác được giữ nguyên.
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/ShowId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SubmitShowRequest'
 *     responses:
 *       201:
 *         description: Đã nộp bài mới
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 submission: { $ref: '#/components/schemas/ShowSubmission' }
 *                 resubmitted: { type: boolean, example: false }
 *       200:
 *         description: Đã nộp lại (cập nhật bài cùng vai trò, trạng thái quay về submitted)
 *       400:
 *         description: "Không hợp lệ (DRIVE_URL_NOT_ALLOWED, BACKUP_COMMITMENT_REQUIRED, INVALID_FILE_COUNT, ROLE_CREW_TYPE_MISMATCH, …)"
 *       403:
 *         description: Chưa nhập mã mời tham gia show (NOT_SHOW_MEMBER) hoặc loại bài không đúng vai trò (SUBMIT_TYPE_NOT_ALLOWED)
 *       404:
 *         description: Không có show hoặc chưa tham gia (SHOW_NOT_FOUND)
 *       409:
 *         description: Show đã đóng (SHOW_NOT_OPEN) hoặc bài vai trò này đã được duyệt (SUBMISSION_ALREADY_APPROVED)
 */
router.post("/shows/:showId/submit", studioShowController.submit);

/**
 * @swagger
 * /api/studio/submissions/{submissionId}/review:
 *   patch:
 *     summary: Chủ Studio duyệt bài nộp hoặc yêu cầu thợ sửa lại (rejected bắt buộc kèm studio_note)
 *     tags: [Studio Shows]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: submissionId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReviewSubmissionRequest'
 *     responses:
 *       200:
 *         description: Đã cập nhật trạng thái bài nộp
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 submission: { $ref: '#/components/schemas/ShowSubmission' }
 *       400:
 *         description: Trạng thái sai hoặc thiếu studio_note khi rejected (STUDIO_NOTE_REQUIRED)
 *       403:
 *         description: Thợ/editor của show không được duyệt (STUDIO_OWNER_ONLY)
 *       404:
 *         description: Không có bài nộp hoặc bạn không phải chủ show (SUBMISSION_NOT_FOUND)
 */
router.patch("/submissions/:submissionId/review", studioShowController.review);

module.exports = router;
