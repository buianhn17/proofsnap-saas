// Quy tắc nghiệp vụ Show Kỷ Yếu & Bàn Giao Ekip — hàm thuần, không đụng DB, để test trực tiếp.
const { randomInt } = require("node:crypto");

const SHOW_TIMEZONE = "Asia/Ho_Chi_Minh";
const SHOW_STATUSES = ["open", "completed", "archived"];
const CREW_TYPES = ["photo", "video", "retouch"];
// crew: thợ chụp/quay nộp file gốc (photo/video) · editor: hậu kỳ nhận file gốc, nộp ảnh đã chỉnh (retouch)
const MEMBER_ROLES = ["crew", "editor"];
const SUBMIT_TYPES_BY_MEMBER_ROLE = { crew: ["photo", "video"], editor: ["retouch"] };
const RETOUCH_ROLE = "Hậu kỳ";
const REVIEW_STATUSES = ["approved", "rejected"];
const CULLED_STAT_KEYS = ["closed_eyes", "blurry", "overexposed", "failed_fireworks"];
const MAX_COUNT = 100_000;

// Vai trò chuẩn: nhập "phu 2", "LEAD", "quay chinh"… đều được quy về đúng 1 cách viết, để ràng
// buộc UNIQUE (show, thợ, vai trò) không bị lách bằng cách đổi hoa/thường hay bỏ dấu.
// type = null: dùng được cho cả ảnh và quay (Flycam chụp ảnh hoặc quay đều có).
const KNOWN_ROLES = [
  { label: "Lead", type: "photo" },
  { label: "Candid", type: "photo" },
  { label: "Quay chính", type: "video" },
  { label: "Quay phụ", type: "video" },
  { label: "Flycam", type: null },
  { label: RETOUCH_ROLE, type: "retouch" },
];

function validationError(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function removeDiacritics(value) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function cleanText(value) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function requireText(value, field, maxLength, code) {
  if (typeof value !== "string" || cleanText(value).length === 0) {
    throw validationError(`${field} là bắt buộc`, code);
  }
  const text = cleanText(value);
  if (text.length > maxLength) {
    throw validationError(`${field} tối đa ${maxLength} ký tự`, code);
  }
  return text;
}

// ---------------------------------------------------------------- invite code

// Các tiền tố loại trường bị bỏ khi lấy chữ cái đầu: "THPT Kim Liên" → "KL".
const SCHOOL_TYPE_TOKENS = new Set(["TRUONG", "THPT", "THCS", "TH", "PTTH", "PTCS", "PT"]);
const SCHOOL_TYPE_PHRASES = [
  ["TRUNG", "HOC", "PHO", "THONG"],
  ["TRUNG", "HOC", "CO", "SO"],
  ["TIEU", "HOC"],
  ["PHO", "THONG"],
];

function schoolInitials(schoolName) {
  let tokens = removeDiacritics(schoolName)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  // Chỉ bỏ tiền tố ở ĐẦU tên — "THPT Trưng Vương" vẫn giữ "Trưng".
  for (let changed = true; changed; ) {
    changed = false;
    if (tokens.length > 1 && SCHOOL_TYPE_TOKENS.has(tokens[0])) {
      tokens = tokens.slice(1);
      changed = true;
      continue;
    }
    for (const phrase of SCHOOL_TYPE_PHRASES) {
      if (tokens.length > phrase.length && phrase.every((word, i) => tokens[i] === word)) {
        tokens = tokens.slice(phrase.length);
        changed = true;
        break;
      }
    }
  }

  return tokens
    .map((token) => (/^\d+$/.test(token) ? token : token[0]))
    .join("")
    .slice(0, 4);
}

/** "THPT Kim Liên" + "12A5" → "KL12A5" */
function buildInviteCodePrefix(schoolName, className) {
  const school = schoolInitials(schoolName) || "S";
  const klass = removeDiacritics(className).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return `${school}${klass}`;
}

/** Hậu tố ngẫu nhiên 2 chữ số như "KL12A5-89"; nới lên 3-4 chữ số nếu trùng nhiều lần. */
function generateInviteCode(prefix, attempt = 0) {
  const digits = attempt < 8 ? 2 : attempt < 16 ? 3 : 4;
  return `${prefix}-${randomInt(10 ** (digits - 1), 10 ** digits)}`;
}

function normalizeInviteCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9]{1,12}-\d{2,4}$/.test(code) ? code : null;
}

// ---------------------------------------------------------------- dates

function localDateInShowTimezone(date) {
  // en-CA cho định dạng YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validateShootDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError("shoot_date phải có dạng YYYY-MM-DD", "INVALID_SHOOT_DATE");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw validationError("shoot_date không phải ngày hợp lệ", "INVALID_SHOOT_DATE");
  }
  return value;
}

