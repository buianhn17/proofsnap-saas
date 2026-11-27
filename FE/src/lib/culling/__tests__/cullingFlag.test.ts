import { describe, expect, it } from "vitest";
import { DEFAULT_SHARPNESS_THRESHOLDS, classifyCullingFlag, sharpnessBucket } from "../cullingFlag";
import type { PhotoAnalysisResult } from "../burstScoring";
import { face, metrics } from "./fixtures";

describe("sharpnessBucket", () => {
  it("uses red < 30 ≤ yellow < 80 ≤ green by default", () => {
    expect(DEFAULT_SHARPNESS_THRESHOLDS).toEqual({ redBelow: 30, yellowBelow: 80 });
    expect(sharpnessBucket(0)).toBe("red");
    expect(sharpnessBucket(29.9)).toBe("red");
    expect(sharpnessBucket(30)).toBe("yellow");
    expect(sharpnessBucket(79.9)).toBe("yellow");
    expect(sharpnessBucket(80)).toBe("green");
  });

  it("accepts custom thresholds", () => {
    expect(sharpnessBucket(50, { redBelow: 60, yellowBelow: 100 })).toBe("red");
  });
});

function analysis(overrides: Partial<PhotoAnalysisResult>): PhotoAnalysisResult {
  return {
    photo_id: "p",
    burst_group_id: "b",
    is_best_pick: false,
    burst_role: "alternative",
    suggest_reject: false,
    reject_reasons: [],
    needs_review: false,
    group_eyes: null,
    overall_score: 0.9,
    faces: [],
    ...overrides,
  };
}

describe("classifyCullingFlag", () => {
  it("standalone: green / yellow / red from the photo's own score", () => {
    expect(classifyCullingFlag(metrics({ faces: [face()] }))).toBe("green");
    expect(classifyCullingFlag(metrics({ faces: [face({ eyeOpenScore: 0.4 })] }))).toBe("yellow");
    expect(classifyCullingFlag(metrics({ faces: [face({ eyeOpenScore: 0.05 })] }))).toBe("red");
  });

  it("prefers the burst analysis when provided", () => {
    const m = metrics({ faces: [face()] });
    expect(classifyCullingFlag(m, analysis({ suggest_reject: true }))).toBe("red");
    expect(classifyCullingFlag(m, analysis({ needs_review: true }))).toBe("yellow");
    expect(classifyCullingFlag(m, analysis({ overall_score: 0.5 }))).toBe("yellow");
    expect(classifyCullingFlag(m, analysis({ overall_score: 0.56 }))).toBe("green");
  });
});
