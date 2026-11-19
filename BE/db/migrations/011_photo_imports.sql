-- Nhập ảnh vào album từ link thư mục Google Drive CÔNG KHAI ("Bất kỳ ai có đường liên kết").
--   photo_imports: mỗi lượt nhập 1 dòng — chạy nền, lưu tiến độ trong DB để tải lại trang
--     vẫn thấy, server khởi động lại thì chạy tiếp lượt còn dở.
--   photos.source_drive_file_id: id file gốc trên Drive công khai — nhập lại cùng link chỉ
--     thêm ảnh mới, không tạo ảnh trùng (UNIQUE theo album).
-- Ảnh nhập về được tải xuống, nén theo mức nén của album rồi CHÉP vào Drive của PTG như ảnh
-- upload thường (drive_file_id là bản chép) — watermark, Face Search, ZIP… dùng y như cũ, và
-- không phụ thuộc thư mục gốc còn công khai hay đã bị xoá.
BEGIN;

ALTER TABLE photos ADD COLUMN source_drive_file_id TEXT;
CREATE UNIQUE INDEX idx_photos_source_drive_file
    ON photos (album_id, source_drive_file_id)
    WHERE source_drive_file_id IS NOT NULL;

CREATE TABLE photo_imports (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id                UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    photographer_id         UUID NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
    source_url              TEXT NOT NULL,
    source_kind             TEXT NOT NULL CHECK (source_kind IN ('folder', 'file')),
    source_id               TEXT NOT NULL,
    source_name             TEXT,
    status                  TEXT NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    total_files             INTEGER NOT NULL DEFAULT 0,  -- số ảnh JPG tìm thấy
    imported_count          INTEGER NOT NULL DEFAULT 0,
    skipped_existing_count  INTEGER NOT NULL DEFAULT 0,  -- đã có trong album từ lượt nhập trước
    unsupported_count       INTEGER NOT NULL DEFAULT 0,  -- RAW, HEIC, video… (chỉ nhận JPG)
    failed_count            INTEGER NOT NULL DEFAULT 0,
    failed_files            JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ name, reason }] tối đa 50
    error_message           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at              TIMESTAMPTZ,
    finished_at             TIMESTAMPTZ
);
CREATE INDEX idx_photo_imports_album ON photo_imports (album_id, created_at DESC);
-- Mỗi album chỉ chạy 1 lượt nhập tại một thời điểm
CREATE UNIQUE INDEX idx_photo_imports_one_active
    ON photo_imports (album_id)
    WHERE status IN ('queued', 'running');

COMMIT;
