-- AI Face Search — nâng cấp model nhận diện khuôn mặt từ face-api.js (128 chiều, so bằng
-- khoảng cách L2) sang InsightFace ArcFace (w600k_mbf, 512 chiều, đã chuẩn hóa L2, so bằng
-- cosine distance) — xem src/services/arcfaceService.js.
--
-- Embedding 128 chiều cũ thuộc không gian vector khác hoàn toàn, không thể chuyển đổi hay
-- dùng lại → xóa sạch. Sau khi chạy migration này, chạy `npm run reindex:faces` để trích lại
-- embedding cho toàn bộ ảnh đã upload (tải lại ảnh gốc từ Drive), nếu không AI Face Search
-- của các album hiện có sẽ không tìm được ảnh nào.
BEGIN;

TRUNCATE TABLE photo_face_embeddings;

DROP INDEX IF EXISTS idx_face_embedding_ann;
ALTER TABLE photo_face_embeddings ALTER COLUMN embedding TYPE vector(512);

-- Vector đã chuẩn hóa L2 → cosine distance (<=>) là metric chuẩn của ArcFace.
-- m / ef_construction = mặc định khuyến nghị của pgvector.
CREATE INDEX idx_face_embedding_ann
    ON photo_face_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

COMMIT;
