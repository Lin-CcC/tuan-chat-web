import type {
  MaterialFolderNode,
  MaterialItemNode,
  MaterialNode,
  MaterialPackageContent,
} from "@/components/materialPackage/materialPackageApi";

function updateNodesAtPath(
  nodes: MaterialNode[],
  folderPath: string[],
  updater: (nodes: MaterialNode[]) => MaterialNode[],
): MaterialNode[] {
  if (folderPath.length === 0) {
    return updater(nodes);
  }

  const [head, ...rest] = folderPath;
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.type !== "folder" || node.name !== head)
      return node;
    const nextChildren = updateNodesAtPath(node.children, rest, updater);
    if (nextChildren === node.children)
      return node;
    changed = true;
    const next: MaterialFolderNode = {
      ...node,
      children: nextChildren,
    };
    return next;
  });

  return changed ? nextNodes : nodes;
}

function updateContentAtPath(
  content: MaterialPackageContent,
  folderPath: string[],
  updater: (nodes: MaterialNode[]) => MaterialNode[],
): MaterialPackageContent {
  const root = Array.isArray(content.root) ? content.root : [];
  const nextRoot = updateNodesAtPath(root, folderPath, updater);
  if (nextRoot === root)
    return content;
  return { ...content, root: nextRoot };
}

function removeNodeByName(nodes: MaterialNode[], type: MaterialNode["type"], name: string): MaterialNode[] {
  const next = nodes.filter(n => !(n.type === type && n.name === name));
  return next.length === nodes.length ? nodes : next;
}

function renameNodeByName(nodes: MaterialNode[], type: MaterialNode["type"], name: string, nextName: string): MaterialNode[] {
  let changed = false;
  const next = nodes.map((n) => {
    if (n.type !== type || n.name !== name)
      return n;
    changed = true;
    return { ...n, name: nextName } as MaterialNode;
  });
  return changed ? next : nodes;
}

function renameMaterialByName(nodes: MaterialNode[], name: string, nextName: string, nextNote?: string): MaterialNode[] {
  let changed = false;
  const next = nodes.map((n) => {
    if (n.type !== "material" || n.name !== name)
      return n;
    changed = true;
    const base: MaterialItemNode = { ...n, name: nextName };
    if (typeof nextNote === "string")
      base.note = nextNote;
    return base;
  });
  return changed ? next : nodes;
}

function updateMaterialAnnotationsByName(
  nodes: MaterialNode[],
  name: string,
  nextAnnotations: string[],
  applyToAllMessages: boolean,
): MaterialNode[] {
  const trimmedName = name.trim();
  if (!trimmedName)
    return nodes;

  const normalized = nextAnnotations
    .map(a => (typeof a === "string" ? a.trim() : ""))
    .filter(Boolean);

  let changed = false;
  const next = nodes.map((n) => {
    if (n.type !== "material" || n.name !== trimmedName)
      return n;

    const messages = Array.isArray(n.messages) ? n.messages : [];
    if (!messages.length)
      return n;

    let nodeChanged = false;
    const nextMessages = messages.map((msg, idx) => {
      if (!applyToAllMessages && idx > 0)
        return msg;
      const prev = Array.isArray(msg.annotations) ? msg.annotations : [];
      const same = prev.length === normalized.length && prev.every((v, i) => v === normalized[i]);
      if (same)
        return msg;
      nodeChanged = true;
      return { ...msg, annotations: normalized };
    });

    if (!nodeChanged)
      return n;
    changed = true;
    return { ...n, messages: nextMessages } as MaterialNode;
  });

  return changed ? next : nodes;
}

export function draftCreateFolder(content: MaterialPackageContent, folderPath: string[], folderName: string): MaterialPackageContent {
  const trimmed = folderName.trim();
  if (!trimmed)
    return content;
  return updateContentAtPath(content, folderPath, (nodes) => {
    const nextNode: MaterialFolderNode = { type: "folder", name: trimmed, children: [] };
    return [...nodes, nextNode];
  });
}

export function draftCreateMaterial(content: MaterialPackageContent, folderPath: string[], material: MaterialItemNode): MaterialPackageContent {
  if (!material?.name?.trim())
    return content;
  return updateContentAtPath(content, folderPath, (nodes) => {
    return [...nodes, material];
  });
}

export function draftDeleteFolder(content: MaterialPackageContent, parentPath: string[], folderName: string): MaterialPackageContent {
  const trimmed = folderName.trim();
  if (!trimmed)
    return content;
  return updateContentAtPath(content, parentPath, nodes => removeNodeByName(nodes, "folder", trimmed));
}

