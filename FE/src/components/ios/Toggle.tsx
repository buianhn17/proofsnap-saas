// Công tắc iOS (UISwitch) dùng trong hàng danh sách: checkbox role="switch" thật.
export default function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer items-center has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-zinc-700 transition-colors duration-200 peer-checked:bg-emerald-500 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-400"
      />
      <span
        aria-hidden="true"
        className="absolute left-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.25)] transition-transform duration-200 peer-checked:translate-x-5"
      />
    </label>
  );
}
