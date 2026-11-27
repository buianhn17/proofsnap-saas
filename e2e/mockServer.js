// Backend cho kiểm thử giao diện (Playwright) KHÔNG cần Google Drive thật:
//  - Chạy migration (L2) trên DATABASE_URL, seed 1 PTG + album demo + 1 show kỷ yếu.
//  - Thay Google Drive bằng ảnh JPEG sinh bằng sharp (mỗi ảnh 1 màu/tỉ lệ khác nhau).
//  - Ghi e2e/.seed.json (id album/show, cookie đăng nhập) cho responsive-check.mjs.
// Chạy: cd BE && DATABASE_URL=... REDIS_URL=... node ../e2e/mockServer.js
const path = require("node:path");
const fs = require("node:fs");
const { Readable } = require("node:stream");
const BE = path.join(__dirname, "..", "BE");
require(path.join(BE, "node_modules/dotenv")).config({ path: path.join(BE, ".env") });
const sharp = require(path.join(BE, "node_modules/sharp"));
const jwt = require(path.join(BE, "node_modules/jsonwebtoken"));
const bcrypt = require(path.join(BE, "node_modules/bcryptjs"));

const drive = require(path.join(BE, "src/services/googleDriveService"));
const cache = new Map();
async function fakeJpeg(fileId) {
  if (cache.has(fileId)) return cache.get(fileId);
  let h = 0;
  for (const c of fileId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const portrait = h % 3 === 0;
  const [w, hgt] = portrait ? [800, 1200] : [1200, 800];
  const hue = h % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},45%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},40%,25%)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w / 2}" cy="${hgt / 2.4}" r="${Math.min(w, hgt) / 6}" fill="hsl(${hue},30%,80%)"/></svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  cache.set(fileId, buf);
  return buf;
}
drive.downloadFileBuffer = async (_p, id) => fakeJpeg(id);
drive.downloadFileStream = async (_p, id) => Readable.from(await fakeJpeg(id));

const { runMigrations } = require(path.join(BE, "src/config/migrations"));
const pool = require(path.join(BE, "src/config/db"));
const { createApp } = require(path.join(BE, "src/app"));

