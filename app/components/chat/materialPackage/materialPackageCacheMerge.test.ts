import { describe, expect, test } from "vitest";

import type {
  MaterialPackageContent,
  MaterialPackageRecord,
  SpaceMaterialPackageRecord,
} from "@/components/materialPackage/materialPackageApi";
import {
  mergeMaterialPackageRecordContent,
  mergeSpaceMaterialPackageRecordContent,
} from "@/components/chat/materialPackage/materialPackageCacheMerge";

describe("materialPackageCacheMerge", () => {
  test("mergeMaterialPackageRecordContent prefers nextContent", () => {
    const prevContent: MaterialPackageContent = { version: 1, root: [] };
    const nextContent: MaterialPackageContent = {
      version: 1,
      root: [{ type: "folder", name: "A", children: [] } as any],
    };
    const updated: MaterialPackageRecord = {
      packageId: 1,
      userId: 1,
      name: "pkg",
      description: "",
      coverUrl: null,
      visibility: 1,
      status: 1,
      content: prevContent,
      importCount: 0,
      createTime: "",
      updateTime: "",
    };

    const merged = mergeMaterialPackageRecordContent(updated, nextContent);
    expect(merged.packageId).toBe(1);
    expect(merged.content).toBe(nextContent);
  });

  test("mergeSpaceMaterialPackageRecordContent prefers nextContent", () => {
    const prevContent: MaterialPackageContent = { version: 1, root: [] };
    const nextContent: MaterialPackageContent = {
      version: 1,
      root: [{ type: "material", name: "m1", messages: [] } as any],
    };
    const updated: SpaceMaterialPackageRecord = {
      spacePackageId: 2,
      spaceId: 3,
      name: "space-pkg",
      description: "",
      coverUrl: null,
      status: 1,
      content: prevContent as any,
      importedBy: 0,
      createTime: "",
      updateTime: "",
    } as any;

    const merged = mergeSpaceMaterialPackageRecordContent(updated, nextContent);
    expect(merged.spacePackageId).toBe(2);
    expect(merged.content).toBe(nextContent);
  });
});
