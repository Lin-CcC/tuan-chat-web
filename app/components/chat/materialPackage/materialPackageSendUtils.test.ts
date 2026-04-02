import { describe, expect, it } from "vitest";

import type { MaterialPackageContent } from "@/components/materialPackage/materialPackageApi";
import type { MaterialPreviewPayload } from "@/components/chat/materialPackage/materialPackageDnd";
import { resolveMaterialMessageCountFromPayload, resolveMaterialPayloadsFromPayload } from "@/components/chat/materialPackage/materialPackageSendUtils";

function payload(kind: MaterialPreviewPayload["kind"], packageId: number, label: string, path: string[]): MaterialPreviewPayload {
  return { kind, packageId, label, path };
}

describe("materialPackageSendUtils", () => {
  it("resolveMaterialPayloadsFromPayload: folder 递归展开为 material 列表（按列表顺序 DFS）", () => {
    const content: MaterialPackageContent = {
      version: 1,
      root: [
        {
          type: "folder",
          name: "场景",
          children: [
            { type: "material", name: "A", note: "", messages: [{ messageType: 2, extra: {} }] },
            {
              type: "folder",
              name: "子",
              children: [
                { type: "material", name: "B", note: "", messages: [{ messageType: 2, extra: {} }] },
              ],
            },
            { type: "material", name: "C", note: "", messages: [{ messageType: 2, extra: {} }] },
          ],
        },
      ],
    };

    const list = resolveMaterialPayloadsFromPayload(
      content,
      payload("folder", 1, "场景", ["folder:场景"]),
    );

    expect(list.map(p => p.path.join("/"))).toEqual([
      "folder:场景/material:A",
      "folder:场景/folder:子/material:B",
      "folder:场景/material:C",
    ]);
  });

  it("resolveMaterialMessageCountFromPayload: 统计展开后的 messagesTotal", () => {
    const content: MaterialPackageContent = {
      version: 1,
      root: [
        {
          type: "folder",
          name: "场景",
          children: [
            { type: "material", name: "A", note: "", messages: [{ messageType: 2, extra: {} }] },
            { type: "material", name: "B", note: "", messages: [{ messageType: 2, extra: {} }, { messageType: 2, extra: {} }] },
          ],
        },
      ],
    };

    const total = resolveMaterialMessageCountFromPayload(content, payload("folder", 1, "场景", ["folder:场景"]));
    expect(total).toBe(3);
  });
});

