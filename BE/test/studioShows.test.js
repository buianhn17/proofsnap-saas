require("dotenv").config();

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test, before, after } = require("node:test");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { loadEnv } = require("../src/config/env");

loadEnv();
const pool = require("../src/config/db");
const redis = require("../src/config/redis");
const rules = require("../src/services/studioShowRules");
const { createApp } = require("../src/app");

const app = createApp();

// ------------------------------------------------------------------ unit: quy tắc thuần

test("invite code prefix: initials of school (minus school type) + class", () => {
  assert.equal(rules.buildInviteCodePrefix("THPT Kim Liên", "12A5"), "KL12A5");
  assert.equal(rules.buildInviteCodePrefix("Trường THCS Ngô Sĩ Liên", "9A"), "NSL9A");
  assert.equal(rules.buildInviteCodePrefix("Trung học phổ thông Việt Đức", "11A2"), "VD11A2");
  // Chỉ bỏ tiền tố ở đầu — "Trưng" là tên trường, không phải "Trung học"
  assert.equal(rules.buildInviteCodePrefix("THPT Trưng Vương", "12D"), "TV12D");
  assert.match(rules.generateInviteCode("KL12A5"), /^KL12A5-\d{2}$/);
  assert.match(rules.generateInviteCode("KL12A5", 20), /^KL12A5-\d{4}$/);
  assert.equal(rules.normalizeInviteCode("  kl12a5-89 "), "KL12A5-89");
  assert.equal(rules.normalizeInviteCode("KL12A5"), null);
});

test("drive_url accepts only https://drive.google.com", () => {
  assert.equal(rules.isGoogleDriveUrl("https://drive.google.com/drive/folders/abc"), true);
  for (const url of [
    "http://drive.google.com/drive/folders/abc",
    "https://drive.google.com.evil.com/x",
    "https://drive.google.com@evil.com/x",
    "https://www.dropbox.com/s/abc",
    "https://onedrive.live.com/abc",
    "https://www.fshare.vn/folder/abc",
    "drive.google.com/drive/folders/abc",
  ]) {
    assert.equal(rules.isGoogleDriveUrl(url), false, url);
  }
});

test("role_position is canonicalized and checked against crew_type", () => {
  assert.equal(rules.normalizeRolePosition("phu 2", "photo"), "Phụ 2");
  assert.equal(rules.normalizeRolePosition("LEAD", "photo"), "Lead");
  assert.equal(rules.normalizeRolePosition("quay chinh", "video"), "Quay chính");
  assert.equal(rules.normalizeRolePosition("flycam", "photo"), "Flycam");
  assert.equal(rules.normalizeRolePosition("Second  shooter", "photo"), "Second shooter");
  assert.throws(() => rules.normalizeRolePosition("Quay chính", "photo"), { code: "ROLE_CREW_TYPE_MISMATCH" });
  assert.throws(() => rules.normalizeRolePosition("Lead", "video"), { code: "ROLE_CREW_TYPE_MISMATCH" });
});

test("folder name format for photo and video crews", () => {
  const base = { shootDate: "2026-11-20", crewName: "Nguyễn Văn A", className: "12A5", schoolName: "THPT Kim Liên" };
  assert.equal(
    rules.formatFolderName({ ...base, rolePosition: "Lead", totalFiles: 850, crewType: "photo" }),
    "20/11/2026 Nguyễn Văn A Lead 850 file 12A5 THPT Kim Liên"
  );
  assert.equal(
    rules.formatFolderName({ ...base, rolePosition: "Quay chính", totalFiles: 42, crewType: "video" }),
    "20/11/2026 Nguyễn Văn A Quay chính 42 clip 12A5 THPT Kim Liên"
  );
});

test("shoot_end_time must carry a timezone and fall on the shoot date", () => {
  const ok = { shoot_date: "2026-11-20", class_name: "12A5", school_name: "THPT Kim Liên" };
  assert.ok(rules.validateCreateShow({ ...ok, shoot_end_time: "2026-11-20T17:30:00+07:00" }));
  assert.ok(rules.validateCreateShow({ ...ok, shoot_end_time: "2026-11-21T00:30:00+07:00" }));
  assert.throws(() => rules.validateCreateShow({ ...ok, shoot_end_time: "2026-11-20T17:30:00" }), { code: "INVALID_SHOOT_END_TIME" });
  assert.throws(() => rules.validateCreateShow({ ...ok, shoot_end_time: "2026-11-25T17:30:00+07:00" }), { code: "INVALID_SHOOT_END_TIME" });
  assert.throws(() => rules.validateCreateShow({ ...ok, shoot_date: "2026-02-30", shoot_end_time: "2026-02-28T10:00:00Z" }), { code: "INVALID_SHOOT_DATE" });
});

