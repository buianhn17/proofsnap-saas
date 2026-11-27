import type { ExposureResult } from "../exposure";
import type { CullingMetrics, DetectedFace } from "../types";

export const NEUTRAL_EXPOSURE: ExposureResult = {
  score: 1,
  meanLuma: 128,
  shadowClipRatio: 0,
  highlightClipRatio: 0,
  underexposed: false,
  overexposed: false,
} as ExposureResult;

export function face(overrides: Partial<DetectedFace> = {}): DetectedFace {
  return {
    earValue: 0.3,
    eyeStatus: "open",
    box: { x: 0.4, y: 0.3, width: 0.2, height: 0.25 },
    eyeOpenScore: 0.9,
    focusScore: 0.8,
    isMainSubject: true,
    lowDetail: false,
    ...overrides,
  } as DetectedFace;
}

export function metrics(overrides: Partial<CullingMetrics> = {}): CullingMetrics {
  const faces = overrides.faces ?? [];
  return {
    sharpnessScore: 200,
    exposure: NEUTRAL_EXPOSURE,
    hash: "0000000000000000",
    faceCount: faces.length,
    earValue: faces.length ? Math.min(...faces.map((f) => f.earValue)) : null,
    eyeStatus: faces.length ? "open" : "no_face",
    faces,
    ...overrides,
  } as CullingMetrics;
}

/** ImageData giả (môi trường Node không có ImageData) từ hàm độ sáng theo toạ độ. */
export function imageDataFrom(width: number, height: number, luma: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = luma(x, y);
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}
