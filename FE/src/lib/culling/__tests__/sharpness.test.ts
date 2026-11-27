import { describe, expect, it } from "vitest";
import { computeSharpnessScore, laplacianVariance, toGrayscale } from "../sharpness";
import { imageDataFrom } from "./fixtures";

describe("toGrayscale", () => {
  it("uses ITU-R BT.601 luminance weights", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const gray = toGrayscale({ data, width: 3, height: 1 } as ImageData);
    expect(gray[0]).toBeCloseTo(0.299 * 255, 3);
    expect(gray[1]).toBeCloseTo(0.587 * 255, 3);
    expect(gray[2]).toBeCloseTo(0.114 * 255, 3);
  });
});

describe("laplacianVariance", () => {
  it("returns 0 for images smaller than the 3x3 kernel", () => {
    expect(laplacianVariance(new Float32Array(4), 2, 2)).toBe(0);
  });

  it("returns 0 for a flat image (no edges)", () => {
    expect(laplacianVariance(new Float32Array(25).fill(128), 5, 5)).toBe(0);
  });

  it("returns 0 for a linear gradient (Laplacian of a plane is zero)", () => {
    const w = 8;
    const gray = Float32Array.from({ length: w * w }, (_, i) => (i % w) * 10);
    expect(laplacianVariance(gray, w, w)).toBeCloseTo(0, 6);
  });
});

describe("computeSharpnessScore", () => {
  it("scores a crisp checkerboard far above a soft gradient", () => {
    const sharp = imageDataFrom(32, 32, (x, y) => ((x + y) % 2 === 0 ? 255 : 0));
    const soft = imageDataFrom(32, 32, (x) => Math.round((x / 31) * 255));
    const sharpScore = computeSharpnessScore(sharp);
    const softScore = computeSharpnessScore(soft);
    expect(sharpScore).toBeGreaterThan(1000);
    expect(softScore).toBeLessThan(5);
    expect(sharpScore).toBeGreaterThan(softScore * 100);
  });

  it("decreases monotonically as edge contrast drops", () => {
    const scores = [255, 128, 32].map((amp) =>
      computeSharpnessScore(imageDataFrom(16, 16, (x) => (x % 2 === 0 ? amp : 0)))
    );
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
  });
});
