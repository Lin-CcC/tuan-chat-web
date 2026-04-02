import { describe, expect, it } from "vitest";

import {
  canDeleteSpaceLibrarySelectedNode,
  getSpaceLibraryDeleteDialogCopy,
  getSpaceLibraryDeleteTooltipLabel,
  parseSpaceLibrarySelectedNodeRef,
  toggleExpandedIds,
} from "@/components/chat/materialPackage/spaceMaterialLibraryOps";

describe("spaceMaterialLibraryOps", () => {
  it("parse material node key -> parentPath + name", () => {
    const parsed = parseSpaceLibrarySelectedNodeRef({
      kind: "material",
      packageId: 12,
      key: "material:12:folder:场景/folder:小屋/material:温馨.png",
    });
    expect(parsed).toEqual({
      kind: "material",
      packageId: 12,
      parentPath: ["场景", "小屋"],
      name: "温馨.png",
    });
  });

  it("parse folder node key -> parentPath + name", () => {
    const parsed = parseSpaceLibrarySelectedNodeRef({
      kind: "folder",
      packageId: 12,
      key: "folder:12:folder:场景/folder:小屋",
    });
    expect(parsed).toEqual({
      kind: "folder",
      packageId: 12,
      parentPath: ["场景"],
      name: "小屋",
    });
  });

  it("parse package returns null", () => {
    const parsed = parseSpaceLibrarySelectedNodeRef({
      kind: "package",
      packageId: 12,
      key: "root:12",
    });
    expect(parsed).toBeNull();
  });

  it("toggleExpandedIds adds/removes id", () => {
    expect(toggleExpandedIds([], 3)).toEqual([3]);
    expect(toggleExpandedIds([3], 3)).toEqual([]);
    expect(toggleExpandedIds([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleExpandedIds([1, 3, 2], 3)).toEqual([1, 2]);
  });

  it("canDeleteSpaceLibrarySelectedNode only depends on selection", () => {
    expect(canDeleteSpaceLibrarySelectedNode(null)).toBe(false);
    expect(canDeleteSpaceLibrarySelectedNode({ kind: "package" })).toBe(true);
    expect(canDeleteSpaceLibrarySelectedNode({ kind: "folder" })).toBe(true);
    expect(canDeleteSpaceLibrarySelectedNode({ kind: "material" })).toBe(true);
  });

  it("getSpaceLibraryDeleteTooltipLabel matches kind", () => {
    expect(getSpaceLibraryDeleteTooltipLabel(null)).toBe("先选中要删除的项");
    expect(getSpaceLibraryDeleteTooltipLabel({ kind: "package" })).toBe("删除素材箱");
    expect(getSpaceLibraryDeleteTooltipLabel({ kind: "folder" })).toBe("删除文件夹");
    expect(getSpaceLibraryDeleteTooltipLabel({ kind: "material" })).toBe("删除文件");
  });

  it("getSpaceLibraryDeleteDialogCopy matches kind", () => {
    expect(getSpaceLibraryDeleteDialogCopy({ kind: "package", name: "A" })).toEqual({
      primary: "将删除素材箱「A」及其全部内容。",
      secondary: "该操作不可撤销。",
    });
    expect(getSpaceLibraryDeleteDialogCopy({ kind: "folder", name: "B" })).toEqual({
      primary: "将删除文件夹「B」及其全部内容。",
      secondary: "该操作不可撤销。",
    });
    expect(getSpaceLibraryDeleteDialogCopy({ kind: "material", name: "C" })).toEqual({
      primary: "将删除文件「C」。",
      secondary: "该操作不可撤销。",
    });
  });
});
