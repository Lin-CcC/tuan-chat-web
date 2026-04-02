import { describe, expect, it } from "vitest";

import { computeTreeFolderRowDropDecision } from "@/components/chat/materialPackage/materialPackageTreeDrop";

describe("materialPackageTreeDrop", () => {
  it("reorders only when same package + same parent + before-zone", () => {
    expect(computeTreeFolderRowDropDecision({ samePackage: true, sameParent: true, isBeforeZone: true })).toBe("reorder");
    expect(computeTreeFolderRowDropDecision({ samePackage: true, sameParent: false, isBeforeZone: true })).toBe("move");
    expect(computeTreeFolderRowDropDecision({ samePackage: false, sameParent: true, isBeforeZone: true })).toBe("move");
  });

  it("non-before-zone always treated as move", () => {
    expect(computeTreeFolderRowDropDecision({ samePackage: true, sameParent: true, isBeforeZone: false })).toBe("move");
    expect(computeTreeFolderRowDropDecision({ samePackage: false, sameParent: false, isBeforeZone: false })).toBe("move");
  });
});