export function draftDeleteMaterial(content: MaterialPackageContent, folderPath: string[], materialName: string): MaterialPackageContent {
  const trimmed = materialName.trim();
  if (!trimmed)
    return content;
  return updateContentAtPath(content, folderPath, nodes => removeNodeByName(nodes, "material", trimmed));
}

export function draftRenameFolder(
  content: MaterialPackageContent,
  parentPath: string[],
  folderName: string,
  nextFolderName: string,
): MaterialPackageContent {
  const from = folderName.trim();
  const to = nextFolderName.trim();
  if (!from || !to || from === to)
    return content;
  return updateContentAtPath(content, parentPath, nodes => renameNodeByName(nodes, "folder", from, to));
}

export function draftRenameMaterial(
  content: MaterialPackageContent,
  folderPath: string[],
  materialName: string,
  nextMaterialName: string,
  nextNote?: string,
): MaterialPackageContent {
  const from = materialName.trim();
  const to = nextMaterialName.trim();
  if (!from || !to)
    return content;
  return updateContentAtPath(content, folderPath, nodes => renameMaterialByName(nodes, from, to, nextNote));
}

export function draftUpdateMaterialAnnotations(
  content: MaterialPackageContent,
  folderPath: string[],
  materialName: string,
  nextAnnotations: string[],
  options?: { applyToAllMessages?: boolean },
): MaterialPackageContent {
  const name = materialName.trim();
  if (!name)
    return content;
  const applyToAll = options?.applyToAllMessages !== false;
  return updateContentAtPath(content, folderPath, nodes => updateMaterialAnnotationsByName(nodes, name, nextAnnotations, applyToAll));
}

type DraftNodeRef = { type: "folder" | "material"; name: string };

function reorderNodeByName(nodes: MaterialNode[], source: DraftNodeRef, insertBefore?: DraftNodeRef | null): MaterialNode[] {
  const fromName = source.name.trim();
  if (!fromName)
    return nodes;

  const fromIndex = nodes.findIndex(n => n.type === source.type && n.name === fromName);
  if (fromIndex < 0)
    return nodes;

  let toIndex = nodes.length;
  if (insertBefore) {
    const beforeName = insertBefore.name.trim();
    if (!beforeName)
      return nodes;
    const beforeIndex = nodes.findIndex(n => n.type === insertBefore.type && n.name === beforeName);
    if (beforeIndex < 0)
      return nodes;
    toIndex = beforeIndex;
  }

  if (toIndex === fromIndex)
    return nodes;

  const next = nodes.slice();
  const [moved] = next.splice(fromIndex, 1);
  const normalizedToIndex = fromIndex < toIndex ? Math.max(0, toIndex - 1) : Math.max(0, toIndex);
  next.splice(Math.min(normalizedToIndex, next.length), 0, moved as MaterialNode);
  return next;
}

function removeNodeByRef(nodes: MaterialNode[], source: DraftNodeRef): { nodes: MaterialNode[]; removed: MaterialNode | null } {
  const name = source.name.trim();
  if (!name)
    return { nodes, removed: null };
  const index = nodes.findIndex(n => n.type === source.type && n.name === name);
  if (index < 0)
    return { nodes, removed: null };
  const removed = nodes[index] as MaterialNode;
  const next = nodes.slice();
  next.splice(index, 1);
  return { nodes: next, removed };
}

function getNodesAtPathFromRoot(root: MaterialNode[], folderPath: string[]): MaterialNode[] | null {
  let current: MaterialNode[] = root;
  for (const folderName of folderPath) {
    const nextFolder = current.find(n => n.type === "folder" && n.name === folderName) as MaterialFolderNode | undefined;
    if (!nextFolder)
      return null;
    current = Array.isArray(nextFolder.children) ? nextFolder.children : [];
  }
  return current;
}

export function draftReplaceMaterialMessages(
  content: MaterialPackageContent,
  folderPath: string[],
  materialName: string,
  nextMessages: any[],
): MaterialPackageContent {
  const name = materialName.trim();
  if (!name)
    return content;
  const normalized = Array.isArray(nextMessages) ? nextMessages : [];

  let changed = false;
  const next = updateContentAtPath(content, folderPath, (nodes) => {
    let localChanged = false;
    const nextNodes = nodes.map((n) => {
      if (n.type !== "material" || n.name !== name)
        return n;
      localChanged = true;
      return { ...n, messages: normalized } as MaterialNode;
    });
    if (localChanged) {
      changed = true;
    }
    return localChanged ? nextNodes : nodes;
  });

  return changed ? next : content;
}

