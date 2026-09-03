-- Giai đoạn 3 — AI Face Search.
--
-- 1) Model thực tế dùng để trích embedding là face-api.js (FaceRecognitionNet, chạy
--    server-side qua @vladmandic/face-api + @tensorflow/tfjs-node) — descriptor 128 chiều,
--    không phải 512 như placeholder ban đầu trong lensproof_schema.sql mục 7 (file đó đã
--    ghi chú "số chiều tùy model thực tế dùng, chỉnh lại cho khớp"). Bảng
--    photo_face_embeddings hiện chưa có dữ liệu (tính năng chưa từng được build) nên an
--    toàn để đổi thẳng kiểu cột thay vì migrate dữ liệu cũ.
DROP INDEX IF EXISTS idx_face_embedding_ann;
ALTER TABLE photo_face_embeddings ALTER COLUMN embedding TYPE vector(128);
CREATE INDEX idx_face_embedding_ann
    ON photo_face_embeddings USING hnsw (embedding vector_cosine_ops);

-- 2) Log bằng chứng đồng ý xử lý dữ liệu sinh trắc học (Bước 3.1) — tách bảng riêng thay
--    vì ghi đè lên clients.face_search_consent_at thay vì chỉ vì clients.face_search_consent_at
--    chỉ giữ được 1 mốc thời gian (lần đồng ý đầu tiên, dùng làm gate nhanh khi kiểm tra
--    quyền truy cập tính năng — xem clientModel.js). Bảng này append-only, lưu lại MỌI lần
--    khách xác nhận đồng ý (kể cả xác nhận lại) kèm IP/user-agent để có bằng chứng tuân thủ
--    nếu cần đối chiếu sau này (mục 9.1 lensproof_schema.sql).
CREATE TABLE face_search_consent_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_face_search_consent_logs_client ON face_search_consent_logs(client_id);
