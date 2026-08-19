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
const { notFoundHandler, errorHandler } = require("./middlewares/errorMiddleware");

function createApp() {
  const app = express();

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
  app.use("/api/albums/:albumId/photos", photosRoute);
  app.use("/api/public/albums", clientRoute);

  app.get("/", (req, res) => {
    res.json({ message: "LensProof backend đang chạy" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
