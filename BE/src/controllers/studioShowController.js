const redis = require("../config/redis");
const studioShowModel = require("../models/studioShowModel");
const photographerModel = require("../models/photographerModel");
const {
  buildInviteCodePrefix,
  generateInviteCode,
  normalizeInviteCode,
  validateCreateShow,
  validateSubmission,
  formatFolderName,
  validateReview,
  validateMemberRole,
  SUBMIT_TYPES_BY_MEMBER_ROLE,
  SHOW_STATUSES,
} = require("../services/studioShowRules");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_CODE_ATTEMPTS = 24;
// Mã mời ngắn (VD "KL12A5-89" chỉ có 90 khả năng nếu biết trường + lớp) → giới hạn số lần
// nhập SAI mã của mỗi tài khoản để không dò ra được.
const JOIN_FAIL_LIMIT = 10;
const JOIN_FAIL_WINDOW_SECONDS = 15 * 60;

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const notStudioOwner = (action) =>
  httpError(403, "STUDIO_OWNER_ONLY", `Chỉ chủ Studio tạo show mới được ${action}`);

const showNotFound = () => httpError(404, "SHOW_NOT_FOUND", "Không tìm thấy show hoặc bạn chưa tham gia show này");

function getUserId(req) {
  return req.photographer.photographerId;
}

function toShow(row) {
  const show = {
    id: row.id,
    invite_code: row.invite_code,
    shoot_date: row.shoot_date,
    shoot_end_time: row.shoot_end_time,
    deadline_at: row.deadline_at,
    class_name: row.class_name,
    school_name: row.school_name,
    status: row.status,
    studio_name: row.studio_name,
    created_at: row.created_at,
    stats: {
      member_count: row.member_count,
      submitted_crew_count: row.submitted_crew_count,
      submission_count: row.submission_count,
      pending_count: row.pending_count,
      approved_count: row.approved_count,
      rejected_count: row.rejected_count,
      late_count: row.late_count,
      total_files: row.total_files,
      total_photo_files: row.total_photo_files,
      total_video_clips: row.total_video_clips,
      retouch_count: row.retouch_count,
      total_retouch_files: row.total_retouch_files,
      crew_member_count: row.crew_member_count,
      editor_count: row.editor_count,
    },
  };
  if (row.submitters) show.submitters = row.submitters;
  return show;
}

function withoutInternal(submission) {
  const { is_new: _isNew, ...rest } = submission;
  return rest;
}

/** studio = chủ Studio · editor = hậu kỳ · crew = thợ chụp/quay */
function viewerRoleOf(show) {
  if (show.is_owner) return "studio";
  return show.member_role === "editor" ? "editor" : "crew";
}

// Ai thấy gì của bài nộp NGƯỜI KHÁC:
//   studio  → tất cả
//   editor  → link Drive + tên chuẩn của mọi thợ (để tải file gốc), không thấy ghi chú duyệt
//   crew    → bài của ekip nhưng không có link Drive, không có ghi chú duyệt
function toSubmissionForViewer(submission, viewerId, viewerRole) {
  if (viewerRole === "studio" || submission.crew_user_id === viewerId) return submission;
  const { drive_url: driveUrl, studio_note: _note, ...visible } = submission;
  return viewerRole === "editor" ? { ...visible, drive_url: driveUrl } : visible;
}

function toMemberForViewer(member, viewerRole) {
  if (viewerRole === "studio") return member;
  const { email: _email, ...visible } = member;
  return visible;
}

async function create(req, res, next) {
  try {
    const input = validateCreateShow(req.body || {});
    const prefix = buildInviteCodePrefix(input.schoolName, input.className);

    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
      try {
        const show = await studioShowModel.createShow({
          studioUserId: getUserId(req),
          inviteCode: generateInviteCode(prefix, attempt),
          ...input,
        });
        return res.status(201).json({ show });
      } catch (error) {
        const isCodeCollision =
          error.code === "23505" && error.constraint === "studio_shows_invite_code_key";
        if (!isCodeCollision) throw error;
      }
    }
    throw httpError(503, "INVITE_CODE_EXHAUSTED", "Không sinh được mã mời, vui lòng thử lại");
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const rows = await studioShowModel.listShowsForUser(getUserId(req));
    const asMember = (row) => ({
      ...toShow(row),
      my_role: row.member_role,
      joined_at: row.joined_at,
      my_submission_count: row.my_submission_count,
    });
    res.json({
      owned: rows.filter((row) => row.is_owner).map(toShow),
      // Tham gia làm thợ chụp/quay
      joined: rows.filter((row) => !row.is_owner && row.member_role === "crew").map(asMember),
      // Tham gia làm editor hậu kỳ
      editing: rows.filter((row) => !row.is_owner && row.member_role === "editor").map(asMember),
    });
  } catch (error) {
    next(error);
  }
}

