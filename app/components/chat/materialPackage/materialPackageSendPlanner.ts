import type { ChatMessageRequest } from "../../../../api/models/ChatMessageRequest";

import type { MaterialMessageItem } from "@/components/materialPackage/materialPackageApi";

import type { MaterialPreviewPayload } from "@/components/chat/materialPackage/materialPackageDnd";
import { materialMessagesToChatRequests, resolveMaterialMessagesFromPayload } from "@/components/chat/materialPackage/materialPackageSendUtils";
import { getMaterialPackage, getSpaceMaterialPackage } from "@/components/materialPackage/materialPackageApi";

function buildPackageKey(payload: MaterialPreviewPayload) {
  const scope = payload.scope === "space" ? "space" : "global";
  const spaceId = payload.scope === "space" ? Number(payload.spaceId ?? -1) : -1;
  return `${scope}:${spaceId}:${Number(payload.packageId)}`;
}

export async function resolveMaterialMessagesFromPayloads(payloads: MaterialPreviewPayload[]) {
  const list = Array.isArray(payloads) ? payloads.filter(Boolean) : [];
  const pkgCache = new Map<string, Promise<any>>();
  const messages: MaterialMessageItem[] = [];

  for (const payload of list) {
    const key = buildPackageKey(payload);
    let pkgPromise = pkgCache.get(key);
    if (!pkgPromise) {
      pkgPromise = payload.scope === "space"
        ? getSpaceMaterialPackage(payload.packageId)
        : getMaterialPackage(payload.packageId);
      pkgCache.set(key, pkgPromise);
    }
    const pkg = await pkgPromise;
    const resolved = resolveMaterialMessagesFromPayload(pkg?.content, payload);
    for (const m of resolved) {
      if (m)
        messages.push(m);
    }
  }

  return messages;
}

export async function buildChatRequestsFromMaterialPayloads(roomId: number, payloads: MaterialPreviewPayload[]): Promise<ChatMessageRequest[]> {
  const messages = await resolveMaterialMessagesFromPayloads(payloads);
  return materialMessagesToChatRequests(roomId, messages);
}

