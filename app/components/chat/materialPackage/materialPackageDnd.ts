export const MATERIAL_PREVIEW_DRAG_TYPE = "application/x-tc-material-preview";
export const MATERIAL_PREVIEW_DRAG_ORIGIN_TYPE =
  "application/x-tc-material-preview-origin";

export type MaterialPackageScope = "global" | "space";

export type MaterialPreviewPayload = {
  /** scope 缺省表示局外（global），兼容旧数据 */
  scope?: MaterialPackageScope;
  /** scope=space 时，用于读取局内素材库数据 */
  spaceId?: number;
  kind: "package" | "folder" | "material";
  /** 对 global：packageId；对 space：spacePackageId */
  packageId: number;
  label: string;
  path: string[];
};

export type MaterialPreviewDragOrigin = "tree" | "docked";

let activeMaterialPreviewDrag: MaterialPreviewPayload | null = null;
let activeMaterialPreviewDragOrigin: MaterialPreviewDragOrigin | null = null;

export function getActiveMaterialPreviewDragPayload() {
  return activeMaterialPreviewDrag;
}

export function clearActiveMaterialPreviewDragPayload() {
  activeMaterialPreviewDrag = null;
  activeMaterialPreviewDragOrigin = null;
}

export function setMaterialPreviewDragData(
  dataTransfer: DataTransfer,
  payload: MaterialPreviewPayload,
) {
  activeMaterialPreviewDrag = payload;
  try {
    dataTransfer.setData(MATERIAL_PREVIEW_DRAG_TYPE, JSON.stringify(payload));
  } catch {
    // ignore
  }

  try {
    // Fallback channel for environments that block custom MIME types.
    // Prefer `text/uri-list` so we don't conflict with other drag payloads that rely on `text/plain`.
    dataTransfer.setData(
      "text/uri-list",
      `tc-material-preview:${JSON.stringify(payload)}`,
    );
  } catch {
    // ignore
  }

  // Some environments swallow non-URL content in `text/uri-list`.
  // Use another common channel as fallback without touching `text/plain`.
  try {
    dataTransfer.setData(
      "text/html",
      `tc-material-preview:${JSON.stringify(payload)}`,
    );
  } catch {
    // ignore
  }

  // Last-resort fallback: only write `text/plain` when it's currently empty,
  // because sidebar reorder / other DnD flows may rely on `text/plain`.
  try {
    const existingPlain = dataTransfer.getData("text/plain") || "";
    if (!existingPlain.trim()) {
      dataTransfer.setData(
        "text/plain",
        `tc-material-preview:${JSON.stringify(payload)}`,
      );
    }
  } catch {
    // ignore
  }
}

export function setMaterialPreviewDragOrigin(
  dataTransfer: DataTransfer,
  origin: MaterialPreviewDragOrigin,
) {
  activeMaterialPreviewDragOrigin = origin;
  try {
    dataTransfer.setData(MATERIAL_PREVIEW_DRAG_ORIGIN_TYPE, origin);
  } catch {
    // ignore
  }
}

export function getMaterialPreviewDragOrigin(
  dataTransfer: DataTransfer | null,
): MaterialPreviewDragOrigin | null {
  if (!dataTransfer) return null;

  try {
    const raw = dataTransfer.getData(MATERIAL_PREVIEW_DRAG_ORIGIN_TYPE);
    if (raw === "tree" || raw === "docked") return raw;
  } catch {
    // ignore
  }

  return activeMaterialPreviewDragOrigin;
}

