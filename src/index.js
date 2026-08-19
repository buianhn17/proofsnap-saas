require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");

const swaggerSpec = require("./config/swagger");
const healthRoute = require("./routes/health");
const authRoute = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true, // bắt buộc để trình duyệt gửi kèm cookie session_token
  })
);
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

// Giao diện tài liệu API - tự cập nhật khi thêm annotation @swagger vào route mới
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/health", healthRoute);
app.use("/api/auth", authRoute);

// Route gốc, chỉ để xác nhận server sống
app.get("/", (req, res) => {
  res.json({ message: "LensProof backend đang chạy" });
});

app.listen(PORT, () => {
  console.log(`LensProof backend đang lắng nghe tại http://localhost:${PORT}`);
});
