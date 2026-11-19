import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import AdminLayout from "./layouts/AdminLayout";
import ClientLayout from "./layouts/ClientLayout";
import RequireAuth from "./components/RequireAuth";
import { AuthProvider } from "./contexts/AuthContext";
import { ClientAlbumProvider } from "./contexts/ClientAlbumContext";
import DeadlineCountdownBar from "./components/DeadlineCountdownBar";

// Mỗi trang là một chunk riêng: khách vào Client Portal không phải tải code Admin và ngược lại.
const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
});

function AdminAuthScope() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

// Bước 2.1 — mọi trang Client Portal SAU khi đã qua PIN (gallery, và về sau: lightbox ghi
// chú, so sánh ảnh...) đều cần album + đếm ngược hạn chọn ảnh. Trang nhập PIN (index route)
// đứng NGOÀI scope này vì chưa có phiên client để gọi GET album.
function ClientAlbumScope() {
  return (
    <ClientAlbumProvider>
      <DeadlineCountdownBar />
      <Outlet />
    </ClientAlbumProvider>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/admin/albums" replace /> },
  // Trang thử nghiệm nội bộ Bước 1.3 (AI culling) — cố ý không nằm trong AdminLayout/nav,
  // chỉ truy cập trực tiếp qua URL khi cần chạy thử nghiệm/calibrate ngưỡng.
  // Lazy-load vì trang này kéo theo @mediapipe/tasks-vision, không nên tính vào bundle chính.
  {
    path: "/dev/culling-test",
    lazy: async () => ({
      Component: (await import("./pages/dev/CullingTestPage")).default,
    }),
  },
  {
    path: "/admin",
    element: <AdminAuthScope />,
    children: [
      { path: "login", lazy: page(() => import("./pages/admin/LoginPage")) },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <Navigate to="albums" replace /> },
              { path: "albums", lazy: page(() => import("./pages/admin/AlbumsPage")) },
              { path: "albums/new", lazy: page(() => import("./pages/admin/CreateAlbumPage")) },
              { path: "albums/:albumId", lazy: page(() => import("./pages/admin/AlbumDetailPage")) },
              { path: "albums/:albumId/annotations", lazy: page(() => import("./pages/admin/AlbumAnnotationsPage")) },
              // Bàn giao Show Kỷ Yếu — chủ Studio tạo show, thợ ảnh/thợ quay nộp file
              { path: "shows", lazy: page(() => import("./pages/admin/StudioShowsPage")) },
              { path: "shows/:showId", lazy: page(() => import("./pages/admin/ShowDetailPage")) },
              { path: "shows/:showId/submit", lazy: page(() => import("./pages/admin/CrewSubmitPage")) },
              // Bước 1.6 — bước duyệt/lọc ảnh (culling) tiền-upload. Lazy-load vì kéo theo
              // @mediapipe/tasks-vision qua culling worker, không nên tính vào bundle chính.
              {
                path: "albums/:albumId/cull",
                lazy: async () => ({
                  Component: (await import("./pages/admin/AlbumCullPage")).default,
                }),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    path: "/a/:albumId",
    element: <ClientLayout />,
    children: [
      { index: true, lazy: page(() => import("./pages/client/AlbumAccessPage")) },
      {
        element: <ClientAlbumScope />,
        children: [
          { path: "gallery", lazy: page(() => import("./pages/client/AlbumGalleryPage")) },
          { path: "face-search", lazy: page(() => import("./pages/client/FaceSearchPage")) },
        ],
      },
    ],
  },
]);