export function getMaterialPreviewDragData(
  dataTransfer: DataTransfer | null,
): MaterialPreviewPayload | null {
  if (!dataTransfer) return null;
  try {
    const raw = dataTransfer.getData(MATERIAL_PREVIEW_DRAG_TYPE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MaterialPreviewPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      parsed.kind !== "package" &&
      parsed.kind !== "folder" &&
      parsed.kind !== "material"
    )
      return null;
    if (
      typeof parsed.packageId !== "number" ||
      !Number.isFinite(parsed.packageId) ||
      parsed.packageId <= 0
    )
      return null;
    if (typeof parsed.label !== "string" || !parsed.label.trim()) return null;
    const path = Array.isArray(parsed.path)
      ? parsed.path.filter((s) => typeof s === "string")
      : [];
    const scope =
      parsed.scope === "space" || parsed.scope === "global"
        ? parsed.scope
        : undefined;
    const spaceId =
      typeof parsed.spaceId === "number" &&
      Number.isFinite(parsed.spaceId) &&
      parsed.spaceId > 0
        ? parsed.spaceId
        : undefined;
    return {
      ...(scope ? { scope } : {}),
      ...(spaceId ? { spaceId } : {}),
      kind: parsed.kind,
      packageId: parsed.packageId,
      label: parsed.label,
      path,
    };
  } catch {
    // ignore
  }

  // Fallback: parse from text/uri-list
  try {
    const uriList = dataTransfer.getData("text/uri-list") || "";
    const first =
      uriList
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean) || "";
    const prefix = "tc-material-preview:";
    if (!first.startsWith(prefix)) throw new Error("no-prefix");
    const parsed = JSON.parse(
      first.slice(prefix.length),
    ) as Partial<MaterialPreviewPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      parsed.kind !== "package" &&
      parsed.kind !== "folder" &&
      parsed.kind !== "material"
    )
      return null;
    if (
      typeof parsed.packageId !== "number" ||
      !Number.isFinite(parsed.packageId) ||
      parsed.packageId <= 0
    )
      return null;
    if (typeof parsed.label !== "string" || !parsed.label.trim()) return null;
    const path = Array.isArray(parsed.path)
      ? parsed.path.filter((s) => typeof s === "string")
      : [];
    const scope =
      parsed.scope === "space" || parsed.scope === "global"
        ? parsed.scope
        : undefined;
    const spaceId =
      typeof parsed.spaceId === "number" &&
      Number.isFinite(parsed.spaceId) &&
      parsed.spaceId > 0
        ? parsed.spaceId
        : undefined;
    return {
      ...(scope ? { scope } : {}),
      ...(spaceId ? { spaceId } : {}),
      kind: parsed.kind,
      packageId: parsed.packageId,
      label: parsed.label,
      path,
    };
  } catch {
    // ignore
  }

  // Fallback: parse from text/html
  try {
    const raw = dataTransfer.getData("text/html") || "";
    const prefix = "tc-material-preview:";
    if (!raw.startsWith(prefix)) throw new Error("no-prefix");
    const parsed = JSON.parse(
      raw.slice(prefix.length),
    ) as Partial<MaterialPreviewPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      parsed.kind !== "package" &&
      parsed.kind !== "folder" &&
      parsed.kind !== "material"
    )
      return null;
    if (
      typeof parsed.packageId !== "number" ||
      !Number.isFinite(parsed.packageId) ||
      parsed.packageId <= 0
    )
      return null;
    if (typeof parsed.label !== "string" || !parsed.label.trim()) return null;
    const path = Array.isArray(parsed.path)
      ? parsed.path.filter((s) => typeof s === "string")
      : [];
    const scope =
      parsed.scope === "space" || parsed.scope === "global"
        ? parsed.scope
        : undefined;
    const spaceId =
      typeof parsed.spaceId === "number" &&
      Number.isFinite(parsed.spaceId) &&
      parsed.spaceId > 0
        ? parsed.spaceId
        : undefined;
    return {
      ...(scope ? { scope } : {}),
      ...(spaceId ? { spaceId } : {}),
      kind: parsed.kind,
      packageId: parsed.packageId,
      label: parsed.label,
      path,
    };
  } catch {
    // ignore
  }

  // Fallback: parse from text/plain
  try {
    const raw = dataTransfer.getData("text/plain") || "";
    const prefix = "tc-material-preview:";
    if (!raw.startsWith(prefix)) throw new Error("no-preview-prefix");
    const parsed = JSON.parse(
      raw.slice(prefix.length),
    ) as Partial<MaterialPreviewPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      parsed.kind !== "package" &&
      parsed.kind !== "folder" &&
      parsed.kind !== "material"
    )
      return null;
    if (
      typeof parsed.packageId !== "number" ||
      !Number.isFinite(parsed.packageId) ||
      parsed.packageId <= 0
    )
      return null;
    if (typeof parsed.label !== "string" || !parsed.label.trim()) return null;
    const path = Array.isArray(parsed.path)
      ? parsed.path.filter((s) => typeof s === "string")
      : [];
    const scope =
      parsed.scope === "space" || parsed.scope === "global"
        ? parsed.scope
        : undefined;
    const spaceId =
      typeof parsed.spaceId === "number" &&
      Number.isFinite(parsed.spaceId) &&
      parsed.spaceId > 0
        ? parsed.spaceId
        : undefined;
    return {
      ...(scope ? { scope } : {}),
      ...(spaceId ? { spaceId } : {}),
      kind: parsed.kind,
      packageId: parsed.packageId,
      label: parsed.label,
      path,
    };
  } catch {
    // ignore
  }

  // Fallback: some drag sources must occupy `text/plain` for reorder DnD.
  // If they embed a material preview payload, decode it here.
  try {
    const raw = dataTransfer.getData("text/plain") || "";
    const reorderPrefix = "tc-material-package-reorder:";
    if (!raw.startsWith(reorderPrefix)) throw new Error("no-reorder-prefix");
    const parsed = JSON.parse(raw.slice(reorderPrefix.length)) as any;
    const embedded = parsed?.materialPreview as
      | Partial<MaterialPreviewPayload>
      | null
      | undefined;
    if (!embedded || typeof embedded !== "object") return null;
    if (
      embedded.kind !== "package" &&
      embedded.kind !== "folder" &&
      embedded.kind !== "material"
    )
      return null;
    if (
      typeof embedded.packageId !== "number" ||
      !Number.isFinite(embedded.packageId) ||
      embedded.packageId <= 0
    )
      return null;
    if (typeof embedded.label !== "string" || !embedded.label.trim())
      return null;
    const path = Array.isArray(embedded.path)
      ? embedded.path.filter((s: any) => typeof s === "string")
      : [];
    const scope =
      embedded.scope === "space" || embedded.scope === "global"
        ? embedded.scope
        : undefined;
    const spaceId =
      typeof embedded.spaceId === "number" &&
      Number.isFinite(embedded.spaceId) &&
      embedded.spaceId > 0
        ? embedded.spaceId
        : undefined;
    return {
      ...(scope ? { scope } : {}),
      ...(spaceId ? { spaceId } : {}),
      kind: embedded.kind,
      packageId: embedded.packageId,
      label: embedded.label,
      path,
    };
  } catch {
    // ignore
  }

  // Fallback: preview window (MPF) node drag uses `text/plain` for internal move/reorder,
  // but can embed a material preview payload for chat sending.
  try {
    const raw = dataTransfer.getData("text/plain") || "";
    const mpfPrefix = "tc-mpf-node:";
    if (!raw.startsWith(mpfPrefix)) throw new Error("no-mpf-prefix");
    const parsed = JSON.parse(raw.slice(mpfPrefix.length)) as any;
    const embedded = parsed?.materialPreview as
      | Partial<MaterialPreviewPayload>
      | null
      | undefined;
    if (!embedded || typeof embedded !== "object") return null;
    if (
      embedded.kind !== "package" &&
      embedded.kind !== "folder" &&
      embedded.kind !== "material"
    )
      return null;
    if (
      typeof embedded.packageId !== "number" ||
      !Number.isFinite(embedded.packageId) ||
      embedded.packageId <= 0
    )
      return null;
    if (typeof embedded.label !== "string" || !embedded.label.trim())
      return null;
    const path = Array.isArray(embedded.path)
      ? embedded.path.filter((s: any) => typeof s === "string")
      : [];
    const scope =
      embedded.scope === "space" || embedded.scope === "global"
        ? embedded.scope
        : undefined;
    const spaceId =
      typeof embedded.spaceId === "number" &&
      Number.isFinite(embedded.spaceId) &&
      embedded.spaceId > 0
        ? embedded.spaceId
        : undefined;
    return {
      ...(scope ? { scope } : {}),
      ...(spaceId ? { spaceId } : {}),
      kind: embedded.kind,
      packageId: embedded.packageId,
      label: embedded.label,
      path,
    };
  } catch {
    // ignore
  }

  return activeMaterialPreviewDrag;
}

