// Chấm điểm chất lượng từng ảnh, đề xuất loại (kèm lý do) và chọn ảnh đẹp nhất (best pick)
// trong mỗi chùm burst. Thuần dữ liệu — không DOM, không phụ thuộc thứ tự xử lý ảnh.
//
// Điểm 1 ảnh: (0.5 × Focus + 0.4 × Eye) / 0.9
//   - Focus: trung bình focusScore của các người chính (ảnh không có mặt: độ nét toàn ảnh).
//   - Eye, ảnh ít người: eyeOpenScore THẤP NHẤT trong số người chính — 1 người nhắm mắt là
//     đủ hỏng. Trong chùm burst, độ mở mắt còn được so TƯƠNG ĐỐI với chính người đó ở các
//     khung khác (xem withBurstRelativeEyes).
//   - Eye, ảnh tập thể (>= GROUP_MIN_FACES người chính): tỉ lệ người MỞ mắt — với vài chục
//     người gần như luôn có ai đó chớp mắt, nên xét theo tỉ lệ: > 50% nhắm -> loại, 20-50%
//     -> xem lại, <= 20% -> chấp nhận được.
// Phơi sáng KHÔNG còn tham gia chấm điểm/đề xuất loại: histogram toàn ảnh không phân biệt
// được ảnh hỏng sáng với ảnh low-key/high-key có chủ đích (backstage tối, chủ thể được rọi
// đèn — nền đen chiếm phần lớn khung là bị gắn "thiếu sáng" oan). exposure.ts vẫn được tính
// để hiển thị tham khảo.

import type { CullingMetrics, DetectedFace } from "./types";

export type RejectReason = "blink" | "out_of_focus";
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
  /** Không đến mức loại nhưng nên xem lại (nheo mắt; ảnh tập thể 20-50% người nhắm mắt). */
  needs_review: boolean;
  /** Ảnh tập thể: số người chính nhắm mắt / tổng số người chính. null nếu không phải ảnh tập thể. */
  group_eyes: { closed: number; total: number } | null;
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

/** eyeOpenScore dưới ngưỡng -> coi là nhắm mắt. */
export const BLINK_BELOW = 0.25;
/** Ảnh ít người: có người chính mở mắt dưới mức này (nheo mắt, hoặc mặt nhỏ chưa chắc nhắm)
 * -> xem lại. */
const SQUINT_EYE_OPEN_BELOW = 0.5;

/** Từ số người chính này trở lên coi là ảnh tập thể — nhắm mắt xét theo TỈ LỆ người thay vì
 * "1 người nhắm là hỏng". 6: ảnh gia đình/nhóm nhỏ (<= 5 người) vẫn giữ luật chặt. */
export const GROUP_MIN_FACES = 6;
/** Ảnh tập thể: tỉ lệ người nhắm mắt VƯỢT mức này -> đề xuất loại. */
const GROUP_REJECT_CLOSED_RATIO = 0.5;
/** Ảnh tập thể: tỉ lệ người nhắm mắt vượt mức này (tới GROUP_REJECT_CLOSED_RATIO) -> xem lại;
 * bằng hoặc dưới -> chấp nhận được. */
const GROUP_REVIEW_CLOSED_RATIO = 0.2;
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

function isGroupPhoto(metrics: CullingMetrics): boolean {
  return mainSubjects(metrics.faces).length >= GROUP_MIN_FACES;
}

interface PhotoScore {
  overall: number;
  focus: number;
  suggestReject: boolean;
  reasons: RejectReason[];
  needsReview: boolean;
  groupEyes: { closed: number; total: number } | null;
}

/**
 * Chấm 1 ảnh độc lập. `burstHasFaces`: có ảnh nào khác trong cùng chùm phát hiện được mặt
 * không (xem MISSING_FACE_IN_FACE_BURST_EYE_SCORE) — gọi lẻ ngoài ngữ cảnh chùm thì để false.
 */
