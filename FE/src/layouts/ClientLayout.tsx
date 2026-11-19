import { Link, Outlet, useLocation, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { HeartIcon, ImagesIcon, ScanFaceIcon } from "../components/Icons";

interface Tab {
  key: "gallery" | "liked" | "face";
  to: string;
  label: string;
  icon: (active: boolean) => ReactNode;
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
  // Trang nhập PIN (index route "/a/:albumId") chưa có phiên client — chỉ hiện điều hướng
  // album cho các trang SAU khi đã vào được album.
  const isAlbumScoped = albumId !== undefined && location.pathname !== `/a/${albumId}`;
  const isLiked = location.pathname.endsWith("/gallery") && location.search.includes("view=liked");
  const isGallery = location.pathname.endsWith("/gallery") && !isLiked;
  const isFaceSearch = location.pathname.endsWith("/face-search");
  const activeKey: Tab["key"] | null = isGallery ? "gallery" : isLiked ? "liked" : isFaceSearch ? "face" : null;

  const tabs: Tab[] = [
    { key: "gallery", to: `/a/${albumId}/gallery`, label: "Thư viện", icon: () => <ImagesIcon size={24} /> },
    {
      key: "liked",
      to: `/a/${albumId}/gallery?view=liked`,
      label: "Yêu thích",
      icon: (active) => <HeartIcon size={24} fill={active ? "currentColor" : "none"} />,
    },
    { key: "face", to: `/a/${albumId}/face-search`, label: "Khuôn mặt", icon: () => <ScanFaceIcon size={24} /> },
  ];

  return (
    <div className="min-h-dvh bg-[#090a0f] text-zinc-100 antialiased selection:bg-indigo-500/30">
      {/* Header: máy tính luôn có; điện thoại chỉ ở trang nhập PIN (trong album dùng tiêu đề lớn + thanh tab) */}
      <header
        className={`sticky top-0 z-30 border-b border-white/10 bg-zinc-950/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl ${
          isAlbumScoped ? "hidden sm:block" : ""
        }`}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <BrandMark />
          {isAlbumScoped && (
            <nav aria-label="Điều hướng album" className="flex items-center gap-1">
              {tabs.map((tab) => (
                <Link
                  key={tab.key}
                  to={tab.to}
                  aria-current={activeKey === tab.key ? "page" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeKey === tab.key ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main
        className={`mx-auto max-w-6xl px-4 sm:px-6 sm:py-8 ${
          isAlbumScoped
            ? "pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-[max(1rem,env(safe-area-inset-top))] sm:pb-8"
            : "py-6"
        }`}
      >
        <Outlet />
      </main>

      {/* Thanh tab đáy kiểu iOS (điện thoại) — nền kính mờ, icon + nhãn, chừa vùng home indicator */}
      {isAlbumScoped && (
        <nav
          aria-label="Điều hướng album"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-zinc-950/75 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 sm:hidden"
        >
          <ul className="mx-auto grid h-14 max-w-md grid-cols-3">
            {tabs.map((tab) => {
              const active = activeKey === tab.key;
              return (
                <li key={tab.key}>
                  <Link
                    to={tab.to}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors active:opacity-60 ${
                      active ? "text-indigo-400" : "text-zinc-400"
                    }`}
                  >
                    {tab.icon(active)}
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
