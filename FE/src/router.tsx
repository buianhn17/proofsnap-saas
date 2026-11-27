import { createBrowserRouter, Navigate } from "react-router-dom";
import AdminLayout from "./layouts/AdminLayout";
import ClientLayout from "./layouts/ClientLayout";
import { AdminAuthScope, ClientAlbumScope } from "./layouts/RouteScopes";
import RequireAuth from "./components/RequireAuth";

// Mỗi trang là một chunk riêng: khách vào Client Portal không phải tải code Admin và ngược lại.
const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
});

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/admin/dashboard" replace /> },
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
              { index: true, element: <Navigate to="dashboard" replace /> },
              { path: "dashboard", lazy: page(() => import("./pages/admin/DashboardPage")) },
              { path: "clients", lazy: page(() => import("./pages/admin/ClientsPage")) },
              { path: "settings", lazy: page(() => import("./pages/admin/SettingsPage")) },
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
