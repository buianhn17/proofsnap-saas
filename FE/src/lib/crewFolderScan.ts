// Quét thư mục bàn giao của thợ (100% trong trình duyệt, File System Access API).
// Khác pickLocalPhotoFolder (chỉ nhặt RAW/JPG): ở đây cần thấy MỌI file — file nén RAW
// (.zip/.rar/.7z), video, file proxy — để kiểm tra cấu trúc bàn giao.

import {
  FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE,
  JPG_EXTENSIONS,
  RAW_EXTENSIONS,
  getExtension,
  isFileSystemAccessSupported,
} from "./localFolderImport";
import type { LocalPhotoFile } from "./localPhotoFile";

export interface InventoryFile {
  file: File;
  relativePath: string;
  extension: string;
  handle: FileSystemFileHandle;
  parentDirHandle: FileSystemDirectoryHandle;
}

export interface FolderInventory {
  folderName: string;
  rootHandle: FileSystemDirectoryHandle;
  files: InventoryFile[];
}

export const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z"]);
export const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "mxf", "mts", "m2ts", "avi", "mkv", "m4v", "r3d", "braw", "crm", "insv", "mpg", "mpeg",
]);
// File proxy/thumbnail máy quay tự sinh — không phải footage gốc.
export const PROXY_EXTENSIONS = new Set(["lrv", "thm"]);

async function walk(
  dir: FileSystemDirectoryHandle,
  parentPath: string,
  out: InventoryFile[]
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    // File/thư mục ẩn hệ thống (.DS_Store, @eaDir của NAS…)
    if (name.startsWith(".") || name.startsWith("@")) continue;
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === "directory") {
      await walk(handle as FileSystemDirectoryHandle, path, out);
      continue;
    }
    const fileHandle = handle as FileSystemFileHandle;
    out.push({
      file: await fileHandle.getFile(),
      relativePath: path,
      extension: getExtension(name),
      handle: fileHandle,
      parentDirHandle: dir,
    });
  }
}

/** Mở hộp thoại chọn thư mục; null nếu người dùng huỷ. */
export async function pickFolderInventory(): Promise<FolderInventory | null> {
  if (!isFileSystemAccessSupported()) throw new Error(FILE_SYSTEM_ACCESS_UNSUPPORTED_MESSAGE);
  let rootHandle: FileSystemDirectoryHandle;
  try {
    rootHandle = await window.showDirectoryPicker!({ mode: "read" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
  const files: InventoryFile[] = [];
  await walk(rootHandle, "", files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));
  return { folderName: rootHandle.name, rootHandle, files };
}

function topSegment(relativePath: string): string | null {
  const slash = relativePath.indexOf("/");
  return slash === -1 ? null : relativePath.slice(0, slash);
}

export function baseName(relativePath: string): string {
  const leaf = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const dot = leaf.lastIndexOf(".");
  return (dot === -1 ? leaf : leaf.slice(0, dot)).toLowerCase();
}

function toLocalPhoto(f: InventoryFile, kind: "raw" | "jpg"): LocalPhotoFile {
  return { ...f, kind };
}

// ------------------------------------------------------------------ ZIP: đếm RAW bên trong

/**
 * Đọc mục lục (central directory) của file .zip để lấy tên các file bên trong mà KHÔNG giải
 * nén — chỉ đọc vài trăm KB cuối file. Hỗ trợ ZIP64 (file nén RAW cả show thường > 4GB).
 * Trả null nếu không đọc được (file hỏng, định dạng lạ).
 */
export async function listZipEntryNames(file: File): Promise<string[] | null> {
  try {
    const tailSize = Math.min(file.size, 65_535 + 22 + 20);
    const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;

    let entries = tail.getUint16(eocd + 10, true);
    let cdSize = tail.getUint32(eocd + 12, true);
    let cdOffset = tail.getUint32(eocd + 16, true);

    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locator = eocd - 20;
      if (locator < 0 || tail.getUint32(locator, true) !== 0x07064b50) return null;
      const zip64Offset = Number(tail.getBigUint64(locator + 8, true));
      const zip64 = new DataView(await file.slice(zip64Offset, zip64Offset + 56).arrayBuffer());
      if (zip64.getUint32(0, true) !== 0x06064b50) return null;
      entries = Number(zip64.getBigUint64(32, true));
      cdSize = Number(zip64.getBigUint64(40, true));
      cdOffset = Number(zip64.getBigUint64(48, true));
    }
    if (cdSize > 64 * 1024 * 1024) return null;

    const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const decoder = new TextDecoder();
    const names: string[] = [];
    let p = 0;
    for (let i = 0; i < entries && p + 46 <= cd.byteLength; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const nameLength = cd.getUint16(p + 28, true);
      const extraLength = cd.getUint16(p + 30, true);
      const commentLength = cd.getUint16(p + 32, true);
      names.push(decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength)));
      p += 46 + nameLength + extraLength + commentLength;
    }
    return names;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ cấu trúc bàn giao ẢNH

export interface StructureCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  /** false = chỉ cảnh báo, không chặn nộp */
  blocking: boolean;
}

