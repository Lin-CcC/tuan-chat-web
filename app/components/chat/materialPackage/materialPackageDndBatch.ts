import type { MaterialPreviewPayload } from "@/components/chat/materialPackage/materialPackageDnd";

export const MATERIAL_BATCH_DRAG_TYPE = "application/x-tc-material-batch";

export type MaterialBatchDragPayload = {
  items: MaterialPreviewPayload[];
};

let activeMaterialBatchDragPayload: MaterialBatchDragPayload | null = null;

function normalizeItem(raw: any): MaterialPreviewPayload | null {
  if (!raw || typeof raw !== "object")
    return null;
  if (raw.kind !== "package" && raw.kind !== "folder" && raw.kind !== "material")
    return null;
  if (typeof raw.packageId !== "number" || !Number.isFinite(raw.packageId) || raw.packageId <= 0)
    return null;
  if (typeof raw.label !== "string" || !raw.label.trim())
    return null;
  const path = Array.isArray(raw.path) ? raw.path.filter((s: any) => typeof s === "string") : [];
  const scope = raw.scope === "space" || raw.scope === "global" ? raw.scope : undefined;
  const spaceId = typeof raw.spaceId === "number" && Number.isFinite(raw.spaceId) && raw.spaceId > 0 ? raw.spaceId : undefined;
  return {
    ...(scope ? { scope } : {}),
    ...(spaceId ? { spaceId } : {}),
    kind: raw.kind,
    packageId: raw.packageId,
    label: raw.label,
    path,
  };
}

function normalizePayload(raw: any): MaterialBatchDragPayload | null {
  if (!raw || typeof raw !== "object")
    return null;
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw.map(normalizeItem).filter(Boolean) as MaterialPreviewPayload[];
  if (!items.length)
    return null;
  return { items };
}

export function setMaterialBatchDragData(dataTransfer: DataTransfer, payload: MaterialBatchDragPayload) {
  activeMaterialBatchDragPayload = payload;
  try {
    dataTransfer.setData(MATERIAL_BATCH_DRAG_TYPE, JSON.stringify(payload));
  }
  catch {
    // ignore
  }

  try {
    dataTransfer.setData("text/plain", `tc-material-batch:${JSON.stringify(payload)}`);
  }
  catch {
    // ignore
  }
}

export function getMaterialBatchDragData(dataTransfer: DataTransfer | null): MaterialBatchDragPayload | null {
  if (!dataTransfer)
    return null;

  const parse = (raw: string) => {
    try {
      return normalizePayload(JSON.parse(raw));
    }
    catch {
      return null;
    }
  };

  try {
    const raw = dataTransfer.getData(MATERIAL_BATCH_DRAG_TYPE);
    if (raw) {
      const parsed = parse(raw);
      if (parsed)
        return parsed;
    }
  }
  catch {
    // ignore
  }

  try {
    const raw = dataTransfer.getData("text/plain") || "";
    const prefix = "tc-material-batch:";
    if (raw.startsWith(prefix)) {
      const parsed = parse(raw.slice(prefix.length));
      if (parsed)
        return parsed;
    }
  }
  catch {
    // ignore
  }

  return activeMaterialBatchDragPayload;
}

export function isMaterialBatchDrag(dataTransfer: DataTransfer | null) {
  if (!dataTransfer)
    return false;
  try {
    return dataTransfer.types.includes(MATERIAL_BATCH_DRAG_TYPE);
  }
  catch {
    // ignore
  }
  return Boolean(getMaterialBatchDragData(dataTransfer));
}

