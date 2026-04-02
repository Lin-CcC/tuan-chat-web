import { describe, expect, it } from "vitest";

import { createMemoryStorage, readMockPackages, writeMockPackages } from "@/components/chat/materialPackage/materialPackageMockStore";

describe("materialPackageMockStore", () => {
  it("localStorage 为空时会回退到 seed", () => {
    const storage = createMemoryStorage();
    const packages = readMockPackages(storage);
    expect(packages.length).toBeGreaterThan(0);
    expect(packages[0]?.name).toBeTruthy();
  });

  it("写入后可以读回", () => {
    const storage = createMemoryStorage();
    const base = readMockPackages(storage);
    const next = base.map(p => ({ ...p, name: `${p.name}-X` }));
    writeMockPackages(next, storage);
    const restored = readMockPackages(storage);
    expect(restored[0]?.name).toContain("-X");
  });

  it("数据损坏时会回退到 seed", () => {
    const storage = createMemoryStorage({
      "tc:material-package:mock-packages:v1": "{not-json",
    });
    const packages = readMockPackages(storage);
    expect(packages.length).toBeGreaterThan(0);
  });
});

