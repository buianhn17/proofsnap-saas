// Liên kết "Bỏ qua tới nội dung chính" — phần tử đầu tiên nhận Tab, chỉ hiện khi được focus
// (WCAG 2.4.1 Bypass Blocks). Đích là <main id="main" tabIndex={-1}>.
export default function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-[max(0.75rem,env(safe-area-inset-top))] focus-visible:z-[70] focus-visible:rounded-lg focus-visible:bg-indigo-500 focus-visible:px-4 focus-visible:py-2.5 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white"
    >
      Bỏ qua tới nội dung chính
    </a>
  );
}
