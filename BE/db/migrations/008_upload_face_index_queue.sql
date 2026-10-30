-- Upload nhanh + Face Search cho ảnh tập thể:
--   - face_index_status/face_index_attempts: trích embedding khuôn mặt chuyển sang chạy NỀN
--     sau khi upload trả lời xong (src/services/faceIndexQueue.js) — trạng thái lưu trong DB
--     để server khởi động lại vẫn chạy tiếp các ảnh còn dở, và ảnh lỗi được thử lại.
--     Ảnh đã có từ trước đều đã trích embedding ngay lúc upload → mặc định 'done'.
--   - client_upload_id: mã do trình duyệt sinh cho mỗi ảnh, giữ nguyên qua các lần thử lại —
--     request thứ 2 cùng mã (mất mạng lúc chờ phản hồi rồi thử lại) trả về ảnh đã tạo thay vì
--     upload trùng.
--   - idx_photos_album_order: album sắp theo giờ chụp, thiếu giờ chụp thì theo tên file.
BEGIN;

ALTER TABLE photos
    ADD COLUMN face_index_status TEXT NOT NULL DEFAULT 'done'
        CHECK (face_index_status IN ('pending', 'done', 'failed')),
    ADD COLUMN face_index_attempts SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN client_upload_id UUID;

CREATE UNIQUE INDEX idx_photos_client_upload
    ON photos (album_id, client_upload_id)
    WHERE client_upload_id IS NOT NULL;

CREATE INDEX idx_photos_face_index_pending
    ON photos (face_index_status)
    WHERE face_index_status = 'pending';

CREATE INDEX idx_photos_album_order
    ON photos (album_id, captured_at, original_base_filename);

COMMIT;
