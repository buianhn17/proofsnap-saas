/** Trạng thái đang tải dùng chung (cùng kiểu với màn hình kiểm tra đăng nhập). */
export default function PageSpinner({ label = "Đang tải…", fullHeight = false }: { label?: string; fullHeight?: boolean }) {
  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-3 text-sm text-zinc-400 ${fullHeight ? "min-h-[60dvh]" : "py-16"}`}
    >
      <span className="size-4 animate-spin rounded-full border-2 border-white/15 border-t-indigo-400" aria-hidden="true" />
      {label}
    </div>
  );
}
