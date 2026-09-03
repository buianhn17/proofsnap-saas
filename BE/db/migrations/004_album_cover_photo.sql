-- Cho phép PTG chọn 1 ảnh đã upload trong album làm ảnh đại diện (cover), hiển thị ở
-- card album trong Danh sách bộ sưu tập. ON DELETE SET NULL vì xóa ảnh gốc không nên
-- chặn được (album chỉ rơi về lại placeholder chữ cái).
ALTER TABLE albums ADD COLUMN IF NOT EXISTS cover_photo_id UUID REFERENCES photos(id) ON DELETE SET NULL;
