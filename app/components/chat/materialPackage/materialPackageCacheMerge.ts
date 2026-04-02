import type {
  MaterialPackageContent,
  MaterialPackageRecord,
  SpaceMaterialPackageRecord,
} from "@/components/materialPackage/materialPackageApi";

export function mergeMaterialPackageRecordContent(
  updated: MaterialPackageRecord,
  nextContent: MaterialPackageContent,
): MaterialPackageRecord {
  return { ...updated, content: nextContent };
}

export function mergeSpaceMaterialPackageRecordContent(
  updated: SpaceMaterialPackageRecord,
  nextContent: MaterialPackageContent,
): SpaceMaterialPackageRecord {
  return { ...updated, content: nextContent };
}

