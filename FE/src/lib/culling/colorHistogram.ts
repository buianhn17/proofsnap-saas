// Bước 1.7 — histogram màu đơn giản (RGB, 4 mức mỗi kênh = 64 bin) để phát hiện thay đổi
// khung hình lớn giữa 2 ảnh chụp liên tiếp — 1 trong 2 tín hiệu gom scene (cùng với
// khoảng cách thời gian EXIF, xem sceneGrouping.ts). Tính trên ImageData đã có sẵn từ bước
// độ nét, không decode/vẽ lại canvas thêm lần nào.

const BINS_PER_CHANNEL = 4;
const BIN_COUNT = BINS_PER_CHANNEL ** 3;
const QUANTIZE_STEP = BINS_PER_CHANNEL / 256;

export function computeColorHistogram(imageData: ImageData): number[] {
  const bins = new Array(BIN_COUNT).fill(0);
  const { data } = imageData;
  let pixelCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = Math.min(BINS_PER_CHANNEL - 1, Math.floor(data[i] * QUANTIZE_STEP));
    const g = Math.min(
      BINS_PER_CHANNEL - 1,
      Math.floor(data[i + 1] * QUANTIZE_STEP)
    );
    const b = Math.min(
      BINS_PER_CHANNEL - 1,
      Math.floor(data[i + 2] * QUANTIZE_STEP)
    );
    bins[r * BINS_PER_CHANNEL * BINS_PER_CHANNEL + g * BINS_PER_CHANNEL + b] += 1;
    pixelCount += 1;
  }

  return pixelCount > 0 ? bins.map((count) => count / pixelCount) : bins;
}

/** Khoảng cách Bhattacharyya giữa 2 histogram đã chuẩn hoá — 0 = giống hệt, 1 = khác hẳn. */
export function histogramDistance(a: number[], b: number[]): number {
  let bhattacharyyaCoefficient = 0;
  for (let i = 0; i < a.length; i += 1) {
    bhattacharyyaCoefficient += Math.sqrt(a[i] * b[i]);
  }
  return 1 - Math.min(1, bhattacharyyaCoefficient);
}