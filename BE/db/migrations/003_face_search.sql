-- Giai đoạn 3 — AI Face Search.
--
-- 1) [lịch sử] Model thực tế dùng để trích embedding là face-api.js (FaceRecognitionNet, chạy
--    server-side qua @vladmandic/face-api + @tensorflow/tfjs-node) — descriptor 128 chiều,
--    không phải 512 như placeholder ban đầu trong lensproof_schema.sql mục 7 (file đó đã
--    ghi chú "số chiều tùy model thực tế dùng, chỉnh lại cho khớp"). Bảng
--    photo_face_embeddings hiện chưa có dữ liệu (tính năng chưa từng được build) nên an
--    toàn để đổi thẳng kiểu cột thay vì migrate dữ liệu cũ.
-- (Đã bỏ) Bản đầu của migration này đổi photo_face_embeddings.embedding sang vector(128)
--    cho face-api.js. Bước đó đã bị 007_upgrade_to_arcface_512.sql thay thế hoàn toàn
--    (ArcFace 512 chiều) và lensproof_schema.sql đã khai báo sẵn VECTOR(512) — giữ lại thì
--    DB mới tạo sẽ bị đổi 512 → 128 rồi lại → 512 (và TRUNCATE) vô ích. Trạng thái cuối giống
--    hệt nên bỏ bước đổi kiểu, chỉ giữ phần bảng log đồng ý bên dưới.

-- 2) Log bằng chứng đồng ý xử lý dữ liệu sinh trắc học (Bước 3.1) — tách bảng riêng thay
--    vì ghi đè lên clients.face_search_consent_at thay vì chỉ vì clients.face_search_consent_at
--    chỉ giữ được 1 mốc thời gian (lần đồng ý đầu tiên, dùng làm gate nhanh khi kiểm tra
--    quyền truy cập tính năng — xem clientModel.js). Bảng này append-only, lưu lại MỌI lần
--    khách xác nhận đồng ý (kể cả xác nhận lại) kèm IP/user-agent để có bằng chứng tuân thủ
--    nếu cần đối chiếu sau này (mục 9.1 lensproof_schema.sql).
CREATE TABLE IF NOT EXISTS face_search_consent_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_face_search_consent_logs_client ON face_search_consent_logs(client_id);
