// Kiểm thử các lỗi đã sửa ở đợt hardening L2–L8:
//   L2 migration runner + trạng thái schema ở /api/health
//   L3 Cross-Origin-Resource-Policy trên response ảnh
//   L4 ID sai định dạng → 404 JSON (không còn 500 do lỗi 22P02 của PostgreSQL)
//   L5 hạn mức chọn ảnh (FR-07) → 409 SELECTION_LIMIT_REACHED, an toàn khi bấm song song
//   L7 album vị thành niên không trích embedding khuôn mặt (FR-05, NFR-03)
//   L8 khoá nhập PIN sau 10 lần sai → 429 TOO_MANY_PIN_ATTEMPTS
//   L9 cờ album <18 tuổi là tuyệt đối, khách tự khai "Trên 18" không mở lại face search
require("dotenv").config();

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { randomUUID } = crypto;
const { test, before, after } = require("node:test");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const sharp = require("sharp");
const { loadEnv } = require("../src/config/env");

loadEnv();

// ---- Thay các phụ thuộc ngoài (Google Drive, model ONNX, hàng đợi nền) TRƯỚC khi nạp app:
// controller lấy hàm bằng destructuring lúc require, nên phải vá exports trước.
const driveService = require("../src/services/googleDriveService");
const uploadedToDrive = [];
driveService.uploadJpeg = async (photographerId, folderId, file) => {
  const id = `fake-drive-${randomUUID()}`;
  uploadedToDrive.push({ id, folderId, size: file.size });
  return { id };
};
driveService.deleteFile = async () => {};

const arcface = require("../src/services/arcfaceService");
const faceModelCalls = [];
arcface.detectFaces = async () => {
  faceModelCalls.push("detectFaces");
  return [];
};
arcface.detectFacesInCrops = async () => {
  faceModelCalls.push("detectFacesInCrops");
  return [];
};

const faceIndexQueue = require("../src/services/faceIndexQueue");
const queueCalls = { saveCrops: 0, enqueue: 0 };
const realIndexPhoto = faceIndexQueue.indexPhoto;
faceIndexQueue.saveCrops = async () => {
  queueCalls.saveCrops += 1;
};
faceIndexQueue.enqueueFaceIndex = () => {
  queueCalls.enqueue += 1;
};

const pool = require("../src/config/db");
const redis = require("../src/config/redis");
const { runMigrations } = require("../src/config/migrations");
const { createApp } = require("../src/app");

const app = createApp();
const silent = { log() {} };

const ctx = {};

