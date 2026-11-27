// Kiểm tra responsive tự động (Phase 3.3): mọi route Admin + Client Portal và các modal/drawer
// tương tác, trên 5 kích thước màn hình. Mỗi trang kiểm tra:
//   1. Không tràn ngang: document.documentElement.scrollWidth <= window.innerWidth
//   2. Không có nút/link/ô nhập đang hiển thị bị đè lên nhau (giao nhau > 4px mỗi chiều)
//   3. Không lỗi JS (pageerror)
// và lưu ảnh chụp vào e2e/shots/<viewport>/<tên>.png để xem lại bằng mắt.
//
// Cần: backend e2e (node e2e/mockServer.js) ở :3000 và FE (vite preview) ở :5173.
// Chạy: node e2e/responsive-check.mjs   (PLAYWRIGHT_CHROME=/đường/dẫn/chrome nếu cần)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.join(here, ".seed.json"), "utf8"));
const BASE = process.env.FE_URL || "http://localhost:5173";
const API_HOST = new URL(process.env.API_URL || "http://localhost:3000").hostname;

const ALL_VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812, mobile: true },
  { name: "mobile-390", width: 390, height: 844, mobile: true },
  { name: "tablet-768", width: 768, height: 1024, mobile: true },
  { name: "laptop-1366", width: 1366, height: 768, mobile: false },
  { name: "desktop-1920", width: 1920, height: 1080, mobile: false },
];
// VIEWPORTS=mobile-375,laptop-1366 để chạy 1 phần.
const VIEWPORTS = process.env.VIEWPORTS
  ? ALL_VIEWPORTS.filter((v) => process.env.VIEWPORTS.split(",").includes(v.name))
  : ALL_VIEWPORTS;

const A = seed.albumId;
const ROUTES = [
  { name: "admin-login", url: "/admin/login", auth: "none" },
  { name: "admin-dashboard", url: "/admin/dashboard" },
  { name: "admin-clients", url: "/admin/clients" },
  { name: "admin-settings", url: "/admin/settings" },
  { name: "admin-albums", url: "/admin/albums" },
  { name: "admin-create-album", url: "/admin/albums/new" },
  { name: "admin-album-detail", url: `/admin/albums/${A}` },
  { name: "admin-album-detail-minor", url: `/admin/albums/${seed.minorAlbumId}` },
  { name: "admin-annotations", url: `/admin/albums/${A}/annotations` },
  { name: "admin-cull", url: `/admin/albums/${A}/cull` },
  { name: "admin-shows", url: "/admin/shows" },
  { name: "admin-show-detail", url: `/admin/shows/${seed.showId}` },
  { name: "admin-crew-submit", url: `/admin/shows/${seed.showId}/submit` },
  { name: "client-access", url: `/a/${A}`, auth: "none" },
  { name: "client-gallery", url: `/a/${A}/gallery` },
  { name: "client-liked", url: `/a/${A}/gallery?view=liked` },
  { name: "client-face-search", url: `/a/${A}/face-search` },
];

