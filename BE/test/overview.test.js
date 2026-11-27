// Chức năng hoàn thiện theo tài liệu gốc: khách xác nhận hoàn tất chọn ảnh (mục 5.2), PTG tự
// đánh dấu thanh toán (mục 3.2), Bảng điều khiển, danh sách Khách hàng, Cài đặt mặc định album.
require("dotenv").config();

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test, before, after } = require("node:test");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { loadEnv } = require("../src/config/env");

loadEnv();
const pool = require("../src/config/db");
const { runMigrations } = require("../src/config/migrations");
const { createApp } = require("../src/app");

const app = createApp();
const ctx = {};

async function createPhotographer(label) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO photographers (id, google_id, email, display_name, oauth_refresh_token_encrypted)
     VALUES ($1, $2, $3, $4, 'test-only')`,
    [id, `overview-${id}`, `${id}@overview-test.invalid`, label]
  );
  return { id, cookie: `session_token=${jwt.sign({ photographerId: id }, process.env.JWT_SECRET)}` };
}

async function createAlbum(photographerId, { deadlineDays = 7, max = null } = {}) {
  const result = await pool.query(
    `INSERT INTO albums (photographer_id, name, drive_folder_id, pin_enabled, compression_preset_id,
                         selection_deadline, max_selectable_photos)
     VALUES ($1, 'Album tổng quan', 'fake', false, 1, now() + ($2 || ' days')::interval, $3)
     RETURNING id`,
    [photographerId, String(deadlineDays), max]
  );
  const albumId = result.rows[0].id;
  const photos = [];
  for (let i = 0; i < 3; i += 1) {
    const r = await pool.query(
      `INSERT INTO photos (album_id, drive_file_id, original_base_filename, face_index_status)
       VALUES ($1, $2, $3, 'done') RETURNING id`,
      [albumId, `fake-${randomUUID()}`, `DSC_${100 + i}`]
    );
    photos.push(r.rows[0].id);
  }
  return { albumId, photos };
}

function clientAgent(albumId, name, phone) {
  const cookie = `client_session_token=${jwt.sign(
    { role: "client", albumId, clientName: name, clientPhone: phone },
    process.env.JWT_SECRET
  )}`;
  return {
    get: (url) => request(app).get(url).set("Cookie", cookie),
    post: (url, body) => request(app).post(url).set("Cookie", cookie).send(body ?? {}),
  };
}

before(async () => {
  await runMigrations({ logger: { log() {} } });
  ctx.ptg = await createPhotographer("PTG Tổng Quan");
  ctx.other = await createPhotographer("PTG Khác");
  Object.assign(ctx, await createAlbum(ctx.ptg.id, { max: 2 }));
  ctx.client = clientAgent(ctx.albumId, "Lê Minh Anh", "0901234567");
});

after(async () => {
  await pool.query("DELETE FROM photographers WHERE id = ANY($1)", [[ctx.ptg.id, ctx.other.id]]);
});

test("completion: cannot complete with no selection", async () => {
  const response = await ctx.client.post(`/api/public/albums/${ctx.albumId}/complete`);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, "NO_SELECTION");
});

test("completion: complete locks hearts and notes until reopened", async () => {
  const base = `/api/public/albums/${ctx.albumId}`;
  assert.equal((await ctx.client.post(`${base}/photos/${ctx.photos[0]}/select`)).statusCode, 200);

  const done = await ctx.client.post(`${base}/complete`);
  assert.equal(done.statusCode, 200);
  assert.ok(done.body.completion.completed_at);
  assert.equal(done.body.selected_count, 1);

  const album = await ctx.client.get(base);
  assert.ok(album.body.completion.completed_at);
  const list = await ctx.client.get(`${base}/photos`);
  assert.ok(list.body.selection.completed_at);

  const blocked = await ctx.client.post(`${base}/photos/${ctx.photos[1]}/select`);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.error, "SELECTION_COMPLETED");
  const note = await ctx.client.post(`${base}/photos/${ctx.photos[0]}/annotations`, {
    pos_x_pct: 10, pos_y_pct: 10, note_text: "Làm sáng da",
  });
  assert.equal(note.statusCode, 409);

  const reopened = await ctx.client.post(`${base}/complete/reopen`);
  assert.equal(reopened.statusCode, 200);
  assert.equal((await ctx.client.get(base)).body.completion, null);
  assert.equal((await ctx.client.post(`${base}/photos/${ctx.photos[1]}/select`)).statusCode, 200);
  const noteAfter = await ctx.client.post(`${base}/photos/${ctx.photos[0]}/annotations`, {
    pos_x_pct: 10, pos_y_pct: 10, note_text: "Làm sáng da",
  });
  assert.equal(noteAfter.statusCode, 201);
  assert.equal((await ctx.client.post(`${base}/complete`)).statusCode, 200);
});

test("completion: cannot reopen once the album is locked", async () => {
  const { albumId, photos } = await createAlbum(ctx.ptg.id);
  const client = clientAgent(albumId, "Khách Khoá", "0907777777");
  await client.post(`/api/public/albums/${albumId}/photos/${photos[0]}/select`);
  await client.post(`/api/public/albums/${albumId}/complete`);
  await pool.query("UPDATE albums SET is_locked = true WHERE id = $1", [albumId]);
  const response = await client.post(`/api/public/albums/${albumId}/complete/reopen`);
  assert.equal(response.statusCode, 403);
});

test("dashboard: counts albums, clients, completions and recent activity", async () => {
  const response = await request(app).get("/api/dashboard").set("Cookie", ctx.ptg.cookie);
  assert.equal(response.statusCode, 200);
  const { albums, totals, upcoming_deadlines: deadlines, recent_activity: activity } = response.body;
  assert.ok(albums.total >= 2);
  assert.ok(totals.photos >= 6);
  assert.ok(totals.clients >= 2);
  assert.ok(totals.completed_clients >= 2);
  assert.ok(totals.selections >= 3);
  assert.ok(totals.pending_annotations >= 1);
  assert.ok(deadlines.some((d) => d.id === ctx.albumId && d.completed_count === 1));
  assert.ok(activity.some((a) => a.kind === "completed" && a.client_name === "Lê Minh Anh"));
  assert.ok(activity.some((a) => a.kind === "annotation"));

  const empty = await request(app).get("/api/dashboard").set("Cookie", ctx.other.cookie);
  assert.equal(empty.body.albums.total, 0);
  assert.equal(empty.body.recent_activity.length, 0);
  assert.equal((await request(app).get("/api/dashboard")).statusCode, 401);
});

test("clients: list, filter, detail with filenames, payment update scoped to owner", async () => {
  const list = await request(app).get("/api/clients?search=Minh").set("Cookie", ctx.ptg.cookie);
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.clients.length, 1);
  const [client] = list.body.clients;
  assert.equal(client.name, "Lê Minh Anh");
  assert.equal(client.selected_count, 2);
  assert.equal(client.max_selectable_photos, 2);
  assert.equal(client.payment_status, "unpaid");
  assert.ok(client.completed_at);

  const completed = await request(app).get("/api/clients?filter=completed").set("Cookie", ctx.ptg.cookie);
  assert.ok(completed.body.clients.every((c) => c.completed_at));
  const byAlbum = await request(app).get(`/api/clients?album_id=${ctx.albumId}`).set("Cookie", ctx.ptg.cookie);
  assert.ok(byAlbum.body.clients.every((c) => c.album_id === ctx.albumId));

  const detail = await request(app).get(`/api/clients/${client.id}`).set("Cookie", ctx.ptg.cookie);
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.body.client.selected_photos.map((p) => p.original_base_filename), ["DSC_100", "DSC_101"]);

  const paid = await request(app)
    .patch(`/api/clients/${client.id}`)
    .set("Cookie", ctx.ptg.cookie)
    .send({ payment_status: "deposit", payment_note: "Cọc 2.000.000đ qua chuyển khoản" });
  assert.equal(paid.statusCode, 200);
  assert.equal(paid.body.client.payment_status, "deposit");
  assert.equal(paid.body.client.payment_note, "Cọc 2.000.000đ qua chuyển khoản");

  const unpaidFilter = await request(app).get("/api/clients?filter=unpaid").set("Cookie", ctx.ptg.cookie);
  assert.ok(unpaidFilter.body.clients.some((c) => c.id === client.id));

  const invalid = await request(app).patch(`/api/clients/${client.id}`).set("Cookie", ctx.ptg.cookie)
    .send({ payment_status: "refunded" });
  assert.equal(invalid.statusCode, 400);

  // PTG khác không xem/sửa được khách không thuộc album của mình.
  assert.equal((await request(app).get(`/api/clients/${client.id}`).set("Cookie", ctx.other.cookie)).statusCode, 404);
  const foreign = await request(app).patch(`/api/clients/${client.id}`).set("Cookie", ctx.other.cookie)
    .send({ payment_status: "paid" });
  assert.equal(foreign.statusCode, 404);
  assert.equal((await request(app).get("/api/clients/not-a-uuid").set("Cookie", ctx.ptg.cookie)).statusCode, 404);
});

test("settings: read, validate and merge album defaults", async () => {
  const initial = await request(app).get("/api/settings").set("Cookie", ctx.ptg.cookie);
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.body.settings.display_name, "PTG Tổng Quan");
  assert.deepEqual(initial.body.settings.settings, {});

  const updated = await request(app).patch("/api/settings").set("Cookie", ctx.ptg.cookie).send({
    display_name: "Studio Ánh Dương",
    settings: { default_compression_preset_id: 3, default_watermark_enabled: false, default_deadline_days: 14 },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.settings.display_name, "Studio Ánh Dương");
  assert.equal(updated.body.settings.settings.default_compression_preset_id, 3);

  const merged = await request(app).patch("/api/settings").set("Cookie", ctx.ptg.cookie)
    .send({ settings: { default_max_selectable_photos: 50 } });
  assert.deepEqual(merged.body.settings.settings, {
    default_compression_preset_id: 3,
    default_watermark_enabled: false,
    default_deadline_days: 14,
    default_max_selectable_photos: 50,
  });

  for (const bad of [
    { display_name: "" },
    { settings: { default_compression_preset_id: 9 } },
    { settings: { default_deadline_days: 0 } },
    { settings: "x" },
  ]) {
    const response = await request(app).patch("/api/settings").set("Cookie", ctx.ptg.cookie).send(bad);
    assert.equal(response.statusCode, 400, JSON.stringify(bad));
  }
  // Khoá lạ bị bỏ qua, không được ghi vào DB.
  const extra = await request(app).patch("/api/settings").set("Cookie", ctx.ptg.cookie)
    .send({ settings: { is_admin: true } });
  assert.equal(extra.body.settings.settings.is_admin, undefined);
});

test("deadline job: locks expired albums and auto-completes clients who picked photos", async () => {
  const { runDeadlineSweep } = require("../src/services/deadlineJob");
  const { albumId, photos } = await createAlbum(ctx.ptg.id, { deadlineDays: 3 });
  const picker = clientAgent(albumId, "Khách Quá Hạn", "0911111111");
  const idler = clientAgent(albumId, "Khách Chưa Chọn", "0922222222");
  await picker.post(`/api/public/albums/${albumId}/photos/${photos[0]}/select`);
  // Khách 2 chỉ ghi chú, không thả tim → không bị tính là "đã chốt".
  await idler.post(`/api/public/albums/${albumId}/photos/${photos[1]}/annotations`, {
    pos_x_pct: 5, pos_y_pct: 5, note_text: "Xem thử",
  });
  await pool.query("UPDATE albums SET selection_deadline = now() - interval '1 minute' WHERE id = $1", [albumId]);

  const locked = await runDeadlineSweep({ log() {} });
  assert.ok(locked.some((a) => a.id === albumId));
  const { rows } = await pool.query("SELECT is_locked FROM albums WHERE id = $1", [albumId]);
  assert.equal(rows[0].is_locked, true);

  const list = await request(app).get(`/api/clients?album_id=${albumId}`).set("Cookie", ctx.ptg.cookie);
  const byName = Object.fromEntries(list.body.clients.map((c) => [c.name, c]));
  assert.ok(byName["Khách Quá Hạn"].completed_at);
  assert.equal(byName["Khách Quá Hạn"].auto_locked, true);
  assert.equal(byName["Khách Chưa Chọn"].completed_at, null);

  // Chạy lại không đổi gì (idempotent), khách đã tự gửi trước đó giữ nguyên mốc của họ.
  assert.equal((await runDeadlineSweep({ log() {} })).length, 0);
  const dash = await request(app).get("/api/dashboard").set("Cookie", ctx.ptg.cookie);
  assert.ok(dash.body.recent_activity.some((a) => a.kind === "auto_locked" && a.client_name === "Khách Quá Hạn"));
});

test("dashboard: an expired-but-not-yet-locked album is not counted as open", async () => {
  const fresh = await createPhotographer("PTG Đếm Album");
  await createAlbum(fresh.id, { deadlineDays: 5 });
  const { albumId } = await createAlbum(fresh.id, { deadlineDays: 5 });
  await pool.query("UPDATE albums SET selection_deadline = now() - interval '1 hour' WHERE id = $1", [albumId]);
  const dash = await request(app).get("/api/dashboard").set("Cookie", fresh.cookie);
  assert.equal(dash.body.albums.open, 1);
  assert.equal(dash.body.albums.locked, 1);
  await pool.query("DELETE FROM photographers WHERE id = $1", [fresh.id]);
});

test("unseen completions: badge counts new submissions until the PTG opens Khách hàng", async () => {
  await request(app).post("/api/clients/seen").set("Cookie", ctx.ptg.cookie).expect(204);
  assert.equal((await request(app).get("/api/clients/unseen-count").set("Cookie", ctx.ptg.cookie)).body.count, 0);

  const { albumId, photos } = await createAlbum(ctx.ptg.id);
  const client = clientAgent(albumId, "Khách Mới Gửi", "0933333333");
  await client.post(`/api/public/albums/${albumId}/photos/${photos[0]}/select`);
  await client.post(`/api/public/albums/${albumId}/complete`);
  assert.equal((await request(app).get("/api/clients/unseen-count").set("Cookie", ctx.ptg.cookie)).body.count, 1);
  // PTG khác không thấy huy hiệu của PTG này.
  assert.equal((await request(app).get("/api/clients/unseen-count").set("Cookie", ctx.other.cookie)).body.count, 0);

  await request(app).post("/api/clients/seen").set("Cookie", ctx.ptg.cookie).expect(204);
  assert.equal((await request(app).get("/api/clients/unseen-count").set("Cookie", ctx.ptg.cookie)).body.count, 0);
});

test("album deadline: cannot be moved into the past, unchanged old deadline is accepted", async () => {
  const { albumId } = await createAlbum(ctx.ptg.id);
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const rejected = await request(app).patch(`/api/albums/${albumId}`).set("Cookie", ctx.ptg.cookie)
    .send({ selection_deadline: past });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.error, "DEADLINE_IN_PAST");

  // Album đã quá hạn: form sửa gửi lại đúng hạn cũ kèm tên mới → vẫn lưu được.
  await pool.query("UPDATE albums SET selection_deadline = $2 WHERE id = $1", [albumId, past]);
  const renamed = await request(app).patch(`/api/albums/${albumId}`).set("Cookie", ctx.ptg.cookie)
    .send({ name: "Album đổi tên", selection_deadline: past });
  assert.equal(renamed.statusCode, 200, JSON.stringify(renamed.body));

  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const extended = await request(app).patch(`/api/albums/${albumId}`).set("Cookie", ctx.ptg.cookie)
    .send({ selection_deadline: future });
  assert.equal(extended.statusCode, 200);
});

test("clients search: % and _ are matched literally, not as wildcards", async () => {
  const all = await request(app).get("/api/clients?search=%25").set("Cookie", ctx.ptg.cookie);
  assert.equal(all.statusCode, 200);
  assert.equal(all.body.clients.length, 0);
  const underscore = await request(app).get("/api/clients?search=_").set("Cookie", ctx.ptg.cookie);
  assert.equal(underscore.body.clients.length, 0);
});
