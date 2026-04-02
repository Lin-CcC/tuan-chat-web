import type {
  MaterialItemNode,
  MaterialPackageContent,
  MaterialPackageRecord,
  SpaceMaterialPackageRecord,
} from "@/components/materialPackage/materialPackageApi";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { useLocalStorage } from "@/components/common/customHooks/useLocalStorage";
import PortalTooltip from "@/components/common/portalTooltip";
import { buildEmptyMaterialPackageContent } from "@/components/chat/materialPackage/materialPackageDraft";
import type { MaterialPreviewPayload } from "@/components/chat/materialPackage/materialPackageDnd";
import {
  getMaterialPreviewDragData,
  getMaterialPreviewDragOrigin,
  isMaterialPreviewDrag,
  setMaterialPreviewDragData,
  setMaterialPreviewDragOrigin,
} from "@/components/chat/materialPackage/materialPackageDnd";
import { setMaterialBatchDragData } from "@/components/chat/materialPackage/materialPackageDndBatch";
import MaterialPackageSquareView from "@/components/chat/materialPackage/materialPackageSquareView";
import MaterialPreviewFloat from "@/components/chat/materialPackage/materialPreviewFloat";
import { autoRenameVsCodeLike } from "@/components/chat/materialPackage/materialPackageExplorerOps";
import {
  canDeleteSpaceLibrarySelectedNode,
  getSpaceLibraryDeleteDialogCopy,
  getSpaceLibraryDeleteTooltipLabel,
  parseSpaceLibrarySelectedNodeRef,
  toggleExpandedIds,
} from "@/components/chat/materialPackage/spaceMaterialLibraryOps";
import {
  isClickSuppressed,
  markClickSuppressed,
} from "@/components/chat/materialPackage/materialPackageClickSuppressor";
import type {
  MaterialFolderNode,
  MaterialNode,
} from "@/components/materialPackage/materialPackageApi";
import {
  draftCreateFolder,
  draftCreateMaterial,
  draftDeleteFolder,
  draftDeleteMaterial,
  draftRenameFolder,
  draftRenameMaterial,
  draftReorderNode,
} from "@/components/chat/materialPackage/materialPackageDraft";
import { getFolderNodesAtPath } from "@/components/chat/materialPackage/materialPackageTree";
import { AddIcon, ChevronDown, FolderIcon } from "@/icons";
import { readMockPackages as readMyMockPackages } from "@/components/chat/materialPackage/materialPackageMockStore";
import { findMockPackageById } from "@/components/chat/materialPackage/materialPackageMockStore";
import {
  nowIso,
  readSpaceMockPackages,
  writeSpaceMockPackages,
} from "@/components/chat/materialPackage/spaceMaterialMockStore";
import {
  ArrowClockwise,
  DownloadSimple,
  FileImageIcon,
  FilePlus,
  FolderPlus,
  PackageIcon,
  Plus,
  TrashIcon,
  UploadSimple,
} from "@phosphor-icons/react";
import {
  createSpaceMaterialPackage,
  deleteSpaceMaterialPackage,
  getMyMaterialPackages,
  getSpaceMaterialPackage,
  importMaterialPackageToSpace,
  listSpaceMaterialPackages,
  updateSpaceMaterialPackage,
} from "@/components/materialPackage/materialPackageApi";
import { UploadUtils } from "@/utils/UploadUtils";

type SpaceMaterialLibraryPanelProps = {
  spaceId: number;
  spaceName?: string;
  canEdit: boolean;
};

function isValidId(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function shallowArrayEqual(a: unknown, b: unknown) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function parseUpdateTimeMs(value: string | null | undefined) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : -Infinity;
}

function buildSortedSpacePackageIdOrder(
  packages: SpaceMaterialPackageRecord[],
) {
  const indexed = packages.map((pkg, index) => ({ pkg, index }));
  indexed.sort((a, b) => {
    const timeDiff =
      parseUpdateTimeMs(b.pkg.updateTime) - parseUpdateTimeMs(a.pkg.updateTime);
    if (timeDiff !== 0) return timeDiff;
    const idDiff = Number(b.pkg.spacePackageId) - Number(a.pkg.spacePackageId);
    if (idDiff !== 0) return idDiff;
    return a.index - b.index;
  });
  return indexed.map(({ pkg }) => Number(pkg.spacePackageId));
}

function reconcileSpacePackageOrder(
  prevOrder: number[],
  nextPackages: SpaceMaterialPackageRecord[],
) {
  const nextIds = nextPackages.map((p) => Number(p.spacePackageId));
  const nextIdSet = new Set(nextIds);

  const kept = prevOrder.filter((id) => nextIdSet.has(id));
  const keptSet = new Set(kept);
  const added = nextPackages.filter(
    (p) => !keptSet.has(Number(p.spacePackageId)),
  );

  const addedIds = buildSortedSpacePackageIdOrder(added);
  return [...addedIds, ...kept];
}

function buildListQueryKey(spaceId: number, useBackend: boolean) {
  return ["spaceMaterialPackages", spaceId, useBackend] as const;
}

function buildDetailQueryKey(spacePackageId: number, useBackend: boolean) {
  return ["spaceMaterialPackage", spacePackageId, useBackend] as const;
}

function buildMyPackagesQueryKey(useBackend: boolean) {
  return ["myMaterialPackages", useBackend] as const;
}

function readMockPackages(spaceId: number): SpaceMaterialPackageRecord[] {
  return readSpaceMockPackages(spaceId);
}

function writeMockPackages(
  spaceId: number,
  next: SpaceMaterialPackageRecord[],
) {
  writeSpaceMockPackages(spaceId, next);
}

function makeFolderToken(name: string) {
  return `folder:${name}`;
}

function makeMaterialToken(name: string) {
  return `material:${name}`;
}

function parseRootKeySpacePackageId(key: string) {
  const prefix = "root:";
  if (typeof key !== "string" || !key.startsWith(prefix)) return null;
  const id = Number(key.slice(prefix.length));
  return Number.isFinite(id) && id > 0 ? id : null;
}

export const SPACE_MATERIAL_MOVE_TYPE = "application/x-tc-space-material-move";

type SpaceMaterialMovePayload = {
  spaceId: number;
  packageId: number;
  kind: "folder" | "material";
  path: string[];
};

let activeSpaceMaterialMoveDrag: SpaceMaterialMovePayload | null = null;

function setSpaceMaterialMoveDragData(
  dataTransfer: DataTransfer,
  payload: SpaceMaterialMovePayload,
) {
  activeSpaceMaterialMoveDrag = payload;
  try {
    dataTransfer.setData(SPACE_MATERIAL_MOVE_TYPE, JSON.stringify(payload));
  } catch {
    // ignore
  }
  try {
    const existingPlain = dataTransfer.getData("text/plain") || "";
    if (!existingPlain.trim()) {
      dataTransfer.setData(
        "text/plain",
        `tc-space-material-move:${JSON.stringify(payload)}`,
      );
    }
  } catch {
    // ignore
  }
}

function getSpaceMaterialMoveDragData(
  dataTransfer: DataTransfer | null,
): SpaceMaterialMovePayload | null {
  if (!dataTransfer) return null;
  const parse = (raw: string) => {
    const parsed = JSON.parse(raw) as Partial<SpaceMaterialMovePayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof parsed.spaceId !== "number" ||
      !Number.isFinite(parsed.spaceId) ||
      parsed.spaceId <= 0
    )
      return null;
    if (
      typeof parsed.packageId !== "number" ||
      !Number.isFinite(parsed.packageId) ||
      parsed.packageId <= 0
    )
      return null;
    if (parsed.kind !== "folder" && parsed.kind !== "material") return null;
    const path = Array.isArray(parsed.path)
      ? parsed.path.filter((s) => typeof s === "string")
      : [];
    if (!path.length) return null;
    return {
      spaceId: parsed.spaceId,
      packageId: parsed.packageId,
      kind: parsed.kind,
      path,
    };
  };

  try {
    const raw = dataTransfer.getData(SPACE_MATERIAL_MOVE_TYPE);
    if (raw) return parse(raw);
  } catch {
    // ignore
  }
  try {
    const raw = dataTransfer.getData("text/plain") || "";
    const prefix = "tc-space-material-move:";
    if (raw.startsWith(prefix)) return parse(raw.slice(prefix.length));
  } catch {
    // ignore
  }
  return activeSpaceMaterialMoveDrag;
}

function isSpaceMaterialMoveDrag(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  try {
    return dataTransfer.types.includes(SPACE_MATERIAL_MOVE_TYPE);
  } catch {
    // ignore
  }
  return Boolean(getSpaceMaterialMoveDragData(dataTransfer));
}

export function shouldCaptureSpaceMaterialDockZonePreviewDnd(
  dataTransfer: DataTransfer | null,
) {
  if (isSpaceMaterialMoveDrag(dataTransfer)) return false;
  return isMaterialPreviewDrag(dataTransfer);
}

export type SpaceMaterialLibraryUploadClient = Pick<
  UploadUtils,
  "uploadImg" | "uploadAudio"
>;

