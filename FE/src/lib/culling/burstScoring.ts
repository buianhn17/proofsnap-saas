// Chấm điểm chất lượng từng ảnh, đề xuất loại (kèm lý do) và chọn ảnh đẹp nhất (best pick)
// trong mỗi chùm burst. Thuần dữ liệu — không DOM, không phụ thuộc thứ tự xử lý ảnh.
//
// Điểm 1 ảnh: 0.5 × Focus + 0.4 × MinEyeOpen + 0.1 × Exposure
//   - Focus: trung bình focusScore của các người chính (ảnh không có mặt: độ nét toàn ảnh).
//   - MinEyeOpen: eyeOpenScore THẤP NHẤT trong số người chính — 1 người nhắm mắt là đủ hỏng.
//   - Exposure: điểm phơi sáng tổng thể (exposure.ts).

import type { CullingMetrics, DetectedFace } from "./types";

export type RejectReason = "blink" | "out_of_focus" | "underexposed" | "overexposed";
export type BurstRole = "best" | "alternative" | "reject";

export interface PhotoAnalysisResult {
  photo_id: string;
  burst_group_id: string;
  is_best_pick: boolean;
  /** best = ảnh được chọn của chùm; alternative = ảnh dùng được nhưng kém hơn; reject = có
   * lỗi rõ ràng (suggest_reject). */
  burst_role: BurstRole;
  suggest_reject: boolean;
  reject_reasons: RejectReason[];
  overall_score: number;
  faces: {
    /** [x, y, width, height] chuẩn hoá 0-1 theo kích thước ảnh. */
    bbox: [number, number, number, number];
    is_blinking: boolean;
    eye_open_score: number;
    focus_score: number;
    is_main_subject: boolean;
  }[];
}

export interface ScoringInput {
  photoId: string;
  burstGroupId: string;
  metrics: CullingMetrics;
}

const FOCUS_WEIGHT = 0.5;
const EYE_WEIGHT = 0.4;
const EXPOSURE_WEIGHT = 0.1;

/** eyeOpenScore dưới ngưỡng -> coi là nhắm mắt. */
export const BLINK_BELOW = 0.25;
/** focusScore dưới ngưỡng -> out nét. Hiệu chỉnh ở faceQuality.ts: ảnh nét gốc p10 ~0.65,
 * mờ Gaussian σ1px (ảnh 2000px) trung vị ~0.29, σ1.5px p90 ~0.18. */
export const OUT_OF_FOCUS_BELOW = 0.25;

// Độ nét toàn ảnh (Var Laplacian, sharpness.ts) quy ra 0-1 cho ảnh không có mặt người: K
// chọn để ngưỡng cũ "đỏ < 30" (cullingFlag.ts) rơi đúng vào OUT_OF_FOCUS_BELOW (~0.25),
// "xanh >= 80" ~0.47.
const GLOBAL_SHARPNESS_HALF_POINT = 90;

// Ảnh KHÔNG phát hiện được mặt nằm trong chùm mà các ảnh khác CÓ mặt: thường là khung chủ
// thể quay đi/che mặt/nhoè chuyển động nặng tới mức detector bỏ sót — không được coi là
// "mắt mở hoàn hảo" (1.0), nếu không nó sẽ vượt mặt các khung có người nhìn thẳng máy ảnh.
const MISSING_FACE_IN_FACE_BURST_EYE_SCORE = 0.3;

export function globalFocusScore(sharpnessScore: number): number {
  if (!(sharpnessScore > 0)) return 0;
  return sharpnessScore / (sharpnessScore + GLOBAL_SHARPNESS_HALF_POINT);
}

function mainSubjects(faces: DetectedFace[]): DetectedFace[] {
  return faces.filter((f) => f.isMainSubject);
}

interface PhotoScore {
  overall: number;
  focus: number;
  suggestReject: boolean;
  reasons: RejectReason[];
}

/**
 * Chấm 1 ảnh độc lập. `burstHasFaces`: có ảnh nào khác trong cùng chùm phát hiện được mặt
 * không (xem MISSING_FACE_IN_FACE_BURST_EYE_SCORE) — gọi lẻ ngoài ngữ cảnh chùm thì để false.
 */
