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

   Để đăng nhập Google, tạo OAuth 2.0 Client ID loại Web trên Google Cloud
   Console và điền `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` vào `.env`.
   Thêm URI sau vào mục Authorized redirect URIs:
   `http://localhost:3000/api/auth/google/callback`

3. Bật Postgres local bằng Docker:
   ```
   docker compose up -d
   ```
   Lần đầu chạy sẽ tự tạo database `lensproof` và bật extension `pgvector`
   (xem `db/init.sql`). Nếu sau này sửa `db/init.sql` mà muốn nó chạy lại,
   phải xóa volume cũ: `docker compose down -v` rồi `docker compose up -d`.

   Schema được version hóa trong `db/migrations/`. Với database đang chạy,
   có thể áp dụng migration bằng lệnh:
   ```powershell
   Get-Content -Raw db/migrations/001_initial_schema.sql | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U lensproof -d lensproof
   ```

4. Tải trọng số model AI Face Search (bắt buộc, chỉ cần chạy 1 lần — file binary không
   commit vào git):
   ```
   npm run setup:face-models
   ```

5. Chạy server ở chế độ dev (tự reload khi sửa code):
   ```
   npm run dev
   ```

6. Kiểm tra server + DB đã kết nối chưa:
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

7. Chạy test backend:
   ```
   npm test
   ```

## Quản lý API bằng Swagger

Mở giao diện Swagger tại:
`http://localhost:3000/api-docs/`

Sau khi đăng nhập Google thành công, cookie `session_token` được trình duyệt
tự gửi kèm khi gọi các API admin trong Swagger.

Giai đoạn Google Drive hiện có:

- `GET /api/drive/status`: kiểm tra kết nối Drive.
- `POST /api/drive/setup`: tạo hoặc tìm thư mục `LensProof/Albums`.

Giai đoạn quản lý album hiện có:

- `GET /api/albums`: liệt kê album của photographer.
- `POST /api/albums`: tạo album và folder album trên Drive.
- `GET /api/albums/:albumId`: xem chi tiết album.
- `PATCH /api/albums/:albumId`: cập nhật cấu hình album.
- `DELETE /api/albums/:albumId`: lưu trữ album an toàn, không xóa folder Drive.

Khi tạo album, gửi `pin` dạng chuỗi số 4–12 ký tự. PIN chỉ được lưu dưới
dạng hash, không xuất hiện trong response API.

Giai đoạn 4 (xuất filename + ZIP) hiện có:

- `POST /api/albums/:albumId/filename-export`: tổng hợp ảnh đã được khách
   chọn hoặc có ghi chú, trả về `search_string` (nối bằng " OR ", dán thẳng
   vào thanh tìm kiếm Lightroom/Photoshop lọc theo Filename) — mỗi lần gọi
   ghi thêm 1 dòng lịch sử vào `filename_exports`.
- `POST /api/albums/:albumId/zip-upload`: PTG upload 1 file .zip ảnh đã hậu
   kỳ (tùy chọn, tối đa 2 GB), lưu lên Drive và gắn vào album
   (`zip_drive_file_id`) làm nguồn ZIP ưu tiên khi khách tải.
- `PATCH /api/albums/:albumId` hỗ trợ thêm field `download_zip_unlocked`
   ("mở khóa tải" ZIP cho khách).

Khách tải ZIP qua `GET /api/public/albums/:albumId/download-zip` (yêu cầu
`download_zip_unlocked = true`). Nếu album có `zip_drive_file_id` (PTG đã
upload bản hậu kỳ), backend proxy nguyên file đó; nếu chưa, backend tự nén
ZIP "động" (streaming, không buffer cả album vào RAM) từ ảnh GỐC đã được ít
nhất 1 khách trong album chọn.

Upload ảnh hiện có:

- `GET /api/albums/:albumId/photos`: liệt kê metadata ảnh trong album.
- `POST /api/albums/:albumId/photos`: upload một JPG/JPEG tối đa 25 MB trong
   field `file`; các field metadata như `width`, `height`, `captured_at`,
   `sharpness_score`, `eye_status`, `culling_flag` là tùy chọn.

Ảnh phải được nén/xử lý ở trình duyệt Admin Portal trước khi upload. Backend
chỉ nhận JPG đã được chọn giữ lại và không nhận file RAW.

Client Portal hiện có:

