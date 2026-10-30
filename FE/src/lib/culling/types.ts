// Bước 1.3 — kiểu dữ liệu dùng chung cho module thử nghiệm thuật toán AI culling.
// Module này ĐỘC LẬP, không gắn vào luồng upload/album thật (xem CullingTestPage).

import type { ExposureResult } from "./exposure";

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
  /** 0 (nhắm tịt) -> 1 (mở to) — kết hợp EAR + blendshape nháy mắt (faceQuality.ts). */
  eyeOpenScore: number;
  /** 0 (out nét) -> 1 (nét căng) — đo trên chính vùng mặt + vùng mắt (faceQuality.ts). */
  focusScore: number;
  /** Mặt đủ lớn so với mặt lớn nhất trong ảnh để coi là "người chính" — chỉ người chính
   * mới khiến ảnh bị đề xuất loại khi nhắm mắt/out nét (người qua đường phía sau thì không). */
  isMainSubject: boolean;
  /** Mặt quá ít pixel (người đứng xa trong ảnh tập thể đông) — độ mở mắt/độ nét kém tin cậy,
   * chỉ đủ để gợi ý "Xem lại", không tự động đề xuất loại. */
  lowDetail: boolean;
}

export interface CullingMetrics {
  /** Điểm biến thiên Laplacian (variance of Laplacian) TOÀN ẢNH — số càng lớn càng nét.
   * Chỉ dùng làm độ nét cho ảnh không có mặt người; ảnh có người dùng focusScore từng mặt. */
  sharpnessScore: number;
  /** Phơi sáng tổng thể (exposure.ts). */
  exposure: ExposureResult;
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
  /** Đọc EXIF + tìm preview nhúng + decode (preview nhúng hoặc JPEG thu nhỏ). */
  decode: number;
  sharpness: number;
  hash: number;
  /** Phát hiện mặt/landmark + chấm độ nét, độ mở mắt từng mặt. */
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