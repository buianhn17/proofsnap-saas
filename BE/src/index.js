require("dotenv").config();

const { loadEnv } = require("./config/env");
const { createApp } = require("./app");

loadEnv();

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`LensProof backend đang lắng nghe tại http://localhost:${PORT}`);
});
