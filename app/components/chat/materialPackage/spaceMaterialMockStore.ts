import type { SpaceMaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";

export type SpaceMaterialMockState = Record<string, SpaceMaterialPackageRecord[]>;

const STORAGE_KEY = "tc:space-material-packages:mock";

export function nowIso() {
  return new Date().toISOString();
}

export function readSpaceMockPackages(spaceId: number): SpaceMaterialPackageRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as SpaceMaterialMockState : {};
    const list = parsed?.[String(spaceId)];
    return Array.isArray(list) ? list : [];
  }
  catch {
    return [];
  }
}

export function writeSpaceMockPackages(spaceId: number, next: SpaceMaterialPackageRecord[]) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as SpaceMaterialMockState : {};
    const base: SpaceMaterialMockState = (parsed && typeof parsed === "object") ? parsed : {};
    base[String(spaceId)] = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
  }
  catch {
    // ignore
  }
}

export function findSpaceMockPackageById(spaceId: number, spacePackageId: number): SpaceMaterialPackageRecord | null {
  const list = readSpaceMockPackages(spaceId);
  return list.find(p => Number(p.spacePackageId) === Number(spacePackageId)) ?? null;
}