export interface PhotoStructure {
  checks: StructureCheck[];
  valid: boolean;
  rawContainer:
    | { kind: "archive"; name: string; file: File; rawCount: number | null }
    | { kind: "folder"; name: string; raws: LocalPhotoFile[] }
    | null;
  jpgFolderName: string | null;
  /** JPG trong folder JPG — đầu vào cho AI culling. */
  jpgs: LocalPhotoFile[];
  /** RAW theo tên gốc (chỉ khi RAW để dạng folder) — để xoá kèm khi loại ảnh. */
  rawByBaseName: Map<string, LocalPhotoFile>;
}

/**
 * Chuẩn bàn giao ảnh: trong thư mục đã chọn có đúng 01 nơi chứa RAW (file nén .zip/.rar/.7z
 * HOẶC 1 folder chỉ chứa RAW) + đúng 01 folder JPG không nén. Không để ảnh lẻ ở ngoài.
 */
export async function analyzePhotoStructure(inventory: FolderInventory): Promise<PhotoStructure> {
  const folders = new Map<string, { raw: InventoryFile[]; jpg: InventoryFile[] }>();
  const looseImages: InventoryFile[] = [];
  const rootArchives: InventoryFile[] = [];

  for (const f of inventory.files) {
    const top = topSegment(f.relativePath);
    const isRaw = RAW_EXTENSIONS.has(f.extension);
    const isJpg = JPG_EXTENSIONS.has(f.extension);
    if (top === null) {
      if (ARCHIVE_EXTENSIONS.has(f.extension)) rootArchives.push(f);
      else if (isRaw || isJpg) looseImages.push(f);
      continue;
    }
    if (!isRaw && !isJpg) continue;
    const bucket = folders.get(top) ?? { raw: [], jpg: [] };
    (isRaw ? bucket.raw : bucket.jpg).push(f);
    folders.set(top, bucket);
  }

  const rawFolders = [...folders].filter(([, b]) => b.raw.length > 0 && b.jpg.length === 0);
  const jpgFolders = [...folders].filter(([, b]) => b.jpg.length > 0 && b.raw.length === 0);
  const mixedFolders = [...folders].filter(([, b]) => b.jpg.length > 0 && b.raw.length > 0);
  const rawContainerCount = rootArchives.length + rawFolders.length;

  let rawContainer: PhotoStructure["rawContainer"] = null;
  if (rawContainerCount === 1) {
    if (rootArchives.length === 1) {
      const archive = rootArchives[0];
      const names = archive.extension === "zip" ? await listZipEntryNames(archive.file) : null;
      rawContainer = {
        kind: "archive",
        name: archive.relativePath,
        file: archive.file,
        rawCount: names
          ? names.filter((n) => !n.endsWith("/") && RAW_EXTENSIONS.has(getExtension(n))).length
          : null,
      };
    } else {
      const [name, bucket] = rawFolders[0];
      rawContainer = { kind: "folder", name, raws: bucket.raw.map((f) => toLocalPhoto(f, "raw")) };
    }
  }

  const jpgFolder = jpgFolders.length === 1 ? jpgFolders[0] : null;
  const jpgs = jpgFolder ? jpgFolder[1].jpg.map((f) => toLocalPhoto(f, "jpg")) : [];
  const rawByBaseName = new Map<string, LocalPhotoFile>();
  if (rawContainer?.kind === "folder") {
    for (const raw of rawContainer.raws) rawByBaseName.set(baseName(raw.relativePath), raw);
  }

  const rawCount = rawContainer?.kind === "folder" ? rawContainer.raws.length : rawContainer?.rawCount ?? null;
  const checks: StructureCheck[] = [
    {
      id: "raw",
      label: "01 file nén RAW (.zip/.rar/.7z) hoặc 01 folder RAW",
      ok: rawContainerCount === 1,
      detail:
        rawContainerCount === 0
          ? "Chưa thấy file nén hay folder chứa RAW"
          : rawContainerCount > 1
            ? `Đang có ${rawContainerCount} nơi chứa RAW — gộp lại còn 1`
            : rawContainer?.name,
      blocking: true,
    },
    {
      id: "jpg",
      label: "01 folder ảnh JPG không nén",
      ok: jpgFolders.length === 1,
      detail:
        jpgFolders.length === 0
          ? "Chưa thấy folder chỉ chứa JPG"
          : jpgFolders.length > 1
            ? `Đang có ${jpgFolders.length} folder JPG (${jpgFolders.map(([n]) => n).join(", ")}) — gộp lại còn 1`
            : `${jpgFolder![0]} · ${jpgs.length} ảnh`,
      blocking: true,
    },
    {
      id: "mixed",
      label: "RAW và JPG không để lẫn trong cùng folder",
      ok: mixedFolders.length === 0,
      detail: mixedFolders.length ? `Folder lẫn: ${mixedFolders.map(([n]) => n).join(", ")}` : undefined,
      blocking: true,
    },
    {
      id: "loose",
      label: "Không có ảnh lẻ nằm ngoài folder",
      ok: looseImages.length === 0,
      detail: looseImages.length ? `${looseImages.length} ảnh đang nằm ngay thư mục gốc` : undefined,
      blocking: true,
    },
  ];
  if (rawCount !== null && jpgs.length > 0 && rawCount !== jpgs.length) {
    checks.push({
      id: "count",
      label: "Số RAW khớp số JPG",
      ok: false,
      detail: `RAW ${rawCount} · JPG ${jpgs.length}`,
      blocking: false,
    });
  }

  return {
    checks,
    valid: checks.every((c) => c.ok || !c.blocking),
    rawContainer,
    jpgFolderName: jpgFolder?.[0] ?? null,
    jpgs,
    rawByBaseName,
  };
}

