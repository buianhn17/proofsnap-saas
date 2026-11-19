import { useEffect, useRef } from "react";

/**
 * Gọi `onEscape` khi người dùng nhấn Esc — dùng cho modal/lightbox.
 * Bỏ qua khi đang gõ trong textarea để không mất bản nháp ghi chú.
 * Giữ callback mới nhất trong ref nên listener chỉ gắn một lần.
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  });

  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea, [contenteditable='true']")) return;
      handlerRef.current();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
