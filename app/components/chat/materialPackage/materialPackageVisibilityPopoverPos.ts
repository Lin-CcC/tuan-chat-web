export function computeVisibilityPopoverPos(args: {
  anchorRect: { left: number; top: number; right: number; bottom: number };
  panelRect?: { left: number; top: number; right: number; bottom: number } | null;
  viewport: { width: number; height: number };
  popover: { width: number; height: number };
  padding?: number;
}): { left: number; top: number } {
  const padding = Number.isFinite(args.padding) ? Number(args.padding) : 8;
  const width = args.popover.width;
  const height = args.popover.height;

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const vpW = args.viewport.width;
  const vpH = args.viewport.height;

  const preferBelowTop = args.anchorRect.bottom + 6;
  const preferAboveTop = args.anchorRect.top - height - 6;
  const topRaw = preferBelowTop + height + padding <= vpH
    ? preferBelowTop
    : Math.max(padding, preferAboveTop);
  const top = clamp(topRaw, padding, vpH - height - padding);

  const panel = args.panelRect ?? null;
  const canPlaceRight = panel && (vpW - panel.right) >= (width + padding);

  if (canPlaceRight) {
    const leftRaw = panel.right + 8;
    const left = clamp(leftRaw, padding, vpW - width - padding);
    return { left, top };
  }

  const preferLeft = args.anchorRect.right - width;
  const left = clamp(preferLeft, padding, vpW - width - padding);
  return { left, top };
}

