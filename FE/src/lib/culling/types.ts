// Bước 1.3 — kiểu dữ liệu dùng chung cho module thử nghiệm thuật toán AI culling.
// Module này ĐỘC LẬP, không gắn vào luồng upload/album thật (xem CullingTestPage).

export type EyeStatus = "open" | "squint" | "closed" | "no_face";

/** Bước 1.8 — hộp bao khuôn mặt, toạ độ CHUẨN HOÁ (0-1) theo chiều rộng/cao ảnh đã dùng
 * để phát hiện mắt. Vì là toạ độ tỉ lệ nên áp được lên bất kỳ độ phân giải nào của CÙNG
 * 1 ảnh (ví dụ ảnh gốc full-res để crop close-up chất lượng cao) mà không cần quy đổi. */
export interface NormalizedFaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFace {
  earValue: number;
  eyeStatus: EyeStatus;
  box: NormalizedFaceBox;
}

export interface CullingMetrics {
  /** Điểm biến thiên Laplacian (variance of Laplacian) — số càng lớn càng nét. */
  sharpnessScore: number;
  /** dHash 64-bit dạng chuỗi hex, dùng để so trùng lặp/burst. */
  hash: string;
  /** Số khuôn mặt phát hiện được trong ảnh. */
  faceCount: number;
  /** EAR (eye aspect ratio) nhỏ nhất trong số các khuôn mặt phát hiện được (null nếu không có mặt). */
  earValue: number | null;
  eyeStatus: EyeStatus;
  /** Bước 1.8 — chi tiết từng khuôn mặt (EAR + hộp bao riêng), phục vụ Close-up Panel
   * trên ảnh nhóm đông người. Rỗng nếu không có mặt. */
  faces: DetectedFace[];
}

export interface CullingTimingsMs {
  decode: number;
  sharpness: number;
  hash: number;
  eye: number;
  total: number;
}

export interface EyeStatusThresholds {
  /** EAR < closedBelow => coi là nhắm mắt. */
  closedBelow: number;
  /** closedBelow <= EAR < squintBelow => coi là nheo mắt; EAR >= squintBelow => mở mắt. */
  squintBelow: number;
}

export interface SharpnessThresholds {
  /** sharpnessScore < redBelow => đỏ (mờ). */
  redBelow: number;
  /** redBelow <= sharpnessScore < yellowBelow => vàng (trung bình); >= yellowBelow => xanh (nét). */
  yellowBelow: number;
}