import { describe, expect, it } from "vitest";

import { getVisibilityCopy, normalizePackageVisibility } from "@/components/chat/materialPackage/materialPackageVisibility";

describe("materialPackageVisibility", () => {
  it("normalizes explicit values", () => {
    expect(normalizePackageVisibility(0)).toBe(0);
    expect(normalizePackageVisibility(1)).toBe(1);
  });

  it("treats missing/invalid as public", () => {
    expect(normalizePackageVisibility(undefined)).toBe(1);
    expect(normalizePackageVisibility(null)).toBe(1);
    expect(normalizePackageVisibility("0")).toBe(1);
    expect(normalizePackageVisibility({})).toBe(1);
  });

  it("provides chip labels", () => {
    expect(getVisibilityCopy(1).chip).toContain("公开");
    expect(getVisibilityCopy(0).chip).toContain("私有");
  });
});