// Tương tác: mở modal/drawer rồi kiểm tra như 1 trang.
const INTERACTIONS = [
  {
    name: "client-lightbox",
    url: `/a/${A}/gallery`,
    async run(page, vp) {
      await page.getByRole("button", { name: /^Xem ảnh / }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await page.waitForTimeout(400);
      const checks = [];
      // L6 — dưới 768px: ảnh chiếm ≥ 60% chiều cao màn hình, sheet ghi chú thu gọn được.
      const header = await dialog.locator("header").boundingBox();
      const img = await dialog.locator("img").first().boundingBox();
      const stage = await dialog.locator("img").first().locator("xpath=ancestor::div[contains(@class,'min-h-[60dvh]')][1]").boundingBox();
      if (header && img && img.y < header.y + header.height - 1) checks.push("ảnh đè lên thanh tiêu đề");
      if (vp.width < 768) {
        if (!stage || stage.height < vp.height * 0.6 - 1) checks.push(`vùng ảnh cao ${stage?.height}px < 60% màn hình`);
        const toggle = dialog.getByRole("button", { name: /Ghi chú chỉnh sửa/ });
        await toggle.click();
        await page.waitForTimeout(250);
        if ((await toggle.getAttribute("aria-expanded")) !== "true") checks.push("sheet ghi chú không mở");
        const stageOpen = await dialog.locator("img").first().locator("xpath=ancestor::div[contains(@class,'min-h-[60dvh]')][1]").boundingBox();
        if (!stageOpen || stageOpen.height < vp.height * 0.6 - 1) checks.push(`mở sheet: vùng ảnh còn ${stageOpen?.height}px < 60%`);
        const sheetId = await toggle.getAttribute("aria-controls");
        if (!(await page.locator(`[id="${sheetId}"]`).isVisible())) checks.push("nội dung sheet ghi chú không hiển thị");
        // Sheet không được che thanh tiêu đề
        const sheetBox = await page.locator(`[id="${sheetId}"]`).boundingBox();
        if (header && sheetBox && sheetBox.y < header.y + header.height) checks.push("sheet đè lên thanh tiêu đề");
      }
      return checks;
    },
  },
  {
    name: "client-selection-limit",
    url: `/a/${A}/gallery`,
    async run(page) {
      const checks = [];
      const hearts = page.getByRole("button", { name: /^Chọn ảnh / });
      // Album seed: tối đa 5 ảnh, khách đã chọn 2 → chọn thêm 3 là đủ.
      for (let i = 0; i < 3; i += 1) {
        await hearts.first().click();
        await page.waitForTimeout(250);
      }
      const summary = await page.getByText(/Đã chọn 5 \/ 5 ảnh/).first().isVisible();
      if (!summary) checks.push("không thấy “Đã chọn 5 / 5 ảnh”");
      const toast = await page.getByRole("status").filter({ hasText: /Đã chọn đủ/ }).isVisible().catch(() => false);
      if (!toast) checks.push("không có toast khi chọn đủ");
      if (!(await hearts.first().isDisabled())) checks.push("nút tim chưa chọn không bị khoá khi đã đủ");
      // Hoàn nguyên để lần chạy viewport sau có cùng trạng thái.
      const selected = page.getByRole("button", { name: /^Bỏ chọn ảnh / });
      for (let i = 0; i < 3; i += 1) {
        await selected.last().click();
        await page.waitForTimeout(200);
      }
      return checks;
    },
  },
  {
    name: "client-complete-selection",
    url: `/a/${A}/gallery`,
    async run(page) {
      const checks = [];
      await page.getByRole("button", { name: "Gửi lựa chọn" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await sheet.getByRole("button", { name: "Gửi lựa chọn" }).click();
      await page.getByText("Đã gửi lựa chọn cho nhiếp ảnh gia").first().waitFor({ timeout: 5000 });
      const heart = page.getByRole("button", { name: /^(Chọn|Bỏ chọn) ảnh / }).first();
      if (!(await heart.isDisabled())) checks.push("nút tim chưa khoá sau khi gửi lựa chọn");
      await page.getByRole("button", { name: "Mở lại để chỉnh sửa" }).click();
      await page.getByRole("button", { name: "Gửi lựa chọn" }).waitFor({ timeout: 5000 });
      if (await heart.isDisabled()) checks.push("nút tim vẫn khoá sau khi mở lại");
      return checks;
    },
  },
  {
    name: "admin-client-sheet",
    url: "/admin/clients",
    async run(page) {
      const checks = [];
      await page.getByRole("button", { name: /Lê Minh Anh/ }).click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await sheet.getByText("HTA_4004 OR HTA_4007 OR HTA_4009").waitFor({ timeout: 5000 }).catch(() => checks.push("thiếu chuỗi tên file Lightroom"));
      await sheet.getByRole("radio", { name: "Đã TT" }).click();
      await sheet.getByRole("button", { name: "Lưu trạng thái" }).click();
      await sheet.getByRole("button", { name: "Đã lưu" }).waitFor({ timeout: 5000 }).catch(() => checks.push("không lưu được trạng thái thanh toán"));
      // Hoàn nguyên cho viewport sau.
      await sheet.getByRole("radio", { name: "Đặt cọc" }).click();
      await sheet.getByRole("button", { name: "Lưu trạng thái" }).click();
      await page.waitForTimeout(300);
      return checks;
    },
  },
  {
    name: "a11y-skiplink-focustrap",
    url: `/a/${A}/gallery`,
    async run(page, vp) {
      const checks = [];
      if (!vp.mobile) {
        await page.keyboard.press("Tab");
        const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
        if (first !== "Bỏ qua tới nội dung chính") checks.push(`Tab đầu tiên không vào skip link (${first})`);
      }
      await page.getByRole("button", { name: "Gửi lựa chọn" }).click();
      await page.getByRole("dialog").waitFor();
      for (let i = 0; i < 7; i += 1) await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")));
      if (!inside) checks.push("focus thoát khỏi action sheet khi nhấn Tab");
      await page.keyboard.press("Escape");
      return checks;
    },
  },
  {
    name: "admin-settings-unsaved-guard",
    url: "/admin/settings",
    async run(page) {
      const checks = [];
      const nameInput = page.getByLabel("Tên hiển thị");
      await nameInput.fill("Tên tạm chưa lưu");
      await page.getByRole("link", { name: /Bộ sưu tập|Album/ }).first().click();
      const sheet = page.getByRole("dialog", { name: /Bỏ các thay đổi chưa lưu/ });
      if (!(await sheet.isVisible().catch(() => false))) {
        await sheet.waitFor({ timeout: 2000 }).catch(() => checks.push("không cảnh báo khi rời trang còn thay đổi chưa lưu"));
      }
      await page.getByRole("button", { name: "Ở lại" }).click().catch(() => {});
      if (!page.url().includes("/admin/settings")) checks.push("bấm “Ở lại” nhưng vẫn rời trang");
      return checks;
    },
  },
  {
    name: "admin-edit-album-modal",
    url: `/admin/albums/${A}`,
    async run(page) {
      await page.getByRole("button", { name: /Cấu hình|Chỉnh sửa/ }).first().click();
      await page.getByRole("dialog").waitFor();
      const minor = page.getByRole("switch", { name: /dưới 18 tuổi/ });
      return (await minor.isVisible()) ? [] : ["không thấy công tắc album dưới 18 tuổi"];
    },
  },
  {
    name: "admin-create-minor-switch",
    url: "/admin/albums/new",
    async run(page) {
      const minor = page.getByRole("switch", { name: /dưới 18 tuổi/ });
      const label = page.getByText("Album có người dưới 18 tuổi (Tắt tìm kiếm khuôn mặt)");
      await label.scrollIntoViewIfNeeded();
      await label.click();
      return (await minor.isChecked()) ? [] : ["công tắc dưới 18 tuổi không bật được"];
    },
  },
];

async function inspect(page, vp) {
  return page.evaluate(({ mobile }) => {
    const issues = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth) {
      const culprits = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .filter((el) => getComputedStyle(el).position !== "fixed")
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
      issues.push(`tràn ngang: scrollWidth ${doc.scrollWidth} > ${window.innerWidth} (${culprits.join(" | ")})`);
    }
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      if (el.closest("[aria-hidden='true'], .sr-only")) return false;
      return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    };
    // Nếu có dialog đang mở, chỉ xét phần tử bên trong dialog (phía sau bị che là đúng).
    const dialogs = [...document.querySelectorAll("[role='dialog']")];
    const scope = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
    const els = [...scope.querySelectorAll("button, a[href], input:not([type='hidden']), select, textarea, [role='switch']")]
      .filter(visible)
      .filter((el) => !(el.matches("input") && el.classList.contains("sr-only")));
    const rects = els.map((el) => el.getBoundingClientRect());
    const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30);
    for (let i = 0; i < els.length; i += 1) {
      for (let j = i + 1; j < els.length; j += 1) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const a = rects[i];
        const b = rects[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox <= 4 || oy <= 4) continue;
        // Overlay có chủ đích (nút tim trên ảnh, header sticky trên nội dung đã cuộn): hợp lệ
        // nếu phần tử NHỎ hơn nằm trên cùng tại tâm của nó — vẫn nhìn thấy và bấm được. Lỗi
        // khi phần tử nhỏ bị che (bị phần tử khác/vùng cuộn đè lên).
        const [small, smallRect] = a.width * a.height <= b.width * b.height ? [els[i], a] : [els[j], b];
        const cx = Math.min(Math.max(smallRect.left + smallRect.width / 2, 0), window.innerWidth - 1);
        const cy = Math.min(Math.max(smallRect.top + smallRect.height / 2, 0), window.innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        const smallOnTop = top && (small === top || small.contains(top) || top.closest("label")?.contains(small));
        // Phần tử nhỏ đã cuộn ra ngoài khung của BẤT KỲ vùng cuộn/cắt nào chứa nó thì không
        // hiển thị — bỏ qua.
        let clipped = false;
        for (let p = small.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(o.overflowX + o.overflowY)) {
            const pr = p.getBoundingClientRect();
            if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) {
              clipped = true;
              break;
            }
          }
        }
        // Nội dung cuộn xuống dưới thanh cố định (thanh tab, thanh hành động, header sticky)
        // là hành vi bình thường — người dùng cuộn tiếp để thấy. Chỉ áp dụng khi phần tử nhỏ
        // KHÔNG nằm trong chính thanh cố định đó.
        const fixedBar = top?.closest("nav, header, [data-fixed-bar]");
        const barPos = fixedBar ? getComputedStyle(fixedBar).position : "";
        const underFixedBar = fixedBar && (barPos === "fixed" || barPos === "sticky") && !fixedBar.contains(small);
        if (underFixedBar) clipped = true;
        if (!smallOnTop && !clipped) issues.push(`đè nhau: "${label(els[i])}" × "${label(els[j])}"`);
      }
    }
    // Vùng chạm < 44px chỉ thống kê (cảnh báo), không tính lỗi: link trong đoạn văn là hợp lệ.
    const smallTargets = mobile
      ? els.filter((el, k) => !el.closest("p") && (rects[k].height < 40 || rects[k].width < 40)).length
      : 0;
    return { issues: [...new Set(issues)].slice(0, 8), smallTargets };
  }, { mobile: vp.mobile });
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
  channel: process.env.PLAYWRIGHT_CHROME ? undefined : "chrome",
});

