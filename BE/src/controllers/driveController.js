const {
  checkPhotographerDrive,
  setupPhotographerDrive,
} = require("../services/googleDriveService");

async function status(req, res, next) {
  try {
    const result = await checkPhotographerDrive(req.photographer.photographerId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function setup(req, res, next) {
  try {
    const result = await setupPhotographerDrive(req.photographer.photographerId);
    res.status(201).json({
      message: "Đã kết nối và khởi tạo thư mục LensProof trên Google Drive",
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { status, setup };
