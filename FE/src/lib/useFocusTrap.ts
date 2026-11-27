import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[inert], [aria-hidden='true']") && el.getClientRects().length > 0
  );
}

// Hộp thoại mở chồng nhau: chỉ hộp thoại TRÊN CÙNG giữ focus.
const trapStack: symbol[] = [];

/**
 * Giữ focus bàn phím trong hộp thoại đang mở (mẫu ARIA "dialog (modal)", WCAG 2.4.3): Tab ở
 * phần tử cuối quay về phần tử đầu và ngược lại; focus lọt ra ngoài (VD bấm chuột ra nền) được
 * kéo về hộp thoại. Không tự đặt focus ban đầu — mỗi hộp thoại tự chọn phần tử nhận focus đầu.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const id = Symbol("focus-trap");
    trapStack.push(id);
    const isTop = () => trapStack[trapStack.length - 1] === id;
    function onKeyDown(event: KeyboardEvent) {
      const container = containerRef.current;
      if (event.key !== "Tab" || !container || !isTop()) return;
      const items = focusableIn(container);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const inside = current ? container.contains(current) : false;
      if (event.shiftKey && (current === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }
    function onFocusIn(event: FocusEvent) {
      const container = containerRef.current;
      if (!container || !isTop() || container.contains(event.target as Node)) return;
      focusableIn(container)[0]?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      trapStack.splice(trapStack.indexOf(id), 1);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [containerRef, active]);
}