async function createPhotographer() {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO photographers (id, google_id, email, display_name, oauth_refresh_token_encrypted)
     VALUES ($1, $2, $3, 'Hardening Test', 'test-only')`,
    [id, `hardening-${id}`, `${id}@hardening-test.invalid`]
  );
  const token = jwt.sign({ photographerId: id, email: `${id}@hardening-test.invalid` }, process.env.JWT_SECRET);
  return { id, cookie: `session_token=${token}` };
}

async function createAlbum(photographerId, overrides = {}) {
  const {
    maxSelectable = null,
    pin = null,
    isMinor = false,
    zipUnlocked = false,
  } = overrides;
  const pinHash = pin ? await bcrypt.hash(pin, 4) : null;
  const result = await pool.query(
    `INSERT INTO albums (photographer_id, name, drive_folder_id, pin_enabled, pin_hash,
                         max_selectable_photos, compression_preset_id, is_minor_album, download_zip_unlocked)
     VALUES ($1, 'Album kiểm thử', 'fake-folder', $2, $3, $4,
             (SELECT id FROM compression_presets ORDER BY id LIMIT 1), $5, $6)
     RETURNING id`,
    [photographerId, Boolean(pin), pinHash, maxSelectable, isMinor, zipUnlocked]
  );
  return result.rows[0].id;
}

async function createPhotos(albumId, count) {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const result = await pool.query(
      `INSERT INTO photos (album_id, drive_file_id, original_base_filename, face_index_status)
       VALUES ($1, $2, $3, 'done') RETURNING id`,
      [albumId, `fake-${randomUUID()}`, `IMG_${1000 + i}`]
    );
    ids.push(result.rows[0].id);
  }
  return ids;
}

function clientCookie(albumId, name = "Khách Kiểm Thử", phone = "0900000001") {
  const token = jwt.sign(
    { role: "client", albumId, clientName: name, clientPhone: phone },
    process.env.JWT_SECRET
  );
  return `client_session_token=${token}`;
}

async function tinyJpeg() {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: "#808080" } })
    .jpeg()
    .toBuffer();
}

before(async () => {
  await runMigrations({ logger: silent });
  ctx.ptg = await createPhotographer();
});

after(async () => {
  await pool.query("DELETE FROM photographers WHERE id = $1", [ctx.ptg.id]);
});

// ------------------------------------------------------------------ L2

test("L2: migration runner is idempotent and /api/health reports schema status", async () => {
  const second = await runMigrations({ logger: silent });
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.baselined, []);

  const { rows } = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
  const versions = rows.map((r) => r.version);
  for (const v of ["001", "002", "003", "004", "005", "007", "008", "009", "010", "011", "012"]) {
    assert.ok(versions.includes(v), `missing migration ${v}`);
  }

  const health = await request(app).get("/api/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.schema.up_to_date, true);
  assert.deepEqual(health.body.schema.pending, []);
  const files = require("node:fs").readdirSync(require("../src/config/migrations").MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  assert.equal(health.body.schema.latest, files[files.length - 1]);
});

// ------------------------------------------------------------------ L4

test("L4: malformed UUID route params return 404 JSON, not a 500", async () => {
  const albumId = await createAlbum(ctx.ptg.id);
  const cases = [
    ["get", "/api/albums/not-a-uuid", ctx.ptg.cookie, "ALBUM_NOT_FOUND"],
    ["get", "/api/albums/123/photos", ctx.ptg.cookie, "ALBUM_NOT_FOUND"],
    ["get", `/api/albums/${albumId}/photos/xyz/view`, ctx.ptg.cookie, "PHOTO_NOT_FOUND"],
    ["patch", `/api/albums/${albumId}/annotations/abc`, ctx.ptg.cookie, "ANNOTATION_NOT_FOUND"],
    ["post", "/api/public/albums/abc/verify-pin", null, "ALBUM_NOT_FOUND"],
    ["get", `/api/public/albums/${albumId}/photos/zzz/view`, clientCookie(albumId), "PHOTO_NOT_FOUND"],
    ["get", "/api/studio/shows/abc", ctx.ptg.cookie, "SHOW_NOT_FOUND"],
    ["patch", "/api/studio/submissions/abc/review", ctx.ptg.cookie, "SUBMISSION_NOT_FOUND"],
  ];
  for (const [method, url, cookie, code] of cases) {
    let req = request(app)[method](url);
    if (cookie) req = req.set("Cookie", cookie);
    const response = await req.send({});
    assert.equal(response.statusCode, 404, `${method.toUpperCase()} ${url} → ${response.statusCode}`);
    assert.equal(response.body.error, code, url);
  }
});

// ------------------------------------------------------------------ L3

test("L3: image /view and /download responses carry Cross-Origin-Resource-Policy", async () => {
  const albumId = await createAlbum(ctx.ptg.id);
  const [photoId] = await createPhotos(albumId, 1);
  const jpeg = await tinyJpeg();

  // Ảnh đã có trong cache Redis → không cần gọi Google Drive.
  await redis.set(`admin-thumb:${photoId}:thumb`, jpeg.toString("base64"), "EX", 60);
  const admin = await request(app)
    .get(`/api/albums/${albumId}/photos/${photoId}/view?size=thumb`)
    .set("Cookie", ctx.ptg.cookie);
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.headers["content-type"], "image/jpeg");
  assert.equal(admin.headers["cross-origin-resource-policy"], "same-site");

  const identity = crypto.createHash("sha256").update("Khách Kiểm Thử|0900000001").digest("hex");
  await redis.set(`watermark:${photoId}:thumb:${identity}`, jpeg.toString("base64"), "EX", 60);
  const client = await request(app)
    .get(`/api/public/albums/${albumId}/photos/${photoId}/view?size=thumb`)
    .set("Cookie", clientCookie(albumId));
  assert.equal(client.statusCode, 200);
  assert.equal(client.headers["cross-origin-resource-policy"], "same-site");

  // Cả response lỗi của endpoint tải ảnh cũng mang header (tránh lỗi COEP che mất thông báo).
  const download = await request(app)
    .get(`/api/public/albums/${albumId}/photos/${photoId}/download`)
    .set("Cookie", clientCookie(albumId));
  assert.equal(download.statusCode, 403);
  assert.equal(download.headers["cross-origin-resource-policy"], "same-site");
});

// ------------------------------------------------------------------ L5

test("L5: selection quota returns 409 once max_selectable_photos is reached", async () => {
  const albumId = await createAlbum(ctx.ptg.id, { maxSelectable: 2 });
  const [p1, p2, p3] = await createPhotos(albumId, 3);
  const cookie = clientCookie(albumId);
  const select = (id) =>
    request(app).post(`/api/public/albums/${albumId}/photos/${id}/select`).set("Cookie", cookie);

  const first = await select(p1);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { selected: true, selected_count: 1, max_selectable_photos: 2 });
  assert.equal((await select(p2)).statusCode, 200);

  const blocked = await select(p3);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.error, "SELECTION_LIMIT_REACHED");
  assert.equal(blocked.body.selected_count, 2);
  assert.equal(blocked.body.max_selectable_photos, 2);

  // Bỏ chọn luôn được phép, sau đó chọn được ảnh khác.
  const unselect = await select(p1);
  assert.equal(unselect.statusCode, 200);
  assert.equal(unselect.body.selected, false);
  assert.equal(unselect.body.selected_count, 1);
  assert.equal((await select(p3)).statusCode, 200);

  // Gallery nhận lại trạng thái tim + bộ đếm sau khi tải lại trang.
  const list = await request(app).get(`/api/public/albums/${albumId}/photos`).set("Cookie", cookie);
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.selection, { selected_count: 2, max_selectable_photos: 2, completed_at: null });
  const selectedIds = list.body.photos.filter((p) => p.is_selected).map((p) => p.id).sort();
  assert.deepEqual(selectedIds, [p2, p3].sort());
});

test("L5: concurrent selections cannot exceed the quota", async () => {
  const albumId = await createAlbum(ctx.ptg.id, { maxSelectable: 1 });
  const photos = await createPhotos(albumId, 6);
  const cookie = clientCookie(albumId, "Khách Song Song", "0900000002");
  // Tạo sẵn client record để mọi request đều đi vào nhánh khoá dòng clients.
  await request(app).post(`/api/public/albums/${albumId}/photos/${photos[5]}/select`).set("Cookie", cookie);
  await request(app).post(`/api/public/albums/${albumId}/photos/${photos[5]}/select`).set("Cookie", cookie);

  const responses = await Promise.all(
    photos.slice(0, 5).map((id) =>
      request(app).post(`/api/public/albums/${albumId}/photos/${id}/select`).set("Cookie", cookie)
    )
  );
  const ok = responses.filter((r) => r.statusCode === 200);
  const limited = responses.filter((r) => r.statusCode === 409);
  assert.equal(ok.length, 1);
  assert.equal(limited.length, 4);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM selections s JOIN photos p ON p.id = s.photo_id WHERE p.album_id = $1`,
    [albumId]
  );
  assert.equal(rows[0].n, 1);
});

