// Chụp ảnh giao diện cho báo cáo v6 (desktop 1440×900 @2x, mobile 390×844 @3x).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.join(here, ".seed.json"), "utf8"));
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
req(path.join(here, "../BE/node_modules/dotenv")).config({ path: path.join(here, "../BE/.env") });
const jwtLib = req(path.join(here, "../BE/node_modules/jsonwebtoken"));
const minorToken = jwtLib.sign({ role: "client", albumId: seed.minorAlbumId, clientName: "Phạm Gia Huy", clientPhone: "0933000111" }, process.env.JWT_SECRET);
const BASE = "http://localhost:5173";
const A = seed.albumId;
const OUT = process.env.OUT || "/home/claude/shots";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
fs.mkdirSync(OUT, { recursive: true });

const FONT_DIR = path.join(here, "..", "node_modules/@fontsource/be-vietnam-pro/files");
const fontCss = [400, 500, 600, 700, 800].flatMap((w) => ["latin", "vietnamese"].map((s) =>
  `@font-face{font-family:'Be Vietnam Pro';font-style:normal;font-weight:${w};font-display:block;src:url(http://fontlocal/be-vietnam-pro-${s}-${w}-normal.woff2) format('woff2');}`)).join("\n");

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-proxy-server"] });

async function ctxFor(kind, auth = true, clientToken = seed.clientToken) {
  const mobile = kind === "mobile";
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: mobile ? 3 : 2,
    isMobile: mobile, hasTouch: mobile, locale: "vi-VN", reducedMotion: "reduce", timezoneId: "Asia/Ho_Chi_Minh",
  });
  await context.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: fontCss }));
  await context.route("http://fontlocal/**", (r) => r.fulfill({ contentType: "font/woff2",
    body: fs.readFileSync(path.join(FONT_DIR, new URL(r.request().url()).pathname.slice(1))) }));
  if (auth) {
    await context.addCookies([
      { name: "session_token", value: seed.adminToken, domain: "localhost", path: "/" },
      { name: "client_session_token", value: clientToken, domain: "localhost", path: "/" },
    ]);
  }
  return context;
}

