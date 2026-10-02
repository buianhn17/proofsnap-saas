const sharp = require("sharp");

// Kích thước cạnh dài cho từng mức "size" hỗ trợ qua query param ?size= ở endpoint /view —
// "thumb" cho ô lưới nhỏ, "preview" cho lightbox/so sánh khi xem gần full màn hình.
// Không truyền size (undefined) => giữ nguyên ảnh gốc, không qua hàm này.
const SIZE_PRESETS = {
  thumb: { maxEdgePx: 480, quality: 70 },
  preview: { maxEdgePx: 2000, quality: 85 },
};

// Bản "tối ưu" khi khách tải ảnh hoàn thiện về điện thoại (?quality=optimized ở endpoint
// /download) — đủ nét để xem/đăng mạng xã hội, nhẹ hơn ảnh gốc ~5-10 lần nên lưu cả chục ảnh
// 1 lượt trên mạng di động nhanh hơn hẳn. Cố ý KHÔNG đưa vào SIZE_PRESETS: /view áp
// watermark còn /download thì không, không để /view?size=... trả về bản không watermark.
const DOWNLOAD_OPTIMIZED_PRESET = { maxEdgePx: 2560, quality: 88 };

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

module.exports = { resolveSizePreset, resizeToLongEdge, DOWNLOAD_OPTIMIZED_PRESET };
