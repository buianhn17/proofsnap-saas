// Kết quả "rỗng" cho 1 ảnh xử lý thất bại (file hỏng, không decode được, worker crash) —
// dùng chung cho culling.worker.ts và cullingWorkerClient.ts. Tách riêng file nhỏ, không
// import gì chạy được, để main thread không kéo theo code MediaPipe của pipeline.

import type { WorkerItemResult } from "./cullingWorkerProtocol";

export function errorItemResult(message: string): WorkerItemResult {
  return {
    width: 0,
    height: 0,
    metrics: {
      sharpnessScore: 0,
      exposure: {
        score: 0,
        meanLuma: 0,
        shadowClipRatio: 0,
        highlightClipRatio: 0,
        underexposed: false,
        overexposed: false,
      },
      hash: "0".repeat(16),
      faceCount: 0,
      earValue: null,
      eyeStatus: "no_face",
      faces: [],
    },
    timingsMs: { decode: 0, sharpness: 0, hash: 0, eye: 0, total: 0 },
    sceneSignals: {
      capturedAtMs: null,
      timestampSource: "file",
      exif: { focalLengthMm: null, fNumber: null, exposureTimeS: null, iso: null },
      histogram: [],
      signature: [],
    },
    thumbnailBlob: new Blob([], { type: "image/jpeg" }),
    previewBlob: new Blob([], { type: "image/jpeg" }),
    usedEmbeddedPreview: false,
    error: message,
  };
}
