# LensProof Backend

Backend cho LensProof SaaS. Giai đoạn hiện tại: khởi tạo project + kết nối DB local.

## Yêu cầu

- Node.js 18+ (khuyến nghị 20 LTS)
- Docker Desktop (để chạy Postgres local không cần cài đặt thủ công)

## Chạy local lần đầu

1. Cài dependencies:
   ```
   npm install
   ```

2. Copy file env mẫu:
   ```
   cp .env.example .env
   ```
   (giữ nguyên giá trị mặc định là chạy được ngay, vì đã khớp với `docker-compose.yml`)

3. Bật Postgres local bằng Docker:
   ```
   docker compose up -d
   ```
   Lần đầu chạy sẽ tự tạo database `lensproof` và bật extension `pgvector`
   (xem `db/init.sql`). Nếu sau này sửa `db/init.sql` mà muốn nó chạy lại,
   phải xóa volume cũ: `docker compose down -v` rồi `docker compose up -d`.

4. Chạy server ở chế độ dev (tự reload khi sửa code):
   ```
   npm run dev
   ```

5. Kiểm tra server + DB đã kết nối chưa:
   ```
   curl http://localhost:3000/api/health
   ```
   Kết quả mong đợi:
   ```json
   {
     "status": "ok",
     "server": "running",
     "database": "connected",
     "db_time": "..."
   }
   ```

## Cấu trúc thư mục

```
src/
  config/       # kết nối DB, cấu hình chung
  routes/       # định nghĩa endpoint
  controllers/  # xử lý logic nghiệp vụ cho từng route
  models/       # truy vấn DB, thao tác dữ liệu
  middlewares/  # xác thực, xử lý lỗi, v.v.
db/
  init.sql      # script khởi tạo DB (bật pgvector)
```

## Trạng thái hiện tại

- [x] Khởi tạo project Express
- [x] Kết nối Postgres local qua Docker + pgvector
- [x] Route /api/health kiểm tra kết nối
- [ ] Thiết kế schema (album, photo, client, PIN, deadline, face vector, annotation)
- [ ] Google OAuth 2.0
- [ ] Kết nối Google Drive API
