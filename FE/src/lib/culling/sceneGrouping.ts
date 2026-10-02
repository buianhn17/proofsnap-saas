// Bước 1.7 — gom nhóm scene (buổi chụp) theo khoảng cách thời gian EXIF + thay đổi khung
// hình lớn (color histogram), và gom cụm burst (loạt ảnh chụp liên tiếp giống nhau): 2 ảnh
// liền kề cùng burst khi chụp cách nhau <= burstMaxGapMs (mặc định 1.2s, theo EXIF có phần
// lẻ giây) VÀ bố cục tương đồng theo dHash đã có ở Bước 1.3 — chỉ giống bố cục mà cách nhau
// vài phút (chụp lại cùng góc sau đó) là 2 khoảnh khắc khác nhau, không phải 1 loạt burst. Khác với groupByHashDistance ở perceptualHash.ts (so TOÀN CỤC,
// dùng để bắt trùng lặp bất kỳ vị trí nào trong công cụ test) — ở đây CHỈ so 2 ảnh LIỀN KỀ
// theo thứ tự thời gian, đúng bản chất của 1 loạt burst chụp liên tiếp.

import { hammingDistance } from "./perceptualHash";
import { histogramDistance } from "./colorHistogram";

/** Độ tin cậy của timestampMs: EXIF có phần lẻ giây (chính xác tới ms), EXIF chỉ tới giây,
 * hoặc thời gian sửa file (không phản ánh thời điểm chụp — copy/xuất file là đổi). */
export type TimestampSource = "exif_subsec" | "exif" | "file";

export interface SceneGroupingInput {
  id: string;
  /** ms epoch — capturedAtMs từ EXIF, hoặc file.lastModified nếu ảnh không có EXIF. */
  timestampMs: number;
  timestampSource: TimestampSource;
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
  /** Khoảng cách thời gian tối đa (ms) giữa 2 ảnh liên tiếp trong cùng 1 burst. */
  burstMaxGapMs?: number;
}

const DEFAULT_OPTIONS: Required<SceneGroupingOptions> = {
  sceneGapMinutes: 20,
  sceneHistogramThreshold: 0.35,
  burstMaxHammingDistance: 6,
  burstMaxGapMs: 1200,
};

// EXIF thiếu SubSecTimeOriginal chỉ chính xác tới giây: 2 khung cách nhau 0.3s vẫn có thể
// hiện lệch tròn 1s (10.9s -> 11.2s), khung cách 1.1s có thể hiện lệch 2s. Nới ngưỡng thêm
// đúng 1 bước làm tròn để không cắt nhầm burst.
const SECOND_RESOLUTION_EXTRA_GAP_MS = 1000;

function burstGapLimitMs(
  a: SceneGroupingInput,
  b: SceneGroupingInput,
  baseGapMs: number
): number {
  // Thời gian sửa file không phản ánh nhịp chụp — bỏ điều kiện thời gian, chỉ dựa vào bố cục.
  if (a.timestampSource === "file" || b.timestampSource === "file") return Infinity;
  if (a.timestampSource === "exif" || b.timestampSource === "exif") {
    return baseGapMs + SECOND_RESOLUTION_EXTRA_GAP_MS;
  }
  return baseGapMs;
}

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
        const tooFarApart = timeDelta > burstGapLimitMs(prev, item, opts.burstMaxGapMs);
        if (tooFarApart || minDist > opts.burstMaxHammingDistance) {
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