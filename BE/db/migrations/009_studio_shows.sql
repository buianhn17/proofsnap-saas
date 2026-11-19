-- Quản lý Show Kỷ Yếu & Bàn Giao Ekip (nhiều thợ ảnh + thợ quay) — dùng chung tài khoản
-- photographers hiện có: chủ Studio và thợ đều là 1 dòng photographers (đăng nhập Google).
--
--   studio_shows      1 buổi chụp / 1 lớp. invite_code dán vào nhóm ekip để mọi người tham gia.
--                     Hạn bàn giao = shoot_end_time + 24 giờ.
--   show_members      thợ đã nhập invite_code. Cần lưu riêng để: (1) thợ thấy show trong danh
--                     sách ngay cả khi chưa nộp, (2) Studio thấy ai đã vào nhưng CHƯA nộp,
--                     (3) chỉ thành viên mới nộp được (FK kép từ show_submissions bên dưới).
--   show_submissions  mỗi lượt bàn giao của 1 thợ cho 1 vai trò. Thợ kiêm nhiệm nộp nhiều dòng
--                     (mỗi vai trò 1 dòng); nộp lại cùng vai trò thì cập nhật dòng cũ.
BEGIN;

CREATE TABLE studio_shows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    studio_user_id  UUID NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
    invite_code     TEXT NOT NULL UNIQUE,
    shoot_date      DATE NOT NULL,
    shoot_end_time  TIMESTAMPTZ NOT NULL,               -- mốc tính hạn bàn giao 24h
    class_name      TEXT NOT NULL CHECK (char_length(class_name) BETWEEN 1 AND 40),
    school_name     TEXT NOT NULL CHECK (char_length(school_name) BETWEEN 1 AND 160),
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_studio_shows_owner ON studio_shows (studio_user_id, shoot_date DESC);

CREATE TABLE show_members (
    show_id       UUID NOT NULL REFERENCES studio_shows(id) ON DELETE CASCADE,
    crew_user_id  UUID NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
    joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (show_id, crew_user_id)
);
CREATE INDEX idx_show_members_crew ON show_members (crew_user_id);

CREATE TABLE show_submissions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id                UUID NOT NULL REFERENCES studio_shows(id) ON DELETE CASCADE,
    crew_user_id           UUID NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
    crew_name              TEXT NOT NULL CHECK (char_length(crew_name) BETWEEN 1 AND 80),
    crew_type              TEXT NOT NULL CHECK (crew_type IN ('photo', 'video')),
    role_position          TEXT NOT NULL CHECK (char_length(role_position) BETWEEN 1 AND 40),
    formatted_folder_name  TEXT NOT NULL,
    drive_url              TEXT NOT NULL,
    total_files            INTEGER NOT NULL CHECK (total_files > 0),   -- số ảnh (photo) hoặc số clip (video)
    raw_count              INTEGER NOT NULL DEFAULT 0 CHECK (raw_count >= 0),
    jpg_count              INTEGER NOT NULL DEFAULT 0 CHECK (jpg_count >= 0),
    video_count            INTEGER NOT NULL DEFAULT 0 CHECK (video_count >= 0),
    -- { closed_eyes, blurry, overexposed, failed_fireworks }: số ảnh lỗi thợ đã lọc bỏ
    culled_stats           JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(culled_stats) = 'object'),
    has_valid_structure    BOOLEAN NOT NULL,             -- ảnh: 01 folder RAW nén + 01 folder JPG; quay: folder footage gốc
    backup_committed_45d   BOOLEAN NOT NULL CHECK (backup_committed_45d = true),
    is_on_time_24h         BOOLEAN NOT NULL,             -- submitted_at <= shoot_end_time + 24h
    status                 TEXT NOT NULL DEFAULT 'submitted'
                           CHECK (status IN ('submitted', 'approved', 'rejected')),
    studio_note            TEXT CHECK (studio_note IS NULL OR char_length(studio_note) <= 1000),
    submitted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at            TIMESTAMPTZ,
    -- Thợ kiêm nhiệm: nhiều dòng khác role_position. Cùng thợ + cùng vai trò = 1 dòng duy nhất.
    CONSTRAINT uq_show_submission_role UNIQUE (show_id, crew_user_id, role_position),
    -- Chỉ thành viên đã nhập invite_code mới có lượt nộp.
    CONSTRAINT fk_show_submission_member FOREIGN KEY (show_id, crew_user_id)
        REFERENCES show_members (show_id, crew_user_id) ON DELETE CASCADE,
    -- Yêu cầu sửa lại thì phải nói rõ sửa gì.
    CONSTRAINT chk_rejected_has_note CHECK (
        status <> 'rejected' OR (studio_note IS NOT NULL AND btrim(studio_note) <> '')
    )
);
CREATE INDEX idx_show_submissions_show ON show_submissions (show_id, crew_type, submitted_at);
CREATE INDEX idx_show_submissions_crew ON show_submissions (crew_user_id);

COMMIT;
