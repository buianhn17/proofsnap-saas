import { Link, Outlet, useLocation, useParams } from "react-router-dom";

function NavItem({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`text-sm font-medium ${
        active ? "text-[#e5e2e1]" : "text-[#c1c6d4] hover:text-[#e5e2e1]"
      }`}
    >
      {children}
    </Link>
  );
}

export default function ClientLayout() {
  const { albumId } = useParams<{ albumId: string }>();
  const location = useLocation();
  // Trang nhập PIN (index route "/a/:albumId") chưa có phiên client — chỉ hiện thanh nav
  // đầy đủ (Thư viện/Yêu thích/Tìm kiếm AI) cho các trang SAU khi đã vào được album.
  const isAlbumScoped = albumId !== undefined && location.pathname !== `/a/${albumId}`;
  const isLiked = location.pathname.endsWith("/gallery") && location.search.includes("view=liked");
  const isGallery = location.pathname.endsWith("/gallery") && !isLiked;
  const isFaceSearch = location.pathname.endsWith("/face-search");

  return (
    <div className="min-h-screen bg-[#131313]">
      <header className="border-b border-[#43474f] bg-[#1c1b1b] px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-[#e5e2e1]">LensProof</span>
            <span className="rounded-full border border-[#43474f] bg-[#2a2a2a] px-2.5 py-1 text-xs font-medium text-[#c1c6d4]">
              Client Portal
            </span>
          </div>
          {isAlbumScoped && (
            <>
              <nav className="hidden items-center gap-8 sm:flex">
                <NavItem to={`/a/${albumId}/gallery`} active={isGallery}>
                  Thư viện
                </NavItem>
                <NavItem to={`/a/${albumId}/gallery?view=liked`} active={isLiked}>
                  Yêu thích
                </NavItem>
                <NavItem to={`/a/${albumId}/face-search`} active={isFaceSearch}>
                  Tìm kiếm AI
                </NavItem>
              </nav>
              <span className="text-lg text-[#c1c6d4]" aria-hidden>
                🔔
              </span>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
