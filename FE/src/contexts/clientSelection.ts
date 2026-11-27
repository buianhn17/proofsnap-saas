// Context + hook trạng thái chọn ảnh của khách. Provider nằm ở ClientSelectionContext.tsx.
import { createContext, useContext } from "react";
import type { ToastTone } from "../lib/useToast";

export interface SelectionContextValue {
  selected: Set<string>;
  selectedCount: number;
  maxSelectable: number | null;
  limitReached: boolean;
  completedAt: string | null;
  /** Hết hạn / bị khoá / đã hoàn tất: không thể đổi lựa chọn hay thêm ghi chú. */
  isReadOnly: boolean;
  expired: boolean;
  hydrate: (selectedIds: string[], maxSelectable: number | null, completedAt: string | null) => void;
  toggle: (photoId: string) => Promise<void>;
  complete: () => Promise<boolean>;
  reopen: () => Promise<boolean>;
  showToast: (message: string, tone?: ToastTone) => void;
}

export const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useClientSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useClientSelection phải nằm trong ClientSelectionProvider");
  return ctx;
}
