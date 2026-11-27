import { describe, expect, it } from "vitest";
import { formatCountdown } from "./formatCountdown";

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe("formatCountdown", () => {
  it("formats durations over 24h as 'X ngày HH:MM:SS'", () => {
    expect(formatCountdown(934 * H + 51 * M + 13 * S)).toBe("38 ngày 22:51:13");
    expect(formatCountdown(D)).toBe("1 ngày 00:00:00");
    expect(formatCountdown(2 * D + 5 * S)).toBe("2 ngày 00:00:05");
  });

  it("formats 1h–24h as H:MM:SS and under 1h as M:SS", () => {
    expect(formatCountdown(D - S)).toBe("23:59:59");
    expect(formatCountdown(H)).toBe("1:00:00");
    expect(formatCountdown(59 * M + 59 * S)).toBe("59:59");
    expect(formatCountdown(5 * S)).toBe("0:05");
  });

  it("clamps negative or sub-second values to zero", () => {
    expect(formatCountdown(-5000)).toBe("0:00");
    expect(formatCountdown(999)).toBe("0:00");
  });
});
