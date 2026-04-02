import type { MaterialPackageVisibility } from "@/components/materialPackage/materialPackageApi";

export function normalizePackageVisibility(value: unknown): MaterialPackageVisibility {
  return value === 0 ? 0 : 1;
}

export function getVisibilityCopy(visibility: MaterialPackageVisibility) {
  if (normalizePackageVisibility(visibility) === 0) {
    return {
      chip: "私有",
      title: "私有（不在素材广场展示）",
      description: "素材包仍保留在“我的素材包”里，但不会出现在素材广场。",
    };
  }

  return {
    chip: "公开",
    title: "公开（发布到素材广场）",
    description: "素材包会出现在素材广场，其他人可以查看并获取。",
  };
}

