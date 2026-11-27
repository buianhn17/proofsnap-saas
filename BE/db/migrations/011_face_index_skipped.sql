-- L7 (FR-05 & NFR-03) — album có người dưới 18 tuổi (albums.is_minor_album = true) KHÔNG trích
-- embedding khuôn mặt (tối thiểu hoá dữ liệu sinh trắc học, Luật Bảo vệ dữ liệu cá nhân
-- 91/2025/QH15). Thêm trạng thái 'skipped' để phân biệt "cố ý không trích" với 'done' (đã
-- trích xong) — nếu PTG tắt cờ vị thành niên sau này, chỉ các ảnh 'skipped' được đưa lại vào
-- hàng đợi trích embedding.
BEGIN;

ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_face_index_status_check;
ALTER TABLE photos
    ADD CONSTRAINT photos_face_index_status_check
        CHECK (face_index_status IN ('pending', 'done', 'failed', 'skipped'));

-- Album đã đánh dấu vị thành niên từ trước: xoá embedding đã trích (nếu có) và đánh dấu bỏ qua.
DELETE FROM photo_face_embeddings e
USING photos p, albums a
WHERE e.photo_id = p.id AND p.album_id = a.id AND a.is_minor_album = true;

UPDATE photos p SET face_index_status = 'skipped'
FROM albums a
WHERE p.album_id = a.id AND a.is_minor_album = true;

COMMIT;
