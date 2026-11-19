// Tạo dữ liệu demo: ~20 album có ảnh thật cho photographer đầu tiên (hoặc theo email).
// Ảnh mẫu lấy từ picsum.photos (ảnh Unsplash, miễn phí), upload lên Google Drive của
// photographer y như luồng upload thật — nên Admin/Client Portal xem được bình thường.
//
//   npm run seed:demo                         # tạo (bỏ qua album trùng tên đã có)
//   npm run seed:demo -- --email you@x.com    # chọn photographer theo email
//   npm run seed:demo -- --clean              # xoá các album demo (DB + folder Drive)
//
// Mọi album demo có PIN chung: 1234 (trừ album tắt PIN).
require("dotenv").config();
const bcrypt = require("bcryptjs");
const sharp = require("sharp");
const pool = require("../src/config/db");
const photoModel = require("../src/models/photoModel");
const albumModel = require("../src/models/albumModel");
const {
  createAlbumFolder,
  uploadJpeg,
  deleteFolder,
} = require("../src/services/googleDriveService");

const DEMO_PIN = "1234";
const DAY = 86_400_000;
const CONCURRENCY = 4;

// days: hạn chọn ảnh tính từ hôm nay (âm = đã quá hạn, null = không giới hạn)
const ALBUMS = [
  { name: "Đám cưới Minh & Trang — Lễ gia tiên", photos: 18, days: 14, max: 40 },
  { name: "Đám cưới Hoàng & Thảo — Tiệc tối", photos: 20, days: 2, max: 50 },
  { name: "Pre-wedding Đà Lạt — Quân & Vy", photos: 16, days: 21, max: 30 },
  { name: "Kỷ yếu 12A1 — THPT Chu Văn An", photos: 20, days: 30, max: null, minor: true },
  { name: "Sinh nhật bé Su 1 tuổi", photos: 12, days: 7, max: 20 },
  { name: "Hội nghị khách hàng FPT 2026", photos: 18, days: null, max: null, pin: false },
  { name: "Ảnh gia đình Tết — Nhà bác Tư", photos: 10, days: 5, max: 15 },
  { name: "Lookbook Thu Đông — Local Brand Mây", photos: 16, days: 10, max: 25, preset: 1 },
  { name: "Đính hôn Khoa & Ngân", photos: 14, days: 1, max: 30 },
  { name: "Year End Party — Studio Ánh Dương", photos: 18, days: null, max: null, watermark: false },
  { name: "Chân dung doanh nhân — Chị Lan", photos: 8, days: 3, max: 5, preset: 1 },
  { name: "Du lịch Hội An — Nhóm bạn thân", photos: 14, days: 45, max: null, pin: false },
  { name: "Lễ tốt nghiệp ĐH Bách Khoa — K66", photos: 16, days: 9, max: 20 },
  { name: "Ảnh sản phẩm cà phê Rang Xay", photos: 10, days: 12, max: null, preset: 1 },
  { name: "Đám cưới Tuấn & Hà — Nhà thờ Lớn", photos: 20, days: -3, max: 60, locked: true },
  { name: "Concert acoustic Chiều Thứ Bảy", photos: 12, days: 6, max: null, preset: 3 },
  { name: "Maternity — Gia đình anh Phong", photos: 10, days: -10, max: 15, locked: true },
  { name: "Đám cưới Long & Mai — 2025", photos: 14, days: -120, max: 40, archived: true, zip: true },
  { name: "Kỷ niệm 10 năm ngày cưới — Bố mẹ", photos: 10, days: -60, max: null, archived: true },
  { name: "Team building Phú Quốc — Công ty Sao Việt", photos: 16, days: -200, max: null, archived: true, preset: 4 },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const emailIndex = args.indexOf("--email");
  return {
    clean: args.includes("--clean"),
    email: emailIndex >= 0 ? args[emailIndex + 1] : null,
  };
}

async function getPhotographer(email) {
  const { rows } = email
    ? await pool.query("SELECT id, email FROM photographers WHERE email = $1", [email])
    : await pool.query("SELECT id, email FROM photographers ORDER BY created_at LIMIT 1");
  if (!rows[0]) {
    throw new Error("Không tìm thấy photographer — đăng nhập Admin Portal bằng Google trước đã.");
  }
  return rows[0];
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function downloadImagePool(count) {
  const res = await fetch("https://picsum.photos/v2/list?page=2&limit=100");
  if (!res.ok) throw new Error(`Không lấy được danh sách ảnh picsum (${res.status})`);
  const list = (await res.json()).filter((p) => p.width > p.height).slice(0, count);

  console.log(`Tải ${list.length} ảnh mẫu từ picsum.photos…`);
  const images = await mapLimit(list, 8, async (item) => {
    const imageRes = await fetch(`https://picsum.photos/id/${item.id}/1800/1200.jpg`);
    if (!imageRes.ok) return null;
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    return { buffer, width: meta.width, height: meta.height };
  });
  return images.filter(Boolean);
}

// Drive API thỉnh thoảng trả lỗi tạm thời (5xx, rate limit, mạng chập chờn) — thử lại có giãn cách.
async function withRetry(fn, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }
}

async function removeAlbum(photographerId, album) {
  await deleteFolder(photographerId, album.drive_folder_id).catch((error) =>
    console.warn(`  Không xoá được folder Drive của "${album.name}": ${error.message}`)
  );
  await pool.query("DELETE FROM albums WHERE id = $1", [album.id]);
}

