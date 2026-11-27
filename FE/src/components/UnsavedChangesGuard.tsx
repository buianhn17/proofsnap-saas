// Chặn rời trang khi còn thay đổi chưa lưu (Web Interface Guidelines: "Unsaved changes trigger a
// warning before navigation"): điều hướng trong app → action sheet xác nhận; đóng tab/tải lại →
// hộp thoại beforeunload của trình duyệt.
import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import ActionSheet from "./ios/ActionSheet";

export default function UnsavedChangesGuard({
  when,
  title = "Bỏ các thay đổi chưa lưu?",
  message = "Những gì bạn vừa nhập sẽ mất nếu rời trang này.",
  leaveLabel = "Bỏ thay đổi",
}: {
  when: boolean;
  title?: string;
  message?: string;
  leaveLabel?: string;
}) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    when && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search)
  );

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [when]);

  return (
    <ActionSheet
      open={blocker.state === "blocked"}
      title={title}
      message={message}
      cancelLabel="Ở lại"
      onClose={() => blocker.reset?.()}
      actions={[{ label: leaveLabel, tone: "destructive", onSelect: () => blocker.proceed?.() }]}
    />
  );
}
