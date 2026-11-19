-- Editor (hậu kỳ) tham gia show bằng cùng mã mời với thợ chụp/quay.
--
--   show_members: nâng cấp bảng có sẵn từ 009 (KHÔNG tạo lại — giữ thành viên đã tham gia):
--     + id riêng làm khoá chính, crew_user_id → user_id, thêm role_type ('crew' | 'editor').
--     + UNIQUE (show_id, user_id): 1 người 1 vai trò trong 1 show. show_submissions vẫn
--       tham chiếu cặp này để bảo đảm chỉ thành viên mới nộp được.
--   show_submissions:
--     + crew_type thêm 'retouch' — Editor nộp link thư mục ảnh đã hậu kỳ.
--     + is_on_time_24h = NULL với bài 'retouch' (hạn 24h chỉ áp dụng file gốc của thợ).
--     + Cam kết backup 45 ngày chỉ bắt buộc với file gốc (photo/video).
BEGIN;

-- ---------------------------------------------------------------- show_members
ALTER TABLE show_members RENAME COLUMN crew_user_id TO user_id;
ALTER INDEX idx_show_members_crew RENAME TO idx_show_members_user;

ALTER TABLE show_members
    ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN role_type TEXT NOT NULL DEFAULT 'crew' CHECK (role_type IN ('crew', 'editor'));

-- Chuyển FK của show_submissions từ khoá chính cũ sang ràng buộc UNIQUE mới
ALTER TABLE show_members ADD CONSTRAINT uq_show_members_show_user UNIQUE (show_id, user_id);
ALTER TABLE show_submissions DROP CONSTRAINT fk_show_submission_member;
ALTER TABLE show_members DROP CONSTRAINT show_members_pkey;
ALTER TABLE show_members ADD CONSTRAINT show_members_pkey PRIMARY KEY (id);
ALTER TABLE show_submissions
    ADD CONSTRAINT fk_show_submission_member FOREIGN KEY (show_id, crew_user_id)
        REFERENCES show_members (show_id, user_id) ON DELETE CASCADE;

-- ---------------------------------------------------------------- show_submissions
ALTER TABLE show_submissions DROP CONSTRAINT show_submissions_crew_type_check;
ALTER TABLE show_submissions
    ADD CONSTRAINT show_submissions_crew_type_check CHECK (crew_type IN ('photo', 'video', 'retouch'));

ALTER TABLE show_submissions ALTER COLUMN is_on_time_24h DROP NOT NULL;
ALTER TABLE show_submissions
    ADD CONSTRAINT chk_on_time_only_for_raw CHECK ((crew_type = 'retouch') = (is_on_time_24h IS NULL));

ALTER TABLE show_submissions DROP CONSTRAINT show_submissions_backup_committed_45d_check;
ALTER TABLE show_submissions
    ADD CONSTRAINT chk_backup_required_for_raw CHECK (crew_type = 'retouch' OR backup_committed_45d = true);

COMMIT;
