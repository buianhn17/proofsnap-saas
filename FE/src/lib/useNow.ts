import { useSyncExternalStore } from "react";

// Một bộ đếm 1 giây DÙNG CHUNG cho mọi đồng hồ đếm ngược trên trang — 30 card show không
// tạo 30 setInterval riêng. Interval chỉ chạy khi còn ít nhất 1 component đang lắng nghe.
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => now;

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
