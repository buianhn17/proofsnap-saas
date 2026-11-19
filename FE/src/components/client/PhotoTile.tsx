// Một ô ảnh trong lưới phía khách — kiểu app Ảnh: ảnh vuông tràn ô, trái tim nhỏ góc dưới cho
// ảnh đã thích, vòng chọn góc dưới phải khi đang chọn ảnh. Máy có chuột thì có thêm nút tim
// hiện khi rê chuột (điện thoại thả tim trong trình xem ảnh, nút to dễ bấm hơn).
import { memo, type ReactNode } from "react";
import { photoTransitionName, publicPhotoUrl } from "../../lib/photoViewing";
import { CheckIcon, HeartIcon } from "../Icons";

interface PhotoTileProps {
  albumId: string;
  photoId: string;
  name: string;
  liked: boolean;
  onOpen: (photoId: string) => void;
  /** Đang ở chế độ chọn ảnh (so sánh) */
  picking?: boolean;
  picked?: boolean;
  onHeart?: (photoId: string) => void;
  heartDisabled?: boolean;
  /** Nhãn góc trên trái (gợi ý AI, % khớp khuôn mặt…) */
  badge?: ReactNode;
  /** false khi ảnh này đang mở trong trình xem — tránh trùng tên view-transition */
  transition?: boolean;
}

function markLoaded(event: React.SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.dataset.loaded = "true";
}

export default memo(function PhotoTile({
  albumId,
  photoId,
  name,
  liked,
  onOpen,
  picking = false,
  picked = false,
  onHeart,
  heartDisabled = false,
  badge,
  transition = true,
}: PhotoTileProps) {
  return (
    <div className="group/tile relative size-full overflow-hidden bg-zinc-900 sm:rounded-lg">
      <button
        type="button"
        onClick={() => onOpen(photoId)}
        aria-label={picking ? `${picked ? "Bỏ chọn" : "Chọn"} ảnh ${name}` : `Xem ảnh ${name}`}
        aria-pressed={picking ? picked : undefined}
        className="block size-full transition-opacity duration-150 active:opacity-70"
      >
        <img
          src={publicPhotoUrl(albumId, photoId, "thumb")}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={markLoaded}
          className={`photo-fade size-full object-cover transition-transform duration-500 pointer-fine:group-hover/tile:scale-[1.03] ${picking && picked ? "scale-[0.92] sm:rounded-md" : ""}`}
          style={{ viewTransitionName: transition ? photoTransitionName(photoId) : undefined }}
        />
      </button>

      {badge}

      {liked && !picking && (
        <span className="pointer-events-none absolute bottom-1 left-1 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]" aria-hidden="true">
          <HeartIcon size={14} fill="currentColor" />
        </span>
      )}

      {picking && (
        <span
          className={`pointer-events-none absolute bottom-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border-2 border-white shadow transition-colors ${
            picked ? "bg-indigo-500 text-white" : "bg-black/20"
          }`}
          aria-hidden="true"
        >
          {picked && <CheckIcon size={14} strokeWidth={3} />}
        </span>
      )}

      {onHeart && !picking && (
        <button
          type="button"
          onClick={() => onHeart(photoId)}
          disabled={heartDisabled}
          aria-pressed={liked}
          aria-label={liked ? `Bỏ thả tim ảnh ${name}` : `Thả tim ảnh ${name}`}
          title={heartDisabled ? "Đã hết hạn chọn ảnh" : undefined}
          className={`absolute right-2 top-2 hidden size-9 items-center justify-center rounded-full backdrop-blur-md transition pointer-fine:flex disabled:cursor-not-allowed ${
            liked
              ? "bg-rose-500 text-white"
              : "bg-black/45 text-white opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100"
          }`}
        >
          <HeartIcon size={17} fill={liked ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
});
