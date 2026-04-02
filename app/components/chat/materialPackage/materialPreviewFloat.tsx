import type {
  MaterialItemNode,
  MaterialNode,
  MaterialPackageContent,
  MaterialPackageRecord,
  SpaceMaterialPackageRecord,
} from "@/components/materialPackage/materialPackageApi";
import type { MaterialPreviewPayload } from "@/components/chat/materialPackage/materialPackageDnd";

import { ChevronDown, FolderIcon, XMarkICon } from "@/icons";
import BetterImg from "@/components/common/betterImg";
import {
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowSquareOutIcon,
  FileImageIcon,
  FolderPlusIcon,
  ListBulletsIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlusIcon,
  TagIcon,
  SquareIcon,
  SquaresFourIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { toast } from "react-hot-toast";

import {
  createMaterialPackage,
  deleteMaterialPackage,
  getMaterialPackage,
  getMyMaterialPackages,
  createSpaceMaterialPackage,
  deleteSpaceMaterialPackage,
  getSpaceMaterialPackage,
  listSpaceMaterialPackages,
  updateMaterialPackage,
  updateSpaceMaterialPackage,
} from "@/components/materialPackage/materialPackageApi";
import PortalTooltip from "@/components/common/portalTooltip";
import {
  readMockPackages,
  writeMockPackages,
} from "@/components/chat/materialPackage/materialPackageMockStore";
import {
  nowIso,
  readSpaceMockPackages,
  writeSpaceMockPackages,
} from "@/components/chat/materialPackage/spaceMaterialMockStore";
import type { MaterialPreviewDragOrigin } from "@/components/chat/materialPackage/materialPackageDnd";
import {
  setMaterialPreviewDragData,
  setMaterialPreviewDragOrigin,
} from "@/components/chat/materialPackage/materialPackageDnd";
import { useLocalStorage } from "@/components/common/customHooks/useLocalStorage";
import {
  buildMaterialPackageDetailQueryKey,
  buildMaterialPackageMyQueryKey,
} from "@/components/chat/materialPackage/materialPackageQueries";
import {
  autoRenameVsCodeLike,
  folderPathEqual,
} from "@/components/chat/materialPackage/materialPackageExplorerOps";
import { computeMpfDropIntent } from "@/components/chat/materialPackage/materialPreviewFloatDnd";
import {
  mergeMaterialPackageRecordContent,
  mergeSpaceMaterialPackageRecordContent,
} from "@/components/chat/materialPackage/materialPackageCacheMerge";
import {
  getFolderNodesAtPath,
  resolveInitialPreviewState,
} from "@/components/chat/materialPackage/materialPackageTree";
import {
  buildEmptyMaterialPackageContent,
  draftCreateFolder,
  draftCreateMaterial,
  draftDeleteFolder,
  draftDeleteMaterial,
  draftMoveNode,
  draftRenameFolder,
  draftRenameMaterial,
  draftReorderNode,
  draftUpdateMaterialAnnotations,
} from "@/components/chat/materialPackage/materialPackageDraft";
import { useMpfThemeVars } from "@/components/chat/materialPackage/mpfThemeVars";

interface MaterialPreviewFloatProps {
  variant?: "float" | "embedded";
  payload: MaterialPreviewPayload;
  onClose: () => void;
  onDock: (
    payload: MaterialPreviewPayload,
    options?: { index?: number; placement?: "top" | "bottom" },
  ) => void;
  onPopout?: (
    payload: MaterialPreviewPayload,
    options?: {
      initialPosition?: { x: number; y: number } | null;
      initialSize?: { w: number; h: number };
    },
  ) => void;
  dragOrigin?: MaterialPreviewDragOrigin;
  initialPosition?: { x: number; y: number } | null;
  /** 仅对自由弹窗生效：用于从 embedded popout 时保持尺寸 */
  initialSize?: { w: number; h: number } | null;
  /** 用于隔离“目录插入提示线/插入位置”事件，避免多个目录面板互相干扰 */
  dockContextId?: string;
}

type SelectedItem = { type: "folder" | "material"; name: string } | null;
type InlineEditState = {
  type: "folder" | "material";
  name: string;
  field: "name" | "note";
  value: string;
} | null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isValidId(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function buildSpacePreviewListQueryKey(spaceId: number, useBackend: boolean) {
  return [
    "tc:mpf:space-material-packages",
    "list",
    spaceId,
    useBackend,
  ] as const;
}

function buildSpacePreviewDetailQueryKey(
  spacePackageId: number,
  useBackend: boolean,
) {
  return [
    "tc:mpf:space-material-packages",
    "detail",
    spacePackageId,
    useBackend,
  ] as const;
}

function buildSpaceLibraryListQueryKey(spaceId: number, useBackend: boolean) {
  return ["spaceMaterialPackages", spaceId, useBackend] as const;
}

function buildSpaceLibraryDetailQueryKey(
  spacePackageId: number,
  useBackend: boolean,
) {
  return ["spaceMaterialPackage", spacePackageId, useBackend] as const;
}

function adaptSpaceRecord(
  record: SpaceMaterialPackageRecord,
): MaterialPackageRecord {
  return {
    packageId: Number(record.spacePackageId),
    userId: Number(record.importedBy ?? 0),
    name: record.name,
    description: record.description ?? "",
    coverUrl: record.coverUrl ?? null,
    visibility: 1,
    status: record.status,
    content: record.content,
    importCount: 0,
    createTime: record.createTime,
    updateTime: record.updateTime,
  };
}

function isInlineClickTarget(target: EventTarget | null) {
  if (!target) return false;
  const el =
    target instanceof Element ? target : (target as any)?.parentElement;
  return Boolean(el?.closest?.("[data-mpf-inline='1']"));
}

function getMaterialThumbUrl(node: MaterialNode): string | null {
  if (node.type !== "material") return null;

  for (const msg of node.messages ?? []) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.messageType !== 2) continue;
    const extra: any = (msg as any).extra ?? null;
    const imageMessage = extra?.imageMessage ?? extra;
    const url = typeof imageMessage?.url === "string" ? imageMessage.url : "";
    if (url) return url;
  }

  return null;
}

function getMaterialUnuploadedHint(node: MaterialNode): string | null {
  if (node.type !== "material") return null;

  for (const msg of node.messages ?? []) {
    if (!msg || typeof msg !== "object") continue;

    if (msg.messageType === 2) {
      const extra: any = (msg as any).extra ?? null;
      const imageMessage = extra?.imageMessage ?? extra;
      const url = typeof imageMessage?.url === "string" ? imageMessage.url : "";
      if (!url) return "图片未上传（后端模式）";
    }

    if (msg.messageType === 3) {
      const extra: any = (msg as any).extra ?? null;
      const soundMessage = extra?.soundMessage ?? extra;
      const url = typeof soundMessage?.url === "string" ? soundMessage.url : "";
      if (!url) return "音频未上传（后端模式）";
    }
  }

  return null;
}

const MPF_NODE_DRAG_TYPE = "application/x-tc-mpf-node";
type MpfNodeDragPayload = {
  packageId: number;
  folderPath: string[];
  kind: "folder" | "material";
  name: string;
  /** Optional: let chat decode a sendable payload from the same drag event. */
  materialPreview?: MaterialPreviewPayload;
};

let activeMpfNodeDrag: MpfNodeDragPayload | null = null;

function setMpfNodeDragData(
  dataTransfer: DataTransfer,
  payload: MpfNodeDragPayload,
) {
  activeMpfNodeDrag = payload;
  const encoded = JSON.stringify(payload);
  try {
    dataTransfer.setData(MPF_NODE_DRAG_TYPE, encoded);
  } catch {
    // ignore
  }
  try {
    // Prefer `text/uri-list` so we don't clobber `text/plain` used by other DnD flows.
    dataTransfer.setData("text/uri-list", `tc-mpf-node:${encoded}`);
  } catch {
    // ignore
  }
  try {
    // Some environments swallow non-URL content in `text/uri-list`.
    dataTransfer.setData("text/html", `tc-mpf-node:${encoded}`);
  } catch {
    // ignore
  }
  // Last-resort fallback: only write `text/plain` when it's currently empty,
  // because material-preview / sidebar reorder may rely on `text/plain`.
  try {
    const existingPlain = dataTransfer.getData("text/plain") || "";
    if (!existingPlain.trim()) {
      dataTransfer.setData("text/plain", `tc-mpf-node:${encoded}`);
    }
  } catch {
    // ignore
  }
}

function getMpfNodeDragData(
  dataTransfer: DataTransfer | null,
): MpfNodeDragPayload | null {
  if (!dataTransfer) return activeMpfNodeDrag;
  const parse = (raw: string) => {
    const parsed = JSON.parse(raw) as Partial<MpfNodeDragPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof parsed.packageId !== "number" ||
      !Number.isFinite(parsed.packageId) ||
      parsed.packageId <= 0
    )
      return null;
    const folderPath = Array.isArray(parsed.folderPath)
      ? parsed.folderPath.filter((s) => typeof s === "string")
      : [];
    if (parsed.kind !== "folder" && parsed.kind !== "material") return null;
    const name = typeof parsed.name === "string" ? parsed.name : "";
    if (!name.trim()) return null;
    return {
      packageId: parsed.packageId,
      folderPath,
      kind: parsed.kind,
      name: name.trim(),
    } as MpfNodeDragPayload;
  };
  try {
    const raw = dataTransfer.getData(MPF_NODE_DRAG_TYPE);
    if (raw) {
      const parsed = parse(raw);
      if (parsed) return parsed;
    }
  } catch {
    // ignore
  }
  try {
    const raw = dataTransfer.getData("text/plain");
    const prefix = "tc-mpf-node:";
    if (raw && raw.startsWith(prefix)) {
      const parsed = parse(raw.slice(prefix.length));
      if (parsed) return parsed;
    }
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
    const prefix = "tc-mpf-node:";
    if (first.startsWith(prefix)) {
      const parsed = parse(first.slice(prefix.length));
      if (parsed) return parsed;
    }
  } catch {
    // ignore
  }

  // Fallback: parse from text/html
  try {
    const raw = dataTransfer.getData("text/html") || "";
    const prefix = "tc-mpf-node:";
    if (raw.startsWith(prefix)) {
      const parsed = parse(raw.slice(prefix.length));
      if (parsed) return parsed;
    }
  } catch {
    // ignore
  }

  return activeMpfNodeDrag;
}

function getMaterialAnnotations(node: MaterialNode): string[] {
  if (node.type !== "material") return [];

  const raw: string[] = [];
  for (const msg of node.messages ?? []) {
    const list = (msg as any)?.annotations;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === "string" && item.trim()) raw.push(item.trim());
    }
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (item === "素材") continue;
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function getNodeBaseType(
  node: MaterialNode,
): "文件夹" | "图片" | "音频" | "视频" | "文本" | "文件" {
  if (node.type === "folder") return "文件夹";

  for (const msg of node.messages ?? []) {
    const mt = (msg as any)?.messageType;
    if (mt === 2) return "图片";
    if (mt === 14) return "视频";
    if (mt === 3) return "音频";
  }

  const first = (node.messages ?? [])[0] as any;
  const content = typeof first?.content === "string" ? first.content : "";
  if (content.trim()) return "文本";
  return "文件";
}

const COMMON_ANNOTATIONS = [
  "背景",
  "BGM",
  "立绘",
  "音效",
  "展示",
  "旁白",
  "环境",
  "文本",
] as const;

