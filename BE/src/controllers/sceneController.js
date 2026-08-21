const albumModel = require("../models/albumModel");
const sceneModel = require("../models/sceneModel");

const MAX_SCENES_PER_REQUEST = 200;

function badRequest(message, code = "INVALID_SCENE") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  if (Number.isNaN(Date.parse(value))) {
    throw badRequest(`${fieldName} phải là ngày ISO hợp lệ`);
  }
  return new Date(value).toISOString();
}

async function create(req, res, next) {
  try {
    const album = await albumModel.findByIdForPhotographer(
      req.params.albumId,
      req.photographer.photographerId
    );
    if (!album) {
      return res.status(404).json({ error: "ALBUM_NOT_FOUND", message: "Không tìm thấy album" });
    }

    const { scenes } = req.body || {};
    if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > MAX_SCENES_PER_REQUEST) {
      throw badRequest(`scenes phải là mảng có từ 1 đến ${MAX_SCENES_PER_REQUEST} phần tử`);
    }

    const normalized = scenes.map((scene, index) => {
      if (typeof scene.sort_order !== "undefined" && !Number.isInteger(scene.sort_order)) {
        throw badRequest(`sort_order của scenes[${index}] không hợp lệ`);
      }
      return {
        label: typeof scene.label === "string" ? scene.label.slice(0, 200) : null,
        startedAt: parseOptionalDate(scene.started_at, `scenes[${index}].started_at`),
        endedAt: parseOptionalDate(scene.ended_at, `scenes[${index}].ended_at`),
        sortOrder: scene.sort_order ?? index,
      };
    });

    const created = await sceneModel.createScenes(album.id, normalized);
    res.status(201).json({ scenes: created });
  } catch (error) {
    next(error);
  }
}

module.exports = { create };
