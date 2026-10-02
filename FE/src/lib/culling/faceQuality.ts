// Chấm chất lượng TỪNG KHUÔN MẶT: độ nét trên vùng mặt + vùng mắt, và độ mở mắt.
//
// Vì sao không dùng độ nét toàn ảnh (sharpness.ts) cho ảnh có người: ảnh chân dung xoá
// phông có nền mờ chiếm phần lớn khung hình -> Laplacian toàn ảnh thấp dù mặt nét căng;
// ngược lại ảnh lấy nét trượt ra hậu cảnh (nền nét, mặt mờ) lại được điểm cao. Thứ người
// xem/PTG quan tâm là mặt — đặc biệt là MẮT — có nét không.
//
// Module này THUẦN TOÁN (không DOM/canvas, chỉ nhận mảng pixel), để chạy được cả trong Web
// Worker lẫn Node (dùng để hiệu chỉnh ngưỡng trên ảnh thật, xem ghi chú FOCUS_* bên dưới).

/** Ảnh xám 1 kênh, giá trị 0-255. */
export interface GrayImage {
  data: Float32Array;
  width: number;
  height: number;
}

/** Cạnh dài tối đa của vùng mặt/vùng mắt khi đo độ nét — xem focusCropSize(). */
export const FOCUS_CROP_MAX_EDGE_PX = 256;

/**
 * Kích thước resample vùng crop trước khi đo độ nét: CHỈ thu nhỏ (cạnh dài tối đa
 * FOCUS_CROP_MAX_EDGE_PX, giữ tỉ lệ), KHÔNG phóng to.
 * - Không phóng to: nội suy khi phóng mặt nhỏ lên tự tạo ra độ mờ giả -> mặt nhỏ bị chấm
 *   "mờ" oan.
 * - Thu nhỏ mặt lớn về ~256px: đủ để đo độ nét ở mức PTG nhìn trên màn hình (mặt chân dung
 *   ~250-400px khi xem toàn khung), đồng thời đưa mặt to/nhỏ về cùng thang để so sánh. Thu
 *   nhỏ quá mạnh (ví dụ 128px) xoá mất dấu hiệu mờ nhẹ — đã đo: mặt chân dung lệch nét nhẹ
 *   gần như không phân biệt được với mặt nét ở 128px.
 */
export function focusCropSize(
  width: number,
  height: number
): { width: number; height: number } {
  const scale = Math.min(1, FOCUS_CROP_MAX_EDGE_PX / Math.max(width, height));
  return {
    width: Math.max(3, Math.round(width * scale)),
    height: Math.max(3, Math.round(height * scale)),
  };
}

export function grayFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number
): GrayImage {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; p < gray.length; i += 4, p += 1) {
    // Trọng số luminance chuẩn ITU-R BT.601.
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { data: gray, width, height };
}

/**
 * Độ nét chuẩn hoá theo độ tương phản: Var(Laplacian) / Var(ảnh xám).
 *
 * Var(Laplacian) thuần (như sharpness.ts) tỉ lệ với BÌNH PHƯƠNG độ tương phản — cùng 1 mức
 * nét, mặt da tối/thiếu sáng/tương phản thấp cho số nhỏ hơn hẳn mặt sáng, khiến ngưỡng
 * cứng không dùng chung được cho mọi khuôn mặt. Chia cho phương sai cường độ của chính vùng
 * crop triệt tiêu yếu tố đó, chỉ còn lại "tỉ lệ năng lượng tần số cao" — đại lượng phản ánh
 * đúng độ nét. Vùng crop phải được resample theo focusCropSize() trước khi gọi.
 */
export function focusMeasure(gray: GrayImage): number {
  const { data, width, height } = gray;
  if (width < 3 || height < 3) return 0;

  let graySum = 0;
  let graySquareSum = 0;
  for (let i = 0; i < data.length; i += 1) {
    graySum += data[i];
    graySquareSum += data[i] * data[i];
  }
  const grayMean = graySum / data.length;
  const grayVariance = graySquareSum / data.length - grayMean * grayMean;

  let lapSum = 0;
  let lapSquareSum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const rowUp = (y - 1) * width;
    const row = y * width;
    const rowDown = (y + 1) * width;
    for (let x = 1; x < width - 1; x += 1) {
      const value =
        data[rowUp + x] +
        data[rowDown + x] +
        data[row + x - 1] +
        data[row + x + 1] -
        4 * data[row + x];
      lapSum += value;
      lapSquareSum += value * value;
      count += 1;
    }
  }
  const lapMean = lapSum / count;
  const lapVariance = lapSquareSum / count - lapMean * lapMean;

  // +25 (~ độ lệch chuẩn 5 mức xám) chặn vùng gần như phẳng (mặt cháy sáng/tối đen) bị
  // chia cho số quá nhỏ rồi thổi phồng nhiễu thành "nét".
  return lapVariance / (grayVariance + 25);
}

