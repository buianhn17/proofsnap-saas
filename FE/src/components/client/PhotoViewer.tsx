// Trình xem ảnh toàn màn hình kiểu app Ảnh trên iPhone:
//   - vuốt ngang chuyển ảnh: scroll-snap gốc của trình duyệt → quán tính tự nhiên, khe 20px giữa ảnh
//   - vuốt xuống để đóng (nền mờ dần theo tay), chạm 1 lần ẩn/hiện thanh công cụ
//   - chạm đúp / chụm 2 ngón để zoom, kéo để xem chi tiết khi đang zoom
//   - dải thumbnail ở đáy, phím ← → và Esc, nút trước/sau cho chuột (thay thế cho cử chỉ vuốt)
// Giá trị đổi liên tục theo ngón tay (vị trí, tỉ lệ zoom) giữ trong ref và ghi thẳng vào
// style.transform — không đi qua state, nên không render lại React mỗi khung hình.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { photoTransitionName, prefersReducedMotion, publicPhotoUrl, tapFeedback } from "../../lib/photoViewing";
import { ChevronLeftIcon, ChevronRightIcon, HeartIcon, MessageIcon, XIcon } from "../Icons";

export interface ViewerPhoto {
  id: string;
  name: string;
}

interface PhotoViewerProps {
  albumId: string;
  photos: ViewerPhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  isSelected: (photoId: string) => boolean;
  onToggleSelect?: (photoId: string) => void;
  /** Hết hạn / album khoá: vẫn xem được, không thả tim được */
  selectDisabled?: boolean;
  /** Mở công cụ khoanh vùng + ghi chú cho ảnh đang xem */
  onAnnotate?: (photoId: string) => void;
  /** Đang mở lớp khác đè lên (ghi chú) — tạm ngưng phím tắt của trình xem */
  suspended?: boolean;
}

const GAP = 20;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const SCRUBBER_RADIUS = 12;

