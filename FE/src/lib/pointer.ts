/** Thiết bị có chuột/bàn di (không phải màn cảm ứng) — dùng để chỉ autoFocus trên desktop. */
export function hasFinePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches === true;
}