// Quy focusMeasure ra điểm 0-1 bằng hàm bão hoà m / (m + K): K là giá trị cho điểm 0.5.
// Hiệu chỉnh trên 45 khuôn mặt từ ảnh sự kiện/chân dung thật (ảnh thu về cạnh dài 2000px
// như pipeline, mặt rộng ~220-285px, crop theo focusCropSize), làm mờ Gaussian nhân tạo
// với σ tính theo pixel của ảnh phân tích. Trung vị (p10–p90) focusMeasure:
//   nét gốc:   mặt 0.137 (0.081–0.188)   mắt 0.190 (0.088–0.365)
//   σ 0.6px:   mặt 0.034 (0.022–0.051)   mắt 0.046 (0.025–0.090)  — mờ nhẹ
//   σ 1.0px:   mặt 0.014 (0.010–0.024)   mắt 0.022 (0.011–0.043)  — mờ thấy rõ
//   σ 1.5px:   mặt 0.004 (0.003–0.008)   mắt 0.007 (0.003–0.012)  — out nét
// K đặt quanh mức "mờ nhẹ" -> điểm trung vị: nét ~0.78, mờ nhẹ ~0.47, mờ rõ ~0.28, out nét
// ~0.1. Ngưỡng loại out_of_focus nằm ở burstScoring.ts (OUT_OF_FOCUS_BELOW).
const FACE_FOCUS_HALF_POINT = 0.04;
const EYE_FOCUS_HALF_POINT = 0.05;
// Mắt là điểm lấy nét chuẩn của ảnh chân dung — trọng số cao hơn vùng mặt nói chung.
const EYE_FOCUS_WEIGHT = 0.6;

function saturate(measure: number, halfPoint: number): number {
  if (!(measure > 0)) return 0;
  return measure / (measure + halfPoint);
}

/** Điểm nét 0-1 của 1 khuôn mặt từ focusMeasure vùng mặt và vùng mắt (null nếu không
 * crop được vùng mắt, ví dụ mắt sát mép ảnh — khi đó chỉ dùng vùng mặt). */
export function faceFocusScore(faceMeasure: number, eyeMeasure: number | null): number {
  const faceScore = saturate(faceMeasure, FACE_FOCUS_HALF_POINT);
  if (eyeMeasure === null) return faceScore;
  const eyeScore = saturate(eyeMeasure, EYE_FOCUS_HALF_POINT);
  return EYE_FOCUS_WEIGHT * eyeScore + (1 - EYE_FOCUS_WEIGHT) * faceScore;
}

// EAR (eye aspect ratio) của mắt nhắm hẳn ~0.05-0.12, mở bình thường ~0.25-0.35 (giá trị
// EAR thực tế của lưới MediaPipe, cùng thang với DEFAULT_EYE_THRESHOLDS ở eyeStatus.ts).
const EAR_CLOSED = 0.12;
const EAR_OPEN = 0.28;

/**
 * Điểm mở mắt 0 (nhắm tịt) -> 1 (mở to), kết hợp 2 tín hiệu độc lập:
 * - EAR hình học từ landmark viền mí — chính xác khi landmark bám tốt, nhưng dao động theo
 *   dáng mắt từng người (mắt một mí/mắt hẹp có EAR "mở" thấp) và góc nghiêng mặt.
 * - Blendshape eyeBlinkLeft/Right của MediaPipe — model đã huấn luyện riêng để phân loại
 *   nháy mắt, ổn định hơn với dáng mắt nhưng đôi khi "nghi ngờ" mắt nheo khi cười.
 * Lấy trung bình 2 tín hiệu để lỗi của bên này được bên kia kéo lại. blinkScore là MAX
 * eyeBlinkLeft/Right (1 = nhắm) — chỉ cần 1 mắt nhắm là ảnh đã hỏng; null nếu model không
 * trả blendshape, khi đó chỉ dùng EAR.
 */
export function eyeOpenScore(ear: number, blinkScore: number | null): number {
  const earScore = Math.max(0, Math.min(1, (ear - EAR_CLOSED) / (EAR_OPEN - EAR_CLOSED)));
  if (blinkScore === null) return earScore;
  const blendshapeScore = 1 - Math.max(0, Math.min(1, blinkScore));
  return (earScore + blendshapeScore) / 2;
}