const jobs = [
  // ---------- Admin desktop ----------
  { n: "d-admin-login", k: "desktop", auth: false, url: "/admin/login" },
  { n: "d-admin-dashboard", k: "desktop", url: "/admin/dashboard" },
  { n: "d-admin-albums", k: "desktop", url: "/admin/albums" },
  { n: "d-admin-create-album", k: "desktop", url: "/admin/albums/new", full: true },
  { n: "d-admin-album-detail", k: "desktop", url: `/admin/albums/${A}` },
  { n: "d-admin-album-edit", k: "desktop", h: 1280, url: `/admin/albums/${A}`, async run(p) {
      await p.getByRole("button", { name: /Cấu hình|Chỉnh sửa/ }).first().click(); await p.getByRole("dialog").waitFor();
 } },
  { n: "d-admin-album-minor", k: "desktop", url: `/admin/albums/${seed.minorAlbumId}` },
  { n: "d-admin-annotations", k: "desktop", url: `/admin/albums/${A}/annotations`, async run(p) {
      for (let i = 0; i < 5; i++) { if (await p.getByText("Làm sáng khuôn mặt").first().isVisible().catch(() => false)) break;
        await p.getByRole("button", { name: "Ảnh tiếp theo" }).click(); await p.waitForTimeout(600); } } },
  { n: "d-admin-cull", k: "desktop", url: `/admin/albums/${A}/cull` },
  { n: "d-admin-clients", k: "desktop", url: "/admin/clients" },
  { n: "d-admin-client-sheet", k: "desktop", url: "/admin/clients", async run(p) {
      await p.getByRole("button", { name: /Lê Minh Anh/ }).click(); await p.getByRole("dialog").waitFor(); } },
  { n: "d-admin-settings", k: "desktop", url: "/admin/settings", full: true },
  { n: "d-admin-shows", k: "desktop", url: "/admin/shows" },
  { n: "d-admin-show-detail", k: "desktop", url: `/admin/shows/${seed.showId}` },
  // ---------- Client desktop ----------
  { n: "d-client-access", k: "desktop", auth: false, url: `/a/${A}` },
  { n: "d-client-gallery", k: "desktop", url: `/a/${A}/gallery` },
  { n: "d-client-lightbox", k: "desktop", url: `/a/${A}/gallery`, async run(p) {
      await p.getByRole("button", { name: /^Xem ảnh / }).nth(1).click(); await p.getByRole("dialog").waitFor(); } },
  { n: "d-client-limit", k: "desktop", url: `/a/${A}/gallery`, async run(p) {
      const h = p.getByRole("button", { name: /^Chọn ảnh / });
      for (let i = 0; i < 3; i++) { await h.first().click(); await p.waitForTimeout(250); } },
    async after(p) { const s = p.getByRole("button", { name: /^Bỏ chọn ảnh / });
      for (let i = 0; i < 3; i++) { await s.last().click(); await p.waitForTimeout(200); } } },
  { n: "d-client-submit-sheet", k: "desktop", url: `/a/${A}/gallery`, async run(p) {
      await p.getByRole("button", { name: "Gửi lựa chọn" }).click(); await p.getByRole("dialog").waitFor(); } },
  { n: "d-client-submitted", k: "desktop", url: `/a/${A}/gallery`, async run(p) {
      await p.getByRole("button", { name: "Gửi lựa chọn" }).click(); const s = p.getByRole("dialog"); await s.waitFor();
      await s.getByRole("button", { name: "Gửi lựa chọn" }).click();
      await p.getByText("Đã gửi lựa chọn cho nhiếp ảnh gia").first().waitFor({ timeout: 5000 }); },
    async after(p) { await p.getByRole("button", { name: "Mở lại để chỉnh sửa" }).click(); await p.waitForTimeout(500); } },
  { n: "d-client-liked", k: "desktop", url: `/a/${A}/gallery?view=liked` },
  { n: "d-client-face-search", k: "desktop", url: `/a/${A}/face-search` },
  { n: "d-client-face-minor", k: "desktop", minor: true, url: `/a/${seed.minorAlbumId}/face-search` },
  // ---------- Mobile ----------
  { n: "m-admin-dashboard", k: "mobile", url: "/admin/dashboard" },
  { n: "m-admin-albums", k: "mobile", url: "/admin/albums" },
  { n: "m-admin-clients", k: "mobile", url: "/admin/clients" },
  { n: "m-admin-client-sheet", k: "mobile", url: "/admin/clients", async run(p) {
      await p.getByRole("button", { name: /Lê Minh Anh/ }).click(); await p.getByRole("dialog").waitFor(); } },
  { n: "m-client-access", k: "mobile", auth: false, url: `/a/${A}` },
  { n: "m-client-gallery", k: "mobile", url: `/a/${A}/gallery` },
  { n: "m-client-lightbox", k: "mobile", url: `/a/${A}/gallery`, async run(p) {
      await p.getByRole("button", { name: /^Xem ảnh / }).nth(1).click(); const d = p.getByRole("dialog"); await d.waitFor();
      await d.getByRole("button", { name: /Ghi chú chỉnh sửa/ }).click(); } },
  { n: "m-client-submit-sheet", k: "mobile", url: `/a/${A}/gallery`, async run(p) {
      await p.getByRole("button", { name: "Gửi lựa chọn" }).click(); await p.getByRole("dialog").waitFor(); } },
  { n: "m-client-limit", k: "mobile", url: `/a/${A}/gallery`, async run(p) {
      const h = p.getByRole("button", { name: /^Chọn ảnh / });
      for (let i = 0; i < 3; i++) { await h.first().click(); await p.waitForTimeout(250); } },
    async after(p) { const s = p.getByRole("button", { name: /^Bỏ chọn ảnh / });
      for (let i = 0; i < 3; i++) { await s.last().click(); await p.waitForTimeout(200); } } },
];

const contexts = {};
const results = [];
for (const j of jobs) {
  if (ONLY && !ONLY.includes(j.n)) continue;
  const key = `${j.k}-${j.auth === false ? "anon" : "auth"}${j.minor ? "-minor" : ""}`;
  contexts[key] ||= await ctxFor(j.k, j.auth !== false, j.minor ? minorToken : seed.clientToken);
  const page = await contexts[key].newPage();
  if (j.h) await page.setViewportSize({ width: 1440, height: j.h });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 150)));
  try {
    await page.goto(BASE + j.url, { waitUntil: "networkidle", timeout: 25000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    if (j.run) { await j.run(page); await page.waitForTimeout(700); }
    await page.screenshot({ path: path.join(OUT, `${j.n}.png`), fullPage: Boolean(j.full) });
    if (j.after) await j.after(page);
    results.push({ n: j.n, ok: true, errors });
  } catch (e) {
    results.push({ n: j.n, ok: false, err: e.message.split("\n")[0], errors });
  }
  await page.close();
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
