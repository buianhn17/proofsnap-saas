// Trích lại embedding khuôn mặt (ArcFace 512 chiều) cho các ảnh đã upload — bắt buộc chạy
// sau migration 007_upgrade_to_arcface_512.sql (migration đó xóa sạch embedding 128 chiều
// cũ của face-api.js). Tải lại ảnh từ Drive của từng photographer, chạy arcfaceService rồi
// ghi đè embedding của ảnh đó. Chạy lại an toàn (idempotent) nếu bị ngắt giữa chừng.
//
//   npm run reindex:faces                 # mọi ảnh của mọi album
//   npm run reindex:faces -- <albumId>    # chỉ 1 album
require("dotenv").config();

const pool = require("../src/config/db");
const photoFaceEmbeddingModel = require("../src/models/photoFaceEmbeddingModel");
const { detectFaces } = require("../src/services/arcfaceService");
const { downloadFileBuffer } = require("../src/services/googleDriveService");

async function listPhotos(albumId) {
  const result = await pool.query(
    `SELECT p.id, p.drive_file_id, a.photographer_id
     FROM photos p
     JOIN albums a ON a.id = p.album_id
     WHERE ($1::uuid IS NULL OR p.album_id = $1)
     ORDER BY p.album_id, p.created_at`,
    [albumId]
  );
  return result.rows;
}

async function main() {
  const albumId = process.argv[2] || null;
  const photos = await listPhotos(albumId);
  console.log(`Trích lại embedding cho ${photos.length} ảnh...`);

  let faceCount = 0;
  const failures = [];
  for (const [index, photo] of photos.entries()) {
    try {
      const buffer = await downloadFileBuffer(photo.photographer_id, photo.drive_file_id);
      const faces = await detectFaces(buffer);
      await photoFaceEmbeddingModel.createEmbeddingsForPhoto(photo.id, faces, {
        replaceExisting: true,
      });
      faceCount += faces.length;
    } catch (err) {
      // 1 ảnh lỗi (file Drive bị xóa, token hết hạn...) không được dừng cả lượt chạy.
      failures.push(photo.id);
      console.error(`Lỗi ở photo ${photo.id}:`, err.message);
    }
    if ((index + 1) % 20 === 0 || index + 1 === photos.length) {
      console.log(`  ${index + 1}/${photos.length} ảnh, ${faceCount} khuôn mặt`);
    }
  }

  console.log(`Xong: ${faceCount} khuôn mặt, ${failures.length} ảnh lỗi.`);
  if (failures.length > 0) {
    console.log(`Ảnh lỗi (chạy lại script để thử lại): ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Reindex thất bại:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
