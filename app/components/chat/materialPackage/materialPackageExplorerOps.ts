import type { MaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";
import type { MaterialPreviewPayload } from "@/components/chat/materialPackage/materialPackageDnd";

export type SelectedExplorerNode =
  | {
    kind: "package" | "folder" | "material";
    key: string;
    payload: MaterialPreviewPayload;
  }
  | null;

export type ResolveTargetResult =
  | { status: "blocked"; reason: "no-packages" }
  | { status: "need-choose-package" }
  | { status: "ok"; packageId: number; folderPath: string[] };

function hasExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0;
}

function splitNameByExtension(name: string) {
  if (!hasExtension(name))
    return { base: name, ext: "" };
  const idx = name.lastIndexOf(".");
  return { base: name.slice(0, idx), ext: name.slice(idx) };
}

export function autoRenameVsCodeLike(name: string, usedNames: ReadonlyArray<string> | ReadonlySet<string>) {
  const used = usedNames instanceof Set ? usedNames : new Set(usedNames);
  if (!used.has(name))
    return name;

  const trimmed = name.trim();
  const { base, ext } = splitNameByExtension(trimmed);
  for (let n = 1; n < 10_000; n++) {
    const candidate = ext ? `${base} (${n})${ext}` : `${trimmed} (${n})`;
    if (!used.has(candidate))
      return candidate;
  }
  return `${trimmed} (${Date.now()})`;
}

export function payloadPathToFolderNames(path: string[] | undefined | null) {
  const parts = Array.isArray(path) ? path : [];
  const result: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string")
      continue;
    if (!part.startsWith("folder:"))
      continue;
    result.push(part.slice("folder:".length));
  }
  return result;
}

export function folderPathEqual(a: string[] | undefined | null, b: string[] | undefined | null) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length !== bb.length)
    return false;
  for (let i = 0; i < aa.length; i += 1) {
    if (aa[i] !== bb[i])
      return false;
  }
  return true;
}

export function resolveTarget(args: {
  selectedNode: SelectedExplorerNode;
  packages: MaterialPackageRecord[];
  defaultTargetPackageId: number | null;
}): ResolveTargetResult {
  const packages = Array.isArray(args.packages) ? args.packages : [];
  if (packages.length === 0) {
    return { status: "blocked", reason: "no-packages" };
  }

  const selected = args.selectedNode;
  if (selected) {
    const packageId = Number(selected.payload.packageId ?? 0);
    const folderPath = payloadPathToFolderNames(selected.payload.path);
    if (selected.kind === "package") {
      return { status: "ok", packageId, folderPath: [] };
    }
    if (selected.kind === "folder") {
      return { status: "ok", packageId, folderPath };
    }
    return { status: "ok", packageId, folderPath };
  }

  if (packages.length === 1) {
    const packageId = Number(packages[0]!.packageId ?? 0);
    return { status: "ok", packageId, folderPath: [] };
  }

  if (args.defaultTargetPackageId != null) {
    const resolved = packages.find(p => Number(p.packageId) === Number(args.defaultTargetPackageId));
    if (resolved) {
      return { status: "ok", packageId: Number(resolved.packageId ?? 0), folderPath: [] };
    }
  }

  return { status: "need-choose-package" };
}