export function draftReorderNode(
  content: MaterialPackageContent,
  folderPath: string[],
  source: DraftNodeRef,
  options: { insertBefore?: DraftNodeRef | null },
): MaterialPackageContent {
  const insertBefore = options?.insertBefore ?? undefined;
  return updateContentAtPath(content, folderPath, nodes => reorderNodeByName(nodes, source, insertBefore));
}

export function draftMoveNode(
  content: MaterialPackageContent,
  from: { parentPath: string[]; source: DraftNodeRef; nextName?: string },
  dest: { folderPath: string[] },
): MaterialPackageContent {
  const parentPath = Array.isArray(from?.parentPath) ? from.parentPath : [];
  const folderPath = Array.isArray(dest?.folderPath) ? dest.folderPath : [];
  const sameParent = parentPath.length === folderPath.length && parentPath.every((name, idx) => folderPath[idx] === name);
  if (sameParent && !from?.nextName)
    return content;

  const root = Array.isArray(content.root) ? content.root : [];
  const siblings = getNodesAtPathFromRoot(root, parentPath);
  if (!siblings)
    return content;

  const fromName = from.source.name.trim();
  if (!fromName)
    return content;
  const removed = siblings.find(n => n.type === from.source.type && n.name === fromName) as MaterialNode | undefined;
  if (!removed)
    return content;

  const afterRemove = updateContentAtPath(content, parentPath, nodes => removeNodeByRef(nodes, from.source).nodes);

  const nextName = typeof from.nextName === "string" ? from.nextName.trim() : "";
  const normalizedNode: MaterialNode = nextName && nextName !== removed.name
    ? ({ ...removed, name: nextName } as MaterialNode)
    : removed;

  return updateContentAtPath(afterRemove, folderPath, nodes => [...nodes, normalizedNode]);
}

export function draftMoveNodeAcrossContents(
  args: { sourceContent: MaterialPackageContent; destContent: MaterialPackageContent },
  from: { parentPath: string[]; source: DraftNodeRef; nextName?: string },
  dest: { folderPath: string[] },
): { nextSourceContent: MaterialPackageContent; nextDestContent: MaterialPackageContent; removed: MaterialNode | null } {
  const sourceContent = args?.sourceContent;
  const destContent = args?.destContent;
  if (!sourceContent || !destContent) {
    return {
      nextSourceContent: sourceContent,
      nextDestContent: destContent,
      removed: null,
    } as any;
  }

  const parentPath = Array.isArray(from?.parentPath) ? from.parentPath : [];
  const folderPath = Array.isArray(dest?.folderPath) ? dest.folderPath : [];

  const root = Array.isArray(sourceContent.root) ? sourceContent.root : [];
  const siblings = getNodesAtPathFromRoot(root, parentPath);
  if (!siblings) {
    return { nextSourceContent: sourceContent, nextDestContent: destContent, removed: null };
  }

  const fromName = from.source.name.trim();
  if (!fromName) {
    return { nextSourceContent: sourceContent, nextDestContent: destContent, removed: null };
  }
  const removed = siblings.find(n => n.type === from.source.type && n.name === fromName) as MaterialNode | undefined;
  if (!removed) {
    return { nextSourceContent: sourceContent, nextDestContent: destContent, removed: null };
  }

  const removedResult = removeNodeByRef(siblings, from.source);
  if (!removedResult.removed) {
    return { nextSourceContent: sourceContent, nextDestContent: destContent, removed: null };
  }
  const nextSourceContent = updateContentAtPath(sourceContent, parentPath, () => removedResult.nodes);

  const nextName = typeof from.nextName === "string" ? from.nextName.trim() : "";
  const normalizedNode: MaterialNode = nextName && nextName !== removedResult.removed.name
    ? ({ ...removedResult.removed, name: nextName } as MaterialNode)
    : removedResult.removed;

  const nextDestContent = updateContentAtPath(destContent, folderPath, nodes => [...nodes, normalizedNode]);

  return { nextSourceContent, nextDestContent, removed: normalizedNode };
}

export function buildEmptyMaterialPackageContent(): MaterialPackageContent {
  return {
    version: 1,
    root: [],
  };
}
