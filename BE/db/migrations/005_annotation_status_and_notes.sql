-- Trang "Yêu cầu chỉnh sửa" mới (xem từng ảnh + sidebar trạng thái) cần: (1) đánh dấu từng
-- yêu cầu (annotation) của khách là pending/done, và (2) ghi chú nội bộ của PTG hoặc phản hồi
-- gửi khách theo từng ảnh — cả hai đều chưa có chỗ lưu trước đây (annotations trước giờ chỉ
-- đọc, không có trạng thái xử lý).
ALTER TABLE annotations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'done'));

CREATE TABLE IF NOT EXISTS photo_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  photographer_id UUID NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  -- 'internal' = ghi chú riêng của PTG; 'client_reply' = phản hồi gửi khách (Client Portal
  -- chưa hiển thị loại này — lưu sẵn cho bước sau).
  kind TEXT NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal', 'client_reply')),
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_notes_photo ON photo_notes(photo_id);