export function scorePhoto(metrics: CullingMetrics, burstHasFaces = false): PhotoScore {
  const subjects = mainSubjects(metrics.faces);
  const reasons: RejectReason[] = [];
  let needsReview = false;
  let groupEyes: PhotoScore["groupEyes"] = null;

  let focus: number;
  let eye: number | null;
  if (subjects.length > 0) {
    focus = subjects.reduce((sum, f) => sum + f.focusScore, 0) / subjects.length;
    // Mặt lowDetail (người đứng xa) không đủ pixel để 1 mình nó quyết định loại ảnh.
    const reliable = subjects.filter((f) => !f.lowDetail);
    if (subjects.length >= GROUP_MIN_FACES) {
      // Ảnh tập thể: đếm cả mặt lowDetail (ảnh cả lớp thì gần như mọi mặt đều lowDetail) —
      // sai số từng mặt được trung bình bớt khi xét tỉ lệ trên vài chục người.
      const closed = subjects.filter((f) => f.eyeOpenScore < BLINK_BELOW).length;
      const closedRatio = closed / subjects.length;
      groupEyes = { closed, total: subjects.length };
      eye = 1 - closedRatio;
      if (closedRatio > GROUP_REJECT_CLOSED_RATIO) reasons.push("blink");
      else if (closedRatio > GROUP_REVIEW_CLOSED_RATIO) needsReview = true;
    } else {
      eye = Math.min(...subjects.map((f) => f.eyeOpenScore));
      if (reliable.some((f) => f.eyeOpenScore < BLINK_BELOW)) reasons.push("blink");
      if (subjects.some((f) => f.eyeOpenScore < SQUINT_EYE_OPEN_BELOW)) needsReview = true;
    }
    // Loại khi BẤT KỲ người chính nào out nét — trung bình cao không cứu được 1 gương mặt
    // chính bị nhoè.
    if (reliable.some((f) => f.focusScore < OUT_OF_FOCUS_BELOW)) reasons.push("out_of_focus");
  } else {
    focus = globalFocusScore(metrics.sharpnessScore);
    eye = burstHasFaces ? MISSING_FACE_IN_FACE_BURST_EYE_SCORE : null;
    if (focus < OUT_OF_FOCUS_BELOW) reasons.push("out_of_focus");
  }

  // Ảnh không người (phong cảnh, chi tiết, đồ vật): không có thành phần mắt -> chỉ độ nét.
  const overall =
    eye === null ? focus : (FOCUS_WEIGHT * focus + EYE_WEIGHT * eye) / (FOCUS_WEIGHT + EYE_WEIGHT);

  return { overall, focus, suggestReject: reasons.length > 0, reasons, needsReview, groupEyes };
}

// --- So độ mở mắt tương đối trong chùm burst ---
// EAR tuyệt đối dao động mạnh theo dáng mắt từng người (mắt hẹp/một mí có EAR "mở" chỉ
// ~0.2) và góc mặt, nên 1 ngưỡng cứng vừa bỏ sót người mắt to nhắm hờ, vừa bắt oan người mắt
// hẹp. Trong 1 chùm burst cùng người xuất hiện ở nhiều khung: lấy khung mở mắt to nhất của
// chính người đó làm chuẩn, khung nào EAR tụt mạnh so với chuẩn là đang chớp mắt.

// 2 mặt ở 2 khung là cùng người nếu tâm lệch nhau < tỉ lệ này × bề rộng hộp mặt.
const SAME_PERSON_MAX_CENTER_SHIFT = 0.5;
// Chuẩn phải là mắt mở rõ — dưới mức này (cả chùm đều nheo/nhắm) thì không so tương đối.
const RELATIVE_MIN_REFERENCE_EAR = 0.2;
// EAR / EAR chuẩn: <= 0.55 -> 0 điểm (nhắm), >= 0.85 -> 1 điểm (mở như khung đẹp nhất).
const RELATIVE_CLOSED_RATIO = 0.55;
const RELATIVE_OPEN_RATIO = 0.85;

interface FaceTrack {
  cx: number;
  cy: number;
  width: number;
  maxEar: number;
  count: number;
}

function faceCenter(face: DetectedFace) {
  return { cx: face.box.x + face.box.width / 2, cy: face.box.y + face.box.height / 2 };
}

/** Gán mỗi người chính ở mỗi khung vào 1 "track" (cùng 1 người qua các khung) theo vị trí
 * hộp mặt. Trả về track index song song với metrics.faces (-1 nếu không phải người chính). */
