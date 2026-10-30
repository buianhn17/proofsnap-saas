// Bước 1.6 — gộp độ nét + trạng thái mắt thành 1 nhãn tổng xanh/vàng/đỏ để hiển thị trong
// UI chính. Ngưỡng độ nét lấy từ kết quả hiệu chỉnh ở công cụ test Bước 1.3
// (/dev/culling-test) — nếu sau này hiệu chỉnh lại, chỉ cần sửa ở đây, cả trang test lẫn
// UI chính đều dùng chung.

import { scorePhoto, type PhotoAnalysisResult } from "./burstScoring";
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

// Ảnh không bị đề xuất loại nhưng điểm tổng dưới mức này -> vàng, cần PTG xem lại (các lý do
// xem lại khác — nheo mắt, ảnh tập thể 20-50% người nhắm mắt — nằm ở burstScoring.ts).
const REVIEW_SCORE_BELOW = 0.55;

/** Nhãn gợi ý cho 1 ảnh theo điểm chất lượng (burstScoring.ts): đỏ = có lý do loại rõ ràng
 * (nhắm mắt, out nét trên mặt người chính), vàng = dùng được nhưng nên xem lại, xanh = tốt.
 * Truyền `analysis` (kết quả scoreBursts) khi đã gom chùm xong để dùng độ mở mắt đã so tương
 * đối trong chùm; không có thì chấm độc lập từng ảnh. Vai trò trong chùm (best/alternative)
 * là thông tin riêng, không đổi nhãn này. */
export function classifyCullingFlag(
  metrics: CullingMetrics,
  analysis?: PhotoAnalysisResult
): CullingFlag {
  if (analysis) {
    if (analysis.suggest_reject) return "red";
    return analysis.needs_review || analysis.overall_score < REVIEW_SCORE_BELOW
      ? "yellow"
      : "green";
  }
  const score = scorePhoto(metrics);
  if (score.suggestReject) return "red";
  if (score.needsReview || score.overall < REVIEW_SCORE_BELOW) return "yellow";
  return "green";
}
