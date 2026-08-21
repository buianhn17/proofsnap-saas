// Bước 1.8 — crop 1 khuôn mặt từ file ảnh gốc dựa trên hộp bao chuẩn hoá (đã tính từ
// landmark MediaPipe ở Bước 1.3, xem eyeStatus.ts). Chạy trên MAIN THREAD, theo yêu cầu
// (crop 1 ảnh khi PTG mở Close-up Panel — nhẹ, không cần đẩy qua worker như pipeline chính).
// Vì hộp bao là toạ độ TỈ LỆ (0-1), áp thẳng lên ảnh gốc full-res cho ra close-up chất
// lượng cao hơn nhiều so với crop từ bản đã giảm kích thước dùng để phát hiện mắt.

import type { NormalizedFaceBox } from "./types";

const DEFAULT_MAX_OUTPUT_PX = 480;

/** Crop 1 khuôn mặt từ file ảnh, trả về object URL (nhớ URL.revokeObjectURL khi không dùng nữa). */
export async function cropFaceFromFile(
  file: File,
  box: NormalizedFaceBox,
  maxOutputPx: number = DEFAULT_MAX_OUTPUT_PX
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const srcX = Math.round(box.x * bitmap.width);
    const srcY = Math.round(box.y * bitmap.height);
    const srcW = Math.max(1, Math.round(box.width * bitmap.width));
    const srcH = Math.max(1, Math.round(box.height * bitmap.height));

    const scale = Math.min(1, maxOutputPx / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Không tạo được canvas context để crop khuôn mặt");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}