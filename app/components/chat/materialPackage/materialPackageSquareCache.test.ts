import { describe, expect, it } from "vitest";

import type { MaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";
import {
  applyVisibilityToSquare,
  removeSquareRecord,
  upsertSquareRecord,
} from "@/components/chat/materialPackage/materialPackageSquareCache";

function buildPkg(
  packageId: number,
  updateTime: unknown,
  visibility: MaterialPackageRecord["visibility"] = 1,
  name: string = `pkg-${packageId}`,
): MaterialPackageRecord {
  return {
    packageId,
    userId: 0,
    name,
    description: "",
    coverUrl: null,
    visibility,
    status: 0,
    content: { version: 1, root: [] },
    importCount: 0,
    createTime: new Date().toISOString(),
    updateTime: updateTime as MaterialPackageRecord["updateTime"],
  };
}

describe("materialPackageSquareCache", () => {
  it("upsertSquareRecord: 插入并按 updateTime desc 排序", () => {
    const a = buildPkg(1, "2024-01-01T00:00:00.000Z");
    const b = buildPkg(2, "2024-01-03T00:00:00.000Z");
    const c = buildPkg(3, "2024-01-02T00:00:00.000Z");
    const next = upsertSquareRecord([a, b], c);
    expect(next.map((x) => x.packageId)).toEqual([2, 3, 1]);
  });

  it("upsertSquareRecord: 更新已有记录并重新排序", () => {
    const a = buildPkg(1, "2024-01-01T00:00:00.000Z");
    const b = buildPkg(2, "2024-01-03T00:00:00.000Z");
    const next = upsertSquareRecord([a, b], buildPkg(1, "2024-01-04T00:00:00.000Z", 1, "A2"));
    expect(next.map((x) => x.packageId)).toEqual([1, 2]);
    expect(next[0]?.name).toBe("A2");
  });

  it("upsertSquareRecord: updateTime 相同尽量保持稳定顺序", () => {
    const a = buildPkg(1, "2024-01-01T00:00:00.000Z", 1, "A");
    const b = buildPkg(2, "2024-01-01T00:00:00.000Z", 1, "B");
    const next = upsertSquareRecord([a, b], buildPkg(1, "2024-01-01T00:00:00.000Z", 1, "A2"));
    expect(next.map((x) => x.name)).toEqual(["A2", "B"]);
  });

  it("upsertSquareRecord: 非法/缺失 updateTime 视为 0", () => {
    const valid = buildPkg(1, "1970-01-01T00:00:00.001Z");
    const invalid = buildPkg(2, "not-a-date");
    const next = upsertSquareRecord([invalid], valid);
    expect(next.map((x) => x.packageId)).toEqual([1, 2]);
  });

  it("upsertSquareRecord: 缺失/undefined updateTime 视为 0", () => {
    const missing = buildPkg(2, undefined);
    const valid = buildPkg(1, "1970-01-01T00:00:00.001Z");
    const next = upsertSquareRecord([missing], valid);
    expect(next.map((x) => x.packageId)).toEqual([1, 2]);
  });

  it("removeSquareRecord: 按 packageId 删除", () => {
    const a = buildPkg(1, "2024-01-01T00:00:00.000Z");
    const b = buildPkg(2, "2024-01-02T00:00:00.000Z");
    expect(removeSquareRecord([a, b], 1).map((x) => x.packageId)).toEqual([2]);
  });

  it("applyVisibilityToSquare: visibility==1 => upsert; 否则 remove", () => {
    const a = buildPkg(1, "2024-01-01T00:00:00.000Z", 1);
    const bHidden = buildPkg(2, "2024-01-02T00:00:00.000Z", 0);
    const bVisible = buildPkg(2, "2024-01-02T00:00:00.000Z", 1);

    expect(applyVisibilityToSquare([a], bVisible).map((x) => x.packageId)).toEqual([2, 1]);
    expect(applyVisibilityToSquare([a, bVisible], bHidden).map((x) => x.packageId)).toEqual([1]);
  });

  it("applyVisibilityToSquare: visibility 不是 0/1 时保持不变", () => {
    const keep = buildPkg(2, "2024-01-02T00:00:00.000Z", 1);
    const list = [buildPkg(1, "2024-01-01T00:00:00.000Z", 1), keep];
    const weird = { ...buildPkg(2, "2024-01-03T00:00:00.000Z", 1, "SHOULD-NOT-UPSERT"), visibility: 2 } as unknown as MaterialPackageRecord;
    const next = applyVisibilityToSquare(list, weird);
    expect(next).toBe(list);
    expect(next.map((x) => x.name)).toEqual(["pkg-1", "pkg-2"]);
  });
});
