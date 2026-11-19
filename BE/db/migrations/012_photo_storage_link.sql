-- Ảnh nhập từ link Drive công khai: LIÊN KẾT thay vì chép (như Shotpik).
--   storage = 'drive'       : file nằm trong Drive của PTG (upload thường) — đọc bằng token PTG
--   storage = 'public_link' : file nằm ở thư mục Drive công khai của PTG — drive_file_id là id file
--                             gốc; xem/tải qua CDN ảnh của Google đúng cỡ cần dùng.
-- Lý do: chép từng ảnh (tải gốc → nén → upload lại) mất ~3 giây/ảnh và API tải file của Google
-- chặn IP máy chủ khi tải hàng trăm ảnh liên tục; liên kết thì nhập 1.000 ảnh mất vài giây.
BEGIN;

ALTER TABLE photos
    ADD COLUMN storage TEXT NOT NULL DEFAULT 'drive'
        CHECK (storage IN ('drive', 'public_link'));

COMMIT;
