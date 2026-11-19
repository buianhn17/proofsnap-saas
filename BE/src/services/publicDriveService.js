// Đọc thư mục / file Google Drive CÔNG KHAI ("Bất kỳ ai có đường liên kết") bằng API key.
//
// Vì sao không dùng token Google của PTG: app chỉ xin quyền `drive.file` — quyền này chỉ đọc
// được file do chính LensProof tạo, không đọc được thư mục PTG tự up hay người khác chia sẻ.
// Mở rộng sang `drive.readonly` là quyền "restricted", Google bắt kiểm định bảo mật tốn phí.
// API key đọc được mọi file đã để công khai, đủ cho việc nhập ảnh.
//
// Cấu hình: GOOGLE_API_KEY trong .env (Google Cloud Console → APIs & Services → Credentials →
// Create API key, bật "Google Drive API", nên giới hạn key chỉ dùng Drive API).

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const MAX_FOLDER_DEPTH = 3;
const MAX_FOLDERS = 60;
const MAX_IMAGES = 5000;
const MAX_FILE_BYTES = 80 * 1024 * 1024;

function driveError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getApiKey() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    throw driveError(
      503,
      "DRIVE_IMPORT_NOT_CONFIGURED",
      "Chưa cấu hình GOOGLE_API_KEY trên server nên chưa nhập được ảnh từ link Drive. Xem hướng dẫn trong BE/README.md."
    );
  }
  return key;
}

/**
 * Nhận diện link Drive: thư mục (…/folders/<id>), file (…/file/d/<id>/…), …?id=<id>, hoặc id trần.
 * Trả về { kind: "folder" | "file" | "unknown", id } hoặc null nếu không phải link Drive.
 */
function parseDriveLink(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value.length > 2048) return null;
  if (DRIVE_ID_PATTERN.test(value)) return { kind: "unknown", id: value };

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !["drive.google.com", "docs.google.com"].includes(url.hostname)) {
    return null;
  }
  const folder = url.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (folder) return { kind: "folder", id: folder[1] };
  const file = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (file) return { kind: "file", id: file[1] };
  const idParam = url.searchParams.get("id");
  if (idParam && DRIVE_ID_PATTERN.test(idParam)) return { kind: "unknown", id: idParam };
  return null;
}

/** Lỗi HTTP của Drive API → lỗi có code để FE hiện thông báo dễ hiểu. */
async function toDriveError(response) {
  let reason = "";
  let message = "";
  try {
    const body = await response.json();
    reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "";
    message = body?.error?.message ?? "";
  } catch {
    // body không phải JSON
  }
  if (response.status === 404 || (response.status === 403 && /forbidden|insufficient|notFound/i.test(reason))) {
    return driveError(
      404,
      "DRIVE_NOT_PUBLIC",
      "Không mở được link này — kiểm tra link đúng và thư mục đã chia sẻ “Bất kỳ ai có đường liên kết”."
    );
  }
  if (response.status === 429 || /rateLimit|quota|downloadQuotaExceeded/i.test(reason)) {
    return driveError(429, "DRIVE_QUOTA_EXCEEDED", "Google Drive đang giới hạn lượt tải, thử lại sau ít phút.");
  }
  if (response.status === 400 && /API key/i.test(message)) {
    return driveError(503, "DRIVE_API_KEY_INVALID", "GOOGLE_API_KEY trên server không hợp lệ hoặc chưa bật Google Drive API.");
  }
  return driveError(502, "DRIVE_REQUEST_FAILED", `Google Drive trả lỗi ${response.status}${message ? `: ${message}` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gọi Drive API, tự thử lại khi bị giới hạn lượt (429/403 rate limit) hoặc lỗi 5xx. */
async function driveFetch(path, params, { fetchImpl = fetch, as = "json", attempts = 4 } = {}) {
  const url = new URL(`${DRIVE_API}/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: getApiKey() })) {
    url.searchParams.set(key, value);
  }
  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(url);
    if (response.ok) {
      return as === "buffer" ? Buffer.from(await response.arrayBuffer()) : response.json();
    }
    const error = await toDriveError(response);
    const retryable = error.code === "DRIVE_QUOTA_EXCEEDED" || response.status >= 500;
    if (!retryable || attempt >= attempts) throw error;
    await sleep(500 * 2 ** (attempt - 1));
  }
}