function validateShootEndTime(value, shootDate) {
  // Bắt buộc có múi giờ (Z hoặc +07:00) — thiếu thì server và trình duyệt hiểu lệch nhau
  // tới 7 tiếng, kéo theo hạn 24h sai.
  if (
    typeof value !== "string" ||
    !/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw validationError(
      "shoot_end_time phải là thời điểm ISO 8601 có múi giờ, VD: 2026-11-20T17:30:00+07:00",
      "INVALID_SHOOT_END_TIME"
    );
  }
  const endTime = new Date(value);
  const localDate = localDateInShowTimezone(endTime);
  // Show có thể kéo qua nửa đêm, nhưng không quá rạng sáng hôm sau.
  if (localDate < shootDate || localDate > addDays(shootDate, 1)) {
    throw validationError(
      "shoot_end_time phải nằm trong ngày chụp (hoặc rạng sáng hôm sau)",
      "INVALID_SHOOT_END_TIME"
    );
  }
  return endTime.toISOString();
}

/** "2026-11-20" → "20/11/2026" */
function formatDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// ---------------------------------------------------------------- create show

function validateCreateShow(body) {
  const shootDate = validateShootDate(body.shoot_date);
  return {
    shootDate,
    shootEndTime: validateShootEndTime(body.shoot_end_time, shootDate),
    className: requireText(body.class_name, "class_name", 40, "INVALID_CLASS_NAME"),
    schoolName: requireText(body.school_name, "school_name", 160, "INVALID_SCHOOL_NAME"),
  };
}

// ---------------------------------------------------------------- submission

function roleKey(value) {
  return removeDiacritics(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeRolePosition(value, crewType) {
  const role = requireText(value, "role_position", 40, "INVALID_ROLE_POSITION");
  const key = roleKey(role);

  // "Phụ 1", "phu1", "PHỤ 2"… → "Phụ N"
  const assistant = key.match(/^phu\s*(\d{1,2})$/);
  const known = assistant
    ? { label: `Phụ ${Number(assistant[1])}`, type: "photo" }
    : KNOWN_ROLES.find((r) => roleKey(r.label) === key);

  if (!known) return role; // vai trò tự đặt — giữ nguyên cách viết của thợ
  if (known.type && known.type !== crewType) {
    const who = { photo: "thợ ảnh", video: "thợ quay", retouch: "editor" }[crewType];
    throw validationError(
      `Vai trò "${known.label}" không dành cho ${who}`,
      "ROLE_CREW_TYPE_MISMATCH"
    );
  }
  return known.label;
}

function isGoogleDriveUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      url.hostname === "drive.google.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function parseCount(value, field, { min = 0, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw validationError(`${field} là bắt buộc`, "INVALID_FILE_COUNT");
    return 0;
  }
  if (!Number.isInteger(value) || value < min || value > MAX_COUNT) {
    throw validationError(
      `${field} phải là số nguyên từ ${min} đến ${MAX_COUNT}`,
      "INVALID_FILE_COUNT"
    );
  }
  return value;
}

function parseCulledStats(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw validationError("culled_stats phải là object", "INVALID_CULLED_STATS");
  }
  const stats = {};
  for (const [key, count] of Object.entries(value)) {
    if (!CULLED_STAT_KEYS.includes(key)) {
      throw validationError(
        `culled_stats chỉ nhận các khoá: ${CULLED_STAT_KEYS.join(", ")}`,
        "INVALID_CULLED_STATS"
      );
    }
    stats[key] = parseCount(count, `culled_stats.${key}`);
  }
  return stats;
}

function validateMemberRole(value) {
  if (value === undefined || value === null) return "crew";
  if (!MEMBER_ROLES.includes(value)) {
    throw validationError("role_type phải là 'crew' hoặc 'editor'", "INVALID_MEMBER_ROLE");
  }
  return value;
}

/** Editor nộp link thư mục ảnh đã hậu kỳ — chỉ cần link Drive + số ảnh đã chỉnh. */
function validateRetouchSubmission(body, defaultCrewName) {
  if (!isGoogleDriveUrl(body.drive_url)) {
    throw validationError(
      "drive_url phải là link Google Drive (https://drive.google.com/…) — không nhận cloud khác",
      "DRIVE_URL_NOT_ALLOWED"
    );
  }
  if (body.role_position !== undefined && body.role_position !== null) {
    normalizeRolePosition(body.role_position, "retouch"); // chỉ để chặn vai trò thợ gửi nhầm
  }
  return {
    crewType: "retouch",
    crewName: requireText(body.crew_name ?? defaultCrewName, "crew_name", 80, "INVALID_CREW_NAME"),
    rolePosition: RETOUCH_ROLE,
    driveUrl: body.drive_url.trim(),
    totalFiles: parseCount(body.total_files, "total_files", { min: 1, required: true }),
    rawCount: 0,
    jpgCount: 0,
    videoCount: 0,
    culledStats: {},
    // Không áp dụng kiểm tra cấu trúc RAW/JPG cho ảnh đã chỉnh
    hasValidStructure: true,
    backupCommitted45d: body.backup_committed_45d === true,
  };
}