// ------------------------------------------------------------------ L7

test("L7: upload to a minor album skips face crops, the index queue and embeddings", async () => {
  const albumId = await createAlbum(ctx.ptg.id, { isMinor: true });
  const before = { ...queueCalls };
  const jpeg = await tinyJpeg();

  const response = await request(app)
    .post(`/api/albums/${albumId}/photos`)
    .set("Cookie", ctx.ptg.cookie)
    .field("face_crops_provided", "true")
    .field("face_crop_regions", JSON.stringify([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]))
    .attach("file", jpeg, { filename: "IMG_0001.jpg", contentType: "image/jpeg" })
    .attach("face_crops", jpeg, { filename: "crop0.jpg", contentType: "image/jpeg" });

  assert.equal(response.statusCode, 201, JSON.stringify(response.body));
  assert.equal(response.body.photo.face_index_status, "skipped");
  assert.equal(queueCalls.saveCrops, before.saveCrops, "face crops must not be written to disk");
  assert.equal(queueCalls.enqueue, before.enqueue, "minor album must not enter the face index queue");

  // Một job đã nằm sẵn trong hàng đợi trước khi PTG bật cờ: hàng đợi cũng phải bỏ qua.
  const modelCallsBefore = faceModelCalls.length;
  await realIndexPhoto({ photoId: response.body.photo.id, photographerId: ctx.ptg.id, driveFileId: "x" });
  assert.equal(faceModelCalls.length, modelCallsBefore, "face model must not run for a minor album");
  const { rows } = await pool.query(
    "SELECT face_index_status, (SELECT count(*)::int FROM photo_face_embeddings WHERE photo_id = $1) AS n FROM photos WHERE id = $1",
    [response.body.photo.id]
  );
  assert.equal(rows[0].face_index_status, "skipped");
  assert.equal(rows[0].n, 0);
});

test("L7: upload to a normal album still queues face indexing", async () => {
  const albumId = await createAlbum(ctx.ptg.id);
  const before = queueCalls.enqueue;
  const response = await request(app)
    .post(`/api/albums/${albumId}/photos`)
    .set("Cookie", ctx.ptg.cookie)
    .attach("file", await tinyJpeg(), { filename: "IMG_0002.jpg", contentType: "image/jpeg" });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.photo.face_index_status, "pending");
  assert.equal(queueCalls.enqueue, before + 1);
});

