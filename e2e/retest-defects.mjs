// Re-test L2–L8 trên backend e2e (mockServer.js) — in bảng kết quả ra console.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const BE = path.resolve("BE");
require(path.join(BE, "node_modules/dotenv")).config({ path: path.join(BE, ".env") });
const jwt = require(path.join(BE, "node_modules/jsonwebtoken"));
const { Pool } = require(path.join(BE, "node_modules/pg"));
const seed = JSON.parse(fs.readFileSync("e2e/.seed.json", "utf8"));
const API = "http://localhost:3000";
const A = seed.albumId, M = seed.minorAlbumId;
const admin = `session_token=${seed.adminToken}`;
const client = `client_session_token=${seed.clientToken}`;
const tok = (name, phone) => `client_session_token=${jwt.sign({ role: "client", albumId: M, clientName: name, clientPhone: phone }, process.env.JWT_SECRET)}`;
const stamp = String(Date.now()).slice(-6);
const minorClient = tok("Phụ huynh A", "0944" + stamp);
const adultDeclared = tok("Phụ huynh B", "0955" + stamp);
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const rows = [];
const log = (id, name, expected, actual, pass) => rows.push({ id, name, expected, actual, pass });
async function call(method, p, cookie, body) {
  const r = await fetch(API + p, { method, headers: { Cookie: cookie || "", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : null;
  return { s: r.status, data, h: r.headers };
}

// L2 — migration runner
{ const r = await call("GET", "/api/health");
  const sc = r.data.schema;
  log("L2", "Schema migrated at start-up", "up_to_date, latest 013", `${sc.up_to_date ? "up_to_date" : "pending"}, latest ${sc.latest.slice(0, 3)}`, sc.up_to_date && sc.latest.startsWith("013")); }
// L3 — CORP header on image responses
{ const photos = (await call("GET", `/api/public/albums/${A}/photos`, client)).data.photos;
  const r = await fetch(`${API}/api/public/albums/${A}/photos/${photos[0].id}/view?size=thumbnail`, { headers: { Cookie: client } });
  const corp = r.headers.get("cross-origin-resource-policy");
  log("L3", "Image response carries CORP", "same-site", `${r.status} CORP=${corp}`, corp === "same-site"); }
// L4 — malformed UUID
{ const a = await call("GET", "/api/albums/abc", admin);
  log("L4", "ALB-13: GET /api/albums/abc", "404", `${a.s} ${a.data?.error ?? ""}`, a.s === 404);
  const c = await call("GET", "/api/public/albums/abc", client);
  log("L4", "CLI-14: GET /api/public/albums/abc", "404", `${c.s} ${c.data?.error ?? ""}`, c.s === 404); }
// L5 — selection limit (limit 5, khách đã chọn 2) — 6 request song song
{ const list = (await call("GET", `/api/public/albums/${A}/photos`, client)).data.photos;
  const free = list.filter((p) => !p.selected && !p.is_selected).slice(0, 6);
  const res = await Promise.all(free.map((p) => call("POST", `/api/public/albums/${A}/photos/${p.id}/select`, client)));
  const ok = res.filter((r) => r.s === 200).length, conflict = res.filter((r) => r.s === 409).length;
  const count = Math.max(...res.filter((r) => r.s === 200).map((r) => r.data.selected_count));
  log("L5", "SEL-05: 6 parallel selects, 3 free slots", "3×200, 3×409, total 5", `${ok}×200, ${conflict}×409, total ${count}`, ok === 3 && conflict === 3 && count === 5);
  const code = res.find((r) => r.s === 409)?.data?.error;
  log("L5", "Error code when the quota is full", "SELECTION_LIMIT_REACHED", String(code), code === "SELECTION_LIMIT_REACHED");
  for (const [i, r] of res.entries()) if (r.s === 200) await call("POST", `/api/public/albums/${A}/photos/${free[i].id}/select`, client); }
// L7 — minor album
{ const r = await call("POST", `/api/public/albums/${M}/face-search/consent`, minorClient, { agree: true });
  log("L7", "Face consent in a minor album", "403 ..._MINOR", `${r.s} ${r.data?.error ?? ""}`, r.s === 403 && r.data?.error === "FACE_SEARCH_DISABLED_MINOR");
  const r2 = await call("POST", `/api/public/albums/${M}/face-search/consent`, adultDeclared, { agree: true, is_minor: false });
  log("L9", "Same, client declares \"over 18\"", "403 ..._MINOR", `${r2.s} ${r2.data?.error ?? (r2.data?.consented ? "consented" : "")}`, r2.s === 403);
  const q = await db.query(`SELECT count(*) FILTER (WHERE p.face_index_status='skipped')::int AS skipped, count(fe.*)::int AS emb
                            FROM photos p LEFT JOIN photo_face_embeddings fe ON fe.photo_id=p.id WHERE p.album_id=$1`, [M]);
  log("L7", "Embeddings stored for the minor album", "0 embedding", `${q.rows[0].emb} embedding, ${q.rows[0].skipped} photos skipped`, q.rows[0].emb === 0); }
// L8 — PIN brute force
{ const statuses = [];
  for (let i = 0; i < 10; i += 1) statuses.push((await call("POST", `/api/public/albums/${A}/verify-pin`, "", { pin: "0000", name: "Kẻ dò PIN", phone: "0900000000" })).s);
  log("L8", "CLI-15: 10 wrong PINs", "9×401 then 429", `${statuses.slice(0, 9).every((s) => s === 401) ? "9×401" : statuses.join(",")} then ${statuses[9]}`, statuses[9] === 429);
  const r = await fetch(`${API}/api/public/albums/${A}/verify-pin`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "1234", name: "Kẻ dò PIN", phone: "0900000000" }) });
  log("L8", "Correct PIN during the lock", "429 + Retry-After", `${r.status} Retry-After=${r.headers.get("retry-after")}`, r.status === 429 && Number(r.headers.get("retry-after")) > 0); }
await db.end();

const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
console.log(`Re-test of L2–L9 — ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh" })} — e2e backend :3000\n`);
console.log(pad("ID", 4), pad("Case", 42), pad("Expected", 24), pad("Actual", 33), "Result");
console.log("-".repeat(108));
for (const r of rows) console.log(pad(r.id, 4), pad(r.name, 42), pad(r.expected, 24), pad(r.actual, 33), r.pass ? "PASS" : "FAIL");
console.log("-".repeat(108));
console.log(`${rows.filter((r) => r.pass).length}/${rows.length} pass`);
