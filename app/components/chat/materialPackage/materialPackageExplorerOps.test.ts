import { describe, expect, it } from "vitest";

import type { MaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";
import type { MaterialPreviewPayload } from "@/components/chat/materialPackage/materialPackageDnd";
import {
  autoRenameVsCodeLike,
  folderPathEqual,
  payloadPathToFolderNames,
  resolveTarget,
} from "@/components/chat/materialPackage/materialPackageExplorerOps";

function buildPkg(id: number, name: string): MaterialPackageRecord {
  return {
    packageId: id,
    userId: 0,
    name,
    description: "",
    coverUrl: null,
    visibility: 1,
    status: 0,
    content: { version: 1, root: [] },
    importCount: 0,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
  };
}

function payload(kind: MaterialPreviewPayload["kind"], packageId: number, path: string[]): MaterialPreviewPayload {
  return { kind, packageId, label: "x", path };
}

describe("materialPackageExplorerOps", () => {
  it("autoRenameVsCodeLike: 插入到扩展名之前", () => {
    const used = new Set(["foo.txt"]);
    expect(autoRenameVsCodeLike("foo.txt", used)).toBe("foo (1).txt");
  });

  it("autoRenameVsCodeLike: 多重扩展名插入到最后一个扩展名之前", () => {
    const used = new Set(["archive.tar.gz", "archive.tar (1).gz"]);
    expect(autoRenameVsCodeLike("archive.tar.gz", used)).toBe("archive.tar (2).gz");
  });

  it("autoRenameVsCodeLike: dotfile 没有扩展名", () => {
    const used = new Set([".env"]);
    expect(autoRenameVsCodeLike(".env", used)).toBe(".env (1)");
  });

  it("payloadPathToFolderNames: 只提取 folder 段", () => {
    expect(payloadPathToFolderNames(["folder:场景", "material:a.png", "folder:子"])).toEqual(["场景", "子"]);
  });

  it("folderPathEqual: 相同内容视为相等", () => {
    expect(folderPathEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(folderPathEqual([], [])).toBe(true);
  });

  it("folderPathEqual: 不同内容/长度视为不相等", () => {
    expect(folderPathEqual(["a"], ["a", "b"])).toBe(false);
    expect(folderPathEqual(["a", "c"], ["a", "b"])).toBe(false);
  });

  it("resolveTarget: packages==0 => blocked", () => {
    const res = resolveTarget({ selectedNode: null, packages: [], defaultTargetPackageId: null });
    expect(res).toEqual({ status: "blocked", reason: "no-packages" });
  });

  it("resolveTarget: 有 selection 时遵循 selection", () => {
    const pkgs = [buildPkg(1, "A")];
    const selectedNode = { kind: "material" as const, key: "k", payload: payload("material", 1, ["folder:场景", "material:x"]) };
    const res = resolveTarget({ selectedNode, packages: pkgs, defaultTargetPackageId: null });
    expect(res).toMatchObject({ status: "ok", packageId: 1, folderPath: ["场景"] });
  });

  it("resolveTarget: 无 selection 且只有一个 package => 取该 package root", () => {
    const pkgs = [buildPkg(9, "Only")];
    const res = resolveTarget({ selectedNode: null, packages: pkgs, defaultTargetPackageId: null });
    expect(res).toEqual({ status: "ok", packageId: 9, folderPath: [] });
  });

  it("resolveTarget: 无 selection 且多个 package 且有默认 => 用默认", () => {
    const pkgs = [buildPkg(1, "A"), buildPkg(2, "B")];
    const res = resolveTarget({ selectedNode: null, packages: pkgs, defaultTargetPackageId: 2 });
    expect(res).toEqual({ status: "ok", packageId: 2, folderPath: [] });
  });

  it("resolveTarget: 无 selection 且多个 package 且无默认 => need choose", () => {
    const pkgs = [buildPkg(1, "A"), buildPkg(2, "B")];
    const res = resolveTarget({ selectedNode: null, packages: pkgs, defaultTargetPackageId: null });
    expect(res).toEqual({ status: "need-choose-package" });
  });
});
