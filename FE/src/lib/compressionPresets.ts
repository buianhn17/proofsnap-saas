export interface CompressionPreset {
  id: number;
  labelVi: string;
  jpegQuality: number;
  maxLongEdgePx: number;
}

// BE chưa có endpoint liệt kê compression_presets, nên hardcode khớp đúng
// dữ liệu seed trong BE/db/lensproof_schema.sql (mục 2). Nếu sau này BE
// thêm API cho bảng này thì thay chỗ này bằng gọi API.
export const COMPRESSION_PRESETS: CompressionPreset[] = [
  { id: 1, labelVi: "Xuất sắc", jpegQuality: 92, maxLongEdgePx: 3840 },
  { id: 2, labelVi: "Tốt", jpegQuality: 85, maxLongEdgePx: 2560 },
  { id: 3, labelVi: "Trung bình", jpegQuality: 75, maxLongEdgePx: 1920 },
  { id: 4, labelVi: "Tiết kiệm", jpegQuality: 60, maxLongEdgePx: 1280 },
];

export function getPresetLabel(id: number): string {
  const preset = COMPRESSION_PRESETS.find((p) => p.id === id);
  return preset
    ? `${preset.labelVi} (${preset.jpegQuality}%, cạnh dài tối đa ${preset.maxLongEdgePx}px)`
    : `Preset #${id}`;
}
