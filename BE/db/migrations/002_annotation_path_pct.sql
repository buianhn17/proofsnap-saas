-- Giai đoạn 2, Bước 2.2 — cho phép khách vẽ tự do (nét vẽ nhiều điểm) lên ảnh thay vì
-- chỉ ghim 1 điểm. Cột nullable nên an toàn chạy trên DB dev đã có dữ liệu annotations cũ
-- (các dòng cũ giữ path_pct = NULL, vẫn hiển thị được như 1 điểm qua pos_x_pct/pos_y_pct).
ALTER TABLE annotations ADD COLUMN IF NOT EXISTS path_pct JSONB;
