import { describe, expect, it } from "vitest";

import type { MaterialPackageContent } from "@/components/materialPackage/materialPackageApi";
import {
  buildEmptyMaterialPackageContent,
  draftCreateFolder,
  draftCreateMaterial,
  draftDeleteFolder,
  draftDeleteMaterial,
  draftMoveNode,
  draftMoveNodeAcrossContents,
  draftRenameFolder,
  draftRenameMaterial,
  draftReorderNode,
  draftReplaceMaterialMessages,
} from "@/components/chat/materialPackage/materialPackageDraft";

describe("materialPackageDraft", () => {
  it("支持在 root 创建文件夹", () => {
    const base = buildEmptyMaterialPackageContent();
    const next = draftCreateFolder(base, [], "场景");
    expect(next.root).toHaveLength(1);
    expect(next.root[0]).toMatchObject({ type: "folder", name: "场景" });
  });

  it("支持在多级目录创建素材", () => {
    const base: MaterialPackageContent = {
      version: 1,
      root: [
        { type: "folder", name: "场景", children: [] },
      ],
    };
    const next = draftCreateMaterial(base, ["场景"], {
      type: "material",
      name: "温馨小屋",
      note: "开场背景",
      messages: [{ messageType: 2, extra: {} }],
    });
    const folder = next.root[0] as any;
    expect(folder.children).toHaveLength(1);
    expect(folder.children[0]).toMatchObject({ type: "material", name: "温馨小屋", note: "开场背景" });
  });

  it("支持重命名文件夹与素材（含 note）", () => {
    const base: MaterialPackageContent = {
      version: 1,
      root: [
        {
          type: "folder",
          name: "场景",
          children: [
            { type: "material", name: "温馨小屋", note: "", messages: [{ messageType: 2, extra: {} }] },
          ],
        },
      ],
    };

    const renamedFolder = draftRenameFolder(base, [], "场景", "背景");
    expect(renamedFolder.root[0]).toMatchObject({ type: "folder", name: "背景" });

    const renamedMaterial = draftRenameMaterial(renamedFolder, ["背景"], "温馨小屋", "温暖小屋", "新备注");
    const folder = renamedMaterial.root[0] as any;
    expect(folder.children[0]).toMatchObject({ type: "material", name: "温暖小屋", note: "新备注" });
  });

  it("支持删除文件夹（递归）与删除素材", () => {
    const base: MaterialPackageContent = {
      version: 1,
      root: [
        {
          type: "folder",
          name: "场景",
          children: [
            { type: "folder", name: "小屋", children: [] },
          ],
        },
        { type: "material", name: "独立素材", messages: [{ messageType: 2, extra: {} }] },
      ],
    };
    const deletedMaterial = draftDeleteMaterial(base, [], "独立素材");
    expect(deletedMaterial.root.some(n => n.type === "material")).toBe(false);

    const deletedFolder = draftDeleteFolder(deletedMaterial, [], "场景");
    expect(deletedFolder.root).toHaveLength(0);
  });

  it("覆盖导入时仅替换 messages，保留顺序与 note", () => {
    const base: MaterialPackageContent = {
      version: 1,
      root: [
        {
          type: "folder",
          name: "场景",
          children: [
            { type: "material", name: "a.png", note: "旧备注", messages: [{ messageType: 2, extra: { imageMessage: { url: "old" } } }] },
            { type: "material", name: "b.png", note: "", messages: [{ messageType: 2, extra: { imageMessage: { url: "b" } } }] },
          ],
        },
      ],
    };

    const next = draftReplaceMaterialMessages(base, ["场景"], "a.png", [{ messageType: 2, extra: { imageMessage: { url: "new" } } }]);
    const folder = next.root[0] as any;
    expect(folder.children).toHaveLength(2);
    expect(folder.children[0]).toMatchObject({ type: "material", name: "a.png", note: "旧备注" });
    expect(folder.children[0].messages?.[0]?.extra?.imageMessage?.url).toBe("new");
    expect(folder.children[1]).toMatchObject({ type: "material", name: "b.png" });
  });

  it("支持同一文件夹内重排素材顺序", () => {
    const base: MaterialPackageContent = {
      version: 1,
      root: [
        {
          type: "folder",
          name: "场景",
          children: [
            { type: "material", name: "A", note: "", messages: [] },
            { type: "material", name: "B", note: "", messages: [] },
            { type: "material", name: "C", note: "", messages: [] },
          ],
        },
      ],
    };

    const next = draftReorderNode(
      base,
      ["场景"],
      { type: "material", name: "C" },
      { insertBefore: { type: "material", name: "A" } },
    );

    const folder = next.root[0] as any;
    expect(folder.children.map((n: any) => n.name)).toEqual(["C", "A", "B"]);
  });

  it("支持同一文件夹内重排文件夹与素材混排顺序", () => {
    const base: MaterialPackageContent = {
      version: 1,
      root: [
        {
          type: "folder",
          name: "场景",
          children: [
            { type: "folder", name: "F1", children: [] },
            { type: "material", name: "M1", note: "", messages: [] },
            { type: "folder", name: "F2", children: [] },
          ],
        },
      ],
    };

    const next = draftReorderNode(
      base,
      ["场景"],
      { type: "folder", name: "F2" },
      { insertBefore: { type: "folder", name: "F1" } },
    );

    const folder = next.root[0] as any;
    expect(folder.children.map((n: any) => `${n.type}:${n.name}`)).toEqual(["folder:F2", "folder:F1", "material:M1"]);
  });

  it("支持在不同文件夹之间移动素材（保留 messages/note）", () => {
    const base: MaterialPackageContent = {
      version: 1,
      root: [
        {
          type: "folder",
          name: "场景",
          children: [
            { type: "material", name: "A", note: "n", messages: [{ messageType: 2, extra: { imageMessage: { url: "u" } } }] },
          ],
        },
        { type: "folder", name: "目标", children: [] },
      ],
    };

    const next = draftMoveNode(
      base,
      { parentPath: ["场景"], source: { type: "material", name: "A" } },
      { folderPath: ["目标"] },
    );

    const from = next.root.find(n => n.type === "folder" && n.name === "场景") as any;
    const to = next.root.find(n => n.type === "folder" && n.name === "目标") as any;
    expect(from.children).toHaveLength(0);
    expect(to.children).toHaveLength(1);
    expect(to.children[0]).toMatchObject({ type: "material", name: "A", note: "n" });
    expect(to.children[0].messages?.[0]?.extra?.imageMessage?.url).toBe("u");
  });

  it("支持在不同文件夹之间移动文件夹（保留 children）", () => {
    const base: MaterialPackageContent = {
      version: 1,
      root: [
        { type: "folder", name: "父", children: [{ type: "folder", name: "子", children: [{ type: "material", name: "M", note: "", messages: [] }] }] },
        { type: "folder", name: "目标", children: [] },
      ],
    };

    const next = draftMoveNode(
      base,
      { parentPath: ["父"], source: { type: "folder", name: "子" } },
      { folderPath: ["目标"] },
    );

    const from = next.root.find(n => n.type === "folder" && n.name === "父") as any;
    const to = next.root.find(n => n.type === "folder" && n.name === "目标") as any;
    expect(from.children.map((n: any) => n.name)).toEqual([]);
    expect(to.children).toHaveLength(1);
    expect(to.children[0]).toMatchObject({ type: "folder", name: "子" });
    expect(to.children[0].children?.[0]).toMatchObject({ type: "material", name: "M" });
  });

  it("支持跨素材箱移动文件夹（保留 children，按 nextName 重命名）", () => {
    const source: MaterialPackageContent = {
      version: 1,
      root: [
        { type: "folder", name: "父", children: [{ type: "folder", name: "子", children: [{ type: "material", name: "M", note: "", messages: [] }] }] },
      ],
    };
    const dest: MaterialPackageContent = {
      version: 1,
      root: [
        { type: "folder", name: "子", children: [] },
        { type: "folder", name: "目标", children: [] },
      ],
    };

    const moved = draftMoveNodeAcrossContents(
      { sourceContent: source, destContent: dest },
      { parentPath: ["父"], source: { type: "folder", name: "子" }, nextName: "子(1)" },
      { folderPath: ["目标"] },
    );

    const nextSource = moved.nextSourceContent;
    const nextDest = moved.nextDestContent;

    const from = nextSource.root.find(n => n.type === "folder" && n.name === "父") as any;
    const to = nextDest.root.find(n => n.type === "folder" && n.name === "目标") as any;
    expect(from.children.map((n: any) => n.name)).toEqual([]);
    expect(to.children).toHaveLength(1);
    expect(to.children[0]).toMatchObject({ type: "folder", name: "子(1)" });
    expect(to.children[0].children?.[0]).toMatchObject({ type: "material", name: "M" });
  });

  it("支持跨素材箱移动素材（保留 messages/note）", () => {
    const source: MaterialPackageContent = {
      version: 1,
      root: [
        { type: "folder", name: "A", children: [{ type: "material", name: "m.png", note: "n", messages: [{ messageType: 2, extra: { imageMessage: { url: "u" } } }] }] },
      ],
    };
    const dest: MaterialPackageContent = {
      version: 1,
      root: [
        { type: "folder", name: "B", children: [] },
      ],
    };

    const moved = draftMoveNodeAcrossContents(
      { sourceContent: source, destContent: dest },
      { parentPath: ["A"], source: { type: "material", name: "m.png" } },
      { folderPath: ["B"] },
    );

    const from = (moved.nextSourceContent.root[0] as any).children;
    const to = (moved.nextDestContent.root[0] as any).children;
    expect(from).toHaveLength(0);
    expect(to).toHaveLength(1);
    expect(to[0]).toMatchObject({ type: "material", name: "m.png", note: "n" });
    expect(to[0].messages?.[0]?.extra?.imageMessage?.url).toBe("u");
  });
});

