require("dotenv").config();

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test, before, after } = require("node:test");
const jwt = require("jsonwebtoken");
const sharp = require("sharp");
const request = require("supertest");
const { loadEnv } = require("../src/config/env");

loadEnv();
const pool = require("../src/config/db");
const publicDrive = require("../src/services/publicDriveService");
const importQueue = require("../src/services/photoImportQueue");
const driveService = require("../src/services/googleDriveService");
const faceIndexQueue = require("../src/services/faceIndexQueue");
const { createApp } = require("../src/app");

const app = createApp();

// ------------------------------------------------------------------ unit

test("parseDriveLink understands folder, file, open?id and bare ids", () => {
  const id = "1AbCdEfGhIjKlMnOp";
  assert.deepEqual(publicDrive.parseDriveLink(`https://drive.google.com/drive/folders/${id}?usp=sharing`), { kind: "folder", id });
  assert.deepEqual(publicDrive.parseDriveLink(`https://drive.google.com/drive/u/1/folders/${id}`), { kind: "folder", id });
  assert.deepEqual(publicDrive.parseDriveLink(`https://drive.google.com/file/d/${id}/view?usp=drive_link`), { kind: "file", id });
  assert.deepEqual(publicDrive.parseDriveLink(`https://drive.google.com/open?id=${id}`), { kind: "unknown", id });
  assert.deepEqual(publicDrive.parseDriveLink(`  ${id}  `), { kind: "unknown", id });
  assert.equal(publicDrive.parseDriveLink("https://www.dropbox.com/s/abc"), null);
  assert.equal(publicDrive.parseDriveLink(`http://drive.google.com/drive/folders/${id}`), null);
  assert.equal(publicDrive.parseDriveLink("không phải link"), null);
});

test("EXIF capture time is read as Vietnam time", () => {
  assert.equal(publicDrive.exifTimeToIso("2026:11:20 17:30:05"), "2026-11-20T10:30:05.000Z");
  assert.equal(publicDrive.exifTimeToIso(undefined), null);
});

test("imported JPGs are resized to the album preset and keep EXIF", async () => {
  const big = await sharp({ create: { width: 5000, height: 3000, channels: 3, background: "#336699" } })
    .withMetadata({ exif: { IFD0: { Make: "Canon", Model: "EOS R6" } } })
    .jpeg()
    .toBuffer();
  const out = await importQueue.prepareJpeg(big, { max_long_edge_px: 2560, jpeg_quality: 85 });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 2560);
  assert.equal(meta.height, 1536);
  assert.ok(meta.exif, "EXIF giữ lại");

  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
  await assert.rejects(importQueue.prepareJpeg(png, { max_long_edge_px: 2560, jpeg_quality: 85 }), { code: "NOT_JPEG" });
});

// ------------------------------------------------------------------ Drive giả lập

const FOLDER = "application/vnd.google-apps.folder";
let jpegBytes;
const fakeDrive = {
  ROOTFOLDER123: { id: "ROOTFOLDER123", name: "Ky yeu 12A5", mimeType: FOLDER },
  SUBFOLDER4567: { id: "SUBFOLDER4567", name: "JPG", mimeType: FOLDER },
  PRIVATE999999: null,
};
const children = {
  ROOTFOLDER123: [
    [
      { id: "IMG_A_0000001", name: "DSC_0001.JPG", mimeType: "image/jpeg", size: "1000", imageMediaMetadata: { time: "2026:11:20 08:00:00" } },
      { id: "SUBFOLDER4567", name: "JPG", mimeType: FOLDER },
      { id: "RAW_0000001", name: "DSC_0001.CR3", mimeType: "image/x-canon-cr3" },
    ],
    [{ id: "IMG_B_0000002", name: "DSC_0002.jpg", mimeType: "image/jpeg", size: "1000" }],
  ],
  SUBFOLDER4567: [[{ id: "IMG_C_0000003", name: "DSC_0003.jpeg", mimeType: "image/jpeg", size: "1000" }]],
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input) {
  const url = new URL(String(input));
  assert.equal(url.searchParams.get("key"), "test-key");
  const path = url.pathname.replace("/drive/v3/", "");
  if (path === "files") {
    const parent = url.searchParams.get("q").match(/'([^']+)' in parents/)[1];
    const pages = children[parent] ?? [[]];
    const pageIndex = Number(url.searchParams.get("pageToken") ?? 0);
    return json(200, {
      files: pages[pageIndex],
      ...(pageIndex + 1 < pages.length ? { nextPageToken: String(pageIndex + 1) } : {}),
    });
  }
  const id = path.replace("files/", "");
  if (url.searchParams.get("alt") === "media") return new Response(jpegBytes, { status: 200 });
  if (id in fakeDrive && fakeDrive[id] === null) return json(404, { error: { message: "File not found", errors: [{ reason: "notFound" }] } });
  return json(200, fakeDrive[id]);
}

test("listPublicImages walks subfolders and pages, counts non-JPG files", async () => {
  process.env.GOOGLE_API_KEY = "test-key";
  const listing = await publicDrive.listPublicImages({ kind: "folder", id: "ROOTFOLDER123" }, { fetchImpl: fakeFetch });
  assert.equal(listing.name, "Ky yeu 12A5");
  assert.deepEqual(listing.images.map((i) => i.name).sort(), ["DSC_0001.JPG", "DSC_0002.jpg", "DSC_0003.jpeg"]);
  assert.equal(listing.unsupportedCount, 1);
  assert.equal(listing.images.find((i) => i.name === "DSC_0001.JPG").capturedAt, "2026-11-20T01:00:00.000Z");

  await assert.rejects(
    publicDrive.listPublicImages({ kind: "folder", id: "PRIVATE999999" }, { fetchImpl: fakeFetch }),
    { code: "DRIVE_NOT_PUBLIC" }
  );
});

