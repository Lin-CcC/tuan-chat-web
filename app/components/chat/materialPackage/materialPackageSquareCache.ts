import type { MaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";

function toUpdateTimeValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sortByUpdateTimeDescStable(list: MaterialPackageRecord[]): MaterialPackageRecord[] {
  return list
    .map((record, index) => ({ record, index, updateTimeValue: toUpdateTimeValue(record.updateTime) }))
    .sort((a, b) => b.updateTimeValue - a.updateTimeValue || a.index - b.index)
    .map((x) => x.record);
}

export function upsertSquareRecord(list: MaterialPackageRecord[], record: MaterialPackageRecord): MaterialPackageRecord[] {
  const existingIndex = list.findIndex((x) => x.packageId === record.packageId);
  const base = existingIndex >= 0 ? list.map((x, i) => (i === existingIndex ? record : x)) : [...list, record];
  return sortByUpdateTimeDescStable(base);
}

export function removeSquareRecord(list: MaterialPackageRecord[], packageId: number): MaterialPackageRecord[] {
  const existingIndex = list.findIndex((x) => x.packageId === packageId);
  if (existingIndex < 0) return list;
  return list.filter((x) => x.packageId !== packageId);
}

export function applyVisibilityToSquare(list: MaterialPackageRecord[], record: MaterialPackageRecord): MaterialPackageRecord[] {
  if (record.visibility === 1) return upsertSquareRecord(list, record);
  if (record.visibility === 0) return removeSquareRecord(list, record.packageId);
  return list;
}
