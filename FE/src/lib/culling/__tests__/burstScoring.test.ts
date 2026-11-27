import { describe, expect, it } from "vitest";
import {
  BLINK_BELOW,
  GROUP_MIN_FACES,
  OUT_OF_FOCUS_BELOW,
  globalFocusScore,
  scoreBursts,
  scorePhoto,
} from "../burstScoring";
import { face, metrics } from "./fixtures";

describe("globalFocusScore", () => {
  it("maps Laplacian variance to 0..1 with a half point at 90", () => {
    expect(globalFocusScore(0)).toBe(0);
    expect(globalFocusScore(-5)).toBe(0);
    expect(globalFocusScore(90)).toBeCloseTo(0.5, 6);
    expect(globalFocusScore(1e9)).toBeLessThan(1);
  });
});

describe("scorePhoto", () => {
  it("accepts a sharp portrait with open eyes", () => {
    const s = scorePhoto(metrics({ faces: [face()] }));
    expect(s.suggestReject).toBe(false);
    expect(s.needsReview).toBe(false);
    expect(s.overall).toBeGreaterThan(0.8);
  });

  it("rejects a portrait where the main subject blinks", () => {
    const s = scorePhoto(metrics({ faces: [face({ eyeOpenScore: BLINK_BELOW - 0.05 })] }));
    expect(s.suggestReject).toBe(true);
    expect(s.reasons).toContain("blink");
  });

  it("rejects when any main subject is out of focus, even if the average is fine", () => {
    const s = scorePhoto(
      metrics({ faces: [face({ focusScore: 0.95 }), face({ focusScore: OUT_OF_FOCUS_BELOW - 0.05 })] })
    );
    expect(s.reasons).toContain("out_of_focus");
  });

  it("ignores blinking background people (not main subjects)", () => {
    const s = scorePhoto(metrics({ faces: [face(), face({ isMainSubject: false, eyeOpenScore: 0 })] }));
    expect(s.suggestReject).toBe(false);
  });

  it("never auto-rejects on a low-detail face alone, only flags it for review", () => {
    const s = scorePhoto(metrics({ faces: [face({ lowDetail: true, eyeOpenScore: 0.1 })] }));
    expect(s.reasons).not.toContain("blink");
    expect(s.needsReview).toBe(true);
  });

  it("group photo: judges blinking by ratio (≤20% ok, 20–50% review, >50% reject)", () => {
    const group = (closed: number, total = 10) =>
      scorePhoto(
        metrics({
          faces: Array.from({ length: total }, (_, i) => face({ eyeOpenScore: i < closed ? 0.05 : 0.9 })),
        })
      );
    expect(GROUP_MIN_FACES).toBeLessThanOrEqual(10);
    const ok = group(2);
    expect(ok.suggestReject).toBe(false);
    expect(ok.needsReview).toBe(false);
    expect(ok.groupEyes).toEqual({ closed: 2, total: 10 });
    const review = group(4);
    expect(review.suggestReject).toBe(false);
    expect(review.needsReview).toBe(true);
    expect(group(6).reasons).toContain("blink");
  });

  it("scores photos without faces on global sharpness only", () => {
    expect(scorePhoto(metrics({ sharpnessScore: 400 })).suggestReject).toBe(false);
    expect(scorePhoto(metrics({ sharpnessScore: 5 })).reasons).toEqual(["out_of_focus"]);
  });
});

describe("scoreBursts", () => {
  it("picks exactly one best per burst and marks rejects", () => {
    const results = scoreBursts([
      { photoId: "p1", burstGroupId: "b1", metrics: metrics({ faces: [face({ eyeOpenScore: 0.1 })] }) },
      { photoId: "p2", burstGroupId: "b1", metrics: metrics({ faces: [face({ eyeOpenScore: 0.95, focusScore: 0.9 })] }) },
      { photoId: "p3", burstGroupId: "b1", metrics: metrics({ faces: [face({ eyeOpenScore: 0.8, focusScore: 0.7 })] }) },
      { photoId: "q1", burstGroupId: "b2", metrics: metrics({ sharpnessScore: 300 }) },
    ]);
    expect(results.size).toBe(4);
    expect(results.get("p2")!.is_best_pick).toBe(true);
    expect(results.get("p2")!.burst_role).toBe("best");
    expect(results.get("p1")!.burst_role).toBe("reject");
    expect(results.get("p3")!.burst_role).toBe("alternative");
    expect(results.get("q1")!.is_best_pick).toBe(true);
    const bestPerBurst = [...results.values()].filter((r) => r.is_best_pick).map((r) => r.burst_group_id);
    expect(bestPerBurst.sort()).toEqual(["b1", "b2"]);
  });

  it("does not let a face-less frame beat frames with faces in the same burst", () => {
    const results = scoreBursts([
      { photoId: "noface", burstGroupId: "b", metrics: metrics({ sharpnessScore: 5000 }) },
      { photoId: "face", burstGroupId: "b", metrics: metrics({ faces: [face({ eyeOpenScore: 0.9, focusScore: 0.8 })] }) },
    ]);
    expect(results.get("face")!.is_best_pick).toBe(true);
  });

  it("rounds scores and bbox to 3 decimals", () => {
    const results = scoreBursts([
      {
        photoId: "p",
        burstGroupId: "b",
        metrics: metrics({ faces: [face({ box: { x: 0.123456, y: 0.2, width: 0.3, height: 0.4 } as never })] }),
      },
    ]);
    const r = results.get("p")!;
    expect(r.faces[0].bbox[0]).toBe(0.123);
    expect(Number.isInteger(r.overall_score * 1000)).toBe(true);
  });
});