export async function buildSpaceMaterialMessagesFromFile(args: {
  file: File;
  useBackend: boolean;
  uploadClient?: SpaceMaterialLibraryUploadClient;
}) {
  const file = args.file;
  const useBackend = args.useBackend;
  const type = String(file.type ?? "").toLowerCase();
  const ext = String(file.name ?? "").toLowerCase();

  const isImage =
    type.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(ext);
  const isAudio =
    type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(ext);
  const isText =
    type.startsWith("text/") || /\.(txt|md|json|yaml|yml|csv|log)$/.test(ext);

  if (isImage) {
    const url = useBackend
      ? await args.uploadClient?.uploadImg(file, 4)
      : URL.createObjectURL(file);
    return [
      {
        messageType: 2,
        annotations: ["图片"],
        extra: {
          imageMessage: {
            url: url ?? "",
            fileName: file.name,
          },
        },
      },
    ];
  }

  if (isAudio) {
    const url = useBackend
      ? await args.uploadClient?.uploadAudio(file, 4, 0)
      : URL.createObjectURL(file);
    return [
      {
        messageType: 3,
        annotations: ["音频"],
        extra: {
          soundMessage: {
            url: url ?? "",
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
}

function tokenToName(token: string, prefix: "folder:" | "material:") {
  return token.startsWith(prefix) ? token.slice(prefix.length) : token;
}

function payloadPathToFolderNames(path: string[]) {
  return (Array.isArray(path) ? path : [])
    .filter((p) => typeof p === "string" && p.startsWith("folder:"))
    .map((p) => tokenToName(p, "folder:"))
    .filter(Boolean);
}

function normalizeNodes(nodes: any[]): any[] {
  return Array.isArray(nodes) ? nodes.filter(Boolean) : [];
}

function SpaceMaterialTree({
  record,
  useBackend,
  isExpanded,
  onToggleExpanded,
  selectedKey,
  onSelectNode,
  onOpenPreview,
  inlineRename,
  inlineRenameInputRef,
  inlineRenameMeasureRef,
  inlineRenameWidthPx,
  onStartInlineRename,
  onDraftInlineRename,
  onCommitInlineRename,
  onCloseInlineRename,
}: {
  record: SpaceMaterialPackageRecord;
  useBackend: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  selectedKey: string | null;
  onSelectNode: (args: {
    kind: "package" | "folder" | "material";
    key: string;
    packageId: number;
  }) => void;
  onOpenPreview: (
    payload: MaterialPreviewPayload,
    hintPosition: { x: number; y: number } | null,
  ) => void;
  inlineRename: null | {
    kind: "package" | "folder" | "material";
    key: string;
    spacePackageId: number;
    folderPath: string[];
    fromName: string;
    draft: string;
    saving: boolean;
  };
  inlineRenameInputRef: React.RefObject<HTMLInputElement | null>;
  inlineRenameMeasureRef: React.RefObject<HTMLSpanElement | null>;
  inlineRenameWidthPx: number;
  onStartInlineRename: (args: {
    kind: "package" | "folder" | "material";
    key: string;
    spacePackageId: number;
    folderPath: string[];
    name: string;
  }) => void;
  onDraftInlineRename: (draft: string) => void;
  onCommitInlineRename: () => void;
  onCloseInlineRename: () => void;
}) {
  const spacePackageId = Number(record.spacePackageId);
  const isEditingRoot = inlineRename?.key === `root:${spacePackageId}`;
  const query = useQuery({
    enabled: isExpanded && isValidId(spacePackageId) && useBackend,
    queryKey: buildDetailQueryKey(spacePackageId, useBackend),
    queryFn: () => getSpaceMaterialPackage(spacePackageId),
    staleTime: 30 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const content: MaterialPackageContent = useBackend
    ? ((query.data?.content ?? record.content) as MaterialPackageContent)
    : (record.content as MaterialPackageContent);
  const root = normalizeNodes((content as any)?.root);
  const nodeCount = Array.isArray((content as any)?.root)
    ? (content as any).root.length
    : 0;
  const [collapsedFolderKey, setCollapsedFolderKey] = useState<
    Record<string, boolean>
  >({});

  const renderNodes = (nodes: any[], folderPath: string[], depth: number) => {
    return nodes.map((node, index) => {
      if (!node || typeof node !== "object") return null;
      const key = `${depth}:${index}:${node.type}:${node.name}`;
      if (node.type === "folder") {
        const children = normalizeNodes(node.children);
        const nextPath = [...folderPath, node.name];
        const payloadPath = [
          ...folderPath.map(makeFolderToken),
          makeFolderToken(node.name),
        ];
        const nodeKey = `folder:${spacePackageId}:${payloadPath.join("/")}`;
        const isCollapsed = Boolean(collapsedFolderKey[nodeKey]);
        const isEditingName = inlineRename?.key === nodeKey;
        return (
          <div key={key}>
            <div
              className={`px-1 rounded-md`}
              data-node-key={nodeKey}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "copy";
                setMaterialPreviewDragData(e.dataTransfer, {
                  scope: "space",
                  spaceId: record.spaceId,
                  kind: "folder",
                  packageId: spacePackageId,
                  label: node.name,
                  path: payloadPath,
                });
                setMaterialPreviewDragOrigin(e.dataTransfer, "tree");
              }}
              onClick={() => {
                onSelectNode({
                  kind: "folder",
                  key: nodeKey,
                  packageId: spacePackageId,
                });
              }}
              onDoubleClick={(e) => {
                const target = e.target as HTMLElement | null;
                if (target?.closest?.("[data-inline-rename='1']")) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!inlineRename || inlineRename.key !== nodeKey) {
                    onStartInlineRename({
                      kind: "folder",
                      key: nodeKey,
                      spacePackageId,
                      folderPath: nextPath,
                      name: node.name,
                    });
                  }
                  return;
                }
                onOpenPreview(
                  {
                    scope: "space",
                    spaceId: record.spaceId,
                    kind: "folder",
                    packageId: spacePackageId,
                    label: node.name,
                    path: payloadPath,
                  },
                  {
                    x: Math.max(8, e.clientX - 80),
                    y: Math.max(8, e.clientY - 16),
                  },
                );
              }}
            >
              <div
                className={`flex items-center gap-1 py-1 pr-1 text-xs font-medium opacity-85 select-none rounded-md ${selectedKey === nodeKey ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"}`}
                style={{ paddingLeft: 4 + depth * 14 }}
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCollapsedFolderKey((prev) => ({
                      ...prev,
                      [nodeKey]: !Boolean(prev[nodeKey]),
                    }));
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  title={isCollapsed ? "展开" : "折叠"}
                >
                  <ChevronDown
                    className={`size-4 opacity-80 ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                </button>
                <FolderIcon className="size-4 opacity-70" />
                {isEditingName ? (
                  <div className="relative">
                    <span
                      ref={inlineRenameMeasureRef}
                      className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre px-1 text-xs"
                    >
                      {inlineRename?.draft ?? ""}
                    </span>
                    <input
                      ref={inlineRenameInputRef}
                      value={inlineRename?.draft ?? ""}
                      onChange={(e) => onDraftInlineRename(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          onCommitInlineRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          onCloseInlineRename();
                        }
                      }}
                      onBlur={() => onCommitInlineRename()}
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
                  <span
                    className="inline-block max-w-full truncate"
                    data-inline-rename="1"
                    title="双击重命名"
                  >
                    {node.name}
                  </span>
                )}
              </div>
            </div>
            {!isCollapsed && renderNodes(children, nextPath, depth + 1)}
          </div>
        );
      }

      if (node.type === "material") {
        const payloadPath = [
          ...folderPath.map(makeFolderToken),
          makeMaterialToken(String(node.name ?? "")),
        ];
        const nodeKey = `material:${spacePackageId}:${payloadPath.join("/")}`;
        const isEditingName = inlineRename?.key === nodeKey;
        return (
          <div
            key={key}
            className={`flex items-center gap-2 py-1 pr-2 text-xs opacity-85 select-none rounded-md ${selectedKey === nodeKey ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"}`}
            style={{ paddingLeft: 22 + depth * 14 }}
            data-node-key={nodeKey}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "copy";
              setMaterialPreviewDragData(e.dataTransfer, {
                scope: "space",
                spaceId: record.spaceId,
                kind: "material",
                packageId: spacePackageId,
                label: node.name,
                path: payloadPath,
              });
              setMaterialPreviewDragOrigin(e.dataTransfer, "tree");
            }}
            onClick={() => {
              onSelectNode({
                kind: "material",
                key: nodeKey,
                packageId: spacePackageId,
              });
            }}
            onDoubleClick={(e) => {
              const target = e.target as HTMLElement | null;
              if (target?.closest?.("[data-inline-rename='1']")) {
                e.preventDefault();
                e.stopPropagation();
                if (!inlineRename || inlineRename.key !== nodeKey) {
                  onStartInlineRename({
                    kind: "material",
                    key: nodeKey,
                    spacePackageId,
                    folderPath,
                    name: node.name,
                  });
                }
                return;
              }
              onOpenPreview(
                {
                  scope: "space",
                  spaceId: record.spaceId,
                  kind: "material",
                  packageId: spacePackageId,
                  label: node.name,
                  path: payloadPath,
                },
                {
                  x: Math.max(8, e.clientX - 80),
                  y: Math.max(8, e.clientY - 16),
                },
              );
            }}
          >
            <FileImageIcon className="size-4 opacity-70" />
            {isEditingName ? (
              <div className="relative">
                <span
                  ref={inlineRenameMeasureRef}
                  className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre px-1 text-xs"
                >
                  {inlineRename?.draft ?? ""}
                </span>
                <input
                  ref={inlineRenameInputRef}
                  value={inlineRename?.draft ?? ""}
                  onChange={(e) => onDraftInlineRename(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCommitInlineRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      onCloseInlineRename();
                    }
                  }}
                  onBlur={() => onCommitInlineRename()}
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
              <span
                className="inline-block max-w-full truncate"
                data-inline-rename="1"
                title="双击重命名"
              >
                {node.name}
              </span>
            )}
          </div>
        );
      }

      return null;
    });
  };

  return (
    <div className="px-1 rounded-md" data-node-key={`root:${spacePackageId}`}>
      <div
        className={`flex items-center gap-2 py-1 pr-1 text-xs font-medium opacity-85 select-none rounded-md ${selectedKey === `root:${spacePackageId}` ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"}`}
        onClick={() => {
          onSelectNode({
            kind: "package",
            key: `root:${spacePackageId}`,
            packageId: spacePackageId,
          });
          onToggleExpanded();
        }}
        onDoubleClick={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest?.("[data-inline-rename='1']")) {
            e.preventDefault();
            e.stopPropagation();
            if (
              !inlineRename ||
              inlineRename.key !== `root:${spacePackageId}`
            ) {
              onStartInlineRename({
                kind: "package",
                key: `root:${spacePackageId}`,
                spacePackageId,
                folderPath: [],
                name: record.name,
              });
            }
            return;
          }
          onOpenPreview(
            {
              scope: "space",
              spaceId: record.spaceId,
              kind: "package",
              packageId: spacePackageId,
              label: record.name,
              path: [],
            },
            { x: Math.max(8, e.clientX - 80), y: Math.max(8, e.clientY - 16) },
          );
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleExpanded();
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          title={isExpanded ? "折叠" : "展开"}
        >
          <ChevronDown
            className={`size-4 opacity-80 ${isExpanded ? "" : "-rotate-90"}`}
          />
        </button>
        <div
          className={`flex-1 min-w-0 truncate ${selectedKey === `root:${spacePackageId}` ? "text-base-content" : ""}`}
        >
          <span className="inline-flex items-center gap-1">
            <PackageIcon className="size-4 opacity-70" />
            {isEditingRoot ? (
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
                  onChange={(e) => onDraftInlineRename(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCommitInlineRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      onCloseInlineRename();
                    }
                  }}
                  onBlur={() => onCommitInlineRename()}
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
              <span
                className="inline-block max-w-full truncate"
                data-inline-rename="1"
                title="双击重命名"
              >
                {record.name}
              </span>
            )}
          </span>
        </div>
        <PortalTooltip
          label={nodeCount ? `${nodeCount}项` : "空"}
          placement="right"
        >
          <span className="text-[11px] opacity-50 px-1">
            {nodeCount ? `${nodeCount}项` : "空"}
          </span>
        </PortalTooltip>
      </div>

      {isExpanded && (
        <div className="pl-6 pr-1 pb-1">
          {useBackend && query.isLoading && (
            <div className="px-2 py-1 text-xs text-base-content/60">
              加载中…
            </div>
          )}
          {renderNodes(root, [], 0)}
        </div>
      )}
    </div>
  );
}

export function SpaceMaterialLibraryCategory({
  spaceId,
  spaceName,
  canEdit,
}: SpaceMaterialLibraryPanelProps) {
  const queryClient = useQueryClient();

  const uploadUtilsRef = useRef(new UploadUtils());

  const defaultUseBackend = !(import.meta.env.MODE === "test");
  const [useBackend, setUseBackend] = useLocalStorage<boolean>(
    "tc:material-package:use-backend",
    defaultUseBackend,
  );
  const [collapsedBySpace, setCollapsedBySpace] = useLocalStorage<
    Record<string, boolean>
  >("tc:space-material-library:collapsed", {});
  const [toolbarPinnedBySpace, setToolbarPinnedBySpace] = useLocalStorage<
    Record<string, boolean>
  >("tc:space-material-library:toolbar-pinned", {});
  const [collapsedFolderByKey, setCollapsedFolderByKey] = useLocalStorage<
    Record<string, boolean>
  >(`tc:space-material-library:folder-collapsed:${spaceId}`, {});
  const isCollapsed = Boolean(collapsedBySpace[String(spaceId)]);
  const toolbarPinned = Boolean(toolbarPinnedBySpace[String(spaceId)]);
  // IMPORTANT: this panel can be mounted multiple times (e.g. multiple rooms under the same space).
  // Use an instance-unique dock context id to avoid global window event / DOM selector cross-talk.
  const dockInstanceId = useMemo(() => {
    try {
      // Prefer stable random UUID when available.
      if (
        typeof crypto !== "undefined" &&
        typeof (crypto as any).randomUUID === "function"
      ) {
        return String((crypto as any).randomUUID());
      }
    } catch {
      // ignore
    }
    return `r${Math.random().toString(36).slice(2, 10)}`;
  }, []);
  const dockContextId = useMemo(
    () => `space-material:${spaceId}:${dockInstanceId}`,
    [dockInstanceId, spaceId],
  );
  const toggleCollapsed = useCallback(() => {
    setCollapsedBySpace((prev) => ({
      ...prev,
      [String(spaceId)]: !Boolean(prev[String(spaceId)]),
    }));
  }, [setCollapsedBySpace, spaceId]);
  const toggleToolbarPinned = useCallback(() => {
    setToolbarPinnedBySpace((prev) => ({
      ...prev,
      [String(spaceId)]: !Boolean(prev[String(spaceId)]),
    }));
  }, [setToolbarPinnedBySpace, spaceId]);
  const toggleFolderCollapsed = useCallback(
    (key: string) => {
      setCollapsedFolderByKey((prev) => ({
        ...prev,
        [key]: !Boolean(prev[key]),
      }));
    },
    [setCollapsedFolderByKey],
  );

  const clampInt = useCallback((value: number, min: number, max: number) => {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      const next = Boolean(detail?.useBackend);
      setUseBackend(next);
    };
    window.addEventListener(
      "tc:material-package:use-backend-changed",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "tc:material-package:use-backend-changed",
        handler as EventListener,
      );
  }, [setUseBackend]);

  const listQuery = useQuery({
    queryKey: buildListQueryKey(spaceId, useBackend),
    queryFn: async () => {
      if (!useBackend) return readMockPackages(spaceId);
      return await listSpaceMaterialPackages(spaceId);
    },
    staleTime: 30 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const rawPackages = useMemo(
    () => (Array.isArray(listQuery.data) ? listQuery.data : []),
    [listQuery.data],
  );
  const [storedSpacePackageOrder, setStoredSpacePackageOrder] = useLocalStorage<
    number[]
  >(`tc:space-material-library:package-order:${spaceId}`, []);
  const [spacePackageOrder, setSpacePackageOrder] = useState<number[] | null>(
    null,
  );
  const suppressPackageClickUntilMsRef = useRef<number>(0);
  const spacePackageReorderDropRef = useRef<{
    key: string;
    placement: "before" | "after";
  } | null>(null);
  const [spacePackageReorderDrop, setSpacePackageReorderDrop] = useState<{
    key: string;
    placement: "before" | "after";
  } | null>(null);
  const spacePackageReorderDragRef = useRef<{ sourceId: number } | null>(null);

  useEffect(() => {
    if (!rawPackages.length) {
      setSpacePackageOrder(null);
      if (storedSpacePackageOrder?.length) {
        setStoredSpacePackageOrder([]);
      }
      return;
    }

    setSpacePackageOrder((prev) => {
      const basePrev = prev?.length
        ? prev
        : Array.isArray(storedSpacePackageOrder)
          ? storedSpacePackageOrder
          : [];
      if (!basePrev?.length) {
        return buildSortedSpacePackageIdOrder(rawPackages);
      }
      return reconcileSpacePackageOrder(basePrev, rawPackages);
    });
  }, [rawPackages, setStoredSpacePackageOrder, storedSpacePackageOrder]);

  useEffect(() => {
    if (!spacePackageOrder?.length) return;
    setStoredSpacePackageOrder((prev) =>
      shallowArrayEqual(prev, spacePackageOrder) ? prev : spacePackageOrder,
    );
  }, [setStoredSpacePackageOrder, spacePackageOrder]);

  const packages = useMemo(() => {
    if (!spacePackageOrder?.length) return rawPackages;
    const byId = new Map<number, SpaceMaterialPackageRecord>();
    rawPackages.forEach((pkg) => {
      byId.set(Number(pkg.spacePackageId), pkg);
    });
    const ordered: SpaceMaterialPackageRecord[] = [];
    spacePackageOrder.forEach((id) => {
      const pkg = byId.get(id);
      if (pkg) ordered.push(pkg);
    });
    if (ordered.length === rawPackages.length) return ordered;
    const orderedSet = new Set(ordered.map((p) => Number(p.spacePackageId)));
    rawPackages.forEach((pkg) => {
      const id = Number(pkg.spacePackageId);
      if (!orderedSet.has(id)) ordered.push(pkg);
    });
    return ordered;
  }, [rawPackages, spacePackageOrder]);

  const reorderSpacePackageOrder = useCallback(
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

      setSpacePackageOrder((prev) => {
        const base =
          Array.isArray(prev) && prev.length
            ? [...prev]
            : packages.map((p) => Number(p.spacePackageId));
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
  const [expandedPackageIds, setExpandedPackageIds] = useState<number[]>([]);
  const expandedPackageIdSet = useMemo(
    () => new Set(expandedPackageIds.map((id) => Number(id))),
    [expandedPackageIds],
  );
  const toggleExpandedPackage = useCallback((spacePackageId: number) => {
    setExpandedPackageIds((prev) => toggleExpandedIds(prev, spacePackageId));
  }, []);
  const ensureExpandedPackage = useCallback((spacePackageId: number) => {
    const nextId = Number(spacePackageId);
    if (!Number.isFinite(nextId) || nextId <= 0) return;
    setExpandedPackageIds((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      return base.includes(nextId) ? prev : [...base, nextId];
    });
  }, []);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isImportFromMyOpen, setIsImportFromMyOpen] = useState(false);
  const [activePreview, setActivePreview] =
    useState<MaterialPreviewPayload | null>(null);
  const [previewHintPos, setPreviewHintPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [activePreviewInitialSize, setActivePreviewInitialSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [dockedPreview, setDockedPreview] =
    useState<MaterialPreviewPayload | null>(null);
  const [dockedIndex, setDockedIndex] = useState<number>(0);
  const [dockHint, setDockHint] = useState<{
    index: number;
    text: string;
  } | null>(null);
  const [dockLineTop, setDockLineTop] = useState<number | null>(null);
  const [dockTipTop, setDockTipTop] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const treeItemsRef = useRef<HTMLDivElement | null>(null);
  const [moveDropTargetKey, setMoveDropTargetKey] = useState<string | null>(
    null,
  );
  const [reorderDropTargetKey, setReorderDropTargetKey] = useState<
    string | null
  >(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [pendingDeleteTarget, setPendingDeleteTarget] = useState<null | {
    kind: "package" | "folder" | "material";
    packageId: number;
    parentPath: string[];
    name: string;
  }>(null);
  const [selectedNode, setSelectedNode] = useState<{
    kind: "package" | "folder" | "material";
    key: string;
    packageId: number;
  } | null>(null);
  const [selectedMaterialKeys, setSelectedMaterialKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const localImportInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingLocalImportTarget, setPendingLocalImportTarget] = useState<{
    packageId: number;
    folderPath: string[];
  } | null>(null);
  const [myImportKeyword, setMyImportKeyword] = useState("");
  const [selectedMyPackageId, setSelectedMyPackageId] = useState<number | null>(
    null,
  );
  const [isMyImporting, setIsMyImporting] = useState(false);
  const [inlineRename, setInlineRename] = useState<null | {
    kind: "package" | "folder" | "material";
    key: string;
    spacePackageId: number;
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

  const openPreview = useCallback(
    (
      payload: MaterialPreviewPayload,
      hintPosition: { x: number; y: number } | null,
      options?: { initialSize?: { w: number; h: number } | null },
    ) => {
      setActivePreview(payload);
      setPreviewHintPos(hintPosition);
      setActivePreviewInitialSize(options?.initialSize ?? null);
    },
    [],
  );

  const clearMaterialSelection = useCallback(() => {
    setSelectedMaterialKeys((prev) => (prev.size ? new Set() : prev));
  }, []);

  useEffect(() => {
    clearMaterialSelection();
  }, [clearMaterialSelection, expandedPackageIds, spaceId, useBackend]);

  const dockPreview = useCallback(
    (
      payload: MaterialPreviewPayload,
      options?: { index?: number; placement?: "top" | "bottom" },
    ) => {
      setDockedPreview(payload);
      if (
        typeof options?.index === "number" &&
        Number.isFinite(options.index)
      ) {
        setDockedIndex(Math.max(0, Math.floor(options.index)));
      } else if (options?.placement === "bottom") {
        setDockedIndex(Number.MAX_SAFE_INTEGER);
      } else {
        setDockedIndex(0);
      }
      setActivePreview(null);
      setPreviewHintPos(null);
    },
    [],
  );

  const undockPreview = useCallback(() => {
    setDockedPreview(null);
  }, []);

  const closeInlineRename = useCallback(() => {
    setInlineRename(null);
  }, []);

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

  const startInlineRename = useCallback(
    (args: {
      kind: "package" | "folder" | "material";
      key: string;
      spacePackageId: number;
      folderPath: string[];
      name: string;
    }) => {
      const trimmed = String(args.name ?? "").trim();
      if (!trimmed) return;
      setInlineRename({
        kind: args.kind,
        key: args.key,
        spacePackageId: args.spacePackageId,
        folderPath: args.folderPath,
        fromName: trimmed,
        draft: trimmed,
        saving: false,
      });
    },
    [],
  );

  const draftInlineRename = useCallback((draft: string) => {
    setInlineRename((prev) => (prev ? { ...prev, draft } : prev));
  }, []);

  const activePackageId = useMemo(() => {
    if (selectedNode?.packageId) return selectedNode.packageId;
    if (expandedPackageIds.length) {
      const last = expandedPackageIds[expandedPackageIds.length - 1];
      return isValidId(last) ? last : null;
    }
    return null;
  }, [expandedPackageIds, selectedNode?.packageId]);

  const expandedDetailIds = useMemo(() => {
    if (!useBackend) return [];
    const uniq: number[] = [];
    const seen = new Set<number>();
    for (const raw of expandedPackageIds) {
      const id = Number(raw);
      if (!isValidId(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      uniq.push(id);
    }
    return uniq;
  }, [expandedPackageIds, useBackend]);

  const expandedDetailQueries = useQueries({
    queries: expandedDetailIds.map((spacePackageId) => ({
      enabled: useBackend,
      queryKey: buildDetailQueryKey(spacePackageId, useBackend),
      queryFn: () => getSpaceMaterialPackage(spacePackageId),
      staleTime: 30 * 1000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });

  const expandedDetailContentById = useMemo(() => {
    const map = new Map<number, MaterialPackageContent>();
    for (let i = 0; i < expandedDetailIds.length; i += 1) {
      const id = expandedDetailIds[i];
      const data = (expandedDetailQueries[i] as any)?.data ?? null;
      const content = data?.content ?? null;
      if (content) {
        map.set(id, content as MaterialPackageContent);
      }
    }
    return map;
  }, [expandedDetailIds, expandedDetailQueries]);

  type VisibleItem =
    | {
        kind: "dockPreview";
        key: "dock-preview";
        payload: MaterialPreviewPayload;
      }
    | {
        kind: "package";
        key: string;
        baseIndex: number;
        isExpanded: boolean;
        nodeCount: number;
        record: SpaceMaterialPackageRecord;
        payload: MaterialPreviewPayload;
      }
    | {
        kind: "folder";
        key: string;
        baseIndex: number;
        depth: number;
        isCollapsed: boolean;
        name: string;
        payload: MaterialPreviewPayload;
        folderPath: string[];
      }
    | {
        kind: "material";
        key: string;
        baseIndex: number;
        depth: number;
        name: string;
        payload: MaterialPreviewPayload;
        folderPath: string[];
      };

  const baseVisibleItems = useMemo(() => {
    const items: VisibleItem[] = [];

    const pushNode = (
      spacePackageId: number,
      node: any,
      folderPath: string[],
      pathTokens: string[],
      depth: number,
    ) => {
      const indent = depth * 14;
      if (node?.type === "folder") {
        const nextFolderPath = [...folderPath, String(node.name ?? "")];
        const nextTokens = [
          ...pathTokens,
          makeFolderToken(String(node.name ?? "")),
        ];
        const key = `folder:${spacePackageId}:${nextTokens.join("/")}`;
        const isCollapsedFolder = Boolean(collapsedFolderByKey[key]);
        const payload: MaterialPreviewPayload = {
          scope: "space",
          spaceId,
          kind: "folder",
          packageId: spacePackageId,
          label: String(node.name ?? ""),
          path: nextTokens,
        };
        items.push({
          kind: "folder",
          key,
          baseIndex: items.length,
          depth: indent,
          isCollapsed: isCollapsedFolder,
          name: String(node.name ?? ""),
          payload,
          folderPath: nextFolderPath,
        });
        if (!isCollapsedFolder) {
          const children = normalizeNodes(node.children);
          for (const child of children) {
            pushNode(
              spacePackageId,
              child,
              nextFolderPath,
              nextTokens,
              depth + 1,
            );
          }
        }
        return;
      }

      if (node?.type === "material") {
        const name = String(node.name ?? "");
        const tokens = [...pathTokens, makeMaterialToken(name)];
        const key = `material:${spacePackageId}:${tokens.join("/")}`;
        const payload: MaterialPreviewPayload = {
          scope: "space",
          spaceId,
          kind: "material",
          packageId: spacePackageId,
          label: name,
          path: tokens,
        };
        items.push({
          kind: "material",
          key,
          baseIndex: items.length,
          depth: indent,
          name,
          payload,
          folderPath,
        });
      }
    };

    for (const pkg of packages) {
      const spacePackageId = Number(pkg.spacePackageId ?? 0);
      if (!isValidId(spacePackageId)) continue;

      const isExpanded = expandedPackageIdSet.has(Number(spacePackageId));
      const expandedContent = useBackend
        ? (expandedDetailContentById.get(Number(spacePackageId)) ?? null)
        : null;
      const content: MaterialPackageContent =
        isExpanded && expandedContent
          ? (expandedContent as MaterialPackageContent)
          : ((pkg.content ??
              buildEmptyMaterialPackageContent()) as MaterialPackageContent);

      const rootNodes = normalizeNodes((content as any)?.root);
      const rootKey = `root:${spacePackageId}`;
      const label = String(pkg.name ?? `素材箱#${spacePackageId}`);
      const payload: MaterialPreviewPayload = {
        scope: "space",
        spaceId,
        kind: "package",
        packageId: spacePackageId,
        label,
        path: [],
      };
      items.push({
        kind: "package",
        key: rootKey,
        baseIndex: items.length,
        isExpanded,
        nodeCount: rootNodes.length,
        record: pkg,
        payload,
      });

      if (!isExpanded) continue;

      for (const node of rootNodes) {
        pushNode(spacePackageId, node, [], [], 1);
      }
    }

    return items;
  }, [
    collapsedFolderByKey,
    expandedDetailContentById,
    expandedPackageIdSet,
    packages,
    spaceId,
    useBackend,
  ]);

  const baseItemCount = baseVisibleItems.length;
  const resolvedDockIndex = useMemo(
    () => clampInt(dockedIndex, 0, baseItemCount),
    [baseItemCount, clampInt, dockedIndex],
  );

  const packageBottomInsertIndex = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of baseVisibleItems) {
      if (item.kind === "dockPreview") continue;
      const pkgId = Number((item as any)?.payload?.packageId ?? 0);
      if (!isValidId(pkgId)) continue;
      const last = map.get(pkgId);
      if (
        typeof last !== "number" ||
        !Number.isFinite(last) ||
        item.baseIndex > last
      ) {
        map.set(pkgId, item.baseIndex);
      }
    }
    // convert last baseIndex -> insert index
    const insert = new Map<number, number>();
    for (const [pkgId, lastIndex] of map.entries()) {
      insert.set(pkgId, lastIndex + 1);
    }
    return insert;
  }, [baseVisibleItems]);

  const visibleItems = useMemo(() => {
    if (!dockedPreview) {
      return baseVisibleItems;
    }
    const next: VisibleItem[] = [...baseVisibleItems];
    next.splice(resolvedDockIndex, 0, {
      kind: "dockPreview",
      key: "dock-preview",
      payload: dockedPreview,
    });
    return next;
  }, [baseVisibleItems, dockedPreview, resolvedDockIndex]);

  const selectedMaterialPayloadsInOrder = useMemo(() => {
    if (!selectedMaterialKeys.size) return [];
    return baseVisibleItems
      .filter(
        (item) =>
          item.kind === "material" && selectedMaterialKeys.has(item.key),
      )
      .map((item) => item.payload);
  }, [baseVisibleItems, selectedMaterialKeys]);

  const clearDockHint = useCallback(() => {
    setDockHint(null);
    setDockLineTop(null);
    setDockTipTop(null);
  }, []);

  const applyDockHint = useCallback((hint: { index: number; text: string }) => {
    setDockHint(hint);
    const scrollEl = scrollRef.current;
    const itemsRoot = treeItemsRef.current;
    if (!scrollEl || !itemsRoot) {
      setDockLineTop(null);
      setDockTipTop(null);
      return;
    }
    const scrollRect = scrollEl.getBoundingClientRect();
    const rows = Array.from(
      itemsRoot.querySelectorAll<HTMLElement>(
        "[data-role='material-package-visible-row'][data-base-index]",
      ),
    );
    if (!rows.length) {
      const top =
        hint.index <= 0 ? 44 : Math.max(72, scrollEl.scrollHeight - 24);
      setDockLineTop(top);
      setDockTipTop(top + 6);
      return;
    }
    const last = rows[rows.length - 1]!;
    const exact =
      rows.find((el) => Number(el.dataset.baseIndex) === hint.index) ?? null;
    const rect = (exact ?? last).getBoundingClientRect();
    const y = exact ? rect.top : rect.bottom + 1;
    const localY = y - scrollRect.top + scrollEl.scrollTop;
    setDockLineTop(localY);
    setDockTipTop(localY + 6);
  }, []);

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
          return Number.isFinite(idx) ? clampInt(idx, 0, baseItemCount) : 0;
        }
      }
      return baseItemCount;
    },
    [baseItemCount, clampInt],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      if (detail?.contextId !== dockContextId) {
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
      }
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
  }, [applyDockHint, baseItemCount, clampInt, clearDockHint, dockContextId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      if (detail?.contextId !== dockContextId) {
        return;
      }
      const index =
        typeof detail?.index === "number" && Number.isFinite(detail.index)
          ? clampInt(Math.floor(detail.index), 0, baseItemCount)
          : null;
      if (index == null) {
        return;
      }
      setDockedIndex(index);
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
  }, [baseItemCount, clampInt, dockContextId]);

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
      dockPreview(payload, { index });
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
  }, [baseItemCount, clampInt, dockContextId, dockPreview]);

  const closeDeleteConfirm = () => {
    setIsDeleteConfirmOpen(false);
    setPendingDeleteTarget(null);
  };

  const myPackagesQuery = useQuery({
    enabled: isImportFromMyOpen,
    queryKey: buildMyPackagesQueryKey(useBackend),
    queryFn: () =>
      useBackend
        ? getMyMaterialPackages()
        : Promise.resolve(readMyMockPackages()),
    staleTime: 30 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const myPackages = useMemo(
    () =>
      Array.isArray(myPackagesQuery.data)
        ? (myPackagesQuery.data as MaterialPackageRecord[])
        : [],
    [myPackagesQuery.data],
  );
  const filteredMyPackages = useMemo(() => {
    const q = myImportKeyword.trim().toLowerCase();
    if (!q) return myPackages;
    return myPackages.filter((pkg) => {
      const name = String(pkg?.name ?? "")
        .trim()
        .toLowerCase();
      const desc = String(pkg?.description ?? "")
        .trim()
        .toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [myImportKeyword, myPackages]);

  const selectedMyPackage = useMemo(() => {
    if (!isValidId(selectedMyPackageId)) return null;
    return (
      myPackages.find((p) => Number(p.packageId) === selectedMyPackageId) ??
      null
    );
  }, [myPackages, selectedMyPackageId]);

  const loadPackageContent = useCallback(
    async (spacePackageId: number) => {
      if (!useBackend) {
        const found = readMockPackages(spaceId).find(
          (p) => p.spacePackageId === spacePackageId,
        );
        return (found?.content ??
          buildEmptyMaterialPackageContent()) as MaterialPackageContent;
      }
      const detail = await getSpaceMaterialPackage(spacePackageId);
      return (detail?.content ??
        buildEmptyMaterialPackageContent()) as MaterialPackageContent;
    },
    [spaceId, useBackend],
  );

  const savePackageContent = useCallback(
    async (spacePackageId: number, nextContent: MaterialPackageContent) => {
      if (!useBackend) {
        const base = readMockPackages(spaceId);
        writeMockPackages(
          spaceId,
          base.map((p) =>
            p.spacePackageId === spacePackageId
              ? { ...p, content: nextContent, updateTime: nowIso() }
              : p,
          ),
        );
        await queryClient.invalidateQueries({
          queryKey: buildListQueryKey(spaceId, useBackend),
        });
        return;
      }
      await updateSpaceMaterialPackage({
        spacePackageId,
        content: nextContent,
      });
      await queryClient.invalidateQueries({
        queryKey: buildListQueryKey(spaceId, useBackend),
      });
      await queryClient.invalidateQueries({
        queryKey: buildDetailQueryKey(spacePackageId, useBackend),
      });
    },
    [queryClient, spaceId, useBackend],
  );

  const reorderNode = useCallback(
    async (args: {
      source: SpaceMaterialMovePayload;
      dest: {
        packageId: number;
        folderPath: string[];
        insertBefore: { type: "folder" | "material"; name: string };
      };
    }) => {
      if (!canEdit) {
        toast.error("当前无权限修改局内素材库。");
        return;
      }
      const { source, dest } = args;
      if (!isValidId(source.packageId) || !isValidId(dest.packageId)) return;
      if (Number(source.spaceId) !== Number(spaceId)) return;
      if (Number(source.packageId) !== Number(dest.packageId)) {
        toast.error("当前仅支持同一素材箱内排序。");
        return;
      }

      const sourceFolderNames = payloadPathToFolderNames(source.path);
      const sourceMaterialToken = source.path[source.path.length - 1] ?? "";
      const sourceName =
        source.kind === "material"
          ? tokenToName(String(sourceMaterialToken), "material:")
          : (sourceFolderNames[sourceFolderNames.length - 1] ?? "");
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

      const toastId = `space-material-reorder:${source.packageId}:${source.kind}:${sourceName}`;
      toast.loading("正在调整顺序…", { id: toastId });
      try {
        const content = await loadPackageContent(source.packageId);
        const next = draftReorderNode(
          content,
          destParentPath,
          { type: source.kind, name: sourceName },
          {
            insertBefore: {
              type: dest.insertBefore.type,
              name: dest.insertBefore.name,
            },
          },
        );
        await savePackageContent(source.packageId, next);
        toast.success("已调整顺序", { id: toastId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "排序失败";
        toast.error(message, { id: toastId });
      }
    },
    [canEdit, loadPackageContent, savePackageContent, spaceId],
  );

  const moveNode = useCallback(
    async (args: {
      source: SpaceMaterialMovePayload;
      dest: { packageId: number; folderPath: string[] };
    }) => {
      if (!canEdit) {
        toast.error("当前无权限修改局内素材库。");
        return;
      }
      const { source, dest } = args;
      if (!isValidId(source.packageId) || !isValidId(dest.packageId)) return;
      if (Number(source.spaceId) !== Number(spaceId)) return;

      const sourceFolderNames = payloadPathToFolderNames(source.path);
      const sourceMaterialToken = source.path[source.path.length - 1] ?? "";
      const sourceName =
        source.kind === "material"
          ? tokenToName(String(sourceMaterialToken), "material:")
          : (sourceFolderNames[sourceFolderNames.length - 1] ?? "");
      if (!sourceName) return;

      const sourceParentPath =
        source.kind === "folder"
          ? sourceFolderNames.slice(0, -1)
          : sourceFolderNames;

      // 防止把文件夹拖进自己的子孙目录
      if (
        source.kind === "folder" &&
        Number(source.packageId) === Number(dest.packageId)
      ) {
        const destPath = dest.folderPath;
        const fromPath = sourceFolderNames;
        const isDescendant =
          destPath.length >= fromPath.length &&
          fromPath.every((name, idx) => destPath[idx] === name);
        if (isDescendant) {
          toast.error("不能将文件夹移动到自身或其子目录中。");
          return;
        }
      }

      const toastId = `space-material-move:${source.packageId}:${source.kind}:${sourceName}`;
      toast.loading("正在移动…", { id: toastId });

      try {
        // 读 source 内容并取出节点
        const sourceContent = await loadPackageContent(source.packageId);
        let removedNode: MaterialNode | null = null;
        const contentAfterRemove = (() => {
          if (source.kind === "folder") {
            const siblings = getFolderNodesAtPath(
              sourceContent,
              sourceParentPath,
            );
            removedNode =
              (siblings.find(
                (n) => n.type === "folder" && n.name === sourceName,
              ) as MaterialFolderNode | undefined) ?? null;
            return draftDeleteFolder(
              sourceContent,
              sourceParentPath,
              sourceName,
            );
          }
          const siblings = getFolderNodesAtPath(
            sourceContent,
            sourceParentPath,
          );
          removedNode =
            (siblings.find(
              (n) => n.type === "material" && n.name === sourceName,
            ) as MaterialItemNode | undefined) ?? null;
          return draftDeleteMaterial(
            sourceContent,
            sourceParentPath,
            sourceName,
          );
        })();

        if (!removedNode) {
          toast.error("要移动的节点不存在或已被刷新。", { id: toastId });
          return;
        }

        // 读 dest 内容并插入（重名自动改名）
        const destContent =
          Number(dest.packageId) === Number(source.packageId)
            ? contentAfterRemove
            : await loadPackageContent(dest.packageId);
        const destSiblings = getFolderNodesAtPath(destContent, dest.folderPath);
        const usedNames = destSiblings.map((n) => n.name);
        const finalName = autoRenameVsCodeLike(removedNode.name, usedNames);
        const normalizedNode: MaterialNode =
          finalName === removedNode.name
            ? removedNode
            : ({ ...removedNode, name: finalName } as MaterialNode);

        const contentAfterInsert = (() => {
          // 直接追加到末尾
          if (normalizedNode.type === "folder") {
            return draftCreateFolder(
              destContent,
              dest.folderPath,
              normalizedNode.name,
            );
          }
          return draftCreateMaterial(
            destContent,
            dest.folderPath,
            normalizedNode as MaterialItemNode,
          );
        })();

        // 如果是 folder，通过 draftCreateFolder 只会创建空 folder，需要保留 children：
        // 这里改为：先 create，再把创建出的 folder 替换为完整 node
        let finalContent = contentAfterInsert;
        if (normalizedNode.type === "folder") {
          const fullNode = normalizedNode as MaterialFolderNode;
          finalContent = ((): MaterialPackageContent => {
            const targetPath = [...dest.folderPath, fullNode.name];
            const parentPath = dest.folderPath;
            return (function replaceFolder(content: MaterialPackageContent) {
              const root = Array.isArray(content.root) ? content.root : [];
              const walk = (
                nodes: MaterialNode[],
                folderPath: string[],
              ): MaterialNode[] => {
                if (folderPath.length === 0) {
                  let changed = false;
                  const nextNodes = nodes.map((n) => {
                    if (n.type !== "folder") return n;
                    if (n.name !== fullNode.name) return n;
                    changed = true;
                    return { ...fullNode };
                  });
                  return changed ? nextNodes : nodes;
                }
                const [head, ...rest] = folderPath;
                let changed = false;
                const nextNodes = nodes.map((n) => {
                  if (n.type !== "folder" || n.name !== head) return n;
                  const nextChildren = walk(n.children, rest);
                  if (nextChildren === n.children) return n;
                  changed = true;
                  return { ...n, children: nextChildren } as MaterialNode;
                });
                return changed ? nextNodes : nodes;
              };
              const nextRoot = walk(root, parentPath);
              return nextRoot === root
                ? content
                : { ...content, root: nextRoot };
            })(contentAfterInsert);
          })();
        }

        // 保存
        if (Number(source.packageId) === Number(dest.packageId)) {
          await savePackageContent(source.packageId, finalContent);
        } else {
          await savePackageContent(source.packageId, contentAfterRemove);
          await savePackageContent(dest.packageId, finalContent);
        }

        // UI：选中并滚动到目标
        ensureExpandedPackage(dest.packageId);
        const nextKey =
          normalizedNode.type === "folder"
            ? `folder:${dest.packageId}:${[...dest.folderPath.map(makeFolderToken), makeFolderToken(normalizedNode.name)].join("/")}`
            : `material:${dest.packageId}:${[...dest.folderPath.map(makeFolderToken), makeMaterialToken(normalizedNode.name)].join("/")}`;
        setSelectedNode({
          kind: normalizedNode.type === "folder" ? "folder" : "material",
          key: nextKey,
          packageId: dest.packageId,
        });
        setTimeout(() => {
          document
            .querySelector(`[data-node-key="${nextKey}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }, 0);

        toast.success(
          finalName !== removedNode.name
            ? `已移动并重命名为「${finalName}」`
            : "已移动",
          { id: toastId },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "移动失败";
        toast.error(message, { id: toastId });
      }
    },
    [canEdit, loadPackageContent, savePackageContent, spaceId],
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
          .filter(
            (p) => Number(p.spacePackageId) !== Number(snapshot.spacePackageId),
          )
          .map((p) => p.name ?? "");
        const finalName = autoRenameVsCodeLike(trimmed, baseNames);
        if (finalName !== trimmed) {
          window.alert(`名称已存在，已自动重命名为「${finalName}」。`);
        }

        if (!useBackend) {
          const base = readMockPackages(spaceId);
          writeMockPackages(
            spaceId,
            base.map((p) =>
              Number(p.spacePackageId) === Number(snapshot.spacePackageId)
                ? { ...p, name: finalName, updateTime: nowIso() }
                : p,
            ),
          );
          await queryClient.invalidateQueries({
            queryKey: buildListQueryKey(spaceId, useBackend),
          });
        } else {
          await updateSpaceMaterialPackage({
            spacePackageId: snapshot.spacePackageId,
            name: finalName,
          });
          await queryClient.invalidateQueries({
            queryKey: buildListQueryKey(spaceId, useBackend),
          });
          await queryClient.invalidateQueries({
            queryKey: buildDetailQueryKey(snapshot.spacePackageId, useBackend),
          });
        }

        closeInlineRename();
        return;
      }

      const spacePackageId = snapshot.spacePackageId;
      const baseContent = await loadPackageContent(spacePackageId);

      if (snapshot.kind === "folder") {
        const from = snapshot.fromName;
        const parentPath = snapshot.folderPath.slice(0, -1);
        const siblings = getFolderNodesAtPath(baseContent, parentPath);
        const usedNames = siblings.map((n) => n.name).filter((n) => n !== from);
        const finalName = autoRenameVsCodeLike(trimmed, usedNames);
        if (finalName !== trimmed) {
          window.alert(`名称已存在，已自动重命名为「${finalName}」。`);
        }

        const nextContent = draftRenameFolder(
          baseContent,
          parentPath,
          from,
          finalName,
        );
        await savePackageContent(spacePackageId, nextContent);

        const nextPathNames = [...parentPath, finalName];
        const nextTokens = nextPathNames.map(makeFolderToken);
        const nextKey = `folder:${spacePackageId}:${nextTokens.join("/")}`;
        setSelectedNode({
          kind: "folder",
          key: nextKey,
          packageId: spacePackageId,
        });
        ensureExpandedPackage(spacePackageId);
        setTimeout(() => {
          document
            .querySelector(`[data-node-key="${nextKey}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }, 0);
        closeInlineRename();
        return;
      }

      const from = snapshot.fromName;
      const siblings = getFolderNodesAtPath(baseContent, snapshot.folderPath);
      const usedNames = siblings.map((n) => n.name).filter((n) => n !== from);
      const finalName = autoRenameVsCodeLike(trimmed, usedNames);
      if (finalName !== trimmed) {
        window.alert(`名称已存在，已自动重命名为「${finalName}」。`);
      }

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
      await savePackageContent(spacePackageId, nextContent);

      const nextTokens = [
        ...snapshot.folderPath.map(makeFolderToken),
        makeMaterialToken(finalName),
      ];
      const nextKey = `material:${spacePackageId}:${nextTokens.join("/")}`;
      setSelectedNode({
        kind: "material",
        key: nextKey,
        packageId: spacePackageId,
      });
      ensureExpandedPackage(spacePackageId);
      setTimeout(() => {
        document
          .querySelector(`[data-node-key="${nextKey}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }, 0);
      closeInlineRename();
    } catch (error) {
      setInlineRename((prev) => (prev ? { ...prev, saving: false } : prev));
      const message = error instanceof Error ? error.message : "重命名失败";
      window.alert(message);
    }
  }, [
    closeInlineRename,
    inlineRename,
    loadPackageContent,
    packages,
    queryClient,
    savePackageContent,
    spaceId,
    useBackend,
  ]);

  const closeImportFromMy = useCallback(() => {
    setIsImportFromMyOpen(false);
    setMyImportKeyword("");
    setSelectedMyPackageId(null);
    setIsMyImporting(false);
  }, []);

  const runImportFromMy = useCallback(async () => {
    if (!isValidId(selectedMyPackageId)) {
      toast.error("请先选择一个素材箱");
      return;
    }

    if (!useBackend) {
      const pkg =
        readMyMockPackages().find(
          (p) => Number(p.packageId) === selectedMyPackageId,
        ) ?? null;
      if (!pkg) {
        toast.error("素材箱不存在或已被刷新");
        return;
      }
      const base = readMockPackages(spaceId);
      const nextId =
        Math.max(0, ...base.map((p) => Number(p.spacePackageId))) + 1;
      const now = nowIso();
      const next: SpaceMaterialPackageRecord = {
        spacePackageId: nextId,
        spaceId,
        name: pkg.name ?? `素材箱#${selectedMyPackageId}`,
        description: pkg.description ?? "",
        coverUrl: pkg.coverUrl ?? "",
        status: 0,
        content: (pkg.content ??
          buildEmptyMaterialPackageContent()) as MaterialPackageContent,
        createTime: now,
        updateTime: now,
      };
      writeMockPackages(spaceId, [next, ...base]);
      await queryClient.invalidateQueries({
        queryKey: buildListQueryKey(spaceId, useBackend),
      });
      toast.success("mock：已导入到局内素材库");
      ensureExpandedPackage(next.spacePackageId);
      closeImportFromMy();
      return;
    }

    setIsMyImporting(true);
    try {
      const result = await importMaterialPackageToSpace(selectedMyPackageId, {
        spaceId,
      });
      await queryClient.invalidateQueries({
        queryKey: buildListQueryKey(spaceId, useBackend),
      });
      toast.success("已导入到局内素材库");
      const maybeId = (result as any)?.spacePackageId;
      if (
        typeof maybeId === "number" &&
        Number.isFinite(maybeId) &&
        maybeId > 0
      ) {
        ensureExpandedPackage(maybeId);
      }
      closeImportFromMy();
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      toast.error(message);
      setIsMyImporting(false);
    }
  }, [
    closeImportFromMy,
    queryClient,
    selectedMyPackageId,
    spaceId,
    useBackend,
  ]);

  const handleCreate = useCallback(async () => {
    const suggestedName = "新素材箱";
    const baseNames = packages.map((p) => String(p?.name ?? "").trim());
    const name = autoRenameVsCodeLike(suggestedName, baseNames);
    if (!useBackend) {
      const base = readMockPackages(spaceId);
      const nextId = Math.max(0, ...base.map((p) => p.spacePackageId)) + 1;
      const next: SpaceMaterialPackageRecord = {
        spacePackageId: nextId,
        spaceId,
        name,
        description: "",
        coverUrl: "",
        status: 0,
        content: buildEmptyMaterialPackageContent(),
        createTime: nowIso(),
        updateTime: nowIso(),
      };
      writeMockPackages(spaceId, [next, ...base]);
      await queryClient.invalidateQueries({
        queryKey: buildListQueryKey(spaceId, useBackend),
      });
      ensureExpandedPackage(nextId);
      setSelectedNode({
        kind: "package",
        key: `root:${nextId}`,
        packageId: nextId,
      });
      startInlineRename({
        kind: "package",
        key: `root:${nextId}`,
        spacePackageId: nextId,
        folderPath: [],
        name,
      });
      return;
    }

    const toastId = "space-material-create";
    toast.loading("正在创建局内素材箱…", { id: toastId });
    try {
      const created = await createSpaceMaterialPackage({
        spaceId,
        name,
        description: "",
        coverUrl: "",
        content: buildEmptyMaterialPackageContent(),
      });
      toast.dismiss(toastId);
      const createdId = (created as any)?.spacePackageId;
      if (
        typeof createdId === "number" &&
        Number.isFinite(createdId) &&
        createdId > 0
      ) {
        queryClient.setQueryData(
          buildListQueryKey(spaceId, useBackend),
          (prev) => {
            if (!Array.isArray(prev)) return [created];
            return [created, ...(prev as SpaceMaterialPackageRecord[])];
          },
        );
        ensureExpandedPackage(createdId);
        setSelectedNode({
          kind: "package",
          key: `root:${createdId}`,
          packageId: createdId,
        });
        startInlineRename({
          kind: "package",
          key: `root:${createdId}`,
          spacePackageId: createdId,
          folderPath: [],
          name,
        });
      }
      await queryClient.invalidateQueries({
        queryKey: buildListQueryKey(spaceId, useBackend),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建失败";
      toast.error(message, { id: toastId });
    }
  }, [
    ensureExpandedPackage,
    packages,
    queryClient,
    spaceId,
    startInlineRename,
    useBackend,
  ]);

  const getSelectedFolderPath = useCallback(() => {
    if (!selectedNode) return [] as string[];
    if (selectedNode.kind === "package") return [] as string[];

    const marker = `:${selectedNode.packageId}:`;
    const idx = selectedNode.key.indexOf(marker);
    if (idx < 0) return [] as string[];
    const rest = selectedNode.key.slice(idx + marker.length);
    const tokens = rest ? rest.split("/").filter(Boolean) : [];
    return payloadPathToFolderNames(tokens);
  }, [selectedNode]);

  const handleToolbarNewFile = useCallback(async () => {
    const fallbackId =
      packages.length === 1 ? Number(packages[0]?.spacePackageId ?? 0) : null;
    const targetPackageId = isValidId(activePackageId)
      ? activePackageId
      : isValidId(fallbackId)
        ? fallbackId
        : null;
    if (!isValidId(targetPackageId)) {
      toast.error(
        packages.length
          ? "请先展开或选中一个局内素材箱。"
          : "请先创建一个局内素材箱。",
      );
      return;
    }

    const baseContent = await loadPackageContent(targetPackageId);
    const folderPath =
      selectedNode && Number(selectedNode.packageId) === Number(targetPackageId)
        ? getSelectedFolderPath()
        : [];
    const nodes = getFolderNodesAtPath(baseContent, folderPath);
    const usedNames = nodes.map((n) => n.name);
    const finalName = autoRenameVsCodeLike("新文件.txt", usedNames);

    const material: MaterialItemNode = {
      type: "material",
      name: finalName,
      note: "",
      messages: [],
    };
    const nextContent = draftCreateMaterial(baseContent, folderPath, material);
    await savePackageContent(targetPackageId, nextContent);

    const tokens = [
      ...folderPath.map(makeFolderToken),
      makeMaterialToken(finalName),
    ];
    const nodeKey = `material:${targetPackageId}:${tokens.join("/")}`;
    setSelectedNode({
      kind: "material",
      key: nodeKey,
      packageId: targetPackageId,
    });
    ensureExpandedPackage(targetPackageId);
    setCollapsedFolderByKey((prev) => {
      if (!folderPath.length) return prev;
      let changed = false;
      const next: Record<string, boolean> = { ...prev };
      const folderTokens = folderPath.map(makeFolderToken);
      for (let i = 0; i < folderTokens.length; i += 1) {
        const k = `folder:${targetPackageId}:${folderTokens.slice(0, i + 1).join("/")}`;
        if (next[k] === true) {
          next[k] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    startInlineRename({
      kind: "material",
      key: nodeKey,
      spacePackageId: targetPackageId,
      folderPath,
      name: finalName,
    });
    setTimeout(() => {
      document
        .querySelector(`[data-node-key="${nodeKey}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, 0);
  }, [
    activePackageId,
    getSelectedFolderPath,
    loadPackageContent,
    packages,
    savePackageContent,
    selectedNode,
    setCollapsedFolderByKey,
    startInlineRename,
  ]);

  const handleToolbarNewFolder = useCallback(async () => {
    const fallbackId =
      packages.length === 1 ? Number(packages[0]?.spacePackageId ?? 0) : null;
    const targetPackageId = isValidId(activePackageId)
      ? activePackageId
      : isValidId(fallbackId)
        ? fallbackId
        : null;
    if (!isValidId(targetPackageId)) {
      toast.error(
        packages.length
          ? "请先展开或选中一个局内素材箱。"
          : "请先创建一个局内素材箱。",
      );
      return;
    }

    const baseContent = await loadPackageContent(targetPackageId);
    const folderPath =
      selectedNode && Number(selectedNode.packageId) === Number(targetPackageId)
        ? getSelectedFolderPath()
        : [];
    const nodes = getFolderNodesAtPath(baseContent, folderPath);
    const usedNames = nodes.map((n) => n.name);
    const finalName = autoRenameVsCodeLike("新建文件夹", usedNames);

    const nextContent = draftCreateFolder(baseContent, folderPath, finalName);
    await savePackageContent(targetPackageId, nextContent);

    const tokens = [
      ...folderPath.map(makeFolderToken),
      makeFolderToken(finalName),
    ];
    const nodeKey = `folder:${targetPackageId}:${tokens.join("/")}`;
    setSelectedNode({
      kind: "folder",
      key: nodeKey,
      packageId: targetPackageId,
    });
    ensureExpandedPackage(targetPackageId);
    setCollapsedFolderByKey((prev) => {
      let changed = false;
      const next: Record<string, boolean> = { ...prev };
      for (let i = 0; i < tokens.length; i += 1) {
        const k = `folder:${targetPackageId}:${tokens.slice(0, i + 1).join("/")}`;
        if (next[k] === true) {
          next[k] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    startInlineRename({
      kind: "folder",
      key: nodeKey,
      spacePackageId: targetPackageId,
      folderPath: [...folderPath, finalName],
      name: finalName,
    });
    setTimeout(() => {
      document
        .querySelector(`[data-node-key="${nodeKey}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, 0);
  }, [
    activePackageId,
    getSelectedFolderPath,
    loadPackageContent,
    packages,
    savePackageContent,
    selectedNode,
    setCollapsedFolderByKey,
    startInlineRename,
  ]);

  const handleToolbarDelete = useCallback(() => {
    if (!canEdit) {
      toast.error("当前无权限修改局内素材库。");
      return;
    }
    if (!selectedNode || !isValidId(selectedNode.packageId)) {
      window.alert("请先选中要删除的项。");
      return;
    }

    if (selectedNode.kind === "package") {
      const id = Number(selectedNode.packageId);
      const label =
        packages.find((p) => Number(p.spacePackageId) === id)?.name ??
        `素材箱#${id}`;
      setPendingDeleteTarget({
        kind: "package",
        packageId: id,
        parentPath: [],
        name: label,
      });
      setIsDeleteConfirmOpen(true);
      return;
    }

    const parsed = parseSpaceLibrarySelectedNodeRef(selectedNode);
    if (!parsed) {
      window.alert("无法解析选中项，删除失败。");
      return;
    }
    setPendingDeleteTarget({
      kind: parsed.kind,
      packageId: parsed.packageId,
      parentPath: parsed.parentPath,
      name: parsed.name,
    });
    setIsDeleteConfirmOpen(true);
  }, [canEdit, packages, selectedNode]);

  const buildMessagesFromFile = useCallback(
    async (file: File) => {
      return await buildSpaceMaterialMessagesFromFile({
        file,
        useBackend,
        uploadClient: useBackend ? uploadUtilsRef.current : undefined,
      });
    },
    [useBackend],
  );

  const applyLocalImportFiles = useCallback(
    async (args: {
      target: { packageId: number; folderPath: string[] };
      files: File[];
    }) => {
      if (!canEdit) {
        toast.error("当前无权限修改局内素材库。");
        return;
      }

      const total = Array.isArray(args.files) ? args.files.length : 0;
      const toastId = `space-material-local-import:${args.target.packageId}`;
      toast.loading("正在导入…", { id: toastId });

      try {
        const baseContent = await loadPackageContent(args.target.packageId);
        const nodes = getFolderNodesAtPath(baseContent, args.target.folderPath);
        const existingNames = new Set(nodes.map((n) => String(n.name ?? "")));
        const folderNames = new Set(
          nodes
            .filter((n) => n.type === "folder")
            .map((n) => String(n.name ?? "")),
        );

        let nextContent = baseContent;
        let lastKey: string | null = null;
        let importedCount = 0;
        let failedCount = 0;
        let processedCount = 0;

        for (const file of args.files) {
          processedCount += 1;
          const label = String(file?.name ?? "").trim() || "(未命名文件)";
          toast.loading(`正在导入… (${processedCount}/${total}) ${label}`, {
            id: toastId,
          });

          const baseName = String(file.name ?? "").trim();
          if (!baseName) {
            failedCount += 1;
            continue;
          }

          let finalName = baseName;
          if (existingNames.has(finalName) || folderNames.has(finalName)) {
            finalName = autoRenameVsCodeLike(finalName, existingNames);
          }
          existingNames.add(finalName);

          try {
            const messages = await buildMessagesFromFile(file);
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

            const tokens = [
              ...args.target.folderPath.map(makeFolderToken),
              makeMaterialToken(finalName),
            ];
            lastKey = `material:${args.target.packageId}:${tokens.join("/")}`;
            importedCount += 1;
          } catch (error) {
            failedCount += 1;
            const message = error instanceof Error ? error.message : "导入失败";
            toast.error(`导入「${label}」失败：${message}`);
          }
        }

        if (!importedCount) {
          toast.error(failedCount ? "导入失败" : "没有可导入的文件。", {
            id: toastId,
          });
          return;
        }

        await savePackageContent(args.target.packageId, nextContent);
        ensureExpandedPackage(args.target.packageId);
        setPendingLocalImportTarget(null);

        if (lastKey) {
          setSelectedNode({
            kind: "material",
            key: lastKey,
            packageId: args.target.packageId,
          });
          setTimeout(() => {
            document
              .querySelector(`[data-node-key="${lastKey}"]`)
              ?.scrollIntoView({ block: "nearest" });
          }, 0);
        }

        toast.success(
          failedCount
            ? `已导入 ${importedCount} 个素材（失败 ${failedCount} 个）`
            : `已导入 ${importedCount} 个素材`,
          { id: toastId },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "导入失败";
        toast.error(message, { id: toastId });
      }
    },
    [buildMessagesFromFile, canEdit, loadPackageContent, savePackageContent],
  );

  const handleToolbarLocalImport = useCallback(() => {
    if (!canEdit) {
      toast.error("当前无权限修改局内素材库。");
      return;
    }

    const fallbackPackageId = packages.length
      ? Number(packages[0]?.spacePackageId ?? -1)
      : null;
    const targetPackageId = isValidId(activePackageId)
      ? activePackageId
      : isValidId(fallbackPackageId)
        ? fallbackPackageId
        : null;
    if (!isValidId(targetPackageId)) {
      window.alert("请先新建或导入一个局内素材箱。");
      return;
    }

    const folderPath =
      selectedNode && Number(selectedNode.packageId) === Number(targetPackageId)
        ? getSelectedFolderPath()
        : [];
    setPendingLocalImportTarget({ packageId: targetPackageId, folderPath });

    const el = localImportInputRef.current;
    if (!el) return;
    el.value = "";
    el.click();
  }, [activePackageId, canEdit, getSelectedFolderPath, packages, selectedNode]);

  const handleLocalImportChange = useCallback(async () => {
    const el = localImportInputRef.current;
    if (!el) return;
    const files = Array.from(el.files || []);
    if (!files.length) return;

    const target =
      pendingLocalImportTarget ??
      ((): { packageId: number; folderPath: string[] } | null => {
        const targetPackageId = activePackageId;
        if (!isValidId(targetPackageId)) return null;
        return {
          packageId: targetPackageId,
          folderPath: getSelectedFolderPath(),
        };
      })();

    if (!target) {
      window.alert("请先展开或选中一个局内素材箱。");
      return;
    }

    await applyLocalImportFiles({ target, files });
  }, [
    activePackageId,
    applyLocalImportFiles,
    getSelectedFolderPath,
    pendingLocalImportTarget,
  ]);

  const handleDelete = useCallback(async () => {
    const target = pendingDeleteTarget;
    if (!target || !isValidId(target.packageId)) return;
    closeDeleteConfirm();

    const packageId = Number(target.packageId);

    if (target.kind === "package") {
      if (!useBackend) {
        const base = readMockPackages(spaceId);
        writeMockPackages(
          spaceId,
          base.filter((p) => p.spacePackageId !== packageId),
        );
        await queryClient.invalidateQueries({
          queryKey: buildListQueryKey(spaceId, useBackend),
        });
        setExpandedPackageIds((prev) =>
          prev.filter((id) => Number(id) !== packageId),
        );
        setSelectedNode((prev) =>
          prev && Number(prev.packageId) === packageId ? null : prev,
        );
        return;
      }

      const toastId = `space-material-delete:${packageId}`;
      toast.loading("正在删除…", { id: toastId });
      try {
        await deleteSpaceMaterialPackage(packageId);
        toast.dismiss(toastId);
        await queryClient.invalidateQueries({
          queryKey: buildListQueryKey(spaceId, useBackend),
        });
        setExpandedPackageIds((prev) =>
          prev.filter((id) => Number(id) !== packageId),
        );
        setSelectedNode((prev) =>
          prev && Number(prev.packageId) === packageId ? null : prev,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "删除失败";
        toast.error(message, { id: toastId });
      }
      return;
    }

    try {
      const baseContent = await loadPackageContent(packageId);
      const nextContent =
        target.kind === "folder"
          ? draftDeleteFolder(baseContent, target.parentPath, target.name)
          : draftDeleteMaterial(baseContent, target.parentPath, target.name);
      await savePackageContent(packageId, nextContent);
      clearMaterialSelection();
      setSelectedNode({ kind: "package", key: `root:${packageId}`, packageId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败";
      toast.error(message);
    }
  }, [
    clearMaterialSelection,
    closeDeleteConfirm,
    loadPackageContent,
    pendingDeleteTarget,
    queryClient,
    savePackageContent,
    spaceId,
    useBackend,
  ]);

  const renderVisibleItem = useCallback(
    (item: VisibleItem) => {
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
                  onClose={undockPreview}
                  onDock={dockPreview}
                  dragOrigin="docked"
                  dockContextId={dockContextId}
                  onPopout={(payload, options) => {
                    undockPreview();
                    openPreview(payload, options?.initialPosition ?? null, {
                      initialSize: options?.initialSize ?? null,
                    });
                  }}
                  initialPosition={null}
                />
              </div>
            </div>
          </div>
        );
      }

      if (item.kind === "package") {
        const isSelected = selectedNode?.key === item.key;
        const spacePackageId = Number(item.payload.packageId);
        const isEditingName = inlineRename?.key === item.key;
        const isMoveDropTarget = moveDropTargetKey === item.key;
        const isReorderDropTarget = spacePackageReorderDrop?.key === item.key;
        const reorderPlacement =
          spacePackageReorderDrop?.key === item.key
            ? spacePackageReorderDrop.placement
            : null;
        return (
          <div
            key={`${item.key}:${item.baseIndex}`}
            className="px-1 rounded-md"
            data-role="material-package-visible-row"
            data-base-index={item.baseIndex}
            data-node-key={item.key}
          >
            <div
              className={`flex items-center gap-2 py-1 pr-1 text-xs font-medium opacity-85 select-none rounded-md ${isSelected ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"} ${isMoveDropTarget ? "ring-1 ring-info/40 bg-info/10" : ""} ${isReorderDropTarget && reorderPlacement === "before" ? "relative before:absolute before:left-2 before:right-2 before:top-0 before:h-[2px] before:bg-info before:rounded" : ""} ${isReorderDropTarget && reorderPlacement === "after" ? "relative after:absolute after:left-2 after:right-2 after:bottom-0 after:h-[2px] after:bg-info after:rounded" : ""}`}
              draggable
              onDragStart={(e) => {
                markClickSuppressed(suppressPackageClickUntilMsRef, Date.now());
                // 默认：拖拽用于“素材箱排序”，避免误触发“拖拽打开预览”
                // 按住 Alt：允许作为预览拖拽（与“我的素材包”一致）
                if (!canEdit || e.altKey) {
                  spacePackageReorderDragRef.current = null;
                  e.dataTransfer.effectAllowed = "copy";
                  setMaterialPreviewDragData(e.dataTransfer, item.payload);
                  setMaterialPreviewDragOrigin(e.dataTransfer, "tree");
                  return;
                }

                spacePackageReorderDragRef.current = {
                  sourceId: spacePackageId,
                };
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!canEdit) return;

                const sourceId = Number(
                  spacePackageReorderDragRef.current?.sourceId ?? -1,
                );
                if (
                  Number.isFinite(sourceId) &&
                  sourceId > 0 &&
                  sourceId !== spacePackageId &&
                  !getSpaceMaterialMoveDragData(e.dataTransfer)
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  const rect = (
                    e.currentTarget as HTMLElement
                  ).getBoundingClientRect();
                  const localY = e.clientY - rect.top;
                  const placement: "before" | "after" =
                    localY <= rect.height / 2 ? "before" : "after";
                  const next = { key: item.key, placement } as const;
                  spacePackageReorderDropRef.current = next;
                  setSpacePackageReorderDrop(next);
                  setMoveDropTargetKey(null);
                  return;
                }

                const movePayload = getSpaceMaterialMoveDragData(
                  e.dataTransfer,
                );
                if (
                  !movePayload ||
                  Number(movePayload.spaceId) !== Number(spaceId)
                )
                  return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                setMoveDropTargetKey(item.key);
              }}
              onDragLeave={(e) => {
                const related = e.relatedTarget as HTMLElement | null;
                if (
                  related &&
                  (e.currentTarget as HTMLElement).contains(related)
                )
                  return;
                setSpacePackageReorderDrop((prev) =>
                  prev?.key === item.key ? null : prev,
                );
                setMoveDropTargetKey((prev) =>
                  prev === item.key ? null : prev,
                );
              }}
              onDrop={(e) => {
                if (!canEdit) return;

                const sourceId = Number(
                  spacePackageReorderDragRef.current?.sourceId ?? -1,
                );
                if (
                  Number.isFinite(sourceId) &&
                  sourceId > 0 &&
                  sourceId !== spacePackageId &&
                  !getSpaceMaterialMoveDragData(e.dataTransfer)
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = (
                    e.currentTarget as HTMLElement
                  ).getBoundingClientRect();
                  const localY = e.clientY - rect.top;
                  const placement: "before" | "after" =
                    localY <= rect.height / 2 ? "before" : "after";
                  spacePackageReorderDropRef.current = null;
                  setSpacePackageReorderDrop(null);
                  reorderSpacePackageOrder({
                    sourceId,
                    targetId: spacePackageId,
                    placement,
                  });
                  return;
                }

                const movePayload = getSpaceMaterialMoveDragData(
                  e.dataTransfer,
                );
                if (
                  !movePayload ||
                  Number(movePayload.spaceId) !== Number(spaceId)
                )
                  return;
                e.preventDefault();
                e.stopPropagation();
                setMoveDropTargetKey(null);
                void moveNode({
                  source: movePayload,
                  dest: { packageId: spacePackageId, folderPath: [] },
                });
              }}
              onDragEnd={() => {
                const sourceId = Number(
                  spacePackageReorderDragRef.current?.sourceId ?? -1,
                );
                const drop = spacePackageReorderDropRef.current;
                const targetId = drop
                  ? parseRootKeySpacePackageId(drop.key)
                  : null;
                const placement = drop?.placement ?? "before";

                spacePackageReorderDragRef.current = null;
                spacePackageReorderDropRef.current = null;
                setSpacePackageReorderDrop(null);
                setMoveDropTargetKey(null);

                if (
                  Number.isFinite(sourceId) &&
                  sourceId > 0 &&
                  targetId &&
                  sourceId !== targetId
                ) {
                  reorderSpacePackageOrder({ sourceId, targetId, placement });
                }
              }}
              onClick={() => {
                if (
                  isClickSuppressed(suppressPackageClickUntilMsRef, Date.now())
                ) {
                  return;
                }
                setSelectedNode({
                  kind: "package",
                  key: item.key,
                  packageId: spacePackageId,
                });
                toggleExpandedPackage(spacePackageId);
              }}
              onDoubleClick={(e) => {
                const target = e.target as HTMLElement | null;
                if (target?.closest?.("[data-inline-rename='1']")) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!inlineRename || inlineRename.key !== item.key) {
                    startInlineRename({
                      kind: "package",
                      key: item.key,
                      spacePackageId,
                      folderPath: [],
                      name: item.record.name,
                    });
                  }
                  return;
                }
                const insertIndex =
                  packageBottomInsertIndex.get(spacePackageId) ??
                  item.baseIndex + 1;
                dockPreview(item.payload, { index: insertIndex });
                setTimeout(() => {
                  treeItemsRef.current
                    ?.querySelector<HTMLElement>("[data-dock-preview='1']")
                    ?.scrollIntoView({ block: "nearest" });
                }, 0);
              }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleExpandedPackage(spacePackageId);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                title={item.isExpanded ? "折叠" : "展开"}
              >
                <ChevronDown
                  className={`size-4 opacity-80 ${item.isExpanded ? "" : "-rotate-90"}`}
                />
              </button>
              <div className="flex-1 min-w-0 truncate">
                <span className="inline-flex items-center gap-1">
                  <PackageIcon className="size-4 opacity-70" />
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
                        onChange={(e) => draftInlineRename(e.target.value)}
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
                    <span
                      className="inline-block max-w-full truncate"
                      data-inline-rename="1"
                      title="双击重命名"
                    >
                      {item.record.name}
                    </span>
                  )}
                </span>
              </div>
              <PortalTooltip
                label={item.nodeCount ? `${item.nodeCount}项` : "空"}
                placement="right"
              >
                <span className="text-[11px] opacity-50 px-1">
                  {item.nodeCount ? `${item.nodeCount}项` : "空"}
                </span>
              </PortalTooltip>
            </div>
          </div>
        );
      }

      if (item.kind === "folder") {
        const isSelected = selectedNode?.key === item.key;
        const spacePackageId = Number(item.payload.packageId);
        const isEditingName = inlineRename?.key === item.key;
        const isMoveDropTarget = moveDropTargetKey === item.key;
        const isReorderDropTarget = reorderDropTargetKey === item.key;
        return (
          <div
            key={`${item.key}:${item.baseIndex}`}
            className="px-1 rounded-md"
            data-role="material-package-visible-row"
            data-base-index={item.baseIndex}
            data-node-key={item.key}
          >
            <div
              className={`flex items-center gap-1 py-1 pr-1 text-xs font-medium opacity-85 select-none rounded-md ${isSelected ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"} ${isMoveDropTarget ? "ring-1 ring-info/40 bg-info/10" : ""} ${isReorderDropTarget ? "relative before:absolute before:left-2 before:right-2 before:top-0 before:h-[2px] before:bg-info before:rounded" : ""}`}
              style={{ paddingLeft: 4 + item.depth }}
              draggable
              onDragStart={(e) => {
                markClickSuppressed(suppressPackageClickUntilMsRef, Date.now());
                e.dataTransfer.effectAllowed = canEdit ? "copyMove" : "copy";
                setMaterialPreviewDragData(e.dataTransfer, item.payload);
                setMaterialPreviewDragOrigin(e.dataTransfer, "tree");
                if (canEdit) {
                  setSpaceMaterialMoveDragData(e.dataTransfer, {
                    spaceId,
                    packageId: spacePackageId,
                    kind: "folder",
                    path: item.payload.path,
                  });
                }
              }}
              onDragOver={(e) => {
                if (!canEdit) return;
                const movePayload = getSpaceMaterialMoveDragData(
                  e.dataTransfer,
                );
                if (
                  !movePayload ||
                  Number(movePayload.spaceId) !== Number(spaceId)
                )
                  return;

                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const localY = e.clientY - rect.top;
                const isBeforeZone = localY <= Math.min(10, rect.height * 0.35);
                if (
                  isBeforeZone &&
                  Number(movePayload.packageId) === Number(spacePackageId)
                ) {
                  const sourceFolderNames = payloadPathToFolderNames(
                    movePayload.path,
                  );
                  const sourceParentPath =
                    movePayload.kind === "folder"
                      ? sourceFolderNames.slice(0, -1)
                      : sourceFolderNames;
                  const destParentPath = item.folderPath.slice(0, -1);
                  const sameParent =
                    sourceParentPath.length === destParentPath.length &&
                    sourceParentPath.every(
                      (name, idx) => destParentPath[idx] === name,
                    );
                  if (sameParent) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                    setReorderDropTargetKey(item.key);
                    setMoveDropTargetKey(null);
                    return;
                  }
                }
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                setMoveDropTargetKey(item.key);
                setReorderDropTargetKey(null);
              }}
              onDragLeave={(e) => {
                const related = e.relatedTarget as HTMLElement | null;
                if (
                  related &&
                  (e.currentTarget as HTMLElement).contains(related)
                )
                  return;
                setMoveDropTargetKey((prev) =>
                  prev === item.key ? null : prev,
                );
                setReorderDropTargetKey((prev) =>
                  prev === item.key ? null : prev,
                );
              }}
              onDrop={(e) => {
                if (!canEdit) return;
                const movePayload = getSpaceMaterialMoveDragData(
                  e.dataTransfer,
                );
                if (
                  !movePayload ||
                  Number(movePayload.spaceId) !== Number(spaceId)
                )
                  return;

                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const localY = e.clientY - rect.top;
                const isBeforeZone = localY <= Math.min(10, rect.height * 0.35);
                if (
                  isBeforeZone &&
                  Number(movePayload.packageId) === Number(spacePackageId)
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  setReorderDropTargetKey(null);
                  setMoveDropTargetKey(null);
                  void reorderNode({
                    source: movePayload,
                    dest: {
                      packageId: spacePackageId,
                      folderPath: item.folderPath.slice(0, -1),
                      insertBefore: { type: "folder", name: item.name },
                    },
                  });
                  return;
                }

                e.preventDefault();
                e.stopPropagation();
                setMoveDropTargetKey(null);
                setReorderDropTargetKey(null);
                void moveNode({
                  source: movePayload,
                  dest: {
                    packageId: spacePackageId,
                    folderPath: item.folderPath,
                  },
                });
              }}
              onDragEnd={() => {
                activeSpaceMaterialMoveDrag = null;
                setMoveDropTargetKey(null);
                setReorderDropTargetKey(null);
              }}
              onClick={() => {
                setSelectedNode({
                  kind: "folder",
                  key: item.key,
                  packageId: spacePackageId,
                });
                clearMaterialSelection();
              }}
              onDoubleClick={(e) => {
                const target = e.target as HTMLElement | null;
                if (target?.closest?.("[data-inline-rename='1']")) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!inlineRename || inlineRename.key !== item.key) {
                    startInlineRename({
                      kind: "folder",
                      key: item.key,
                      spacePackageId,
                      folderPath: item.folderPath,
                      name: item.name,
                    });
                  }
                  return;
                }
                const insertIndex =
                  packageBottomInsertIndex.get(spacePackageId) ??
                  item.baseIndex + 1;
                dockPreview(item.payload, { index: insertIndex });
                setTimeout(() => {
                  treeItemsRef.current
                    ?.querySelector<HTMLElement>("[data-dock-preview='1']")
                    ?.scrollIntoView({ block: "nearest" });
                }, 0);
              }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFolderCollapsed(item.key);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                title={item.isCollapsed ? "展开" : "折叠"}
              >
                <ChevronDown
                  className={`size-4 opacity-80 ${item.isCollapsed ? "-rotate-90" : ""}`}
                />
              </button>
              <FolderIcon className="size-4 opacity-70" />
              {isEditingName ? (
                <div className="relative">
                  <span
                    ref={inlineRenameMeasureRef}
                    className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre px-1 text-xs"
                  >
                    {inlineRename?.draft ?? ""}
                  </span>
                  <input
                    ref={inlineRenameInputRef}
                    value={inlineRename?.draft ?? ""}
                    onChange={(e) => draftInlineRename(e.target.value)}
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
                <span
                  className="inline-block max-w-full truncate"
                  data-inline-rename="1"
                  title="双击重命名"
                >
                  {item.name}
                </span>
              )}
            </div>
          </div>
        );
      }

      const isSelected = selectedNode?.key === item.key;
      const isMultiSelected = selectedMaterialKeys.has(item.key);
      const isReorderDropTarget = reorderDropTargetKey === item.key;
      const spacePackageId = Number(item.payload.packageId);
      const isEditingName = inlineRename?.key === item.key;
      return (
        <div
          key={`${item.key}:${item.baseIndex}`}
          className="px-1 rounded-md"
          data-role="material-package-visible-row"
          data-base-index={item.baseIndex}
          data-node-key={item.key}
        >
          <div
            className={`flex items-center gap-2 py-1 pr-2 text-xs opacity-85 select-none rounded-md ${isSelected || isMultiSelected ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"} ${isReorderDropTarget ? "relative before:absolute before:left-2 before:right-2 before:top-0 before:h-[2px] before:bg-info before:rounded" : ""}`}
            style={{ paddingLeft: 22 + item.depth }}
            draggable
            onDragStart={(e) => {
              markClickSuppressed(suppressPackageClickUntilMsRef, Date.now());
              const isMultiDrag =
                selectedMaterialPayloadsInOrder.length > 1 &&
                selectedMaterialKeys.has(item.key);
              e.dataTransfer.effectAllowed = isMultiDrag
                ? "copy"
                : canEdit
                  ? "copyMove"
                  : "copy";
              setMaterialPreviewDragData(e.dataTransfer, item.payload);
              setMaterialPreviewDragOrigin(e.dataTransfer, "tree");
              if (isMultiDrag) {
                setMaterialBatchDragData(e.dataTransfer, {
                  items: selectedMaterialPayloadsInOrder,
                });
                return;
              }
              if (canEdit) {
                setSpaceMaterialMoveDragData(e.dataTransfer, {
                  spaceId,
                  packageId: spacePackageId,
                  kind: "material",
                  path: item.payload.path,
                });
              }
            }}
            onDragOver={(e) => {
              if (!canEdit) return;
              const movePayload = getSpaceMaterialMoveDragData(e.dataTransfer);
              if (
                !movePayload ||
                Number(movePayload.spaceId) !== Number(spaceId)
              )
                return;

              const rect = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              const localY = e.clientY - rect.top;
              const isBeforeZone = localY <= Math.min(10, rect.height * 0.35);
              if (!isBeforeZone) return;
              if (Number(movePayload.packageId) !== Number(spacePackageId))
                return;

              const sourceFolderNames = payloadPathToFolderNames(
                movePayload.path,
              );
              const sourceParentPath =
                movePayload.kind === "folder"
                  ? sourceFolderNames.slice(0, -1)
                  : sourceFolderNames;
              const destParentPath = item.folderPath;
              const sameParent =
                sourceParentPath.length === destParentPath.length &&
                sourceParentPath.every(
                  (name, idx) => destParentPath[idx] === name,
                );
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
              if (!canEdit) return;
              const movePayload = getSpaceMaterialMoveDragData(e.dataTransfer);
              if (
                !movePayload ||
                Number(movePayload.spaceId) !== Number(spaceId)
              )
                return;

              const rect = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              const localY = e.clientY - rect.top;
              const isBeforeZone = localY <= Math.min(10, rect.height * 0.35);
              if (!isBeforeZone) return;
              if (Number(movePayload.packageId) !== Number(spacePackageId))
                return;

              e.preventDefault();
              e.stopPropagation();
              setReorderDropTargetKey(null);
              setMoveDropTargetKey(null);
              void reorderNode({
                source: movePayload,
                dest: {
                  packageId: spacePackageId,
                  folderPath: item.folderPath,
                  insertBefore: { type: "material", name: item.name },
                },
              });
            }}
            onDragEnd={() => {
              activeSpaceMaterialMoveDrag = null;
              setMoveDropTargetKey(null);
              setReorderDropTargetKey(null);
            }}
            onClick={(e) => {
              setSelectedNode({
                kind: "material",
                key: item.key,
                packageId: spacePackageId,
              });
              if (e.metaKey || e.ctrlKey) {
                setSelectedMaterialKeys((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.key)) {
                    next.delete(item.key);
                  } else {
                    next.add(item.key);
                  }
                  return next.size === prev.size ? prev : next;
                });
                return;
              }
              setSelectedMaterialKeys((prev) => {
                const onlyThis = prev.size === 1 && prev.has(item.key);
                return onlyThis ? prev : new Set([item.key]);
              });
            }}
            onDoubleClick={(e) => {
              const target = e.target as HTMLElement | null;
              if (target?.closest?.("[data-inline-rename='1']")) {
                e.preventDefault();
                e.stopPropagation();
                if (!inlineRename || inlineRename.key !== item.key) {
                  startInlineRename({
                    kind: "material",
                    key: item.key,
                    spacePackageId,
                    folderPath: item.folderPath,
                    name: item.name,
                  });
                }
                return;
              }
              const insertIndex =
                packageBottomInsertIndex.get(spacePackageId) ??
                item.baseIndex + 1;
              dockPreview(item.payload, { index: insertIndex });
              setTimeout(() => {
                treeItemsRef.current
                  ?.querySelector<HTMLElement>("[data-dock-preview='1']")
                  ?.scrollIntoView({ block: "nearest" });
              }, 0);
            }}
          >
            <FileImageIcon className="size-4 opacity-70" />
            {isEditingName ? (
              <div className="relative">
                <span
                  ref={inlineRenameMeasureRef}
                  className="absolute left-0 top-0 invisible pointer-events-none whitespace-pre px-1 text-xs"
                >
                  {inlineRename?.draft ?? ""}
                </span>
                <input
                  ref={inlineRenameInputRef}
                  value={inlineRename?.draft ?? ""}
                  onChange={(e) => draftInlineRename(e.target.value)}
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
              <span
                className="inline-block max-w-full truncate"
                data-inline-rename="1"
                title="双击重命名"
              >
                {item.name}
              </span>
            )}
          </div>
        </div>
      );
    },
    [
      canEdit,
      clearMaterialSelection,
      closeInlineRename,
      commitInlineRename,
      dockContextId,
      dockPreview,
      draftInlineRename,
      ensureExpandedPackage,
      inlineRename?.draft,
      inlineRename?.key,
      inlineRename?.saving,
      inlineRenameInputRef,
      inlineRenameMeasureRef,
      inlineRenameWidthPx,
      moveDropTargetKey,
      moveNode,
      openPreview,
      packageBottomInsertIndex,
      reorderDropTargetKey,
      reorderNode,
      reorderSpacePackageOrder,
      selectedMaterialKeys,
      selectedMaterialPayloadsInOrder,
      selectedNode?.key,
      setMoveDropTargetKey,
      setReorderDropTargetKey,
      setSpacePackageReorderDrop,
      spaceId,
      spacePackageReorderDrop?.key,
      spacePackageReorderDrop?.placement,
      startInlineRename,
      toggleExpandedPackage,
      toggleFolderCollapsed,
      treeItemsRef,
      undockPreview,
    ],
  );

  return (
    <div
      className="px-1 py-1 relative"
      data-role="material-package-dock-zone"
      data-dock-context-id={dockContextId}
      onDragOverCapture={(e) => {
        if (isSpaceMaterialMoveDrag(e.dataTransfer)) {
          clearDockHint();
          return;
        }
        if (!isMaterialPreviewDrag(e.dataTransfer)) return;
        e.preventDefault();
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
        if (isSpaceMaterialMoveDrag(e.dataTransfer)) return;
        if (!isMaterialPreviewDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        const payload = getMaterialPreviewDragData(e.dataTransfer);
        if (!payload) return;
        const origin = getMaterialPreviewDragOrigin(e.dataTransfer);
        const index = dockHint?.index ?? baseItemCount;
        clearDockHint();
        if (origin === "docked") {
          setDockedIndex(index);
          return;
        }
        if (
          payload.scope !== "space" ||
          Number(payload.spaceId) !== Number(spaceId)
        ) {
          toast.error("只能将本局内素材库的预览插入到该局内素材库中。");
          return;
        }
        dockPreview(payload, { index });
      }}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs font-medium opacity-80 select-none rounded-lg hover:bg-base-300/40 group">
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={toggleCollapsed}
          title={isCollapsed ? "展开" : "折叠"}
          aria-label={isCollapsed ? "展开局内素材库" : "折叠局内素材库"}
        >
          <ChevronDown
            className={`size-4 opacity-80 ${isCollapsed ? "-rotate-90" : ""}`}
          />
        </button>

        <span className="flex-1 truncate">局内素材库</span>

        {canEdit && (
          <div className="flex items-center gap-1">
            <input
              ref={localImportInputRef}
              type="file"
              multiple
              onChange={handleLocalImportChange}
              style={{
                position: "fixed",
                left: -9999,
                top: -9999,
                width: 1,
                height: 1,
                opacity: 0,
              }}
              aria-hidden="true"
              tabIndex={-1}
            />
            <div
              className="flex items-center gap-1 group/ops"
              onClick={(e) => {
                // 避免点按钮区域时触发 Header 的拖拽/选择逻辑
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <div
                className={`${toolbarPinned ? "flex" : "hidden group-hover/ops:flex"} items-center gap-1 opacity-90`}
              >
                <PortalTooltip label="新建文件" placement="bottom">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    disabled={packages.length === 0}
                    onClick={() => {
                      void handleToolbarNewFile();
                    }}
                    aria-label="新建文件"
                  >
                    <FilePlus className="size-4" />
                  </button>
                </PortalTooltip>
                <PortalTooltip label="新建文件夹" placement="bottom">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    disabled={packages.length === 0}
                    onClick={() => {
                      void handleToolbarNewFolder();
                    }}
                    aria-label="新建文件夹"
                  >
                    <FolderPlus className="size-4" />
                  </button>
                </PortalTooltip>
                <PortalTooltip label="新建素材箱" placement="bottom">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    onClick={() => {
                      void handleCreate();
                    }}
                    aria-label="新建素材箱"
                  >
                    <Plus className="size-4" />
                  </button>
                </PortalTooltip>
                <PortalTooltip
                  label={baseItemCount > 0 ? "本地导入素材" : "暂无局内素材箱"}
                  placement="bottom"
                >
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    disabled={baseItemCount === 0}
                    onClick={handleToolbarLocalImport}
                    aria-label="本地导入素材"
                  >
                    <UploadSimple className="size-4" />
                  </button>
                </PortalTooltip>
                <PortalTooltip
                  label="从我的素材包导入素材箱"
                  placement="bottom"
                >
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    onClick={() => {
                      setIsImportFromMyOpen(true);
                    }}
                    aria-label="从我的素材包导入"
                  >
                    <PackageIcon className="size-4" />
                  </button>
                </PortalTooltip>
                <PortalTooltip label="导入素材包" placement="bottom">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    onClick={() => {
                      setIsImportOpen(true);
                    }}
                    aria-label="导入素材包"
                  >
                    <DownloadSimple className="size-4" />
                  </button>
                </PortalTooltip>
                <PortalTooltip label="刷新" placement="bottom">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    onClick={() => {
                      void listQuery.refetch();
                    }}
                    aria-label="刷新"
                  >
                    <ArrowClockwise className="size-4" />
                  </button>
                </PortalTooltip>
                <PortalTooltip
                  label={
                    canEdit
                      ? getSpaceLibraryDeleteTooltipLabel(selectedNode)
                      : "当前无权限修改局内素材库"
                  }
                  placement="bottom"
                >
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    disabled={
                      !canEdit ||
                      !canDeleteSpaceLibrarySelectedNode(selectedNode)
                    }
                    onClick={handleToolbarDelete}
                    aria-label="删除"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </PortalTooltip>
              </div>

              <PortalTooltip
                label={
                  toolbarPinned ? "隐藏工具栏（仍可悬浮显示）" : "显示工具栏"
                }
                placement="bottom"
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={toggleToolbarPinned}
                  aria-label="显示/隐藏工具栏"
                  aria-pressed={toolbarPinned}
                  title={
                    toolbarPinned ? "隐藏工具栏（仍可悬浮显示）" : "显示工具栏"
                  }
                >
                  <span
                    className={`inline-flex transition-transform duration-150 ${toolbarPinned ? "rotate-[135deg]" : "group-hover/ops:rotate-[135deg]"}`}
                  >
                    <AddIcon />
                  </span>
                </button>
              </PortalTooltip>
            </div>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div
          ref={scrollRef}
          className="px-1 py-1 relative mx-2 mt-1 mb-1"
          onScroll={() => {
            if (dockHint) {
              applyDockHint(dockHint);
            }
          }}
        >
          <div ref={treeItemsRef} data-role="material-package-tree-items">
            {listQuery.isLoading && (
              <div className="px-2 py-2 text-xs text-base-content/60">
                加载中…
              </div>
            )}

            {!listQuery.isLoading && baseItemCount === 0 && (
              <div className="px-2 py-2 text-xs text-base-content/60">
                暂无局内素材箱，点击右上角导入或新建。
              </div>
            )}

            {!listQuery.isLoading && visibleItems.map(renderVisibleItem)}
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
      )}

      {activePreview &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9997] pointer-events-none">
            <div className="relative w-full h-full pointer-events-none">
              <div className="relative w-full h-full pointer-events-auto">
                <MaterialPreviewFloat
                  payload={activePreview}
                  onClose={() => {
                    setActivePreview(null);
                    setActivePreviewInitialSize(null);
                  }}
                  onDock={dockPreview}
                  initialPosition={previewHintPos}
                  initialSize={activePreviewInitialSize}
                  dockContextId={dockContextId}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}

      {isImportOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 px-4"
            onMouseDown={() => setIsImportOpen(false)}
          >
            <div
              className="w-full max-w-6xl h-[80vh] rounded-xl border border-base-300 bg-base-100 shadow-xl overflow-hidden"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <MaterialPackageSquareView
                activeSpaceId={spaceId}
                spaces={[{ spaceId, name: spaceName ?? `Space #${spaceId}` }]}
                forcedImportSpaceId={spaceId}
                onImportedToSpace={({ packageId }) => {
                  if (!useBackend) {
                    const pkg = findMockPackageById(Number(packageId));
                    if (pkg) {
                      const base = readMockPackages(spaceId);
                      const nextId =
                        Math.max(
                          0,
                          ...base.map((p) => Number(p.spacePackageId)),
                        ) + 1;
                      const now = nowIso();
                      const next: SpaceMaterialPackageRecord = {
                        spacePackageId: nextId,
                        spaceId,
                        sourcePackageId: Number(pkg.packageId) || null,
                        sourceUserId: Number((pkg as any)?.userId) || null,
                        importedBy: null,
                        name: pkg.name ?? `素材包#${pkg.packageId}`,
                        description: pkg.description ?? "",
                        coverUrl: pkg.coverUrl ?? "",
                        status: 0,
                        content: (pkg.content ??
                          buildEmptyMaterialPackageContent()) as MaterialPackageContent,
                        createTime: now,
                        updateTime: now,
                      };
                      writeMockPackages(spaceId, [next, ...base]);
                      ensureExpandedPackage(next.spacePackageId);
                    }
                  }
                  setIsImportOpen(false);
                  void queryClient.invalidateQueries({
                    queryKey: buildListQueryKey(spaceId, useBackend),
                  });
                }}
              />
            </div>
          </div>,
          document.body,
        )}

      {isImportFromMyOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 px-4"
            onMouseDown={closeImportFromMy}
          >
            <div
              className="w-full max-w-5xl h-[70vh] rounded-xl border border-base-300 bg-base-100 shadow-xl overflow-hidden flex flex-col"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                <div className="text-sm font-semibold">
                  从我的素材包导入素材箱
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square"
                  aria-label="关闭"
                  onClick={closeImportFromMy}
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
                <div className="border-b md:border-b-0 md:border-r border-base-300 min-h-0 flex flex-col">
                  <div className="p-3">
                    <input
                      className="input input-bordered input-sm w-full"
                      placeholder="搜索素材箱…"
                      value={myImportKeyword}
                      onChange={(e) => setMyImportKeyword(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto px-2 pb-3">
                    {myPackagesQuery.isLoading && (
                      <div className="px-2 py-2 text-xs opacity-60">
                        加载中…
                      </div>
                    )}
                    {!myPackagesQuery.isLoading &&
                      filteredMyPackages.length === 0 && (
                        <div className="px-2 py-2 text-xs opacity-60">
                          暂无可导入的素材箱
                        </div>
                      )}
                    {filteredMyPackages.map((pkg) => {
                      const id = Number((pkg as any)?.packageId);
                      const isSelected = selectedMyPackageId === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`w-full text-left px-2 py-2 rounded-md text-sm ${isSelected ? "bg-base-300/60 ring-1 ring-info/20" : "hover:bg-base-300/40"}`}
                          onClick={() => setSelectedMyPackageId(id)}
                        >
                          <div className="flex items-center gap-2">
                            <PackageIcon className="size-4 opacity-70" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">
                                {pkg?.name ?? `素材箱#${id}`}
                              </div>
                              <div className="text-xs opacity-60 truncate">
                                {pkg?.description ?? ""}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-h-0 flex flex-col">
                  <div className="flex-1 min-h-0 overflow-auto p-4">
                    {selectedMyPackage ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <PackageIcon className="size-5 opacity-70" />
                          <div className="text-base font-semibold">
                            {selectedMyPackage.name ?? "未命名素材箱"}
                          </div>
                        </div>
                        <div className="text-sm opacity-70 whitespace-pre-wrap break-words">
                          {selectedMyPackage.description ?? "暂无描述"}
                        </div>
                        <div className="text-xs opacity-60">
                          导入后会生成局内素材箱副本，可独立编辑，不会发布到素材包广场。
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm opacity-60">
                        左侧选择一个素材箱以查看详情并导入。
                      </div>
                    )}
                  </div>
                  <div className="border-t border-base-300 px-4 py-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={closeImportFromMy}
                      disabled={isMyImporting}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        void runImportFromMy();
                      }}
                      disabled={!selectedMyPackage || isMyImporting}
                    >
                      {isMyImporting ? "导入中…" : "导入到局内素材库"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {isDeleteConfirmOpen &&
      pendingDeleteTarget &&
      typeof document !== "undefined"
        ? createPortal(
            <dialog
              open
              className="modal modal-open z-[10050]"
              onCancel={(event) => {
                event.preventDefault();
                closeDeleteConfirm();
              }}
            >
              <div className="modal-box max-w-[460px] border border-base-300 bg-base-100 p-0 text-base-content shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                  <div className="text-sm font-semibold">确认删除</div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    aria-label="关闭"
                    onClick={closeDeleteConfirm}
                  >
                    ✕
                  </button>
                </div>

                {(() => {
                  const copy =
                    getSpaceLibraryDeleteDialogCopy(pendingDeleteTarget);
                  return (
                    <div className="px-4 py-4 space-y-2">
                      <div className="text-sm">{copy.primary}</div>
                      <div className="text-xs opacity-70">{copy.secondary}</div>
                    </div>
                  );
                })()}

                <div className="flex justify-end gap-2 border-t border-base-300 px-4 py-3">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={closeDeleteConfirm}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-error btn-sm"
                    onClick={() => {
                      void handleDelete();
                    }}
                  >
                    删除
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

export default SpaceMaterialLibraryCategory;
