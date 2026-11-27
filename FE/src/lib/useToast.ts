import { useCallback, useRef, useState } from "react";

export type ToastTone = "info" | "warning" | "error" | "success";

export interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

/** State cho ToastViewport (components/Toast.tsx): 1 thông báo tại 1 thời điểm. */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    nextId.current += 1;
    setToast({ id: nextId.current, message, tone });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return { toast, showToast, dismiss };
}
