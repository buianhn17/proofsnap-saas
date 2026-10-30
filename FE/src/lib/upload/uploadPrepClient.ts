// Pool nhỏ các uploadPrep.worker.ts, dùng chung cho mọi lượt upload trong phiên. Mỗi worker
// chuẩn bị 1 ảnh mỗi lúc (giải mã 24-45MP tốn ~100-180MB RAM) — số ảnh chuẩn bị cùng lúc do
// PhotoUploadPanel điều phối, tối đa PREPARE_CONCURRENCY.

import type { NormalizedFaceBox } from "../culling/types";
import type {
  PreparedUpload,
  PrepareUploadRequest,
  PrepareUploadResponse,
} from "./uploadPrepProtocol";

/** 2-3 worker: đủ để nén nhanh hơn tốc độ upload của hầu hết đường truyền, không giành hết
 * CPU/RAM của máy (trang vẫn phải mượt trong lúc upload). */
export const PREPARE_CONCURRENCY = Math.max(
  2,
  Math.min(3, Math.floor((typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4) / 4))
);

interface PendingJob {
  request: PrepareUploadRequest;
  resolve: (result: PreparedUpload) => void;
  reject: (err: Error) => void;
}

interface PooledWorker {
  worker: Worker;
  job: PendingJob | null;
}

const pool: PooledWorker[] = [];
const waiting: PendingJob[] = [];
let nextJobId = 1;

function createWorker(): PooledWorker {
  const pooled: PooledWorker = {
    worker: new Worker(new URL("./uploadPrep.worker.ts", import.meta.url), { type: "module" }),
    job: null,
  };
  pooled.worker.addEventListener("message", (event: MessageEvent<PrepareUploadResponse>) => {
    const job = pooled.job;
    if (!job || event.data.jobId !== job.request.jobId) return;
    pooled.job = null;
    if (event.data.type === "prepared") job.resolve(event.data.result);
    else job.reject(new Error(event.data.message));
    dispatch();
  });
  pooled.worker.addEventListener("error", (event) => {
    // Worker chết (thường do hết bộ nhớ khi giải mã ảnh quá lớn): báo lỗi ảnh đang xử lý,
    // thay worker mới cho các ảnh sau.
    const job = pooled.job;
    pooled.job = null;
    pooled.worker.terminate();
    pool.splice(pool.indexOf(pooled), 1);
    job?.reject(new Error(event.message || "Không chuẩn bị được ảnh để upload"));
    dispatch();
  });
  return pooled;
}

function dispatch() {
  while (waiting.length > 0) {
    let idle = pool.find((pooled) => pooled.job === null);
    if (!idle && pool.length < PREPARE_CONCURRENCY) {
      idle = createWorker();
      pool.push(idle);
    }
    if (!idle) return;
    const job = waiting.shift()!;
    idle.job = job;
    idle.worker.postMessage(job.request);
  }
}

export function prepareUpload(
  file: File,
  options: { maxLongEdgePx: number; jpegQuality: number; faceBoxes: NormalizedFaceBox[] | null }
): Promise<PreparedUpload> {
  return new Promise((resolve, reject) => {
    waiting.push({
      request: { type: "prepare", jobId: nextJobId++, file, ...options },
      resolve,
      reject,
    });
    dispatch();
  });
}
