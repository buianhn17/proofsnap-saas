require("dotenv").config();

const { loadEnv } = require("./config/env");
const { createApp } = require("./app");
const { runMigrations } = require("./config/migrations");
const { resumePendingFaceIndex } = require("./services/faceIndexQueue");
const { startDeadlineJob } = require("./services/deadlineJob");

loadEnv();

const PORT = process.env.PORT || 3000;

async function start() {
  // L2 — áp dụng migration còn thiếu TRƯỚC khi nhận request, để code mới không chạy trên
  // schema cũ. Tắt bằng DB_AUTO_MIGRATE=false nếu muốn chạy migration thủ công.
  if (process.env.DB_AUTO_MIGRATE !== "false") {
    const { applied, baselined } = await runMigrations();
    if (baselined.length > 0) {
      console.log(`Ghi nhận ${baselined.length} migration đã có sẵn trong DB: ${baselined.join(", ")}`);
    }
    console.log(
      applied.length > 0 ? `Đã áp dụng ${applied.length} migration mới` : "Schema database đã ở phiên bản mới nhất"
    );
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`LensProof backend đang lắng nghe tại http://localhost:${PORT}`);
    // Mục 5.2 — tự khoá album khi hết hạn chọn ảnh (không chờ khách gọi API).
    startDeadlineJob();
    // Ảnh upload xong nhưng chưa trích xong embedding khuôn mặt ở lần chạy trước.
    resumePendingFaceIndex()
      .then((count) => {
        if (count > 0) console.log(`Tiếp tục trích embedding khuôn mặt cho ${count} ảnh còn dở`);
      })
      .catch((err) => console.error("Không đọc được hàng đợi trích embedding khuôn mặt:", err.message));
  });
}

start().catch((err) => {
  console.error("Không khởi động được backend:", err.message);
  process.exit(1);
});
