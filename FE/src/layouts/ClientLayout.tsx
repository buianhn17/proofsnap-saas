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
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-white/10 text-white"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
      }`}
    >
      {children}
    </Link>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-zinc-900">
        <svg
          className="size-4 text-zinc-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" className="opacity-30" />
          <path d="m14.31 8 5.74 9.94" />
          <path d="M9.69 8h11.48" />
          <path d="m7.38 12 5.74-9.94" />
          <path d="M9.69 16 3.95 6.06" />
          <path d="M14.31 16H2.83" />
          <path d="m16.62 12-5.74 9.94" />
        </svg>
        <span className="absolute size-1 rounded-full bg-indigo-400" />
      </div>
      <span className="text-base font-bold tracking-tight text-white" translate="no">
        LensProof
      </span>
    </div>
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

  const nav = isAlbumScoped ? (
    <>
      <NavItem to={`/a/${albumId}/gallery`} active={isGallery}>
        Thư viện
      </NavItem>
      <NavItem to={`/a/${albumId}/gallery?view=liked`} active={isLiked}>
        Yêu thích
      </NavItem>
      <NavItem to={`/a/${albumId}/face-search`} active={isFaceSearch}>
        Tìm bằng khuôn mặt
      </NavItem>
    </>
  ) : null;

  return (
    <div className="min-h-dvh bg-[#090a0f] text-zinc-100 antialiased selection:bg-indigo-500/30">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <BrandMark />
          {nav && (
            <nav aria-label="Điều hướng album" className="hidden items-center gap-1 sm:flex">
              {nav}
            </nav>
          )}
        </div>
        {/* Trên mobile nav xuống hàng riêng, cuộn ngang được — không bị ẩn mất */}
        {nav && (
          <nav
            aria-label="Điều hướng album"
            className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:hidden"
          >
            {nav}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