export function scorePhoto(metrics: CullingMetrics, burstHasFaces = false): PhotoScore {
  const subjects = mainSubjects(metrics.faces);
  const reasons: RejectReason[] = [];

  let focus: number;
  let eye: number | null;
  if (subjects.length > 0) {
    focus = subjects.reduce((sum, f) => sum + f.focusScore, 0) / subjects.length;
    eye = Math.min(...subjects.map((f) => f.eyeOpenScore));
    if (subjects.some((f) => f.eyeOpenScore < BLINK_BELOW)) reasons.push("blink");
    // Loại khi BẤT KỲ người chính nào out nét — trung bình cao không cứu được 1 gương mặt
    // chính bị nhoè.
    if (subjects.some((f) => f.focusScore < OUT_OF_FOCUS_BELOW)) reasons.push("out_of_focus");
  } else {
    focus = globalFocusScore(metrics.sharpnessScore);
    eye = burstHasFaces ? MISSING_FACE_IN_FACE_BURST_EYE_SCORE : null;
    if (focus < OUT_OF_FOCUS_BELOW) reasons.push("out_of_focus");
  }

  const exposure = metrics.exposure;
  if (exposure.underexposed) reasons.push("underexposed");
  if (exposure.overexposed) reasons.push("overexposed");

  // Ảnh không người (phong cảnh, chi tiết, đồ vật): không có thành phần mắt -> chia lại
  // trọng số giữa độ nét và phơi sáng theo đúng tỉ lệ 0.5 : 0.1.
  const overall =
    eye === null
      ? (FOCUS_WEIGHT * focus + EXPOSURE_WEIGHT * exposure.score) /
        (FOCUS_WEIGHT + EXPOSURE_WEIGHT)
      : FOCUS_WEIGHT * focus + EYE_WEIGHT * eye + EXPOSURE_WEIGHT * exposure.score;

  return { overall, focus, suggestReject: reasons.length > 0, reasons };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Chấm toàn bộ ảnh theo chùm burst. Mỗi chùm có đúng 1 best pick: ảnh điểm cao nhất (hoà
 * điểm thì ảnh nét hơn) — kể cả khi cả chùm đều có lỗi (khi đó best pick vẫn mang
 * suggest_reject để UI cảnh báo, nhưng PTG vẫn biết khung "đỡ tệ nhất" là khung nào).
 */
export function scoreBursts(inputs: ScoringInput[]): Map<string, PhotoAnalysisResult> {
  const byBurst = new Map<string, ScoringInput[]>();
  for (const input of inputs) {
    const group = byBurst.get(input.burstGroupId);
    if (group) group.push(input);
    else byBurst.set(input.burstGroupId, [input]);
  }

  const results = new Map<string, PhotoAnalysisResult>();
  for (const [burstGroupId, members] of byBurst) {
    const burstHasFaces = members.some((m) => mainSubjects(m.metrics.faces).length > 0);
    const scored = members.map((member) => ({
      member,
      score: scorePhoto(member.metrics, burstHasFaces),
    }));
    const best = scored.reduce((a, b) =>
      b.score.overall > a.score.overall ||
      (b.score.overall === a.score.overall && b.score.focus > a.score.focus)
        ? b
        : a
    );

    for (const { member, score } of scored) {
      const isBest = member === best.member;
      results.set(member.photoId, {
        photo_id: member.photoId,
        burst_group_id: burstGroupId,
        is_best_pick: isBest,
        burst_role: isBest ? "best" : score.suggestReject ? "reject" : "alternative",
        suggest_reject: score.suggestReject,
        reject_reasons: score.reasons,
        overall_score: round3(score.overall),
        faces: member.metrics.faces.map((f) => ({
          bbox: [round3(f.box.x), round3(f.box.y), round3(f.box.width), round3(f.box.height)],
          is_blinking: f.eyeOpenScore < BLINK_BELOW,
          eye_open_score: round3(f.eyeOpenScore),
          focus_score: round3(f.focusScore),
          is_main_subject: f.isMainSubject,
        })),
      });
    }
  }
  return results;
}
