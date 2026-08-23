// Bước 1.7 — chọn ảnh đại diện tốt nhất trong 1 cụm burst: ưu tiên ảnh có tỉ lệ khuôn mặt
// đang mở mắt cao nhất, nếu tỉ lệ như nhau thì chọn ảnh nét nhất trong loạt.

import type { CullingMetrics } from "./types";

// Bước cải tiến — tỉ lệ khuôn mặt đang mở mắt, thay cho xếp hạng nhị phân cũ dựa trên
// eyeStatus worst-case của cả ảnh (chỉ cần 1 người nhắm mắt trong ảnh nhóm đông người là
// cả ảnh bị xếp ngang với ảnh mà TẤT CẢ đều nhắm mắt). Ảnh không có mặt coi tỉ lệ = 1
// (không bị phạt vì thiếu mặt để đánh giá).
function openFacesRatio(metrics: CullingMetrics): number {
  if (metrics.faces.length === 0) return 1;
  const openCount = metrics.faces.filter((f) => f.eyeStatus === "open").length;
  return openCount / metrics.faces.length;
}

export function pickBestInGroup<T>(
  items: T[],
  getMetrics: (item: T) => CullingMetrics
): T | null {
  if (items.length === 0) return null;
  return items.reduce((best, item) => {
    const bestMetrics = getMetrics(best);
    const metrics = getMetrics(item);
    const bestRatio = openFacesRatio(bestMetrics);
    const ratio = openFacesRatio(metrics);
    if (ratio !== bestRatio) return ratio > bestRatio ? item : best;
    return metrics.sharpnessScore > bestMetrics.sharpnessScore ? item : best;
  });
}