const report = [];
for (const vp of VIEWPORTS) {
  const shotDir = path.join(here, "shots", vp.name);
  fs.mkdirSync(shotDir, { recursive: true });
  for (const auth of ["admin+client", "none"]) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: vp.mobile && vp.width < 768,
      hasTouch: vp.mobile,
      locale: "vi-VN",
      reducedMotion: "reduce",
    });
    if (auth !== "none") {
      await context.addCookies([
        { name: "session_token", value: seed.adminToken, domain: API_HOST, path: "/" },
        { name: "client_session_token", value: seed.clientToken, domain: API_HOST, path: "/" },
      ]);
    }
    const jobs = [
      ...ROUTES.filter((r) => (r.auth === "none") === (auth === "none")).map((r) => ({ ...r, kind: "route" })),
      ...(auth === "none" ? [] : INTERACTIONS.map((i) => ({ ...i, kind: "interaction" }))),
    ];
    for (const job of jobs) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 120)}`));
      let issues = [];
      let smallTargets = 0;
      try {
        await page.goto(BASE + job.url, { waitUntil: "networkidle", timeout: 20000 });
        await page.waitForTimeout(500);
        if (job.kind === "interaction") {
          issues.push(...(await job.run(page, vp)));
          // Đưa trang về trạng thái tĩnh trước khi đo: đóng toast, cuộn về đầu.
          await page.getByRole("button", { name: "Đóng thông báo" }).click().catch(() => {});
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(200);
        }
        const result = await inspect(page, vp);
        issues.push(...result.issues);
        smallTargets = result.smallTargets;
        await page.screenshot({ path: path.join(shotDir, `${job.name}.png`), fullPage: job.kind === "route" });
      } catch (e) {
        issues.push(`không chạy được: ${e.message.split("\n")[0].slice(0, 140)}`);
      }
      issues.push(...errors);
      report.push({ viewport: vp.name, page: job.name, ok: issues.length === 0, issues, smallTargets });
      await page.close();
    }
    await context.close();
  }
}
await browser.close();

fs.writeFileSync(path.join(here, `responsive-report${process.env.VIEWPORTS ? "-" + process.env.VIEWPORTS.replace(/,/g, "_") : ""}.json`), JSON.stringify(report, null, 2));
const failed = report.filter((r) => !r.ok);
for (const vp of VIEWPORTS) {
  const rows = report.filter((r) => r.viewport === vp.name);
  console.log(`${vp.name.padEnd(13)} ${rows.filter((r) => r.ok).length}/${rows.length} pass`);
}
for (const f of failed) console.log(`FAIL ${f.viewport} ${f.page}: ${f.issues.join("; ")}`);
process.exit(failed.length ? 1 : 0);
