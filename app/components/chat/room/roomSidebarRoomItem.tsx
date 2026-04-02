import type { DragEvent, MouseEvent } from "react";
import type { Room } from "../../../../api";
import type { DraggingItem, DropTarget } from "./useRoomSidebarDragState";

import toast from "react-hot-toast";
import RoomButton from "@/components/chat/shared/components/roomButton";
import { getMaterialPreviewDragData, isMaterialPreviewDrag } from "@/components/chat/materialPackage/materialPackageDnd";
import { getMaterialBatchDragData, isMaterialBatchDrag } from "@/components/chat/materialPackage/materialPackageDndBatch";
import { buildChatRequestsFromMaterialPayloads } from "@/components/chat/materialPackage/materialPackageSendPlanner";
import {
  materialMessagesToChatRequests,
  resolveMaterialMessagesFromPayload,
} from "@/components/chat/materialPackage/materialPackageSendUtils";
import { useMaterialSendConfirmStore } from "@/components/chat/stores/materialSendConfirmStore";
import { setRoomRefDragData } from "@/components/chat/utils/roomRef";
import { setSubWindowDragPayload } from "@/components/chat/utils/subWindowDragPayload";
import { getMaterialPackage, getSpaceMaterialPackage } from "@/components/materialPackage/materialPackageApi";
import { tuanchat } from "../../../../api/instance";

const ROOM_DRAG_MIME = "application/x-tuanchat-room-id";

interface RoomSidebarRoomItemProps {
  room: Room;
  roomId: number;
  activeSpaceId: number | null;
  nodeId: string;
  categoryId: string;
  categoryName: string;
  index: number;
  canEdit: boolean;
  dragging: DraggingItem | null;
  resetDropHandled: () => void;
  setDragging: (next: DraggingItem | null) => void;
  setDropTarget: (next: DropTarget | null) => void;
  handleDrop: () => void;
  onContextMenu: (e: MouseEvent) => void;
  unreadMessageNumber?: number;
  activeRoomId: number | null;
  onSelectRoom: (roomId: number) => void;
  onCloseLeftDrawer: () => void;
}

