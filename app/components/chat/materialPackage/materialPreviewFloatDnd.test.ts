import { describe, expect, test } from "vitest";

import { computeMpfDropIntent } from "@/components/chat/materialPackage/materialPreviewFloatDnd";

describe("materialPreviewFloatDnd", () => {
  test("list: top edge -> reorderBefore", () => {
    expect(computeMpfDropIntent({
      viewMode: "list",
      targetKind: "material",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 50,
      clientY: 5,
    })).toBe("reorderBefore");
  });

  test("list: bottom edge -> reorderAfter", () => {
    expect(computeMpfDropIntent({
      viewMode: "list",
      targetKind: "material",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 50,
      clientY: 95,
    })).toBe("reorderAfter");
  });

  test("list: middle on folder -> moveInto", () => {
    expect(computeMpfDropIntent({
      viewMode: "list",
      targetKind: "folder",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 10,
      clientY: 50,
    })).toBe("moveInto");
  });

  test("list: middle on folder within thumbnail hot area -> moveInto", () => {
    expect(computeMpfDropIntent({
      viewMode: "list",
      targetKind: "folder",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 80,
      clientY: 50,
    })).toBe("moveInto");
  });

  test("list: middle on folder but outside hot area -> reorderAfter", () => {
    expect(computeMpfDropIntent({
      viewMode: "list",
      targetKind: "folder",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 95,
      clientY: 50,
    })).toBe("reorderAfter");
  });

  test("list: middle on material -> reorderAfter", () => {
    expect(computeMpfDropIntent({
      viewMode: "list",
      targetKind: "material",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 50,
      clientY: 50,
    })).toBe("reorderAfter");
  });

  test("icon: left edge -> reorderBefore", () => {
    expect(computeMpfDropIntent({
      viewMode: "icon",
      targetKind: "material",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 5,
      clientY: 50,
    })).toBe("reorderBefore");
  });

  test("icon: right edge -> reorderAfter", () => {
    expect(computeMpfDropIntent({
      viewMode: "icon",
      targetKind: "material",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 95,
      clientY: 50,
    })).toBe("reorderAfter");
  });

  test("icon: middle on folder -> moveInto", () => {
    expect(computeMpfDropIntent({
      viewMode: "icon",
      targetKind: "folder",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 50,
      clientY: 50,
    })).toBe("moveInto");
  });

  test("icon: middle on material -> reorderAfter", () => {
    expect(computeMpfDropIntent({
      viewMode: "icon",
      targetKind: "material",
      targetRect: { left: 0, top: 0, width: 100, height: 100 },
      clientX: 50,
      clientY: 50,
    })).toBe("reorderAfter");
  });
});
