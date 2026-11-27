-- Hoàn thiện các chức năng đã chốt trong tài liệu gốc nhưng chưa có chỗ lưu:
--   1) Khách "xác nhận hoàn tất chọn ảnh" (mục 5.2): bảng album_client_completions đã có trong
--      lensproof_schema.sql từ đầu — tạo nếu DB cũ chưa có, thêm index tra theo thời gian.
--   2) PTG tự đánh dấu trạng thái thanh toán thủ công (mục 3.2 — KHÔNG tích hợp cổng thanh toán):
--      clients.payment_status / payment_note.
--   3) Cài đặt mặc định khi tạo album của từng PTG: photographers.settings (JSONB).
--   4) photographers.status (active/suspended) — chuẩn bị sẵn theo Quyet_dinh_Super_Admin_Portal.md,
--      chưa có UI nào dùng.
BEGIN;

CREATE TABLE IF NOT EXISTS album_client_completions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id      UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
    completed_at   TIMESTAMPTZ,
    auto_locked    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_completions_completed_at
    ON album_client_completions (completed_at DESC) WHERE completed_at IS NOT NULL;

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'deposit', 'paid')),
    ADD COLUMN IF NOT EXISTS payment_note TEXT
        CHECK (payment_note IS NULL OR char_length(payment_note) <= 500),
    ADD COLUMN IF NOT EXISTS payment_updated_at TIMESTAMPTZ;

ALTER TABLE photographers
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(settings) = 'object'),
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_selections_client ON selections (client_id);

COMMIT;
