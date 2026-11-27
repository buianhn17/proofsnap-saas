// Migration runner (L2) — chạy tự động khi backend khởi động (src/index.js).
//
// - Theo dõi các file db/migrations/NNN_*.sql đã áp dụng trong bảng schema_migrations.
// - Mỗi migration chạy trong 1 transaction riêng (các lệnh BEGIN;/COMMIT; ở đầu/cuối file
//   được bỏ đi để runner tự bọc transaction, ghi schema_migrations cùng transaction đó).
// - pg_advisory_lock: 2 instance backend khởi động cùng lúc không chạy chồng migration.
// - "Baseline": DB tạo trước khi có runner (docker-compose nạp lensproof_schema.sql, hoặc
//   PTG đã chạy tay migration bằng psql) đã có sẵn thay đổi của một số migration. Mỗi
//   migration có 1 truy vấn kiểm tra (probe); nếu thay đổi đã có sẵn thì chỉ ghi nhận là đã
//   áp dụng (baselined = true) mà KHÔNG chạy lại — tránh lỗi "already exists" và tránh chạy
//   lại thao tác phá dữ liệu (VD 007 TRUNCATE embedding).
// - 001_initial_schema.sql dùng lệnh psql `\ir` để nạp lensproof_schema.sql: runner tự thay
//   bằng nội dung file đó (driver pg không hiểu meta-command của psql).

const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./db");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "db", "migrations");
const DB_DIR = path.join(__dirname, "..", "..", "db");
// Khoá advisory cố định cho runner (số bất kỳ, chỉ cần không trùng khoá khác của app).
const ADVISORY_LOCK_KEY = 7_400_210;

const columnExists = (table, column) => ({
  text: `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2
         ) AS applied`,
  values: [table, column],
});

const tableExists = (table) => ({
  text: "SELECT to_regclass($1) IS NOT NULL AS applied",
  values: [table],
});

// Truy vấn trả về 1 dòng { applied: boolean } — true nếu thay đổi của migration đã có sẵn.
const PROBES = {
  "001": () => tableExists("albums"),
  "002": () => columnExists("annotations", "path_pct"),
  "003": () => tableExists("face_search_consent_logs"),
  "004": () => columnExists("albums", "cover_photo_id"),
  "005": () => ({
    text: `SELECT to_regclass('photo_notes') IS NOT NULL AND EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'annotations' AND column_name = 'status'
           ) AS applied`,
  }),
  // Đã là vector(512) → không chạy lại (migration này TRUNCATE embedding).
  "007": () => ({
    text: `SELECT COALESCE((
             SELECT a.atttypmod = 512 FROM pg_attribute a
             WHERE a.attrelid = to_regclass('photo_face_embeddings') AND a.attname = 'embedding'
           ), false) AS applied`,
  }),
  "008": () => columnExists("photos", "face_index_status"),
  "009": () => tableExists("studio_shows"),
  "010": () => columnExists("show_members", "role_type"),
  "012": () => columnExists("clients", "payment_status"),
  "013": () => columnExists("photographers", "clients_seen_at"),
  "011": () => ({
    text: `SELECT EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conrelid = to_regclass('photos') AND contype = 'c'
               AND pg_get_constraintdef(oid) LIKE '%skipped%'
           ) AS applied`,
  }),
};

function versionOf(filename) {
  return filename.split("_")[0];
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b));
}

// `\ir /docker-entrypoint-initdb.d/03-lensproof_schema.sql` → nội dung db/lensproof_schema.sql
async function resolvePsqlIncludes(sql) {
  const lines = sql.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const match = line.match(/^\s*\\i[r]?\s+(\S+)\s*$/);
    if (!match) {
      out.push(line);
      continue;
    }
    const base = path.basename(match[1]).replace(/^\d+-/, "");
    out.push(await fs.readFile(path.join(DB_DIR, base), "utf8"));
  }
  return out.join("\n");
}

function stripOuterTransaction(sql) {
  return sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, "");
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,
      baselined   BOOLEAN NOT NULL DEFAULT false,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(client) {
  const result = await client.query("SELECT version FROM schema_migrations");
  return new Set(result.rows.map((row) => row.version));
}

/**
 * Áp dụng mọi migration còn thiếu. Trả về { applied: [...], baselined: [...] }.
 * @param {{ logger?: Pick<Console, "log"> }} [options]
 */
async function runMigrations({ logger = console } = {}) {
  const client = await pool.connect();
  const summary = { applied: [], baselined: [] };
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await ensureMigrationsTable(client);
    const done = await appliedVersions(client);

    for (const filename of await listMigrationFiles()) {
      const version = versionOf(filename);
      if (done.has(version)) continue;

      const probe = PROBES[version];
      if (probe) {
        const { rows } = await client.query(probe());
        if (rows[0]?.applied) {
          await client.query(
            "INSERT INTO schema_migrations (version, filename, baselined) VALUES ($1, $2, true)",
            [version, filename]
          );
          summary.baselined.push(filename);
          continue;
        }
      }

      const raw = await fs.readFile(path.join(MIGRATIONS_DIR, filename), "utf8");
      const sql = stripOuterTransaction(await resolvePsqlIncludes(raw));
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)",
          [version, filename]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        error.message = `Migration ${filename} thất bại: ${error.message}`;
        throw error;
      }
      summary.applied.push(filename);
      logger.log(`Đã áp dụng migration ${filename}`);
    }
    return summary;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/** Trạng thái schema cho GET /api/health. Không tạo bảng, không giữ khoá. */
async function getSchemaStatus() {
  const files = await listMigrationFiles();
  const exists = await pool.query("SELECT to_regclass('schema_migrations') IS NOT NULL AS ok");
  const appliedRows = exists.rows[0].ok
    ? (await pool.query("SELECT version, filename FROM schema_migrations ORDER BY version")).rows
    : [];
  const applied = new Set(appliedRows.map((row) => row.version));
  const pending = files.filter((name) => !applied.has(versionOf(name)));
  return {
    up_to_date: pending.length === 0,
    applied_count: appliedRows.length,
    latest: appliedRows.length ? appliedRows[appliedRows.length - 1].filename : null,
    pending,
  };
}

module.exports = { runMigrations, getSchemaStatus, MIGRATIONS_DIR };