async function getOne(req, res, next) {
  try {
    const userId = getUserId(req);
    if (!UUID_PATTERN.test(req.params.showId)) throw showNotFound();
    const show = await studioShowModel.findShowForUser(req.params.showId, userId);
    if (!show) throw showNotFound();

    const viewerRole = viewerRoleOf(show);
    const [submissions, members] = await Promise.all([
      studioShowModel.listSubmissions(show.id),
      studioShowModel.listMembers(show.id),
    ]);
    res.json({
      show: toShow(show),
      viewer_role: viewerRole,
      // Vai trò thành viên của chính mình (chủ Studio cũng có thể tham gia làm thợ) — null nếu chưa
      my_member_role: show.member_role ?? null,
      submissions: submissions.map((s) => toSubmissionForViewer(s, userId, viewerRole)),
      members: members.map((m) => toMemberForViewer(m, viewerRole)),
    });
  } catch (error) {
    next(error);
  }
}

async function join(req, res, next) {
  try {
    const userId = getUserId(req);
    const failKey = `studio:join-fail:${userId}`;
    const failCount = Number(await redis.get(failKey).catch(() => 0)) || 0;
    if (failCount >= JOIN_FAIL_LIMIT) {
      throw httpError(429, "TOO_MANY_JOIN_ATTEMPTS", "Nhập sai mã mời quá nhiều lần, thử lại sau 15 phút");
    }

    const body = req.body || {};
    const roleType = validateMemberRole(body.role_type);
    const inviteCode = normalizeInviteCode(body.invite_code);
    if (!inviteCode) {
      throw httpError(400, "INVALID_INVITE_CODE", "Mã mời không đúng định dạng (VD: KL12A5-89)");
    }

    const show = await studioShowModel.findShowByInviteCode(inviteCode, userId);
    if (!show) {
      await redis
        .multi()
        .incr(failKey)
        .expire(failKey, JOIN_FAIL_WINDOW_SECONDS, "NX")
        .exec()
        .catch((error) => console.error("Không ghi được lượt nhập sai mã mời:", error.message));
      throw httpError(404, "INVITE_CODE_NOT_FOUND", "Mã mời không tồn tại");
    }
    // Thợ chỉ vào được show đang mở. Editor vào được cả show đã chốt file gốc (completed) —
    // hậu kỳ thường bắt đầu sau khi thợ nộp xong.
    const acceptsRole = show.status === "open" || (show.status === "completed" && roleType === "editor");
    if (!show.is_member && !acceptsRole) {
      throw httpError(409, "SHOW_NOT_OPEN", "Show đã đóng, không nhận thêm thành viên");
    }

    const result = await studioShowModel.upsertMember(show.id, userId, roleType);
    if (result.locked) {
      throw httpError(
        409,
        "MEMBER_ROLE_LOCKED",
        `Bạn đã tham gia show này với tư cách ${result.member.role_type === "editor" ? "Editor" : "Thợ"} và đã nộp bài — không đổi vai trò được`
      );
    }
    const mySubmissions = await studioShowModel.listSubmissionsForCrew(show.id, userId);
    const memberDelta = result.joined ? 1 : 0;
    res.json({
      show: toShow({
        ...show,
        member_count: show.member_count + memberDelta,
        crew_member_count: show.crew_member_count + (roleType === "crew" ? memberDelta : 0),
        editor_count: show.editor_count + (roleType === "editor" ? memberDelta : 0),
      }),
      viewer_role: viewerRoleOf({ ...show, member_role: result.member.role_type }),
      member_role: result.member.role_type,
      already_joined: !result.joined,
      role_changed: result.changed,
      my_submissions: mySubmissions,
    });
  } catch (error) {
    next(error);
  }
}

