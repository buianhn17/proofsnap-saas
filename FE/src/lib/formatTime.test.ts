import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatTimeUntil, initials } from "./formatTime";

const NOW = Date.parse("2026-11-21T10:00:00+07:00");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

describe("formatRelativeTime", () => {
  it("covers just now, minutes, hours, days and falls back to a date after a week", () => {
    expect(formatRelativeTime(ago(10_000), NOW)).toBe("vừa xong");
    expect(formatRelativeTime(ago(5 * MIN), NOW)).toBe("5 phút trước");
    expect(formatRelativeTime(ago(3 * H), NOW)).toBe("3 giờ trước");
    expect(formatRelativeTime(ago(2 * D), NOW)).toBe("2 ngày trước");
    expect(formatRelativeTime(ago(10 * D), NOW)).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });
});

describe("formatTimeUntil", () => {
  it("counts down in minutes, hours (< 48h) then days", () => {
    expect(formatTimeUntil(ago(MIN), NOW)).toBe("đã quá hạn");
    expect(formatTimeUntil(ahead(30_000), NOW)).toBe("còn 1 phút");
    expect(formatTimeUntil(ahead(12 * MIN), NOW)).toBe("còn 12 phút");
    expect(formatTimeUntil(ahead(30 * H), NOW)).toBe("còn 30 giờ");
    expect(formatTimeUntil(ahead(3 * D + H), NOW)).toBe("còn 3 ngày");
  });
});

describe("initials", () => {
  it("uses first and last word, handles Vietnamese and empty names", () => {
    expect(initials("Trần Thảo")).toBe("TT");
    expect(initials("Nguyễn Văn Đức")).toBe("NĐ");
    expect(initials("an")).toBe("A");
    expect(initials("  ")).toBe("?");
    expect(initials(null)).toBe("?");
  });
});
