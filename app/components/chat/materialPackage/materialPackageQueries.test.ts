import { describe, expect, it } from "vitest";

import {
  buildMaterialPackageDetailQueryKey,
  buildMaterialPackageMyQueryKey,
  buildMaterialPackageSquareQueryKey,
} from "@/components/chat/materialPackage/materialPackageQueries";

describe("materialPackageQueries", () => {
  it("buildMaterialPackageMyQueryKey 会随数据源开关变化", () => {
    expect(buildMaterialPackageMyQueryKey(true)).toEqual(["materialPackage", "my", "backend"]);
    expect(buildMaterialPackageMyQueryKey(false)).toEqual(["materialPackage", "my", "mock"]);
  });

  it("buildMaterialPackageDetailQueryKey 会随数据源开关变化", () => {
    expect(buildMaterialPackageDetailQueryKey(1, true)).toEqual(["materialPackage", "detail", 1, "backend"]);
    expect(buildMaterialPackageDetailQueryKey(1, false)).toEqual(["materialPackage", "detail", 1, "mock"]);
  });

  it("buildMaterialPackageSquareQueryKey 会随数据源开关变化", () => {
    expect(buildMaterialPackageSquareQueryKey(true)).toEqual(["materialPackage", "square", "backend"]);
    expect(buildMaterialPackageSquareQueryKey(false)).toEqual(["materialPackage", "square", "mock"]);
  });
});

