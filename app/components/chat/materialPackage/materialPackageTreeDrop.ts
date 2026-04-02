export type TreeFolderRowDropDecision = "none" | "reorder" | "move";

export function computeTreeFolderRowDropDecision(args: {
  samePackage: boolean;
  isBeforeZone: boolean;
  sameParent: boolean;
}): TreeFolderRowDropDecision {
  if (!args.isBeforeZone)
    return "move";
  if (args.samePackage && args.sameParent)
    return "reorder";
  return "move";
}

