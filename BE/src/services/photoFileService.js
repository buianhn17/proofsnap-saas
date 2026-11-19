// Đọc nội dung ảnh bất kể ảnh nằm ở đâu:
//   storage 'drive'       → Drive của PTG, dùng token Google của PTG (luôn là bản đầy đủ)
//   storage 'public_link' → thư mục Drive công khai, qua CDN ảnh của Google, lấy ĐÚNG CỠ cần
//                           dùng (thumbnail/preview khỏi tải bản gốc vài MB rồi mới thu nhỏ)
const { Readable } = require("node:stream");
const driveService = require("./googleDriveService");
const publicDrive = require("./publicDriveService");

function isLinked(photo) {
  return photo.storage === "public_link";
}

/**
 * @param {{ storage?: string, drive_file_id: string }} photo
 * @param {{ maxEdgePx?: number }} [options] cạnh dài cần dùng — ảnh liên kết lấy sẵn cỡ này;
 *   ảnh trong Drive của PTG luôn trả bản đầy đủ (caller tự thu nhỏ như trước).
 */
async function readPhotoBuffer(photographerId, photo, { maxEdgePx = 0 } = {}) {
  if (isLinked(photo)) return publicDrive.fetchCdnImage(photo.drive_file_id, maxEdgePx);
  return driveService.downloadFileBuffer(photographerId, photo.drive_file_id);
}

/** Bản đầy đủ dạng stream — tải ảnh gốc, ZIP. */
async function readPhotoStream(photographerId, photo) {
  if (isLinked(photo)) return Readable.from(await publicDrive.fetchCdnImage(photo.drive_file_id, 0));
  return driveService.downloadFileStream(photographerId, photo.drive_file_id);
}

module.exports = { readPhotoBuffer, readPhotoStream, isLinked };
