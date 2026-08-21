const pool = require("../config/db");

// Bước 2.3 (nền) — tạo hàng loạt scene cho 1 album, dùng khi Admin đưa ảnh đã qua AI
// Culling (gom buổi chụp ở FE, xem AlbumCullPage.tsx) sang bước upload thật. Insert tuần tự
// trong 1 vòng lặp (không phải bulk INSERT nhiều dòng) để giữ đúng thứ tự trả về khớp với
// mảng input — FE cần map lại id tạm (ephemeral, tính lúc phân tích) sang UUID thật theo
// đúng vị trí index.
async function createScenes(albumId, scenes) {
  const created = [];
  for (const scene of scenes) {
    const result = await pool.query(
      `INSERT INTO scenes (album_id, label, started_at, ended_at, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, album_id, label, started_at, ended_at, sort_order`,
      [albumId, scene.label ?? null, scene.startedAt ?? null, scene.endedAt ?? null, scene.sortOrder ?? 0]
    );
    created.push(result.rows[0]);
  }
  return created;
}

async function findByIdAndAlbum(sceneId, albumId) {
  const result = await pool.query(
    "SELECT id, album_id FROM scenes WHERE id = $1 AND album_id = $2",
    [sceneId, albumId]
  );
  return result.rows[0] || null;
}

module.exports = { createScenes, findByIdAndAlbum };