- `POST /api/public/albums/:albumId/verify-pin`: gửi `pin`, `name`, `phone`
   để tạo cookie `client_session_token`.
- `GET /api/public/albums/:albumId`: lấy thông tin album sau khi xác thực.
- `GET /api/public/albums/:albumId/download-zip`: tải ZIP ảnh hoàn thiện
   (Bước 4.2, xem chi tiết nguồn ảnh ở trên).
- `POST /api/public/albums/client/logout`: xóa phiên khách hàng.

AI Face Search (Giai đoạn 3) hiện có:

- `GET /api/public/albums/:albumId/face-search/consent`: trạng thái đồng ý
   xử lý khuôn mặt của khách đang đăng nhập. `feature_available=false` nếu
   album (hoặc riêng khách đó) bị đánh dấu vị thành niên — trường hợp này
   tính năng bị khóa hẳn, chưa có quy trình xin đồng ý qua phụ huynh.
- `POST /api/public/albums/:albumId/face-search/consent`: ghi nhận đồng ý
   (`{ "agree": true }`, bắt buộc, không được tick sẵn phía FE).
- `POST /api/public/albums/:albumId/face-search`: upload ảnh selfie (field
   `file`, JPG/JPEG tối đa 8 MB), trả về danh sách ảnh trong album có khuôn
   mặt khớp kèm `similarity`. Yêu cầu đã đồng ý ở trên trước đó. Ảnh
   selfie/embedding của khách KHÔNG được lưu lại — chỉ log số liệu vào
   `client_selfie_searches`.

Ảnh PTG upload (`POST /api/albums/:albumId/photos`) tự động trích embedding
khuôn mặt (nếu có) và lưu vào `photo_face_embeddings` — chạy model InsightFace
(SCRFD phát hiện mặt + ArcFace embedding 512 chiều) server-side qua
`onnxruntime-node`, xem bước "Tải trọng số model" ở trên. Ngưỡng so khớp (cosine
distance, mặc định `0.42`) chỉnh được qua biến môi trường `FACE_MATCH_MAX_DISTANCE`.

Từ migration `008_upload_face_index_queue.sql` (bắt buộc áp dụng trước khi chạy
code mới), việc trích embedding chạy **nền** sau khi upload trả lời
(`src/services/faceIndexQueue.js`, trạng thái ở cột `photos.face_index_status`;
server khởi động lại sẽ chạy tiếp các ảnh còn `pending`). FE gửi kèm vùng cắt
quanh từng khuôn mặt lấy từ **ảnh gốc** (ảnh trên Drive đã bị nén, mặt nhỏ trong
ảnh tập thể không còn đủ chi tiết), vùng cắt lưu tạm ở thư mục
`<tmp>/lensproof-face-crops` cho tới khi xử lý xong.

Sau khi áp dụng migration `007_upgrade_to_arcface_512.sql` (xóa embedding 128
chiều cũ), chạy `npm run reindex:faces` để trích lại embedding cho ảnh đã upload
(thêm `-- <albumId>` để chỉ chạy 1 album).

> Model pretrained của InsightFace chỉ được cấp phép cho mục đích nghiên cứu phi
> thương mại — cần license từ InsightFace trước khi dùng cho sản phẩm thương mại.

Nếu API Drive trả lỗi `DRIVE_SCOPE_REQUIRED`, hãy mở lại
`http://localhost:3000/api/auth/google`, đăng nhập lại và chấp nhận quyền
Google Drive để cấp lại scope cho refresh token hiện tại.

## Cấu trúc thư mục

```
src/
   app.js        # tạo Express app, dùng được cho server và test
  config/       # kết nối DB, cấu hình chung
  routes/       # định nghĩa endpoint
  controllers/  # xử lý logic nghiệp vụ cho từng route
  models/       # truy vấn DB, thao tác dữ liệu
  middlewares/  # xác thực, xử lý lỗi, v.v.
db/
  init.sql      # script khởi tạo DB (bật pgvector)
   migrations/   # migration có version
```

## Trạng thái hiện tại

- [x] Khởi tạo project Express
- [x] Kết nối Postgres local qua Docker + pgvector
- [x] Route /api/health kiểm tra kết nối
- [ ] Thiết kế schema (album, photo, client, PIN, deadline, face vector, annotation)
- [ ] Google OAuth 2.0
- [ ] Kết nối Google Drive API