async function submit(req, res, next) {
  try {
    const userId = getUserId(req);
    if (!UUID_PATTERN.test(req.params.showId)) throw showNotFound();
    const show = await studioShowModel.findShowForUser(req.params.showId, userId);
    if (!show) throw showNotFound();
    if (!show.is_member) {
      throw httpError(403, "NOT_SHOW_MEMBER", "Nhập mã mời để tham gia show trước khi nộp bài");
    }

    const body = req.body || {};
    const allowedTypes = SUBMIT_TYPES_BY_MEMBER_ROLE[show.member_role];
    if (body.crew_type !== undefined && !allowedTypes.includes(body.crew_type)) {
      throw httpError(
        403,
        "SUBMIT_TYPE_NOT_ALLOWED",
        show.member_role === "editor"
          ? "Editor chỉ nộp được link ảnh đã hậu kỳ (crew_type = 'retouch')"
          : "Thợ chụp/quay không nộp được ảnh hậu kỳ — tham gia lại với vai trò Editor"
      );
    }
    const acceptsSubmission =
      show.status === "open" || (show.status === "completed" && body.crew_type === "retouch");
    if (!acceptsSubmission) {
      throw httpError(409, "SHOW_NOT_OPEN", "Show đã đóng, không nhận bàn giao nữa");
    }

    const me = await photographerModel.findById(userId);
    const input = validateSubmission(body, {
      defaultCrewName: me?.display_name || undefined,
    });

    const submission = await studioShowModel.upsertSubmission({
      showId: show.id,
      crewUserId: userId,
      formattedFolderName: formatFolderName({
        shootDate: show.shoot_date,
        className: show.class_name,
        schoolName: show.school_name,
        ...input,
      }),
      ...input,
    });
    if (!submission) {
      throw httpError(
        409,
        "SUBMISSION_ALREADY_APPROVED",
        `Bài nộp vai trò "${input.rolePosition}" đã được Studio duyệt, không nộp lại được`
      );
    }

    res.status(submission.is_new ? 201 : 200).json({
      submission: withoutInternal(submission),
      resubmitted: !submission.is_new,
    });
  } catch (error) {
    next(error);
  }
}

async function review(req, res, next) {
  try {
    if (!UUID_PATTERN.test(req.params.submissionId)) {
      throw httpError(404, "SUBMISSION_NOT_FOUND", "Không tìm thấy bài nộp");
    }
    const input = validateReview(req.body || {});
    const existing = await studioShowModel.findSubmissionWithAccess(
      req.params.submissionId,
      getUserId(req)
    );
    if (!existing) {
      throw httpError(404, "SUBMISSION_NOT_FOUND", "Không tìm thấy bài nộp");
    }
    if (!existing.is_owner) throw notStudioOwner("duyệt hoặc yêu cầu sửa bài nộp");
    const submission = await studioShowModel.reviewSubmission(existing.id, input);
    res.json({ submission });
  } catch (error) {
    next(error);
  }
}

/** Tải show và bắt buộc người gọi là chủ Studio (404 nếu không liên quan, 403 nếu chỉ là thành viên). */
async function loadOwnedShow(req, action) {
  if (!UUID_PATTERN.test(req.params.showId)) throw showNotFound();
  const show = await studioShowModel.findShowForUser(req.params.showId, getUserId(req));
  if (!show) throw showNotFound();
  if (!show.is_owner) throw notStudioOwner(action);
  return show;
}

async function updateStatus(req, res, next) {
  try {
    const status = (req.body || {}).status;
    if (!SHOW_STATUSES.includes(status)) {
      throw httpError(400, "INVALID_SHOW_STATUS", "status phải là 'open', 'completed' hoặc 'archived'");
    }
    const show = await loadOwnedShow(req, "đổi trạng thái show");
    await studioShowModel.updateShowStatus(show.id, getUserId(req), status);
    const updated = await studioShowModel.findShowForUser(show.id, getUserId(req));
    res.json({ show: toShow(updated) });
  } catch (error) {
    next(error);
  }
}

async function rotateInvite(req, res, next) {
  try {
    const show = await loadOwnedShow(req, "đổi mã mời");
    const prefix = buildInviteCodePrefix(show.school_name, show.class_name);
    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
      const candidate = generateInviteCode(prefix, attempt);
      if (candidate === show.invite_code) continue;
      try {
        const inviteCode = await studioShowModel.updateInviteCode(show.id, getUserId(req), candidate);
        return res.json({ invite_code: inviteCode });
      } catch (error) {
        const isCodeCollision = error.code === "23505" && error.constraint === "studio_shows_invite_code_key";
        if (!isCodeCollision) throw error;
      }
    }
    throw httpError(503, "INVITE_CODE_EXHAUSTED", "Không sinh được mã mời, vui lòng thử lại");
  } catch (error) {
    next(error);
  }
}

async function removeMember(req, res, next) {
  try {
    const show = await loadOwnedShow(req, "mời thành viên ra khỏi show");
    if (!UUID_PATTERN.test(req.params.memberId)) {
      throw httpError(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên");
    }
    const removed = await studioShowModel.removeMember(show.id, req.params.memberId);
    if (!removed) throw httpError(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const userId = getUserId(req);
    if (!UUID_PATTERN.test(req.params.showId)) throw showNotFound();
    const show = await studioShowModel.findShowForUser(req.params.showId, userId);
    if (!show) throw showNotFound();
    if (!show.is_owner) throw notStudioOwner("xoá show");
    await studioShowModel.deleteShowForStudio(show.id, userId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

module.exports = { create, list, getOne, join, submit, review, remove, updateStatus, rotateInvite, removeMember };
