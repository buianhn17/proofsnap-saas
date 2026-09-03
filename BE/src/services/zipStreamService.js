const archiver = require("archiver");
const { downloadFileStream } = require("./googleDriveService");

// Bước 4.2 — nén ZIP dạng streaming (không buffer toàn bộ album vào RAM): tải từng ảnh từ
// Drive rồi pipe thẳng vào archive, archive pipe thẳng ra response. Header response PHẢI
// được set bởi caller TRƯỚC khi gọi hàm này (không thể trả lỗi JSON giữa chừng nếu 1 ảnh
// tải lỗi — chỉ log lại và hủy response, giống mức xử lý lỗi streaming hiện có của
// downloadFileStream ở viewPhoto/view).
async function streamPhotosAsZip(res, photographerId, photos) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("warning", (err) => console.error("Cảnh báo khi nén ZIP:", err.message));
  archive.on("error", (err) => {
    console.error("Lỗi khi nén ZIP:", err.message);
    res.destroy(err);
  });
  archive.pipe(res);

  for (const photo of photos) {
    const stream = await downloadFileStream(photographerId, photo.drive_file_id);
    archive.append(stream, { name: `${photo.original_base_filename}.jpg` });
  }

  await archive.finalize();
}

module.exports = { streamPhotosAsZip };