export default function RoomSidebarRoomItem({
  room,
  roomId,
  activeSpaceId,
  nodeId,
  categoryId,
  categoryName,
  index,
  canEdit,
  dragging,
  resetDropHandled,
  setDragging,
  setDropTarget,
  handleDrop,
  onContextMenu,
  unreadMessageNumber,
  activeRoomId,
  onSelectRoom,
  onCloseLeftDrawer,
}: RoomSidebarRoomItemProps) {
  async function sendMaterialPayloadToRoom(payload: ReturnType<typeof getMaterialPreviewDragData>) {
    if (!payload)
      return;

    const defaultUseBackend = !(import.meta.env.MODE === "test");
    let useBackend = defaultUseBackend;
    try {
      const raw = localStorage.getItem("tc:material-package:use-backend");
      if (raw != null)
        useBackend = raw === "true";
    }
    catch {
      // ignore
    }

    if (!useBackend) {
      toast.success("mock：已模拟发送素材（不写入后端）。");
      return;
    }

    const loadingId = toast.loading("正在发送素材…");
    try {
      const pkg = payload.scope === "space"
        ? await getSpaceMaterialPackage(payload.packageId)
        : await getMaterialPackage(payload.packageId);

      const messages = resolveMaterialMessagesFromPayload(pkg?.content, payload);
      if (!messages.length) {
        toast("该素材没有可发送的消息。", { id: loadingId });
        return;
      }

      const requests = materialMessagesToChatRequests(roomId, messages);
      if (requests.length > 10) {
        useMaterialSendConfirmStore.getState().open({
          roomId,
          roomLabel: String(room?.name ?? "").trim() ? String(room.name) : null,
          count: requests.length,
          requests,
        });
        toast(`素材较多（${requests.length}条），请确认发送。`, { id: loadingId });
        return;
      }
      await tuanchat.chatController.batchSendMessages(requests);
      toast.success(`已发送 ${requests.length} 条消息`, { id: loadingId });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      toast.error(message, { id: loadingId });
    }
  }

  const handleItemDragStart = (e: DragEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.closest("input") || el.closest("select") || el.closest("textarea"))) {
      e.preventDefault();
      return;
    }
    // 允许“同列表内 move 排序 + 拖到聊天区 copy 发送跳转消息”。
    e.dataTransfer.effectAllowed = canEdit ? "copyMove" : "copy";
    e.dataTransfer.setData(ROOM_DRAG_MIME, String(roomId));
    e.dataTransfer.setData("text/plain", `room:${roomId}`);
    setRoomRefDragData(e.dataTransfer, {
      roomId,
      ...(activeSpaceId && activeSpaceId > 0 ? { spaceId: activeSpaceId } : {}),
      ...(room.name ? { roomName: room.name } : {}),
      ...(categoryName ? { categoryName } : {}),
    });
    setSubWindowDragPayload({ tab: "room", roomId });
    if (!canEdit) {
      return;
    }
    resetDropHandled();
    setDragging({
      kind: "node",
      nodeId,
      type: "room",
      fromCategoryId: categoryId,
      fromIndex: index,
    });
    setDropTarget(null);
  };

  const handleItemDragEnd = () => {
    setSubWindowDragPayload(null);
    setDragging(null);
    setDropTarget(null);
  };

  return (
    <div
      className={`flex items-center gap-1 group w-full ${canEdit ? "" : ""}`}
      data-room-id={roomId}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
      onDragOver={(e) => {
        if (isMaterialBatchDrag(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          return;
        }
        if (isMaterialPreviewDrag(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          return;
        }
        if (!canEdit)
          return;
        if (!dragging || dragging.kind !== "node")
          return;
        e.preventDefault();
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const isBefore = (e.clientY - rect.top) < rect.height / 2;
        setDropTarget({ kind: "node", toCategoryId: categoryId, insertIndex: isBefore ? index : index + 1 });
      }}
      onDrop={(e) => {
        if (isMaterialBatchDrag(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          const batch = getMaterialBatchDragData(e.dataTransfer);
          if (!batch?.items?.length)
            return;

          const defaultUseBackend = !(import.meta.env.MODE === "test");
          let useBackend = defaultUseBackend;
          try {
            const raw = localStorage.getItem("tc:material-package:use-backend");
            if (raw != null)
              useBackend = raw === "true";
          }
          catch {
            // ignore
          }

          if (!useBackend) {
            toast.success("mock：已模拟发送素材（不写入后端）。");
            return;
          }

          const loadingId = toast.loading("正在发送素材…");
          void (async () => {
            try {
              const requests = await buildChatRequestsFromMaterialPayloads(roomId, batch.items);
              if (!requests.length) {
                toast("该素材没有可发送的消息。", { id: loadingId });
                return;
              }
              if (requests.length > 10) {
                useMaterialSendConfirmStore.getState().open({
                  roomId,
                  roomLabel: String(room?.name ?? "").trim() ? String(room.name) : null,
                  count: requests.length,
                  requests,
                });
                toast(`素材较多（${requests.length}条），请确认发送。`, { id: loadingId });
                return;
              }
              await tuanchat.chatController.batchSendMessages(requests);
              toast.success(`已发送 ${requests.length} 条消息`, { id: loadingId });
            }
            catch (error) {
              const message = error instanceof Error ? error.message : "发送失败";
              toast.error(message, { id: loadingId });
            }
          })();
          return;
        }
        if (isMaterialPreviewDrag(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          const payload = getMaterialPreviewDragData(e.dataTransfer);
          void sendMaterialPayloadToRoom(payload);
          return;
        }
        if (!canEdit)
          return;
        e.preventDefault();
        e.stopPropagation();
        handleDrop();
      }}
    >
      <RoomButton
        room={room}
        unreadMessageNumber={unreadMessageNumber}
        onclick={() => {
          onSelectRoom(roomId);
          onCloseLeftDrawer();
        }}
        isActive={activeRoomId === roomId}
        draggable
        onDragStart={handleItemDragStart}
        onDragEnd={handleItemDragEnd}
      >
      </RoomButton>
    </div>
  );
}
