export type MaterialPackageDataSource = "backend" | "mock";

function toSource(useBackend: boolean): MaterialPackageDataSource {
  return useBackend ? "backend" : "mock";
}

export function buildMaterialPackageMyQueryKey(useBackend: boolean) {
  return ["materialPackage", "my", toSource(useBackend)] as const;
}

export function buildMaterialPackageDetailQueryKey(packageId: number, useBackend: boolean) {
  return ["materialPackage", "detail", packageId, toSource(useBackend)] as const;
}

export function buildMaterialPackageSquareQueryKey(useBackend: boolean) {
  return ["materialPackage", "square", toSource(useBackend)] as const;
}