async function seed() {
  const email = "e2e@lensproof.invalid";
  await pool.query("DELETE FROM photographers WHERE email = $1", [email]);
  const ptg = (await pool.query(
    `INSERT INTO photographers (google_id, email, display_name, oauth_refresh_token_encrypted)
     VALUES ('e2e-google', $1, 'Nguyễn Minh Khoa', 'test-only') RETURNING id`, [email])).rows[0].id;
  const preset = (await pool.query("SELECT id FROM compression_presets ORDER BY id LIMIT 1")).rows[0].id;
  const album = (await pool.query(
    `INSERT INTO albums (photographer_id, name, drive_folder_id, pin_enabled, pin_hash, max_selectable_photos,
                         selection_deadline, compression_preset_id, download_zip_unlocked)
     VALUES ($1, 'Lễ cưới Hoàng & Thảo — Tiệc tối', 'fake', true, $2, 5, now() + interval '38 days 22 hours', $3, true)
     RETURNING id`, [ptg, await bcrypt.hash("1234", 4), preset])).rows[0].id;
  const minor = (await pool.query(
    `INSERT INTO albums (photographer_id, name, drive_folder_id, pin_enabled, compression_preset_id, is_minor_album)
     VALUES ($1, 'Kỷ yếu 12A5 — THPT Kim Liên', 'fake', false, $2, true) RETURNING id`, [ptg, preset])).rows[0].id;
  const photoIds = [];
  for (let i = 0; i < 30; i += 1) {
    const r = await pool.query(
      `INSERT INTO photos (album_id, drive_file_id, original_base_filename, width, height, sharpness_score,
                           culling_flag, face_index_status, captured_at)
       VALUES ($1, $2, $3, 1200, 800, $4, $5, 'done', now() - ($6 || ' minutes')::interval) RETURNING id`,
      [album, `fake-${i}`, `HTA_${String(4000 + i)}`, 40 + i * 2, ["green", "yellow", "red"][i % 3], 60 - i]);
    photoIds.push(r.rows[0].id);
  }
  for (let i = 0; i < 6; i += 1) {
    await pool.query(`INSERT INTO photos (album_id, drive_file_id, original_base_filename, face_index_status)
      VALUES ($1, $2, $3, 'skipped')`, [minor, `fake-minor-${i}`, `KY_${100 + i}`]);
  }
  await pool.query("UPDATE albums SET cover_photo_id = $2 WHERE id = $1", [album, photoIds[0]]);
  // Khách + ghi chú để trang Yêu cầu chỉnh sửa có dữ liệu
  const clientModel = require(path.join(BE, "src/models/clientModel"));
  const acc = (await clientModel.findOrCreateClientAccount({ name: "Trần Thảo", phone: "0912345678" })).id;
  if (acc) {
    const client = (await pool.query(
      "INSERT INTO clients (album_id, client_account_id) VALUES ($1, $2) RETURNING id", [album, acc])).rows[0].id;
    await pool.query("INSERT INTO selections (client_id, photo_id) VALUES ($1, $2), ($1, $3)", [client, photoIds[1], photoIds[2]]);
    await pool.query(`INSERT INTO annotations (photo_id, client_id, pos_x_pct, pos_y_pct, path_pct, note_text)
      VALUES ($1, $2, 40, 35, '[{"x":30,"y":25},{"x":50,"y":25},{"x":50,"y":45},{"x":30,"y":45},{"x":30,"y":25}]',
              'Làm sáng khuôn mặt cô dâu, xoá vết bóng trên trán')`, [photoIds[1], client]);
  }
  // Khách thứ 2 đã gửi lựa chọn + đặt cọc — để Bảng điều khiển / Khách hàng có đủ trạng thái.
  const acc2 = (await clientModel.findOrCreateClientAccount({ name: "Lê Minh Anh", phone: "0987654321" })).id;
  const client2 = (await pool.query(
    "INSERT INTO clients (album_id, client_account_id, payment_status, payment_note) VALUES ($1, $2, 'deposit', 'Cọc 2.000.000đ') RETURNING id",
    [album, acc2])).rows[0].id;
  await pool.query("INSERT INTO selections (client_id, photo_id) VALUES ($1, $2), ($1, $3), ($1, $4)",
    [client2, photoIds[4], photoIds[7], photoIds[9]]);
  await pool.query("INSERT INTO album_client_completions (client_id, completed_at) VALUES ($1, now() - interval '2 hours')", [client2]);

  const show = (await pool.query(
    `INSERT INTO studio_shows (studio_user_id, invite_code, shoot_date, shoot_end_time, class_name, school_name)
     VALUES ($1, 'KL12A5-' || floor(random()*9000+1000)::text, current_date, now() + interval '3 hours', '12A5', 'THPT Kim Liên')
     RETURNING id`, [ptg])).rows[0].id;
  const token = jwt.sign({ photographerId: ptg, email }, process.env.JWT_SECRET);
  const clientToken = jwt.sign({ role: "client", albumId: album, clientName: "Trần Thảo", clientPhone: "0912345678" },
    process.env.JWT_SECRET);
  const seedInfo = { albumId: album, minorAlbumId: minor, showId: show, photoId: photoIds[1], adminToken: token, clientToken };
  fs.writeFileSync(path.join(__dirname, ".seed.json"), JSON.stringify(seedInfo, null, 2));
  return seedInfo;
}

(async () => {
  await runMigrations({ logger: { log() {} } });
  const info = await seed();
  createApp().listen(Number(process.env.PORT || 3000), () =>
    console.log(`e2e backend :${process.env.PORT || 3000}`, JSON.stringify({ albumId: info.albumId })));
})().catch((e) => { console.error(e); process.exit(1); });
