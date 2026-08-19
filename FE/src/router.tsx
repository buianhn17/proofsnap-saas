import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import AdminLayout from "./layouts/AdminLayout";
import ClientLayout from "./layouts/ClientLayout";
import RequireAuth from "./components/RequireAuth";
import { AuthProvider } from "./contexts/AuthContext";
import LoginPage from "./pages/admin/LoginPage";
import AlbumsPage from "./pages/admin/AlbumsPage";
import CreateAlbumPage from "./pages/admin/CreateAlbumPage";
import AlbumDetailPage from "./pages/admin/AlbumDetailPage";
import AlbumAccessPage from "./pages/client/AlbumAccessPage";
import AlbumGalleryPage from "./pages/client/AlbumGalleryPage";

function AdminAuthScope() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/admin/albums" replace /> },
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
      { path: "gallery", element: <AlbumGalleryPage /> },
    ],
  },
]);