export default function PhotoViewer({
  albumId,
  photos,
  index,
  onIndexChange,
  onClose,
  isSelected,
  onToggleSelect,
  selectDisabled = false,
  onAnnotate,
  suspended = false,
}: PhotoViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const indexRef = useRef(index);
  const onIndexChangeRef = useRef(onIndexChange);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [popKey, setPopKey] = useState(0);
  const [reducedMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  });

  const stride = useCallback(() => (trackRef.current?.clientWidth ?? 0) + GAP, []);

  // Đặt đúng vị trí ảnh đang mở trước khi vẽ khung đầu tiên (không thấy trượt từ ảnh 1)
  const initialIndex = useRef(index);
  useLayoutEffect(() => {
    if (trackRef.current) trackRef.current.scrollLeft = initialIndex.current * stride();
  }, [stride]);

  // Đổi ảnh từ bên ngoài (bấm thumbnail, phím mũi tên) → cuộn tới; đổi do tay vuốt thì đã đúng chỗ
  useEffect(() => {
    indexRef.current = index;
    const track = trackRef.current;
    if (!track) return;
    const current = Math.round(track.scrollLeft / stride());
    if (current !== index) {
      track.scrollTo({ left: index * stride(), behavior: reducedMotion || Math.abs(current - index) > 3 ? "auto" : "smooth" });
    }
  }, [index, reducedMotion, stride]);

  // Vuốt ngang → cập nhật ảnh hiện tại khi qua nửa khung (listener passive, gộp theo frame)
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = Math.min(photos.length - 1, Math.max(0, Math.round(track.scrollLeft / stride())));
        if (next !== indexRef.current) {
          indexRef.current = next;
          onIndexChangeRef.current(next);
        }
      });
    };
    // Xoay màn hình / đổi kích thước: bám lại đúng ảnh đang xem
    const resizeObserver = new ResizeObserver(() => {
      track.scrollLeft = indexRef.current * stride();
    });
    track.addEventListener("scroll", onScroll, { passive: true });
    resizeObserver.observe(track);
    return () => {
      track.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [photos.length, stride]);

  // Khoá cuộn trang phía sau + trả focus về chỗ cũ khi đóng
  useEffect(() => {
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    html.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      html.style.overflow = previousOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  const close = useCallback(() => {
    if (reducedMotion) {
      onClose();
      return;
    }
    setClosing(true);
    window.setTimeout(onClose, 140);
  }, [onClose, reducedMotion]);

  useEscapeKey(close, !suspended && !closing);

  const go = useCallback(
    (delta: number) => {
      const next = indexRef.current + delta;
      if (next >= 0 && next < photos.length) onIndexChangeRef.current(next);
    },
    [photos.length]
  );

  useEffect(() => {
    if (suspended) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea")) return;
      if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, suspended]);

  // Vuốt xuống: nền mờ dần + ẩn thanh công cụ — ghi thẳng vào DOM, không render lại
  const onDismissProgress = useCallback((progress: number) => {
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty("--viewer-bg", String(1 - Math.min(progress, 1) * 0.85));
    root.dataset.dragging = progress > 0 ? "true" : "false";
  }, []);

  const toggleChrome = useCallback(() => setChromeVisible((v) => !v), []);

  const current = photos[index];
  const selected = current ? isSelected(current.id) : false;

  function handleHeart() {
    if (!current || !onToggleSelect || selectDisabled) return;
    onToggleSelect(current.id);
    setPopKey((k) => k + 1);
    tapFeedback();
  }

  const scrubberStart = Math.max(0, index - SCRUBBER_RADIUS);
  const scrubber = photos.slice(scrubberStart, index + SCRUBBER_RADIUS + 1);
  const barVisibility = chromeVisible ? "opacity-100" : "pointer-events-none opacity-0";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Xem ảnh"
      data-dragging="false"
      className={`group fixed inset-0 z-50 select-none overscroll-none transition-[opacity,transform] duration-150 ${
        closing ? "scale-[0.98] opacity-0" : "opacity-100"
      }`}
      style={{ backgroundColor: "rgb(0 0 0 / var(--viewer-bg, 1))" }}
    >
      <p className="sr-only" aria-live="polite">
        {current ? `Ảnh ${index + 1} trên ${photos.length}: ${current.name}` : ""}
      </p>

      {/* Dải ảnh — cuộn ngang gốc của trình duyệt, khoá lại khi đang zoom */}
      <div
        ref={trackRef}
        className={`no-scrollbar flex h-full snap-x snap-mandatory overscroll-x-contain ${zoomed ? "overflow-hidden" : "overflow-x-auto"}`}
        style={{ gap: GAP }}
      >
        {photos.map((photo, i) => (
          <Slide
            key={photo.id}
            albumId={albumId}
            photo={photo}
            near={Math.abs(i - index) <= 2}
            active={i === index}
            onTap={toggleChrome}
            onDismiss={close}
            onDismissProgress={onDismissProgress}
            onZoomChange={setZoomed}
          />
        ))}
      </div>

      {/* Thanh trên */}
      <div
        className={`absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-2 pb-6 pt-[max(0.5rem,env(safe-area-inset-top))] transition-opacity duration-200 group-data-[dragging=true]:opacity-0 ${barVisibility}`}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={close}
          aria-label="Đóng"
          className="flex size-11 items-center justify-center rounded-full text-white transition active:scale-90 hover:bg-white/10"
        >
          <XIcon size={22} />
        </button>
        <div className="min-w-0 text-center">
          <p className="text-sm font-semibold tabular-nums text-white">
            {index + 1} / {photos.length}
          </p>
          <p className="truncate text-[11px] text-white/60" translate="no">{current?.name}</p>
        </div>
        <span className="size-11" aria-hidden="true" />
      </div>

      {/* Nút trước / sau cho chuột & bàn phím (thay thế cho cử chỉ vuốt) */}
      {(["prev", "next"] as const).map((dir) => {
        const disabled = dir === "prev" ? index === 0 : index === photos.length - 1;
        return (
          <button
            key={dir}
            type="button"
            onClick={() => go(dir === "prev" ? -1 : 1)}
            disabled={disabled}
            aria-label={dir === "prev" ? "Ảnh trước" : "Ảnh tiếp theo"}
            className={`absolute top-1/2 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 disabled:opacity-0 pointer-fine:flex ${
              dir === "prev" ? "left-4" : "right-4"
            } ${barVisibility}`}
          >
            {dir === "prev" ? <ChevronLeftIcon size={24} /> : <ChevronRightIcon size={24} />}
          </button>
        );
      })}

      {/* Thanh dưới: dải thumbnail + hành động */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-8 transition-opacity duration-200 group-data-[dragging=true]:opacity-0 ${barVisibility}`}
      >
        <div className="flex h-11 items-center justify-center gap-0.5 overflow-hidden" role="group" aria-label="Chọn nhanh ảnh">
          {scrubber.map((photo, offset) => {
            const i = scrubberStart + offset;
            const active = i === index;
            return (
              <button
                key={photo.id}
                type="button"
                onClick={() => onIndexChange(i)}
                aria-label={`Ảnh ${i + 1}`}
                aria-current={active ? "true" : undefined}
                tabIndex={active ? 0 : -1}
                className={`h-10 shrink-0 overflow-hidden bg-zinc-800 transition-[width,margin] duration-200 ${active ? "mx-1.5 w-10 rounded-[3px]" : "w-6 opacity-80"}`}
              >
                <img src={publicPhotoUrl(albumId, photo.id, "thumb")} alt="" className="size-full object-cover" decoding="async" draggable={false} />
              </button>
            );
          })}
        </div>

        <div className="mx-auto mt-2 flex max-w-md items-center justify-between px-4">
          {onAnnotate ? (
            <button
              type="button"
              onClick={() => current && onAnnotate(current.id)}
              className="flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-white transition active:scale-95"
            >
              <MessageIcon size={22} />
              <span className="text-[11px] font-medium">Ghi chú</span>
            </button>
          ) : (
            <span className="min-w-16" aria-hidden="true" />
          )}

          {onToggleSelect && (
            <button
              type="button"
              onClick={handleHeart}
              disabled={selectDisabled}
              aria-pressed={selected}
              aria-label={selected ? "Bỏ thả tim ảnh này" : "Thả tim ảnh này"}
              title={selectDisabled ? "Đã hết hạn chọn ảnh" : undefined}
              className="flex size-14 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition active:scale-90 disabled:opacity-40"
            >
              <span key={popKey} className={`flex ${popKey ? "animate-heart-pop" : ""} ${selected ? "text-rose-500" : ""}`}>
                <HeartIcon size={28} fill={selected ? "currentColor" : "none"} />
              </span>
            </button>
          )}

          <span className="flex min-w-16 flex-col items-center text-[11px] text-white/60" aria-hidden="true">
            {selectDisabled ? "Hết hạn chọn" : selected ? "Đã thích" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 1 ảnh: zoom + vuốt đóng

interface SlideProps {
  albumId: string;
  photo: ViewerPhoto;
  /** Trong khoảng ±2 ảnh quanh ảnh đang xem → mới tải ảnh (tải trước ảnh kế tiếp) */
  near: boolean;
  active: boolean;
  onTap: () => void;
  onDismiss: () => void;
  onDismissProgress: (progress: number) => void;
  onZoomChange: (zoomed: boolean) => void;
}

type Mode = "idle" | "undecided" | "pan" | "pinch" | "dismiss" | "none";

const Slide = memo(function Slide({ albumId, photo, near, active, onTap, onDismiss, onDismissProgress, onZoomChange }: SlideProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLImageElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  // Vị trí/tỉ lệ hiện tại — đổi liên tục theo tay nên để trong ref
  const view = useRef({ scale: 1, x: 0, y: 0 });

  const callbacks = useRef({ onTap, onDismiss, onDismissProgress, onZoomChange });
  useEffect(() => {
    callbacks.current = { onTap, onDismiss, onDismissProgress, onZoomChange };
  });

  const apply = useCallback((animate: boolean) => {
    const layer = layerRef.current;
    if (!layer) return;
    const { scale, x, y } = view.current;
    layer.style.transition = animate ? `transform 0.28s ${EASE}` : "none";
    layer.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  }, []);

  const setZoomState = useCallback((value: boolean) => {
    setZoomed(value);
    callbacks.current.onZoomChange(value);
  }, []);

  // Rời khỏi ảnh này (vuốt sang ảnh khác) → trả về tỉ lệ 1
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setZoomed(false);
  }
  useEffect(() => {
    if (active) return;
    view.current = { scale: 1, x: 0, y: 0 };
    apply(false);
  }, [active, apply]);

  useEffect(() => {
    if (!active) return;
    const stage = stageRef.current;
    if (!stage) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let mode: Mode = "idle";
    let start = { x: 0, y: 0, time: 0 };
    let base = { scale: 1, x: 0, y: 0 };
    let pinchStart = { dist: 1, midX: 0, midY: 0 };
    let lastTap = { time: 0, x: 0, y: 0 };
    let tapTimer = 0;
    let dismissY = 0;

    const center = () => {
      const r = stage.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
    };

    // Kích thước ảnh đang hiển thị (object-contain) ở tỉ lệ 1 — để giới hạn vùng kéo khi zoom
    const contentSize = () => {
      const { w, h } = center();
      const img = previewRef.current;
      const nw = img?.naturalWidth || w;
      const nh = img?.naturalHeight || h;
      const ratio = Math.min(w / nw, h / nh);
      return { cw: nw * ratio, ch: nh * ratio, w, h };
    };

    const clampPan = () => {
      const { cw, ch, w, h } = contentSize();
      const { scale } = view.current;
      const maxX = Math.max(0, (cw * scale - w) / 2);
      const maxY = Math.max(0, (ch * scale - h) / 2);
      view.current.x = Math.min(maxX, Math.max(-maxX, view.current.x));
      view.current.y = Math.min(maxY, Math.max(-maxY, view.current.y));
    };

    const zoomTo = (scale: number, clientX: number, clientY: number) => {
      const { cx, cy } = center();
      // Giữ nguyên điểm dưới ngón tay khi phóng to
      const px = clientX - cx;
      const py = clientY - cy;
      const { scale: s0, x: x0, y: y0 } = view.current;
      const contentX = (px - x0) / s0;
      const contentY = (py - y0) / s0;
      view.current = { scale, x: px - scale * contentX, y: py - scale * contentY };
      if (scale === 1) view.current = { scale: 1, x: 0, y: 0 };
      clampPan();
      apply(true);
      setZoomState(scale > 1);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      stage.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const { cx, cy } = center();
        mode = "pinch";
        window.clearTimeout(tapTimer);
        base = { ...view.current };
        pinchStart = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          midX: (a.x + b.x) / 2 - cx,
          midY: (a.y + b.y) / 2 - cy,
        };
        return;
      }
      if (pointers.size === 1) {
        start = { x: event.clientX, y: event.clientY, time: performance.now() };
        base = { ...view.current };
        mode = view.current.scale > 1 ? "pan" : "undecided";
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;

      if (mode === "pinch" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const { cx, cy } = center();
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2 - cx;
        const midY = (a.y + b.y) / 2 - cy;
        // Cho kéo quá giới hạn một chút rồi bật về (rubber band)
        const raw = (base.scale * dist) / pinchStart.dist;
        const scale = raw < 1 ? 1 - (1 - raw) * 0.4 : raw > MAX_SCALE ? MAX_SCALE + (raw - MAX_SCALE) * 0.2 : raw;
        const contentX = (pinchStart.midX - base.x) / base.scale;
        const contentY = (pinchStart.midY - base.y) / base.scale;
        view.current = { scale, x: midX - scale * contentX, y: midY - scale * contentY };
        apply(false);
        return;
      }
      if (mode === "pan") {
        view.current = { ...view.current, x: base.x + dx, y: base.y + dy };
        apply(false);
        return;
      }
      if (mode === "undecided" && Math.hypot(dx, dy) > 8) {
        // Kéo dọc xuống → đóng; kéo ngang → để trình duyệt cuộn sang ảnh khác
        mode = dy > 0 && Math.abs(dy) > Math.abs(dx) ? "dismiss" : "none";
      }
      if (mode === "dismiss") {
        dismissY = Math.max(0, dy);
        const shrink = 1 - Math.min(dismissY / 1600, 0.25);
        const layer = layerRef.current;
        if (layer) {
          layer.style.transition = "none";
          layer.style.transform = `translate3d(${dx * 0.4}px, ${dismissY}px, 0) scale(${shrink})`;
        }
        callbacks.current.onDismissProgress(dismissY / 420);
      }
    };

    const endGesture = (event: PointerEvent, cancelled: boolean) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;

      if (mode === "pinch") {
        if (pointers.size > 0) {
          // Còn 1 ngón: chuyển sang kéo, không giật
          const [rest] = [...pointers.values()];
          start = { x: rest.x, y: rest.y, time: performance.now() };
          base = { ...view.current };
          mode = view.current.scale > 1 ? "pan" : "none";
          return;
        }
        const target = Math.min(MAX_SCALE, Math.max(1, view.current.scale));
        if (target <= 1.02) view.current = { scale: 1, x: 0, y: 0 };
        else view.current.scale = target;
        clampPan();
        apply(true);
        setZoomState(view.current.scale > 1);
        mode = "idle";
        return;
      }

      if (mode === "pan") {
        clampPan();
        apply(true);
        mode = "idle";
        // Chạm (không kéo) khi đang zoom vẫn là chạm / chạm đúp
        if (Math.hypot(dx, dy) > 10) return;
      }

      if (mode === "dismiss") {
        const elapsed = Math.max(1, performance.now() - start.time);
        const velocity = dismissY / elapsed;
        mode = "idle";
        if (!cancelled && (dismissY > 110 || velocity > 0.6)) {
          callbacks.current.onDismiss();
          return;
        }
        view.current = { scale: 1, x: 0, y: 0 };
        apply(true);
        callbacks.current.onDismissProgress(0);
        return;
      }

      const isTap = !cancelled && (mode === "undecided" || mode === "idle") && Math.hypot(dx, dy) < 10 && performance.now() - start.time < 300;
      mode = "idle";
      if (!isTap) return;

      const now = performance.now();
      if (now - lastTap.time < 280 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 40) {
        // Chạm đúp: phóng to tại điểm chạm / thu về
        window.clearTimeout(tapTimer);
        lastTap = { time: 0, x: 0, y: 0 };
        zoomTo(view.current.scale > 1 ? 1 : DOUBLE_TAP_SCALE, event.clientX, event.clientY);
        return;
      }
      lastTap = { time: now, x: event.clientX, y: event.clientY };
      // Chờ xem có chạm lần 2 không rồi mới ẩn/hiện thanh công cụ
      tapTimer = window.setTimeout(() => callbacks.current.onTap(), 260);
    };

    const onPointerUp = (event: PointerEvent) => endGesture(event, false);
    // Trình duyệt giành cử chỉ để cuộn ngang → huỷ cử chỉ của mình, trả ảnh về chỗ cũ
    const onPointerCancel = (event: PointerEvent) => endGesture(event, true);

    // Chụm trên trackpad (ctrl + wheel) để zoom trên máy tính
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const next = Math.min(MAX_SCALE, Math.max(1, view.current.scale * Math.exp(-event.deltaY * 0.01)));
      zoomTo(next, event.clientX, event.clientY);
    };

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerCancel);
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.clearTimeout(tapTimer);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerCancel);
      stage.removeEventListener("wheel", onWheel);
    };
  }, [active, apply, setZoomState]);

  return (
    <div
      ref={stageRef}
      className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden"
      // Chưa zoom: trình duyệt lo vuốt ngang (cuộn gốc, có quán tính), mình lo vuốt dọc + chụm
      style={{ touchAction: zoomed ? "none" : "pan-x" }}
    >
      {near && (
        <div
          ref={layerRef}
          className="absolute inset-0 will-change-transform"
          style={{ viewTransitionName: active ? photoTransitionName(photo.id) : undefined }}
        >
          {/* Thumbnail (đã có sẵn trong cache từ lưới) hiện ngay, bản nét hiện dần lên trên */}
          <img
            src={publicPhotoUrl(albumId, photo.id, "thumb")}
            alt=""
            aria-hidden="true"
            draggable={false}
            className={`absolute inset-0 size-full object-contain transition-opacity duration-300 ${previewLoaded ? "opacity-0" : "opacity-100"}`}
          />
          <img
            ref={previewRef}
            src={publicPhotoUrl(albumId, photo.id, "preview")}
            alt={photo.name}
            draggable={false}
            fetchPriority={active ? "high" : "low"}
            decoding="async"
            onLoad={() => setPreviewLoaded(true)}
            className={`absolute inset-0 size-full object-contain transition-opacity duration-300 ${previewLoaded ? "opacity-100" : "opacity-0"}`}
          />
        </div>
      )}
    </div>
  );
});
