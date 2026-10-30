// Hợp đồng postMessage giữa PhotoUploadPanel (qua uploadPrepClient.ts) và
// uploadPrep.worker.ts. Chỉ chứa kiểu dữ liệu thuần, như cullingWorkerProtocol.ts.

import type { NormalizedFaceBox } from "../culling/types";

/** Vị trí 1 vùng cắt khuôn mặt, chuẩn hoá 0-1 theo kích thước ảnh (có thể tràn mép ảnh). */
export interface FaceCropRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrepareUploadRequest {
  type: "prepare";
  jobId: number;
  file: File;
  maxLongEdgePx: number;
  /** 1-100, như CompressionPreset.jpegQuality. */
  jpegQuality: number;
  /** Hộp khuôn mặt trang Cull đã dò trên chính ảnh này (DetectedFace.box — hộp landmark đã
   * đệm thêm). null: worker tự dò bằng SCRFD. */
  faceBoxes: NormalizedFaceBox[] | null;
}

export interface PreparedUpload {
  /** JPEG đã nén theo preset của album, giữ EXIF của file gốc. */
  blob: Blob;
  width: number;
  height: number;
  /** ISO 8601 từ EXIF DateTimeOriginal; null nếu file không có giờ chụp. */
  capturedAt: string | null;
  /** Vùng cắt quanh từng khuôn mặt, lấy từ ảnh GỐC full-res — BE trích embedding Face Search
   * từ đây thay vì từ ảnh đã nén (mặt nhỏ trong ảnh tập thể bị nén mất chi tiết). */
  faceCrops: Blob[];
  faceCropRegions: FaceCropRegion[];
  /** false: không dò được khuôn mặt (model lỗi) — BE tự dò trên ảnh đã upload. */
  faceCropsProvided: boolean;
}

export type PrepareUploadResponse =
  | { type: "prepared"; jobId: number; result: PreparedUpload }
  | { type: "error"; jobId: number; message: string };
