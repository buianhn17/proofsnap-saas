const albumModel = require("../models/albumModel");
const sceneModel = require("../models/sceneModel");
const burstClusterModel = require("../models/burstClusterModel");

const MAX_CLUSTERS_PER_REQUEST = 500;

function badRequest(message, code = "INVALID_BURST_CLUSTER") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
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

    const { clusters } = req.body || {};
    if (!Array.isArray(clusters) || clusters.length === 0 || clusters.length > MAX_CLUSTERS_PER_REQUEST) {
      throw badRequest(`clusters phải là mảng có từ 1 đến ${MAX_CLUSTERS_PER_REQUEST} phần tử`);
    }

    const normalized = [];
    for (const [index, cluster] of clusters.entries()) {
      const sceneId = cluster.scene_id ?? null;
      if (sceneId !== null) {
        const scene = await sceneModel.findByIdAndAlbum(sceneId, album.id);
        if (!scene) {
          throw badRequest(`clusters[${index}].scene_id không thuộc album này`);
        }
      }
      normalized.push({ sceneId });
    }

    const created = await burstClusterModel.createBurstClusters(normalized);
    res.status(201).json({ clusters: created });
  } catch (error) {
    next(error);
  }
}

module.exports = { create };
