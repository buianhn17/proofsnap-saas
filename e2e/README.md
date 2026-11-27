# Kiểm thử responsive (Playwright)

Chạy mọi route Admin + Client Portal và các modal/drawer chính trên 5 kích thước màn hình
(375×812, 390×844, 768×1024, 1366×768, 1920×1080). Mỗi trang kiểm tra: không tràn ngang
(`scrollWidth <= innerWidth`), không nút/ô nhập bị che bởi phần tử khác, không lỗi JS; các
bài tương tác kiểm tra lightbox mobile (ảnh ≥ 60% chiều cao, sheet ghi chú), hạn mức chọn ảnh
(“Đã chọn 5 / 5 ảnh”, toast, khoá nút tim), luồng gửi/mở lại lựa chọn của khách, sheet chi
tiết khách hàng (chuỗi tên file Lightroom, lưu trạng thái thanh toán) và công tắc album dưới 18 tuổi.
Bài a11y: Tab đầu tiên vào skip link (desktop), focus không thoát khỏi action sheet, rời trang
Cài đặt khi chưa lưu thì hiện cảnh báo. Chạy 1 phần (khuyến nghị 1 viewport/lần, ~4 phút): `VIEWPORTS=mobile-375,laptop-1366 node e2e/responsive-check.mjs`.

```bash
# 1. Backend e2e: chạy migration, seed dữ liệu demo, giả lập Google Drive bằng ảnh sinh sẵn
cd BE && DATABASE_URL=postgres://... REDIS_URL=redis://... node ../e2e/mockServer.js
# 2. Frontend
cd FE && npm run build && npx vite preview --port 5173
# 3. Kiểm tra (cần gói `playwright`; dùng Chrome cài sẵn hoặc PLAYWRIGHT_CHROME=...)
node e2e/responsive-check.mjs
```

Kết quả: `e2e/responsive-report.json` và ảnh chụp ở `e2e/shots/<viewport>/`.
`mockServer.js` xoá rồi tạo lại PTG `e2e@lensproof.invalid` — chỉ chạy trên DB dev/test.