// ------------------------------------------------------------------ footage QUAY PHIM

export interface VideoScan {
  clips: InventoryFile[];
  totalBytes: number;
  zeroByteClips: InventoryFile[];
  proxyFiles: InventoryFile[];
  otherFileCount: number;
  byFolder: { folder: string; count: number; bytes: number }[];
  byExtension: { extension: string; count: number }[];
}

export function analyzeVideoFolder(inventory: FolderInventory): VideoScan {
  const clips = inventory.files.filter((f) => VIDEO_EXTENSIONS.has(f.extension));
  const proxyFiles = inventory.files.filter((f) => PROXY_EXTENSIONS.has(f.extension));
  const folderMap = new Map<string, { count: number; bytes: number }>();
  const extMap = new Map<string, number>();
  for (const clip of clips) {
    const slash = clip.relativePath.lastIndexOf("/");
    const folder = slash === -1 ? "(thư mục gốc)" : clip.relativePath.slice(0, slash);
    const entry = folderMap.get(folder) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += clip.file.size;
    folderMap.set(folder, entry);
    extMap.set(clip.extension, (extMap.get(clip.extension) ?? 0) + 1);
  }
  return {
    clips,
    totalBytes: clips.reduce((sum, c) => sum + c.file.size, 0),
    zeroByteClips: clips.filter((c) => c.file.size === 0),
    proxyFiles,
    otherFileCount: inventory.files.length - clips.length - proxyFiles.length,
    byFolder: [...folderMap].map(([folder, v]) => ({ folder, ...v })),
    byExtension: [...extMap].map(([extension, count]) => ({ extension, count })).sort((a, b) => b.count - a.count),
  };
}
