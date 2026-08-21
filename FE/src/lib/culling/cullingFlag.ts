// Bước 1.6 — gộp độ nét + trạng thái mắt thành 1 nhãn tổng xanh/vàng/đỏ để hiển thị trong
// UI chính. Ngưỡng độ nét lấy từ kết quả hiệu chỉnh ở công cụ test Bước 1.3
// (/dev/culling-test) — nếu sau này hiệu chỉnh lại, chỉ cần sửa ở đây, cả trang test lẫn
// UI chính đều dùng chung.

import type { CullingMetrics, SharpnessThresholds } from "./types";

export type CullingFlag = "green" | "yellow" | "red";

export const DEFAULT_SHARPNESS_THRESHOLDS: SharpnessThresholds = {
  redBelow: 30,
  yellowBelow: 80,
};

export function sharpnessBucket(
  score: number,
  thresholds: SharpnessThresholds = DEFAULT_SHARPNESS_THRESHOLDS
): CullingFlag {
  if (score < thresholds.redBelow) return "red";
  if (score < thresholds.yellowBelow) return "yellow";
  return "green";
}

/** Mắt nhắm luôn kéo xuống đỏ bất kể độ nét — ảnh nhắm mắt gần như chắc chắn bị loại. */
export function classifyCullingFlag(
  metrics: CullingMetrics,
  thresholds: SharpnessThresholds = DEFAULT_SHARPNESS_THRESHOLDS
): CullingFlag {
  if (metrics.eyeStatus === "closed") return "red";
  const bucket = sharpnessBucket(metrics.sharpnessScore, thresholds);
  if (bucket === "red") return "red";
  if (bucket === "yellow" || metrics.eyeStatus === "squint") return "yellow";
  return "green";
}