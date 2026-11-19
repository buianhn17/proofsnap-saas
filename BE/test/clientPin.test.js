require("dotenv").config();

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test, before, after } = require("node:test");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const { loadEnv } = require("../src/config/env");

loadEnv();
const pool = require("../src/config/db");
const redis = require("../src/config/redis");
const { createApp } = require("../src/app");

const app = createApp();
const photographerId = randomUUID();
let albumId;
let photoId;

before(async () => {
  await pool.query(
    `INSERT INTO photographers (id, google_id, email, display_name, oauth_refresh_token_encrypted)
     VALUES ($1, $2, $3, 'PIN Test', 'test-only')`,
    [photographerId, `pin-test-${photographerId}`, `${photographerId}@pin-test.invalid`]
  );
  const { rows } = await pool.query(
    `INSERT INTO albums (photographer_id, name, drive_folder_id, pin_enabled, pin_hash, compression_preset_id)
     VALUES ($1, 'Album test PIN', 'test-folder', true, $2, 2) RETURNING id`,
    [photographerId, await bcrypt.hash("4321", 4)]
  );
  albumId = rows[0].id;
  const photo = await pool.query(
    `INSERT INTO photos (album_id, drive_file_id, original_base_filename) VALUES ($1, 'test-file', 'DSC_0001') RETURNING id`,
    [albumId]
  );
  photoId = photo.rows[0].id;
});

after(async () => {
  const keys = await redis.keys(`pin-fail:${albumId}:*`);
  if (keys.length) await redis.del(keys);
  await pool.query("DELETE FROM photographers WHERE id = $1", [photographerId]);
  await pool.query("DELETE FROM client_accounts WHERE email = $1", [`${testPhone}@client.lensproof.local`]);
});

// Số điện thoại riêng cho mỗi lần chạy — tài khoản khách tạo ra được xoá ở after()
const testPhone = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const body = (pin) => ({ pin, name: "Nguyễn Văn A", phone: testPhone });

test("correct PIN opens the album and resets the failure counter", async () => {
  const wrong = await request(app).post(`/api/public/albums/${albumId}/verify-pin`).send(body("0000"));
  assert.equal(wrong.statusCode, 401);
  const right = await request(app).post(`/api/public/albums/${albumId}/verify-pin`).send(body("4321"));
  assert.equal(right.statusCode, 200);
  const keys = await redis.keys(`pin-fail:${albumId}:*`);
  assert.equal(keys.length, 0);
});

test("photo list remembers which photos the client hearted", async () => {
  const agent = request.agent(app);
  const open = await agent.post(`/api/public/albums/${albumId}/verify-pin`).send(body("4321"));
  assert.equal(open.statusCode, 200);

  const before = await agent.get(`/api/public/albums/${albumId}/photos`);
  assert.equal(before.body.photos[0].selected, false);

  const heart = await agent.post(`/api/public/albums/${albumId}/photos/${photoId}/select`);
  assert.equal(heart.body.selected, true);

  // Tải lại trang (gọi lại danh sách) vẫn thấy ảnh đã thả tim
  const after = await agent.get(`/api/public/albums/${albumId}/photos`);
  assert.equal(after.body.photos[0].selected, true);
});

test("repeated wrong PINs are throttled, even the right PIN is refused until the window passes", async () => {
  for (let i = 0; i < 10; i++) {
    const wrong = await request(app).post(`/api/public/albums/${albumId}/verify-pin`).send(body(String(1000 + i)));
    assert.equal(wrong.statusCode, 401);
  }
  const blocked = await request(app).post(`/api/public/albums/${albumId}/verify-pin`).send(body("4321"));
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error, "TOO_MANY_PIN_ATTEMPTS");
});
