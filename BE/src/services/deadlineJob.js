// Job nền: khoá album đã quá hạn chọn ảnh, kể cả khi không còn khách nào mở album (trước đây
// album chỉ bị khoá "lười" lúc có khách gọi API thả tim/ghi chú — PTG có thể thấy album
// "Đang mở" dù đã quá hạn nhiều ngày). Chạy mỗi DEADLINE_JOB_INTERVAL_MS (mặc định 60 giây).
const { lockExpiredAlbums } = require("../models/albumModel");

const DEFAULT_INTERVAL_MS = 60_000;

async function runDeadlineSweep(logger = console) {
  const locked = await lockExpiredAlbums();
  if (locked.length > 0) {
    logger.log(`Đã tự khoá ${locked.length} album quá hạn chọn ảnh: ${locked.map((a) => a.name).join(", ")}`);
  }
  return locked;
}

function startDeadlineJob(logger = console) {
  const interval = Number(process.env.DEADLINE_JOB_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const tick = () => runDeadlineSweep(logger).catch((err) => logger.error?.("Job khoá album quá hạn lỗi:", err.message));
  tick();
  const timer = setInterval(tick, interval);
  timer.unref();
  return timer;
}

module.exports = { runDeadlineSweep, startDeadlineJob };
