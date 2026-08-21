// Bước 1.3 — độ nét bằng phương sai Laplacian (variance of Laplacian), cùng công thức
// dùng phổ biến trong OpenCV (cv2.Laplacian(gray, CV_64F).var()) để phát hiện ảnh mờ.

export function toGrayscale(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Trọng số luminance chuẩn ITU-R BT.601.
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

/**
 * Áp kernel Laplacian 3x3 [[0,1,0],[1,-4,1],[0,1,0]] lên ảnh xám rồi tính phương sai
 * của kết quả. Ảnh càng nét (nhiều cạnh sắc) thì phương sai càng cao.
 */
export function laplacianVariance(
  gray: Float32Array,
  width: number,
  height: number
): number {
  if (width < 3 || height < 3) return 0;

  const responses = new Float32Array((width - 2) * (height - 2));
  let sum = 0;
  let index = 0;

  for (let y = 1; y < height - 1; y += 1) {
    const rowUp = (y - 1) * width;
    const row = y * width;
    const rowDown = (y + 1) * width;
    for (let x = 1; x < width - 1; x += 1) {
      const value =
        gray[rowUp + x] +
        gray[rowDown + x] +
        gray[row + x - 1] +
        gray[row + x + 1] -
        4 * gray[row + x];
      responses[index] = value;
      sum += value;
      index += 1;
    }
  }

  const mean = sum / responses.length;
  let variance = 0;
  for (let i = 0; i < responses.length; i += 1) {
    const diff = responses[i] - mean;
    variance += diff * diff;
  }
  return variance / responses.length;
}

export function computeSharpnessScore(imageData: ImageData): number {
  const gray = toGrayscale(imageData);
  return laplacianVariance(gray, imageData.width, imageData.height);
}