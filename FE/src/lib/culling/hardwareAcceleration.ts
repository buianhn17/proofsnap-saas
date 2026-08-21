// Bước 1.4 — phát hiện khả năng tăng tốc phần cứng của trình duyệt.
//
// LƯU Ý QUAN TRỌNG: MediaPipe FaceLandmarker (đang dùng ở eyeStatus.ts) không chạy qua
// WebGPU thật (navigator.gpu) — delegate "GPU" của nó dùng WebGL. WebGPU thật (qua ONNX
// Runtime Web hoặc tương đương) cần model ở định dạng ONNX, trong khi model hiện tại là
// .task/tflite của Google nên không áp dụng được ở đây. Vì vậy module này detect
// navigator.gpu để HIỂN THỊ tín hiệu phần cứng, còn tầng tăng tốc thực sự so sánh trong
// công cụ test là GPU delegate (WebGL) so với WASM delegate (CPU, đa luồng nếu trang được
// cross-origin isolated). Xem CullingPipelineOptions trong cullingPipeline.ts.

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