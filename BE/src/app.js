const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");

const swaggerSpec = require("./config/swagger");
const healthRoute = require("./routes/health");
const authRoute = require("./routes/auth");
const driveRoute = require("./routes/drive");
const albumsRoute = require("./routes/albums");
const photosRoute = require("./routes/photos");
const clientRoute = require("./routes/client");
const studioRoute = require("./routes/studio");
const adminRoute = require("./routes/admin");
const { notFoundHandler, errorHandler } = require("./middlewares/errorMiddleware");
const { validateUuidParams } = require("./middlewares/validateUuidParams");

function createApp() {
  const app = express();
  // Sau reverse proxy (nginx/Render...) cần TRUST_PROXY để req.ip là IP thật của khách —
  // rate limit nhập PIN (L8) khoá theo IP. VD: TRUST_PROXY=1 (tin 1 tầng proxy).
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set("trust proxy", Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
  }

  app.use(
    cors({
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(morgan("dev"));
  app.use(express.json());
  app.use(cookieParser());

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.use("/api/health", healthRoute);
  app.use("/api/auth", authRoute);
  app.use("/api/drive", driveRoute);
  app.use("/api/albums", albumsRoute);
  // :albumId nằm ở đường dẫn mount nên router.param của photosRoute không thấy — kiểm tra ở đây.
  app.use("/api/albums/:albumId/photos", validateUuidParams, photosRoute);
  app.use("/api/public/albums", clientRoute);
  app.use("/api/studio", studioRoute);
  app.use("/api", adminRoute);

  app.get("/", (req, res) => {
    res.json({ message: "LensProof backend đang chạy" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
