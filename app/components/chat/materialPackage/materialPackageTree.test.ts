import { describe, expect, it } from "vitest";

import type { MaterialPackageContent } from "@/components/materialPackage/materialPackageApi";
import {
  getFolderNodesAtPath,
  resolveInitialPreviewState,
} from "@/components/chat/materialPackage/materialPackageTree";

describe("materialPackageTree", () => {
  const content: MaterialPackageContent = {
    version: 1,
    root: [
      {
        type: "folder",
        name: "场景",
        children: [
          {
            type: "folder",
            name: "小屋",
            children: [
              {
                type: "material",
                name: "温馨小屋",
                messages: [{ messageType: 2, extra: {} }],
              },
            ],
          },
        ],
      },
      {
        type: "material",
        name: "独立素材",
        messages: [{ messageType: 2, extra: {} }],
      },
    ],
  };

  it("getFolderNodesAtPath 支持 root", () => {
    const nodes = getFolderNodesAtPath(content, []);
    expect(nodes.map(n => n.type)).toEqual(["folder", "material"]);
  });

  it("getFolderNodesAtPath 支持多级 folder", () => {
    const nodes = getFolderNodesAtPath(content, ["场景", "小屋"]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("material");
    expect((nodes[0] as any).name).toBe("温馨小屋");
  });

  it("resolveInitialPreviewState 对 folder payload 会定位到该目录", () => {
    const resolved = resolveInitialPreviewState({
      kind: "folder",
      packageId: 1,
      label: "小屋",
      path: ["folder:场景", "folder:小屋"],
    });
    expect(resolved.folderPath).toEqual(["场景", "小屋"]);
    expect(resolved.selectedMaterialName).toBe(null);
  });

  it("resolveInitialPreviewState 对 material payload 会选中素材并定位到父目录", () => {
    const resolved = resolveInitialPreviewState({
      kind: "material",
      packageId: 1,
      label: "温馨小屋",
      path: ["folder:场景", "folder:小屋", "material:温馨小屋"],
    });
    expect(resolved.folderPath).toEqual(["场景", "小屋"]);
    expect(resolved.selectedMaterialName).toBe("温馨小屋");
  });
});