// ------------------------------------------------------------------ integration

const photographerId = randomUUID();
let cookie;
let albumId;
const originals = {};

before(async () => {
  jpegBytes = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#aa5533" } }).jpeg().toBuffer();
  originals.fetch = globalThis.fetch;
  originals.uploadJpeg = driveService.uploadJpeg;
  originals.deleteFile = driveService.deleteFile;
  originals.enqueueFaceIndex = faceIndexQueue.enqueueFaceIndex;
  originals.apiKey = process.env.GOOGLE_API_KEY;

  globalThis.fetch = fakeFetch;
  let n = 0;
  driveService.uploadJpeg = async () => ({ id: `copied-${++n}-${randomUUID()}` });
  driveService.deleteFile = async () => {};
  faceIndexQueue.enqueueFaceIndex = () => {};

  await pool.query(
    `INSERT INTO photographers (id, google_id, email, display_name, oauth_refresh_token_encrypted)
     VALUES ($1, $2, $3, 'Import Test', 'test-only')`,
    [photographerId, `import-test-${photographerId}`, `${photographerId}@import-test.invalid`]
  );
  const { rows } = await pool.query(
    `INSERT INTO albums (photographer_id, name, drive_folder_id, pin_enabled, pin_hash, compression_preset_id)
     VALUES ($1, 'Album test nhập Drive', 'test-folder', false, NULL, 3) RETURNING id`,
    [photographerId]
  );
  albumId = rows[0].id;
  cookie = `session_token=${jwt.sign({ photographerId }, process.env.JWT_SECRET)}`;
});

after(async () => {
  globalThis.fetch = originals.fetch;
  driveService.uploadJpeg = originals.uploadJpeg;
  driveService.deleteFile = originals.deleteFile;
  faceIndexQueue.enqueueFaceIndex = originals.enqueueFaceIndex;
  if (originals.apiKey === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = originals.apiKey;
  await pool.query("DELETE FROM photographers WHERE id = $1", [photographerId]);
});

const importsUrl = () => `/api/albums/${albumId}/imports`;
const folderLink = "https://drive.google.com/drive/folders/ROOTFOLDER123?usp=sharing";

test("import routes require the photographer session", async () => {
  const response = await request(app).get(importsUrl());
  assert.equal(response.statusCode, 401);
});

test("import explains missing API key, bad links and private folders", async () => {
  delete process.env.GOOGLE_API_KEY;
  const noKey = await request(app).post(importsUrl()).set("Cookie", cookie).send({ url: folderLink });
  assert.equal(noKey.statusCode, 503);
  assert.equal(noKey.body.error, "DRIVE_IMPORT_NOT_CONFIGURED");
  process.env.GOOGLE_API_KEY = "test-key";

  const bad = await request(app).post(importsUrl()).set("Cookie", cookie).send({ url: "https://www.dropbox.com/s/x" });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, "DRIVE_LINK_INVALID");

  const privateFolder = await request(app)
    .post(importsUrl())
    .set("Cookie", cookie)
    .send({ url: "https://drive.google.com/drive/folders/PRIVATE999999" });
  assert.equal(privateFolder.statusCode, 404);
  assert.equal(privateFolder.body.error, "DRIVE_NOT_PUBLIC");
});

test("importing a public folder copies every JPG into the album", async () => {
  const response = await request(app).post(importsUrl()).set("Cookie", cookie).send({ url: folderLink });
  assert.equal(response.statusCode, 202);
  assert.equal(response.body.import.total_files, 3);
  assert.equal(response.body.import.source_name, "Ky yeu 12A5");

  await importQueue.whenIdle();
  const progress = await request(app).get(`${importsUrl()}/${response.body.import.id}`).set("Cookie", cookie);
  assert.equal(progress.body.import.status, "done");
  assert.equal(progress.body.import.imported_count, 3);
  assert.equal(progress.body.import.unsupported_count, 1);
  assert.equal(progress.body.import.failed_count, 0);

  const { rows } = await pool.query(
    "SELECT original_base_filename, width, height, source_drive_file_id, captured_at FROM photos WHERE album_id = $1 ORDER BY original_base_filename",
    [albumId]
  );
  assert.deepEqual(rows.map((r) => r.original_base_filename), ["DSC_0001", "DSC_0002", "DSC_0003"]);
  // Mức nén "Trung bình" của album: cạnh dài 1920px
  assert.ok(rows.every((r) => Math.max(r.width, r.height) === 1920));
  assert.ok(rows.every((r) => r.source_drive_file_id));
  assert.equal(rows[0].captured_at.toISOString(), "2026-11-20T01:00:00.000Z");
});

test("re-importing the same link only adds new photos", async () => {
  const response = await request(app).post(importsUrl()).set("Cookie", cookie).send({ url: folderLink });
  assert.equal(response.statusCode, 202);
  await importQueue.whenIdle();
  const progress = await request(app).get(`${importsUrl()}/${response.body.import.id}`).set("Cookie", cookie);
  assert.equal(progress.body.import.imported_count, 0);
  assert.equal(progress.body.import.skipped_existing_count, 3);

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM photos WHERE album_id = $1", [albumId]);
  assert.equal(rows[0].n, 3);

  const history = await request(app).get(importsUrl()).set("Cookie", cookie);
  assert.equal(history.body.imports.length, 2);
});

test("swagger documents the import endpoints", () => {
  const swaggerSpec = require("../src/config/swagger");
  assert.ok(swaggerSpec.paths["/api/albums/{albumId}/imports"]);
  assert.ok(swaggerSpec.paths["/api/albums/{albumId}/imports/{importId}/cancel"]);
  assert.ok(swaggerSpec.components.schemas.PhotoImport);
});
