// Kiểu dữ liệu + quy tắc dùng chung cho tính năng Bàn Giao Show Kỷ Yếu.
// Các quy tắc (tên folder chuẩn, link Drive hợp lệ) PHẢI khớp với BE
// (BE/src/services/studioShowRules.js) — BE vẫn là nơi kiểm tra cuối cùng.

/** Loại hình thợ chọn khi nộp file gốc */
export type CrewType = "photo" | "video";
/** Loại bài nộp: file gốc của thợ (photo/video) hoặc ảnh đã hậu kỳ của editor (retouch) */
export type SubmissionType = CrewType | "retouch";
/** Vai trò thành viên trong show */
export type MemberRole = "crew" | "editor";
/** Vai trò người đang xem show */
export type ViewerRole = "studio" | MemberRole;
export type ShowStatus = "open" | "completed" | "archived";
export type SubmissionStatus = "submitted" | "approved" | "rejected";

export interface CulledStats {
  closed_eyes?: number;
  blurry?: number;
  overexposed?: number;
  failed_fireworks?: number;
}

export interface ShowSubmitter {
  crew_user_id: string;
  crew_name: string;
  crew_type: SubmissionType;
  role_position: string;
  status: SubmissionStatus;
  /** null với bài retouch (không áp dụng hạn 24h) */
  is_on_time_24h: boolean | null;
}

export interface ShowStats {
  member_count: number;
  submitted_crew_count: number;
  submission_count: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  late_count: number;
  total_files: number;
  total_photo_files: number;
  total_video_clips: number;
  retouch_count: number;
  total_retouch_files: number;
  crew_member_count: number;
  editor_count: number;
}

export interface StudioShow {
  id: string;
  invite_code: string;
  shoot_date: string; // YYYY-MM-DD
  shoot_end_time: string;
  deadline_at: string;
  class_name: string;
  school_name: string;
  status: ShowStatus;
  studio_name: string;
  created_at: string;
  stats: ShowStats;
  submitters?: ShowSubmitter[];
  my_role?: MemberRole;
  joined_at?: string;
  my_submission_count?: number;
}

export interface ShowSubmission {
  id: string;
  show_id: string;
  crew_user_id: string;
  crew_name: string;
  crew_type: SubmissionType;
  role_position: string;
  formatted_folder_name: string;
  /** Không có khi THỢ xem bài của người khác (chủ Studio và editor thì có). */
  drive_url?: string;
  total_files: number;
  raw_count: number;
  jpg_count: number;
  video_count: number;
  culled_stats: CulledStats;
  has_valid_structure: boolean;
  backup_committed_45d: boolean;
  is_on_time_24h: boolean | null;
  status: SubmissionStatus;
  studio_note?: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface ShowMember {
  id: string;
  user_id: string;
  role_type: MemberRole;
  display_name: string | null;
  /** Chỉ chủ Studio nhận được */
  email?: string;
  joined_at: string;
  submission_count: number;
  /** Loại bài người này đã nộp — để gắn badge Thợ ảnh / Thợ quay */
  crew_types: SubmissionType[];
}

export interface ShowDetailResponse {
  show: StudioShow;
  viewer_role: ViewerRole;
  /** Vai trò thành viên của chính mình (chủ Studio cũng có thể tham gia làm thợ) */
  my_member_role: MemberRole | null;
  submissions: ShowSubmission[];
  members: ShowMember[];
}

export const RETOUCH_ROLE = "Hậu kỳ";

export const PHOTO_ROLES = ["Lead", "Phụ 1", "Phụ 2", "Candid", "Flycam"] as const;
export const VIDEO_ROLES = ["Quay chính", "Quay phụ", "Flycam"] as const;

export const CULLED_STAT_LABELS: Record<keyof CulledStats, string> = {
  closed_eyes: "Nhắm mắt",
  blurry: "Nhoè nét",
  overexposed: "Cháy/hỏng sáng",
  failed_fireworks: "Pháo hoa xịt",
};

export const SUBMISSION_STATUS_META: Record<SubmissionStatus, { label: string; className: string; dot: string }> = {
  submitted: { label: "Chờ duyệt", className: "border-amber-500/30 bg-amber-950/60 text-amber-300", dot: "bg-amber-400" },
  approved: { label: "Đã duyệt", className: "border-emerald-500/30 bg-emerald-950/60 text-emerald-300", dot: "bg-emerald-400" },
  rejected: { label: "Cần sửa", className: "border-rose-500/30 bg-rose-950/60 text-rose-300", dot: "bg-rose-400" },
};

/** "2026-11-20" → "20/11/2026" */
export function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Khớp BE: "20/11/2026 Nguyễn Văn A Lead 850 file 12A5 THPT Kim Liên" */
export function formatFolderName(input: {
  shootDate: string;
  crewName: string;
  rolePosition: string;
  totalFiles: number;
  crewType: SubmissionType;
  className: string;
  schoolName: string;
}): string {
  const clean = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");
  const unit = input.crewType === "video" ? "clip" : "file";
  return [
    formatDisplayDate(input.shootDate),
    clean(input.crewName),
    clean(input.rolePosition),
    input.totalFiles,
    unit,
    clean(input.className),
    clean(input.schoolName),
  ].join(" ");
}

/** Khớp BE: chỉ https://drive.google.com/… */
export function isGoogleDriveUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      url.hostname === "drive.google.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

/**
 * Ghép ngày chụp + giờ kết thúc (giờ Việt Nam) thành ISO có múi giờ, như BE yêu cầu.
 * Giờ kết thúc trước 06:00 được hiểu là rạng sáng HÔM SAU (show tối kéo qua nửa đêm).
 */
export const OVERNIGHT_BEFORE = "06:00";
export function buildShootEndTime(shootDate: string, endTime: string): string {
  let date = shootDate;
  if (endTime < OVERNIGHT_BEFORE) {
    const d = new Date(`${shootDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    date = d.toISOString().slice(0, 10);
  }
  return `${date}T${endTime}:00+07:00`;
}

export function todayInVietnam(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
});
export function formatDateTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

const countFormatter = new Intl.NumberFormat("vi-VN");
export function formatCount(value: number): string {
  return countFormatter.format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

export function inviteLink(code: string): string {
  return `${window.location.origin}/admin/shows?tab=crew&code=${encodeURIComponent(code)}`;
}

// Báo cho sidebar (badge "chờ duyệt") tải lại số liệu ngay sau khi tạo show / duyệt bài.
export const STUDIO_SHOWS_CHANGED_EVENT = "lensproof:studio-shows-changed";
export function notifyStudioShowsChanged() {
  window.dispatchEvent(new Event(STUDIO_SHOWS_CHANGED_EVENT));
}
