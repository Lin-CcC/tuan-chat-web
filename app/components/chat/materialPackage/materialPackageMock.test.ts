import { describe, expect, it } from "vitest";

import type { StorageLike } from "@/components/chat/materialPackage/materialPackageMockStore";
import { createMemoryStorage, writeMockPackages } from "@/components/chat/materialPackage/materialPackageMockStore";
import { getMockMaterialPackageSquare, getMockMyMaterialPackages } from "@/components/chat/materialPackage/materialPackageMock";

const STORAGE_KEY = "tc:material-package:mock-packages:v1";

function resolveStorage(): {
  storage: StorageLike;
  restoreLocalStorage: (() => void) | null;
} {
  const anyGlobal = globalThis as any;
  const existing = anyGlobal?.localStorage as StorageLike | undefined;
  if (existing && typeof existing.getItem === "function" && typeof existing.setItem === "function") {
    return { storage: existing, restoreLocalStorage: null };
  }

  const memory = createMemoryStorage();
  const prev = anyGlobal.localStorage;
  anyGlobal.localStorage = memory;
  return {
    storage: memory,
    restoreLocalStorage: () => {
      anyGlobal.localStorage = prev;
    },
  };
}

describe("materialPackageMock", () => {
  it("getMockMaterialPackageSquare 仅返回 visibility=1 的数据", () => {
    const { storage, restoreLocalStorage } = resolveStorage();
    const prevRaw = storage.getItem(STORAGE_KEY);

    try {
      const seed = getMockMyMaterialPackages();
      const base = seed[0]!;
      writeMockPackages([
        { ...base, packageId: 101, visibility: 1, name: `${base.name}-公开` },
        { ...base, packageId: 102, visibility: 0, name: `${base.name}-私有` },
      ]);

      const square = getMockMaterialPackageSquare();
      expect(square.map(p => Number(p.packageId))).toEqual([101]);
      expect(square.every(p => Number(p.visibility) === 1)).toBe(true);
    }
    finally {
      if (prevRaw === null)
        storage.removeItem?.(STORAGE_KEY);
      else
        storage.setItem(STORAGE_KEY, prevRaw);

      restoreLocalStorage?.();
    }
  });
});
