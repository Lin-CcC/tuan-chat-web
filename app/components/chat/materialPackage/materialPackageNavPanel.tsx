import type {
  MaterialNode,
  MaterialPackageRecord,
  MaterialPackageContent,
  MaterialItemNode,
} from "@/components/materialPackage/materialPackageApi";
import type { MaterialPreviewPayload } from "@/components/chat/materialPackage/materialPackageDnd";

import {
  ArrowClockwise,
  CrosshairSimple,
  FileImageIcon,
  FilePlus,
  FolderPlus,
  PackageIcon,
  Plus,
  TrashIcon,
  UploadSimple,
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
import { createPortal } from "react-dom";
import toast from "react-hot-toast";

import {
  createMaterialPackage,
  deleteMaterialPackage,
  getMyMaterialPackages,
  updateMaterialPackage,
} from "@/components/materialPackage/materialPackageApi";
import {
  readMockPackages,
  writeMockPackages,
} from "@/components/chat/materialPackage/materialPackageMockStore";
import MaterialPreviewFloat from "@/components/chat/materialPackage/materialPreviewFloat";
import PortalTooltip from "@/components/common/portalTooltip";
import { UploadUtils } from "@/utils/UploadUtils";
import { ChevronDown, FolderIcon, SidebarSimpleIcon } from "@/icons";
import { useLocalStorage } from "@/components/common/customHooks/useLocalStorage";
import {
  buildMaterialPackageDetailQueryKey,
  buildMaterialPackageMyQueryKey,
  buildMaterialPackageSquareQueryKey,
} from "@/components/chat/materialPackage/materialPackageQueries";
import {
  applyVisibilityToSquare,
  removeSquareRecord,
} from "@/components/chat/materialPackage/materialPackageSquareCache";
import type { SelectedExplorerNode } from "@/components/chat/materialPackage/materialPackageExplorerOps";
import {
  autoRenameVsCodeLike,
  folderPathEqual,
  payloadPathToFolderNames,
  resolveTarget,
} from "@/components/chat/materialPackage/materialPackageExplorerOps";
import {
  isClickSuppressed,
  markClickSuppressed,
} from "@/components/chat/materialPackage/materialPackageClickSuppressor";
import { getFolderNodesAtPath } from "@/components/chat/materialPackage/materialPackageTree";
import { mergeMaterialPackageRecordContent } from "@/components/chat/materialPackage/materialPackageCacheMerge";
import {
  buildEmptyMaterialPackageContent,
  draftCreateFolder,
  draftCreateMaterial,
  draftDeleteFolder,
  draftDeleteMaterial,
  draftMoveNode,
  draftMoveNodeAcrossContents,
  draftRenameFolder,
  draftRenameMaterial,
  draftReorderNode,
  draftReplaceMaterialMessages,
} from "@/components/chat/materialPackage/materialPackageDraft";
import {
  getVisibilityCopy,
  normalizePackageVisibility,
} from "@/components/chat/materialPackage/materialPackageVisibility";
import { computeVisibilityPopoverPos } from "@/components/chat/materialPackage/materialPackageVisibilityPopoverPos";
import { computeTreeFolderRowDropDecision } from "@/components/chat/materialPackage/materialPackageTreeDrop";
import {
  isMaterialPreviewDrag,
  getMaterialPreviewDragData,
  setMaterialPreviewDragData,
  getMaterialPreviewDragOrigin,
  setMaterialPreviewDragOrigin,
  isMpfNodeDrag,
} from "@/components/chat/materialPackage/materialPackageDnd";

interface MaterialPackageNavPanelProps {
  onCloseLeftDrawer: () => void;
  onToggleLeftDrawer?: () => void;
  isLeftDrawerOpen?: boolean;
  dockedPreview: MaterialPreviewPayload | null;
  dockedIndex?: number;
  onDockPreview: (
    payload: MaterialPreviewPayload,
    options?: { index?: number; placement?: "top" | "bottom" },
  ) => void;
  onMoveDockedPreview: (nextIndex: number) => void;
  onUndockPreview: () => void;
  onOpenPreview: (
    payload: MaterialPreviewPayload,
    hintPosition?: { x: number; y: number } | null,
  ) => void;
}

type ExplorerNodeKey = string;

function buildNodeKey(args: { packageId: number; path: string[] }) {
  const safePath = args.path.map((part) => part.replaceAll("/", "／"));
  return `pkg:${args.packageId}:${safePath.join("/")}`;
}

function toPreviewPayload(args: {
  kind: MaterialPreviewPayload["kind"];
  packageId: number;
  label: string;
  path: string[];
}): MaterialPreviewPayload {
  return {
    kind: args.kind,
    packageId: args.packageId,
    label: args.label,
    path: args.path,
  };
}

function flattenPath(path: string[]) {
  return path.join("/");
}

function normalizePackages(payload: unknown): MaterialPackageRecord[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(Boolean) as MaterialPackageRecord[];
}

function reconcilePackageOrder(
  prevOrder: number[],
  nextPackages: MaterialPackageRecord[],
) {
  const nextIds = nextPackages.map((p) => Number(p.packageId));
  const nextIdSet = new Set(nextIds);

  const kept = prevOrder.filter((id) => nextIdSet.has(id));
  const keptSet = new Set(kept);
  const added = nextPackages.filter((p) => !keptSet.has(Number(p.packageId)));

  const addedIds = added.map((p) => Number(p.packageId));
  return [...kept, ...addedIds];
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createDefaultTextMaterialMessages(content = "") {
  return [
    {
      messageType: 1,
      content,
      annotations: ["文本"],
      extra: {},
    },
  ];
}

type ToolbarAction = "new-file" | "new-folder" | "new-package" | "import";

function shallowArrayEqual(a: unknown, b: unknown) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type PendingDeleteDialog =
  | {
      kind: "package";
      packageId: number;
      label: string;
      saving: boolean;
    }
  | {
      kind: "folder";
      packageId: number;
      folderPath: string[];
      label: string;
      saving: boolean;
    }
  | {
      kind: "material";
      packageId: number;
      folderPath: string[];
      materialName: string;
      label: string;
      saving: boolean;
    };

function extractPathName(token: string, prefix: "folder:" | "material:") {
  if (!token.startsWith(prefix)) return null;
  const name = token.slice(prefix.length).trim();
  return name || null;
}

function payloadPathToMaterialName(path: string[] | undefined | null) {
  const parts = Array.isArray(path) ? path : [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const name = extractPathName(part, "material:");
    if (name) return name;
  }
  return null;
}

const MATERIAL_PACKAGE_REORDER_TYPE =
  "application/x-tc-material-package-reorder";

type MaterialPackageReorderPayload = {
  packageId: number;
  kind: "package" | "folder" | "material";
  path: string[];
  /**
   * Optional: embed a material-preview payload so other drop targets (e.g. chat)
   * can decode it even if the runtime only preserves `text/plain`.
   */
  materialPreview?: MaterialPreviewPayload;
};

let activeMaterialPackageReorderDrag: MaterialPackageReorderPayload | null =
  null;

function setMaterialPackageReorderDragData(
  dataTransfer: DataTransfer,
  payload: MaterialPackageReorderPayload,
) {
  activeMaterialPackageReorderDrag = payload;
  try {
    dataTransfer.setData(
      MATERIAL_PACKAGE_REORDER_TYPE,
      JSON.stringify(payload),
    );
  } catch {
    // ignore
  }
  try {
    dataTransfer.setData(
      "text/plain",
      `tc-material-package-reorder:${JSON.stringify(payload)}`,
    );
  } catch {
    // ignore
  }
}

function getMaterialPackageReorderDragData(
  dataTransfer: DataTransfer | null,
): MaterialPackageReorderPayload | null {
  if (!dataTransfer) return null;

  const parse = (raw: string) => {
    const parsed = JSON.parse(
      raw,
    ) as Partial<MaterialPackageReorderPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      parsed.kind !== "package" &&
      parsed.kind !== "folder" &&
      parsed.kind !== "material"
    )
      return null;
    const packageId = Number(parsed.packageId);
    if (!Number.isFinite(packageId) || packageId <= 0) return null;
    const path = Array.isArray(parsed.path)
      ? parsed.path.filter((s) => typeof s === "string")
      : [];
    if (parsed.kind !== "package" && !path.length) return null;
    return { packageId, kind: parsed.kind, path };
  };

  try {
    const raw = dataTransfer.getData(MATERIAL_PACKAGE_REORDER_TYPE);
    if (raw) return parse(raw);
  } catch {
    // ignore
  }

  try {
    const raw = dataTransfer.getData("text/plain") || "";
    const prefix = "tc-material-package-reorder:";
    if (raw.startsWith(prefix)) return parse(raw.slice(prefix.length));
  } catch {
    // ignore
  }

  return activeMaterialPackageReorderDrag;
}

function isMaterialPackageReorderDrag(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  try {
    return dataTransfer.types.includes(MATERIAL_PACKAGE_REORDER_TYPE);
  } catch {
    // ignore
  }
  return Boolean(getMaterialPackageReorderDragData(dataTransfer));
}

function parseRootKeyPackageId(key: string) {
  const prefix = "root:";
  if (typeof key !== "string" || !key.startsWith(prefix)) return null;
  const id = Number(key.slice(prefix.length));
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default function MaterialPackageNavPanel({
  onCloseLeftDrawer,
  onToggleLeftDrawer,
  isLeftDrawerOpen,
  dockedPreview,
  dockedIndex = 0,
  onDockPreview,
  onMoveDockedPreview,
  onUndockPreview,
  onOpenPreview,
}: MaterialPackageNavPanelProps) {
  const leftDrawerLabel = isLeftDrawerOpen ? "收起侧边栏" : "展开侧边栏";
  const defaultUseBackend = !(import.meta.env.MODE === "test");
  const [useBackend, setUseBackend] = useLocalStorage<boolean>(
    "tc:material-package:use-backend",
    defaultUseBackend,
  );
  const [toolbarPinned, setToolbarPinned] = useLocalStorage<boolean>(
    "tc:material-package:toolbar-pinned",
    false,
  );
  const [storedPackageOrder, setStoredPackageOrder] = useLocalStorage<number[]>(
    "tc:material-package:package-order",
    [],
  );
  const queryClient = useQueryClient();
  const uploadUtils = useRef(new UploadUtils()).current;
  const listQueryKey = buildMaterialPackageMyQueryKey(useBackend);
  const squareQueryKey = buildMaterialPackageSquareQueryKey(useBackend);

  const packagesQuery = useQuery({
    queryKey: listQueryKey,
    queryFn: () =>
      useBackend
        ? getMyMaterialPackages()
        : Promise.resolve(readMockPackages()),
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const rawPackages = useMemo(
    () => normalizePackages(packagesQuery.data),
    [packagesQuery.data],
  );
  const [packageOrder, setPackageOrder] = useState<number[] | null>(null);
  const suppressPackageClickUntilMsRef = useRef<number>(0);
  const [packageReorderDrop, setPackageReorderDrop] = useState<{
    key: string;
    placement: "before" | "after";
  } | null>(null);
  const packageReorderDragRef = useRef<{ sourceId: number } | null>(null);

  useEffect(() => {
    if (!rawPackages.length) {
      setPackageOrder(null);
      return;
    }

    setPackageOrder((prev) => {
      const basePrev = prev?.length
        ? prev
        : Array.isArray(storedPackageOrder) && storedPackageOrder.length
          ? storedPackageOrder
          : null;

      if (!basePrev) {
        return null;
      }

      return reconcilePackageOrder(basePrev, rawPackages);
    });
  }, [rawPackages, storedPackageOrder]);

  useEffect(() => {
    if (!packageOrder?.length) {
      if (storedPackageOrder?.length) {
        setStoredPackageOrder([]);
      }
      return;
    }
    setStoredPackageOrder((prev) =>
      shallowArrayEqual(prev, packageOrder) ? prev : packageOrder,
    );
  }, [packageOrder, setStoredPackageOrder, storedPackageOrder?.length]);

  const packages = useMemo(() => {
    if (!packageOrder?.length) return rawPackages;

    const byId = new Map<number, MaterialPackageRecord>();
    rawPackages.forEach((pkg) => {
      byId.set(Number(pkg.packageId), pkg);
    });

    const ordered: MaterialPackageRecord[] = [];
    packageOrder.forEach((id) => {
      const pkg = byId.get(id);
      if (pkg) ordered.push(pkg);
    });

    if (ordered.length === rawPackages.length) return ordered;

    const orderedSet = new Set(ordered.map((p) => Number(p.packageId)));
    rawPackages.forEach((pkg) => {
      const id = Number(pkg.packageId);
      if (!orderedSet.has(id)) ordered.push(pkg);
    });

    return ordered;
  }, [packageOrder, rawPackages]);

  const reorderPackageOrder = useCallback(
    (args: {
      sourceId: number;
      targetId: number;
      placement: "before" | "after";
    }) => {
      const sourceId = Number(args.sourceId);
      const targetId = Number(args.targetId);
      const placement = args.placement === "after" ? "after" : "before";
      if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) return;
      if (sourceId <= 0 || targetId <= 0) return;
      if (sourceId === targetId) return;

      setPackageOrder((prev) => {
        const base =
          Array.isArray(prev) && prev.length
            ? [...prev]
            : packages.map((p) => Number(p.packageId));
        const fromIndex = base.indexOf(sourceId);
        const targetIndex = base.indexOf(targetId);
        if (fromIndex < 0 || targetIndex < 0) return prev;
        base.splice(fromIndex, 1);
        const nextTargetIndex = base.indexOf(targetId);
        if (nextTargetIndex < 0) return prev;

        const insertIndex =
          placement === "before" ? nextTargetIndex : nextTargetIndex + 1;
        base.splice(
          Math.max(0, Math.min(base.length, insertIndex)),
          0,
          sourceId,
        );
        return base;
      });
    },
    [packages],
  );

  const [selectedNode, setSelectedNode] = useState<SelectedExplorerNode>(null);
  const [defaultTargetPackageId, setDefaultTargetPackageId] = useState<
    number | null
  >(null);
  const [collapsedByKey, setCollapsedByKey] = useState<
    Record<ExplorerNodeKey, boolean>
  >({});
  const [reorderDropTargetKey, setReorderDropTargetKey] = useState<
    string | null
  >(null);
  const [moveDropTargetKey, setMoveDropTargetKey] = useState<string | null>(
    null,
  );
  const toggleCollapsed = useCallback((key: ExplorerNodeKey) => {
    setCollapsedByKey((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const lastClickRef = useRef<{
    key: string;
    action: "open" | "rename";
    timeMs: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const treeItemsRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingChoosePackage, setPendingChoosePackage] = useState<{
    action: Exclude<ToolbarAction, "new-package">;
  } | null>(null);
  const [pendingChoosePackageId, setPendingChoosePackageId] = useState<
    number | null
  >(null);
  const [pendingImportTarget, setPendingImportTarget] = useState<{
    packageId: number;
    folderPath: string[];
  } | null>(null);
  const [pendingImportDialog, setPendingImportDialog] = useState<{
    target: { packageId: number; folderPath: string[] };
    files: File[];
  } | null>(null);
  const [pendingDeleteDialog, setPendingDeleteDialog] =
    useState<PendingDeleteDialog | null>(null);
  const [inlineRename, setInlineRename] = useState<null | {
    kind: "package" | "folder" | "material";
    key: string;
    packageId: number;
    folderPath: string[];
    fromName: string;
    draft: string;
    saving: boolean;
  }>(null);
  const inlineRenameInputRef = useRef<HTMLInputElement | null>(null);
  const inlineRenameMeasureRef = useRef<HTMLSpanElement | null>(null);
  const [inlineRenameWidthPx, setInlineRenameWidthPx] = useState<number>(0);
  useLayoutEffect(() => {
    if (!inlineRename) {
      setInlineRenameWidthPx(0);
      return;
    }

    const el = inlineRenameMeasureRef.current;
    if (!el) return;

    const measured = Math.ceil(el.getBoundingClientRect().width);
    const next = Math.max(24, measured + 2);
    setInlineRenameWidthPx((prev) => (prev === next ? prev : next));
  }, [inlineRename?.draft, inlineRename?.key]);

  const [inlineCreate, setInlineCreate] = useState<null | {
    kind: "package" | "folder" | "material";
    key: string;
    packageId: number | null;
    folderPath: string[];
    draft: string;
    saving: boolean;
  }>(null);
  const [textMaterialEditor, setTextMaterialEditor] = useState<null | {
    packageId: number;
    folderPath: string[];
    materialName: string;
    draft: string;
    saving: boolean;
  }>(null);
  const inlineCreateInputRef = useRef<HTMLInputElement | null>(null);
  const inlineCreateMeasureRef = useRef<HTMLSpanElement | null>(null);
  const [inlineCreateWidthPx, setInlineCreateWidthPx] = useState<number>(0);
  useLayoutEffect(() => {
    if (!inlineCreate) {
      setInlineCreateWidthPx(0);
      return;
    }

    const el = inlineCreateMeasureRef.current;
    if (!el) return;

    const measured = Math.ceil(el.getBoundingClientRect().width);
    const next = Math.max(24, measured + 2);
    setInlineCreateWidthPx((prev) => (prev === next ? prev : next));
  }, [inlineCreate?.draft, inlineCreate?.key]);

  const [visibilityEditor, setVisibilityEditor] = useState<{
    packageId: number;
    draft: 0 | 1;
    saving: boolean;
    anchor: HTMLButtonElement | null;
  } | null>(null);
  const visibilityPopoverRef = useRef<HTMLDivElement | null>(null);
  const visibilityFirstInputRef = useRef<HTMLInputElement | null>(null);
  const [visibilityPos, setVisibilityPos] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const [packageMetaEditor, setPackageMetaEditor] = useState<{
    packageId: number;
    draftDescription: string;
    draftCoverUrl: string;
    saving: boolean;
    uploadingCover: boolean;
    anchor: HTMLButtonElement | null;
  } | null>(null);
  const packageMetaPopoverRef = useRef<HTMLDivElement | null>(null);
  const packageMetaFirstInputRef = useRef<HTMLTextAreaElement | null>(null);
  const packageMetaCoverInputRef = useRef<HTMLInputElement | null>(null);
  const coverDropCounterRef = useRef(0);
  const [isCoverDropActive, setIsCoverDropActive] = useState(false);
  const [packageMetaPos, setPackageMetaPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [dockHint, setDockHint] = useState<{
    index: number;
    text: string;
  } | null>(null);
  const [dockLineTop, setDockLineTop] = useState<number | null>(null);
  const [dockTipTop, setDockTipTop] = useState<number | null>(null);

  const clearDockHint = useCallback(() => {
    setDockHint(null);
    setDockLineTop(null);
    setDockTipTop(null);
  }, []);

  const computeDockLineTop = useCallback((index: number) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return null;
    const scrollRect = scrollEl.getBoundingClientRect();
    const itemsRoot = treeItemsRef.current;
    const items = itemsRoot
      ? Array.from(
          itemsRoot.querySelectorAll<HTMLElement>(
            "[data-role='material-package-visible-row'][data-base-index]",
          ),
        )
      : [];
    if (!items.length) {
      return index <= 0 ? 88 : Math.max(120, scrollEl.scrollHeight - 24);
    }
    const last = items[items.length - 1]!;
    const exact =
      items.find((el) => Number(el.dataset.baseIndex) === index) ?? null;
    const rect = (exact ?? last).getBoundingClientRect();
    const y = exact ? rect.top : rect.bottom + 1;
    const localY = y - scrollRect.top + scrollEl.scrollTop;
    return Math.max(16, localY - 1);
  }, []);

  const applyDockHint = useCallback(
    (hint: { index: number; text: string } | null) => {
      if (!hint) {
        clearDockHint();
        return;
      }
      setDockHint((prev) =>
        prev?.index === hint.index && prev?.text === hint.text ? prev : hint,
      );
      const top = computeDockLineTop(hint.index);
      if (top == null) {
        setDockLineTop(null);
        setDockTipTop(null);
        return;
      }
      setDockLineTop(top);
      setDockTipTop(Math.max(6, top - 18));
    },
    [clearDockHint, computeDockLineTop],
  );

  const openPreview = useCallback(
    (
      payload: MaterialPreviewPayload,
      hintPosition?: { x: number; y: number } | null,
    ) => {
      onOpenPreview(payload, hintPosition ?? null);
    },
    [onOpenPreview],
  );

  const findPackageById = useCallback(
    (packageId: number) => {
      return (
        packages.find((p) => Number(p.packageId) === Number(packageId)) ?? null
      );
    },
    [packages],
  );

  const saveMockList = useCallback(
    (nextList: MaterialPackageRecord[]) => {
      writeMockPackages(nextList);
      queryClient.setQueryData(listQueryKey, nextList);
    },
    [listQueryKey, queryClient],
  );

  const saveMockRecord = useCallback(
    (nextRecord: MaterialPackageRecord) => {
      const now = new Date().toISOString();
      const updateTime =
        typeof nextRecord.updateTime === "string" ? nextRecord.updateTime : now;
      const nowRecord: MaterialPackageRecord = { ...nextRecord, updateTime };
      const base = Array.isArray(queryClient.getQueryData(listQueryKey))
        ? (queryClient.getQueryData(listQueryKey) as MaterialPackageRecord[])
        : readMockPackages();
      const nextList = (base ?? []).map((p) =>
        Number(p.packageId) === Number(nowRecord.packageId) ? nowRecord : p,
      );
      saveMockList(nextList);
      const detailKey = buildMaterialPackageDetailQueryKey(
        Number(nowRecord.packageId),
        useBackend,
      );
      queryClient.setQueryData(detailKey, nowRecord);
      queryClient.setQueryData(squareQueryKey, (prev) =>
        applyVisibilityToSquare(Array.isArray(prev) ? prev : [], nowRecord),
      );
      return nowRecord;
    },
    [queryClient, listQueryKey, saveMockList, squareQueryKey, useBackend],
  );

  const savePackageContent = useCallback(
    async (args: {
      packageId: number;
      nextContent: MaterialPackageContent;
    }) => {
      const packageId = Number(args.packageId);
      const detailKey = buildMaterialPackageDetailQueryKey(
        packageId,
        useBackend,
      );

      if (useBackend) {
        const updated = await updateMaterialPackage({
          packageId,
          content: args.nextContent,
        });
        // Some backends may not echo back the full updated `content`.
        // Ensure UI reflects reorder/move immediately.
        const mergedUpdated = mergeMaterialPackageRecordContent(
          updated as MaterialPackageRecord,
          args.nextContent,
        );
        queryClient.setQueryData(detailKey, mergedUpdated);
        queryClient.setQueryData(listQueryKey, (prev) => {
          if (!Array.isArray(prev)) return prev;
          const list = prev as MaterialPackageRecord[];
          return list.map((p) =>
            Number(p.packageId) === packageId ? mergedUpdated : p,
          );
        });
        queryClient.setQueryData(squareQueryKey, (prev) =>
          applyVisibilityToSquare(
            Array.isArray(prev) ? prev : [],
            mergedUpdated,
          ),
        );
        return mergedUpdated;
      }

      const base = findPackageById(packageId);
      if (!base) return null;
      const nextRecord: MaterialPackageRecord = {
        ...base,
        content: args.nextContent,
        updateTime: new Date().toISOString(),
      };
      const saved = saveMockRecord(nextRecord);
      return saved;
    },
    [
      findPackageById,
      listQueryKey,
      queryClient,
      saveMockRecord,
      squareQueryKey,
      useBackend,
    ],
  );

  const reorderNode = useCallback(
    async (args: {
      source: MaterialPackageReorderPayload;
      dest: {
        packageId: number;
        folderPath: string[];
        insertBefore: { type: "folder" | "material"; name: string };
      };
    }) => {
      const { source, dest } = args;
      if (source.kind === "package") return;
      const packageId = Number(source.packageId);
      if (!Number.isFinite(packageId) || packageId <= 0) return;
      if (Number(dest.packageId) !== packageId) {
        toast.error("不能在素材箱里嵌套素材箱。");
        return;
      }

      const pkg = findPackageById(packageId);
      if (!pkg) {
        toast.error("目标素材箱不存在或已被刷新。");
        return;
      }
      const baseContent = pkg.content ?? buildEmptyMaterialPackageContent();

      const sourceFolderNames = payloadPathToFolderNames(source.path);
      const sourceName =
        source.kind === "folder"
          ? (sourceFolderNames[sourceFolderNames.length - 1] ?? "")
          : (payloadPathToMaterialName(source.path) ?? "");
      if (!sourceName) return;

      const sourceParentPath =
        source.kind === "folder"
          ? sourceFolderNames.slice(0, -1)
          : sourceFolderNames;
      const destParentPath = dest.folderPath;
      const sameParent =
        sourceParentPath.length === destParentPath.length &&
        sourceParentPath.every((name, idx) => destParentPath[idx] === name);
      if (!sameParent) {
        toast.error("仅支持同一文件夹内排序。");
        return;
      }

      try {
        const nextContent = draftReorderNode(
          baseContent,
          destParentPath,
          { type: source.kind, name: sourceName },
          {
            insertBefore: {
              type: dest.insertBefore.type,
              name: dest.insertBefore.name,
            },
          },
        );
        await savePackageContent({ packageId, nextContent });
      } catch (error) {
        const message = error instanceof Error ? error.message : "排序失败";
        toast.error(message);
      }
    },
    [findPackageById, savePackageContent],
  );

  const moveNode = useCallback(
    async (args: {
      source: MaterialPackageReorderPayload;
      dest: { packageId: number; folderPath: string[] };
    }) => {
      const { source, dest } = args;
      if (source.kind === "package") return;
      const packageId = Number(source.packageId);
      if (!Number.isFinite(packageId) || packageId <= 0) return;
      const destPackageId = Number(dest.packageId);
      if (!Number.isFinite(destPackageId) || destPackageId <= 0) return;

      const srcPkg = findPackageById(packageId);
      if (!srcPkg) {
        toast.error("源素材箱不存在或已被刷新。");
        return;
      }
      const destPkg = findPackageById(destPackageId);
      if (!destPkg) {
        toast.error("目标素材箱不存在或已被刷新。");
        return;
      }
      const baseSourceContent =
        srcPkg.content ?? buildEmptyMaterialPackageContent();
      const baseDestContent =
        destPkg.content ?? buildEmptyMaterialPackageContent();

      const sourceFolderNames = payloadPathToFolderNames(source.path);
      const sourceName =
        source.kind === "folder"
          ? (sourceFolderNames[sourceFolderNames.length - 1] ?? "")
          : (payloadPathToMaterialName(source.path) ?? "");
      if (!sourceName) return;

      const sourceParentPath =
        source.kind === "folder"
          ? sourceFolderNames.slice(0, -1)
          : sourceFolderNames;
      const destFolderPath = Array.isArray(dest.folderPath)
        ? dest.folderPath
        : [];

      if (
        Number(destPackageId) === packageId &&
        folderPathEqual(sourceParentPath, destFolderPath)
      ) {
        // 拖回原文件夹：视为 no-op，避免误触发自动重命名
        return;
      }

      if (Number(destPackageId) === packageId && source.kind === "folder") {
        const fromPath = sourceFolderNames;
        const isDescendant =
          destFolderPath.length >= fromPath.length &&
          fromPath.every((name, idx) => destFolderPath[idx] === name);
        if (isDescendant) {
          toast.error("不能将文件夹移动到自身或其子目录中。");
          return;
        }
      }

      try {
        const destSiblings = getFolderNodesAtPath(
          Number(destPackageId) === packageId
            ? baseSourceContent
            : baseDestContent,
          destFolderPath,
        );
        const usedNames = destSiblings.map((n) => n.name);
        const finalName = autoRenameVsCodeLike(sourceName, usedNames);
        if (finalName !== sourceName) {
          window.alert(`名称已存在，已自动重命名为「${finalName}」。`);
        }

        if (Number(destPackageId) !== packageId) {
          const moved = draftMoveNodeAcrossContents(
            { sourceContent: baseSourceContent, destContent: baseDestContent },
            {
              parentPath: sourceParentPath,
              source: { type: source.kind, name: sourceName },
              nextName: finalName !== sourceName ? finalName : undefined,
            },
            { folderPath: destFolderPath },
          );
          if (!moved.removed) {
            // The node might have been moved/refresh during drag; treat as no-op.
            return;
          }

          await savePackageContent({
            packageId: destPackageId,
            nextContent: moved.nextDestContent,
          });
          try {
            await savePackageContent({
              packageId,
              nextContent: moved.nextSourceContent,
            });
          } catch (error) {
            try {
              await savePackageContent({
                packageId: destPackageId,
                nextContent: baseDestContent,
              });
            } catch {
              // ignore revert
            }
            throw error;
          }
        } else {
          const nextContent = draftMoveNode(
            baseSourceContent,
            {
              parentPath: sourceParentPath,
              source: { type: source.kind, name: sourceName },
              nextName: finalName !== sourceName ? finalName : undefined,
            },
            { folderPath: destFolderPath },
          );
          await savePackageContent({ packageId, nextContent });
        }

        const path = [
          ...destFolderPath.map((n) => `folder:${n}`),
          source.kind === "folder"
            ? `folder:${finalName}`
            : `material:${finalName}`,
        ];
        const payload = toPreviewPayload({
          kind: source.kind,
          packageId: destPackageId,
          label: finalName,
          path,
        });
        const key = buildNodeKey({ packageId: destPackageId, path });
        setSelectedNode({ kind: source.kind, key, payload });

        const keysToExpand: string[] = [];
        keysToExpand.push(`root:${destPackageId}`);
        for (let i = 0; i < path.length; i++) {
          const part = path[i];
          if (typeof part !== "string" || !part.startsWith("folder:")) continue;
          keysToExpand.push(
            buildNodeKey({
              packageId: destPackageId,
              path: path.slice(0, i + 1),
            }),
          );
        }

        setCollapsedByKey((prev) => {
          let changed = false;
          const next: Record<string, boolean> = { ...prev };
          for (const k of keysToExpand) {
            if (next[k] === true) {
              next[k] = false;
              changed = true;
            }
          }
          return changed ? next : prev;
        });

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const root = treeItemsRef.current;
            const el = root?.querySelector<HTMLElement>(
              `[data-node-key="${CSS.escape(key)}"]`,
            );
            el?.scrollIntoView({ block: "nearest" });
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "移动失败";
        toast.error(message);
      }
    },
    [findPackageById, savePackageContent],
  );

  const closeVisibilityEditor = useCallback(() => {
    setVisibilityEditor((prev) => {
      if (!prev) return prev;
      try {
        prev.anchor?.focus?.();
      } catch {
        // ignore focus errors
      }
      return null;
    });
    setVisibilityPos(null);
  }, []);

  const closePackageMetaEditor = useCallback(() => {
    setPackageMetaEditor((prev) => {
      if (!prev) return prev;
      try {
        prev.anchor?.focus?.();
      } catch {
        // ignore focus errors
      }
      return null;
    });
    setPackageMetaPos(null);
  }, []);

  const computeVisibilityPos = useCallback((anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const width = 320;
    const height = 188;
    const padding = 8;
    const panelRect = scrollRef.current?.getBoundingClientRect() ?? null;

    return computeVisibilityPopoverPos({
      anchorRect: rect,
      panelRect,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      popover: { width, height },
      padding,
    });
  }, []);

  const computePackageMetaPos = useCallback((anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const width = 420;
    const height = 284;
    const padding = 8;
    const panelRect = scrollRef.current?.getBoundingClientRect() ?? null;

    return computeVisibilityPopoverPos({
      anchorRect: rect,
      panelRect,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      popover: { width, height },
      padding,
    });
  }, []);

  const openVisibilityEditor = useCallback(
    (args: {
      packageId: number;
      anchor: HTMLButtonElement;
      current: 0 | 1;
    }) => {
      setVisibilityEditor({
        packageId: Number(args.packageId),
        draft: normalizePackageVisibility(args.current),
        saving: false,
        anchor: args.anchor,
      });
      setVisibilityPos(computeVisibilityPos(args.anchor));
    },
    [computeVisibilityPos],
  );

  const openPackageMetaEditor = useCallback(
    (args: { packageId: number; anchor: HTMLButtonElement }) => {
      const pkg = findPackageById(Number(args.packageId));
      const description = String(pkg?.description ?? "");
      const coverUrl = String(pkg?.coverUrl ?? "");
      setPackageMetaEditor({
        packageId: Number(args.packageId),
        draftDescription: description,
        draftCoverUrl: coverUrl,
        saving: false,
        uploadingCover: false,
        anchor: args.anchor,
      });
      setPackageMetaPos(computePackageMetaPos(args.anchor));
    },
    [computePackageMetaPos, findPackageById],
  );

  const uploadPackageCover = useCallback(
    async (file: File) => {
      if (!file || !file.type.startsWith("image/")) {
        toast.error("请选择图片文件");
        return;
      }

      setPackageMetaEditor((prev) =>
        prev ? { ...prev, uploadingCover: true } : prev,
      );
      const toastId = toast.loading("正在上传封面…");

      try {
        const url = await uploadUtils.uploadImg(file, 4);
        setPackageMetaEditor((prev) =>
          prev ? { ...prev, draftCoverUrl: url } : prev,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "上传失败";
        toast.dismiss(toastId);
        toast.error(message);
      } finally {
        toast.dismiss(toastId);
        setPackageMetaEditor((prev) =>
          prev ? { ...prev, uploadingCover: false } : prev,
        );
        const input = packageMetaCoverInputRef.current;
        if (input) input.value = "";
      }
    },
    [uploadUtils],
  );

  const resolveCoverUrlFromMaterialDrag = useCallback(
    (dataTransfer: DataTransfer | null): string | null => {
      const payload = getMaterialPreviewDragData(dataTransfer);
      if (!payload || payload.kind !== "material") {
        return null;
      }
      if (payload.scope === "space") {
        return null;
      }

      const packageId = Number(payload.packageId);
      const pkg = findPackageById(packageId);
      if (!pkg) return null;

      const folderPath = payloadPathToFolderNames(payload.path);
      const materialName =
        payloadPathToMaterialName(payload.path) ?? payload.label;
      if (!materialName) return null;

      const nodes = getFolderNodesAtPath(pkg.content, folderPath);
      const material = nodes.find(
        (n) =>
          n &&
          typeof n === "object" &&
          (n as any).type === "material" &&
          (n as any).name === materialName,
      ) as MaterialItemNode | undefined;

      if (!material) return null;
      for (const msg of material.messages ?? []) {
        if (!msg || typeof msg !== "object") continue;
        if (Number((msg as any).messageType) !== 2) continue;
        const extra: any = (msg as any).extra ?? null;
        const imageMessage = extra?.imageMessage ?? extra;
        const url =
          typeof imageMessage?.url === "string" ? imageMessage.url : "";
        if (url) return url;
      }

      return null;
    },
    [findPackageById],
  );

  const canAcceptCoverDrop = useCallback(
    (dataTransfer: DataTransfer | null) => {
      if (!dataTransfer) return false;

      try {
        const files = Array.from(dataTransfer.files ?? []);
        if (
          files.some(
            (f) =>
              f && typeof f.type === "string" && f.type.startsWith("image/"),
          )
        ) {
          return true;
        }
      } catch {
        // ignore
      }

      const previewPayload = getMaterialPreviewDragData(dataTransfer);
      if (previewPayload?.kind === "material") {
        return Boolean(resolveCoverUrlFromMaterialDrag(dataTransfer));
      }

      return false;
    },
    [resolveCoverUrlFromMaterialDrag],
  );

  const handleCoverDrop = useCallback(
    (dataTransfer: DataTransfer | null) => {
      if (!packageMetaEditor) return;
      if (packageMetaEditor.saving || packageMetaEditor.uploadingCover) return;
      if (!dataTransfer) return;

      try {
        const files = Array.from(dataTransfer.files ?? []);
        const imageFile = files.find(
          (f) => f && typeof f.type === "string" && f.type.startsWith("image/"),
        );
        if (imageFile) {
          void uploadPackageCover(imageFile);
          return;
        }
      } catch {
        // ignore
      }

      const draggedUrl = resolveCoverUrlFromMaterialDrag(dataTransfer);
      if (!draggedUrl) {
        toast.error("没有识别到可用的图片：请拖入图片文件或拖拽图片素材");
        return;
      }

      setPackageMetaEditor((prev) =>
        prev ? { ...prev, draftCoverUrl: draggedUrl } : prev,
      );
    },
    [packageMetaEditor, resolveCoverUrlFromMaterialDrag, uploadPackageCover],
  );

  useEffect(() => {
    if (!visibilityEditor?.anchor) return;
    setVisibilityPos(computeVisibilityPos(visibilityEditor.anchor));
  }, [computeVisibilityPos, visibilityEditor?.anchor]);

  useEffect(() => {
    if (!packageMetaEditor?.anchor) return;
    setPackageMetaPos(computePackageMetaPos(packageMetaEditor.anchor));
  }, [computePackageMetaPos, packageMetaEditor?.anchor]);

  useEffect(() => {
    if (!visibilityEditor) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeVisibilityEditor();
      }
    };

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const pop = visibilityPopoverRef.current;
      if (pop && pop.contains(target)) return;
      if (
        visibilityEditor.anchor &&
        visibilityEditor.anchor.contains(target as Node)
      )
        return;
      closeVisibilityEditor();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [closeVisibilityEditor, visibilityEditor]);

  useEffect(() => {
    if (!packageMetaEditor) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePackageMetaEditor();
      }
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const pop = packageMetaPopoverRef.current;
      if (pop && pop.contains(target)) return;
      if (
        packageMetaEditor.anchor &&
        packageMetaEditor.anchor.contains(target as Node)
      )
        return;
      closePackageMetaEditor();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClick, true);
    };
  }, [closePackageMetaEditor, packageMetaEditor]);

  useEffect(() => {
    if (!visibilityEditor) return;
    const t = window.setTimeout(() => {
      try {
        visibilityFirstInputRef.current?.focus?.();
      } catch {
        // ignore focus errors
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [visibilityEditor]);

  useEffect(() => {
    if (!packageMetaEditor) return;
    const t = window.setTimeout(() => {
      try {
        packageMetaFirstInputRef.current?.focus?.();
      } catch {
        // ignore focus errors
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [packageMetaEditor]);

  const savePackageMeta = useCallback(
    async (args: {
      packageId: number;
      description: string;
      coverUrl: string;
    }) => {
      const packageId = Number(args.packageId);
      const nextDescription = String(args.description ?? "").trim();
      const nextCoverUrl = String(args.coverUrl ?? "").trim();
      const detailKey = buildMaterialPackageDetailQueryKey(
        packageId,
        useBackend,
      );

      if (useBackend) {
        const updated = await updateMaterialPackage({
          packageId,
          description: nextDescription,
          coverUrl: nextCoverUrl || null,
        });
        queryClient.setQueryData(detailKey, updated);
        queryClient.setQueryData(listQueryKey, (prev) => {
          if (!Array.isArray(prev)) return prev;
          const list = prev as MaterialPackageRecord[];
          return list.map((p) =>
            Number(p.packageId) === packageId ? updated : p,
          );
        });
        queryClient.setQueryData(squareQueryKey, (prev) =>
          applyVisibilityToSquare(Array.isArray(prev) ? prev : [], updated),
        );
        return updated;
      }

      const baseList = Array.isArray(queryClient.getQueryData(listQueryKey))
        ? (queryClient.getQueryData(listQueryKey) as MaterialPackageRecord[])
        : readMockPackages();
      const base =
        baseList.find((p) => Number(p.packageId) === packageId) ?? null;
      if (!base) return null;
      const now = new Date().toISOString();
      const nextRecord: MaterialPackageRecord = {
        ...base,
        description: nextDescription,
        coverUrl: nextCoverUrl || null,
        updateTime: now,
      };
      const nextList = baseList.map((p) =>
        Number(p.packageId) === packageId ? nextRecord : p,
      );
      writeMockPackages(nextList);
      queryClient.setQueryData(listQueryKey, nextList);
      queryClient.setQueryData(detailKey, nextRecord);
      queryClient.setQueryData(squareQueryKey, (prev) =>
        applyVisibilityToSquare(Array.isArray(prev) ? prev : [], nextRecord),
      );
      return nextRecord;
    },
    [listQueryKey, queryClient, squareQueryKey, useBackend],
  );

  const savePackageVisibility = useCallback(
    async (args: { packageId: number; visibility: 0 | 1 }) => {
      const packageId = Number(args.packageId);
      const visibility = normalizePackageVisibility(args.visibility);
      const detailKey = buildMaterialPackageDetailQueryKey(
        packageId,
        useBackend,
      );

      if (useBackend) {
        const baseList = Array.isArray(queryClient.getQueryData(listQueryKey))
          ? (queryClient.getQueryData(listQueryKey) as MaterialPackageRecord[])
          : null;
        const baseRecord =
          baseList?.find((p) => Number(p.packageId) === packageId) ??
          findPackageById(packageId);

        const updated = await updateMaterialPackage({ packageId, visibility });
        const stableUpdated: MaterialPackageRecord = baseRecord?.updateTime
          ? { ...updated, updateTime: baseRecord.updateTime }
          : updated;

        queryClient.setQueryData(detailKey, stableUpdated);
        queryClient.setQueryData(listQueryKey, (prev) => {
          if (!Array.isArray(prev)) return prev;
          const list = prev as MaterialPackageRecord[];
          return list.map((p) =>
            Number(p.packageId) === packageId ? stableUpdated : p,
          );
        });
        queryClient.setQueryData(squareQueryKey, (prev) =>
          applyVisibilityToSquare(
            Array.isArray(prev) ? prev : [],
            stableUpdated,
          ),
        );
        return stableUpdated;
      }

      const baseList = Array.isArray(queryClient.getQueryData(listQueryKey))
        ? (queryClient.getQueryData(listQueryKey) as MaterialPackageRecord[])
        : readMockPackages();
      const baseRecord =
        baseList.find((p) => Number(p.packageId) === packageId) ??
        findPackageById(packageId);
      if (!baseRecord) return null;

      // For visibility toggles, keep list order stable and avoid bumping updateTime to prevent any sort-related surprises.
      const nextRecord: MaterialPackageRecord = { ...baseRecord, visibility };
      const nextList = baseList.map((p) =>
        Number(p.packageId) === packageId ? nextRecord : p,
      );
      writeMockPackages(nextList);
      queryClient.setQueryData(listQueryKey, nextList);
      queryClient.setQueryData(detailKey, nextRecord);
      queryClient.setQueryData(squareQueryKey, (prev) =>
        applyVisibilityToSquare(Array.isArray(prev) ? prev : [], nextRecord),
      );
      return nextRecord;
    },
    [findPackageById, listQueryKey, queryClient, squareQueryKey, useBackend],
  );

  const ensureRevealNode = useCallback((payload: MaterialPreviewPayload) => {
    const packageId = Number(payload.packageId ?? 0);
    const path = Array.isArray(payload.path) ? payload.path : [];

    const keysToExpand: string[] = [];
    keysToExpand.push(`root:${packageId}`);
    for (let i = 0; i < path.length; i++) {
      const part = path[i];
      if (typeof part !== "string" || !part.startsWith("folder:")) continue;
      keysToExpand.push(
        buildNodeKey({ packageId, path: path.slice(0, i + 1) }),
      );
    }

    setCollapsedByKey((prev) => {
      let changed = false;
      const next: Record<string, boolean> = { ...prev };
      for (const k of keysToExpand) {
        if (next[k] === true) {
          next[k] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    const targetKey =
      payload.kind === "package"
        ? `root:${packageId}`
        : buildNodeKey({ packageId, path });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const root = treeItemsRef.current;
        const el = root?.querySelector<HTMLElement>(
          `[data-node-key="${CSS.escape(targetKey)}"]`,
        );
        el?.scrollIntoView({ block: "nearest" });
      });
    });
  }, []);

  const ensureRevealNodeExpandAllChildren = useCallback(
    (payload: MaterialPreviewPayload) => {
      if (payload.kind !== "package" && payload.kind !== "folder") {
        ensureRevealNode(payload);
        return;
      }

      const packageId = Number(payload.packageId ?? 0);
      if (!Number.isFinite(packageId) || packageId <= 0) {
        ensureRevealNode(payload);
        return;
      }

      const pkg = findPackageById(packageId);
      if (!pkg) {
        ensureRevealNode(payload);
        return;
      }

      const baseContent = pkg.content ?? buildEmptyMaterialPackageContent();
      const rootNodes = Array.isArray(baseContent.root) ? baseContent.root : [];

      const folderNames =
        payload.kind === "folder" ? payloadPathToFolderNames(payload.path) : [];
      const basePath = folderNames.map((n) => `folder:${n}`);

      const keysToExpand: string[] = [];
      keysToExpand.push(`root:${packageId}`);
      if (payload.kind === "folder") {
        keysToExpand.push(buildNodeKey({ packageId, path: basePath }));
      }

      const walk = (nodes: MaterialNode[], currentPath: string[]) => {
        for (const node of nodes) {
          if (!node || node.type !== "folder") continue;
          const folderPath = [...currentPath, `folder:${node.name}`];
          keysToExpand.push(buildNodeKey({ packageId, path: folderPath }));
          walk(node.children ?? [], folderPath);
        }
      };

      try {
        if (payload.kind === "folder") {
          const children = getFolderNodesAtPath(baseContent, folderNames);
          walk(children, basePath);
        } else {
          walk(rootNodes, []);
        }
      } catch {
        // ignore traversal errors
      }

      setCollapsedByKey((prev) => {
        let changed = false;
        const next: Record<string, boolean> = { ...prev };
        for (const k of keysToExpand) {
          if (next[k] === true) {
            next[k] = false;
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      ensureRevealNode(payload);
    },
    [ensureRevealNode, findPackageById],
  );

  const closeInlineRename = useCallback(() => {
    setInlineRename(null);
  }, []);

  const closeInlineCreate = useCallback(() => {
    setInlineCreate(null);
  }, []);

  const closeTextMaterialEditor = useCallback(() => {
    setTextMaterialEditor(null);
  }, []);

  const saveTextMaterialEditor = useCallback(async () => {
    const snapshot = textMaterialEditor;
    if (!snapshot || snapshot.saving) return;

    setTextMaterialEditor((prev) => (prev ? { ...prev, saving: true } : prev));

    try {
      const pkg = findPackageById(snapshot.packageId);
      if (!pkg) {
        throw new Error("目标素材箱不存在或已被刷新。");
      }
      const baseContent = pkg.content ?? buildEmptyMaterialPackageContent();
      const nextContent = draftReplaceMaterialMessages(
        baseContent,
        snapshot.folderPath,
        snapshot.materialName,
        createDefaultTextMaterialMessages(snapshot.draft),
      );
      const nextContentWithNote = draftRenameMaterial(
        nextContent,
        snapshot.folderPath,
        snapshot.materialName,
        snapshot.materialName,
        snapshot.draft,
      );
      await savePackageContent({
        packageId: snapshot.packageId,
        nextContent: nextContentWithNote,
      });
      closeTextMaterialEditor();
    } catch (error) {
      setTextMaterialEditor((prev) =>
        prev ? { ...prev, saving: false } : prev,
      );
      const message = error instanceof Error ? error.message : "保存失败";
      toast.error(message);
    }
  }, [
    closeTextMaterialEditor,
    findPackageById,
    savePackageContent,
    textMaterialEditor,
  ]);

  useEffect(() => {
    if (!inlineRename) return;
    const t = window.setTimeout(() => {
      try {
        inlineRenameInputRef.current?.focus?.();
        inlineRenameInputRef.current?.select?.();
      } catch {
        // ignore focus errors
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [inlineRename]);

  useEffect(() => {
    if (!inlineCreate) return;
    const t = window.setTimeout(() => {
      try {
        inlineCreateInputRef.current?.focus?.();
        inlineCreateInputRef.current?.select?.();
      } catch {
        // ignore focus errors
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [inlineCreate]);

  const startInlineRename = useCallback(
    (args: {
      kind: "package" | "folder" | "material";
      key: string;
      packageId: number;
      folderPath: string[];
      name: string;
    }) => {
      const trimmed = String(args.name ?? "").trim();
      if (!trimmed) return;
      setInlineRename({
        kind: args.kind,
        key: args.key,
        packageId: Number(args.packageId),
        folderPath: Array.isArray(args.folderPath) ? args.folderPath : [],
        fromName: trimmed,
        draft: trimmed,
        saving: false,
      });
    },
    [],
  );

  const startInlineCreate = useCallback(
    (args: {
      kind: "package" | "folder" | "material";
      packageId?: number | null;
      folderPath?: string[];
      suggestedName: string;
    }) => {
      const suggested = String(args.suggestedName ?? "").trim();
      if (!suggested) return;

      closeInlineRename();
      const nowKey = `inline-create:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      setInlineCreate({
        kind: args.kind,
        key: nowKey,
        packageId: args.kind === "package" ? null : Number(args.packageId ?? 0),
        folderPath: Array.isArray(args.folderPath) ? args.folderPath : [],
        draft: suggested,
        saving: false,
      });
    },
    [closeInlineRename],
  );

  const savePackageName = useCallback(
    async (args: { packageId: number; nextName: string }) => {
      const packageId = Number(args.packageId);
      const trimmed = args.nextName.trim();
      if (!trimmed) return null;

      const detailKey = buildMaterialPackageDetailQueryKey(
        packageId,
        useBackend,
      );

      if (useBackend) {
        const updated = await updateMaterialPackage({
          packageId,
          name: trimmed,
        });
        queryClient.setQueryData(detailKey, updated);
        queryClient.setQueryData(listQueryKey, (prev) => {
          if (!Array.isArray(prev)) return prev;
          const list = prev as MaterialPackageRecord[];
          return list.map((p) =>
            Number(p.packageId) === packageId ? updated : p,
          );
        });
        queryClient.setQueryData(squareQueryKey, (prev) =>
          applyVisibilityToSquare(Array.isArray(prev) ? prev : [], updated),
        );
        return updated;
      }

      const baseList = Array.isArray(queryClient.getQueryData(listQueryKey))
        ? (queryClient.getQueryData(listQueryKey) as MaterialPackageRecord[])
        : readMockPackages();
      const base =
        baseList.find((p) => Number(p.packageId) === packageId) ?? null;
      if (!base) return null;
      const now = new Date().toISOString();
      const nextRecord: MaterialPackageRecord = {
        ...base,
        name: trimmed,
        updateTime: now,
      };
      const nextList = baseList.map((p) =>
        Number(p.packageId) === packageId ? nextRecord : p,
      );
      writeMockPackages(nextList);
      queryClient.setQueryData(listQueryKey, nextList);
      queryClient.setQueryData(detailKey, nextRecord);
      queryClient.setQueryData(squareQueryKey, (prev) =>
        applyVisibilityToSquare(Array.isArray(prev) ? prev : [], nextRecord),
      );
      return nextRecord;
    },
    [listQueryKey, queryClient, squareQueryKey, useBackend],
  );

  const commitInlineRename = useCallback(async () => {
    const snapshot = inlineRename;
    if (!snapshot || snapshot.saving) return;

    const trimmed = snapshot.draft.trim();
    if (!trimmed || trimmed === snapshot.fromName) {
      closeInlineRename();
      return;
    }

    setInlineRename((prev) => (prev ? { ...prev, saving: true } : prev));

    try {
      if (snapshot.kind === "package") {
        const baseNames = packages
          .filter((p) => Number(p.packageId) !== Number(snapshot.packageId))
          .map((p) => p.name ?? "");
        const finalName = autoRenameVsCodeLike(trimmed, baseNames);
        if (finalName !== trimmed) {
          window.alert(`名称已存在，已自动重命名为「${finalName}」。`);
        }
        await savePackageName({
          packageId: snapshot.packageId,
          nextName: finalName,
        });
        setSelectedNode((prev) => {
          if (!prev || prev.kind !== "package") return prev;
          if (
            Number(prev.payload.packageId ?? 0) !== Number(snapshot.packageId)
          )
            return prev;
          return { ...prev, payload: { ...prev.payload, label: finalName } };
        });
        closeInlineRename();
        return;
      }

      const pkg = findPackageById(snapshot.packageId);
      if (!pkg) throw new Error("目标素材箱不存在或已被刷新。");
      const baseContent = pkg.content ?? buildEmptyMaterialPackageContent();

      const parentPath =
        snapshot.kind === "folder"
          ? snapshot.folderPath.slice(0, -1)
          : snapshot.folderPath;
      const siblings = getFolderNodesAtPath(baseContent, parentPath);
      const usedNames = siblings
        .map((n) => n.name)
        .filter((n) => n !== snapshot.fromName);
      const finalName = autoRenameVsCodeLike(trimmed, usedNames);
      if (finalName !== trimmed) {
        window.alert(`名称已存在，已自动重命名为「${finalName}」。`);
      }

      if (snapshot.kind === "folder") {
        const from = snapshot.fromName;
        const nextContent = draftRenameFolder(
          baseContent,
          parentPath,
          from,
          finalName,
        );
        await savePackageContent({
          packageId: snapshot.packageId,
          nextContent,
        });

        const path = [
          ...parentPath.map((n) => `folder:${n}`),
          `folder:${finalName}`,
        ];
        const payload = toPreviewPayload({
          kind: "folder",
          packageId: snapshot.packageId,
          label: finalName,
          path,
        });
        const key = buildNodeKey({ packageId: snapshot.packageId, path });
        setSelectedNode({ kind: "folder", key, payload });
        ensureRevealNode(payload);
        closeInlineRename();
        return;
      }

      const from = snapshot.fromName;
      const existingNote =
        (siblings.find((n) => n.type === "material" && n.name === from) as any)
          ?.note ?? "";
      const nextContent = draftRenameMaterial(
        baseContent,
        snapshot.folderPath,
        from,
        finalName,
        existingNote,
      );
      await savePackageContent({ packageId: snapshot.packageId, nextContent });

      const path = [
        ...snapshot.folderPath.map((n) => `folder:${n}`),
        `material:${finalName}`,
      ];
      const payload = toPreviewPayload({
        kind: "material",
        packageId: snapshot.packageId,
        label: finalName,
        path,
      });
      const key = buildNodeKey({ packageId: snapshot.packageId, path });
      setSelectedNode({ kind: "material", key, payload });
      ensureRevealNode(payload);
      closeInlineRename();
    } catch (error) {
      setInlineRename((prev) => (prev ? { ...prev, saving: false } : prev));
      const message = error instanceof Error ? error.message : "重命名失败";
      window.alert(message);
    }
  }, [
    closeInlineRename,
    ensureRevealNode,
    findPackageById,
    inlineRename,
    packages,
    savePackageContent,
    savePackageName,
  ]);

  const commitInlineCreate = useCallback(async () => {
    const snapshot = inlineCreate;
    if (!snapshot || snapshot.saving) return;

    const trimmed = snapshot.draft.trim();
    if (!trimmed) {
      closeInlineCreate();
      return;
    }

    setInlineCreate((prev) => (prev ? { ...prev, saving: true } : prev));

    try {
      if (snapshot.kind === "package") {
        const baseNames = packages.map((p) => p.name ?? "");
        const finalName = autoRenameVsCodeLike(trimmed, baseNames);
        const content = buildEmptyMaterialPackageContent();

        if (useBackend) {
          const created = await createMaterialPackage({
            name: finalName,
            content,
          });
          const createdId = Number(created.packageId);
          setDefaultTargetPackageId(createdId);
          queryClient.setQueryData(
            buildMaterialPackageDetailQueryKey(createdId, useBackend),
            created,
          );
          queryClient.setQueryData(listQueryKey, (prev) => {
            if (!Array.isArray(prev)) return [created];
            return [created, ...(prev as MaterialPackageRecord[])];
          });
          queryClient.setQueryData(squareQueryKey, (prev) =>
            applyVisibilityToSquare(Array.isArray(prev) ? prev : [], created),
          );
          const key = `root:${createdId}`;
          const payload = toPreviewPayload({
            kind: "package",
            packageId: createdId,
            label: created.name,
            path: [],
          });
          setSelectedNode({ kind: "package", key, payload });
          ensureRevealNode(payload);
          closeInlineCreate();
          return;
        }

        const now = new Date().toISOString();
        const base = Array.isArray(queryClient.getQueryData(listQueryKey))
          ? (queryClient.getQueryData(listQueryKey) as MaterialPackageRecord[])
          : readMockPackages();
        const nextId =
          (base ?? []).reduce(
            (acc, p) => Math.max(acc, Number(p.packageId) || 0),
            0,
          ) + 1;
        const created: MaterialPackageRecord = {
          packageId: nextId,
          userId: 0,
          name: finalName,
          description: "",
          coverUrl: null,
          visibility: 1,
          status: 0,
          importCount: 0,
          createTime: now,
          updateTime: now,
          content,
        };
        const nextList = [created, ...(base ?? [])];
        saveMockList(nextList);
        queryClient.setQueryData(
          buildMaterialPackageDetailQueryKey(nextId, useBackend),
          created,
        );
        queryClient.setQueryData(squareQueryKey, (prev) =>
          applyVisibilityToSquare(Array.isArray(prev) ? prev : [], created),
        );
        setDefaultTargetPackageId(nextId);
        const key = `root:${nextId}`;
        const payload = toPreviewPayload({
          kind: "package",
          packageId: nextId,
          label: created.name,
          path: [],
        });
        setSelectedNode({ kind: "package", key, payload });
        ensureRevealNode(payload);
        closeInlineCreate();
        return;
      }

      const packageId = Number(snapshot.packageId ?? 0);
      if (!Number.isFinite(packageId) || packageId <= 0)
        throw new Error("目标素材箱不存在或已被刷新。");

      const pkg = findPackageById(packageId);
      if (!pkg) throw new Error("目标素材箱不存在或已被刷新。");
      const baseContent = pkg.content ?? buildEmptyMaterialPackageContent();
      const nodes = getFolderNodesAtPath(baseContent, snapshot.folderPath);
      const usedNames = nodes.map((n) => n.name);
      const finalName = autoRenameVsCodeLike(trimmed, usedNames);

      if (snapshot.kind === "folder") {
        const nextContent = draftCreateFolder(
          baseContent,
          snapshot.folderPath,
          finalName,
        );
        await savePackageContent({ packageId, nextContent });
        const path = [
          ...snapshot.folderPath.map((n) => `folder:${n}`),
          `folder:${finalName}`,
        ];
        const payload = toPreviewPayload({
          kind: "folder",
          packageId,
          label: finalName,
          path,
        });
        const key = buildNodeKey({ packageId, path });
        setSelectedNode({ kind: "folder", key, payload });
        ensureRevealNode(payload);
        closeInlineCreate();
        return;
      }

      const material: MaterialItemNode = {
        type: "material",
        name: finalName,
        note: "",
        messages: createDefaultTextMaterialMessages(),
      };
      const nextContent = draftCreateMaterial(
        baseContent,
        snapshot.folderPath,
        material,
      );
      await savePackageContent({ packageId, nextContent });
      const path = [
        ...snapshot.folderPath.map((n) => `folder:${n}`),
        `material:${finalName}`,
      ];
      const payload = toPreviewPayload({
        kind: "material",
        packageId,
        label: finalName,
        path,
      });
      const key = buildNodeKey({ packageId, path });
      setSelectedNode({ kind: "material", key, payload });
      ensureRevealNode(payload);
      setTextMaterialEditor({
        packageId,
        folderPath: [...snapshot.folderPath],
        materialName: finalName,
        draft: "",
        saving: false,
      });
      closeInlineCreate();
    } catch (error) {
      setInlineCreate((prev) => (prev ? { ...prev, saving: false } : prev));
      const message = error instanceof Error ? error.message : "新建失败";
      toast.error(message);
    }
  }, [
    closeInlineCreate,
    ensureRevealNode,
    findPackageById,
    inlineCreate,
    listQueryKey,
    packages,
    queryClient,
    saveMockList,
    savePackageContent,
    squareQueryKey,
    useBackend,
  ]);

  const buildMessagesFromFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      const isImage = /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(lower);
      const isAudio = /\.(mp3|wav|ogg|flac|m4a)$/i.test(lower);
      const isText = /\.(txt|md)$/i.test(lower);

      if (isImage) {
        return [
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
      }

      if (isAudio) {
        return [
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
      }

      if (isText) {
        const text = await file.text().catch(() => "");
        return [
          {
            messageType: 1,
            content: text,
            annotations: ["文本"],
            extra: {},
          },
        ];
      }

      return [
        {
          messageType: 1,
          content: file.name,
          annotations: ["文件"],
          extra: {},
        },
      ];
    },
    [useBackend],
  );

  const applyImportFiles = useCallback(
    async (args: {
      target: { packageId: number; folderPath: string[] };
      files: File[];
      policy: "overwrite" | "autoRename";
    }) => {
      const pkg = findPackageById(args.target.packageId);
      if (!pkg) {
        window.alert("目标素材箱不存在或已被刷新。");
        return;
      }
      const baseContent = pkg.content ?? buildEmptyMaterialPackageContent();
      const nodes = getFolderNodesAtPath(baseContent, args.target.folderPath);
      const existingByName = new Map(nodes.map((n) => [n.name, n] as const));
      const usedNames = new Set(nodes.map((n) => n.name));

      const overwrittenOnce = new Set<string>();
      let nextContent = baseContent;
      let lastInserted: {
        payload: MaterialPreviewPayload;
        key: string;
      } | null = null;

      for (const file of args.files) {
        const baseName = file.name;
        const existing = existingByName.get(baseName);
        const canOverwrite =
          args.policy === "overwrite" &&
          existing?.type === "material" &&
          !overwrittenOnce.has(baseName);

        const messages = await buildMessagesFromFile(file);

        if (canOverwrite) {
          overwrittenOnce.add(baseName);
          nextContent = draftReplaceMaterialMessages(
            nextContent,
            args.target.folderPath,
            baseName,
            messages,
          );
          const path = [
            ...args.target.folderPath.map((n) => `folder:${n}`),
            `material:${baseName}`,
          ];
          const payload = toPreviewPayload({
            kind: "material",
            packageId: args.target.packageId,
            label: baseName,
            path,
          });
          lastInserted = {
            payload,
            key: buildNodeKey({ packageId: args.target.packageId, path }),
          };
          continue;
        }

        let finalName = baseName;
        if (usedNames.has(finalName)) {
          finalName = autoRenameVsCodeLike(finalName, usedNames);
        }
        usedNames.add(finalName);

        const material: MaterialItemNode = {
          type: "material",
          name: finalName,
          note: "",
          messages,
        };
        nextContent = draftCreateMaterial(
          nextContent,
          args.target.folderPath,
          material,
        );
        const path = [
          ...args.target.folderPath.map((n) => `folder:${n}`),
          `material:${finalName}`,
        ];
        const payload = toPreviewPayload({
          kind: "material",
          packageId: args.target.packageId,
          label: finalName,
          path,
        });
        lastInserted = {
          payload,
          key: buildNodeKey({ packageId: args.target.packageId, path }),
        };
      }

      await savePackageContent({
        packageId: args.target.packageId,
        nextContent,
      });
      setPendingImportTarget(null);
      setPendingImportDialog(null);

      if (lastInserted) {
        setSelectedNode({
          kind: "material",
          key: lastInserted.key,
          payload: lastInserted.payload,
        });
        ensureRevealNode(lastInserted.payload);
      }
    },
    [
      buildMessagesFromFile,
      ensureRevealNode,
      findPackageById,
      savePackageContent,
    ],
  );

  const runToolbarNewFile = useCallback(
    (targetOverride?: { packageId: number; folderPath: string[] }) => {
      const resolved = targetOverride
        ? ({
            status: "ok",
            packageId: targetOverride.packageId,
            folderPath: targetOverride.folderPath,
          } as const)
        : resolveTarget({ selectedNode, packages, defaultTargetPackageId });
      if (resolved.status === "blocked") {
        toast.error("请先创建一个素材箱。");
        return;
      }
      if (resolved.status === "need-choose-package") {
        setPendingChoosePackage({ action: "new-file" });
        return;
      }

      const packageId = Number(resolved.packageId);
      const pkg = findPackageById(packageId);
      if (!pkg) {
        toast.error("目标素材箱不存在或已被刷新。");
        return;
      }

      const parentPayload = resolved.folderPath.length
        ? toPreviewPayload({
            kind: "folder",
            packageId,
            label: resolved.folderPath[resolved.folderPath.length - 1] ?? "",
            path: resolved.folderPath.map((n) => `folder:${n}`),
          })
        : toPreviewPayload({
            kind: "package",
            packageId,
            label: pkg.name ?? `素材包#${packageId}`,
            path: [],
          });
      ensureRevealNode(parentPayload);
      startInlineCreate({
        kind: "material",
        packageId,
        folderPath: resolved.folderPath,
        suggestedName: "新文本素材",
      });
    },
    [
      defaultTargetPackageId,
      ensureRevealNode,
      findPackageById,
      packages,
      selectedNode,
      startInlineCreate,
    ],
  );

  const runToolbarNewFolder = useCallback(
    (targetOverride?: { packageId: number; folderPath: string[] }) => {
      const resolved = targetOverride
        ? ({
            status: "ok",
            packageId: targetOverride.packageId,
            folderPath: targetOverride.folderPath,
          } as const)
        : resolveTarget({ selectedNode, packages, defaultTargetPackageId });
      if (resolved.status === "blocked") {
        toast.error("请先创建一个素材箱。");
        return;
      }
      if (resolved.status === "need-choose-package") {
        setPendingChoosePackage({ action: "new-folder" });
        return;
      }

      const packageId = Number(resolved.packageId);
      const pkg = findPackageById(packageId);
      if (!pkg) {
        toast.error("目标素材箱不存在或已被刷新。");
        return;
      }

      const parentPayload = resolved.folderPath.length
        ? toPreviewPayload({
            kind: "folder",
            packageId,
            label: resolved.folderPath[resolved.folderPath.length - 1] ?? "",
            path: resolved.folderPath.map((n) => `folder:${n}`),
          })
        : toPreviewPayload({
            kind: "package",
            packageId,
            label: pkg.name ?? `素材包#${packageId}`,
            path: [],
          });
      ensureRevealNode(parentPayload);
      startInlineCreate({
        kind: "folder",
        packageId,
        folderPath: resolved.folderPath,
        suggestedName: "新建文件夹",
      });
    },
    [
      defaultTargetPackageId,
      ensureRevealNode,
      findPackageById,
      packages,
      selectedNode,
      startInlineCreate,
    ],
  );

  const handleToolbarNewPackage = useCallback(() => {
    startInlineCreate({ kind: "package", suggestedName: "新素材箱" });
  }, [startInlineCreate]);

  const handleToolbarImport = useCallback(() => {
    const resolved = resolveTarget({
      selectedNode,
      packages,
      defaultTargetPackageId,
    });
    if (resolved.status === "blocked") {
      window.alert("请先创建一个素材箱。");
      return;
    }
    if (resolved.status === "need-choose-package") {
      setPendingChoosePackage({ action: "import" });
      return;
    }
    setPendingImportTarget({
      packageId: resolved.packageId,
      folderPath: resolved.folderPath,
    });
    const el = importInputRef.current;
    if (!el) return;
    el.value = "";
    el.click();
  }, [defaultTargetPackageId, packages, selectedNode]);

  const handleImportChange = useCallback(async () => {
    const el = importInputRef.current;
    if (!el) return;
    const files = Array.from(el.files || []);
    if (!files.length) return;

    const target =
      pendingImportTarget ??
      ((): { packageId: number; folderPath: string[] } | null => {
        const resolved = resolveTarget({
          selectedNode,
          packages,
          defaultTargetPackageId,
        });
        if (resolved.status !== "ok") return null;
        return {
          packageId: resolved.packageId,
          folderPath: resolved.folderPath,
        };
      })();

    if (!target) {
      window.alert("请选择一个素材箱后再导入。");
      return;
    }

    const pkg = findPackageById(target.packageId);
    const baseContent = pkg?.content ?? buildEmptyMaterialPackageContent();
    const nodes = getFolderNodesAtPath(baseContent, target.folderPath);
    const existingNames = new Set(nodes.map((n) => n.name));
    const folderNames = new Set(
      nodes.filter((n) => n.type === "folder").map((n) => n.name),
    );
    const seenInBatch = new Set<string>();

    let hasConflict = false;
    for (const f of files) {
      if (
        existingNames.has(f.name) ||
        seenInBatch.has(f.name) ||
        folderNames.has(f.name)
      ) {
        hasConflict = true;
        break;
      }
      seenInBatch.add(f.name);
    }

    if (hasConflict) {
      setPendingImportDialog({ target, files });
      return;
    }

    await applyImportFiles({ target, files, policy: "autoRename" });
  }, [
    applyImportFiles,
    defaultTargetPackageId,
    findPackageById,
    packages,
    pendingImportTarget,
    selectedNode,
  ]);

  const handleToolbarRefresh = useCallback(() => {
    packagesQuery.refetch();
  }, [packagesQuery]);

  const handleToolbarDelete = useCallback(() => {
    if (!selectedNode?.payload) {
      window.alert("请先选择一个文件/文件夹/素材箱。");
      return;
    }

    const packageId = Number(selectedNode.payload.packageId ?? 0);
    const pkg = findPackageById(packageId);
    if (!pkg) {
      window.alert("目标素材箱不存在或已被刷新。");
      return;
    }

    if (selectedNode.kind === "package") {
      setPendingDeleteDialog({
        kind: "package",
        packageId,
        label: pkg.name ?? `素材包#${packageId}`,
        saving: false,
      });
      return;
    }

    const folderPath = payloadPathToFolderNames(selectedNode.payload.path);
    if (selectedNode.kind === "folder") {
      const label =
        folderPath[folderPath.length - 1] ??
        selectedNode.payload.label ??
        "文件夹";
      setPendingDeleteDialog({
        kind: "folder",
        packageId,
        folderPath,
        label,
        saving: false,
      });
      return;
    }

    const materialName =
      payloadPathToMaterialName(selectedNode.payload.path) ??
      selectedNode.payload.label ??
      "";
    if (!materialName) {
      window.alert("无法解析要删除的文件名称。");
      return;
    }
    setPendingDeleteDialog({
      kind: "material",
      packageId,
      folderPath,
      materialName,
      label: materialName,
      saving: false,
    });
  }, [findPackageById, selectedNode?.kind, selectedNode?.payload]);

  const runDeleteConfirmed = useCallback(
    async (dialog: PendingDeleteDialog) => {
      if (dialog.kind === "package") {
        setPendingDeleteDialog((prev) =>
          prev ? ({ ...prev, saving: true } as PendingDeleteDialog) : prev,
        );
        try {
          const packageId = Number(dialog.packageId);
          const detailKey = buildMaterialPackageDetailQueryKey(
            packageId,
            useBackend,
          );

          if (useBackend) {
            await deleteMaterialPackage(packageId);
          } else {
            const base = Array.isArray(queryClient.getQueryData(listQueryKey))
              ? (queryClient.getQueryData(
                  listQueryKey,
                ) as MaterialPackageRecord[])
              : readMockPackages();
            const nextList = (base ?? []).filter(
              (p) => Number(p.packageId) !== packageId,
            );
            writeMockPackages(nextList);
            queryClient.setQueryData(listQueryKey, nextList);
          }

          queryClient.removeQueries({ queryKey: detailKey });
          queryClient.setQueryData(listQueryKey, (prev) => {
            if (!Array.isArray(prev)) return prev;
            const list = prev as MaterialPackageRecord[];
            return list.filter((p) => Number(p.packageId) !== packageId);
          });
          queryClient.setQueryData(squareQueryKey, (prev) =>
            removeSquareRecord(Array.isArray(prev) ? prev : [], packageId),
          );

          setCollapsedByKey((prev) => {
            const next: Record<string, boolean> = {};
            const rootPrefix = `root:${packageId}`;
            const folderPrefix = `pkg:${packageId}:`;
            Object.entries(prev).forEach(([key, value]) => {
              if (key === rootPrefix || key.startsWith(folderPrefix)) return;
              next[key] = value;
            });
            return next;
          });

          setPendingDeleteDialog(null);
          setVisibilityEditor((prev) =>
            prev?.packageId === packageId ? null : prev,
          );

          setSelectedNode((prev) => {
            if (!prev) return prev;
            if (Number(prev.payload.packageId ?? 0) === packageId) return null;
            return prev;
          });
          setDefaultTargetPackageId((prev) =>
            Number(prev ?? 0) === packageId ? null : prev,
          );
        } catch (error) {
          setPendingDeleteDialog((prev) =>
            prev ? ({ ...prev, saving: false } as PendingDeleteDialog) : prev,
          );
          const message = error instanceof Error ? error.message : "删除失败";
          window.alert(message);
        }

        return;
      }

      if (dialog.kind === "folder") {
        const folderName =
          dialog.folderPath[dialog.folderPath.length - 1] ?? dialog.label;
        setPendingDeleteDialog((prev) =>
          prev ? ({ ...prev, saving: true } as PendingDeleteDialog) : prev,
        );
        try {
          const pkg = findPackageById(dialog.packageId);
          if (!pkg) throw new Error("目标素材箱不存在或已被刷新。");
          const baseContent = pkg.content ?? buildEmptyMaterialPackageContent();
          const parentPath = dialog.folderPath.slice(0, -1);
          const nextContent = draftDeleteFolder(
            baseContent,
            parentPath,
            folderName,
          );
          await savePackageContent({
            packageId: dialog.packageId,
            nextContent,
          });

          const packageLabel = pkg.name ?? `素材包#${dialog.packageId}`;
          const payload = toPreviewPayload({
            kind: "package",
            packageId: dialog.packageId,
            label: packageLabel,
            path: [],
          });
          setSelectedNode({
            kind: "package",
            key: `root:${dialog.packageId}`,
            payload,
          });
          ensureRevealNode(payload);
          setPendingDeleteDialog(null);
        } catch (error) {
          setPendingDeleteDialog((prev) =>
            prev ? ({ ...prev, saving: false } as PendingDeleteDialog) : prev,
          );
          const message = error instanceof Error ? error.message : "删除失败";
          window.alert(message);
        }

        return;
      }

      setPendingDeleteDialog((prev) =>
        prev ? ({ ...prev, saving: true } as PendingDeleteDialog) : prev,
      );
      try {
        const pkg = findPackageById(dialog.packageId);
        if (!pkg) throw new Error("目标素材箱不存在或已被刷新。");
        const baseContent = pkg.content ?? buildEmptyMaterialPackageContent();
        const nextContent = draftDeleteMaterial(
          baseContent,
          dialog.folderPath,
          dialog.materialName,
        );
        await savePackageContent({ packageId: dialog.packageId, nextContent });

        const packageLabel = pkg.name ?? `素材包#${dialog.packageId}`;
        const payload = toPreviewPayload({
          kind: "package",
          packageId: dialog.packageId,
          label: packageLabel,
          path: [],
        });
        setSelectedNode({
          kind: "package",
          key: `root:${dialog.packageId}`,
          payload,
        });
        ensureRevealNode(payload);
        setPendingDeleteDialog(null);
      } catch (error) {
        setPendingDeleteDialog((prev) =>
          prev ? ({ ...prev, saving: false } as PendingDeleteDialog) : prev,
        );
        const message = error instanceof Error ? error.message : "删除失败";
        window.alert(message);
      }
    },
    [
      ensureRevealNode,
      findPackageById,
      listQueryKey,
      queryClient,
      savePackageContent,
      setCollapsedByKey,
      squareQueryKey,
      useBackend,
    ],
  );

  const handleToolbarReveal = useCallback(() => {
    if (selectedNode?.payload) {
      if (
        selectedNode.payload.kind === "package" ||
        selectedNode.payload.kind === "folder"
      ) {
        ensureRevealNodeExpandAllChildren(selectedNode.payload);
      } else {
        ensureRevealNode(selectedNode.payload);
      }
      return;
    }
    if (defaultTargetPackageId != null) {
      const pkg = findPackageById(defaultTargetPackageId);
      if (!pkg) return;
      const payload = toPreviewPayload({
        kind: "package",
        packageId: Number(pkg.packageId),
        label: pkg.name ?? `素材包#${pkg.packageId}`,
        path: [],
      });
      ensureRevealNodeExpandAllChildren(payload);
      return;
    }
    if (packages.length === 1) {
      const pkg = packages[0]!;
      const payload = toPreviewPayload({
        kind: "package",
        packageId: Number(pkg.packageId),
        label: pkg.name ?? `素材包#${pkg.packageId}`,
        path: [],
      });
      ensureRevealNodeExpandAllChildren(payload);
    }
  }, [
    defaultTargetPackageId,
    ensureRevealNode,
    ensureRevealNodeExpandAllChildren,
    findPackageById,
    packages,
    selectedNode,
  ]);

  const handleToolbarNewFile = useCallback(() => {
    void runToolbarNewFile();
  }, [runToolbarNewFile]);

  const handleToolbarNewFolder = useCallback(() => {
    void runToolbarNewFolder();
  }, [runToolbarNewFolder]);

  useEffect(() => {
    if (!pendingChoosePackage) return;
    const first = packages[0]?.packageId ?? null;
    setPendingChoosePackageId(first != null ? Number(first) : null);
  }, [packages, pendingChoosePackage]);

  const maybeTriggerByDoubleClick = useCallback(
    (
      event: React.MouseEvent,
      key: string,
      action: "open" | "rename",
      run: () => void,
    ) => {
      // NOTE: 线上反馈里 dblclick / event.detail 在部分环境不稳定，这里手动做“双击检测”兜底
      const nowMs = Date.now();
      const prev = lastClickRef.current;
      lastClickRef.current = { key, action, timeMs: nowMs };
      const isSameTarget = prev?.key === key && prev?.action === action;
      const isWithinWindow =
        typeof prev?.timeMs === "number" && nowMs - prev.timeMs <= 350;
      if (!isSameTarget || !isWithinWindow) return;

      lastClickRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      run();
    },
    [],
  );

  type VisibleItem =
    | {
        kind: "package";
        key: string;
        depth: number;
        baseIndex: number;
        isCollapsed: boolean;
        nodeCount: number;
        label: string;
        payload: MaterialPreviewPayload;
      }
    | {
        kind: "folder";
        key: string;
        depth: number;
        baseIndex: number;
        isCollapsed: boolean;
        name: string;
        payload: MaterialPreviewPayload;
      }
    | {
        kind: "material";
        key: string;
        depth: number;
        baseIndex: number;
        name: string;
        payload: MaterialPreviewPayload;
      }
    | {
        kind: "inlineCreate";
        key: string;
        depth: number;
        createKind: "package" | "folder" | "material";
        packageId: number | null;
        folderPath: string[];
      }
    | {
        kind: "dockPreview";
        key: "dock-preview";
        depth: number;
        payload: MaterialPreviewPayload;
      };

  const baseVisibleItems = useMemo(() => {
    const items: VisibleItem[] = [];

    const pushNode = (
      packageId: number,
      node: MaterialNode,
      path: string[],
      depth: number,
    ) => {
      const indent = depth * 14;
      if (node.type === "folder") {
        const key = buildNodeKey({ packageId, path });
        const isCollapsed = Boolean(collapsedByKey[key]);
        const payload = toPreviewPayload({
          kind: "folder",
          packageId,
          label: node.name,
          path,
        });
        items.push({
          kind: "folder",
          key,
          depth: indent,
          baseIndex: items.length,
          isCollapsed,
          name: node.name,
          payload,
        });
        if (!isCollapsed) {
          for (const child of node.children) {
            const childPath = [
              ...path,
              child.type === "folder"
                ? `folder:${child.name}`
                : `material:${child.name}`,
            ];
            pushNode(packageId, child, childPath, depth + 1);
          }
        }
        return;
      }

      const key = buildNodeKey({ packageId, path });
      const payload = toPreviewPayload({
        kind: "material",
        packageId,
        label: node.name,
        path,
      });
      items.push({
        kind: "material",
        key,
        depth: indent,
        baseIndex: items.length,
        name: node.name,
        payload,
      });
    };

    for (const pkg of packages) {
      const packageId = Number(pkg.packageId ?? 0);
      const rootKey = `root:${packageId}`;
      const isCollapsed = Boolean(collapsedByKey[rootKey]);
      const label = pkg.name ?? `素材包#${packageId}`;
      const packagePayload = toPreviewPayload({
        kind: "package",
        packageId,
        label,
        path: [],
      });
      const rootNodes = Array.isArray(pkg.content?.root)
        ? pkg.content.root
        : [];

      items.push({
        kind: "package",
        key: rootKey,
        depth: 0,
        baseIndex: items.length,
        isCollapsed,
        nodeCount: rootNodes.length,
        label,
        payload: packagePayload,
      });

      if (isCollapsed) {
        continue;
      }

      for (const node of rootNodes) {
        const name =
          node?.type === "folder"
            ? node.name
            : node?.type === "material"
              ? node.name
              : "未知节点";
        const nextPath = [
          node.type === "folder" ? `folder:${name}` : `material:${name}`,
        ];
        pushNode(packageId, node, nextPath, 1);
      }
    }

    return items;
  }, [collapsedByKey, packages]);

  const baseItemCount = baseVisibleItems.length;
  const resolvedDockIndex = useMemo(
    () => clampInt(dockedIndex, 0, baseItemCount),
    [baseItemCount, dockedIndex],
  );
  const dockContextId = "material-package";

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      if (detail?.contextId != null && detail.contextId !== dockContextId) {
        return;
      }
      if (!detail || detail.visible === false) {
        clearDockHint();
        return;
      }
      if (typeof detail.index === "number" && Number.isFinite(detail.index)) {
        const index = clampInt(Math.floor(detail.index), 0, baseItemCount);
        const text =
          typeof detail.text === "string" ? detail.text : "插入到这里";
        applyDockHint({ index, text });
        return;
      }

      const kind: "top" | "bottom" = detail.kind === "top" ? "top" : "bottom";
      const index = kind === "top" ? 0 : baseItemCount;
      const text =
        typeof detail.text === "string"
          ? detail.text
          : kind === "top"
            ? "插入到顶部"
            : "插入到底部";
      applyDockHint({ index, text });
    };
    window.addEventListener(
      "tc:material-package:dock-hint",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "tc:material-package:dock-hint",
        handler as EventListener,
      );
  }, [applyDockHint, baseItemCount, clearDockHint, dockContextId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      if (detail?.contextId != null && detail.contextId !== dockContextId) {
        return;
      }
      const index =
        typeof detail?.index === "number" && Number.isFinite(detail.index)
          ? clampInt(Math.floor(detail.index), 0, baseItemCount)
          : null;
      if (index == null) {
        return;
      }
      onMoveDockedPreview(index);
    };
    window.addEventListener(
      "tc:material-package:dock-move",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "tc:material-package:dock-move",
        handler as EventListener,
      );
  }, [baseItemCount, dockContextId, onMoveDockedPreview]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      if (detail?.contextId !== dockContextId) {
        return;
      }
      const payload = detail?.payload as MaterialPreviewPayload | null;
      if (!payload) return;
      const index =
        typeof detail?.index === "number" && Number.isFinite(detail.index)
          ? clampInt(Math.floor(detail.index), 0, baseItemCount)
          : 0;
      onDockPreview(payload, { index });
    };
    window.addEventListener(
      "tc:material-package:dock-request",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "tc:material-package:dock-request",
        handler as EventListener,
      );
  }, [baseItemCount, dockContextId, onDockPreview]);

  const visibleItems = useMemo(() => {
    const withDock = (() => {
      if (!dockedPreview) {
        return baseVisibleItems;
      }
      const next = [...baseVisibleItems];
      next.splice(resolvedDockIndex, 0, {
        kind: "dockPreview",
        key: "dock-preview",
        depth: 0,
        payload: dockedPreview,
      });
      return next;
    })();

    if (!inlineCreate) {
      return withDock;
    }

    const next = [...withDock];

    if (inlineCreate.kind === "package") {
      const firstNonDock = next.findIndex(
        (it) => (it as any)?.kind !== "dockPreview",
      );
      next.splice(firstNonDock >= 0 ? firstNonDock : 0, 0, {
        kind: "inlineCreate",
        key: inlineCreate.key,
        depth: 0,
        createKind: "package",
        packageId: null,
        folderPath: [],
      });
      return next;
    }

    const packageId = Number(inlineCreate.packageId ?? 0);
    const folderPath = Array.isArray(inlineCreate.folderPath)
      ? inlineCreate.folderPath
      : [];
    const parentKey = folderPath.length
      ? buildNodeKey({ packageId, path: folderPath.map((n) => `folder:${n}`) })
      : `root:${packageId}`;
    const parentIndex = next.findIndex((it) => (it as any)?.key === parentKey);
    const parentDepth =
      parentIndex >= 0
        ? ((next[parentIndex] as any)?.depth ?? 0)
        : folderPath.length
          ? 14
          : 0;
    let insertIndex = parentIndex >= 0 ? parentIndex + 1 : 0;
    if (parentIndex >= 0) {
      for (let i = parentIndex + 1; i < next.length; i++) {
        const it = next[i] as any;
        if (it?.kind === "dockPreview") {
          continue;
        }
        const depth = typeof it?.depth === "number" ? it.depth : null;
        if (depth == null) {
          continue;
        }
        if (depth <= parentDepth) {
          insertIndex = i;
          break;
        }
        insertIndex = i + 1;
      }
    }
    next.splice(insertIndex, 0, {
      kind: "inlineCreate",
      key: inlineCreate.key,
      depth: parentDepth + 14,
      createKind: inlineCreate.kind,
      packageId,
      folderPath,
    });
    return next;
  }, [baseVisibleItems, dockedPreview, inlineCreate, resolvedDockIndex]);

  const computeInsertIndex = useCallback(
    (clientY: number) => {
      const root = treeItemsRef.current;
      if (!root) {
        return baseItemCount;
      }
      const rows = Array.from(
        root.querySelectorAll<HTMLElement>(
          "[data-role='material-package-visible-row'][data-base-index]",
        ),
      );
      if (!rows.length) {
        return 0;
      }
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (clientY < mid) {
          const idx = Number(row.dataset.baseIndex ?? 0);
          return Number.isFinite(idx)
            ? clampInt(Math.floor(idx), 0, baseItemCount)
            : 0;
        }
      }
      return baseItemCount;
    },
    [baseItemCount],
  );

  const renderVisibleItem = useCallback(
    (item: VisibleItem, _renderIndex: number) => {
      if (item.kind === "dockPreview") {
        return (
          <div
            key={item.key}
            className="px-1 rounded-md"
            data-role="material-package-visible-row"
            data-dock-preview="1"
          >
            <div className="rounded-lg border border-base-300 bg-base-200/40 overflow-hidden">
              <div className="h-[360px]">
                <MaterialPreviewFloat
                  variant="embedded"
                  payload={item.payload}
                  onClose={onUndockPreview}
                  onDock={onDockPreview}
                  dragOrigin="docked"
                  dockContextId={dockContextId}
                  onPopout={(payload, options) => {
                    onUndockPreview();
                    onOpenPreview(payload, options?.initialPosition ?? null);
                  }}
                  initialPosition={null}
                />
              </div>
            </div>
          </div>
        );
      }

      if (item.kind === "inlineCreate") {
        const snapshot = inlineCreate;
        if (!snapshot || snapshot.key !== item.key) {
          return null;
        }

        if (snapshot.kind === "package") {
          return (
            <div
              key={item.key}
              className="px-1 rounded-md"
              data-role="material-package-visible-row"
            >
              <div className="flex items-center gap-1 py-1 pr-1 text-xs font-medium opacity-90 select-none rounded-md bg-base-300/40 ring-1 ring-info/20">
                <span
                  className="inline-flex w-[28px] justify-center"
                  aria-hidden="true"
                ></span>
                <PackageIcon className="size-4 opacity-70" weight="bold" />
                <div className="flex-1 min-w-0 relative">
                  <span
                    ref={inlineCreateMeasureRef}
                    className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre px-1 text-xs"
                  >
                    {snapshot.draft ?? ""}
                  </span>
                  <input
                    ref={inlineCreateInputRef}
                    value={snapshot.draft ?? ""}
                    onChange={(e) =>
                      setInlineCreate((prev) =>
                        prev ? { ...prev, draft: e.target.value } : prev,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitInlineCreate();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeInlineCreate();
                      }
                    }}
                    onBlur={() => void commitInlineCreate()}
                    className="h-6 w-auto max-w-full rounded-none border border-base-300 bg-base-100 px-1 text-xs focus:outline-none focus:border-info"
                    style={{
                      width: inlineCreateWidthPx
                        ? `${inlineCreateWidthPx}px`
                        : undefined,
                    }}
                    disabled={Boolean(snapshot.saving)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label="新建素材箱"
                  />
                </div>
              </div>
            </div>
          );
        }

        const icon =
          snapshot.kind === "folder" ? (
            <FolderIcon className="size-4 opacity-70" />
          ) : (
            <FileImageIcon className="size-4 opacity-70" />
          );
        const aria = snapshot.kind === "folder" ? "新建文件夹" : "新建文本素材";
        const paddingLeft =
          snapshot.kind === "folder"
            ? `${item.depth + 2}px`
            : `${item.depth + 18}px`;
        const showFolderSpacer = snapshot.kind === "folder";
        return (
          <div
            key={item.key}
            className={snapshot.kind === "folder" ? "px-1 rounded-md" : ""}
          >
            <div
              className="flex items-center gap-1 py-1 pr-1 text-xs font-medium opacity-85 select-none rounded-md bg-base-300/40 ring-1 ring-info/20"
              style={{ paddingLeft }}
              data-role="material-package-visible-row"
            >
              {showFolderSpacer ? (
                <span
                  className="inline-flex w-[28px] justify-center"
                  aria-hidden="true"
                ></span>
              ) : null}
              {icon}
              <div className="flex-1 min-w-0 relative">
                <span
                  ref={inlineCreateMeasureRef}
                  className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre px-1 text-xs"
                >
                  {snapshot.draft ?? ""}
                </span>
                <input
                  ref={inlineCreateInputRef}
                  value={snapshot.draft ?? ""}
                  onChange={(e) =>
                    setInlineCreate((prev) =>
                      prev ? { ...prev, draft: e.target.value } : prev,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitInlineCreate();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      closeInlineCreate();
                    }
                  }}
                  onBlur={() => void commitInlineCreate()}
                  className="h-6 w-auto max-w-full rounded-none border border-base-300 bg-base-100 px-1 text-xs focus:outline-none focus:border-info"
                  style={{
                    width: inlineCreateWidthPx
                      ? `${inlineCreateWidthPx}px`
                      : undefined,
                  }}
                  disabled={Boolean(snapshot.saving)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={aria}
                />
              </div>
            </div>
          </div>
        );
      }

      if (item.kind === "package") {
        const isSelected = selectedNode?.key === item.key;
        const isReorderDropTarget = packageReorderDrop?.key === item.key;
        const reorderPlacement =
          packageReorderDrop?.key === item.key
            ? packageReorderDrop.placement
            : null;
        const packageId = Number(item.payload.packageId);
        const pkg = findPackageById(packageId);
        const visibility = normalizePackageVisibility(pkg?.visibility);
        const visibilityCopy = getVisibilityCopy(visibility);
        const isVisibilityOpen = visibilityEditor?.packageId === packageId;
        const isEditingName = inlineRename?.key === item.key;
        return (
          <div
            key={item.key}
            className="px-1 rounded-md"
            data-role="material-package-visible-row"
            data-base-index={item.baseIndex}
          >
            <div
              className={`group flex items-center gap-1 py-1 pr-1 text-xs font-medium opacity-90 select-none rounded-md ${isSelected ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"} ${isReorderDropTarget && reorderPlacement === "before" ? "relative before:absolute before:left-2 before:right-2 before:top-0 before:h-[2px] before:bg-info before:rounded" : ""} ${isReorderDropTarget && reorderPlacement === "after" ? "relative after:absolute after:left-2 after:right-2 after:bottom-0 after:h-[2px] after:bg-info after:rounded" : ""}`}
              data-node-key={item.key}
              draggable
              onDragStart={(e) => {
                markClickSuppressed(suppressPackageClickUntilMsRef, Date.now());

                if (e.altKey) {
                  packageReorderDragRef.current = null;
                  e.dataTransfer.effectAllowed = "copy";
                  setMaterialPreviewDragData(e.dataTransfer, item.payload);
                  setMaterialPreviewDragOrigin(e.dataTransfer, "tree");
                  return;
                }

                packageReorderDragRef.current = { sourceId: packageId };
                e.dataTransfer.effectAllowed = "move";
                setMaterialPackageReorderDragData(e.dataTransfer, {
                  packageId: Number(item.payload.packageId),
                  kind: "package",
                  path: [],
                });
              }}
              onDragOver={(e) => {
                const sourceId = Number(
                  packageReorderDragRef.current?.sourceId ?? -1,
                );
                if (!Number.isFinite(sourceId) || sourceId <= 0) {
                  const dataTransfer = e.dataTransfer;
                  const source =
                    getMaterialPackageReorderDragData(dataTransfer);
                  const previewPayload =
                    getMaterialPreviewDragData(dataTransfer);

                  if (
                    source?.kind === "package" ||
                    previewPayload?.kind === "package"
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "none";
                    setReorderDropTargetKey(null);
                    setMoveDropTargetKey(null);
                    return;
                  }

                  if (!source) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  setReorderDropTargetKey(null);
                  setMoveDropTargetKey(null);
                  return;
                }
                if (sourceId === packageId) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const localY = e.clientY - rect.top;
                const placement: "before" | "after" =
                  localY <= rect.height / 2 ? "before" : "after";
                setPackageReorderDrop({ key: item.key, placement });
              }}
              onDragLeave={(e) => {
                const related = e.relatedTarget as HTMLElement | null;
                if (
                  related &&
                  (e.currentTarget as HTMLElement).contains(related)
                )
                  return;
                setPackageReorderDrop((prev) =>
                  prev?.key === item.key ? null : prev,
                );
              }}
              onDrop={(e) => {
                const sourceId = Number(
                  packageReorderDragRef.current?.sourceId ?? -1,
                );
                if (!Number.isFinite(sourceId) || sourceId <= 0) {
                  const dataTransfer = e.dataTransfer;
                  const source =
                    getMaterialPackageReorderDragData(dataTransfer);
                  const previewPayload =
                    getMaterialPreviewDragData(dataTransfer);

                  if (
                    source?.kind === "package" ||
                    previewPayload?.kind === "package"
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    setReorderDropTargetKey(null);
                    setMoveDropTargetKey(null);
                    toast.error("不能在素材箱里嵌套素材箱。");
                    return;
                  }

                  if (!source) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setReorderDropTargetKey(null);
                  setMoveDropTargetKey(null);
                  void moveNode({
                    source,
                    dest: { packageId, folderPath: [] },
                  });
                  return;
                }
                if (sourceId === packageId) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const localY = e.clientY - rect.top;
                const placement: "before" | "after" =
                  localY <= rect.height / 2 ? "before" : "after";
                setPackageReorderDrop(null);
                reorderPackageOrder({
                  sourceId,
                  targetId: packageId,
                  placement,
                });
              }}
              onDragEnd={() => {
                const sourceId = Number(
                  packageReorderDragRef.current?.sourceId ?? -1,
                );
                const targetId = packageReorderDrop
                  ? parseRootKeyPackageId(packageReorderDrop.key)
                  : null;
                const placement = packageReorderDrop?.placement ?? "before";
                packageReorderDragRef.current = null;
                setPackageReorderDrop(null);
                if (
                  Number.isFinite(sourceId) &&
                  sourceId > 0 &&
                  targetId &&
                  sourceId !== targetId
                ) {
                  reorderPackageOrder({ sourceId, targetId, placement });
                }
              }}
              onClick={(e) => {
                if (
                  isClickSuppressed(suppressPackageClickUntilMsRef, Date.now())
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                setSelectedNode({
                  kind: "package",
                  key: item.key,
                  payload: item.payload,
                });
                const target = e.target as HTMLElement | null;
                const action = target?.closest?.("[data-inline-rename='1']")
                  ? "rename"
                  : "open";
                maybeTriggerByDoubleClick(e, item.key, action, () => {
                  if (action === "rename") {
                    startInlineRename({
                      kind: "package",
                      key: item.key,
                      packageId,
                      folderPath: [],
                      name: item.label,
                    });
                    return;
                  }
                  openPreview(item.payload, null);
                });
              }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleCollapsed(item.key);
                }}
                title={item.isCollapsed ? "展开" : "折叠"}
              >
                <ChevronDown
                  className={`size-4 opacity-80 ${item.isCollapsed ? "-rotate-90" : ""}`}
                />
              </button>
              <PackageIcon className="size-4 opacity-70" weight="bold" />
              {isEditingName ? (
                <div className="flex-1 min-w-0 relative">
                  <span
                    ref={inlineRenameMeasureRef}
                    className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre px-1 text-xs"
                  >
                    {inlineRename?.draft ?? ""}
                  </span>
                  <input
                    ref={inlineRenameInputRef}
                    value={inlineRename?.draft ?? ""}
                    onChange={(e) =>
                      setInlineRename((prev) =>
                        prev ? { ...prev, draft: e.target.value } : prev,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitInlineRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeInlineRename();
                      }
                    }}
                    onBlur={() => void commitInlineRename()}
                    className="h-6 w-auto max-w-full rounded-none border border-base-300 bg-base-100 px-1 text-xs focus:outline-none focus:border-info"
                    style={{
                      width: inlineRenameWidthPx
                        ? `${inlineRenameWidthPx}px`
                        : undefined,
                    }}
                    disabled={Boolean(inlineRename?.saving)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    data-inline-rename="1"
                    aria-label="重命名素材箱"
                  />
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  <span
                    className="inline-block max-w-full truncate"
                    data-inline-rename="1"
                    title="双击重命名"
                  >
                    {item.label}
                  </span>
                </div>
              )}
              <PortalTooltip
                label={`拖拽排序素材箱；Alt+拖拽到右侧打开预览：${item.label}`}
                placement="right"
              >
                <span className="text-[11px] opacity-50 px-1">
                  {item.nodeCount ? `${item.nodeCount}项` : "空"}
                </span>
              </PortalTooltip>
              <button
                type="button"
                className={`shrink-0 inline-flex items-center rounded-sm border px-2 py-[1px] text-[11px] ${visibility ? "border-info/40 text-info" : "border-base-300 opacity-80"} ${isVisibilityOpen ? "bg-base-300/60" : "hover:bg-base-300/40"}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openVisibilityEditor({
                    packageId,
                    anchor: e.currentTarget,
                    current: visibility,
                  });
                }}
                title={visibilityCopy.title}
                aria-label={`可见性：${visibilityCopy.chip}，点击修改`}
              >
                {visibilityCopy.chip}
              </button>
              <button
                type="button"
                className="shrink-0 inline-flex items-center rounded-sm border border-base-300 px-2 py-[1px] text-[11px] opacity-0 group-hover:opacity-100 hover:bg-base-300/40"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openPackageMetaEditor({
                    packageId,
                    anchor: e.currentTarget,
                  });
                }}
                aria-label="编辑素材包信息"
                title="编辑简介与封面"
              >
                信息
              </button>
            </div>
          </div>
        );
      }

      if (item.kind === "folder") {
        const isSelected = selectedNode?.key === item.key;
        const isEditingName = inlineRename?.key === item.key;
        const isReorderDropTarget = reorderDropTargetKey === item.key;
        const isMoveDropTarget = moveDropTargetKey === item.key;
        const folderPath = payloadPathToFolderNames(item.payload.path);
        const parentFolderPath = folderPath.slice(0, -1);
        return (
          <div
            key={item.key}
            className="px-1 rounded-md"
            data-role="material-package-visible-row"
            data-base-index={item.baseIndex}
          >
            <div
              className={`flex items-center gap-1 py-1 pr-1 text-xs font-medium opacity-85 select-none rounded-md ${isSelected ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"} ${isMoveDropTarget ? "ring-1 ring-info/40 bg-info/10" : ""} ${isReorderDropTarget ? "relative before:absolute before:left-2 before:right-2 before:top-0 before:h-[2px] before:bg-info before:rounded" : ""}`}
              style={{ paddingLeft: `${item.depth + 2}px` }}
              draggable
              onDragStart={(e) => {
                markClickSuppressed(suppressPackageClickUntilMsRef, Date.now());
                e.dataTransfer.effectAllowed = "copyMove";
                setMaterialPreviewDragData(e.dataTransfer, item.payload);
                setMaterialPreviewDragOrigin(e.dataTransfer, "tree");
                setMaterialPackageReorderDragData(e.dataTransfer, {
                  packageId: Number(item.payload.packageId),
                  kind: "folder",
                  path: item.payload.path,
                  materialPreview: item.payload,
                });
              }}
              onDragOver={(e) => {
                const source = getMaterialPackageReorderDragData(
                  e.dataTransfer,
                );
                if (!source) return;

                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const localY = e.clientY - rect.top;
                const isBeforeZone = localY <= Math.min(10, rect.height * 0.35);
                const sourceFolderNames = payloadPathToFolderNames(source.path);
                const sourceParent =
                  source.kind === "folder"
                    ? sourceFolderNames.slice(0, -1)
                    : sourceFolderNames;
                const sameParent =
                  sourceParent.length === parentFolderPath.length &&
                  sourceParent.every(
                    (name, idx) => parentFolderPath[idx] === name,
                  );
                const samePackage =
                  Number(source.packageId) === Number(item.payload.packageId);
                const decision = computeTreeFolderRowDropDecision({
                  samePackage,
                  sameParent,
                  isBeforeZone,
                });

                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                if (decision === "reorder") {
                  setReorderDropTargetKey(item.key);
                  setMoveDropTargetKey(null);
                } else {
                  setMoveDropTargetKey(item.key);
                  setReorderDropTargetKey(null);
                }
              }}
              onDragLeave={(e) => {
                const related = e.relatedTarget as HTMLElement | null;
                if (
                  related &&
                  (e.currentTarget as HTMLElement).contains(related)
                )
                  return;
                setReorderDropTargetKey((prev) =>
                  prev === item.key ? null : prev,
                );
                setMoveDropTargetKey((prev) =>
                  prev === item.key ? null : prev,
                );
              }}
              onDrop={(e) => {
                const source = getMaterialPackageReorderDragData(
                  e.dataTransfer,
                );
                if (!source) return;

                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const localY = e.clientY - rect.top;
                const isBeforeZone = localY <= Math.min(10, rect.height * 0.35);
                const sourceFolderNames = payloadPathToFolderNames(source.path);
                const sourceParent =
                  source.kind === "folder"
                    ? sourceFolderNames.slice(0, -1)
                    : sourceFolderNames;
                const sameParent =
                  sourceParent.length === parentFolderPath.length &&
                  sourceParent.every(
                    (name, idx) => parentFolderPath[idx] === name,
                  );
                const samePackage =
                  Number(source.packageId) === Number(item.payload.packageId);
                const decision = computeTreeFolderRowDropDecision({
                  samePackage,
                  sameParent,
                  isBeforeZone,
                });

                e.preventDefault();
                e.stopPropagation();
                setReorderDropTargetKey(null);
                setMoveDropTargetKey(null);
                if (decision === "reorder") {
                  void reorderNode({
                    source,
                    dest: {
                      packageId: Number(item.payload.packageId),
                      folderPath: parentFolderPath,
                      insertBefore: { type: "folder", name: item.name },
                    },
                  });
                  return;
                }
                void moveNode({
                  source,
                  dest: {
                    packageId: Number(item.payload.packageId),
                    folderPath,
                  },
                });
              }}
              onDragEnd={() => {
                activeMaterialPackageReorderDrag = null;
                setReorderDropTargetKey(null);
                setMoveDropTargetKey(null);
              }}
              onClick={(e) => {
                setSelectedNode({
                  kind: "folder",
                  key: item.key,
                  payload: item.payload,
                });
                const target = e.target as HTMLElement | null;
                const action = target?.closest?.("[data-inline-rename='1']")
                  ? "rename"
                  : "open";
                maybeTriggerByDoubleClick(e, item.key, action, () => {
                  if (action === "rename") {
                    startInlineRename({
                      kind: "folder",
                      key: item.key,
                      packageId: Number(item.payload.packageId),
                      folderPath,
                      name: item.name,
                    });
                    return;
                  }
                  openPreview(item.payload, null);
                });
              }}
              data-node-key={item.key}
            >
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleCollapsed(item.key);
                }}
                title={item.isCollapsed ? "展开" : "折叠"}
              >
                <ChevronDown
                  className={`size-4 opacity-80 ${item.isCollapsed ? "-rotate-90" : ""}`}
                />
              </button>
              <FolderIcon className="size-4 opacity-70" />
              {isEditingName ? (
                <div className="flex-1 min-w-0 relative">
                  <span
                    ref={inlineRenameMeasureRef}
                    className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre px-1 text-xs"
                  >
                    {inlineRename?.draft ?? ""}
                  </span>
                  <input
                    ref={inlineRenameInputRef}
                    value={inlineRename?.draft ?? ""}
                    onChange={(e) =>
                      setInlineRename((prev) =>
                        prev ? { ...prev, draft: e.target.value } : prev,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitInlineRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeInlineRename();
                      }
                    }}
                    onBlur={() => void commitInlineRename()}
                    className="h-6 w-auto max-w-full rounded-none border border-base-300 bg-base-100 px-1 text-xs focus:outline-none focus:border-info"
                    style={{
                      width: inlineRenameWidthPx
                        ? `${inlineRenameWidthPx}px`
                        : undefined,
                    }}
                    disabled={Boolean(inlineRename?.saving)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    data-inline-rename="1"
                    aria-label="重命名文件夹"
                  />
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  <span
                    className="inline-block max-w-full truncate"
                    data-inline-rename="1"
                    title="双击重命名"
                  >
                    {item.name}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      }

      const isEditingName = inlineRename?.key === item.key;
      const isReorderDropTarget = reorderDropTargetKey === item.key;
      const parentFolderPath = payloadPathToFolderNames(item.payload.path);
      return (
        <div
          key={item.key}
          className={`flex items-center gap-2 py-1 pr-2 text-xs opacity-85 select-none rounded-md ${selectedNode?.key === item.key ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"} ${isReorderDropTarget ? "relative before:absolute before:left-2 before:right-2 before:top-0 before:h-[2px] before:bg-info before:rounded" : ""}`}
          style={{ paddingLeft: `${item.depth + 18}px` }}
          data-role="material-package-visible-row"
          data-base-index={item.baseIndex}
          draggable
          onDragStart={(e) => {
            markClickSuppressed(suppressPackageClickUntilMsRef, Date.now());
            e.dataTransfer.effectAllowed = "copyMove";
            setMaterialPreviewDragData(e.dataTransfer, item.payload);
            setMaterialPreviewDragOrigin(e.dataTransfer, "tree");
            setMaterialPackageReorderDragData(e.dataTransfer, {
              packageId: Number(item.payload.packageId),
              kind: "material",
              path: item.payload.path,
              materialPreview: item.payload,
            });
          }}
          onDragOver={(e) => {
            const source = getMaterialPackageReorderDragData(e.dataTransfer);
            if (!source) return;
            if (Number(source.packageId) !== Number(item.payload.packageId))
              return;

            const rect = (
              e.currentTarget as HTMLElement
            ).getBoundingClientRect();
            const localY = e.clientY - rect.top;
            const isBeforeZone = localY <= Math.min(10, rect.height * 0.35);
            if (!isBeforeZone) return;

            const sourceFolderNames = payloadPathToFolderNames(source.path);
            const sourceParent =
              source.kind === "folder"
                ? sourceFolderNames.slice(0, -1)
                : sourceFolderNames;
            const sameParent =
              sourceParent.length === parentFolderPath.length &&
              sourceParent.every((name, idx) => parentFolderPath[idx] === name);
            if (!sameParent) return;

            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            setReorderDropTargetKey(item.key);
            setMoveDropTargetKey(null);
          }}
          onDragLeave={(e) => {
            const related = e.relatedTarget as HTMLElement | null;
            if (related && (e.currentTarget as HTMLElement).contains(related))
              return;
            setReorderDropTargetKey((prev) =>
              prev === item.key ? null : prev,
            );
          }}
          onDrop={(e) => {
            const source = getMaterialPackageReorderDragData(e.dataTransfer);
            if (!source) return;
            if (Number(source.packageId) !== Number(item.payload.packageId))
              return;

            const rect = (
              e.currentTarget as HTMLElement
            ).getBoundingClientRect();
            const localY = e.clientY - rect.top;
            const isBeforeZone = localY <= Math.min(10, rect.height * 0.35);
            if (!isBeforeZone) return;

            e.preventDefault();
            e.stopPropagation();
            setReorderDropTargetKey(null);
            void reorderNode({
              source,
              dest: {
                packageId: Number(item.payload.packageId),
                folderPath: parentFolderPath,
                insertBefore: { type: "material", name: item.name },
              },
            });
          }}
          onDragEnd={() => {
            activeMaterialPackageReorderDrag = null;
            setReorderDropTargetKey(null);
            setMoveDropTargetKey(null);
          }}
          onClick={(e) => {
            setSelectedNode({
              kind: "material",
              key: item.key,
              payload: item.payload,
            });
            const target = e.target as HTMLElement | null;
            const action = target?.closest?.("[data-inline-rename='1']")
              ? "rename"
              : "open";
            maybeTriggerByDoubleClick(e, item.key, action, () => {
              if (action === "rename") {
                const folderPath = payloadPathToFolderNames(item.payload.path);
                startInlineRename({
                  kind: "material",
                  key: item.key,
                  packageId: Number(item.payload.packageId),
                  folderPath,
                  name: item.name,
                });
                return;
              }
              openPreview(item.payload, null);
            });
          }}
          data-node-key={item.key}
        >
          <FileImageIcon className="size-4 opacity-70" />
          {isEditingName ? (
            <div className="flex-1 min-w-0 relative">
              <span
                ref={inlineRenameMeasureRef}
                className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre px-1 text-xs"
              >
                {inlineRename?.draft ?? ""}
              </span>
              <input
                ref={inlineRenameInputRef}
                value={inlineRename?.draft ?? ""}
                onChange={(e) =>
                  setInlineRename((prev) =>
                    prev ? { ...prev, draft: e.target.value } : prev,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitInlineRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    closeInlineRename();
                  }
                }}
                onBlur={() => void commitInlineRename()}
                className="h-6 w-auto max-w-full rounded-none border border-base-300 bg-base-100 px-1 text-xs focus:outline-none focus:border-info"
                style={{
                  width: inlineRenameWidthPx
                    ? `${inlineRenameWidthPx}px`
                    : undefined,
                }}
                disabled={Boolean(inlineRename?.saving)}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                data-inline-rename="1"
                aria-label="重命名文件"
              />
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <span
                className="inline-block max-w-full truncate"
                data-inline-rename="1"
                title="双击重命名"
              >
                {item.name}
              </span>
            </div>
          )}
        </div>
      );
    },
    [
      closeInlineCreate,
      closeInlineRename,
      commitInlineCreate,
      commitInlineRename,
      dockedPreview,
      findPackageById,
      inlineCreate?.draft,
      inlineCreate?.key,
      inlineCreate?.saving,
      inlineRename?.draft,
      inlineRename?.key,
      inlineRename?.saving,
      maybeTriggerByDoubleClick,
      moveDropTargetKey,
      moveNode,
      onDockPreview,
      onOpenPreview,
      onUndockPreview,
      openPreview,
      openVisibilityEditor,
      packageReorderDrop?.key,
      packageReorderDrop?.placement,
      reorderDropTargetKey,
      reorderNode,
      reorderPackageOrder,
      resolvedDockIndex,
      selectedNode?.key,
      setMoveDropTargetKey,
      setPackageReorderDrop,
      setReorderDropTargetKey,
      startInlineRename,
      toggleCollapsed,
      visibilityEditor?.packageId,
    ],
  );

  return (
    <div
      className="flex flex-col w-full h-full flex-1 min-h-0 min-w-0 rounded-tl-xl border-l border-t border-gray-300 dark:border-gray-700 bg-base-200 text-base-content"
      data-role="material-package-dock-zone"
      data-dock-context-id={dockContextId}
      onDragOverCapture={(e) => {
        if (isMaterialPackageReorderDrag(e.dataTransfer)) {
          clearDockHint();
          return;
        }
        if (isMpfNodeDrag(e.dataTransfer)) {
          clearDockHint();
          return;
        }
        e.preventDefault();
        if (!isMaterialPreviewDrag(e.dataTransfer)) return;
        const origin = getMaterialPreviewDragOrigin(e.dataTransfer) ?? "tree";
        e.dataTransfer.dropEffect = origin === "docked" ? "move" : "copy";
        const index = computeInsertIndex(e.clientY);
        const baseText =
          index <= 0
            ? "插入到顶部"
            : index >= baseItemCount
              ? "插入到底部"
              : "插入到这里";
        applyDockHint({
          index,
          text: `${baseText}（${index}/${baseItemCount}）`,
        });
      }}
      onDragLeaveCapture={() => {
        clearDockHint();
      }}
      onDropCapture={(e) => {
        if (isMaterialPackageReorderDrag(e.dataTransfer)) return;
        if (isMpfNodeDrag(e.dataTransfer)) {
          clearDockHint();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const payload = getMaterialPreviewDragData(e.dataTransfer);
        if (!payload) return;
        const origin = getMaterialPreviewDragOrigin(e.dataTransfer);
        const index = dockHint?.index ?? baseItemCount;
        clearDockHint();
        if (origin === "docked") {
          onMoveDockedPreview(index);
          return;
        }
        onDockPreview(payload, { index });
      }}
    >
      <div className="flex items-center justify-between h-12 gap-2 min-w-0 border-b border-gray-300 dark:border-gray-700 rounded-tl-xl px-3">
        <div className="flex items-center gap-2 min-w-0 font-semibold truncate">
          <ChevronDown className="size-4 opacity-70" />
          我的素材包
        </div>
        {onToggleLeftDrawer && (
          <div className="tooltip tooltip-bottom" data-tip={leftDrawerLabel}>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square hover:text-info"
              onClick={onToggleLeftDrawer}
              aria-label={leftDrawerLabel}
              aria-pressed={Boolean(isLeftDrawerOpen)}
            >
              <SidebarSimpleIcon />
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="relative flex-1 min-h-0 overflow-auto"
        onScroll={() => {
          if (dockHint) {
            applyDockHint(dockHint);
          }
          if (visibilityEditor?.anchor) {
            setVisibilityPos(computeVisibilityPos(visibilityEditor.anchor));
          }
        }}
      >
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] opacity-60">
              {useBackend ? "数据源：后端" : "数据源：本地 mock（用于验收 UI）"}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                const next = !useBackend;
                setUseBackend(next);
                window.dispatchEvent(
                  new CustomEvent("tc:material-package:use-backend-changed", {
                    detail: { useBackend: next },
                  }),
                );
              }}
              aria-pressed={useBackend}
              title={
                useBackend
                  ? "切换到 mock（不请求后端）"
                  : "切换到后端（会发起请求）"
              }
            >
              {useBackend ? "改用 mock" : "改用后端"}
            </button>
          </div>

          <div className="space-y-2">
            <div className="sticky top-0 z-20 -mx-3 px-3 py-2 bg-base-200/95 backdrop-blur border-b border-base-300">
              <div className="px-1 flex items-center justify-between gap-2 group">
                <button
                  type="button"
                  className="text-[11px] font-semibold tracking-wider text-base-content/50 hover:text-base-content/70 active:text-base-content/80 select-none"
                  onClick={() => setToolbarPinned(!toolbarPinned)}
                  aria-pressed={toolbarPinned}
                  title={
                    toolbarPinned
                      ? "隐藏工具栏（仍可悬浮显示）"
                      : "固定显示工具栏"
                  }
                >
                  TUAN-CHAT
                </button>
                <div
                  className={`flex items-center gap-1 transition-opacity ${toolbarPinned ? "opacity-90" : "opacity-0 pointer-events-none group-hover:opacity-70 group-hover:pointer-events-auto focus-within:opacity-90 focus-within:pointer-events-auto"}`}
                >
                  <PortalTooltip label="新建文本素材" placement="bottom">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      disabled={packages.length === 0}
                      onClick={handleToolbarNewFile}
                      aria-label="新建文本素材"
                    >
                      <FilePlus className="size-4" />
                    </button>
                  </PortalTooltip>
                  <PortalTooltip label="新建文件夹" placement="bottom">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      disabled={packages.length === 0}
                      onClick={handleToolbarNewFolder}
                      aria-label="新建文件夹"
                    >
                      <FolderPlus className="size-4" />
                    </button>
                  </PortalTooltip>
                  <PortalTooltip label="新建素材箱" placement="bottom">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      onClick={handleToolbarNewPackage}
                      aria-label="新建素材箱"
                    >
                      <Plus className="size-4" />
                    </button>
                  </PortalTooltip>
                  <PortalTooltip label="本地导入" placement="bottom">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      disabled={packages.length === 0}
                      onClick={handleToolbarImport}
                      aria-label="本地导入"
                    >
                      <UploadSimple className="size-4" />
                    </button>
                  </PortalTooltip>
                  <PortalTooltip label="刷新" placement="bottom">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      onClick={handleToolbarRefresh}
                      aria-label="刷新"
                    >
                      <ArrowClockwise className="size-4" />
                    </button>
                  </PortalTooltip>
                  <PortalTooltip
                    label={selectedNode ? "删除" : "先选择一个节点再删除"}
                    placement="bottom"
                  >
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      disabled={!selectedNode}
                      onClick={handleToolbarDelete}
                      aria-label="删除"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </PortalTooltip>
                  <PortalTooltip label="展开到选中项" placement="bottom">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      disabled={packages.length === 0}
                      onClick={handleToolbarReveal}
                      aria-label="展开到选中项"
                    >
                      <CrosshairSimple className="size-4" />
                    </button>
                  </PortalTooltip>
                </div>
              </div>
            </div>

            <div ref={treeItemsRef} data-role="material-package-tree-items">
              <input
                ref={importInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={handleImportChange}
              />
              {packagesQuery.isLoading && (
                <div className="px-2 py-2 text-xs opacity-70 flex items-center gap-2">
                  <span className="loading loading-spinner loading-xs"></span>
                  正在加载我的素材包…
                </div>
              )}

              {packagesQuery.isError && (
                <div className="px-2 py-2 text-xs text-error">
                  加载失败：
                  {packagesQuery.error instanceof Error
                    ? packagesQuery.error.message
                    : "未知错误"}
                </div>
              )}

              {!packagesQuery.isLoading &&
                !packagesQuery.isError &&
                packages.length === 0 && (
                  <div className="px-2 py-2 text-xs opacity-60">暂无素材包</div>
                )}

              {!packagesQuery.isLoading &&
                !packagesQuery.isError &&
                visibleItems.map((item, index) =>
                  renderVisibleItem(item, index),
                )}
            </div>
          </div>
        </div>

        {dockHint && dockLineTop != null && (
          <div
            className="pointer-events-none absolute left-3 right-3 h-0.5 rounded bg-info"
            style={{ top: dockLineTop }}
          />
        )}
        {dockHint && dockTipTop != null && (
          <div
            className="pointer-events-none absolute left-3 rounded-md border border-base-300 bg-base-100/80 px-2 py-0.5 text-[11px] text-base-content/80 backdrop-blur"
            style={{ top: dockTipTop }}
          >
            {dockHint.text}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-base-300 text-[11px] opacity-60">
        提示：双击打开预览；也可以拖拽到右侧主区域。
      </div>

      {pendingChoosePackage && typeof document !== "undefined"
        ? createPortal(
            <dialog
              open
              className="modal modal-open z-[10050]"
              onCancel={(event) => {
                event.preventDefault();
                setPendingChoosePackage(null);
                setPendingChoosePackageId(null);
              }}
            >
              <div className="modal-box max-w-[420px] border border-base-300 bg-base-100 p-0 text-base-content shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                  <div className="text-sm font-semibold">选择素材箱</div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    aria-label="关闭"
                    onClick={() => {
                      setPendingChoosePackage(null);
                      setPendingChoosePackageId(null);
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="text-xs opacity-70">
                    当前有多个素材箱，请先选择一个作为默认操作位置。
                  </div>
                  <div className="space-y-2">
                    {packages.map((pkg) => {
                      const id = Number(pkg.packageId);
                      const label = pkg.name ?? `素材包#${id}`;
                      return (
                        <label
                          key={id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <input
                            type="radio"
                            className="radio radio-sm"
                            name="choose-package"
                            checked={Number(pendingChoosePackageId) === id}
                            onChange={() => setPendingChoosePackageId(id)}
                          />
                          <span className="truncate">{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end gap-2 border-t border-base-300 px-4 py-3">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPendingChoosePackage(null);
                      setPendingChoosePackageId(null);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={pendingChoosePackageId == null}
                    onClick={() => {
                      if (pendingChoosePackageId == null) return;
                      const packageId = Number(pendingChoosePackageId);
                      setDefaultTargetPackageId(packageId);
                      const key = `root:${packageId}`;
                      const label =
                        findPackageById(packageId)?.name ??
                        `素材包#${packageId}`;
                      const payload = toPreviewPayload({
                        kind: "package",
                        packageId,
                        label,
                        path: [],
                      });
                      setSelectedNode({ kind: "package", key, payload });
                      setPendingChoosePackage(null);
                      setPendingChoosePackageId(null);

                      if (pendingChoosePackage.action === "new-file") {
                        void runToolbarNewFile({ packageId, folderPath: [] });
                      } else if (pendingChoosePackage.action === "new-folder") {
                        void runToolbarNewFolder({ packageId, folderPath: [] });
                      } else {
                        setPendingImportTarget({ packageId, folderPath: [] });
                        const el = importInputRef.current;
                        if (el) {
                          el.value = "";
                          el.click();
                        }
                      }
                    }}
                  >
                    确定
                  </button>
                </div>
              </div>
            </dialog>,
            document.body,
          )
        : null}

      {textMaterialEditor && typeof document !== "undefined"
        ? createPortal(
            <dialog
              open
              className="modal modal-open z-[10050]"
              onCancel={(event) => {
                event.preventDefault();
                if (textMaterialEditor.saving) return;
                closeTextMaterialEditor();
              }}
            >
              <div className="modal-box max-w-[520px] border border-base-300 bg-base-100 p-0 text-base-content shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                  <div className="text-sm font-semibold">编辑文本素材内容</div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    aria-label="关闭"
                    onClick={() => {
                      if (textMaterialEditor.saving) return;
                      closeTextMaterialEditor();
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <div className="text-xs opacity-70">
                    新建素材「{textMaterialEditor.materialName}
                    」已创建，请输入要发送的文本。
                  </div>
                  <textarea
                    className="textarea textarea-bordered textarea-sm w-full"
                    rows={6}
                    value={textMaterialEditor.draft}
                    onChange={(e) =>
                      setTextMaterialEditor((prev) =>
                        prev ? { ...prev, draft: e.target.value } : prev,
                      )
                    }
                    disabled={textMaterialEditor.saving}
                    placeholder="输入文本素材内容（可留空）"
                  />
                </div>
                <div className="flex justify-end gap-2 border-t border-base-300 px-4 py-3">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={closeTextMaterialEditor}
                    disabled={textMaterialEditor.saving}
                  >
                    稍后编辑
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      void saveTextMaterialEditor();
                    }}
                    disabled={textMaterialEditor.saving}
                  >
                    {textMaterialEditor.saving ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            </dialog>,
            document.body,
          )
        : null}

      {pendingDeleteDialog && typeof document !== "undefined"
        ? createPortal(
            <dialog
              open
              className="modal modal-open z-[10050]"
              onCancel={(event) => {
                event.preventDefault();
                if (pendingDeleteDialog.saving) return;
                setPendingDeleteDialog(null);
              }}
            >
              <div className="modal-box max-w-[460px] border border-base-300 bg-base-100 p-0 text-base-content shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                  <div className="text-sm font-semibold">确认删除</div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    aria-label="关闭"
                    onClick={() => {
                      if (pendingDeleteDialog.saving) return;
                      setPendingDeleteDialog(null);
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div className="px-4 py-4 space-y-2">
                  <div className="text-sm">
                    {pendingDeleteDialog.kind === "package" && (
                      <>
                        将删除素材箱「{pendingDeleteDialog.label}
                        」及其全部内容。
                      </>
                    )}
                    {pendingDeleteDialog.kind === "folder" && (
                      <>
                        将删除文件夹「{pendingDeleteDialog.label}
                        」及其全部内容。
                      </>
                    )}
                    {pendingDeleteDialog.kind === "material" && (
                      <>将删除文件「{pendingDeleteDialog.label}」。</>
                    )}
                  </div>
                  <div className="text-xs opacity-70">该操作不可撤销。</div>
                </div>
                <div className="flex justify-end gap-2 border-t border-base-300 px-4 py-3">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPendingDeleteDialog(null)}
                    disabled={pendingDeleteDialog.saving}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-error btn-sm"
                    onClick={() => void runDeleteConfirmed(pendingDeleteDialog)}
                    disabled={pendingDeleteDialog.saving}
                  >
                    {pendingDeleteDialog.saving ? "删除中…" : "删除"}
                  </button>
                </div>
              </div>
            </dialog>,
            document.body,
          )
        : null}

      {visibilityEditor &&
        visibilityPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={visibilityPopoverRef}
            className="z-[9999] w-[320px] overflow-hidden rounded-md border border-base-300 bg-base-100 text-base-content shadow-xl"
            style={{
              position: "fixed",
              left: visibilityPos.left,
              top: visibilityPos.top,
            }}
            role="dialog"
            aria-label="可见性设置"
          >
            <div className="flex items-center justify-between gap-3 border-b border-base-300 px-3 py-2">
              <div className="text-[13px] font-semibold">可见性</div>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square"
                aria-label="关闭"
                onClick={() => closeVisibilityEditor()}
                disabled={visibilityEditor.saving}
              >
                ✕
              </button>
            </div>

            <div className="px-3 py-3 space-y-3">
              <div
                className="text-xs opacity-70 truncate"
                title={findPackageById(visibilityEditor.packageId)?.name ?? ""}
              >
                {findPackageById(visibilityEditor.packageId)?.name ??
                  `素材包#${visibilityEditor.packageId}`}
              </div>

              <fieldset className="space-y-2">
                <legend className="sr-only">可见性选项</legend>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    ref={visibilityFirstInputRef}
                    type="radio"
                    className="radio radio-sm mt-0.5"
                    name="material-package-visibility"
                    checked={visibilityEditor.draft === 1}
                    onChange={() =>
                      setVisibilityEditor((prev) =>
                        prev ? { ...prev, draft: 1 } : prev,
                      )
                    }
                    disabled={visibilityEditor.saving}
                  />
                  <div className="min-w-0">
                    <div className="text-sm">公开（发布到素材广场）</div>
                    <div className="text-[11px] opacity-70">
                      素材包会出现在素材广场，其他人可以查看并获取。
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    className="radio radio-sm mt-0.5"
                    name="material-package-visibility"
                    checked={visibilityEditor.draft === 0}
                    onChange={() =>
                      setVisibilityEditor((prev) =>
                        prev ? { ...prev, draft: 0 } : prev,
                      )
                    }
                    disabled={visibilityEditor.saving}
                  />
                  <div className="min-w-0">
                    <div className="text-sm">私有（不在素材广场展示）</div>
                    <div className="text-[11px] opacity-70">
                      素材包仍保留在“我的素材包”里，但不会出现在素材广场。
                    </div>
                  </div>
                </label>
              </fieldset>
            </div>

            <div className="flex justify-end gap-2 border-t border-base-300 px-3 py-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => closeVisibilityEditor()}
                disabled={visibilityEditor.saving}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={
                  visibilityEditor.saving ||
                  normalizePackageVisibility(
                    findPackageById(visibilityEditor.packageId)?.visibility,
                  ) === normalizePackageVisibility(visibilityEditor.draft)
                }
                onClick={async () => {
                  if (visibilityEditor.saving) return;
                  const current = normalizePackageVisibility(
                    findPackageById(visibilityEditor.packageId)?.visibility,
                  );
                  const next = normalizePackageVisibility(
                    visibilityEditor.draft,
                  );
                  if (current === next) return;
                  setVisibilityEditor((prev) =>
                    prev ? { ...prev, saving: true } : prev,
                  );
                  try {
                    await savePackageVisibility({
                      packageId: visibilityEditor.packageId,
                      visibility: next,
                    });
                    closeVisibilityEditor();
                  } catch (error) {
                    setVisibilityEditor((prev) =>
                      prev ? { ...prev, saving: false } : prev,
                    );
                    const message =
                      error instanceof Error ? error.message : "保存失败";
                    window.alert(message);
                  }
                }}
              >
                {visibilityEditor.saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>,
          document.body,
        )}

      {packageMetaEditor &&
        packageMetaPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={packageMetaPopoverRef}
            className="z-[9999] w-[420px] overflow-hidden rounded-md border border-base-300 bg-base-100 text-base-content shadow-xl"
            style={{
              position: "fixed",
              left: packageMetaPos.left,
              top: packageMetaPos.top,
            }}
            role="dialog"
            aria-label="素材包信息设置"
          >
            <div className="flex items-center justify-between gap-3 border-b border-base-300 px-3 py-2">
              <div className="text-[13px] font-semibold">素材包信息</div>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square"
                aria-label="关闭"
                onClick={() => closePackageMetaEditor()}
                disabled={
                  packageMetaEditor.saving || packageMetaEditor.uploadingCover
                }
              >
                ✕
              </button>
            </div>

            <div className="px-3 py-3 space-y-3">
              <div
                className="text-xs opacity-70 truncate"
                title={findPackageById(packageMetaEditor.packageId)?.name ?? ""}
              >
                {findPackageById(packageMetaEditor.packageId)?.name ??
                  `素材包#${packageMetaEditor.packageId}`}
              </div>

              <label className="block">
                <div className="text-xs opacity-70">简介 / 描述</div>
                <textarea
                  ref={packageMetaFirstInputRef}
                  className="textarea textarea-bordered textarea-sm w-full mt-1"
                  rows={4}
                  value={packageMetaEditor.draftDescription}
                  onChange={(e) =>
                    setPackageMetaEditor((prev) =>
                      prev
                        ? { ...prev, draftDescription: e.target.value }
                        : prev,
                    )
                  }
                  disabled={packageMetaEditor.saving}
                />
              </label>

              <label className="block">
                <div
                  className={`rounded-md ${isCoverDropActive ? "ring-1 ring-info/40 bg-info/5" : ""}`}
                  onDragEnter={(e) => {
                    if (!canAcceptCoverDrop(e.dataTransfer)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    coverDropCounterRef.current += 1;
                    setIsCoverDropActive(true);
                  }}
                  onDragOver={(e) => {
                    if (!canAcceptCoverDrop(e.dataTransfer)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "copy";
                    if (!isCoverDropActive) {
                      setIsCoverDropActive(true);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!isCoverDropActive) return;
                    e.preventDefault();
                    e.stopPropagation();
                    coverDropCounterRef.current = Math.max(
                      0,
                      coverDropCounterRef.current - 1,
                    );
                    if (coverDropCounterRef.current === 0) {
                      setIsCoverDropActive(false);
                    }
                  }}
                  onDrop={(e) => {
                    if (!canAcceptCoverDrop(e.dataTransfer)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    coverDropCounterRef.current = 0;
                    setIsCoverDropActive(false);
                    handleCoverDrop(e.dataTransfer);
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs opacity-70">封面（可留空）</div>
                    <div className="flex items-center gap-2">
                      <input
                        ref={packageMetaCoverInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            void uploadPackageCover(file);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={
                          packageMetaEditor.saving ||
                          packageMetaEditor.uploadingCover
                        }
                        onClick={() =>
                          packageMetaCoverInputRef.current?.click()
                        }
                      >
                        {packageMetaEditor.uploadingCover
                          ? "上传中…"
                          : "上传图片"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={
                          packageMetaEditor.saving ||
                          packageMetaEditor.uploadingCover
                        }
                        onClick={() =>
                          setPackageMetaEditor((prev) =>
                            prev ? { ...prev, draftCoverUrl: "" } : prev,
                          )
                        }
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <input
                    className="input input-bordered input-sm w-full mt-1"
                    placeholder="https://..."
                    value={packageMetaEditor.draftCoverUrl}
                    onChange={(e) =>
                      setPackageMetaEditor((prev) =>
                        prev
                          ? { ...prev, draftCoverUrl: e.target.value }
                          : prev,
                      )
                    }
                    disabled={
                      packageMetaEditor.saving ||
                      packageMetaEditor.uploadingCover
                    }
                  />
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-base-300 px-3 py-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => closePackageMetaEditor()}
                disabled={
                  packageMetaEditor.saving || packageMetaEditor.uploadingCover
                }
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={
                  packageMetaEditor.saving ||
                  packageMetaEditor.uploadingCover ||
                  (() => {
                    const pkg = findPackageById(packageMetaEditor.packageId);
                    const curDesc = String(pkg?.description ?? "").trim();
                    const curCover = String(pkg?.coverUrl ?? "").trim();
                    const nextDesc = String(
                      packageMetaEditor.draftDescription ?? "",
                    ).trim();
                    const nextCover = String(
                      packageMetaEditor.draftCoverUrl ?? "",
                    ).trim();
                    return curDesc === nextDesc && curCover === nextCover;
                  })()
                }
                onClick={async () => {
                  if (!packageMetaEditor || packageMetaEditor.saving) return;
                  setPackageMetaEditor((prev) =>
                    prev ? { ...prev, saving: true } : prev,
                  );
                  try {
                    await savePackageMeta({
                      packageId: packageMetaEditor.packageId,
                      description: packageMetaEditor.draftDescription,
                      coverUrl: packageMetaEditor.draftCoverUrl,
                    });
                    closePackageMetaEditor();
                  } catch (error) {
                    setPackageMetaEditor((prev) =>
                      prev ? { ...prev, saving: false } : prev,
                    );
                    const message =
                      error instanceof Error ? error.message : "保存失败";
                    window.alert(message);
                  }
                }}
              >
                {packageMetaEditor.saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>,
          document.body,
        )}

      {pendingImportDialog && typeof document !== "undefined"
        ? createPortal(
            <dialog
              open
              className="modal modal-open z-[10050]"
              onCancel={(event) => {
                event.preventDefault();
                setPendingImportDialog(null);
              }}
            >
              <div className="modal-box max-w-[460px] border border-base-300 bg-base-100 p-0 text-base-content shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                  <div className="text-sm font-semibold">检测到重名文件</div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    aria-label="关闭"
                    onClick={() => setPendingImportDialog(null)}
                  >
                    ✕
                  </button>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="text-xs opacity-70">
                    导入的文件名与当前目录已有内容或本次导入的其它文件重名。请选择处理方式：
                  </div>
                  <div className="text-xs opacity-60">
                    目标：
                    {findPackageById(pendingImportDialog.target.packageId)
                      ?.name ??
                      `素材包#${pendingImportDialog.target.packageId}`}
                    {pendingImportDialog.target.folderPath.length
                      ? ` / ${pendingImportDialog.target.folderPath.join(" / ")}`
                      : ""}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-base-300 px-4 py-3">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPendingImportDialog(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      void applyImportFiles({
                        target: pendingImportDialog.target,
                        files: pendingImportDialog.files,
                        policy: "autoRename",
                      });
                    }}
                  >
                    自动重命名
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      void applyImportFiles({
                        target: pendingImportDialog.target,
                        files: pendingImportDialog.files,
                        policy: "overwrite",
                      });
                    }}
                  >
                    覆盖
                  </button>
                </div>
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </div>
  );
}
