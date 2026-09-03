const { google } = require("googleapis");
const { Readable } = require("node:stream");
const { decrypt } = require("../utils/crypto");
const { findById, updateDriveRootFolder } = require("../models/photographerModel");

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "LensProof";
const ALBUMS_FOLDER_NAME = "Albums";

function createPhotographerOAuthClient(refreshToken) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function getDriveForPhotographer(photographerId) {
  const photographer = await findById(photographerId);
  if (!photographer) {
    const error = new Error("Không tìm thấy nhiếp ảnh gia");
    error.statusCode = 404;
    error.code = "PHOTOGRAPHER_NOT_FOUND";
    throw error;
  }

  const refreshToken = decrypt(photographer.oauth_refresh_token_encrypted);
  const auth = createPhotographerOAuthClient(refreshToken);
  return { drive: google.drive({ version: "v3", auth }), photographer };
}

async function findFolder(drive, name, parentId) {
  const parentFilter = parentId ? ` and '${parentId}' in parents` : "";
  const response = await drive.files.list({
    q: `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false${parentFilter}`,
    fields: "files(id, name, parents, webViewLink)",
    spaces: "drive",
    pageSize: 10,
  });
  return response.data.files[0] || null;
}

async function createFolder(drive, name, parentId) {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME_TYPE,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id, name, parents, webViewLink",
  });
  return response.data;
}

async function findOrCreateFolder(drive, name, parentId) {
  return (await findFolder(drive, name, parentId)) || createFolder(drive, name, parentId);
}

async function setupPhotographerDrive(photographerId) {
  const { drive, photographer } = await getDriveForPhotographer(photographerId);
  const rootFolder = await findOrCreateFolder(drive, ROOT_FOLDER_NAME);
  const albumsFolder = await findOrCreateFolder(drive, ALBUMS_FOLDER_NAME, rootFolder.id);

  if (photographer.drive_root_folder_id !== rootFolder.id) {
    await updateDriveRootFolder(photographerId, rootFolder.id);
  }

  return {
    rootFolder,
    albumsFolder,
  };
}

async function checkPhotographerDrive(photographerId) {
  const { drive, photographer } = await getDriveForPhotographer(photographerId);
  const rootFolder = photographer.drive_root_folder_id
    ? await drive.files.get({
        fileId: photographer.drive_root_folder_id,
        fields: "id, name, parents, webViewLink, trashed",
      })
    : null;

  return {
    connected: true,
    rootFolder: rootFolder?.data || null,
  };
}

async function createAlbumFolder(photographerId, albumName) {
  const { drive, photographer } = await getDriveForPhotographer(photographerId);
  const rootFolder = photographer.drive_root_folder_id
    ? { id: photographer.drive_root_folder_id }
    : (await setupPhotographerDrive(photographerId)).rootFolder;
  const albumsFolder = await findOrCreateFolder(drive, ALBUMS_FOLDER_NAME, rootFolder.id);
  return findOrCreateFolder(drive, albumName, albumsFolder.id);
}

async function deleteFolder(photographerId, folderId) {
  const { drive } = await getDriveForPhotographer(photographerId);
  await drive.files.delete({ fileId: folderId });
}

async function uploadJpeg(photographerId, folderId, file) {
  const { drive } = await getDriveForPhotographer(photographerId);
  const response = await drive.files.create({
    requestBody: {
      name: file.originalname,
      parents: [folderId],
      mimeType: "image/jpeg",
    },
    media: {
      mimeType: "image/jpeg",
      body: Readable.from(file.buffer),
    },
    fields: "id, name, mimeType, size, parents, webViewLink",
  });
  return response.data;
}

async function deleteFile(photographerId, fileId) {
  const { drive } = await getDriveForPhotographer(photographerId);
  await drive.files.delete({ fileId });
}

// Bước 4.2 — PTG upload lại 1 file .zip đã hậu kỳ (retouch xong, tự đóng gói ở Lightroom),
// lưu vào đúng folder Drive của album. Khác uploadJpeg() ở mimeType/tên file tùy ý thay vì
// luôn ép .jpg.
async function uploadZipFile(photographerId, folderId, file) {
  const { drive } = await getDriveForPhotographer(photographerId);
  const response = await drive.files.create({
    requestBody: {
      name: file.originalname,
      parents: [folderId],
      mimeType: "application/zip",
    },
    media: {
      mimeType: "application/zip",
      body: Readable.from(file.buffer),
    },
    fields: "id, name, mimeType, size, parents, webViewLink",
  });
  return response.data;
}

async function downloadFileStream(photographerId, fileId) {
  const { drive } = await getDriveForPhotographer(photographerId);
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );
  return response.data;
}

async function downloadFileBuffer(photographerId, fileId) {
  const { drive } = await getDriveForPhotographer(photographerId);
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data);
}

module.exports = {
  checkPhotographerDrive,
  setupPhotographerDrive,
  createAlbumFolder,
  deleteFolder,
  uploadJpeg,
  uploadZipFile,
  deleteFile,
  downloadFileStream,
  downloadFileBuffer,
};