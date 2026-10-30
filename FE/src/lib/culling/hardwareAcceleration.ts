// Bước 1.4 — phát hiện khả năng tăng tốc phần cứng của trình duyệt.
//
// Tầng "gpu" giờ chỉ áp dụng cho SCRFD (faceDetector.ts, ONNX Runtime Web qua WebGPU thật);
// "wasm" chạy SCRFD trên CPU. MediaPipe FaceLandmarker (eyeStatus.ts) luôn chạy CPU ở cả 2
// tầng — xem lý do ở createFaceLandmarker. Module này detect navigator.gpu để HIỂN THỊ tín
// hiệu phần cứng trong công cụ test.

export type AccelerationTier = "gpu" | "wasm";

export interface HardwareInfo {
  /** navigator.gpu tồn tại — chỉ là tín hiệu trình duyệt CÓ hỗ trợ WebGPU API, không có
   * nghĩa MediaPipe đang dùng nó (xem ghi chú đầu file). */
  webGpuFlagPresent: boolean;
  /** Đã gọi navigator.gpu.requestAdapter() và nhận được adapter thật (tín hiệu chắc chắn
   * hơn webGpuFlagPresent — máy có thể có navigator.gpu nhưng không adapter khả dụng). */
  webGpuAdapterAvailable: boolean;
  /** self.crossOriginIsolated — điều kiện bắt buộc để WASM chạy đa luồng (SharedArrayBuffer). */
  crossOriginIsolated: boolean;
  /** navigator.hardwareConcurrency — số luồng CPU logic, giới hạn trên cho WASM đa luồng. */
  hardwareConcurrency: number;
}

export function isWebGpuFlagPresent(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function isCrossOriginIsolatedForThreads(): boolean {
  return typeof self !== "undefined" && self.crossOriginIsolated === true;
}

async function detectWebGpuAdapter(): Promise<boolean> {
  if (!isWebGpuFlagPresent()) return false;
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    return adapter != null;
  } catch {
    return false;
  }
}

export async function getHardwareInfo(): Promise<HardwareInfo> {
  return {
    webGpuFlagPresent: isWebGpuFlagPresent(),
    webGpuAdapterAvailable: await detectWebGpuAdapter(),
    crossOriginIsolated: isCrossOriginIsolatedForThreads(),
    hardwareConcurrency:
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1,
  };
}