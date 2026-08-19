const sharp = require("sharp");

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Vẽ watermark dạng SVG, lặp lại (tile) theo đường chéo khắp ảnh — giảm
// giá trị thương mại của ảnh chụp màn hình vì không thể crop né 1 dòng duy nhất.
function buildWatermarkSvg(width, height, label) {
  const text = escapeXml(label);
  const tileWidth = 260;
  const tileHeight = 120;
  const cols = Math.ceil(width / tileWidth) + 2;
  const rows = Math.ceil(height / tileHeight) + 2;
  let tiles = "";
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * tileWidth - tileWidth / 2;
      const y = row * tileHeight;
      tiles += `<text x="${x}" y="${y}" font-size="20" fill="white" fill-opacity="0.35" transform="rotate(-30 ${x} ${y})" font-family="sans-serif">${text}</text>`;
    }
  }
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${tiles}</svg>`);
}

async function applyWatermark(imageBuffer, label) {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const svg = buildWatermarkSvg(metadata.width, metadata.height, label);
  return image
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

module.exports = { applyWatermark };