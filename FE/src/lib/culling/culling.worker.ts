// Bước 1.5 — pipeline phân tích ảnh (giải mã, độ nét, dHash, phơi sáng, mặt/mắt) chạy
// TRONG worker này, không đụng tới main thread — nhờ vậy UI (cuộn, click, progress bar)
// luôn mượt kể cả khi đang xử lý hàng nghìn ảnh. Nhiều instance của worker này chạy song
// song thành 1 pool (cullingWorkerClient.ts), mỗi instance có FaceLandmarker riêng.
// Giao tiếp thuần qua postMessage theo hợp đồng ở cullingWorkerProtocol.ts.

/// <reference lib="webworker" />

import { processOneImage } from "./cullingPipeline";
import { getFaceLandmarker } from "./eyeStatus";
import { getHardwareInfo, type AccelerationTier } from "./hardwareAcceleration";
import { errorItemResult } from "./errorItemResult";
import type { WorkerItemResult, WorkerRequest, WorkerResponse } from "./cullingWorkerProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let accelerationTier: AccelerationTier = "gpu";

function post(response: WorkerResponse) {
  ctx.postMessage(response);
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") {
    accelerationTier = message.accelerationTier;
    Promise.all([getFaceLandmarker(accelerationTier), getHardwareInfo()])
      .then(([, hardwareInfo]) => post({ type: "ready", hardwareInfo }))
      .catch((err) =>
        post({
          type: "initError",
          message: err instanceof Error ? err.message : "Không khởi tạo được model phát hiện mặt",
        })
      );
    return;
  }
  if (message.type === "process") {
    processJob(message.jobId, message.file, message.rawFile, message.options);
  }
};

async function processJob(
  jobId: number,
  file: File,
  rawFile: File | null,
  options: Extract<WorkerRequest, { type: "process" }>["options"]
) {
  let result: WorkerItemResult;
  try {
    const landmarker = await getFaceLandmarker(accelerationTier);
    result = await processOneImage(file, rawFile, options, landmarker);
  } catch (err) {
    // Ảnh hỏng/không decode được: trả item lỗi thay vì làm hỏng cả lượt chạy.
    result = errorItemResult(err instanceof Error ? err.message : "Lỗi không xác định");
  }
  post({ type: "result", jobId, result });
}