test("L7: flagging an existing album as minor deletes its face embeddings", async () => {
  const albumId = await createAlbum(ctx.ptg.id);
  const [photoId] = await createPhotos(albumId, 1);
  const vector = `[${new Array(512).fill(0.01).join(",")}]`;
  await pool.query("INSERT INTO photo_face_embeddings (photo_id, embedding) VALUES ($1, $2::vector)", [photoId, vector]);

  const response = await request(app)
    .patch(`/api/albums/${albumId}`)
    .set("Cookie", ctx.ptg.cookie)
    .send({ is_minor_album: true });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.album.is_minor_album, true);

  const { rows } = await pool.query(
    "SELECT face_index_status, (SELECT count(*)::int FROM photo_face_embeddings WHERE photo_id = $1) AS n FROM photos WHERE id = $1",
    [photoId]
  );
  assert.equal(rows[0].n, 0);
  assert.equal(rows[0].face_index_status, "skipped");
});

// ------------------------------------------------------------------ L8

test("L8: 10 wrong PINs lock the album for this IP with 429", async () => {
  const albumId = await createAlbum(ctx.ptg.id, { pin: "246810" });
  await redis.del(`pin_fail:${albumId}:::ffff:127.0.0.1`, `pin_fail:${albumId}:127.0.0.1`);
  const attempt = (pin) =>
    request(app)
      .post(`/api/public/albums/${albumId}/verify-pin`)
      .send({ pin, name: "Khách Dò PIN", phone: "0900000003" });

  for (let i = 1; i <= 9; i += 1) {
    const wrong = await attempt("000000");
    assert.equal(wrong.statusCode, 401, `attempt ${i}`);
    assert.equal(wrong.body.error, "INVALID_ALBUM_PIN");
    assert.equal(wrong.body.attempts_remaining, 10 - i);
  }
  const tenth = await attempt("000000");
  assert.equal(tenth.statusCode, 429);
  assert.equal(tenth.body.error, "TOO_MANY_PIN_ATTEMPTS");
  assert.ok(Number(tenth.headers["retry-after"]) > 0);

  // Đang khoá thì PIN đúng cũng bị chặn.
  const correctWhileLocked = await attempt("246810");
  assert.equal(correctWhileLocked.statusCode, 429);
  const keys = await redis.keys(`pin_fail:${albumId}:*`);
  assert.equal(keys.length, 1);
  const ttl = await redis.ttl(keys[0]);
  assert.ok(ttl > 14 * 60 && ttl <= 15 * 60, `ttl=${ttl}`);

  // Hết khoá → PIN đúng vào được và bộ đếm được xoá.
  await redis.del(keys[0]);
  const ok = await attempt("246810");
  assert.equal(ok.statusCode, 200);
  assert.equal((await redis.keys(`pin_fail:${albumId}:*`)).length, 0);
});

// ------------------------------------------------------------------ L9
// Cờ album <18 tuổi là tuyệt đối: khách tự khai "Trên 18 tuổi" không mở lại được face search.
test("L9: a client's 'over 18' declaration cannot override a minor album", async () => {
  const albumId = await createAlbum(ctx.ptg.id, { isMinor: true });
  const cookie = clientCookie(albumId, "Phụ Huynh Kiểm Thử", "0900000009");

  const consent = await request(app)
    .post(`/api/public/albums/${albumId}/face-search/consent`)
    .set("Cookie", cookie)
    .send({ agree: true, is_minor: false });
  assert.equal(consent.statusCode, 403);
  assert.equal(consent.body.error, "FACE_SEARCH_DISABLED_MINOR");

  const status = await request(app)
    .get(`/api/public/albums/${albumId}/face-search/consent`)
    .set("Cookie", cookie);
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.feature_available, false);

  const search = await request(app)
    .post(`/api/public/albums/${albumId}/face-search`)
    .set("Cookie", cookie)
    .attach("file", await tinyJpeg(), { filename: "selfie.jpg", contentType: "image/jpeg" });
  assert.equal(search.statusCode, 403);
  assert.equal(search.body.error, "FACE_SEARCH_DISABLED_MINOR");
});

test("L9: in a normal album, declaring 'under 18' still blocks face search", async () => {
  const albumId = await createAlbum(ctx.ptg.id, { isMinor: false });
  const cookie = clientCookie(albumId, "Học Sinh Kiểm Thử", "0900000010");
  const consent = await request(app)
    .post(`/api/public/albums/${albumId}/face-search/consent`)
    .set("Cookie", cookie)
    .send({ agree: true, is_minor: true });
  assert.equal(consent.statusCode, 403);
  assert.equal(consent.body.error, "FACE_SEARCH_DISABLED_MINOR");

  const adult = clientCookie(albumId, "Người Lớn Kiểm Thử", "0900000011");
  const ok = await request(app)
    .post(`/api/public/albums/${albumId}/face-search/consent`)
    .set("Cookie", adult)
    .send({ agree: true, is_minor: false });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.consented, true);
});
