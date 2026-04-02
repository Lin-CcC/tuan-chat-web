import type { MaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";
import { getMockMyMaterialPackages } from "@/components/chat/materialPackage/materialPackageMock";

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

const STORAGE_KEY = "tc:material-package:mock-packages:v1";

function getDefaultStorage(): StorageLike | null {
  const anyGlobal = globalThis as any;
  const storage = anyGlobal?.localStorage as StorageLike | undefined;
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function")
    return null;
  return storage;
}

export function createMemoryStorage(seed?: Record<string, string>): StorageLike {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function normalizePackages(payload: unknown): MaterialPackageRecord[] {
  if (!Array.isArray(payload))
    return [];
  return payload.filter(Boolean) as MaterialPackageRecord[];
}

export function readMockPackages(storage?: StorageLike): MaterialPackageRecord[] {
  const resolvedStorage = storage ?? getDefaultStorage();
  if (!resolvedStorage) {
    return getMockMyMaterialPackages();
  }

  const raw = resolvedStorage.getItem(STORAGE_KEY);
  if (!raw)
    return getMockMyMaterialPackages();

  try {
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizePackages(parsed);
    if (!normalized.length)
      return getMockMyMaterialPackages();
    return normalized;
  }
  catch {
    return getMockMyMaterialPackages();
  }
}

export function writeMockPackages(next: MaterialPackageRecord[], storage?: StorageLike) {
  const resolvedStorage = storage ?? getDefaultStorage();
  if (!resolvedStorage)
    return;
  resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(next ?? []));
}

export function findMockPackageById(packageId: number, storage?: StorageLike): MaterialPackageRecord | null {
  const packages = readMockPackages(storage);
  const found = packages.find(p => Number(p.packageId) === Number(packageId));
  return found ?? null;
}