const FILE_FIELDS = "id,name,mimeType,size,imageMediaMetadata(time,width,height)";

function isJpeg(file) {
  return file.mimeType === "image/jpeg" || /\.jpe?g$/i.test(file.name ?? "");
}

/** EXIF "2026:11:20 17:30:05" (giờ máy ảnh, không múi giờ) → ISO, coi là giờ Việt Nam. */
function exifTimeToIso(value) {
  const match = typeof value === "string" && value.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+07:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toImage(file) {
  return {
    id: file.id,
    name: file.name,
    size: file.size ? Number(file.size) : null,
    capturedAt: exifTimeToIso(file.imageMediaMetadata?.time),
  };
}

/**
 * Liệt kê ảnh JPG ở link công khai (thư mục: gồm cả thư mục con tới 3 cấp).
 * Trả { kind, id, name, images: [{ id, name, size, capturedAt }], unsupportedCount }.
 */
async function listPublicImages(link, { fetchImpl } = {}) {
  const opts = { fetchImpl };
  const root = await driveFetch(`files/${link.id}`, { fields: FILE_FIELDS, supportsAllDrives: "true" }, opts);

  if (root.mimeType !== FOLDER_MIME) {
    if (!isJpeg(root)) {
      throw driveError(400, "DRIVE_NO_IMAGES", "File này không phải ảnh JPG — hiện chỉ nhập được ảnh JPG.");
    }
    return { kind: "file", id: root.id, name: root.name, images: [toImage(root)], unsupportedCount: 0 };
  }

  const images = [];
  let unsupportedCount = 0;
  let folderCount = 0;
  const queue = [{ id: root.id, depth: 0 }];

  while (queue.length > 0) {
    const folder = queue.shift();
    folderCount += 1;
    let pageToken;
    do {
      const page = await driveFetch(
        "files",
        {
          q: `'${folder.id}' in parents and trashed = false`,
          fields: `nextPageToken, files(${FILE_FIELDS})`,
          pageSize: "1000",
          orderBy: "name_natural",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
          ...(pageToken ? { pageToken } : {}),
        },
        opts
      );
      for (const file of page.files ?? []) {
        if (file.mimeType === FOLDER_MIME) {
          if (folder.depth + 1 <= MAX_FOLDER_DEPTH && folderCount + queue.length < MAX_FOLDERS) {
            queue.push({ id: file.id, depth: folder.depth + 1 });
          }
        } else if (isJpeg(file)) {
          images.push(toImage(file));
        } else {
          unsupportedCount += 1;
        }
      }
      if (images.length > MAX_IMAGES) {
        throw driveError(
          400,
          "DRIVE_IMPORT_TOO_LARGE",
          `Thư mục có hơn ${MAX_IMAGES} ảnh JPG — chia nhỏ thành nhiều thư mục rồi nhập từng phần.`
        );
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  return { kind: "folder", id: root.id, name: root.name, images, unsupportedCount };
}

/** Tải nội dung 1 file công khai về bộ nhớ. */
async function downloadPublicFile(fileId, { fetchImpl, expectedSize } = {}) {
  if (expectedSize && expectedSize > MAX_FILE_BYTES) {
    throw driveError(400, "DRIVE_FILE_TOO_LARGE", "Ảnh lớn hơn 80 MB");
  }
  return driveFetch(`files/${fileId}`, { alt: "media", supportsAllDrives: "true" }, { fetchImpl, as: "buffer" });
}

module.exports = {
  parseDriveLink,
  listPublicImages,
  downloadPublicFile,
  exifTimeToIso,
  getApiKey,
  MAX_IMAGES,
};
