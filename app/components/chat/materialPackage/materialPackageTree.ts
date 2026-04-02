import type { MaterialNode, MaterialPackageContent } from "@/components/materialPackage/materialPackageApi";
import type { MaterialPreviewPayload } from "@/components/chat/materialPackage/materialPackageDnd";

export type MaterialPreviewResolvedState = {
  folderPath: string[];
  selectedMaterialName: string | null;
};

function extractPathName(token: string, prefix: "folder:" | "material:") {
  if (!token.startsWith(prefix))
    return null;
  const name = token.slice(prefix.length).trim();
  return name || null;
}

export function resolveInitialPreviewState(payload: MaterialPreviewPayload): MaterialPreviewResolvedState {
  const folderPath: string[] = [];
  let selectedMaterialName: string | null = null;

  for (const raw of payload.path) {
    const folderName = extractPathName(raw, "folder:");
    if (folderName) {
      folderPath.push(folderName);
      continue;
    }

    const materialName = extractPathName(raw, "material:");
    if (materialName) {
      selectedMaterialName = materialName;
    }
  }

  if (payload.kind === "material") {
    return { folderPath, selectedMaterialName: selectedMaterialName ?? payload.label };
  }

  if (payload.kind === "folder") {
    return { folderPath, selectedMaterialName: null };
  }

  return { folderPath: [], selectedMaterialName: null };
}

function findFolderChild(nodes: MaterialNode[], folderName: string) {
  return nodes.find((n) => n.type === "folder" && n.name === folderName) as Extract<MaterialNode, { type: "folder" }> | undefined;
}

export function getFolderNodesAtPath(content: MaterialPackageContent, folderPath: string[]): MaterialNode[] {
  let nodes = Array.isArray(content.root) ? content.root : [];
  for (const folderName of folderPath) {
    const nextFolder = findFolderChild(nodes, folderName);
    if (!nextFolder)
      return [];
    nodes = Array.isArray(nextFolder.children) ? nextFolder.children : [];
  }
  return nodes;
}

