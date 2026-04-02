import { describe, expect, it } from "vitest";

import { computeVisibilityPopoverPos } from "@/components/chat/materialPackage/materialPackageVisibilityPopoverPos";

describe("materialPackageVisibilityPopoverPos", () => {
  it("places popover on the right side of panel when there's enough space", () => {
    const pos = computeVisibilityPopoverPos({
      anchorRect: { left: 10, top: 10, right: 290, bottom: 30 },
      panelRect: { left: 0, top: 0, right: 300, bottom: 600 },
      viewport: { width: 1000, height: 800 },
      popover: { width: 320, height: 188 },
      padding: 8,
    });
    expect(pos.left).toBe(308);
  });

  it("falls back to near-anchor placement when right side has no space", () => {
    const pos = computeVisibilityPopoverPos({
      anchorRect: { left: 10, top: 10, right: 290, bottom: 30 },
      panelRect: { left: 0, top: 0, right: 800, bottom: 600 },
      viewport: { width: 900, height: 800 },
      popover: { width: 320, height: 188 },
      padding: 8,
    });
    // preferLeft = 290 - 320 = -30, clamped to padding
    expect(pos.left).toBe(8);
  });
});