function assignFaceTracks(members: ScoringInput[]): { tracks: FaceTrack[]; trackOf: number[][] } {
  const tracks: FaceTrack[] = [];
  const trackOf = members.map((member) => {
    const usedInFrame = new Set<number>();
    return member.metrics.faces.map((face) => {
      if (!face.isMainSubject) return -1;
      const { cx, cy } = faceCenter(face);
      let bestIndex = -1;
      let bestDist = Infinity;
      tracks.forEach((track, index) => {
        if (usedInFrame.has(index)) return;
        const d = Math.hypot(cx - track.cx, cy - track.cy);
        const limit = SAME_PERSON_MAX_CENTER_SHIFT * Math.max(track.width, face.box.width);
        if (d < limit && d < bestDist) {
          bestDist = d;
          bestIndex = index;
        }
      });
      if (bestIndex === -1) {
        tracks.push({ cx, cy, width: face.box.width, maxEar: face.earValue, count: 1 });
        bestIndex = tracks.length - 1;
      } else {
        const track = tracks[bestIndex];
        // Bám theo vị trí mới nhất — người dịch dần qua các khung vẫn khớp được.
        track.cx = cx;
        track.cy = cy;
        track.width = face.box.width;
        track.maxEar = Math.max(track.maxEar, face.earValue);
        track.count += 1;
      }
      usedInFrame.add(bestIndex);
      return bestIndex;
    });
  });
  return { tracks, trackOf };
}

/** Trả về metrics của từng ảnh với eyeOpenScore của người chính đã hạ xuống nếu mắt khép
 * lại rõ rệt so với chính người đó ở khung mở mắt to nhất trong chùm. Ảnh tập thể giữ
 * nguyên: mặt đứng sát nhau (cách ~1 bề rộng mặt), máy lệch nhẹ giữa 2 khung là ghép nhầm
 * người bên cạnh; EAR của mặt nhỏ lại nhiễu — so tương đối chỉ khuếch đại nhiễu. */
function withBurstRelativeEyes(members: ScoringInput[]): CullingMetrics[] {
  const comparable = members.filter((m) => !isGroupPhoto(m.metrics));
  if (comparable.length < 2) return members.map((m) => m.metrics);
  const { tracks, trackOf } = assignFaceTracks(comparable);
  const adjusted = new Map<ScoringInput, CullingMetrics>();
  comparable.forEach((member, memberIndex) => {
    adjusted.set(member, {
      ...member.metrics,
      faces: member.metrics.faces.map((face, faceIndex) => {
        const track = tracks[trackOf[memberIndex][faceIndex]];
        if (!track || track.count < 2 || track.maxEar < RELATIVE_MIN_REFERENCE_EAR) return face;
        const ratio = face.earValue / track.maxEar;
        const relativeScore = Math.max(
          0,
          Math.min(1, (ratio - RELATIVE_CLOSED_RATIO) / (RELATIVE_OPEN_RATIO - RELATIVE_CLOSED_RATIO))
        );
        return { ...face, eyeOpenScore: Math.min(face.eyeOpenScore, relativeScore) };
      }),
    });
  });
  return members.map((m) => adjusted.get(m) ?? m.metrics);
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
    const adjustedMetrics = withBurstRelativeEyes(members);
    const scored = members.map((member, index) => ({
      member,
      metrics: adjustedMetrics[index],
      score: scorePhoto(adjustedMetrics[index], burstHasFaces),
    }));
    const best = scored.reduce((a, b) =>
      b.score.overall > a.score.overall ||
      (b.score.overall === a.score.overall && b.score.focus > a.score.focus)
        ? b
        : a
    );

    for (const { member, metrics, score } of scored) {
      const isBest = member === best.member;
      results.set(member.photoId, {
        photo_id: member.photoId,
        burst_group_id: burstGroupId,
        is_best_pick: isBest,
        burst_role: isBest ? "best" : score.suggestReject ? "reject" : "alternative",
        suggest_reject: score.suggestReject,
        reject_reasons: score.reasons,
        needs_review: score.needsReview,
        group_eyes: score.groupEyes,
        overall_score: round3(score.overall),
        faces: metrics.faces.map((f) => ({
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
