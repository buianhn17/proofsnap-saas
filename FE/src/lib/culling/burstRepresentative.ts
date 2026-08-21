// Bước 1.7 — chọn ảnh đại diện tốt nhất trong 1 cụm burst: ưu tiên mắt mở/không có mặt
// trước (mắt nhắm gần như luôn bị loại bất kể nét, cùng logic với cullingFlag.ts), nếu
// mắt như nhau thì chọn ảnh nét nhất trong loạt.

import type { CullingMetrics } from "./types";

const EYE_STATUS_RANK: Record<CullingMetrics["eyeStatus"], number> = {
  open: 0,
  no_face: 0,
  squint: 1,
  closed: 2,
};

export function pickBestInGroup<T>(
  items: T[],
  getMetrics: (item: T) => CullingMetrics
): T | null {
  if (items.length === 0) return null;
  return items.reduce((best, item) => {
    const bestMetrics = getMetrics(best);
    const metrics = getMetrics(item);
    const bestRank = EYE_STATUS_RANK[bestMetrics.eyeStatus];
    const rank = EYE_STATUS_RANK[metrics.eyeStatus];
    if (rank !== bestRank) return rank < bestRank ? item : best;
    return metrics.sharpnessScore > bestMetrics.sharpnessScore ? item : best;
  });
}