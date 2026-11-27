// Phạm vi Provider cho từng nhánh route (tách khỏi router.tsx để file đó chỉ export cấu hình).
import { Outlet } from "react-router-dom";
import { AuthProvider } from "../contexts/AuthContext";
import { ClientAlbumProvider } from "../contexts/ClientAlbumContext";
import { ClientSelectionProvider } from "../contexts/ClientSelectionContext";
import ClientTabBar from "../components/ClientTabBar";
import DeadlineCountdownBar from "../components/DeadlineCountdownBar";

export function AdminAuthScope() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

// Bước 2.1 — mọi trang Client Portal SAU khi đã qua PIN (gallery, và về sau: lightbox ghi
// chú, so sánh ảnh...) đều cần album + đếm ngược hạn chọn ảnh. Trang nhập PIN (index route)
// đứng NGOÀI scope này vì chưa có phiên client để gọi GET album.
export function ClientAlbumScope() {
  return (
    <ClientAlbumProvider>
      <ClientSelectionProvider>
        <DeadlineCountdownBar />
        <Outlet />
        <ClientTabBar />
      </ClientSelectionProvider>
    </ClientAlbumProvider>
  );
}
