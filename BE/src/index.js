require("dotenv").config();

const { loadEnv } = require("./config/env");
const { createApp } = require("./app");
const { resumePendingFaceIndex } = require("./services/faceIndexQueue");

loadEnv();

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`LensProof backend đang lắng nghe tại http://localhost:${PORT}`);
  // Ảnh upload xong nhưng chưa trích xong embedding khuôn mặt ở lần chạy trước.
  resumePendingFaceIndex()
    .then((count) => {
      if (count > 0) console.log(`Tiếp tục trích embedding khuôn mặt cho ${count} ảnh còn dở`);
    })
    .catch((err) => console.error("Không đọc được hàng đợi trích embedding khuôn mặt:", err.message));
});
