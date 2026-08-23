// Bước 1.7 — gom nhóm scene (buổi chụp) theo khoảng cách thời gian EXIF + thay đổi khung
// hình lớn (color histogram), và gom cụm burst (loạt ảnh chụp liên tiếp giống nhau) theo
// dHash đã có ở Bước 1.3. Khác với groupByHashDistance ở perceptualHash.ts (so TOÀN CỤC,
// dùng để bắt trùng lặp bất kỳ vị trí nào trong công cụ test) — ở đây CHỈ so 2 ảnh LIỀN KỀ
// theo thứ tự thời gian, đúng bản chất của 1 loạt burst chụp liên tiếp.

import { hammingDistance } from "./perceptualHash";
import { histogramDistance } from "./colorHistogram";

export interface SceneGroupingInput {
  id: string;
  /** ms epoch — capturedAtMs từ EXIF, hoặc file.lastModified nếu ảnh không có EXIF. */
  timestampMs: number;
  histogram: number[];
  hash: string;
}

export interface SceneGroupingOptions {
  /** Khoảng cách thời gian (phút) giữa 2 ảnh liên tiếp để coi là sang buổi chụp mới. */
  sceneGapMinutes?: number;
  /** Khoảng cách histogram (0-1) giữa 2 ảnh liên tiếp để coi là đổi khung hình lớn. */
  sceneHistogramThreshold?: number;
  /** Khoảng cách Hamming tối đa giữa 2 ảnh LIÊN TIẾP để coi là cùng 1 loạt burst. */
  burstMaxHammingDistance?: number;
}

const DEFAULT_OPTIONS: Required<SceneGroupingOptions> = {
  sceneGapMinutes: 20,
  sceneHistogramThreshold: 0.35,
  burstMaxHammingDistance: 6,
};

// Bước cải tiến — số ảnh gần nhất TRONG burst hiện tại dùng để so hash, thay vì chỉ so với
// đúng 1 ảnh liền trước. Giúp 1 khung mờ/chuyển tiếp ở giữa 1 loạt burst dài không làm tách
// nhầm burst thành 2, miễn là ảnh hiện tại vẫn đủ giống ít nhất 1 trong vài ảnh gần đây.
const BURST_WINDOW_SIZE = 3;

export interface SceneGroupingResult {
  /** id theo đúng thứ tự thời gian đã sắp xếp lại — tầng gọi dùng để hiển thị/lặp đúng thứ tự. */
  order: string[];
  sceneId: Map<string, number>;
  burstId: Map<string, number>;
}

export function groupScenesAndBursts(
  items: SceneGroupingInput[],
  options: SceneGroupingOptions = {}
): SceneGroupingResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const gapMs = opts.sceneGapMinutes * 60 * 1000;
  const sorted = [...items].sort((a, b) => a.timestampMs - b.timestampMs);

  const sceneId = new Map<string, number>();
  const burstId = new Map<string, number>();
  const order: string[] = [];

  let currentScene = 0;
  let currentBurst = 0;
  // Hash của các ảnh đã thuộc burst hiện tại, tối đa BURST_WINDOW_SIZE ảnh gần nhất.
  let burstWindow: string[] = [];

  sorted.forEach((item, index) => {
    order.push(item.id);
    if (index > 0) {
      const prev = sorted[index - 1];
      const timeDelta = item.timestampMs - prev.timestampMs;
      const histDist = histogramDistance(item.histogram, prev.histogram);
      const isNewScene = timeDelta > gapMs || histDist > opts.sceneHistogramThreshold;

      if (isNewScene) {
        // Sang buổi chụp mới thì chắc chắn cũng là loạt burst mới — không gộp ảnh cuối
        // buổi trước với ảnh đầu buổi sau dù hash tình cờ gần nhau.
        currentScene += 1;
        currentBurst += 1;
        burstWindow = [];
      } else {
        const minDist = Math.min(
          ...burstWindow.map((hash) => hammingDistance(item.hash, hash))
        );
        if (minDist > opts.burstMaxHammingDistance) {
          currentBurst += 1;
          burstWindow = [];
        }
      }
    }

    burstWindow.push(item.hash);
    if (burstWindow.length > BURST_WINDOW_SIZE) burstWindow.shift();

    sceneId.set(item.id, currentScene);
    burstId.set(item.id, currentBurst);
  });

  return { order, sceneId, burstId };
}