function pick(arr, i) {
  return arr[i % arr.length];
}

async function seed(photographer) {
  // Album demo chưa có ảnh bìa = lần chạy trước hỏng giữa chừng → xoá để tạo lại.
  const { rows: partial } = await pool.query(
    `SELECT id, name, drive_folder_id FROM albums
     WHERE photographer_id = $1 AND name = ANY($2) AND cover_photo_id IS NULL`,
    [photographer.id, ALBUMS.map((a) => a.name)]
  );
  for (const album of partial) {
    await removeAlbum(photographer.id, album);
    console.log(`↺ Dọn album tạo dở: ${album.name}`);
  }

  const { rows: existing } = await pool.query(
    "SELECT name FROM albums WHERE photographer_id = $1",
    [photographer.id]
  );
  const existingNames = new Set(existing.map((r) => r.name));
  const todo = ALBUMS.filter((a) => !existingNames.has(a.name));
  if (todo.length === 0) {
    console.log("Tất cả album demo đã có — không làm gì.");
    return;
  }

  const images = await downloadImagePool(60);
  if (images.length === 0) throw new Error("Không tải được ảnh mẫu nào.");
  const pinHash = await bcrypt.hash(DEMO_PIN, 12);
  let imageCursor = 0;
  let totalPhotos = 0;

  for (const [albumIndex, spec] of todo.entries()) {
    const pinEnabled = spec.pin !== false;
    const folder = await withRetry(() => createAlbumFolder(photographer.id, spec.name));
    const album = await albumModel.createAlbum({
      photographerId: photographer.id,
      name: spec.name,
      driveFolderId: folder.id,
      pinEnabled,
      pinHash: pinEnabled ? pinHash : null,
      maxSelectablePhotos: spec.max,
      selectionDeadline: spec.days === null ? null : new Date(Date.now() + spec.days * DAY),
      watermarkEnabled: spec.watermark !== false,
      compressionPresetId: spec.preset ?? 2,
      isMinorAlbum: spec.minor === true,
    });

    try {
    // Giờ chụp giả lập: buổi chụp bắt đầu ~ (ngày tạo - 3 ngày), mỗi ảnh cách nhau 1–4 phút.
    const shootStart = Date.now() - (Math.abs(spec.days ?? 7) + 3) * DAY;
    const indices = Array.from({ length: spec.photos }, (_, i) => i);

    const photos = await mapLimit(indices, CONCURRENCY, async (i) => {
      const image = pick(images, imageCursor + i);
      const filename = `DSC_${String(1000 + albumIndex * 100 + i).padStart(4, "0")}`;
      const driveFile = await withRetry(() =>
        uploadJpeg(photographer.id, folder.id, { originalname: `${filename}.jpg`, buffer: image.buffer })
      );
      const sharpness = 55 + ((i * 37 + albumIndex * 11) % 45);
      return photoModel.createPhoto({
        albumId: album.id,
        driveFileId: driveFile.id,
        originalBaseFilename: filename,
        width: image.width,
        height: image.height,
        fileSizeBytes: image.buffer.length,
        capturedAt: new Date(shootStart + i * 150_000 + ((i * 97_000) % 60_000)),
        sharpnessScore: sharpness,
        eyeStatus: i % 9 === 4 ? "closed" : "open",
        cullingFlag: sharpness >= 80 ? "green" : sharpness >= 65 ? "yellow" : "red",
      });
    });
    imageCursor += spec.photos;
    totalPhotos += photos.length;

    // Ảnh phong cảnh không có mặt người — đánh dấu đã trích xong để server khỏi chạy nhận
    // diện khuôn mặt nền cho cả trăm ảnh khi khởi động lại.
    await pool.query(
      "UPDATE photos SET face_index_status = 'done' WHERE album_id = $1",
      [album.id]
    );
    await pool.query(
      `UPDATE albums SET cover_photo_id = $2, is_locked = $3, status = $4,
         download_zip_unlocked = $5, created_at = now() - ($6 || ' days')::interval
       WHERE id = $1`,
      [
        album.id,
        photos[0].id,
        spec.locked === true,
        spec.archived ? "archived" : "active",
        spec.zip === true,
        String(Math.abs(spec.days ?? 7) + 2),
      ]
    );

    console.log(`✓ [${albumIndex + 1}/${todo.length}] ${spec.name} — ${photos.length} ảnh`);
    } catch (error) {
      await removeAlbum(photographer.id, { ...album, drive_folder_id: folder.id });
      throw new Error(`Album "${spec.name}" lỗi và đã được dọn: ${error.message}`);
    }
  }

  console.log(`\nXong: ${todo.length} album, ${totalPhotos} ảnh. PIN chung cho album có PIN: ${DEMO_PIN}`);
}

async function clean(photographer) {
  const { rows } = await pool.query(
    "SELECT id, name, drive_folder_id FROM albums WHERE photographer_id = $1 AND name = ANY($2)",
    [photographer.id, ALBUMS.map((a) => a.name)]
  );
  for (const album of rows) {
    await removeAlbum(photographer.id, album);
    console.log(`✗ Đã xoá ${album.name}`);
  }
  console.log(`Đã xoá ${rows.length} album demo.`);
}

(async () => {
  const { clean: isClean, email } = parseArgs();
  try {
    const photographer = await getPhotographer(email);
    console.log(`Photographer: ${photographer.email}`);
    await (isClean ? clean(photographer) : seed(photographer));
  } catch (error) {
    console.error("Seed thất bại:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    process.exit();
  }
})();