// ------------------------------------------------------------------ integration: API + DB

const users = {};
const ctx = {};

async function createUser(key, displayName) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO photographers (id, google_id, email, display_name, oauth_refresh_token_encrypted)
     VALUES ($1, $2, $3, $4, 'test-only')`,
    [id, `studio-test-${id}`, `${id}@studio-test.invalid`, displayName]
  );
  const token = jwt.sign({ photographerId: id, email: `${id}@studio-test.invalid` }, process.env.JWT_SECRET);
  users[key] = { id, cookie: `session_token=${token}` };
}

function as(key) {
  const cookie = users[key].cookie;
  return {
    get: (url) => request(app).get(url).set("Cookie", cookie),
    post: (url, body) => request(app).post(url).set("Cookie", cookie).send(body),
    patch: (url, body) => request(app).patch(url).set("Cookie", cookie).send(body),
  };
}

// Ngày chụp theo giờ VN tương ứng với một thời điểm kết thúc show
function vnDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(date);
}

function showBody(endTime, overrides = {}) {
  return {
    shoot_date: vnDate(endTime),
    shoot_end_time: endTime.toISOString(),
    class_name: "12A5",
    school_name: "THPT Kim Liên",
    ...overrides,
  };
}

const photoSubmission = {
  crew_type: "photo",
  role_position: "lead",
  drive_url: "https://drive.google.com/drive/folders/1AbCdEf",
  total_files: 850,
  raw_count: 850,
  jpg_count: 850,
  culled_stats: { closed_eyes: 12, blurry: 5, overexposed: 2, failed_fireworks: 3 },
  has_valid_structure: true,
  backup_committed_45d: true,
};

before(async () => {
  // Schema luôn ở bản mới nhất (migration runner L2) — chạy được trên DB test trống.
  await require("../src/config/migrations").runMigrations({ logger: { log() {} } });
  await createUser("studio", "Studio Ánh Dương");
  await createUser("photo", "Nguyễn Văn A");
  await createUser("video", "Trần Văn B");
  await createUser("outsider", "Người Ngoài");
  await createUser("guesser", "Dò Mã");
  await createUser("editor", "Lê Hậu Kỳ");
  await createUser("switcher", "Đổi Vai");
});

after(async () => {
  const ids = Object.values(users).map((u) => u.id);
  await pool.query("DELETE FROM photographers WHERE id = ANY($1)", [ids]);
  await Promise.all(ids.map((id) => redis.del(`studio:join-fail:${id}`)));
});

test("studio routes require a photographer session", async () => {
  const response = await request(app).get("/api/studio/shows");
  assert.equal(response.statusCode, 401);
});

test("studio creates a show with an auto-generated invite code", async () => {
  const endTime = new Date(Date.now() - 60 * 60 * 1000); // kết thúc 1 giờ trước → còn hạn
  const response = await as("studio").post("/api/studio/shows", showBody(endTime));

  assert.equal(response.statusCode, 201);
  const { show } = response.body;
  assert.match(show.invite_code, /^KL12A5-\d{2,4}$/);
  assert.equal(show.status, "open");
  assert.equal(new Date(show.deadline_at) - new Date(show.shoot_end_time), 24 * 60 * 60 * 1000);
  ctx.show = show;

  const bad = await as("studio").post("/api/studio/shows", showBody(endTime, { shoot_end_time: "2026-11-20T17:30:00" }));
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, "INVALID_SHOOT_END_TIME");
});

test("non-members cannot see or submit to a show", async () => {
  const detail = await as("outsider").get(`/api/studio/shows/${ctx.show.id}`);
  assert.equal(detail.statusCode, 404);
  const submit = await as("outsider").post(`/api/studio/shows/${ctx.show.id}/submit`, photoSubmission);
  assert.equal(submit.statusCode, 404);
  const owner = await as("studio").post(`/api/studio/shows/${ctx.show.id}/submit`, photoSubmission);
  assert.equal(owner.statusCode, 403);
  assert.equal(owner.body.error, "NOT_SHOW_MEMBER");
});

test("crew joins with the invite code (case/space insensitive, idempotent)", async () => {
  const first = await as("photo").post("/api/studio/shows/join", {
    invite_code: ` ${ctx.show.invite_code.toLowerCase()} `,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.already_joined, false);
  assert.equal(first.body.viewer_role, "crew");
  assert.equal(first.body.show.id, ctx.show.id);

  const again = await as("photo").post("/api/studio/shows/join", { invite_code: ctx.show.invite_code });
  assert.equal(again.body.already_joined, true);

  const video = await as("video").post("/api/studio/shows/join", { invite_code: ctx.show.invite_code });
  assert.equal(video.statusCode, 200);

  const malformed = await as("photo").post("/api/studio/shows/join", { invite_code: "abc" });
  assert.equal(malformed.statusCode, 400);
});

test("submission validation: Drive-only URL and 45-day backup commitment", async () => {
  const url = `/api/studio/shows/${ctx.show.id}/submit`;
  const dropbox = await as("photo").post(url, { ...photoSubmission, drive_url: "https://www.dropbox.com/s/x" });
  assert.equal(dropbox.statusCode, 400);
  assert.equal(dropbox.body.error, "DRIVE_URL_NOT_ALLOWED");

  const noBackup = await as("photo").post(url, { ...photoSubmission, backup_committed_45d: false });
  assert.equal(noBackup.statusCode, 400);
  assert.equal(noBackup.body.error, "BACKUP_COMMITMENT_REQUIRED");

  const badStats = await as("photo").post(url, { ...photoSubmission, culled_stats: { selfies: 1 } });
  assert.equal(badStats.body.error, "INVALID_CULLED_STATS");

  const wrongCounts = await as("photo").post(url, { ...photoSubmission, video_count: 3 });
  assert.equal(wrongCounts.body.error, "COUNT_CREW_TYPE_MISMATCH");
});

test("photo crew submits: folder name formatted, on-time computed, multi-role allowed", async () => {
  const url = `/api/studio/shows/${ctx.show.id}/submit`;
  const response = await as("photo").post(url, photoSubmission);

  assert.equal(response.statusCode, 201);
  const { submission } = response.body;
  const displayDate = rules.formatDisplayDate(ctx.show.shoot_date);
  assert.equal(submission.formatted_folder_name, `${displayDate} Nguyễn Văn A Lead 850 file 12A5 THPT Kim Liên`);
  assert.equal(submission.role_position, "Lead");
  assert.equal(submission.crew_name, "Nguyễn Văn A"); // mặc định lấy tên tài khoản
  assert.equal(submission.is_on_time_24h, true);
  assert.equal(submission.status, "submitted");
  assert.deepEqual(submission.culled_stats, photoSubmission.culled_stats);
  assert.equal(submission.is_new, undefined);
  ctx.leadSubmission = submission;

  // Kiêm nhiệm: cùng thợ, vai trò khác → bài mới
  const candid = await as("photo").post(url, { ...photoSubmission, role_position: "Candid", total_files: 300 });
  assert.equal(candid.statusCode, 201);
  assert.notEqual(candid.body.submission.id, submission.id);

  // Cùng vai trò → cập nhật bài cũ
  const again = await as("photo").post(url, { ...photoSubmission, role_position: "LEAD", total_files: 860 });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.resubmitted, true);
  assert.equal(again.body.submission.id, submission.id);
  assert.match(again.body.submission.formatted_folder_name, / 860 file /);
});

test("video crew submits with clip unit and canonical role", async () => {
  const response = await as("video").post(`/api/studio/shows/${ctx.show.id}/submit`, {
    crew_type: "video",
    crew_name: "Trần B",
    role_position: "quay chinh",
    drive_url: "https://drive.google.com/drive/folders/VID123",
    total_files: 42,
    video_count: 42,
    has_valid_structure: true,
    backup_committed_45d: true,
  });
  assert.equal(response.statusCode, 201);
  const { submission } = response.body;
  assert.equal(submission.role_position, "Quay chính");
  assert.equal(
    submission.formatted_folder_name,
    `${rules.formatDisplayDate(ctx.show.shoot_date)} Trần B Quay chính 42 clip 12A5 THPT Kim Liên`
  );
});

test("show detail: studio sees everything, crew sees only their own Drive links", async () => {
  const studio = await as("studio").get(`/api/studio/shows/${ctx.show.id}`);
  assert.equal(studio.statusCode, 200);
  assert.equal(studio.body.viewer_role, "studio");
  assert.equal(studio.body.submissions.length, 3);
  assert.ok(studio.body.submissions.every((s) => s.drive_url));
  assert.equal(studio.body.members.length, 2);
  assert.ok(studio.body.members.every((m) => m.email && m.role_type === "crew"));
  const photoMember = studio.body.members.find((m) => m.user_id === users.photo.id);
  assert.deepEqual(photoMember.crew_types, ["photo"]);

  const crew = await as("video").get(`/api/studio/shows/${ctx.show.id}`);
  assert.equal(crew.body.viewer_role, "crew");
  // Thợ thấy ekip (để hiện badge) nhưng không thấy email
  assert.equal(crew.body.members.length, 2);
  assert.ok(crew.body.members.every((m) => m.email === undefined));
  const mine = crew.body.submissions.filter((s) => s.crew_user_id === users.video.id);
  const others = crew.body.submissions.filter((s) => s.crew_user_id !== users.video.id);
  assert.ok(mine.every((s) => s.drive_url));
  assert.ok(others.length > 0 && others.every((s) => s.drive_url === undefined && s.studio_note === undefined));
});

test("show list splits owned vs joined with class totals", async () => {
  const studio = await as("studio").get("/api/studio/shows");
  const owned = studio.body.owned.find((s) => s.id === ctx.show.id);
  assert.ok(owned);
  assert.equal(studio.body.joined.length, 0);
  assert.deepEqual(
    {
      crew: owned.stats.submitted_crew_count,
      submissions: owned.stats.submission_count,
      photos: owned.stats.total_photo_files,
      clips: owned.stats.total_video_clips,
      total: owned.stats.total_files,
      members: owned.stats.member_count,
    },
    { crew: 2, submissions: 3, photos: 860 + 300, clips: 42, total: 860 + 300 + 42, members: 2 }
  );

  assert.equal(owned.submitters.length, 3);
  assert.ok(owned.submitters.every((s) => s.drive_url === undefined));
  assert.deepEqual(new Set(owned.submitters.map((s) => s.crew_type)), new Set(["photo", "video"]));

  const crew = await as("photo").get("/api/studio/shows");
  assert.equal(crew.body.owned.length, 0);
  const joined = crew.body.joined.find((s) => s.id === ctx.show.id);
  assert.equal(joined.my_submission_count, 2);
});

test("editor joins with the same invite code and sees every crew Drive link", async () => {
  const join = await as("editor").post("/api/studio/shows/join", {
    invite_code: ctx.show.invite_code,
    role_type: "editor",
  });
  assert.equal(join.statusCode, 200);
  assert.equal(join.body.member_role, "editor");
  assert.equal(join.body.viewer_role, "editor");

  const bad = await as("editor").post("/api/studio/shows/join", { invite_code: ctx.show.invite_code, role_type: "boss" });
  assert.equal(bad.body.error, "INVALID_MEMBER_ROLE");

  const list = await as("editor").get("/api/studio/shows");
  assert.equal(list.body.joined.length, 0);
  assert.equal(list.body.editing.length, 1);
  assert.equal(list.body.editing[0].my_role, "editor");

  const detail = await as("editor").get(`/api/studio/shows/${ctx.show.id}`);
  assert.equal(detail.body.viewer_role, "editor");
  const raw = detail.body.submissions.filter((s) => s.crew_type !== "retouch");
  assert.equal(raw.length, 3);
  assert.ok(raw.every((s) => s.drive_url && s.formatted_folder_name && s.studio_note === undefined));
  const editorMember = detail.body.members.find((m) => m.user_id === users.editor.id);
  assert.equal(editorMember.role_type, "editor");
});

test("editor submits retouched photos only; crew cannot submit retouch", async () => {
  const url = `/api/studio/shows/${ctx.show.id}/submit`;
  const asPhoto = await as("editor").post(url, photoSubmission);
  assert.equal(asPhoto.statusCode, 403);
  assert.equal(asPhoto.body.error, "SUBMIT_TYPE_NOT_ALLOWED");

  const retouch = { crew_type: "retouch", drive_url: "https://drive.google.com/drive/folders/EDIT1", total_files: 120 };
  const crewRetouch = await as("photo").post(url, retouch);
  assert.equal(crewRetouch.statusCode, 403);

  const notDrive = await as("editor").post(url, { ...retouch, drive_url: "https://www.dropbox.com/x" });
  assert.equal(notDrive.body.error, "DRIVE_URL_NOT_ALLOWED");

  const response = await as("editor").post(url, retouch);
  assert.equal(response.statusCode, 201);
  const { submission } = response.body;
  assert.equal(submission.crew_type, "retouch");
  assert.equal(submission.role_position, "Hậu kỳ");
  assert.equal(submission.is_on_time_24h, null);
  assert.equal(
    submission.formatted_folder_name,
    `${rules.formatDisplayDate(ctx.show.shoot_date)} Lê Hậu Kỳ Hậu kỳ 120 file 12A5 THPT Kim Liên`
  );
  ctx.retouchSubmission = submission;

  // Thống kê: ảnh hậu kỳ tách riêng, không cộng vào file gốc
  const studio = await as("studio").get(`/api/studio/shows/${ctx.show.id}`);
  assert.equal(studio.body.show.stats.retouch_count, 1);
  assert.equal(studio.body.show.stats.total_retouch_files, 120);
  assert.equal(studio.body.show.stats.total_files, 860 + 300 + 42);
  assert.equal(studio.body.show.stats.submitted_crew_count, 2);
  assert.equal(studio.body.show.stats.editor_count, 1);

  // Thợ không thấy link ảnh hậu kỳ của editor
  const crew = await as("photo").get(`/api/studio/shows/${ctx.show.id}`);
  const seen = crew.body.submissions.find((s) => s.id === submission.id);
  assert.equal(seen.drive_url, undefined);
});

test("only the studio owner can review submissions or delete the show", async () => {
  const review = await as("editor").patch(`/api/studio/submissions/${ctx.leadSubmission.id}/review`, { status: "approved" });
  assert.equal(review.statusCode, 403);
  assert.equal(review.body.error, "STUDIO_OWNER_ONLY");

  const crewDelete = await request(app).delete(`/api/studio/shows/${ctx.show.id}`).set("Cookie", users.editor.cookie);
  assert.equal(crewDelete.statusCode, 403);
  const outsiderDelete = await request(app).delete(`/api/studio/shows/${ctx.show.id}`).set("Cookie", users.outsider.cookie);
  assert.equal(outsiderDelete.statusCode, 404);

  const approveRetouch = await as("studio").patch(`/api/studio/submissions/${ctx.retouchSubmission.id}/review`, { status: "approved" });
  assert.equal(approveRetouch.body.submission.status, "approved");
});

test("member role can change until the first submission", async () => {
  const code = ctx.show.invite_code;
  await as("switcher").post("/api/studio/shows/join", { invite_code: code, role_type: "crew" });
  const switched = await as("switcher").post("/api/studio/shows/join", { invite_code: code, role_type: "editor" });
  assert.equal(switched.statusCode, 200);
  assert.equal(switched.body.role_changed, true);
  assert.equal(switched.body.member_role, "editor");

  const locked = await as("photo").post("/api/studio/shows/join", { invite_code: code, role_type: "editor" });
  assert.equal(locked.statusCode, 409);
  assert.equal(locked.body.error, "MEMBER_ROLE_LOCKED");
});

test("review flow: reject needs a note, resubmit resets, approved is final", async () => {
  const url = `/api/studio/submissions/${ctx.leadSubmission.id}/review`;

  const byCrew = await as("photo").patch(url, { status: "approved" });
  assert.equal(byCrew.statusCode, 403);
  assert.equal(byCrew.body.error, "STUDIO_OWNER_ONLY");

  const noNote = await as("studio").patch(url, { status: "rejected" });
  assert.equal(noNote.statusCode, 400);
  assert.equal(noNote.body.error, "STUDIO_NOTE_REQUIRED");

  const rejected = await as("studio").patch(url, { status: "rejected", studio_note: "Thiếu folder RAW nén" });
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.body.submission.status, "rejected");
  assert.ok(rejected.body.submission.reviewed_at);

  const fixed = await as("photo").post(`/api/studio/shows/${ctx.show.id}/submit`, photoSubmission);
  assert.equal(fixed.statusCode, 200);
  assert.equal(fixed.body.submission.status, "submitted");
  assert.equal(fixed.body.submission.studio_note, null);

  const approved = await as("studio").patch(url, { status: "approved" });
  assert.equal(approved.body.submission.status, "approved");

  const locked = await as("photo").post(`/api/studio/shows/${ctx.show.id}/submit`, photoSubmission);
  assert.equal(locked.statusCode, 409);
  assert.equal(locked.body.error, "SUBMISSION_ALREADY_APPROVED");
});

test("submissions after shoot_end_time + 24h are flagged late", async () => {
  const endTime = new Date(Date.now() - 30 * 60 * 60 * 1000); // kết thúc 30 giờ trước
  const { body } = await as("studio").post("/api/studio/shows", showBody(endTime, { class_name: "12A6" }));
  await as("photo").post("/api/studio/shows/join", { invite_code: body.show.invite_code });

  const response = await as("photo").post(`/api/studio/shows/${body.show.id}/submit`, photoSubmission);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.submission.is_on_time_24h, false);
});

test("closed shows reject new members and submissions", async () => {
  const { body } = await as("studio").post("/api/studio/shows", showBody(new Date(), { class_name: "12A7" }));
  await as("photo").post("/api/studio/shows/join", { invite_code: body.show.invite_code });
  await pool.query("UPDATE studio_shows SET status = 'completed' WHERE id = $1", [body.show.id]);

  const join = await as("video").post("/api/studio/shows/join", { invite_code: body.show.invite_code });
  assert.equal(join.statusCode, 409);
  assert.equal(join.body.error, "SHOW_NOT_OPEN");

  const submit = await as("photo").post(`/api/studio/shows/${body.show.id}/submit`, photoSubmission);
  assert.equal(submit.statusCode, 409);

  // Show đã chốt file gốc vẫn nhận editor và ảnh hậu kỳ
  const editorJoin = await as("editor").post("/api/studio/shows/join", { invite_code: body.show.invite_code, role_type: "editor" });
  assert.equal(editorJoin.statusCode, 200);
  const retouch = await as("editor").post(`/api/studio/shows/${body.show.id}/submit`, {
    crew_type: "retouch",
    drive_url: "https://drive.google.com/drive/folders/EDIT2",
    total_files: 50,
  });
  assert.equal(retouch.statusCode, 201);
  ctx.closedShowId = body.show.id;
});

test("studio owner deletes a show with everything in it", async () => {
  const response = await request(app).delete(`/api/studio/shows/${ctx.closedShowId}`).set("Cookie", users.studio.cookie);
  assert.equal(response.statusCode, 204);
  const gone = await as("studio").get(`/api/studio/shows/${ctx.closedShowId}`);
  assert.equal(gone.statusCode, 404);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM show_submissions WHERE show_id = $1", [ctx.closedShowId]);
  assert.equal(rows[0].n, 0);
});

test("repeated wrong invite codes are throttled", async () => {
  for (let i = 0; i < 10; i++) {
    const miss = await as("guesser").post("/api/studio/shows/join", { invite_code: `ZZ99Z-${10 + i}` });
    assert.equal(miss.statusCode, 404);
  }
  const blocked = await as("guesser").post("/api/studio/shows/join", { invite_code: ctx.show.invite_code });
  assert.equal(blocked.statusCode, 429);
});

test("swagger documents the studio endpoints", () => {
  const swaggerSpec = require("../src/config/swagger");
  for (const path of [
    "/api/studio/shows",
    "/api/studio/shows/join",
    "/api/studio/shows/{showId}",
    "/api/studio/shows/{showId}/submit",
    "/api/studio/submissions/{submissionId}/review",
  ]) {
    assert.ok(swaggerSpec.paths[path], path);
  }
  assert.ok(swaggerSpec.components.schemas.SubmitShowRequest);
});
