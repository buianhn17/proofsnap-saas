// Bước 1.6 — gộp độ nét + trạng thái mắt thành 1 nhãn tổng xanh/vàng/đỏ để hiển thị trong
// UI chính. Ngưỡng độ nét lấy từ kết quả hiệu chỉnh ở công cụ test Bước 1.3
// (/dev/culling-test) — nếu sau này hiệu chỉnh lại, chỉ cần sửa ở đây, cả trang test lẫn
// UI chính đều dùng chung.

import { scorePhoto } from "./burstScoring";
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

// Ảnh không bị đề xuất loại nhưng điểm tổng dưới mức này (hoặc có người chính nheo mắt)
// -> vàng, cần PTG xem lại.
const REVIEW_SCORE_BELOW = 0.55;
const SQUINT_EYE_OPEN_BELOW = 0.5;

/** Nhãn gợi ý cho 1 ảnh theo điểm chất lượng (burstScoring.ts): đỏ = có lý do loại rõ ràng
 * (nhắm mắt, out nét trên mặt người chính, phơi sáng hỏng), vàng = dùng được nhưng nên xem
 * lại, xanh = tốt. Chấm độc lập từng ảnh — vai trò trong chùm burst (best/alternative) là
 * thông tin riêng, không đổi nhãn này. */
export function classifyCullingFlag(metrics: CullingMetrics): CullingFlag {
  const score = scorePhoto(metrics);
  if (score.suggestReject) return "red";
  const squinting = metrics.faces.some(
    (f) => f.isMainSubject && f.eyeOpenScore < SQUINT_EYE_OPEN_BELOW
  );
  if (squinting || score.overall < REVIEW_SCORE_BELOW) return "yellow";
  return "green";
}
