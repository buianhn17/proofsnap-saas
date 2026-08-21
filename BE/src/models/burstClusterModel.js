const pool = require("../config/db");

// Bước 2.3 (nền) — tạo hàng loạt burst cluster. sceneId có thể null (ảnh lẻ không thuộc
// buổi chụp nào xác định được). Giữ nguyên thứ tự trả về khớp mảng input, cùng lý do với
// sceneModel.createScenes.
async function createBurstClusters(entries) {
  const created = [];
  for (const entry of entries) {
    const result = await pool.query(
      `INSERT INTO burst_clusters (scene_id) VALUES ($1) RETURNING id, scene_id, best_photo_id`,
      [entry.sceneId ?? null]
    );
    created.push(result.rows[0]);
  }
  return created;
}

// scene_id trên burst_clusters có thể NULL, nên không thể join trực tiếp ra album_id —
// xác thực quyền sở hữu qua scene (nếu có) hoặc bỏ qua nếu cluster không gắn scene nào
// (khi đó việc sở hữu được đảm bảo gián tiếp qua chính photo sẽ gắn vào nó ở bước upload).
async function findByIdWithScene(burstClusterId) {
  const result = await pool.query(
    `SELECT bc.id, bc.scene_id, bc.best_photo_id, s.album_id AS scene_album_id
     FROM burst_clusters bc
     LEFT JOIN scenes s ON s.id = bc.scene_id
     WHERE bc.id = $1`,
    [burstClusterId]
  );
  return result.rows[0] || null;
}

async function setBestPhoto(burstClusterId, photoId) {
  await pool.query("UPDATE burst_clusters SET best_photo_id = $1 WHERE id = $2", [
    photoId,
    burstClusterId,
  ]);
}

module.exports = { createBurstClusters, findByIdWithScene, setBestPhoto };
