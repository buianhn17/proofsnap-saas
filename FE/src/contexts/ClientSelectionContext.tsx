// Trạng thái chọn ảnh của khách dùng chung cho mọi trang Client Portal (lưới ảnh, lightbox,
// tìm bằng khuôn mặt, thanh tab có huy hiệu số ảnh đã chọn): ảnh đã thả tim, hạn mức (FR-07),
// mốc "hoàn tất chọn ảnh" (mục 5.2) và thông báo toast. Trước đây mỗi trang tự giữ 1 bản riêng
// nên chuyển trang là lệch số liệu.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { isAxiosError } from "axios";
import { api } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { useToast } from "../lib/useToast";
import { ToastViewport } from "../components/Toast";
import { useClientAlbum, useIsAlbumExpired } from "./clientAlbum";
import { SelectionContext, type SelectionContextValue } from "./clientSelection";

interface ToggleResponse {
  selected: boolean;
  selected_count: number;
  max_selectable_photos: number | null;
}



export function ClientSelectionProvider({ children }: { children: ReactNode }) {
  const { album, completedAt: albumCompletedAt, refetch } = useClientAlbum();
  const expired = useIsAlbumExpired();
  const albumId = album?.id ?? null;
  const { toast, showToast, dismiss } = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [serverMax, setServerMax] = useState<number | null | undefined>(undefined);
  // Giá trị hoàn tất mới nhất do chính trang này đặt (complete/reopen/hydrate); chưa có thì
  // dùng giá trị từ lần tải album.
  const [completionOverride, setCompletionOverride] = useState<{ value: string | null } | null>(null);

  const maxSelectable = serverMax !== undefined ? serverMax : (album?.max_selectable_photos ?? null);
  const completedAt = completionOverride ? completionOverride.value : albumCompletedAt;
  const selectedCount = selected.size;
  const limitReached = maxSelectable !== null && selectedCount >= maxSelectable;
  const isReadOnly = expired || completedAt !== null;

  const hydrate = useCallback((ids: string[], max: number | null, completed: string | null) => {
    setSelected(new Set(ids));
    setServerMax(max);
    setCompletionOverride({ value: completed });
  }, []);

  const toggle = useCallback(
    async (photoId: string) => {
      if (!albumId) return;
      if (expired) {
        showToast("Đã hết hạn chọn ảnh.", "warning");
        return;
      }
      if (completedAt) {
        showToast("Bạn đã gửi lựa chọn. Mở lại lựa chọn để thay đổi.", "info");
        return;
      }
      const isSelecting = !selected.has(photoId);
      if (isSelecting && limitReached) {
        showToast(`Bạn đã chọn đủ ${maxSelectable} ảnh. Bỏ chọn bớt 1 ảnh để chọn ảnh khác.`, "warning");
        return;
      }
      try {
        const { data } = await api.post<ToggleResponse>(`/api/public/albums/${albumId}/photos/${photoId}/select`);
        setSelected((prev) => {
          const next = new Set(prev);
          if (data.selected) next.add(photoId);
          else next.delete(photoId);
          return next;
        });
        setServerMax(data.max_selectable_photos);
        if (data.selected && data.max_selectable_photos !== null && data.selected_count >= data.max_selectable_photos) {
          showToast(
            `Đã chọn đủ ${data.selected_count} / ${data.max_selectable_photos} ảnh. Bấm “Gửi lựa chọn” khi bạn đã ưng ý.`,
            "success"
          );
        }
      } catch (err) {
        if (isAxiosError(err) && err.response?.status === 409) {
          const body = err.response.data as Partial<ToggleResponse> & { message?: string; error?: string; completed_at?: string };
          if (body.max_selectable_photos !== undefined) setServerMax(body.max_selectable_photos);
          if (body.error === "SELECTION_COMPLETED") setCompletionOverride({ value: body.completed_at ?? new Date().toISOString() });
          showToast(body.message ?? "Bạn đã chọn đủ số ảnh cho phép.", "warning");
          return;
        }
        if (isAxiosError(err) && err.response?.status === 403) {
          refetch();
          showToast("Đã hết hạn hoặc album bị khoá — không thể thay đổi lựa chọn.", "error");
          return;
        }
        showToast(getErrorMessage(err, "Không lưu được lựa chọn, vui lòng thử lại."), "error");
      }
    },
    [albumId, completedAt, expired, limitReached, maxSelectable, refetch, selected, showToast]
  );

  const complete = useCallback(async () => {
    if (!albumId) return false;
    try {
      const { data } = await api.post<{ completion: { completed_at: string } }>(`/api/public/albums/${albumId}/complete`);
      setCompletionOverride({ value: data.completion.completed_at });
      showToast("Đã gửi lựa chọn cho nhiếp ảnh gia. Cảm ơn bạn!", "success");
      return true;
    } catch (err) {
      showToast(getErrorMessage(err, "Không gửi được lựa chọn, vui lòng thử lại."), "error");
      return false;
    }
  }, [albumId, showToast]);

  const reopen = useCallback(async () => {
    if (!albumId) return false;
    try {
      await api.post(`/api/public/albums/${albumId}/complete/reopen`);
      setCompletionOverride({ value: null });
      showToast("Đã mở lại — bạn có thể thay đổi lựa chọn và ghi chú.", "info");
      return true;
    } catch (err) {
      showToast(getErrorMessage(err, "Không mở lại được lựa chọn."), "error");
      return false;
    }
  }, [albumId, showToast]);

  const value = useMemo<SelectionContextValue>(
    () => ({
      selected,
      selectedCount,
      maxSelectable,
      limitReached,
      completedAt,
      isReadOnly,
      expired,
      hydrate,
      toggle,
      complete,
      reopen,
      showToast,
    }),
    [selected, selectedCount, maxSelectable, limitReached, completedAt, isReadOnly, expired, hydrate, toggle, complete, reopen, showToast]
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
      <ToastViewport toast={toast} onDismiss={dismiss} placement="top" />
    </SelectionContext.Provider>
  );
}
