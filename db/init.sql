-- Chạy tự động khi container Postgres được tạo lần đầu (docker-compose)
-- Bật extension pgvector để dùng cho AI Face Search (mục 6.2 trong đề xuất)

CREATE EXTENSION IF NOT EXISTS vector;

-- Các bảng nghiệp vụ (photographer, album, photo, client, annotation...)
-- sẽ được thêm dần ở các bước sau, khi thiết kế schema chi tiết.
-- File này hiện chỉ đảm bảo DB sẵn sàng cho bước tiếp theo.
