const pool = require("../config/db");

function toVectorLiteral(embedding) {
  return `[${embedding.join(",")}]`;
}

// Bước 3.2 — lưu embedding của mọi khuôn mặt phát hiện được trong 1 ảnh (0, 1, hoặc nhiều
// khuôn mặt). Chạy trong 1 transaction vì luôn ghi theo lô cho 1 photo_id.
async function createEmbeddingsForPhoto(photoId, faces) {
  if (faces.length === 0) return [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = [];
    for (const face of faces) {
      const result = await client.query(
        `INSERT INTO photo_face_embeddings (photo_id, bbox_x, bbox_y, bbox_w, bbox_h, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)
         RETURNING id, photo_id, bbox_x, bbox_y, bbox_w, bbox_h, created_at`,
        [photoId, face.bbox.x, face.bbox.y, face.bbox.w, face.bbox.h, toVectorLiteral(face.embedding)]
      );
      rows.push(result.rows[0]);
    }
    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Bước 3.3 — tìm ảnh trong 1 album có khuôn mặt gần nhất với embedding selfie, theo cosine
// distance (đúng op class của index HNSW — idx_face_embedding_ann dùng vector_cosine_ops).
// DISTINCT ON (p.id) vì 1 ảnh có thể có nhiều khuôn mặt/nhiều embedding khớp — chỉ giữ
// khoảng cách gần nhất mỗi ảnh, sort theo photo_id trước rồi distance để DISTINCT ON hoạt
// động đúng, cuối cùng sort lại theo distance cho kết quả trả về.
async function findMatchingPhotos({ albumId, embedding, maxDistance, limit }) {
  const result = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (p.id)
         p.id, p.original_base_filename, p.width, p.height, p.created_at,
         p.burst_cluster_id, p.is_best_in_cluster,
         (fe.embedding <=> $2::vector) AS distance
       FROM photo_face_embeddings fe
       JOIN photos p ON p.id = fe.photo_id
       WHERE p.album_id = $1
       ORDER BY p.id, fe.embedding <=> $2::vector ASC
     ) matched
     WHERE distance < $3
     ORDER BY distance ASC
     LIMIT $4`,
    [albumId, toVectorLiteral(embedding), maxDistance, limit]
  );
  return result.rows;
}

module.exports = { createEmbeddingsForPhoto, findMatchingPhotos };
