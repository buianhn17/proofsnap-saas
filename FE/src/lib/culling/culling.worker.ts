// Bước 1.5 — toàn bộ pipeline phân tích ảnh (giải mã, độ nét, dHash, phát hiện mắt) chạy
// TRONG worker này, không đụng tới main thread — nhờ vậy UI (cuộn, click, progress bar)
// luôn mượt kể cả khi đang xử lý hàng trăm ảnh nặng. Giao tiếp thuần qua postMessage theo
// hợp đồng ở cullingWorkerProtocol.ts. Không import bất kỳ thứ gì từ React/DOM-only code.

/// <reference lib="webworker" />

import { processOneImage, type CullingPipelineOptions } from "./cullingPipeline";
import { getFaceLandmarker } from "./eyeStatus";
import { getHardwareInfo } from "./hardwareAcceleration";
import type { LocalPhotoFile } from "../localPhotoFile";
import type { WorkerRequest, WorkerResponse } from "./cullingWorkerProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let currentRunAborted = false;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "abort") {
    currentRunAborted = true;
    return;
  }
  if (message.type === "run") {
    currentRunAborted = false;
    runPipeline(message.files, message.options).catch((err) => {
      post({
        type: "error",
        message: err instanceof Error ? err.message : "Lỗi không xác định trong worker",
      });
    });
  }
};

function post(response: WorkerResponse) {
  ctx.postMessage(response);
}

async function runPipeline(
  files: LocalPhotoFile[],
  options: CullingPipelineOptions
) {
  const accelerationTier = options.accelerationTier ?? "gpu";
  const [landmarker, hardwareInfo] = await Promise.all([
    getFaceLandmarker(accelerationTier),
    getHardwareInfo(),
  ]);

  const startedAt = performance.now();
  let processedCount = 0;

  for (let i = 0; i < files.length; i += 1) {
    if (currentRunAborted) break;
    const localFile = files[i];

    try {
      const processed = await processOneImage(localFile.file, options, landmarker);
      post({
        type: "item",
        result: { index: i, ...processed },
      });
    } catch (err) {
      post({
        type: "item",
        result: {
          index: i,
          width: 0,
          height: 0,
          metrics: {
            sharpnessScore: 0,
            hash: "0".repeat(16),
            faceCount: 0,
            earValue: null,
            eyeStatus: "no_face",
            faces: [],
          },
          timingsMs: { decode: 0, sharpness: 0, hash: 0, eye: 0, total: 0 },
          sceneSignals: { capturedAtMs: null, histogram: [] },
          error: err instanceof Error ? err.message : "Lỗi không xác định",
        },
      });
    }

    processedCount += 1;
    const elapsedMs = performance.now() - startedAt;
    post({
      type: "progress",
      processed: processedCount,
      total: files.length,
      currentFileName: localFile.file.name,
      elapsedMs,
      imagesPerSecond: processedCount / (elapsedMs / 1000),
    });
  }

  const totalElapsedMs = performance.now() - startedAt;
  post({
    type: "done",
    itemCount: processedCount,
    totalElapsedMs,
    imagesPerSecond: processedCount / (totalElapsedMs / 1000),
    accelerationTier,
    hardwareInfo,
  });
}