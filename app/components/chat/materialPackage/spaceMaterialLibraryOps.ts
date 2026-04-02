export function toggleExpandedIds(prev: number[], id: number) {
  const nextId = Number(id);
  if (!Number.isFinite(nextId) || nextId <= 0)
    return prev;
  const base = Array.isArray(prev) ? prev.filter(n => Number.isFinite(Number(n)) && Number(n) > 0).map(n => Number(n)) : [];
  if (base.includes(nextId))
    return base.filter(n => n !== nextId);
  return [...base, nextId];
}

export function parseSpaceLibrarySelectedNodeRef(selected: {
  kind: "package" | "folder" | "material";
  key: string;
  packageId: number;
}): null | { kind: "folder" | "material"; packageId: number; parentPath: string[]; name: string } {
  if (!selected || selected.kind === "package")
    return null;

  const packageId = Number(selected.packageId);
  if (!Number.isFinite(packageId) || packageId <= 0)
    return null;

  const marker = `:${packageId}:`;
  const idx = selected.key.indexOf(marker);
  if (idx < 0)
    return null;

  const rest = selected.key.slice(idx + marker.length);
  const tokens = rest ? rest.split("/").filter(Boolean) : [];
  if (!tokens.length)
    return null;

  const folderNames = tokens
    .filter(t => typeof t === "string" && t.startsWith("folder:"))
    .map(t => t.slice("folder:".length))
    .filter(Boolean);

  if (selected.kind === "material") {
    const last = tokens[tokens.length - 1] ?? "";
    const name = typeof last === "string" && last.startsWith("material:")
      ? last.slice("material:".length).trim()
      : "";
    if (!name)
      return null;
    return { kind: "material", packageId, parentPath: folderNames, name };
  }

  const name = folderNames[folderNames.length - 1]?.trim() ?? "";
  if (!name)
    return null;
  return { kind: "folder", packageId, parentPath: folderNames.slice(0, -1), name };
}

export function canDeleteSpaceLibrarySelectedNode(
  selected: null | { kind: "package" | "folder" | "material" },
) {
  return Boolean(selected);
}

export function getSpaceLibraryDeleteTooltipLabel(
  selected: null | { kind: "package" | "folder" | "material" },
) {
  if (!selected)
    return "先选中要删除的项";
  if (selected.kind === "package")
    return "删除素材箱";
  if (selected.kind === "folder")
    return "删除文件夹";
  return "删除文件";
}

export function getSpaceLibraryDeleteDialogCopy(target: { kind: "package" | "folder" | "material"; name: string }) {
  const name = String(target?.name ?? "").trim();
  if (target.kind === "package") {
    return {
      primary: `将删除素材箱「${name}」及其全部内容。`,
      secondary: "该操作不可撤销。",
    };
  }
  if (target.kind === "folder") {
    return {
      primary: `将删除文件夹「${name}」及其全部内容。`,
      secondary: "该操作不可撤销。",
    };
  }
  return {
    primary: `将删除文件「${name}」。`,
    secondary: "该操作不可撤销。",
  };
}
