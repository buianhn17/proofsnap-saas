const sharp = require("sharp");

// Kích thước cạnh dài cho từng mức "size" hỗ trợ qua query param ?size= ở endpoint /view —
// "thumb" cho ô lưới nhỏ, "preview" cho lightbox/so sánh khi xem gần full màn hình.
// Không truyền size (undefined) => giữ nguyên ảnh gốc, không qua hàm này.
const SIZE_PRESETS = {
  thumb: { maxEdgePx: 480, quality: 70 },
  preview: { maxEdgePx: 2000, quality: 85 },
};

function resolveSizePreset(size) {
  return SIZE_PRESETS[size] ?? null;
}

async function resizeToLongEdge(buffer, maxEdgePx, quality) {
  return sharp(buffer)
    .resize({
      width: maxEdgePx,
      height: maxEdgePx,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality })
    .toBuffer();
}

module.exports = { resolveSizePreset, resizeToLongEdge };
