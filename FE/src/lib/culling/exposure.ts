// Đánh giá phơi sáng tổng thể từ histogram độ sáng (luminance) của ảnh đã thu nhỏ.
// Chỉ bắt các lỗi RÕ RÀNG (cháy sáng/mất chi tiết vùng tối diện rộng, ảnh tối/sáng hẳn) —
// ảnh low-key/high-key có chủ đích vẫn có thể bị gắn cờ, nên đây chỉ là GỢI Ý loại, trọng
// số trong điểm tổng cũng thấp (10%, xem burstScoring.ts).

export interface ExposureResult {
  /** 0 (hỏng phơi sáng nặng) -> 1 (phơi sáng cân bằng). */
  score: number;
  /** Độ sáng trung bình 0-255. */
  meanLuma: number;
  /** Tỉ lệ pixel gần như đen tuyệt đối (<= SHADOW_CLIP_LEVEL). */
  shadowClipRatio: number;
  /** Tỉ lệ pixel gần như trắng tuyệt đối (>= HIGHLIGHT_CLIP_LEVEL). */
  highlightClipRatio: number;
  underexposed: boolean;
  overexposed: boolean;
}

const SHADOW_CLIP_LEVEL = 8;
const HIGHLIGHT_CLIP_LEVEL = 250;
// Ngưỡng gắn cờ: trung bình quá tối/sáng, HOẶC vùng mất chi tiết chiếm diện tích lớn.
const UNDEREXPOSED_MEAN_BELOW = 45;
const OVEREXPOSED_MEAN_ABOVE = 210;
const SHADOW_CLIP_FLAG_RATIO = 0.35;
const HIGHLIGHT_CLIP_FLAG_RATIO = 0.2;
// Lệch khỏi khoảng trung tính 70-180 bao nhiêu thì bắt đầu trừ điểm.
const COMFORT_LOW = 70;
const COMFORT_HIGH = 180;

export function computeExposure(imageData: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): ExposureResult {
  const { data } = imageData;
  const pixelCount = data.length / 4;
  if (pixelCount === 0) {
    return {
      score: 0,
      meanLuma: 0,
      shadowClipRatio: 0,
      highlightClipRatio: 0,
      underexposed: false,
      overexposed: false,
    };
  }

  let lumaSum = 0;
  let shadowClipped = 0;
  let highlightClipped = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lumaSum += luma;
    if (luma <= SHADOW_CLIP_LEVEL) shadowClipped += 1;
    else if (luma >= HIGHLIGHT_CLIP_LEVEL) highlightClipped += 1;
  }

  const meanLuma = lumaSum / pixelCount;
  const shadowClipRatio = shadowClipped / pixelCount;
  const highlightClipRatio = highlightClipped / pixelCount;

  const meanPenalty =
    meanLuma < COMFORT_LOW
      ? (COMFORT_LOW - meanLuma) / COMFORT_LOW
      : meanLuma > COMFORT_HIGH
        ? (meanLuma - COMFORT_HIGH) / (255 - COMFORT_HIGH)
        : 0;
  // Vùng cháy sáng bị phạt nặng hơn vùng tối (khó cứu khi hậu kỳ hơn).
  const clipPenalty = shadowClipRatio * 1.2 + highlightClipRatio * 2;
  const score = Math.max(0, Math.min(1, 1 - 0.6 * meanPenalty - clipPenalty));

  return {
    score,
    meanLuma,
    shadowClipRatio,
    highlightClipRatio,
    underexposed:
      meanLuma < UNDEREXPOSED_MEAN_BELOW || shadowClipRatio > SHADOW_CLIP_FLAG_RATIO,
    overexposed:
      meanLuma > OVEREXPOSED_MEAN_ABOVE || highlightClipRatio > HIGHLIGHT_CLIP_FLAG_RATIO,
  };
}
