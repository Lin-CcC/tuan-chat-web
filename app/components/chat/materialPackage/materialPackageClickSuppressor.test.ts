import { describe, expect, it } from "vitest";

import { isClickSuppressed, markClickSuppressed } from "@/components/chat/materialPackage/materialPackageClickSuppressor";

describe("materialPackageClickSuppressor", () => {
  it("markClickSuppressed 会在 duration 内抑制 click", () => {
    const ref = { current: 0 };
    markClickSuppressed(ref, 1000, 500);
    expect(isClickSuppressed(ref, 1000)).toBe(true);
    expect(isClickSuppressed(ref, 1499)).toBe(true);
    expect(isClickSuppressed(ref, 1500)).toBe(false);
  });
});

