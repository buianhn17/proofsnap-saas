import { describe, expect, it } from "vitest";
import { groupByHashDistance, hammingDistance, signatureSimilarity } from "../perceptualHash";

const SIZE = 16 * 16;

function signature(fn: (x: number, y: number) => number): number[] {
  const raw = Array.from({ length: SIZE }, (_, i) => fn(i % 16, Math.floor(i / 16)));
  const mean = raw.reduce((a, b) => a + b, 0) / SIZE;
  const std = Math.sqrt(raw.reduce((a, v) => a + (v - mean) ** 2, 0) / SIZE);
  return raw.map((v) => (v - mean) / std);
}

describe("hammingDistance", () => {
  it("is 0 for identical hashes", () => {
    expect(hammingDistance("ffff0000ffff0000", "ffff0000ffff0000")).toBe(0);
  });

  it("counts differing bits across the full 64-bit range", () => {
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    expect(hammingDistance("0000000000000000", "8000000000000000")).toBe(1);
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("f0f0f0f0f0f0f0f0", "0f0f0f0f0f0f0f0f")).toBe(64);
  });

  it("is symmetric", () => {
    expect(hammingDistance("123456789abcdef0", "0fedcba987654321")).toBe(
      hammingDistance("0fedcba987654321", "123456789abcdef0")
    );
  });
});

describe("groupByHashDistance", () => {
  it("groups transitively (A~B, B~C ⇒ A,B,C share a group) and keeps outliers apart", () => {
    const groups = groupByHashDistance(
      [
        { id: "a", hash: "0000000000000000" },
        { id: "b", hash: "0000000000000007" }, // 3 bit khác a
        { id: "c", hash: "000000000000003f" }, // 3 bit khác b, 6 bit khác a
        { id: "d", hash: "ffffffffffffffff" },
      ],
      3
    );
    expect(groups.get("a")).toBe(groups.get("b"));
    expect(groups.get("b")).toBe(groups.get("c"));
    expect(groups.get("d")).not.toBe(groups.get("a"));
  });

  it("numbers groups from 1 in input order", () => {
    const groups = groupByHashDistance(
      [
        { id: "x", hash: "ffffffffffffffff" },
        { id: "y", hash: "0000000000000000" },
      ],
      0
    );
    expect(groups.get("x")).toBe(1);
    expect(groups.get("y")).toBe(2);
  });

  it("returns an empty map for no items", () => {
    expect(groupByHashDistance([], 5).size).toBe(0);
  });
});

describe("signatureSimilarity", () => {
  it("returns null when a signature is missing or the wrong size", () => {
    expect(signatureSimilarity([], signature((x) => x))).toBeNull();
    expect(signatureSimilarity([1, 2, 3], [1, 2, 3])).toBeNull();
  });

  it("is ~1 for identical signatures and ~-1 for an inverted one", () => {
    const a = signature((x, y) => Math.sin(x / 2) + Math.cos(y / 3));
    expect(signatureSimilarity(a, a)).toBeCloseTo(1, 6);
    expect(signatureSimilarity(a, a.map((v) => -v))!).toBeLessThan(-0.5);
  });

  it("tolerates a 1-cell shift (camera pan between burst frames)", () => {
    const pattern = (x: number, y: number) => Math.sin(x * 0.9) * Math.cos(y * 0.7) + x * 0.05;
    const a = signature(pattern);
    const shifted = signature((x, y) => pattern(x + 1, y));
    expect(signatureSimilarity(a, shifted)!).toBeGreaterThan(0.95);
  });
});
