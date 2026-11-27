// Admin Portal — Bảng điều khiển, Khách hàng (kèm trạng thái thanh toán thủ công), Cài đặt.
const overviewModel = require("../models/overviewModel");
// Khớp validatePreset() ở albumController.js — 4 preset cố định toàn hệ thống.
const COMPRESSION_PRESET_IDS = [1, 2, 3, 4];

function badRequest(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

const PAYMENT_STATUSES = new Set(["unpaid", "deposit", "paid"]);
const CLIENT_FILTERS = new Set(["all", "completed", "in_progress", "unpaid"]);

async function dashboard(req, res, next) {
  try {
    res.json(await overviewModel.getDashboard(req.photographer.photographerId));
  } catch (error) {
    next(error);
  }
}

async function listClients(req, res, next) {
  try {
    const search = typeof req.query.search === "string" && req.query.search.trim()
      ? req.query.search.trim().slice(0, 100)
      : null;
    const filter = CLIENT_FILTERS.has(req.query.filter) ? req.query.filter : "all";
    const albumId = /^[0-9a-f-]{36}$/i.test(req.query.album_id ?? "") ? req.query.album_id : null;
    const clients = await overviewModel.listClients(req.photographer.photographerId, { search, filter, albumId });
    res.json({ clients });
  } catch (error) {
    next(error);
  }
}

async function unseenCount(req, res, next) {
  try {
    res.json({ count: await overviewModel.countUnseenCompletions(req.photographer.photographerId) });
  } catch (error) {
    next(error);
  }
}

async function markSeen(req, res, next) {
  try {
    await overviewModel.markClientsSeen(req.photographer.photographerId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

async function getClient(req, res, next) {
  try {
    const client = await overviewModel.findClientForPhotographer(
      req.params.clientId,
      req.photographer.photographerId
    );
    if (!client) return res.status(404).json({ error: "CLIENT_NOT_FOUND", message: "Không tìm thấy khách hàng" });
    res.json({ client });
  } catch (error) {
    next(error);
  }
}

// Mục 3.2 tài liệu gốc — KHÔNG tích hợp cổng thanh toán; PTG tự đánh dấu trạng thái.
async function updateClientPayment(req, res, next) {
  try {
    const { payment_status: paymentStatus, payment_note: paymentNote } = req.body || {};
    if (paymentStatus !== undefined && !PAYMENT_STATUSES.has(paymentStatus)) {
      throw badRequest("payment_status chỉ được là unpaid, deposit hoặc paid", "INVALID_PAYMENT_STATUS");
    }
    if (paymentNote !== undefined && paymentNote !== null
        && (typeof paymentNote !== "string" || paymentNote.length > 500)) {
      throw badRequest("Ghi chú thanh toán tối đa 500 ký tự", "INVALID_PAYMENT_NOTE");
    }
    if (paymentStatus === undefined && paymentNote === undefined) {
      throw badRequest("Không có trường nào để cập nhật", "NOTHING_TO_UPDATE");
    }
    const client = await overviewModel.updateClientPayment(req.params.clientId, req.photographer.photographerId, {
      paymentStatus,
      paymentNote: paymentNote === undefined ? undefined : (paymentNote?.trim() || null),
    });
    if (!client) return res.status(404).json({ error: "CLIENT_NOT_FOUND", message: "Không tìm thấy khách hàng" });
    res.json({ client });
  } catch (error) {
    next(error);
  }
}

// Cài đặt mặc định khi tạo album mới — chỉ nhận đúng các khoá đã biết.
function validateSettings(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("settings phải là object", "INVALID_SETTINGS");
  }
  const out = {};
  if ("default_compression_preset_id" in input) {
    const v = Number(input.default_compression_preset_id);
    if (!COMPRESSION_PRESET_IDS.includes(v)) throw badRequest("Preset nén không hợp lệ", "INVALID_SETTINGS");
    out.default_compression_preset_id = v;
  }
  if ("default_watermark_enabled" in input) {
    if (typeof input.default_watermark_enabled !== "boolean") throw badRequest("Watermark mặc định phải là true/false", "INVALID_SETTINGS");
    out.default_watermark_enabled = input.default_watermark_enabled;
  }
  if ("default_max_selectable_photos" in input) {
    const v = input.default_max_selectable_photos;
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 10000)) {
      throw badRequest("Số ảnh chọn tối đa mặc định phải từ 1 đến 10000 hoặc để trống", "INVALID_SETTINGS");
    }
    out.default_max_selectable_photos = v;
  }
  if ("default_deadline_days" in input) {
    const v = input.default_deadline_days;
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 365)) {
      throw badRequest("Hạn chọn ảnh mặc định phải từ 1 đến 365 ngày hoặc để trống", "INVALID_SETTINGS");
    }
    out.default_deadline_days = v;
  }
  return out;
}

async function getSettings(req, res, next) {
  try {
    const settings = await overviewModel.getSettings(req.photographer.photographerId);
    if (!settings) return res.status(404).json({ error: "PHOTOGRAPHER_NOT_FOUND", message: "Không tìm thấy tài khoản" });
    res.json({ settings });
  } catch (error) {
    next(error);
  }
}

async function updateSettings(req, res, next) {
  try {
    const body = req.body || {};
    let displayName;
    if (body.display_name !== undefined) {
      if (typeof body.display_name !== "string" || body.display_name.trim().length < 1 || body.display_name.trim().length > 80) {
        throw badRequest("Tên hiển thị phải từ 1 đến 80 ký tự", "INVALID_DISPLAY_NAME");
      }
      displayName = body.display_name.trim();
    }
    const settings = validateSettings(body.settings);
    const updated = await overviewModel.updateSettings(req.photographer.photographerId, { displayName, settings });
    if (!updated) return res.status(404).json({ error: "PHOTOGRAPHER_NOT_FOUND", message: "Không tìm thấy tài khoản" });
    res.json({ settings: updated });
  } catch (error) {
    next(error);
  }
}

module.exports = { dashboard, listClients, unseenCount, markSeen, getClient, updateClientPayment, getSettings, updateSettings };
