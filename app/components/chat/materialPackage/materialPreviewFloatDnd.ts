export type MpfViewMode = "icon" | "list";

export type MpfDropIntent = "reorderBefore" | "reorderAfter" | "moveInto" | "none";

export function computeMpfDropIntent(args: {
  viewMode: MpfViewMode;
  targetKind: "folder" | "material";
  targetRect: { left: number; top: number; width: number; height: number };
  clientX: number;
  clientY: number;
}): MpfDropIntent {
  const rect = args.targetRect;
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0)
    return "none";

  if (args.viewMode === "list") {
    const localY = args.clientY - rect.top;
    const edgeY = Math.min(10, rect.height * 0.35);
    if (localY <= edgeY)
      return "reorderBefore";
    if (localY >= rect.height - edgeY)
      return "reorderAfter";

    const localX = args.clientX - rect.left;
    // 列表视图：仅当拖到左侧“缩略图/图标区”才算移入文件夹（避免看起来像“移动”却被吞并）。
    // 判定区按行高近似一个方形，尽量贴合 UI：宽度≈height，且不超过行宽。
    const intoHotX = Math.min(rect.height + 16, rect.width - 12);
    if (args.targetKind === "folder" && localX <= intoHotX)
      return "moveInto";

    return localY < rect.height / 2 ? "reorderBefore" : "reorderAfter";
  }

  const localX = args.clientX - rect.left;
  const edgeX = Math.min(10, rect.width * 0.35);
  if (localX <= edgeX)
    return "reorderBefore";
  if (localX >= rect.width - edgeX)
    return "reorderAfter";
  if (args.targetKind === "folder")
    return "moveInto";
  return localX < rect.width / 2 ? "reorderBefore" : "reorderAfter";
}
