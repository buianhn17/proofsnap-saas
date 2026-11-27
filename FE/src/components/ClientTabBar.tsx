// Thanh tab dưới của Client Portal trên điện thoại (< md): Thư viện · Đã chọn · Tìm khuôn mặt.
import { useLocation, useParams } from "react-router-dom";
import TabBar from "./ios/TabBar";
import { HeartIcon, ImagesIcon, ScanFaceIcon } from "./Icons";
import { useClientSelection } from "../contexts/clientSelection";

export default function ClientTabBar() {
  const { albumId } = useParams<{ albumId: string }>();
  const { pathname, search } = useLocation();
  const { selectedCount } = useClientSelection();
  const onGallery = pathname.endsWith("/gallery");
  const liked = onGallery && new URLSearchParams(search).get("view") === "liked";
  return (
    <TabBar
      label="Điều hướng album"
      items={[
        { to: `/a/${albumId}/gallery`, label: "Thư viện", icon: <ImagesIcon size={22} />, isActive: onGallery && !liked },
        {
          to: `/a/${albumId}/gallery?view=liked`,
          label: "Đã chọn",
          icon: <HeartIcon size={22} fill={liked ? "currentColor" : "none"} />,
          badge: selectedCount,
          isActive: liked,
        },
        { to: `/a/${albumId}/face-search`, label: "Tìm khuôn mặt", icon: <ScanFaceIcon size={22} />, isActive: pathname.endsWith("/face-search") },
      ]}
    />
  );
}
