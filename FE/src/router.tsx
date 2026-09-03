import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import AdminLayout from "./layouts/AdminLayout";
import ClientLayout from "./layouts/ClientLayout";
import RequireAuth from "./components/RequireAuth";
import { AuthProvider } from "./contexts/AuthContext";
import LoginPage from "./pages/admin/LoginPage";
import AlbumsPage from "./pages/admin/AlbumsPage";
import CreateAlbumPage from "./pages/admin/CreateAlbumPage";
import AlbumDetailPage from "./pages/admin/AlbumDetailPage";
import AlbumAnnotationsPage from "./pages/admin/AlbumAnnotationsPage";
import AlbumAccessPage from "./pages/client/AlbumAccessPage";
import AlbumGalleryPage from "./pages/client/AlbumGalleryPage";
import FaceSearchPage from "./pages/client/FaceSearchPage";
import { ClientAlbumProvider } from "./contexts/ClientAlbumContext";
import DeadlineCountdownBar from "./components/DeadlineCountdownBar";

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
      { path: "login", element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <Navigate to="albums" replace /> },
              { path: "albums", element: <AlbumsPage /> },
              { path: "albums/new", element: <CreateAlbumPage /> },
              { path: "albums/:albumId", element: <AlbumDetailPage /> },
              { path: "albums/:albumId/annotations", element: <AlbumAnnotationsPage /> },
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
      { index: true, element: <AlbumAccessPage /> },
      {
        element: <ClientAlbumScope />,
        children: [
          { path: "gallery", element: <AlbumGalleryPage /> },
          { path: "face-search", element: <FaceSearchPage /> },
        ],
      },
    ],
  },
]);
