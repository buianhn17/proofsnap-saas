// Chuẩn bị 1 ảnh trước khi upload, chạy trong Web Worker (pool ở uploadPrepClient.ts):
//   1. Nén theo preset của album (cạnh dài + chất lượng JPEG), giữ EXIF của file gốc.
//   2. Đọc giờ chụp từ EXIF — album sắp ảnh theo giờ chụp.
//   3. Cắt vùng quanh từng khuôn mặt từ ẢNH GỐC full-res cho AI Face Search: ảnh nén 2560px
//      của 1 ảnh tập thể cả lớp chỉ còn mặt ~23px, quá nhỏ để trích embedding, còn ở ảnh gốc
//      mặt đó ~55px (đo trên ảnh thật: từ vùng cắt tìm lại được 49/52 người giữa 2 khung,
//      0 cặp khớp nhầm). Hộp khuôn mặt lấy từ trang Cull nếu có, không thì tự dò bằng SCRFD.
// Thay cho browser-image-compression: thư viện đó tạo 1 worker mới cho MỖI ảnh và không cho
// lấy lại ảnh gốc đã giải mã để cắt khuôn mặt.

/// <reference lib="webworker" />

import { parseMetadataFromHeader, readFileHeader } from "../culling/exifMetadata";
import { detectFaces, getFaceDetector } from "../culling/faceDetector";
import type { NormalizedFaceBox } from "../culling/types";
import { exifForRedrawnImage, findExifSegment, insertExifSegment } from "./jpegExif";
import type {
  FaceCropRegion,
  PreparedUpload,
  PrepareUploadRequest,
  PrepareUploadResponse,
} from "./uploadPrepProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// DetectedFace.box của trang Cull = hộp landmark đệm thêm 35% mỗi phía (FACE_BOX_PADDING_RATIO
// ở eyeStatus.ts) — chia lại để ra cỡ mặt thật, cùng thang với hộp SCRFD.
const CULL_FACE_BOX_PADDING = 1 + 2 * 0.35;
// Vùng cắt vuông = hệ số này x cạnh mặt: mặt nằm giữa, chiếm ~1/2 vùng cắt (BE chỉ nhận mặt
// ở vùng giữa, xem detectFacesInCrops).
const CROP_CONTEXT_SCALE = 2.2;
// Mặt nhỏ hơn mức này ở ảnh gốc cho embedding nhiễu, dễ khớp nhầm — bỏ (cùng ngưỡng
// MIN_FACE_SIZE_PX của BE).
const MIN_FACE_PX = 40;
// Cạnh vùng cắt sau khi resize: mặt nhỏ phóng lên tối thiểu, mặt lớn thu về tối đa — ArcFace
// chỉ cần mặt 112px.
const CROP_MIN_PX = 128;
const CROP_MAX_PX = 320;
const CROP_JPEG_QUALITY = 0.92;
// Khớp MAX_FACE_CROPS ở BE (routes/photos.js).
const MAX_FACE_CROPS = 150;

interface FaceRect {
  cx: number;
  cy: number;
  /** Cạnh mặt theo pixel ảnh gốc. */
  size: number;
}

async function encodeResized(bitmap: ImageBitmap, maxLongEdgePx: number, jpegQuality: number) {
  const scale = Math.min(1, maxLongEdgePx / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Không tạo được canvas để nén ảnh");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: jpegQuality / 100 });
  return { blob, width, height };
}

/** Mặt từ trang Cull, hoặc tự dò bằng SCRFD. null nếu không dò được (model không tải được). */
async function findFaces(
  bitmap: ImageBitmap,
  cullBoxes: NormalizedFaceBox[] | null
): Promise<FaceRect[] | null> {
  const { width, height } = bitmap;
  if (cullBoxes) {
    return cullBoxes.map((box) => ({
      cx: (box.x + box.width / 2) * width,
      cy: (box.y + box.height / 2) * height,
      size: Math.max(box.width * width, box.height * height) / CULL_FACE_BOX_PADDING,
    }));
  }
  const detector = await getFaceDetector("gpu");
  if (!detector) return null;
  const boxes = await detectFaces(detector, bitmap);
  return boxes.map((box) => ({
    cx: (box.x + box.width / 2) * width,
    cy: (box.y + box.height / 2) * height,
    size: Math.max(box.width * width, box.height * height),
  }));
}

async function cropFaces(bitmap: ImageBitmap, faces: FaceRect[]) {
  const crops: Blob[] = [];
  const regions: FaceCropRegion[] = [];
  const usable = faces
    .filter((face) => face.size >= MIN_FACE_PX)
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_FACE_CROPS);
  for (const face of usable) {
    const side = CROP_CONTEXT_SCALE * face.size;
    const sx = face.cx - side / 2;
    const sy = face.cy - side / 2;
    const outSize = Math.round(Math.min(CROP_MAX_PX, Math.max(CROP_MIN_PX, side)));
    const canvas = new OffscreenCanvas(outSize, outSize);
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // Phần vùng cắt tràn ra ngoài ảnh để đen — drawImage tự cắt nguồn và co đích tương ứng.
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, outSize, outSize);
    crops.push(await canvas.convertToBlob({ type: "image/jpeg", quality: CROP_JPEG_QUALITY }));
    regions.push({
      x: sx / bitmap.width,
      y: sy / bitmap.height,
      w: side / bitmap.width,
      h: side / bitmap.height,
    });
  }
  return { crops, regions };
}

async function prepare(request: PrepareUploadRequest): Promise<PreparedUpload> {
  const header = await readFileHeader(request.file);
  const metadata = parseMetadataFromHeader(header);
  // Giải mã full-res (đã xoay theo EXIF) — dùng chung cho bản nén và các vùng cắt khuôn mặt.
  const bitmap = await createImageBitmap(request.file);
  try {
    const resized = await encodeResized(bitmap, request.maxLongEdgePx, request.jpegQuality);
    const exif = findExifSegment(header);
    const patchedExif = exif ? exifForRedrawnImage(exif) : null;
    const blob = patchedExif ? await insertExifSegment(resized.blob, patchedExif) : resized.blob;

    const faces = await findFaces(bitmap, request.faceBoxes).catch((err: unknown) => {
      console.warn("Không dò được khuôn mặt để cắt cho Face Search:", err);
      return null;
    });
    const cropped = faces ? await cropFaces(bitmap, faces) : null;

    return {
      blob,
      width: resized.width,
      height: resized.height,
      capturedAt:
        metadata.capturedAtMs !== null ? new Date(metadata.capturedAtMs).toISOString() : null,
      faceCrops: cropped?.crops ?? [],
      faceCropRegions: cropped?.regions ?? [],
      faceCropsProvided: cropped !== null,
    };
  } finally {
    bitmap.close();
  }
}

ctx.onmessage = (event: MessageEvent<PrepareUploadRequest>) => {
  const request = event.data;
  if (request.type !== "prepare") return;
  prepare(request)
    .then((result) =>
      ctx.postMessage({ type: "prepared", jobId: request.jobId, result } satisfies PrepareUploadResponse)
    )
    .catch((err: unknown) =>
      ctx.postMessage({
        type: "error",
        jobId: request.jobId,
        message: err instanceof Error ? err.message : "Không chuẩn bị được ảnh để upload",
      } satisfies PrepareUploadResponse)
    );
};
