-- ============================================================
-- LENSPROOF SAAS — DATABASE SCHEMA (PostgreSQL 15+)
-- Yêu cầu extension: pgvector (cho AI Face Search), pgcrypto (gen_random_uuid)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------------
-- 1. NHIẾP ẢNH GIA
-- ------------------------------------------------------------
CREATE TABLE photographers (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id                       TEXT UNIQUE NOT NULL,
    email                           TEXT UNIQUE NOT NULL,
    display_name                    TEXT,
    drive_root_folder_id            TEXT,               -- folder gốc trên Drive PTG chứa các album
    oauth_refresh_token_encrypted   TEXT NOT NULL,       -- PHẢI mã hóa (AES) trước khi lưu, không lưu plaintext
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. PRESET NÉN ẢNH (4 mức cố định toàn hệ thống — mục 3.1.1 & 5.1)
--    Tách bảng riêng thay vì hard-code để tương thích hướng phát triển 9.2
--    (cho phép PTG tự tùy chỉnh preset trong tương lai) mà không đổi schema.
-- ------------------------------------------------------------
CREATE TABLE compression_presets (
    id                SMALLSERIAL PRIMARY KEY,
    code              TEXT UNIQUE NOT NULL,              -- 'excellent' | 'good' | 'medium' | 'saver'
    label_vi          TEXT NOT NULL,                     -- 'Xuất sắc' | 'Tốt' | 'Trung bình' | 'Tiết kiệm'
    jpeg_quality      SMALLINT NOT NULL CHECK (jpeg_quality BETWEEN 1 AND 100),
    max_long_edge_px  INTEGER NOT NULL,
    is_system_default BOOLEAN NOT NULL DEFAULT true       -- false nếu sau này là preset PTG tự tạo
);

INSERT INTO compression_presets (code, label_vi, jpeg_quality, max_long_edge_px) VALUES
    ('excellent', 'Xuất sắc',    92, 3840),
    ('good',      'Tốt',         85, 2560),
    ('medium',    'Trung bình',  75, 1920),
    ('saver',     'Tiết kiệm',   60, 1280);
    -- Số liệu jpeg_quality/max_long_edge_px ở trên là giá trị đề xuất mẫu,
    -- cần bạn chốt lại con số thật trước khi build.

-- ------------------------------------------------------------
-- 3. ALBUM
-- ------------------------------------------------------------
CREATE TABLE albums (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photographer_id           UUID NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
    name                      TEXT NOT NULL,
    drive_folder_id           TEXT NOT NULL,             -- folder trên Drive PTG chứa JPG sạch (không watermark)
    pin_enabled                BOOLEAN NOT NULL DEFAULT true,   -- PTG tự chọn có yêu cầu PIN hay không
    pin_hash                  TEXT,                       -- bcrypt/argon2 hash; NULL khi pin_enabled = false. KHÔNG bao giờ lưu PIN plaintext
    max_selectable_photos     INTEGER,                    -- NULL = không giới hạn
    selection_deadline        TIMESTAMPTZ,
    is_locked                 BOOLEAN NOT NULL DEFAULT false,  -- true khi hết hạn hoặc PTG khóa tay
    watermark_enabled         BOOLEAN NOT NULL DEFAULT true,    -- PTG tự chọn có in watermark động hay không
    compression_preset_id     SMALLINT NOT NULL REFERENCES compression_presets(id),
    download_zip_unlocked     BOOLEAN NOT NULL DEFAULT false,  -- PTG mở khóa cho khách tải ZIP hoàn thiện
    zip_drive_file_id         TEXT,                       -- file .zip PTG generate sau hậu kỳ, lưu trên Drive
    is_minor_album            BOOLEAN NOT NULL DEFAULT false,  -- PTG đánh dấu lúc tạo album (VD: kỷ yếu học sinh);
                                                                -- áp dụng mặc định cho mọi client trong album,
                                                                -- xem thêm ghi chú tại clients.is_minor_flagged
    status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_pin_consistency CHECK (
        (pin_enabled = true  AND pin_hash IS NOT NULL) OR
        (pin_enabled = false AND pin_hash IS NULL)
    )
);
CREATE INDEX idx_albums_photographer ON albums(photographer_id);
CREATE INDEX idx_albums_deadline ON albums(selection_deadline) WHERE is_locked = false;

-- ------------------------------------------------------------
-- 4. SCENE (gom nhóm theo buổi chụp — EXIF timestamp + histogram, mục 6.1)
-- ------------------------------------------------------------
CREATE TABLE scenes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id    UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    label       TEXT,                -- auto "Buổi 1" hoặc PTG đổi tên
    started_at  TIMESTAMPTZ,
    ended_at    TIMESTAMPTZ,
    sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_scenes_album ON scenes(album_id);

-- ------------------------------------------------------------
-- 5. BURST CLUSTER (gom cụm ảnh trùng lặp — perceptual hashing, mục 6.1)
--    Circular FK với photos -> tạo bảng trước, gắn FK best_photo_id sau khi có bảng photos.
-- ------------------------------------------------------------
CREATE TABLE burst_clusters (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id      UUID REFERENCES scenes(id) ON DELETE SET NULL,
    best_photo_id UUID  -- FK constraint thêm ở cuối file
);

-- ------------------------------------------------------------
-- 6. PHOTOS
--    QUAN TRỌNG: bảng này chỉ lưu ảnh JPG ĐÃ ĐƯỢC GIỮ LẠI sau khi lọc và ĐÃ UPLOAD lên Drive.
--    File RAW không bao giờ rời máy PTG nên KHÔNG có cột lưu trữ RAW —
--    chỉ giữ original_base_filename để đối chiếu khi PTG hậu kỳ trong Lightroom (mục 3.1.1, 5.2).
-- ------------------------------------------------------------
CREATE TABLE photos (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id               UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    scene_id               UUID REFERENCES scenes(id) ON DELETE SET NULL,
    burst_cluster_id       UUID REFERENCES burst_clusters(id) ON DELETE SET NULL,
    drive_file_id          TEXT NOT NULL,               -- id file JPG sạch trên Drive PTG
    original_base_filename TEXT NOT NULL,               -- tên gốc chung cho cặp RAW/JPG (không có đuôi mở rộng)
    width                  INTEGER,
    height                 INTEGER,
    file_size_bytes        BIGINT,
    captured_at            TIMESTAMPTZ,                 -- từ EXIF
    sharpness_score        SMALLINT CHECK (sharpness_score BETWEEN 0 AND 100),
    eye_status             TEXT CHECK (eye_status IN ('open','squint','closed')),
    culling_flag           TEXT CHECK (culling_flag IN ('green','yellow','red')),
    is_best_in_cluster     BOOLEAN NOT NULL DEFAULT false,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (album_id, drive_file_id)
);
CREATE INDEX idx_photos_album ON photos(album_id);
CREATE INDEX idx_photos_scene ON photos(scene_id);
CREATE INDEX idx_photos_cluster ON photos(burst_cluster_id);

ALTER TABLE burst_clusters
    ADD CONSTRAINT fk_burst_best_photo
    FOREIGN KEY (best_photo_id) REFERENCES photos(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 7. FACE EMBEDDINGS của ảnh trong album (tính lúc PTG upload, dùng cho AI Face Search — mục 6.2)
-- ------------------------------------------------------------
CREATE TABLE photo_face_embeddings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id    UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    bbox_x      INTEGER,
    bbox_y      INTEGER,
    bbox_w      INTEGER,
    bbox_h      INTEGER,
    embedding   VECTOR(512),   -- số chiều tùy model thực tế dùng, chỉnh lại cho khớp
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_face_embedding_ann
    ON photo_face_embeddings USING hnsw (embedding vector_cosine_ops);
    -- HNSW thay vì ivfflat: recall/độ trễ tốt hơn, build được ngay cả khi bảng
    -- còn trống (ivfflat cần đủ dữ liệu mẫu mới build hiệu quả). ivfflat chỉ
    -- đáng cân nhắc nếu tốc độ ghi rất cao (>100k dòng/giờ), không phải trường
    -- hợp của LensProof (embedding chỉ ghi lúc PTG upload ảnh).

-- ------------------------------------------------------------
-- 8. TÀI KHOẢN KHÁCH HÀNG (email/mật khẩu, DÙNG CHUNG TOÀN PLATFORM —
--    một khách có thể quay lại nhiều album/nhiều PTG khác nhau bằng
--    cùng 1 tài khoản, không tạo mới theo từng link như trước).
-- ------------------------------------------------------------
CREATE TABLE client_accounts (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                  TEXT UNIQUE NOT NULL,
    password_hash          TEXT NOT NULL,          -- bcrypt/argon2, KHÔNG bao giờ lưu plaintext
    full_name              TEXT NOT NULL,          -- dùng in watermark khi album bật watermark
    phone_number           TEXT NOT NULL,          -- dùng in watermark khi album bật watermark
    email_verified_at      TIMESTAMPTZ,            -- NULL = chưa xác thực email (khuyến nghị bắt buộc verify trước khi cho chọn ảnh)
    failed_login_attempts  SMALLINT NOT NULL DEFAULT 0,
    locked_until           TIMESTAMPTZ,            -- khóa tạm thời khi đăng nhập sai nhiều lần (chống brute-force)
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 9. PHIÊN ĐĂNG NHẬP (cho phép thu hồi/đăng xuất từ xa từng thiết bị)
-- ------------------------------------------------------------
CREATE TABLE client_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_account_id   UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
    session_token_hash  TEXT NOT NULL UNIQUE,   -- hash của token phiên, không lưu token gốc
    user_agent          TEXT,
    ip_address          INET,
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_sessions_account ON client_sessions(client_account_id);

-- ------------------------------------------------------------
-- 10. QUÊN MẬT KHẨU
-- ------------------------------------------------------------
CREATE TABLE client_password_reset_tokens (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_account_id   UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
    token_hash          TEXT NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,
    used_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 11. CLIENTS — bản ghi "thành viên" gắn 1 client_account vào 1 album cụ thể.
--     KHÔNG tạo record này khi khách chỉ xem ảnh (browse); chỉ tạo khi khách
--     đăng nhập/đăng ký để bấm tim hoặc thêm ghi chú lần đầu trong album đó.
--     Nhờ vậy: xem ảnh luôn không rào cản, còn tim/note thì tự động gộp đúng
--     theo tài khoản dù khách đổi thiết bị (giải quyết vấn đề trùng client
--     theo cùng 1 người mà mình nêu ở tin trước).
-- ------------------------------------------------------------
CREATE TABLE clients (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id                 UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    client_account_id        UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
    face_search_consent_at   TIMESTAMPTZ,               -- BẮT BUỘC not null trước khi cho phép AI Face Search, riêng theo từng album
    is_minor_flagged         BOOLEAN,                    -- override cho riêng client này; NULL = dùng theo
                                                            -- albums.is_minor_album (mặc định). Chỉ set giá trị
                                                            -- khác NULL khi PTG cần ngoại lệ (VD: phụ huynh/giáo
                                                            -- viên cũng có mặt trong album kỷ yếu, không phải học sinh)
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (album_id, client_account_id)
);
CREATE INDEX idx_clients_album ON clients(album_id);
CREATE INDEX idx_clients_account ON clients(client_account_id);
-- Tên/SĐT hiển thị trên watermark lấy qua JOIN clients -> client_accounts,
-- không duplicate ở bảng này nữa (tránh 2 nguồn sự thật lệch nhau).
-- Lưu ý pháp lý (mục 6.2, 9.1): mọi lệnh gọi AI Face Search phải kiểm tra
-- face_search_consent_at IS NOT NULL trước khi xử lý. Trạng thái vị thành niên
-- hiệu lực (effective) của 1 client = clients.is_minor_flagged nếu khác NULL,
-- ngược lại lấy theo albums.is_minor_album. Nếu trạng thái hiệu lực = true,
-- cần luồng đồng ý chặt hơn (ví dụ xác nhận qua PTG/phụ huynh) — quy trình cụ
-- thể (ai xác nhận, lưu bằng chứng đồng ý ra sao) CHƯA được đặc tả, cần bạn
-- chốt trước khi build tính năng AI Face Search cho album loại này.

-- ------------------------------------------------------------
-- 12. LOG TRA CỨU AI FACE SEARCH — KHÔNG lưu embedding ảnh selfie của khách
--     để tối thiểu hóa việc lưu trữ dữ liệu sinh trắc học nhạy cảm, chỉ log số liệu.
-- ------------------------------------------------------------
CREATE TABLE client_selfie_searches (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    searched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    matched_photo_count   INTEGER
);

-- ------------------------------------------------------------
-- 13. SELECTIONS (thả tim chọn ảnh)
-- ------------------------------------------------------------
CREATE TABLE selections (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    photo_id     UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    selected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, photo_id)
);
CREATE INDEX idx_selections_photo ON selections(photo_id);

-- ------------------------------------------------------------
-- 14. ANNOTATIONS (ghi chú khoanh vùng chỉnh sửa chi tiết)
-- ------------------------------------------------------------
CREATE TABLE annotations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id      UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    pos_x_pct     NUMERIC(5,2) NOT NULL CHECK (pos_x_pct BETWEEN 0 AND 100), -- % theo chiều rộng ảnh
    pos_y_pct     NUMERIC(5,2) NOT NULL CHECK (pos_y_pct BETWEEN 0 AND 100),
    note_text     TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_annotations_photo ON annotations(photo_id);

-- ------------------------------------------------------------
-- 15. XÁC NHẬN HOÀN TẤT CHỌN ẢNH CỦA TỪNG KHÁCH
-- ------------------------------------------------------------
CREATE TABLE album_client_completions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id      UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
    completed_at   TIMESTAMPTZ,
    auto_locked    BOOLEAN NOT NULL DEFAULT false  -- true nếu bị hệ thống tự khóa do hết hạn
);

-- ------------------------------------------------------------
-- 16. XUẤT CHUỖI TÊN FILE CHO LIGHTROOM/PHOTOSHOP (mục 3.1.1, 5.2)
-- ------------------------------------------------------------
CREATE TABLE filename_exports (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id       UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    filename_list  TEXT[] NOT NULL  -- danh sách original_base_filename được chọn tại thời điểm export
);

-- ------------------------------------------------------------
-- 17. CAPTION TIẾP THỊ (Gemini API — mục 3.1.3)
-- ------------------------------------------------------------
CREATE TABLE marketing_captions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id     UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    platform     TEXT CHECK (platform IN ('facebook','instagram','threads')),
    content      TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- GHI CHÚ: cache ảnh đã watermark (mục 6.3) đặt ở Redis theo đúng
-- đặc tả gốc (key dạng photo_id:client_id, có TTL), KHÔNG cần bảng
-- riêng trong Postgres — tránh trùng trách nhiệm giữa 2 lớp lưu trữ.
--
-- HƯỚNG PHÁT TRIỂN SAU (mục 9.2, chưa đưa vào phạm vi đồ án):
-- import thẳng ảnh vào Google Photos của khách hàng. Khi triển khai sẽ cần
-- thêm OAuth token của client_accounts (scope Google Photos Library API,
-- không dùng chung refresh token của photographers), và bảng riêng lưu
-- trạng thái từng lượt import — CHƯA thiết kế trong schema này.
-- ============================================================