function validateSubmission(body, { defaultCrewName } = {}) {
  if (!CREW_TYPES.includes(body.crew_type)) {
    throw validationError("crew_type phải là 'photo', 'video' hoặc 'retouch'", "INVALID_CREW_TYPE");
  }
  const crewType = body.crew_type;
  if (crewType === "retouch") return validateRetouchSubmission(body, defaultCrewName);

  if (!isGoogleDriveUrl(body.drive_url)) {
    throw validationError(
      "drive_url phải là link Google Drive (https://drive.google.com/…) — không nhận cloud khác",
      "DRIVE_URL_NOT_ALLOWED"
    );
  }
  if (body.backup_committed_45d !== true) {
    throw validationError(
      "Phải cam kết giữ bản backup trên máy cá nhân tối thiểu 45 ngày",
      "BACKUP_COMMITMENT_REQUIRED"
    );
  }
  if (typeof body.has_valid_structure !== "boolean") {
    throw validationError("has_valid_structure phải là boolean", "INVALID_STRUCTURE_FLAG");
  }

  const rawCount = parseCount(body.raw_count, "raw_count");
  const jpgCount = parseCount(body.jpg_count, "jpg_count");
  const videoCount = parseCount(body.video_count, "video_count");
  if (crewType === "photo" && videoCount > 0) {
    throw validationError("Thợ ảnh không khai video_count", "COUNT_CREW_TYPE_MISMATCH");
  }
  if (crewType === "video" && (rawCount > 0 || jpgCount > 0)) {
    throw validationError("Thợ quay không khai raw_count/jpg_count", "COUNT_CREW_TYPE_MISMATCH");
  }

  const crewNameInput = body.crew_name ?? defaultCrewName;
  return {
    crewType,
    crewName: requireText(crewNameInput, "crew_name", 80, "INVALID_CREW_NAME"),
    rolePosition: normalizeRolePosition(body.role_position, crewType),
    driveUrl: body.drive_url.trim(),
    totalFiles: parseCount(body.total_files, "total_files", { min: 1, required: true }),
    rawCount,
    jpgCount,
    videoCount,
    culledStats: parseCulledStats(body.culled_stats),
    hasValidStructure: body.has_valid_structure,
    backupCommitted45d: true,
  };
}

/**
 * Ảnh:  "20/11/2026 Nguyễn Văn A Lead 850 file 12A5 THPT Kim Liên"
 * Quay: "20/11/2026 Trần B Quay chính 42 clip 12A5 THPT Kim Liên"
 */
function formatFolderName({ shootDate, crewName, rolePosition, totalFiles, crewType, className, schoolName }) {
  const unit = crewType === "video" ? "clip" : "file";
  return `${formatDisplayDate(shootDate)} ${crewName} ${rolePosition} ${totalFiles} ${unit} ${className} ${schoolName}`;
}

// ---------------------------------------------------------------- review

function validateReview(body) {
  if (!REVIEW_STATUSES.includes(body.status)) {
    throw validationError("status phải là 'approved' hoặc 'rejected'", "INVALID_REVIEW_STATUS");
  }
  let note = null;
  if (body.studio_note !== undefined && body.studio_note !== null) {
    if (typeof body.studio_note !== "string") {
      throw validationError("studio_note phải là chuỗi", "INVALID_STUDIO_NOTE");
    }
    note = body.studio_note.trim() || null;
    if (note && note.length > 1000) {
      throw validationError("studio_note tối đa 1000 ký tự", "INVALID_STUDIO_NOTE");
    }
  }
  if (body.status === "rejected" && !note) {
    throw validationError("Yêu cầu sửa lại phải kèm studio_note nói rõ cần sửa gì", "STUDIO_NOTE_REQUIRED");
  }
  return { status: body.status, studioNote: note };
}

module.exports = {
  SHOW_STATUSES,
  CREW_TYPES,
  MEMBER_ROLES,
  SUBMIT_TYPES_BY_MEMBER_ROLE,
  RETOUCH_ROLE,
  validateMemberRole,
  CULLED_STAT_KEYS,
  buildInviteCodePrefix,
  generateInviteCode,
  normalizeInviteCode,
  validateCreateShow,
  validateSubmission,
  normalizeRolePosition,
  isGoogleDriveUrl,
  formatFolderName,
  formatDisplayDate,
  validateReview,
};