export function isMaterialPreviewDrag(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  try {
    return dataTransfer.types.includes(MATERIAL_PREVIEW_DRAG_TYPE);
  } catch {
    // ignore
  }

  try {
    const types = Array.from(dataTransfer.types || []);
    if (types.includes("text/uri-list") && !types.includes("Files")) {
      const uriList = dataTransfer.getData("text/uri-list") || "";
      const first =
        uriList
          .split(/\r?\n/)
          .map((s) => s.trim())
          .find(Boolean) || "";
      if (first.startsWith("tc-material-preview:")) return true;
    }
  } catch {
    // ignore
  }

  try {
    const types = Array.from(dataTransfer.types || []);
    if (types.includes("text/html") && !types.includes("Files")) {
      const raw = dataTransfer.getData("text/html") || "";
      if (raw.trim().startsWith("tc-material-preview:")) return true;
    }
  } catch {
    // ignore
  }

  // Some browser / runtime combos don't reliably expose custom MIME types via `dataTransfer.types`
  // during `dragover`. Fallback to checking whether data exists.
  try {
    return Boolean(dataTransfer.getData(MATERIAL_PREVIEW_DRAG_TYPE));
  } catch {
    // ignore
  }

  // If the runtime only preserves `text/plain`, allow detecting embedded preview payloads.
  try {
    const raw = dataTransfer.getData("text/plain") || "";
    if (raw.trim().startsWith("tc-material-preview:")) return true;
    const reorderPrefix = "tc-material-package-reorder:";
    if (!raw.trim().startsWith(reorderPrefix))
      throw new Error("no-reorder-prefix");
    const parsed = JSON.parse(raw.trim().slice(reorderPrefix.length)) as any;
    const embedded = parsed?.materialPreview as any;
    if (!embedded || typeof embedded !== "object") return false;
    return (
      embedded.kind === "package" ||
      embedded.kind === "folder" ||
      embedded.kind === "material"
    );
  } catch {
    // ignore
  }

  try {
    const raw = dataTransfer.getData("text/plain") || "";
    const mpfPrefix = "tc-mpf-node:";
    if (!raw.trim().startsWith(mpfPrefix)) throw new Error("no-mpf-prefix");
    const parsed = JSON.parse(raw.trim().slice(mpfPrefix.length)) as any;
    const embedded = parsed?.materialPreview as any;
    if (!embedded || typeof embedded !== "object") return false;
    return (
      embedded.kind === "package" ||
      embedded.kind === "folder" ||
      embedded.kind === "material"
    );
  } catch {
    // ignore
  }

  return Boolean(activeMaterialPreviewDrag);
}

export function isMpfNodeDrag(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;

  // Prefer checking the custom MIME type if available.
  try {
    const types = Array.from(dataTransfer.types || []);
    if (types.includes("application/x-tc-mpf-node")) return true;
  } catch {
    // ignore
  }

  // Fallback: MPF writes a stable prefix into common text channels.
  const prefix = "tc-mpf-node:";
  try {
    const raw = (dataTransfer.getData("text/plain") || "").trim();
    if (raw.startsWith(prefix)) return true;
  } catch {
    // ignore
  }

  try {
    const uriList = (dataTransfer.getData("text/uri-list") || "").trim();
    const first =
      uriList
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean) || "";
    if (first.startsWith(prefix)) return true;
  } catch {
    // ignore
  }

  try {
    const raw = (dataTransfer.getData("text/html") || "").trim();
    if (raw.startsWith(prefix)) return true;
  } catch {
    // ignore
  }

  return false;
}
