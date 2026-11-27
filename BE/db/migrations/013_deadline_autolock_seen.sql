-- 1) photographers.clients_seen_at: mốc PTG mở trang Khách hàng lần cuối — để hiện huy hiệu số
--    khách MỚI gửi lựa chọn (thông báo trong app, mục 5.2 "hệ thống gửi thông báo cho PTG").
-- 2) Index phục vụ job tự khoá album quá hạn (src/services/deadlineJob.js).
BEGIN;

ALTER TABLE photographers ADD COLUMN IF NOT EXISTS clients_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_albums_unlocked_deadline
    ON albums (selection_deadline)
    WHERE is_locked = false AND selection_deadline IS NOT NULL;

COMMIT;
