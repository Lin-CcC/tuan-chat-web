import { describe, expect, it } from "vitest";

import { MATERIAL_PREVIEW_DRAG_TYPE } from "@/components/chat/materialPackage/materialPackageDnd";
import {
  SPACE_MATERIAL_MOVE_TYPE,
  shouldCaptureSpaceMaterialDockZonePreviewDnd,
} from "@/components/chat/materialPackage/spaceMaterialLibraryPanel";

function makeDataTransfer(types: string[]) {
  return {
    types,
    getData: () => "",
  } as any as DataTransfer;
}

describe("spaceMaterialLibraryPanel dock-zone capture", () => {
  it("captures material preview docking drags", () => {
    const dt = makeDataTransfer([MATERIAL_PREVIEW_DRAG_TYPE]);
    expect(shouldCaptureSpaceMaterialDockZonePreviewDnd(dt)).toBe(true);
  });

  it("does not capture other drags (e.g. preview-float internal dnd)", () => {
    const dt = makeDataTransfer(["application/x-tc-mpf-node"]);
    expect(shouldCaptureSpaceMaterialDockZonePreviewDnd(dt)).toBe(false);
  });

  it("does not capture space move drags", () => {
    const dt = makeDataTransfer([
      SPACE_MATERIAL_MOVE_TYPE,
      MATERIAL_PREVIEW_DRAG_TYPE,
    ]);
    expect(shouldCaptureSpaceMaterialDockZonePreviewDnd(dt)).toBe(false);
  });

  it("does not capture when no dataTransfer", () => {
    expect(shouldCaptureSpaceMaterialDockZonePreviewDnd(null)).toBe(false);
  });
});
