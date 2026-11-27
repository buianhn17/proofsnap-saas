# Chính sách quyền riêng tư — LensProof

_Cập nhật: 27/11/2026_

LensProof là ứng dụng đồ án sinh viên giúp nhiếp ảnh gia (photographer) gửi album ảnh cho khách
duyệt và chọn ảnh. Trang này mô tả dữ liệu LensProof thu thập và cách sử dụng.

## 1. Dữ liệu từ tài khoản Google (photographer)

Khi photographer đăng nhập bằng Google, LensProof xin các quyền sau:

| Quyền | Dùng để |
|---|---|
| `openid`, `email`, `profile` | Xác định tài khoản: lấy tên, email và ảnh đại diện để tạo tài khoản photographer |
| `drive.file` | Tạo thư mục album và tải ảnh lên **Google Drive của chính photographer**. Quyền này chỉ cho phép truy cập các file/thư mục do LensProof tạo ra, **không** đọc được file nào khác trên Drive |

Token truy cập Google được mã hoá trước khi lưu vào cơ sở dữ liệu và chỉ dùng để thao tác với các
file album của photographer đó.

## 2. Dữ liệu của khách xem album

- **Tên và số điện thoại** khách nhập khi mở album: dùng để ghi nhận lựa chọn/ghi chú của khách và
  in watermark (nếu photographer bật).
- **Lựa chọn ảnh, ghi chú, bình luận** trên ảnh: lưu để photographer xử lý hậu kỳ.
- **Tìm ảnh bằng khuôn mặt**: chỉ chạy khi khách đồng ý. Ảnh selfie được xử lý tạm thời để tìm ảnh
  khớp và **không được lưu** lại. Khách có thể rút lại đồng ý bất kỳ lúc nào.

## 3. Cookie

LensProof chỉ dùng cookie đăng nhập (httpOnly) để giữ phiên làm việc. Không dùng cookie quảng cáo
hay theo dõi.

## 4. Chia sẻ dữ liệu

LensProof **không bán và không chia sẻ** dữ liệu cho bên thứ ba. Ảnh nằm trên Google Drive của
photographer; dữ liệu khác nằm trong cơ sở dữ liệu của ứng dụng.

## 5. Xoá dữ liệu

- Photographer có thể xoá album bất kỳ lúc nào, và có thể thu hồi quyền của LensProof tại
  <https://myaccount.google.com/permissions>.
- Khách muốn xoá dữ liệu của mình có thể liên hệ photographer đã gửi album hoặc tạo issue tại
  <https://github.com/buianhn17/proofsnap-saas/issues>.

## 6. Liên hệ

Mọi câu hỏi về quyền riêng tư, vui lòng tạo issue tại
<https://github.com/buianhn17/proofsnap-saas/issues>.