export default function MaterialPreviewFloat({
  variant = "float",
  payload,
  onClose,
  onDock,
  onPopout,
  dragOrigin,
  initialPosition,
  initialSize,
  dockContextId,
}: MaterialPreviewFloatProps) {
  const isEmbedded = variant === "embedded";
  const isDockedEmbedded = isEmbedded && dragOrigin === "docked";
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>(
    { active: false, offsetX: 0, offsetY: 0 },
  );
  const coverDragPendingRef = useRef<{
    active: boolean;
    startClientX: number;
    startClientY: number;
    offsetX: number;
    offsetY: number;
  }>({
    active: false,
    startClientX: 0,
    startClientY: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const pointerRef = useRef<{
    pointerId: number | null;
    mode: "none" | "coverPending" | "drag" | "resize";
    startClientX: number;
    startClientY: number;
    offsetX: number;
    offsetY: number;
  }>({
    pointerId: null,
    mode: "none",
    startClientX: 0,
    startClientY: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const resizeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
  });
  const coverObserverRef = useRef<ResizeObserver | null>(null);
  const isCoverModeRef = useRef<boolean>(initialPosition == null);
  const [pos, setPos] = useState(() => {
    if (isEmbedded) return { x: 0, y: 0 };
    if (initialPosition == null) return { x: 0, y: 0 };
    const x = initialPosition.x ?? 40;
    const y = initialPosition.y ?? 32;
    return { x, y };
  });
  const [shellSize, setShellSize] = useState(() => {
    const w =
      !isEmbedded && initialSize?.w && Number.isFinite(initialSize.w)
        ? Math.max(360, Math.round(initialSize.w))
        : 860;
    const h = isEmbedded
      ? 360
      : !isEmbedded && initialSize?.h && Number.isFinite(initialSize.h)
        ? Math.max(360, Math.round(initialSize.h))
        : 420;
    return { w, h };
  });
  const [isCoverMode, setIsCoverMode] = useState<boolean>(
    () => !isEmbedded && initialPosition == null,
  );

  const setCoverMode = useCallback((next: boolean) => {
    isCoverModeRef.current = next;
    setIsCoverMode(next);
    if (!next) {
      coverObserverRef.current?.disconnect();
      coverObserverRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isEmbedded) return;
    if (!initialPosition) return;
    setPos({
      x: initialPosition.x,
      y: initialPosition.y,
    });
    setCoverMode(false);
  }, [initialPosition?.x, initialPosition?.y, isEmbedded, setCoverMode]);

  const syncCoverToParent = useCallback(() => {
    if (!isCoverModeRef.current) return;
    const container = containerRef.current;
    const parent = container?.parentElement;
    if (!container || !parent) return;
    const nextW = Math.max(360, parent.clientWidth);
    const nextH = Math.max(420, parent.clientHeight);
    setPos((prev) => (prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }));
    setShellSize((prev) =>
      prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH },
    );
  }, []);

  useLayoutEffect(() => {
    if (isEmbedded) return;
    if (!isCoverMode) return;
    syncCoverToParent();
  }, [isCoverMode, syncCoverToParent]);

  useEffect(() => {
    if (isEmbedded) return;
    if (!isCoverMode) return;
    const container = containerRef.current;
    const parent = container?.parentElement;
    if (!parent) return;
    coverObserverRef.current?.disconnect();
    const observer = new ResizeObserver(() => syncCoverToParent());
    coverObserverRef.current = observer;
    observer.observe(parent);
    return () => {
      observer.disconnect();
      if (coverObserverRef.current === observer)
        coverObserverRef.current = null;
    };
  }, [isCoverMode, syncCoverToParent]);

  const exitCoverModeToFloating = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const container = containerRef.current;
      const parent = container?.parentElement;
      if (!container || !parent) {
        setCoverMode(false);
        setShellSize((prev) => ({ w: Math.min(prev.w, 860), h: 420 }));
        return;
      }
      const rect = parent.getBoundingClientRect();
      const maxW = Math.max(360, parent.clientWidth - 12);
      const maxH = Math.max(420, parent.clientHeight - 12);
      const desiredW = Math.min(
        960,
        Math.max(520, Math.round(parent.clientWidth * 0.6)),
      );
      const desiredH = Math.min(
        640,
        Math.max(420, Math.round(parent.clientHeight * 0.56)),
      );
      const nextW = clamp(desiredW, 360, maxW);
      const nextH = clamp(desiredH, 420, maxH);
      const hintX = event.clientX - rect.left;
      const hintY = event.clientY - rect.top;
      const nextX = clamp(
        Math.round(hintX - nextW * 0.5),
        0,
        Math.max(0, parent.clientWidth - nextW),
      );
      const nextY = clamp(
        Math.round(hintY - 16),
        0,
        Math.max(0, parent.clientHeight - nextH),
      );
      setCoverMode(false);
      setShellSize({ w: nextW, h: nextH });
      setPos({ x: nextX, y: nextY });
      return { x: nextX, y: nextY };
    },
    [setCoverMode],
  );

  const title = useMemo(() => payload.label, [payload.label]);

  const getDockContextRoot = useCallback(() => {
    if (!dockContextId) return document as ParentNode;
    const escaped =
      typeof (CSS as any)?.escape === "function"
        ? (CSS as any).escape(dockContextId)
        : dockContextId.replace(/["\\]/g, "\\$&");
    const el = document.querySelector(`[data-dock-context-id="${escaped}"]`);
    return (el ?? document) as ParentNode;
  }, [dockContextId]);

  const getDockContextRootById = useCallback((contextId: string | null) => {
    if (!contextId) return document as ParentNode;
    const escaped =
      typeof (CSS as any)?.escape === "function"
        ? (CSS as any).escape(contextId)
        : contextId.replace(/["\\]/g, "\\$&");
    const el = document.querySelector(`[data-dock-context-id="${escaped}"]`);
    return (el ?? document) as ParentNode;
  }, []);

  const queryWithinDockContext = useCallback(
    (selector: string, options?: { includeSelf?: boolean }) => {
      const root = getDockContextRoot();
      const includeSelf = Boolean(options?.includeSelf);
      if (
        includeSelf &&
        root &&
        (root as any).matches &&
        (root as any).matches(selector)
      ) {
        return root as unknown as HTMLElement;
      }
      return (root as any).querySelector?.(selector) as HTMLElement | null;
    },
    [getDockContextRoot],
  );

  const queryMainZoneNearDockContext = useCallback(() => {
    const selector = "[data-role='material-package-main-zone']";
    // No dock context -> fallback to global.
    if (!dockContextId) {
      return document.querySelector(selector) as HTMLElement | null;
    }

    const root = getDockContextRoot();
    let current: HTMLElement | null = root instanceof HTMLElement ? root : null;
    while (current) {
      // Allow main-zone to be the ancestor itself.
      if ((current as any).matches?.(selector)) {
        return current;
      }
      const found = current.querySelector?.(selector) as HTMLElement | null;
      if (found) {
        return found;
      }
      current = current.parentElement;
    }

    return document.querySelector(selector) as HTMLElement | null;
  }, [dockContextId, getDockContextRoot]);

  const detectDockContextIdAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      try {
        const elements = document.elementsFromPoint(clientX, clientY);
        for (const el of elements) {
          if (!(el instanceof HTMLElement)) continue;
          if (!el.hasAttribute("data-dock-context-id")) continue;
          if (el.getAttribute("data-role") !== "material-package-dock-zone")
            continue;
          const id = el.getAttribute("data-dock-context-id");
          if (id && id.trim()) return id;
        }
      } catch {
        // ignore
      }
      return null;
    },
    [],
  );

  const hoverDockContextIdRef = useRef<string | null>(null);

  const computeDockInsertIndexInContext = useCallback(
    (contextId: string | null, clientY: number) => {
      const root = getDockContextRootById(contextId);
      const itemsRoot = (root as any).querySelector?.(
        "[data-role='material-package-tree-items']",
      ) as HTMLElement | null;
      if (!itemsRoot) {
        return 0;
      }
      const rows = Array.from(
        itemsRoot.querySelectorAll<HTMLElement>(
          "[data-role='material-package-visible-row'][data-base-index]",
        ),
      );
      if (!rows.length) {
        return 0;
      }
      const baseCount = rows.length;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (clientY < mid) {
          const idx = Number(row.dataset.baseIndex ?? 0);
          if (!Number.isFinite(idx)) return 0;
          return clamp(Math.floor(idx), 0, baseCount);
        }
      }
      const last = rows[rows.length - 1]!;
      const lastIdx = Number(last.dataset.baseIndex ?? baseCount);
      const finalCount = Number.isFinite(lastIdx) ? lastIdx + 1 : baseCount;
      return clamp(finalCount, 0, finalCount);
    },
    [getDockContextRootById],
  );

  const dispatchDockRequest = useCallback(
    (contextId: string, index: number, dockPayload: MaterialPreviewPayload) => {
      window.dispatchEvent(
        new CustomEvent("tc:material-package:dock-request", {
          detail: { contextId, index, payload: dockPayload },
        }),
      );
    },
    [],
  );

  const computeDockInsertIndex = useCallback(
    (clientY: number) => {
      const itemsRoot = queryWithinDockContext(
        "[data-role='material-package-tree-items']",
      ) as HTMLElement | null;
      if (!itemsRoot) {
        return 0;
      }
      const rows = Array.from(
        itemsRoot.querySelectorAll<HTMLElement>(
          "[data-role='material-package-visible-row'][data-base-index]",
        ),
      );
      if (!rows.length) {
        return 0;
      }
      const baseCount = rows.length;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (clientY < mid) {
          const idx = Number(row.dataset.baseIndex ?? 0);
          if (!Number.isFinite(idx)) return 0;
          return clamp(Math.floor(idx), 0, baseCount);
        }
      }
      const last = rows[rows.length - 1]!;
      const lastIdx = Number(last.dataset.baseIndex ?? baseCount);
      const finalCount = Number.isFinite(lastIdx) ? lastIdx + 1 : baseCount;
      return clamp(finalCount, 0, finalCount);
    },
    [queryWithinDockContext],
  );

  const dispatchDockHintByIndex = useCallback(
    (clientY: number) => {
      const itemsRoot = queryWithinDockContext(
        "[data-role='material-package-tree-items']",
      ) as HTMLElement | null;
      const rows = itemsRoot
        ? Array.from(
            itemsRoot.querySelectorAll<HTMLElement>(
              "[data-role='material-package-visible-row'][data-base-index]",
            ),
          )
        : [];
      const baseCount = rows.length;
      const index = computeDockInsertIndex(clientY);
      const baseText =
        index <= 0
          ? "插入到顶部"
          : index >= baseCount
            ? "插入到底部"
            : "插入到这里";
      window.dispatchEvent(
        new CustomEvent("tc:material-package:dock-hint", {
          detail: {
            visible: true,
            index,
            text: `${baseText}（${index}/${baseCount}）`,
            ...(dockContextId ? { contextId: dockContextId } : {}),
          },
        }),
      );
    },
    [computeDockInsertIndex, dockContextId, queryWithinDockContext],
  );

  const clearDockHintByIndex = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("tc:material-package:dock-hint", {
        detail: {
          visible: false,
          ...(dockContextId ? { contextId: dockContextId } : {}),
        },
      }),
    );
  }, [dockContextId]);

  const dispatchMainDropPreview = useCallback((visible: boolean) => {
    window.dispatchEvent(
      new CustomEvent("tc:material-package:main-drop-preview", {
        detail: { visible },
      }),
    );
  }, []);

  const dockPointerDragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    moved: false,
  });
  const onDockedHandlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!isDockedEmbedded) {
        return;
      }
      dockPointerDragRef.current.active = true;
      dockPointerDragRef.current.pointerId = event.pointerId;
      dockPointerDragRef.current.startX = event.clientX;
      dockPointerDragRef.current.startY = event.clientY;
      dockPointerDragRef.current.moved = false;
      dispatchMainDropPreview(false);
      event.preventDefault();
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      dispatchDockHintByIndex(event.clientY);
    },
    [dispatchDockHintByIndex, isDockedEmbedded],
  );

  const onDockedHandlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (
        !dockPointerDragRef.current.active ||
        dockPointerDragRef.current.pointerId !== event.pointerId
      ) {
        return;
      }
      const dx = event.clientX - dockPointerDragRef.current.startX;
      const dy = event.clientY - dockPointerDragRef.current.startY;
      if (
        !dockPointerDragRef.current.moved &&
        (Math.abs(dx) > 3 || Math.abs(dy) > 3)
      ) {
        dockPointerDragRef.current.moved = true;
      }

      const dockZone = queryWithinDockContext(
        "[data-role='material-package-dock-zone']",
        { includeSelf: true },
      ) as HTMLElement | null;
      const mainZone = queryMainZoneNearDockContext();
      const inRect = (zone: HTMLElement | null) => {
        if (!zone) {
          return false;
        }
        const rect = zone.getBoundingClientRect();
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        );
      };

      if (inRect(dockZone)) {
        dispatchMainDropPreview(false);
        dispatchDockHintByIndex(event.clientY);
        return;
      }

      clearDockHintByIndex();
      dispatchMainDropPreview(inRect(mainZone));
    },
    [
      clearDockHintByIndex,
      dispatchDockHintByIndex,
      dispatchMainDropPreview,
      queryMainZoneNearDockContext,
      queryWithinDockContext,
    ],
  );

  const onDockedHandlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (
        !dockPointerDragRef.current.active ||
        dockPointerDragRef.current.pointerId !== event.pointerId
      ) {
        return;
      }
      const didMove = dockPointerDragRef.current.moved;
      dockPointerDragRef.current.active = false;
      dockPointerDragRef.current.pointerId = null;
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(
          event.pointerId,
        );
      } catch {
        // ignore
      }

      const dockZone = queryWithinDockContext(
        "[data-role='material-package-dock-zone']",
        { includeSelf: true },
      ) as HTMLElement | null;
      const mainZone = queryMainZoneNearDockContext();
      const inRect = (zone: HTMLElement | null) => {
        if (!zone) {
          return false;
        }
        const rect = zone.getBoundingClientRect();
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        );
      };

      if (didMove && inRect(dockZone)) {
        const index = computeDockInsertIndex(event.clientY);
        window.dispatchEvent(
          new CustomEvent("tc:material-package:dock-move", {
            detail: {
              index,
              ...(dockContextId ? { contextId: dockContextId } : {}),
            },
          }),
        );
        clearDockHintByIndex();
        dispatchMainDropPreview(false);
        return;
      }

      clearDockHintByIndex();
      dispatchMainDropPreview(false);
      if (didMove && onPopout) {
        const rect = containerRef.current?.getBoundingClientRect?.() ?? null;
        const initialSize = rect
          ? { w: Math.round(rect.width), h: Math.round(rect.height) }
          : undefined;
        const initialPosition = {
          x: Math.max(8, event.clientX - 80),
          y: Math.max(8, event.clientY - 16),
        };
        // 拖出目录：不要求一定命中 main zone；交由调用方决定如何展示自由弹窗
        onPopout(payload, { initialPosition, initialSize });
      }
    },
    [
      clearDockHintByIndex,
      computeDockInsertIndex,
      dispatchMainDropPreview,
      dockContextId,
      onPopout,
      payload,
      queryMainZoneNearDockContext,
      queryWithinDockContext,
    ],
  );

  const initialState = useMemo(
    () => resolveInitialPreviewState(payload),
    [payload],
  );
  const [folderPath, setFolderPath] = useState<string[]>(
    () => initialState.folderPath,
  );
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(() => {
    if (initialState.selectedMaterialName)
      return { type: "material", name: initialState.selectedMaterialName };
    return null;
  });
  const [inlineEdit, setInlineEdit] = useState<InlineEditState>(null);
  const inlineEditRef = useRef<HTMLInputElement | null>(null);
  const [keyword, setKeyword] = useState("");
  const [viewMode, setViewMode] = useState<"icon" | "list">("icon");
  const [thumbSize, setThumbSize] = useState(136);
  const listThumbBox = useMemo(() => {
    // Keep this in sync with the range slider: make list preview react to thumbSize as well.
    // Use a common image aspect ratio (16:9) for thumbnails.
    const w = clamp(Math.round(thumbSize * 1.05), 128, 192);
    const h = clamp(Math.round((w * 9) / 16), 72, 120);
    return { w, h };
  }, [thumbSize]);
  const defaultUseBackend = !(import.meta.env.MODE === "test");
  const [useBackend] = useLocalStorage<boolean>(
    "tc:material-package:use-backend",
    defaultUseBackend,
  );
  const scope = payload.scope === "space" ? "space" : "global";
  const activeSpaceId =
    scope === "space" && isValidId(payload.spaceId) ? payload.spaceId : null;
  const [selectedPackageId, setSelectedPackageId] = useState<number>(
    () => payload.packageId,
  );
  const lastClickRef = useRef<{ key: string; timeMs: number } | null>(null);
  const inlineClickRef = useRef<{ key: string; timeMs: number } | null>(null);

  const dockZoneSelector = "[data-role='material-package-dock-zone']";
  const buildDockPayload = useCallback((): MaterialPreviewPayload => {
    const scopePayload =
      scope === "space" && isValidId(activeSpaceId)
        ? { scope: "space" as const, spaceId: activeSpaceId }
        : {};
    const pathTokens = folderPath.map((p) => `folder:${p}`);
    if (selectedItem?.type === "material")
      return {
        ...scopePayload,
        kind: "material",
        packageId: selectedPackageId,
        label: selectedItem.name,
        path: [...pathTokens, `material:${selectedItem.name}`],
      };
    if (folderPath.length)
      return {
        ...scopePayload,
        kind: "folder",
        packageId: selectedPackageId,
        label: folderPath[folderPath.length - 1]!,
        path: pathTokens,
      };
    return {
      ...scopePayload,
      kind: "package",
      packageId: selectedPackageId,
      label: title,
      path: [],
    };
  }, [
    activeSpaceId,
    folderPath,
    scope,
    selectedItem?.name,
    selectedItem?.type,
    selectedPackageId,
    title,
  ]);

  const dispatchDockHint = useCallback(
    (args: { clientX: number; clientY: number }) => {
      const detectedContextId = detectDockContextIdAtPoint(
        args.clientX,
        args.clientY,
      );
      const prev = hoverDockContextIdRef.current;
      hoverDockContextIdRef.current = detectedContextId;
      if (!detectedContextId) {
        if (prev) {
          window.dispatchEvent(
            new CustomEvent("tc:material-package:dock-hint", {
              detail: { visible: false, contextId: prev },
            }),
          );
        }
        return;
      }

      const root = getDockContextRootById(detectedContextId);
      const zone = (root as any).matches?.(dockZoneSelector)
        ? (root as HTMLElement)
        : ((root as any).querySelector?.(
            dockZoneSelector,
          ) as HTMLElement | null);
      if (!zone) return;
      const rect = zone.getBoundingClientRect();
      const isInside =
        args.clientX >= rect.left &&
        args.clientX <= rect.right &&
        args.clientY >= rect.top &&
        args.clientY <= rect.bottom;
      if (!isInside) {
        window.dispatchEvent(
          new CustomEvent("tc:material-package:dock-hint", {
            detail: { visible: false, contextId: detectedContextId },
          }),
        );
        return;
      }

      const itemsRoot = (root as any).querySelector?.(
        "[data-role='material-package-tree-items']",
      ) as HTMLElement | null;
      const rows = itemsRoot
        ? Array.from(
            itemsRoot.querySelectorAll<HTMLElement>(
              "[data-role='material-package-visible-row'][data-base-index]",
            ),
          )
        : [];
      const baseCount = rows.length;
      const index = computeDockInsertIndexInContext(
        detectedContextId,
        args.clientY,
      );
      const baseText =
        index <= 0
          ? "插入到顶部"
          : index >= baseCount
            ? "插入到底部"
            : "插入到这里";
      window.dispatchEvent(
        new CustomEvent("tc:material-package:dock-hint", {
          detail: {
            visible: true,
            index,
            text: `${baseText}（${index}/${baseCount}）`,
            contextId: detectedContextId,
          },
        }),
      );
    },
    [
      computeDockInsertIndexInContext,
      detectDockContextIdAtPoint,
      getDockContextRootById,
    ],
  );

  useEffect(() => {
    setSelectedPackageId(payload.packageId);
    setFolderPath(initialState.folderPath);
    setSelectedItem(
      initialState.selectedMaterialName
        ? { type: "material", name: initialState.selectedMaterialName }
        : null,
    );
    setKeyword("");
  }, [
    initialState.folderPath,
    initialState.selectedMaterialName,
    payload.packageId,
  ]);

  const listQueryKey = useMemo(() => {
    if (scope === "space" && isValidId(activeSpaceId))
      return buildSpaceLibraryListQueryKey(activeSpaceId, useBackend);
    return buildMaterialPackageMyQueryKey(useBackend);
  }, [activeSpaceId, scope, useBackend]);

  const detailQueryKey = useMemo(() => {
    if (scope === "space")
      return buildSpaceLibraryDetailQueryKey(selectedPackageId, useBackend);
    return buildMaterialPackageDetailQueryKey(selectedPackageId, useBackend);
  }, [scope, selectedPackageId, useBackend]);

  const packagesQuery = useQuery<unknown, Error, unknown>({
    queryKey: listQueryKey,
    queryFn: async () => {
      if (scope === "space") {
        if (!isValidId(activeSpaceId))
          return [] as SpaceMaterialPackageRecord[];
        return useBackend
          ? await listSpaceMaterialPackages(activeSpaceId)
          : readSpaceMockPackages(activeSpaceId);
      }
      return useBackend ? await getMyMaterialPackages() : readMockPackages();
    },
    staleTime: 30 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const packages = useMemo(() => {
    const data = packagesQuery.data;
    if (!Array.isArray(data)) return [] as MaterialPackageRecord[];
    if (scope === "space") {
      return (data as SpaceMaterialPackageRecord[])
        .filter(Boolean)
        .map(adaptSpaceRecord);
    }
    return data.filter(Boolean) as MaterialPackageRecord[];
  }, [packagesQuery.data, scope]);

  useEffect(() => {
    if (!packages.length) return;
    const exists = packages.some(
      (p) => Number(p.packageId) === Number(selectedPackageId),
    );
    if (exists) return;
    const firstId = Number(packages[0]!.packageId);
    if (!Number.isFinite(firstId)) return;
    setSelectedPackageId(firstId);
    setFolderPath([]);
    setSelectedItem(null);
  }, [packages, selectedPackageId]);

  const backendPackageQuery = useQuery<unknown, Error, unknown>({
    enabled:
      useBackend &&
      Number.isFinite(selectedPackageId) &&
      selectedPackageId > 0 &&
      (scope !== "space" || isValidId(activeSpaceId)),
    queryKey: detailQueryKey,
    queryFn: async () =>
      scope === "space"
        ? await getSpaceMaterialPackage(selectedPackageId)
        : await getMaterialPackage(selectedPackageId),
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const activeMockPackage = useMemo(() => {
    if (useBackend) return null;
    const found = packages.find(
      (p) => Number(p.packageId) === Number(selectedPackageId),
    );
    return found ?? packages[0] ?? null;
  }, [packages, selectedPackageId, useBackend]);

  const materialPackage = useMemo(() => {
    if (useBackend) {
      if (scope === "space") {
        const raw = backendPackageQuery.data as
          | SpaceMaterialPackageRecord
          | null
          | undefined;
        return raw ? adaptSpaceRecord(raw) : null;
      }
      return (
        (backendPackageQuery.data as
          | MaterialPackageRecord
          | null
          | undefined) ?? null
      );
    }
    return activeMockPackage;
  }, [activeMockPackage, backendPackageQuery.data, scope, useBackend]);

  const rootPackageName = useMemo(() => {
    const id = Number(selectedPackageId);
    const fromList =
      packages.find((p) => Number(p.packageId) === id)?.name ?? null;
    if (fromList && fromList.trim()) return fromList;
    const fromDetail = materialPackage?.name ?? null;
    if (fromDetail && fromDetail.trim()) return fromDetail;
    return `素材包#${selectedPackageId}`;
  }, [materialPackage?.name, packages, selectedPackageId]);

  const fullPathText = useMemo(() => {
    const rest = folderPath.join(" / ");
    return rest ? `${rootPackageName} / ${rest}` : rootPackageName;
  }, [folderPath, rootPackageName]);

  const content = materialPackage?.content ?? null;

  const currentNodes = useMemo(() => {
    if (!content) return [] as MaterialNode[];
    return getFolderNodesAtPath(content, folderPath);
  }, [content, folderPath]);

  const filteredNodes = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    const nodes = currentNodes;
    if (!normalized) return nodes;
    return nodes.filter((node) => {
      const name = node.type === "folder" ? node.name : node.name;
      const note = node.type === "material" ? node.note : "";
      return (
        String(name || "")
          .toLowerCase()
          .includes(normalized) ||
        String(note || "")
          .toLowerCase()
          .includes(normalized)
      );
    });
  }, [currentNodes, keyword]);

  const visibleNodes = filteredNodes;

  const pathText = useMemo(() => {
    const pkgName = materialPackage?.name ?? `素材包#${selectedPackageId}`;
    if (!folderPath.length) return `${pkgName}`;
    return `${pkgName} / ${folderPath.join(" / ")}`;
  }, [folderPath, materialPackage?.name, selectedPackageId]);

  const totalCount = useMemo(() => visibleNodes.length, [visibleNodes.length]);
  const selectedCount = useMemo(() => (selectedItem ? 1 : 0), [selectedItem]);

  const compactList = useMemo(
    () => viewMode === "list" && shellSize.w <= 360,
    [shellSize.w, viewMode],
  );

  const selectedNode = useMemo(() => {
    if (!selectedItem) return null;
    const found =
      visibleNodes.find(
        (n) => n.type === selectedItem.type && n.name === selectedItem.name,
      ) ?? null;
    return found;
  }, [selectedItem, visibleNodes]);

  const [mpfReorderDropTarget, setMpfReorderDropTarget] = useState<{
    key: string;
    placement: "before" | "after";
  } | null>(null);
  const [mpfMoveIntoDropTargetKey, setMpfMoveIntoDropTargetKey] = useState<
    string | null
  >(null);

  const clearMpfDropTargets = useCallback(() => {
    setMpfReorderDropTarget(null);
    setMpfMoveIntoDropTargetKey(null);
  }, []);

  const annoAnchorRef = useRef<HTMLElement | null>(null);
  const annoTipRef = useRef<HTMLDivElement | null>(null);
  const [annoOpen, setAnnoOpen] = useState(false);
  const [annoPos, setAnnoPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [annoTarget, setAnnoTarget] = useState<{
    folderPath: string[];
    materialName: string;
    messageCount: number;
  } | null>(null);
  const [annoDraft, setAnnoDraft] = useState<string[]>([]);
  const [annoInput, setAnnoInput] = useState("");
  const [annoApplyAll, setAnnoApplyAll] = useState(true);

  const closeAnnoEditor = useCallback(() => {
    setAnnoOpen(false);
    setAnnoPos(null);
    setAnnoTarget(null);
    setAnnoInput("");
  }, []);

  const openAnnoEditor = useCallback(
    (anchor: HTMLElement, node: MaterialNode | null) => {
      if (!node || node.type !== "material") return;
      annoAnchorRef.current = anchor;
      // Pre-position to the anchor to avoid an initial flash at (0, 0) before layout measurement.
      const anchorRect = anchor.getBoundingClientRect();
      setAnnoPos({ left: anchorRect.left, top: anchorRect.bottom + 8 });
      setAnnoTarget({
        folderPath: [...folderPath],
        materialName: node.name,
        messageCount: node.messages?.length ?? 0,
      });
      setAnnoDraft(getMaterialAnnotations(node));
      setAnnoApplyAll(true);
      setAnnoInput("");
      setAnnoOpen(true);
    },
    [folderPath],
  );

  useLayoutEffect(() => {
    if (!annoOpen) return;
    const anchor = annoAnchorRef.current;
    const tip = annoTipRef.current;
    if (!anchor || !tip) return;
    const compute = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const clampPos = (value: number, min: number, max: number) =>
        Math.max(min, Math.min(max, value));
      let left = anchorRect.left;
      let top = anchorRect.bottom + 8;
      if (left + tipRect.width > viewportW - 8) {
        left = viewportW - 8 - tipRect.width;
      }
      if (top + tipRect.height > viewportH - 8) {
        top = anchorRect.top - 8 - tipRect.height;
      }
      left = clampPos(left, 8, viewportW - tipRect.width - 8);
      top = clampPos(top, 8, viewportH - tipRect.height - 8);
      setAnnoPos({ left, top });
    };
    const id = window.requestAnimationFrame(compute);
    return () => window.cancelAnimationFrame(id);
  }, [annoOpen, annoDraft.length]);

  useEffect(() => {
    if (!annoOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeAnnoEditor();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const tip = annoTipRef.current;
      const anchor = annoAnchorRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if (tip && tip.contains(target)) return;
      if (anchor && anchor.contains(target)) return;
      closeAnnoEditor();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [annoOpen, closeAnnoEditor]);

  const addAnnoTag = useCallback((tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    setAnnoDraft((prev) => {
      if (prev.includes(trimmed)) return prev;
      return [...prev, trimmed];
    });
  }, []);

  const removeAnnoTag = useCallback((tag: string) => {
    setAnnoDraft((prev) => prev.filter((t) => t !== tag));
  }, []);

  const iconControlClass =
    "h-6 w-[26px] inline-flex items-center justify-center rounded-none text-[color:var(--tc-mpf-icon)] hover:text-[color:var(--tc-mpf-icon-hover)] active:opacity-90 transition focus:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--tc-mpf-accent)]";
  const iconDangerControlClass =
    "h-6 w-[26px] inline-flex items-center justify-center rounded-none text-[color:var(--tc-mpf-danger)] hover:text-[color:var(--tc-mpf-danger-hover)] active:opacity-90 transition focus:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--tc-mpf-danger-ring)]";

  const saveMockRecord = useCallback(
    (nextRecord: MaterialPackageRecord) => {
      const now = nowIso();

      if (scope === "space") {
        if (!isValidId(activeSpaceId)) return;
        const base = Array.isArray(queryClient.getQueryData(listQueryKey))
          ? (queryClient.getQueryData(
              listQueryKey,
            ) as SpaceMaterialPackageRecord[])
          : readSpaceMockPackages(activeSpaceId);
        const nextList = (base ?? []).map((p) => {
          if (Number(p.spacePackageId) !== Number(nextRecord.packageId))
            return p;
          return {
            ...p,
            name: nextRecord.name,
            description: nextRecord.description ?? "",
            coverUrl: nextRecord.coverUrl ?? null,
            status: nextRecord.status,
            content: nextRecord.content,
            updateTime: now,
          };
        });
        writeSpaceMockPackages(activeSpaceId, nextList);
        queryClient.setQueryData(listQueryKey, nextList);
        const detail =
          nextList.find(
            (p) => Number(p.spacePackageId) === Number(nextRecord.packageId),
          ) ?? null;
        if (detail) {
          queryClient.setQueryData(detailQueryKey, detail);
        }
        queryClient.invalidateQueries({
          queryKey: buildSpaceLibraryListQueryKey(activeSpaceId, false),
        });
        queryClient.invalidateQueries({
          queryKey: buildSpaceLibraryDetailQueryKey(
            Number(nextRecord.packageId),
            false,
          ),
        });
        return;
      }

      const base = Array.isArray(queryClient.getQueryData(listQueryKey))
        ? (queryClient.getQueryData(listQueryKey) as MaterialPackageRecord[])
        : readMockPackages();
      const nextList = (base ?? []).map((p) =>
        Number(p.packageId) === Number(nextRecord.packageId)
          ? { ...nextRecord, updateTime: now }
          : p,
      );
      writeMockPackages(nextList);
      queryClient.setQueryData(listQueryKey, nextList);
      queryClient.setQueryData(detailQueryKey, {
        ...nextRecord,
        updateTime: now,
      });
    },
    [activeSpaceId, detailQueryKey, listQueryKey, queryClient, scope],
  );

  const saveContent = useCallback(
    async (nextContent: MaterialPackageContent) => {
      if (!materialPackage) return;
      if (useBackend) {
        if (scope === "space") {
          const updated = await updateSpaceMaterialPackage({
            spacePackageId: selectedPackageId,
            content: nextContent,
          });
          // Some backends may not echo back the full updated `content`.
          // Ensure preview UI reflects the reorder immediately.
          const mergedUpdated = mergeSpaceMaterialPackageRecordContent(
            updated as SpaceMaterialPackageRecord,
            nextContent,
          );
          queryClient.setQueryData(detailQueryKey, mergedUpdated);
          queryClient.setQueryData(listQueryKey, (prev) => {
            if (!Array.isArray(prev)) return prev;
            const list = prev as SpaceMaterialPackageRecord[];
            return list.map((p) =>
              Number(p.spacePackageId) === Number(mergedUpdated.spacePackageId)
                ? mergedUpdated
                : p,
            );
          });
          if (isValidId(activeSpaceId)) {
            queryClient.invalidateQueries({
              queryKey: buildSpaceLibraryListQueryKey(activeSpaceId, true),
            });
            queryClient.invalidateQueries({
              queryKey: buildSpaceLibraryDetailQueryKey(
                selectedPackageId,
                true,
              ),
            });
          }
          return;
        }

        const updated = await updateMaterialPackage({
          packageId: selectedPackageId,
          content: nextContent,
        });
        // Some backends may not echo back the full updated `content`.
        // Ensure preview UI reflects the reorder immediately.
        const mergedUpdated = mergeMaterialPackageRecordContent(
          updated as MaterialPackageRecord,
          nextContent,
        );
        queryClient.setQueryData(detailQueryKey, mergedUpdated);
        queryClient.setQueryData(listQueryKey, (prev) => {
          if (!Array.isArray(prev)) return prev;
          const list = prev as MaterialPackageRecord[];
          return list.map((p) =>
            Number(p.packageId) === Number(mergedUpdated.packageId)
              ? mergedUpdated
              : p,
          );
        });
        return;
      }
      saveMockRecord({
        ...materialPackage,
        content: nextContent,
        updateTime: new Date().toISOString(),
      });
    },
    [
      activeSpaceId,
      detailQueryKey,
      listQueryKey,
      materialPackage,
      queryClient,
      saveMockRecord,
      scope,
      selectedPackageId,
      useBackend,
    ],
  );

  const ensureContent = useCallback(() => {
    if (!materialPackage || !content) throw new Error("素材包未加载完成");
    return content;
  }, [content, materialPackage]);

  const applyPreviewNodeDrop = useCallback(
    async (args: {
      source: MpfNodeDragPayload;
      target: { kind: "folder" | "material"; name: string };
      intent: "reorderBefore" | "reorderAfter" | "moveInto";
    }) => {
      const source = args.source;
      const target = args.target;
      const intent = args.intent;
      if (Number(source.packageId) !== Number(selectedPackageId)) return;
      if (!folderPathEqual(source.folderPath, folderPath)) return;

      if (intent === "moveInto") {
        if (target.kind !== "folder") return;
        if (source.kind === "folder" && source.name === target.name) return;

        const destFolderPath = [...folderPath, target.name];
        const destNodes = getFolderNodesAtPath(ensureContent(), destFolderPath);
        const usedNames = destNodes.map((n) => n.name);
        const nextName = usedNames.includes(source.name)
          ? autoRenameVsCodeLike(source.name, usedNames)
          : "";
        const nextContent = draftMoveNode(
          ensureContent(),
          {
            parentPath: folderPath,
            source: { type: source.kind, name: source.name },
            nextName: nextName || undefined,
          },
          { folderPath: destFolderPath },
        );
        setSelectedItem(null);
        await saveContent(nextContent);
        return;
      }

      if (source.kind === target.kind && source.name === target.name) return;

      const siblings = getFolderNodesAtPath(ensureContent(), folderPath);
      const targetIndex = siblings.findIndex(
        (n) => n.type === target.kind && n.name === target.name,
      );
      if (targetIndex < 0) return;

      const insertBefore =
        intent === "reorderBefore"
          ? { type: target.kind, name: target.name }
          : (() => {
              const next = siblings[targetIndex + 1] ?? null;
              if (!next) return null;
              return { type: next.type, name: next.name };
            })();

      const nextContent = draftReorderNode(
        ensureContent(),
        folderPath,
        { type: source.kind, name: source.name },
        { insertBefore },
      );
      await saveContent(nextContent);
    },
    [ensureContent, folderPath, saveContent, selectedPackageId],
  );

  const applyPreviewNodeDropSafely = useCallback(
    async (args: {
      source: MpfNodeDragPayload;
      target: { kind: "folder" | "material"; name: string };
      intent: "reorderBefore" | "reorderAfter" | "moveInto";
    }) => {
      try {
        await applyPreviewNodeDrop(args);
      } catch (error) {
        console.error(
          "[MaterialPreviewFloat] applyPreviewNodeDrop failed",
          error,
        );
        const message = error instanceof Error ? error.message : "拖拽排序失败";
        toast.error(message);
      }
    },
    [applyPreviewNodeDrop],
  );

  const getMaterialNoteByName = useCallback(
    (materialName: string) => {
      const nodes = getFolderNodesAtPath(ensureContent(), folderPath);
      const found = nodes.find(
        (n) => n.type === "material" && n.name === materialName,
      ) as MaterialItemNode | undefined;
      return typeof found?.note === "string" ? found.note : "";
    },
    [ensureContent, folderPath],
  );

  const cancelInlineEdit = useCallback(() => {
    setInlineEdit(null);
  }, []);

  const commitInlineRename = useCallback(
    async (args: { type: "folder" | "material"; from: string; to: string }) => {
      const from = args.from.trim();
      const to = args.to.trim();
      if (!from || !to) return;
      if (from === to) return;

      if (args.type === "material") {
        const existingNote = getMaterialNoteByName(from);
        const next = draftRenameMaterial(
          ensureContent(),
          folderPath,
          from,
          to,
          existingNote,
        );
        setSelectedItem((prev) =>
          prev && prev.type === "material" && prev.name === from
            ? { type: "material", name: to }
            : prev,
        );
        await saveContent(next);
        return;
      }

      const next = draftRenameFolder(ensureContent(), folderPath, from, to);
      setSelectedItem((prev) =>
        prev && prev.type === "folder" && prev.name === from
          ? { type: "folder", name: to }
          : prev,
      );
      await saveContent(next);
    },
    [ensureContent, folderPath, getMaterialNoteByName, saveContent],
  );

  const commitInlineNote = useCallback(
    async (args: { materialName: string; note: string }) => {
      const name = args.materialName.trim();
      if (!name) return;
      const nextNote = args.note.trim();
      const next = draftRenameMaterial(
        ensureContent(),
        folderPath,
        name,
        name,
        nextNote,
      );
      await saveContent(next);
    },
    [ensureContent, folderPath, saveContent],
  );

  const detectInlineDoubleClick = useCallback((key: string) => {
    const nowMs = Date.now();
    const prev = inlineClickRef.current;
    inlineClickRef.current = { key, timeMs: nowMs };
    if (!prev || prev.key !== key || nowMs - prev.timeMs > 350) return false;
    inlineClickRef.current = null;
    return true;
  }, []);

  const startInlineRename = useCallback((node: MaterialNode) => {
    setInlineEdit({
      type: node.type,
      name: node.name,
      field: "name",
      value: node.name,
    });
  }, []);

  const startInlineNoteEdit = useCallback((node: MaterialNode) => {
    if (node.type !== "material") return;
    setInlineEdit({
      type: "material",
      name: node.name,
      field: "note",
      value: node.note ?? "",
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        if (!selectedNode || inlineEdit) return;
        e.preventDefault();
        startInlineRename(selectedNode);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inlineEdit, selectedNode, startInlineRename]);

  const saveAnnoEditor = useCallback(async () => {
    if (!annoTarget) return;
    const next = draftUpdateMaterialAnnotations(
      ensureContent(),
      annoTarget.folderPath,
      annoTarget.materialName,
      annoDraft,
      { applyToAllMessages: annoApplyAll },
    );
    await saveContent(next);
    closeAnnoEditor();
  }, [
    annoApplyAll,
    annoDraft,
    annoTarget,
    closeAnnoEditor,
    ensureContent,
    saveContent,
  ]);

  useEffect(() => {
    if (!inlineEdit) return;
    const t = window.setTimeout(() => {
      inlineEditRef.current?.focus();
      inlineEditRef.current?.select?.();
    }, 0);
    return () => window.clearTimeout(t);
  }, [inlineEdit]);

  const mpfThemeVars = useMpfThemeVars();

  const handleCreatePackage = useCallback(async () => {
    const name = window.prompt(
      "输入素材包名称",
      `素材箱 ${packages.length + 1}`,
    );
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    if (useBackend) {
      if (scope === "space") {
        if (!isValidId(activeSpaceId))
          throw new Error("缺少 spaceId，无法创建局内素材箱");
        const created = await createSpaceMaterialPackage({
          spaceId: activeSpaceId,
          name: trimmed,
          description: "",
          coverUrl: "",
          content: buildEmptyMaterialPackageContent(),
        });
        queryClient.setQueryData(listQueryKey, (prev) => {
          if (!Array.isArray(prev)) return [created];
          return [created, ...(prev as SpaceMaterialPackageRecord[])];
        });
        queryClient.setQueryData(
          buildSpaceLibraryDetailQueryKey(
            Number(created.spacePackageId),
            useBackend,
          ),
          created,
        );
        queryClient.invalidateQueries({
          queryKey: buildSpaceLibraryListQueryKey(activeSpaceId, true),
        });
        setSelectedPackageId(created.spacePackageId);
        setFolderPath([]);
        setSelectedItem(null);
        return;
      }

      const created = await createMaterialPackage({
        name: trimmed,
        content: buildEmptyMaterialPackageContent(),
      });
      queryClient.setQueryData(listQueryKey, (prev) => {
        if (!Array.isArray(prev)) return [created];
        return [created, ...(prev as MaterialPackageRecord[])];
      });
      queryClient.setQueryData(
        buildMaterialPackageDetailQueryKey(
          Number(created.packageId),
          useBackend,
        ),
        created,
      );
      setSelectedPackageId(created.packageId);
      setFolderPath([]);
      setSelectedItem(null);
      return;
    }

    const now = nowIso();
    if (scope === "space") {
      if (!isValidId(activeSpaceId))
        throw new Error("缺少 spaceId，无法创建局内素材箱");
      const base = Array.isArray(queryClient.getQueryData(listQueryKey))
        ? (queryClient.getQueryData(
            listQueryKey,
          ) as SpaceMaterialPackageRecord[])
        : readSpaceMockPackages(activeSpaceId);
      const nextId =
        Math.max(0, ...base.map((p) => Number(p.spacePackageId) || 0)) + 1;
      const nextRecord: SpaceMaterialPackageRecord = {
        spacePackageId: nextId,
        spaceId: activeSpaceId,
        sourcePackageId: null,
        sourceUserId: null,
        importedBy: null,
        name: trimmed,
        description: "",
        coverUrl: "",
        status: 0,
        content: buildEmptyMaterialPackageContent(),
        createTime: now,
        updateTime: now,
      };
      const nextList = [nextRecord, ...base];
      writeSpaceMockPackages(activeSpaceId, nextList);
      queryClient.setQueryData(listQueryKey, nextList);
      queryClient.setQueryData(
        buildSpaceLibraryDetailQueryKey(nextId, false),
        nextRecord,
      );
      queryClient.invalidateQueries({
        queryKey: buildSpaceLibraryListQueryKey(activeSpaceId, false),
      });
      setSelectedPackageId(nextId);
      setFolderPath([]);
      setSelectedItem(null);
      return;
    }

    const base = Array.isArray(queryClient.getQueryData(listQueryKey))
      ? (queryClient.getQueryData(listQueryKey) as MaterialPackageRecord[])
      : readMockPackages();
    const maxId = Math.max(0, ...base.map((p) => Number(p.packageId) || 0));
    const nextId = maxId + 1;
    const nextRecord: MaterialPackageRecord = {
      packageId: nextId,
      userId: 0,
      name: trimmed,
      description: "",
      coverUrl: null,
      visibility: 1,
      status: 0,
      content: buildEmptyMaterialPackageContent(),
      importCount: 0,
      createTime: now,
      updateTime: now,
    };
    const nextList = [...base, nextRecord];
    writeMockPackages(nextList);
    queryClient.setQueryData(listQueryKey, nextList);
    queryClient.setQueryData(
      buildMaterialPackageDetailQueryKey(nextId, false),
      nextRecord,
    );
    setSelectedPackageId(nextId);
    setFolderPath([]);
    setSelectedItem(null);
  }, [
    activeSpaceId,
    listQueryKey,
    packages.length,
    queryClient,
    scope,
    useBackend,
  ]);

  const handleRenamePackage = useCallback(async () => {
    if (!materialPackage) return;
    const nextName = window.prompt(
      "输入素材包新名称",
      materialPackage.name ?? "",
    );
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === materialPackage.name) return;

    if (useBackend) {
      if (scope === "space") {
        const updated = await updateSpaceMaterialPackage({
          spacePackageId: selectedPackageId,
          name: trimmed,
        });
        queryClient.setQueryData(detailQueryKey, updated);
        queryClient.setQueryData(listQueryKey, (prev) => {
          if (!Array.isArray(prev)) return prev;
          const list = prev as SpaceMaterialPackageRecord[];
          return list.map((p) =>
            Number(p.spacePackageId) === Number(updated.spacePackageId)
              ? updated
              : p,
          );
        });
        if (isValidId(activeSpaceId))
          queryClient.invalidateQueries({
            queryKey: buildSpaceLibraryListQueryKey(activeSpaceId, true),
          });
        return;
      }

      const updated = await updateMaterialPackage({
        packageId: selectedPackageId,
        name: trimmed,
      });
      queryClient.setQueryData(detailQueryKey, updated);
      queryClient.setQueryData(listQueryKey, (prev) => {
        if (!Array.isArray(prev)) return prev;
        const list = prev as MaterialPackageRecord[];
        return list.map((p) =>
          Number(p.packageId) === Number(updated.packageId) ? updated : p,
        );
      });
      return;
    }
    saveMockRecord({ ...materialPackage, name: trimmed });
  }, [
    activeSpaceId,
    detailQueryKey,
    listQueryKey,
    materialPackage,
    queryClient,
    saveMockRecord,
    scope,
    selectedPackageId,
    useBackend,
  ]);

  const handleDeletePackage = useCallback(async () => {
    if (!materialPackage) return;
    const ok = window.confirm(`确认删除素材包「${materialPackage.name}」？`);
    if (!ok) return;

    if (useBackend) {
      if (scope === "space") {
        await deleteSpaceMaterialPackage(selectedPackageId);
        queryClient.setQueryData(listQueryKey, (prev) => {
          if (!Array.isArray(prev)) return prev;
          const list = prev as SpaceMaterialPackageRecord[];
          return list.filter(
            (p) => Number(p.spacePackageId) !== Number(selectedPackageId),
          );
        });
        queryClient.removeQueries({ queryKey: detailQueryKey });
        if (isValidId(activeSpaceId))
          queryClient.invalidateQueries({
            queryKey: buildSpaceLibraryListQueryKey(activeSpaceId, true),
          });
        setSelectedPackageId(0);
        setFolderPath([]);
        setSelectedItem(null);
        return;
      }

      await deleteMaterialPackage(selectedPackageId);
      queryClient.setQueryData(listQueryKey, (prev) => {
        if (!Array.isArray(prev)) return prev;
        const list = prev as MaterialPackageRecord[];
        return list.filter(
          (p) => Number(p.packageId) !== Number(selectedPackageId),
        );
      });
      queryClient.removeQueries({ queryKey: detailQueryKey });
      setSelectedPackageId(0);
      setFolderPath([]);
      setSelectedItem(null);
      return;
    }

    if (scope === "space") {
      if (!isValidId(activeSpaceId)) return;
      const base = Array.isArray(queryClient.getQueryData(listQueryKey))
        ? (queryClient.getQueryData(
            listQueryKey,
          ) as SpaceMaterialPackageRecord[])
        : readSpaceMockPackages(activeSpaceId);
      const nextList = base.filter(
        (p) => Number(p.spacePackageId) !== Number(selectedPackageId),
      );
      writeSpaceMockPackages(activeSpaceId, nextList);
      queryClient.setQueryData(listQueryKey, nextList);
      queryClient.removeQueries({ queryKey: detailQueryKey });
      queryClient.invalidateQueries({
        queryKey: buildSpaceLibraryListQueryKey(activeSpaceId, false),
      });
      setSelectedPackageId(Number(nextList[0]?.spacePackageId ?? 0));
      setFolderPath([]);
      setSelectedItem(null);
      return;
    }

    const base = Array.isArray(queryClient.getQueryData(listQueryKey))
      ? (queryClient.getQueryData(listQueryKey) as MaterialPackageRecord[])
      : readMockPackages();
    const nextList = base.filter(
      (p) => Number(p.packageId) !== Number(selectedPackageId),
    );
    const normalized = nextList.length
      ? nextList
      : [
          {
            packageId: 1,
            userId: 0,
            name: "素材箱·空白",
            description: "",
            coverUrl: null,
            visibility: 1,
            status: 0,
            content: buildEmptyMaterialPackageContent(),
            importCount: 0,
            createTime: nowIso(),
            updateTime: nowIso(),
          } satisfies MaterialPackageRecord,
        ];
    writeMockPackages(normalized);
    queryClient.setQueryData(listQueryKey, normalized);
    setSelectedPackageId(Number(normalized[0]!.packageId));
    setFolderPath([]);
    setSelectedItem(null);
  }, [
    activeSpaceId,
    detailQueryKey,
    listQueryKey,
    materialPackage,
    queryClient,
    scope,
    selectedPackageId,
    useBackend,
  ]);

  const handleCreateFolder = useCallback(async () => {
    const nextName = window.prompt("输入文件夹名称", "新文件夹");
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    setSelectedItem(null);
    const next = draftCreateFolder(ensureContent(), folderPath, trimmed);
    await saveContent(next);
  }, [ensureContent, folderPath, saveContent]);

  const handleRename = useCallback(async () => {
    if (selectedItem?.type === "material") {
      const nextName = window.prompt("输入素材新名称", selectedItem.name);
      if (nextName == null) return;
      const trimmed = nextName.trim();
      if (!trimmed) return;
      const existingNodes = getFolderNodesAtPath(ensureContent(), folderPath);
      const existingNote =
        (
          existingNodes.find(
            (n) => n.type === "material" && n.name === selectedItem.name,
          ) as any
        )?.note ?? "";
      const nextNote = window.prompt(
        "输入备注（可为空）",
        String(existingNote ?? ""),
      );
      if (nextNote == null) return;
      const next = draftRenameMaterial(
        ensureContent(),
        folderPath,
        selectedItem.name,
        trimmed,
        nextNote.trim(),
      );
      setSelectedItem({ type: "material", name: trimmed });
      await saveContent(next);
      return;
    }

    if (selectedItem?.type === "folder") {
      const nextName = window.prompt("输入文件夹新名称", selectedItem.name);
      if (nextName == null) return;
      const trimmed = nextName.trim();
      if (!trimmed) return;
      const next = draftRenameFolder(
        ensureContent(),
        folderPath,
        selectedItem.name,
        trimmed,
      );
      setSelectedItem({ type: "folder", name: trimmed });
      await saveContent(next);
      return;
    }

    if (!folderPath.length) {
      await handleRenamePackage();
      return;
    }

    const currentFolderName = folderPath[folderPath.length - 1]!;
    const nextName = window.prompt("输入文件夹新名称", currentFolderName);
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    const parentPath = folderPath.slice(0, -1);
    const next = draftRenameFolder(
      ensureContent(),
      parentPath,
      currentFolderName,
      trimmed,
    );
    setFolderPath((prev) => {
      if (!prev.length) return prev;
      const copy = prev.slice();
      copy[copy.length - 1] = trimmed;
      return copy;
    });
    await saveContent(next);
  }, [
    ensureContent,
    folderPath,
    handleRenamePackage,
    saveContent,
    selectedItem,
  ]);

  const handleDelete = useCallback(async () => {
    if (selectedItem?.type === "material") {
      const ok = window.confirm(`确认删除素材「${selectedItem.name}」？`);
      if (!ok) return;
      const next = draftDeleteMaterial(
        ensureContent(),
        folderPath,
        selectedItem.name,
      );
      setSelectedItem(null);
      await saveContent(next);
      return;
    }

    if (selectedItem?.type === "folder") {
      const ok = window.confirm(
        `确认删除文件夹「${selectedItem.name}」（包含子内容）？`,
      );
      if (!ok) return;
      const next = draftDeleteFolder(
        ensureContent(),
        folderPath,
        selectedItem.name,
      );
      setSelectedItem(null);
      await saveContent(next);
      return;
    }

    if (!folderPath.length) {
      await handleDeletePackage();
      return;
    }

    const currentFolderName = folderPath[folderPath.length - 1]!;
    const ok = window.confirm(
      `确认删除文件夹「${currentFolderName}」（包含子内容）？`,
    );
    if (!ok) return;
    const parentPath = folderPath.slice(0, -1);
    const next = draftDeleteFolder(
      ensureContent(),
      parentPath,
      currentFolderName,
    );
    setFolderPath(parentPath);
    setSelectedItem(null);
    await saveContent(next);
  }, [
    ensureContent,
    folderPath,
    handleDeletePackage,
    saveContent,
    selectedItem,
  ]);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const handleImportClick = useCallback(() => {
    const el = importInputRef.current;
    if (!el) return;
    el.value = "";
    el.click();
  }, []);

  const handleImportChange = useCallback(async () => {
    const el = importInputRef.current;
    if (!el) return;
    const files = Array.from(el.files || []);
    if (!files.length) return;

    let nextContent = ensureContent();
    for (const file of files) {
      const lower = file.name.toLowerCase();
      const isImage = /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(lower);
      const isAudio = /\.(mp3|wav|ogg|flac|m4a)$/i.test(lower);
      const isText = /\.(txt|md)$/i.test(lower);

      let messages: any[] = [];
      if (isImage) {
        messages = [
          {
            messageType: 2,
            annotations: ["图片"],
            extra: {
              imageMessage: {
                url: useBackend ? "" : URL.createObjectURL(file),
                fileName: file.name,
              },
            },
          },
        ];
      } else if (isAudio) {
        messages = [
          {
            messageType: 3,
            annotations: ["音频"],
            extra: {
              soundMessage: {
                url: useBackend ? "" : URL.createObjectURL(file),
                fileName: file.name,
              },
            },
          },
        ];
      } else if (isText) {
        const text = await file.text().catch(() => "");
        messages = [
          {
            messageType: 1,
            content: text,
            annotations: ["文本"],
            extra: {},
          },
        ];
      } else {
        messages = [
          {
            messageType: 1,
            content: file.name,
            annotations: ["文件"],
            extra: {},
          },
        ];
      }

      const material: MaterialItemNode = {
        type: "material",
        name: file.name,
        note: "",
        messages,
      };
      nextContent = draftCreateMaterial(nextContent, folderPath, material);
    }
    await saveContent(nextContent);
  }, [ensureContent, folderPath, saveContent, useBackend]);

  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const container = containerRef.current;
      const parent = container?.parentElement;
      if (!container || !parent) return;

      // 在 header 上启动 pointer capture，保证后续 move/up 都能收到
      try {
        container.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }

      event.preventDefault();
      pointerRef.current.pointerId = event.pointerId;
      pointerRef.current.startClientX = event.clientX;
      pointerRef.current.startClientY = event.clientY;

      const parentRect = parent.getBoundingClientRect();
      if (isCoverMode) {
        // Cover 模式：仅在“真的拖动”时退出 cover 并进入 drag
        pointerRef.current.mode = "coverPending";
        pointerRef.current.offsetX = event.clientX - parentRect.left - pos.x;
        pointerRef.current.offsetY = event.clientY - parentRect.top - pos.y;
        return;
      }

      pointerRef.current.mode = "drag";
      pointerRef.current.offsetX = event.clientX - parentRect.left - pos.x;
      pointerRef.current.offsetY = event.clientY - parentRect.top - pos.y;
    },
    [isCoverMode, pos.x, pos.y],
  );

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;

      try {
        container.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }

      event.preventDefault();
      if (isCoverMode) {
        // 从“覆盖模式”进入自由弹窗，但保持当前尺寸；
        // 否则按下 resize handle 会立刻触发“缩小到预设浮窗大小”，体验很突兀。
        flushSync(() => setCoverMode(false));
      }
      pointerRef.current.pointerId = event.pointerId;
      pointerRef.current.mode = "resize";
      resizeRef.current.startX = event.clientX;
      resizeRef.current.startY = event.clientY;
      const rect = containerRef.current?.getBoundingClientRect();
      resizeRef.current.startW = rect ? Math.round(rect.width) : shellSize.w;
      resizeRef.current.startH = rect ? Math.round(rect.height) : shellSize.h;
    },
    [isCoverMode, setCoverMode, shellSize.h, shellSize.w],
  );

  const onContainerPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (
        pointerRef.current.pointerId == null ||
        event.pointerId !== pointerRef.current.pointerId
      )
        return;
      const container = containerRef.current;
      const parent = container?.parentElement;
      if (!container || !parent) return;

      const mode = pointerRef.current.mode;
      if (mode === "none") return;

      if (mode === "coverPending") {
        const dx = event.clientX - pointerRef.current.startClientX;
        const dy = event.clientY - pointerRef.current.startClientY;
        if (Math.abs(dx) + Math.abs(dy) < 2) return;
        let nextPos: { x: number; y: number } | undefined;
        flushSync(() => {
          nextPos = exitCoverModeToFloating({
            clientX: event.clientX,
            clientY: event.clientY,
          });
        });
        pointerRef.current.mode = "drag";
        const parentRect = parent.getBoundingClientRect();
        pointerRef.current.offsetX =
          pointerRef.current.startClientX - parentRect.left - (nextPos?.x ?? 0);
        pointerRef.current.offsetY =
          pointerRef.current.startClientY - parentRect.top - (nextPos?.y ?? 0);
        return;
      }

      if (mode === "drag") {
        const parentRect = parent.getBoundingClientRect();
        const nextX =
          event.clientX - parentRect.left - pointerRef.current.offsetX;
        const nextY =
          event.clientY - parentRect.top - pointerRef.current.offsetY;
        const maxX = parentRect.width - container.offsetWidth;
        const maxY = parentRect.height - container.offsetHeight;
        dispatchDockHint({ clientX: event.clientX, clientY: event.clientY });
        setPos({
          x: clamp(nextX, 0, Math.max(0, maxX)),
          y: clamp(nextY, 0, Math.max(0, maxY)),
        });
        return;
      }

      if (mode === "resize") {
        const maxW = parent.clientWidth - 12;
        const maxH = parent.clientHeight - 12;
        const nextW = clamp(
          resizeRef.current.startW + (event.clientX - resizeRef.current.startX),
          360,
          Math.max(360, maxW),
        );
        const nextH = clamp(
          resizeRef.current.startH + (event.clientY - resizeRef.current.startY),
          420,
          Math.max(420, maxH),
        );
        setShellSize((prev) =>
          prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH },
        );
      }
    },
    [dispatchDockHint, exitCoverModeToFloating],
  );

  const onContainerPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (
        pointerRef.current.pointerId == null ||
        event.pointerId !== pointerRef.current.pointerId
      )
        return;
      const mode = pointerRef.current.mode;
      if (mode === "drag") {
        const detectedContextId = detectDockContextIdAtPoint(
          event.clientX,
          event.clientY,
        );
        const dockPayload = buildDockPayload();
        if (detectedContextId) {
          const index = computeDockInsertIndexInContext(
            detectedContextId,
            event.clientY,
          );
          dispatchDockRequest(detectedContextId, index, dockPayload);
          window.dispatchEvent(
            new CustomEvent("tc:material-package:dock-hint", {
              detail: { visible: false, contextId: detectedContextId },
            }),
          );
          onClose();
        } else {
          // fallback: same-context docking
          const zone = queryWithinDockContext(dockZoneSelector, {
            includeSelf: true,
          }) as HTMLElement | null;
          if (zone) {
            const rect = zone.getBoundingClientRect();
            const isInside =
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom;
            if (isInside) {
              const index = computeDockInsertIndex(event.clientY);
              onDock(dockPayload, { index });
            }
          }
          window.dispatchEvent(
            new CustomEvent("tc:material-package:dock-hint", {
              detail: {
                visible: false,
                ...(dockContextId ? { contextId: dockContextId } : {}),
              },
            }),
          );
        }
      }
      try {
        containerRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      pointerRef.current.pointerId = null;
      pointerRef.current.mode = "none";
    },
    [
      buildDockPayload,
      computeDockInsertIndex,
      computeDockInsertIndexInContext,
      detectDockContextIdAtPoint,
      dispatchDockRequest,
      dockContextId,
      onClose,
      onDock,
      queryWithinDockContext,
    ],
  );

  return (
    <div
      ref={containerRef}
      className={
        isEmbedded
          ? "tc-mpf relative flex flex-col w-full h-full rounded-md border border-[color:var(--tc-mpf-shell-border)] bg-[color:var(--tc-mpf-bg)] text-[color:var(--tc-mpf-text)] shadow-[var(--tc-mpf-shadow)] overflow-hidden"
          : "tc-mpf absolute z-[40] flex flex-col rounded-md border border-[color:var(--tc-mpf-shell-border)] bg-[color:var(--tc-mpf-bg)] text-[color:var(--tc-mpf-text)] shadow-[var(--tc-mpf-shadow)] overflow-hidden"
      }
      onPointerMove={isEmbedded ? undefined : onContainerPointerMove}
      onPointerUp={isEmbedded ? undefined : onContainerPointerUp}
      onPointerCancel={isEmbedded ? undefined : onContainerPointerUp}
      style={{
        ...mpfThemeVars,
        left: isEmbedded ? undefined : `${pos.x}px`,
        top: isEmbedded ? undefined : `${pos.y}px`,
        width: isEmbedded ? "100%" : `${shellSize.w}px`,
        height: isEmbedded ? "100%" : `${shellSize.h}px`,
      }}
    >
      {/* Tabs bar (prototype: tabs) */}
      <div
        className={`h-[34px] flex items-stretch border-b border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-surface-2)] select-none ${!isEmbedded || isDockedEmbedded ? "touch-none" : ""}`}
        onPointerDownCapture={(e) => {
          const target = e.target as HTMLElement | null;
          if (!target) return;
          if (target.closest("[data-mpf-no-drag]")) return;
          if (target.closest("button,[role='button'],a,input,select,textarea"))
            return;
          if (isDockedEmbedded) {
            onDockedHandlePointerDown(e);
            return;
          }
          if (!isEmbedded) {
            onHeaderPointerDown(e);
          }
        }}
        onPointerMoveCapture={
          isDockedEmbedded ? onDockedHandlePointerMove : undefined
        }
        onPointerUpCapture={
          isDockedEmbedded ? onDockedHandlePointerUp : undefined
        }
        onPointerCancelCapture={
          isDockedEmbedded ? onDockedHandlePointerUp : undefined
        }
        role="presentation"
      >
        <div
          className="flex items-stretch flex-1 min-w-0"
          title={
            isDockedEmbedded
              ? "按住任意空白处拖拽：目录内可任意插入，拖到右侧可脱离目录"
              : "拖动窗口"
          }
        >
          <div className="flex items-center gap-2 px-3 flex-1 min-w-0 text-[13px] font-normal text-[color:var(--tc-mpf-text)] bg-[color:var(--tc-mpf-surface)] cursor-move">
            <PackageIcon className="size-4 shrink-0 opacity-80" weight="bold" />
            <PortalTooltip label={fullPathText} placement="bottom">
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                <button
                  type="button"
                  className="min-w-0 shrink truncate hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFolderPath([]);
                    setSelectedItem(null);
                  }}
                  data-mpf-no-drag="1"
                  title="回到根目录"
                >
                  {rootPackageName}
                </button>
                {folderPath.length > 0 && (
                  <span className="shrink-0 opacity-70">/</span>
                )}
                {(() => {
                  if (!folderPath.length) {
                    return null;
                  }
                  const MAX_TAIL = 3;
                  const tailStart = Math.max(0, folderPath.length - MAX_TAIL);
                  const hiddenCount = tailStart;
                  const tail = folderPath.slice(tailStart);
                  return (
                    <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-hidden">
                      {hiddenCount > 0 && (
                        <>
                          <span className="shrink-0 opacity-70">…</span>
                          <span className="shrink-0 opacity-70">/</span>
                        </>
                      )}
                      {tail.map((name, idx) => {
                        const originalIndex = tailStart + idx;
                        const targetPath = folderPath.slice(
                          0,
                          originalIndex + 1,
                        );
                        const isLast = idx === tail.length - 1;
                        return (
                          <React.Fragment key={`${originalIndex}:${name}`}>
                            <button
                              type="button"
                              className={
                                isLast
                                  ? "min-w-0 max-w-full overflow-hidden truncate text-left hover:underline"
                                  : "shrink-0 whitespace-nowrap hover:underline"
                              }
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setFolderPath(targetPath);
                                setSelectedItem(null);
                              }}
                              data-mpf-no-drag="1"
                              title={name}
                            >
                              {name}
                            </button>
                            {!isLast && (
                              <span className="shrink-0 opacity-70">/</span>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </PortalTooltip>
          </div>
        </div>
        <div
          className="flex items-center gap-2 pr-2 bg-[color:var(--tc-mpf-surface)]"
          data-mpf-no-drag="1"
        >
          {inlineEdit && (
            <div className="mr-1 text-[11px] text-[color:var(--tc-mpf-muted)] select-none">
              编辑中…
            </div>
          )}
          <button
            type="button"
            className={iconControlClass}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDock(buildDockPayload(), { placement: "top" });
            }}
            title="插入到目录顶端"
            aria-label="插入到目录顶端"
          >
            <ArrowLineUpIcon className="size-4 opacity-80" />
          </button>
          <button
            type="button"
            className={iconControlClass}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDock(buildDockPayload(), { placement: "bottom" });
            }}
            title="插入到目录底部"
            aria-label="插入到目录底部"
          >
            <ArrowLineDownIcon className="size-4 opacity-80" />
          </button>
          {!isEmbedded && (
            <button
              type="button"
              className={iconControlClass}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCoverMode(true);
                syncCoverToParent();
              }}
              title="最大化"
              aria-label="最大化"
            >
              <SquareIcon className="size-4 opacity-80" />
            </button>
          )}
          {isEmbedded && onPopout && (
            <button
              type="button"
              className={iconControlClass}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPopout(buildDockPayload());
              }}
              title="弹出为自由浮窗"
              aria-label="弹出为自由浮窗"
            >
              <ArrowSquareOutIcon className="size-4 opacity-80" />
            </button>
          )}
          <button
            type="button"
            className={iconControlClass}
            aria-label="关闭预览"
            onClick={() => onClose()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <XMarkICon className="size-4 opacity-80" />
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2 px-[10px] py-[8px] border-b border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-toolbar)]">
        <button
          type="button"
          className="h-6 w-[26px] inline-flex items-center justify-center rounded-none border border-[color:var(--tc-mpf-border-strong)] bg-[color:var(--tc-mpf-surface-2)] text-[color:var(--tc-mpf-text)] hover:bg-[color:var(--tc-mpf-surface-3)] active:opacity-90 transition disabled:opacity-40"
          disabled={!folderPath.length}
          onClick={() => {
            setFolderPath((prev) => (prev.length ? prev.slice(0, -1) : prev));
            setSelectedItem(null);
          }}
          aria-label="返回上一级"
          title="返回上一级"
          data-mpf-no-drag="1"
        >
          <ChevronDown className="-rotate-90 size-4 opacity-80" />
        </button>

        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索素材…"
          className="flex-1 min-w-0 h-6 rounded-none border border-[color:var(--tc-mpf-border-strong)] bg-[color:var(--tc-mpf-input-bg)] px-2 text-[12px] text-[color:var(--tc-mpf-text)] placeholder:text-[color:var(--tc-mpf-muted)] focus:outline-none focus:border-[color:var(--tc-mpf-accent)]"
          data-mpf-no-drag="1"
        />

        <select
          value={String(selectedPackageId)}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (!Number.isFinite(id)) return;
            setSelectedPackageId(id);
            setFolderPath([]);
            setSelectedItem(null);
            setKeyword("");
          }}
          className="h-6 w-[140px] max-w-[40%] rounded-none border border-[color:var(--tc-mpf-border-strong)] bg-[color:var(--tc-mpf-input-bg)] px-2 text-[12px] text-[color:var(--tc-mpf-text)] focus:outline-none focus:border-[color:var(--tc-mpf-accent)]"
          aria-label="选择素材包"
          title="选择素材包"
          data-mpf-no-drag="1"
        >
          {packages.map((p) => (
            <option key={p.packageId} value={String(p.packageId)}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Assets panel */}
      <div className="min-h-0 flex-1 overflow-auto bg-[color:var(--tc-mpf-toolbar)] border-y border-[color:var(--tc-mpf-border)]">
        <div className="p-[12px]">
          {useBackend && backendPackageQuery.isError && (
            <div className="text-xs text-error">
              {backendPackageQuery.error instanceof Error
                ? backendPackageQuery.error.message
                : "加载素材包失败"}
            </div>
          )}

          {!useBackend && packagesQuery.isLoading && (
            <div className="text-xs opacity-70">正在加载素材包…</div>
          )}

          {!useBackend && packagesQuery.isError && (
            <div className="text-xs text-error">
              {packagesQuery.error instanceof Error
                ? packagesQuery.error.message
                : "加载素材包失败"}
            </div>
          )}

          {!content && <div className="text-xs opacity-60">暂无素材包内容</div>}

          {content && viewMode === "icon" && (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(96, thumbSize)}px, 1fr))`,
              }}
            >
              {visibleNodes.map((node, nodeIndex) => {
                const isFolder = node.type === "folder";
                const name = node.name;
                const isSelected = Boolean(
                  selectedItem &&
                  selectedItem.type === node.type &&
                  selectedItem.name === name,
                );
                const hintText = isFolder
                  ? "文件夹"
                  : node.note?.trim()
                    ? node.note
                    : "素材";
                const subtitle = isFolder
                  ? `文件夹 · ${node.children?.length ?? 0}项`
                  : hintText;
                const key = `${node.type}:${name}`;
                const reactKey = `${node.type}:${folderPath.join("/")}:${name}:${nodeIndex}`;
                const isReorderTarget = mpfReorderDropTarget?.key === key;
                const reorderPlacement = isReorderTarget
                  ? mpfReorderDropTarget?.placement
                  : null;
                const isMoveIntoTarget = mpfMoveIntoDropTargetKey === key;
                const thumbUrl = isFolder ? null : getMaterialThumbUrl(node);
                const unuploadedHint =
                  useBackend && !isFolder
                    ? getMaterialUnuploadedHint(node)
                    : null;
                const annotations = isFolder
                  ? []
                  : getMaterialAnnotations(node);
                const displayChips = annotations.slice(0, 3);
                const moreCount = Math.max(
                  0,
                  annotations.length - displayChips.length,
                );

                return (
                  <div
                    key={reactKey}
                    className={`relative border transition-colors overflow-hidden cursor-pointer ${
                      isSelected
                        ? "border-[color:var(--tc-mpf-accent)] bg-[color:var(--tc-mpf-surface-2)]"
                        : "border-[color:var(--tc-mpf-item-border)] bg-[color:var(--tc-mpf-surface)] hover:bg-[color:var(--tc-mpf-surface-3)]"
                    } ${isMoveIntoTarget ? "ring-1 ring-[color:var(--tc-mpf-accent)]" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      if (isInlineClickTarget(e.target)) {
                        e.preventDefault();
                        return;
                      }
                      activeMpfNodeDrag = null;
                      e.dataTransfer.effectAllowed = "copyMove";

                      const materialPreviewPayload: MaterialPreviewPayload = {
                        ...(payload.scope ? { scope: payload.scope } : {}),
                        ...(typeof payload.spaceId === "number" &&
                        payload.spaceId > 0
                          ? { spaceId: payload.spaceId }
                          : {}),
                        kind: node.type,
                        packageId: selectedPackageId,
                        label: name,
                        path: [
                          ...folderPath.map((n) => `folder:${n}`),
                          node.type === "folder"
                            ? `folder:${name}`
                            : `material:${name}`,
                        ],
                      };
                      setMaterialPreviewDragData(
                        e.dataTransfer,
                        materialPreviewPayload,
                      );
                      setMaterialPreviewDragOrigin(
                        e.dataTransfer,
                        dragOrigin === "docked" ? "docked" : "tree",
                      );
                      setMpfNodeDragData(e.dataTransfer, {
                        packageId: selectedPackageId,
                        folderPath: [...folderPath],
                        kind: node.type,
                        name,
                        materialPreview: materialPreviewPayload,
                      });
                      clearMpfDropTargets();
                    }}
                    onDragOver={(e) => {
                      const source = getMpfNodeDragData(e.dataTransfer);
                      if (!source) return;
                      if (
                        Number(source.packageId) !== Number(selectedPackageId)
                      )
                        return;
                      if (!folderPathEqual(source.folderPath, folderPath))
                        return;

                      const rect = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      const intent = computeMpfDropIntent({
                        viewMode: "icon",
                        targetKind: node.type,
                        targetRect: rect,
                        clientX: e.clientX,
                        clientY: e.clientY,
                      });
                      if (intent === "none") {
                        if (
                          mpfReorderDropTarget?.key === key ||
                          mpfMoveIntoDropTargetKey === key
                        ) {
                          clearMpfDropTargets();
                        }
                        return;
                      }
                      if (intent === "moveInto") {
                        if (node.type !== "folder") return;
                        if (source.kind === "folder" && source.name === name)
                          return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        setMpfMoveIntoDropTargetKey(key);
                        setMpfReorderDropTarget(null);
                        return;
                      }

                      if (source.kind === node.type && source.name === name)
                        return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      setMpfReorderDropTarget({
                        key,
                        placement:
                          intent === "reorderAfter" ? "after" : "before",
                      });
                      setMpfMoveIntoDropTargetKey(null);
                    }}
                    onDragLeave={(e) => {
                      const related = e.relatedTarget as HTMLElement | null;
                      if (
                        related &&
                        (e.currentTarget as HTMLElement).contains(related)
                      )
                        return;
                      if (mpfReorderDropTarget?.key === key) {
                        setMpfReorderDropTarget(null);
                      }
                      if (mpfMoveIntoDropTargetKey === key) {
                        setMpfMoveIntoDropTargetKey(null);
                      }
                    }}
                    onDrop={(e) => {
                      const source = getMpfNodeDragData(e.dataTransfer);
                      if (!source) return;
                      if (
                        Number(source.packageId) !== Number(selectedPackageId)
                      )
                        return;
                      if (!folderPathEqual(source.folderPath, folderPath))
                        return;
                      const rect = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      const intent = computeMpfDropIntent({
                        viewMode: "icon",
                        targetKind: node.type,
                        targetRect: rect,
                        clientX: e.clientX,
                        clientY: e.clientY,
                      });
                      if (intent === "none") return;
                      e.preventDefault();
                      e.stopPropagation();
                      clearMpfDropTargets();
                      activeMpfNodeDrag = null;
                      void applyPreviewNodeDropSafely({
                        source,
                        target: { kind: node.type, name },
                        intent,
                      });
                    }}
                    onDragEnd={() => {
                      clearMpfDropTargets();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedItem({ type: node.type, name });
                      if (isInlineClickTarget(e.target)) {
                        lastClickRef.current = null;
                        return;
                      }
                      const nowMs = Date.now();
                      const prev = lastClickRef.current;
                      lastClickRef.current = { key, timeMs: nowMs };
                      if (
                        !prev ||
                        prev.key !== key ||
                        nowMs - prev.timeMs > 350
                      )
                        return;
                      lastClickRef.current = null;
                      if (isFolder) {
                        setFolderPath((prevPath) => [...prevPath, name]);
                        setSelectedItem(null);
                      }
                    }}
                  >
                    {isReorderTarget && reorderPlacement === "before" && (
                      <div className="pointer-events-none absolute left-0 top-2 bottom-2 w-[2px] bg-[color:var(--tc-mpf-accent)] rounded" />
                    )}
                    {isReorderTarget && reorderPlacement === "after" && (
                      <div className="pointer-events-none absolute right-0 top-2 bottom-2 w-[2px] bg-[color:var(--tc-mpf-accent)] rounded" />
                    )}
                    <div
                      className="relative flex items-center justify-center overflow-hidden bg-gradient-to-b from-[color:var(--tc-mpf-surface-2)] to-[color:var(--tc-mpf-surface)] border-b border-[color:var(--tc-mpf-border)]"
                      style={{
                        height: `${Math.max(64, Math.round(thumbSize * 0.62))}px`,
                      }}
                    >
                      {thumbUrl && (
                        <div className="absolute inset-0">
                          <img
                            src={thumbUrl}
                            alt={name}
                            className="absolute inset-0 w-full h-full object-cover opacity-95"
                            loading="lazy"
                            draggable={false}
                          />
                          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/0 to-black/10" />
                        </div>
                      )}
                      {isFolder && (
                        <FolderIcon className="size-10 opacity-70" />
                      )}
                      {!isFolder && !thumbUrl && (
                        <FileImageIcon className="size-10 opacity-70" />
                      )}
                      {!isFolder && !thumbUrl && unuploadedHint && (
                        <div
                          className="absolute bottom-1 left-1 right-1 text-center text-[10px] px-1 py-0.5 rounded border border-[color:var(--tc-mpf-item-border)] bg-[color:var(--tc-mpf-surface-2)] text-[color:var(--tc-mpf-text)]/80 backdrop-blur-sm truncate"
                          title={unuploadedHint}
                        >
                          {unuploadedHint}
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      {inlineEdit &&
                      inlineEdit.field === "name" &&
                      inlineEdit.type === node.type &&
                      inlineEdit.name === name ? (
                        <div data-mpf-inline="1">
                          <input
                            ref={inlineEditRef}
                            value={inlineEdit.value}
                            onChange={(e) =>
                              setInlineEdit((prev) =>
                                prev
                                  ? { ...prev, value: e.target.value }
                                  : prev,
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelInlineEdit();
                              }
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const from = inlineEdit.name;
                                const to = inlineEdit.value;
                                cancelInlineEdit();
                                void commitInlineRename({
                                  type: node.type,
                                  from,
                                  to,
                                });
                              }
                            }}
                            onBlur={() => {
                              const from = inlineEdit.name;
                              const to = inlineEdit.value;
                              cancelInlineEdit();
                              void commitInlineRename({
                                type: node.type,
                                from,
                                to,
                              });
                            }}
                            className="w-full h-7 rounded-none border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-input-bg)] px-2 text-[12px] font-semibold text-[color:var(--tc-mpf-text)] focus:outline-none focus:border-[color:var(--tc-mpf-accent)]"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      ) : (
                        <div
                          data-mpf-inline="1"
                          className="text-[12px] font-semibold text-[color:var(--tc-mpf-text)] truncate"
                          title={name}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedItem({ type: node.type, name });
                            if (inlineEdit) return;
                            if (node.type !== "material") return;
                            if (
                              !detectInlineDoubleClick(
                                `name:${node.type}:${name}`,
                              )
                            )
                              return;
                            startInlineRename(node);
                          }}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            startInlineRename(node);
                          }}
                        >
                          {name}
                        </div>
                      )}
                      {isFolder ? (
                        <div
                          className="text-[11px] text-[color:var(--tc-mpf-muted)] mt-1 truncate"
                          title={subtitle}
                        >
                          {subtitle}
                        </div>
                      ) : (
                        <>
                          <div
                            className="mt-1 flex flex-wrap gap-1 min-h-[18px]"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openAnnoEditor(
                                e.currentTarget as HTMLElement,
                                node,
                              );
                            }}
                            title="点击编辑标签"
                          >
                            {displayChips.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center rounded-sm border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-surface-2)] px-1.5 py-[1px] text-[11px] text-[color:var(--tc-mpf-text)] opacity-95"
                                title={tag}
                              >
                                {tag}
                              </span>
                            ))}
                            {moreCount > 0 && (
                              <span
                                className="inline-flex items-center rounded-sm border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-surface-2)] px-1.5 py-[1px] text-[11px] text-[color:var(--tc-mpf-muted)]"
                                title={annotations.join(" / ")}
                              >
                                +{moreCount}
                              </span>
                            )}
                            {annotations.length === 0 && (
                              <span className="inline-flex items-center rounded-sm border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-surface-2)] px-1.5 py-[1px] text-[11px] text-[color:var(--tc-mpf-muted)]">
                                {getNodeBaseType(node)}
                              </span>
                            )}
                          </div>

                          {inlineEdit &&
                          inlineEdit.field === "note" &&
                          inlineEdit.type === "material" &&
                          inlineEdit.name === name ? (
                            <div className="mt-1" data-mpf-inline="1">
                              <input
                                ref={inlineEditRef}
                                value={inlineEdit.value}
                                onChange={(e) =>
                                  setInlineEdit((prev) =>
                                    prev
                                      ? { ...prev, value: e.target.value }
                                      : prev,
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelInlineEdit();
                                  }
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const materialName = inlineEdit.name;
                                    const note = inlineEdit.value;
                                    cancelInlineEdit();
                                    void commitInlineNote({
                                      materialName,
                                      note,
                                    });
                                  }
                                }}
                                onBlur={() => {
                                  const materialName = inlineEdit.name;
                                  const note = inlineEdit.value;
                                  cancelInlineEdit();
                                  void commitInlineNote({ materialName, note });
                                }}
                                className="w-full h-7 rounded-none border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-input-bg)] px-2 text-[11px] text-[color:var(--tc-mpf-text)] focus:outline-none focus:border-[color:var(--tc-mpf-accent)]"
                                placeholder="添加备注…"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          ) : (
                            <div
                              data-mpf-inline="1"
                              className="mt-1 text-[11px] text-[color:var(--tc-mpf-muted)] truncate"
                              title={(node.note ?? "").trim()}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedItem({ type: node.type, name });
                                if (inlineEdit) return;
                                if (node.type !== "material") return;
                                if (!detectInlineDoubleClick(`note:${name}`))
                                  return;
                                startInlineNoteEdit(node);
                              }}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                startInlineNoteEdit(node);
                              }}
                            >
                              {(node.note ?? "").trim()
                                ? (node.note ?? "").trim()
                                : "（无备注）"}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {content && viewMode === "list" && (
            <div className="border border-[color:var(--tc-mpf-item-border)] overflow-hidden bg-[color:var(--tc-mpf-surface)]">
              <div
                className={`grid ${compactList ? "grid-cols-[1fr_72px]" : "grid-cols-[minmax(260px,1fr)_minmax(120px,160px)_minmax(72px,96px)]"} gap-2 px-3 py-2 bg-[color:var(--tc-mpf-surface-2)] border-b border-[color:var(--tc-mpf-border)] text-[11px] font-semibold text-[color:var(--tc-mpf-icon)]`}
              >
                <div className="opacity-90">名称</div>
                {!compactList && <div className="opacity-90">备注</div>}
                <div className="text-right opacity-90">类型</div>
              </div>
              <div>
                {visibleNodes.map((node, nodeIndex) => {
                  const isFolder = node.type === "folder";
                  const name = node.name;
                  const isSelected = Boolean(
                    selectedItem &&
                    selectedItem.type === node.type &&
                    selectedItem.name === name,
                  );
                  const key = `${node.type}:${name}`;
                  const reactKey = `${node.type}:${folderPath.join("/")}:${name}:${nodeIndex}`;
                  const isReorderTarget = mpfReorderDropTarget?.key === key;
                  const reorderPlacement = isReorderTarget
                    ? mpfReorderDropTarget?.placement
                    : null;
                  const isMoveIntoTarget = mpfMoveIntoDropTargetKey === key;
                  const thumbUrl = isFolder ? null : getMaterialThumbUrl(node);
                  const unuploadedHint =
                    useBackend && !isFolder
                      ? getMaterialUnuploadedHint(node)
                      : null;
                  const annotations = isFolder
                    ? []
                    : getMaterialAnnotations(node);
                  const displayChips = annotations.slice(0, 3);
                  const moreCount = Math.max(
                    0,
                    annotations.length - displayChips.length,
                  );
                  const baseType = getNodeBaseType(node);
                  const folderCountText = isFolder
                    ? `${node.children?.length ?? 0} 项`
                    : "";
                  return (
                    <div
                      key={reactKey}
                      className={`relative grid ${compactList ? "grid-cols-[1fr_72px]" : "grid-cols-[minmax(260px,1fr)_minmax(120px,160px)_minmax(72px,96px)]"} gap-2 px-3 py-2 text-xs border-t border-[color:var(--tc-mpf-border)] cursor-pointer ${
                        isSelected
                          ? "bg-[color:var(--tc-mpf-selected)]"
                          : "hover:bg-[color:var(--tc-mpf-surface-3)]"
                      } ${isMoveIntoTarget ? "ring-1 ring-[color:var(--tc-mpf-accent)]" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        if (isInlineClickTarget(e.target)) {
                          e.preventDefault();
                          return;
                        }
                        activeMpfNodeDrag = null;
                        e.dataTransfer.effectAllowed = "copyMove";

                        const materialPreviewPayload: MaterialPreviewPayload = {
                          ...(payload.scope ? { scope: payload.scope } : {}),
                          ...(typeof payload.spaceId === "number" &&
                          payload.spaceId > 0
                            ? { spaceId: payload.spaceId }
                            : {}),
                          kind: node.type,
                          packageId: selectedPackageId,
                          label: name,
                          path: [
                            ...folderPath.map((n) => `folder:${n}`),
                            node.type === "folder"
                              ? `folder:${name}`
                              : `material:${name}`,
                          ],
                        };
                        setMaterialPreviewDragData(
                          e.dataTransfer,
                          materialPreviewPayload,
                        );
                        setMaterialPreviewDragOrigin(
                          e.dataTransfer,
                          dragOrigin === "docked" ? "docked" : "tree",
                        );
                        setMpfNodeDragData(e.dataTransfer, {
                          packageId: selectedPackageId,
                          folderPath: [...folderPath],
                          kind: node.type,
                          name,
                          materialPreview: materialPreviewPayload,
                        });
                        clearMpfDropTargets();
                      }}
                      onDragOver={(e) => {
                        const source = getMpfNodeDragData(e.dataTransfer);
                        if (!source) return;
                        if (
                          Number(source.packageId) !== Number(selectedPackageId)
                        )
                          return;
                        if (!folderPathEqual(source.folderPath, folderPath))
                          return;

                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        const intent = computeMpfDropIntent({
                          viewMode: "list",
                          targetKind: node.type,
                          targetRect: rect,
                          clientX: e.clientX,
                          clientY: e.clientY,
                        });
                        if (intent === "none") {
                          if (
                            mpfReorderDropTarget?.key === key ||
                            mpfMoveIntoDropTargetKey === key
                          ) {
                            clearMpfDropTargets();
                          }
                          return;
                        }
                        if (intent === "moveInto") {
                          if (node.type !== "folder") return;
                          if (source.kind === "folder" && source.name === name)
                            return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = "move";
                          setMpfMoveIntoDropTargetKey(key);
                          setMpfReorderDropTarget(null);
                          return;
                        }

                        if (source.kind === node.type && source.name === name)
                          return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        setMpfReorderDropTarget({
                          key,
                          placement:
                            intent === "reorderAfter" ? "after" : "before",
                        });
                        setMpfMoveIntoDropTargetKey(null);
                      }}
                      onDragLeave={(e) => {
                        const related = e.relatedTarget as HTMLElement | null;
                        if (
                          related &&
                          (e.currentTarget as HTMLElement).contains(related)
                        )
                          return;
                        if (mpfReorderDropTarget?.key === key) {
                          setMpfReorderDropTarget(null);
                        }
                        if (mpfMoveIntoDropTargetKey === key) {
                          setMpfMoveIntoDropTargetKey(null);
                        }
                      }}
                      onDrop={(e) => {
                        const source = getMpfNodeDragData(e.dataTransfer);
                        if (!source) return;
                        if (
                          Number(source.packageId) !== Number(selectedPackageId)
                        )
                          return;
                        if (!folderPathEqual(source.folderPath, folderPath))
                          return;
                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        const intent = computeMpfDropIntent({
                          viewMode: "list",
                          targetKind: node.type,
                          targetRect: rect,
                          clientX: e.clientX,
                          clientY: e.clientY,
                        });
                        if (intent === "none") return;
                        e.preventDefault();
                        e.stopPropagation();
                        clearMpfDropTargets();
                        activeMpfNodeDrag = null;
                        void applyPreviewNodeDropSafely({
                          source,
                          target: { kind: node.type, name },
                          intent,
                        });
                      }}
                      onDragEnd={() => {
                        clearMpfDropTargets();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedItem({ type: node.type, name });
                        if (isInlineClickTarget(e.target)) {
                          lastClickRef.current = null;
                          return;
                        }
                        const nowMs = Date.now();
                        const prev = lastClickRef.current;
                        lastClickRef.current = { key, timeMs: nowMs };
                        if (
                          !prev ||
                          prev.key !== key ||
                          nowMs - prev.timeMs > 350
                        )
                          return;
                        lastClickRef.current = null;
                        if (isFolder) {
                          setFolderPath((prevPath) => [...prevPath, name]);
                          setSelectedItem(null);
                        }
                      }}
                    >
                      {isReorderTarget && reorderPlacement === "before" && (
                        <div className="pointer-events-none absolute left-3 right-3 top-0 h-[2px] bg-[color:var(--tc-mpf-accent)] rounded" />
                      )}
                      {isReorderTarget && reorderPlacement === "after" && (
                        <div className="pointer-events-none absolute left-3 right-3 bottom-0 h-[2px] bg-[color:var(--tc-mpf-accent)] rounded" />
                      )}
                      <div className="flex items-center gap-3 min-w-0">
                        {!compactList && (
                          <div
                            className="rounded-sm overflow-hidden border border-[color:var(--tc-mpf-item-border)] bg-[color:var(--tc-mpf-surface-2)] shrink-0 relative"
                            style={{
                              width: `${listThumbBox.w}px`,
                              height: `${listThumbBox.h}px`,
                            }}
                          >
                            {thumbUrl && (
                              <BetterImg
                                src={thumbUrl}
                                className="w-full h-full object-cover"
                              />
                            )}
                            {!thumbUrl && isFolder && (
                              <div className="w-full h-full grid place-items-center bg-gradient-to-b from-[color:var(--tc-mpf-surface-2)] to-[color:var(--tc-mpf-surface)]">
                                <FolderIcon className="size-7 opacity-70" />
                              </div>
                            )}
                            {!thumbUrl && !isFolder && (
                              <div className="w-full h-full grid place-items-center bg-gradient-to-b from-[color:var(--tc-mpf-surface-2)] to-[color:var(--tc-mpf-surface)]">
                                <FileImageIcon className="size-7 opacity-70" />
                              </div>
                            )}
                            {!thumbUrl && !isFolder && unuploadedHint && (
                              <div
                                className="absolute bottom-1 left-1 right-1 text-center text-[10px] px-1 py-0.5 rounded border border-[color:var(--tc-mpf-item-border)] bg-[color:var(--tc-mpf-surface-2)] text-[color:var(--tc-mpf-text)]/80 backdrop-blur-sm truncate"
                                title={unuploadedHint}
                              >
                                {unuploadedHint}
                              </div>
                            )}
                          </div>
                        )}
                        {compactList && (
                          <span
                            className={`inline-block size-2 rounded-none border border-[color:var(--tc-mpf-dot-border)] shrink-0 ${isFolder ? "bg-[color:var(--tc-mpf-dot-folder)]" : "bg-[color:var(--tc-mpf-dot-file)]"}`}
                          />
                        )}
                        <div className="min-w-0">
                          {inlineEdit &&
                          inlineEdit.field === "name" &&
                          inlineEdit.type === node.type &&
                          inlineEdit.name === name ? (
                            <div data-mpf-inline="1">
                              <input
                                ref={inlineEditRef}
                                value={inlineEdit.value}
                                onChange={(e) =>
                                  setInlineEdit((prev) =>
                                    prev
                                      ? { ...prev, value: e.target.value }
                                      : prev,
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelInlineEdit();
                                  }
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const from = inlineEdit.name;
                                    const to = inlineEdit.value;
                                    cancelInlineEdit();
                                    void commitInlineRename({
                                      type: node.type,
                                      from,
                                      to,
                                    });
                                  }
                                }}
                                onBlur={() => {
                                  const from = inlineEdit.name;
                                  const to = inlineEdit.value;
                                  cancelInlineEdit();
                                  void commitInlineRename({
                                    type: node.type,
                                    from,
                                    to,
                                  });
                                }}
                                className="w-full h-7 rounded-none border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-input-bg)] px-2 text-[12px] font-medium text-[color:var(--tc-mpf-text)] focus:outline-none focus:border-[color:var(--tc-mpf-accent)]"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          ) : (
                            <div
                              data-mpf-inline="1"
                              className="truncate text-[color:var(--tc-mpf-text)] font-medium"
                              title={name}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedItem({ type: node.type, name });
                                if (inlineEdit) return;
                                if (node.type !== "material") return;
                                if (
                                  !detectInlineDoubleClick(
                                    `name:${node.type}:${name}`,
                                  )
                                )
                                  return;
                                startInlineRename(node);
                              }}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                startInlineRename(node);
                              }}
                            >
                              {name}
                            </div>
                          )}
                          {!compactList && (
                            <div
                              className="mt-0.5 flex flex-wrap gap-1 min-h-[18px]"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                if (isFolder) return;
                                e.preventDefault();
                                e.stopPropagation();
                                openAnnoEditor(
                                  e.currentTarget as HTMLElement,
                                  node,
                                );
                              }}
                              title={isFolder ? "" : "点击编辑标签"}
                            >
                              {isFolder && (
                                <span className="text-[11px] text-[color:var(--tc-mpf-muted)]">
                                  包含 {folderCountText}
                                </span>
                              )}
                              {!isFolder &&
                                displayChips.map((tag) => (
                                  <span
                                    key={tag}
                                    className="inline-flex items-center rounded-sm border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-surface-2)] px-1.5 py-[1px] text-[11px] text-[color:var(--tc-mpf-text)] opacity-95"
                                    title={tag}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              {!isFolder && moreCount > 0 && (
                                <span
                                  className="inline-flex items-center rounded-sm border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-surface-2)] px-1.5 py-[1px] text-[11px] text-[color:var(--tc-mpf-muted)]"
                                  title={annotations.join(" / ")}
                                >
                                  +{moreCount}
                                </span>
                              )}
                              {!isFolder && annotations.length === 0 && (
                                <span className="inline-flex items-center rounded-sm border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-surface-2)] px-1.5 py-[1px] text-[11px] text-[color:var(--tc-mpf-muted)]">
                                  {baseType}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {!compactList && (
                        <div
                          className="truncate text-[color:var(--tc-mpf-muted)]"
                          data-mpf-inline={isFolder ? undefined : "1"}
                          title={isFolder ? "" : (node.note ?? "").trim()}
                          onClick={(e) => {
                            if (isFolder) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedItem({ type: node.type, name });
                            if (inlineEdit) return;
                            if (node.type !== "material") return;
                            if (!detectInlineDoubleClick(`note:${name}`))
                              return;
                            startInlineNoteEdit(node);
                          }}
                          onDoubleClick={(e) => {
                            if (isFolder) return;
                            e.preventDefault();
                            startInlineNoteEdit(node);
                          }}
                        >
                          {isFolder ? (
                            ""
                          ) : inlineEdit &&
                            inlineEdit.field === "note" &&
                            inlineEdit.type === "material" &&
                            inlineEdit.name === name ? (
                            <input
                              ref={inlineEditRef}
                              value={inlineEdit.value}
                              onChange={(e) =>
                                setInlineEdit((prev) =>
                                  prev
                                    ? { ...prev, value: e.target.value }
                                    : prev,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelInlineEdit();
                                }
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  const materialName = inlineEdit.name;
                                  const note = inlineEdit.value;
                                  cancelInlineEdit();
                                  void commitInlineNote({ materialName, note });
                                }
                              }}
                              onBlur={() => {
                                const materialName = inlineEdit.name;
                                const note = inlineEdit.value;
                                cancelInlineEdit();
                                void commitInlineNote({ materialName, note });
                              }}
                              className="w-full h-7 rounded-none border border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-input-bg)] px-2 text-[12px] text-[color:var(--tc-mpf-text)] focus:outline-none focus:border-[color:var(--tc-mpf-accent)]"
                              placeholder="添加备注…"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (node.note ?? "").trim() ? (
                            (node.note ?? "").trim()
                          ) : (
                            "（无备注）"
                          )}
                        </div>
                      )}
                      <div className="text-right text-[color:var(--tc-mpf-muted)]">
                        {baseType}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer (prototype: size slider) */}
      <div
        className={`shrink-0 flex items-center py-2 border-t border-[color:var(--tc-mpf-border)] bg-[color:var(--tc-mpf-bg)] text-[12px] text-[color:var(--tc-mpf-muted)] ${
          isEmbedded ? "px-3" : "pl-3 pr-8"
        } ${isEmbedded ? "flex-nowrap gap-x-2" : "flex-wrap gap-x-3 gap-y-2"}`}
      >
        <div
          className={`flex items-center min-w-0 ${isEmbedded ? "gap-1.5" : "flex-wrap gap-2"}`}
        >
          <button
            type="button"
            className={iconControlClass}
            onClick={() => setViewMode("icon")}
            aria-pressed={viewMode === "icon"}
            title="图标视图"
          >
            <SquaresFourIcon className="size-4 opacity-80" />
          </button>
          <button
            type="button"
            className={iconControlClass}
            onClick={() => setViewMode("list")}
            aria-pressed={viewMode === "list"}
            title="列表视图"
          >
            <ListBulletsIcon className="size-4 opacity-80" />
          </button>
          <div className="w-px h-4 bg-[color:var(--tc-mpf-border)] opacity-80" />
          <input
            type="range"
            min={96}
            max={180}
            value={thumbSize}
            onChange={(e) => setThumbSize(Number(e.target.value))}
            className={
              isEmbedded
                ? "min-w-[88px] w-28 max-w-[120px] shrink tc-min-range"
                : "min-w-[140px] w-52 max-w-[42vw] tc-min-range"
            }
          />
        </div>
        <div
          className={`flex items-center ml-auto justify-end ${isEmbedded ? "flex-nowrap gap-1.5" : "flex-wrap gap-2"}`}
        >
          <button
            type="button"
            className={iconControlClass}
            onClick={handleCreatePackage}
            title="新增素材包"
          >
            <PlusIcon className="size-4 opacity-80" />
          </button>
          <button
            type="button"
            className={iconControlClass}
            onClick={handleCreateFolder}
            title="新建文件夹"
          >
            <FolderPlusIcon className="size-4 opacity-80" />
          </button>
          <button
            type="button"
            className={iconControlClass}
            onClick={handleImportClick}
            title="导入素材"
          >
            <UploadSimpleIcon className="size-4 opacity-80" />
          </button>
          <button
            type="button"
            className={`${iconControlClass} disabled:opacity-40 disabled:cursor-not-allowed`}
            disabled={selectedItem?.type !== "material"}
            onClick={(e) => {
              const anchor = e.currentTarget as HTMLElement;
              openAnnoEditor(anchor, selectedNode);
            }}
            title={
              selectedItem?.type === "material"
                ? "编辑标签（annotations）"
                : "先选择一个素材"
            }
            aria-label="编辑标签"
          >
            <TagIcon className="size-4 opacity-80" />
          </button>
          <button
            type="button"
            className={iconControlClass}
            onClick={handleDelete}
            title="删除（按优先级）"
            aria-label="删除"
          >
            <TrashIcon className="size-4 opacity-90" />
          </button>
          <button
            type="button"
            className={iconControlClass}
            onClick={handleRename}
            title="重命名（按优先级）"
            aria-label="重命名"
          >
            <PencilSimpleIcon className="size-4 opacity-80" />
          </button>
        </div>
      </div>

      <input
        ref={importInputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.mp3,.wav,.ogg,.flac,.m4a,.txt,.md"
        className="hidden"
        onChange={handleImportChange}
      />

      {annoOpen &&
        createPortal(
          <div
            ref={annoTipRef}
            className="tc-mpf pointer-events-auto z-[9999] rounded-md w-[340px] overflow-hidden"
            style={{
              position: "fixed",
              left: annoPos?.left ?? 0,
              top: annoPos?.top ?? 0,
              ...mpfThemeVars,
              border: "1px solid var(--tc-mpf-border-strong)",
              backgroundColor: "var(--tc-mpf-toolbar)",
              color: "var(--tc-mpf-text)",
              boxShadow: "var(--tc-mpf-pop-shadow)",
            }}
          >
            <style>{`
            .tc-mpf .tc-mpf-anno-input::placeholder { color: var(--tc-mpf-muted); opacity: 1; }
            .tc-mpf .tc-mpf-anno-btn:hover { background-color: var(--tc-mpf-surface-3); }
            .tc-mpf .tc-mpf-anno-chip-remove:hover { color: var(--tc-mpf-text); }
          `}</style>
            <div
              className="h-[34px] flex items-center justify-between px-[10px] select-none"
              style={{
                borderBottom: "1px solid var(--tc-mpf-border)",
                background:
                  "linear-gradient(180deg, var(--tc-mpf-surface-2), var(--tc-mpf-toolbar))",
              }}
            >
              <div className="text-[13px] font-semibold">
                标签（annotations）
              </div>
              <button
                type="button"
                className={iconControlClass}
                onClick={() => closeAnnoEditor()}
                aria-label="关闭"
                title="关闭"
                data-mpf-no-drag="1"
              >
                <XMarkICon className="size-4 opacity-80" />
              </button>
            </div>

            <div
              className="px-[10px] py-[10px] space-y-2"
              style={{ backgroundColor: "var(--tc-mpf-toolbar)" }}
            >
              <div
                className="text-[12px] opacity-80 truncate"
                title={annoTarget?.materialName ?? ""}
              >
                {annoTarget?.materialName ?? ""}
              </div>

              {(annoTarget?.messageCount ?? 0) > 1 && (
                <label className="flex items-center gap-2 text-[12px] opacity-90 select-none">
                  <input
                    type="checkbox"
                    checked={annoApplyAll}
                    onChange={(e) => setAnnoApplyAll(e.target.checked)}
                  />
                  应用到该素材的全部消息
                </label>
              )}

              <div className="flex flex-wrap gap-1 min-h-[22px]">
                {annoDraft.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-sm px-2 py-[1px] text-[12px]"
                    style={{
                      border: "1px solid var(--tc-mpf-border)",
                      backgroundColor: "var(--tc-mpf-surface)",
                      color: "var(--tc-mpf-text)",
                    }}
                  >
                    <span className="max-w-[240px] truncate" title={tag}>
                      {tag}
                    </span>
                    <button
                      type="button"
                      className="tc-mpf-anno-chip-remove"
                      onClick={() => removeAnnoTag(tag)}
                      aria-label={`移除 ${tag}`}
                      style={{ color: "var(--tc-mpf-muted)" }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {annoDraft.length === 0 && (
                  <span
                    className="text-[12px]"
                    style={{ color: "var(--tc-mpf-muted)" }}
                  >
                    暂无标签
                  </span>
                )}
              </div>

              <input
                value={annoInput}
                onChange={(e) => setAnnoInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAnnoTag(annoInput);
                    setAnnoInput("");
                  }
                }}
                placeholder="输入标签，回车添加…"
                className="tc-mpf-anno-input w-full h-7 rounded-none px-2 text-[12px] focus:outline-none"
                style={{
                  border: "1px solid var(--tc-mpf-border)",
                  backgroundColor: "var(--tc-mpf-input-bg)",
                  color: "var(--tc-mpf-text)",
                }}
              />

              <div className="pt-1">
                <div className="text-[11px] opacity-70 mb-1">常用</div>
                <div className="flex flex-wrap gap-1">
                  {COMMON_ANNOTATIONS.filter(
                    (tag) => !annoDraft.includes(tag),
                  ).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="tc-mpf-anno-btn rounded-sm px-2 py-[2px] text-[12px] active:opacity-90"
                      onClick={() => addAnnoTag(tag)}
                      style={{
                        border: "1px solid var(--tc-mpf-border)",
                        backgroundColor: "var(--tc-mpf-surface)",
                        color: "var(--tc-mpf-text)",
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              className="h-[36px] flex items-center justify-end gap-2 px-[10px]"
              style={{
                borderTop: "1px solid var(--tc-mpf-border)",
                background:
                  "linear-gradient(180deg, var(--tc-mpf-toolbar), var(--tc-mpf-surface-2))",
              }}
            >
              <button
                type="button"
                className="tc-mpf-anno-btn h-7 px-3 rounded-none text-[12px] active:opacity-90"
                onClick={() => closeAnnoEditor()}
                style={{
                  border: "1px solid var(--tc-mpf-border)",
                  backgroundColor: "var(--tc-mpf-surface)",
                  color: "var(--tc-mpf-text)",
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="tc-mpf-anno-btn h-7 px-3 rounded-none text-[12px] active:opacity-90"
                onClick={() => void saveAnnoEditor()}
                style={{
                  border: "1px solid var(--tc-mpf-accent)",
                  backgroundColor: "var(--tc-mpf-surface)",
                  color: "var(--tc-mpf-text)",
                }}
              >
                保存
              </button>
            </div>
          </div>,
          document.body,
        )}

      {!isEmbedded && (
        <div
          className="absolute !right-0 !bottom-0 !left-auto !top-auto size-5 cursor-nwse-resize select-none"
          onPointerDown={onResizePointerDown}
          title="拖拽调整大小"
          role="presentation"
          style={{ touchAction: "none" }}
        >
          <svg
            className="pointer-events-none absolute !right-[2px] !bottom-[2px] opacity-80"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            style={{ width: 16, height: 16 }}
          >
            <path
              d="M9 15 L15 9"
              stroke="var(--tc-mpf-grip)"
              strokeWidth="1.2"
              strokeLinecap="square"
            />
            <path
              d="M11 15 L15 11"
              stroke="var(--tc-mpf-grip)"
              strokeWidth="1.2"
              strokeLinecap="square"
            />
            <path
              d="M13 15 L15 13"
              stroke="var(--tc-mpf-grip)"
              strokeWidth="1.2"
              strokeLinecap="square"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
