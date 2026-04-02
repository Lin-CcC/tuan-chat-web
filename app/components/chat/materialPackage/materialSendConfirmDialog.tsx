import type { ChatMessageRequest } from "../../../../api/models/ChatMessageRequest";

import React, { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";

import { useMaterialSendConfirmStore } from "@/components/chat/stores/materialSendConfirmStore";
import { tuanchat } from "../../../../api/instance";

export default function MaterialSendConfirmDialog() {
  const isOpen = useMaterialSendConfirmStore(s => s.isOpen);
  const payload = useMaterialSendConfirmStore(s => s.payload);
  const close = useMaterialSendConfirmStore(s => s.close);

  const [isSending, setIsSending] = useState(false);

  const roomLabel = String(payload?.roomLabel ?? "").trim();
  const titleSuffix = roomLabel ? `（${roomLabel}）` : "";
  const count = Number(payload?.count ?? 0);
  const primaryText = `将发送 ${count} 条消息${titleSuffix}。`;
  const secondaryText = "该操作不可撤销。";

  const requests = useMemo(() => {
    return Array.isArray(payload?.requests) ? (payload?.requests as ChatMessageRequest[]) : [];
  }, [payload?.requests]);

  const onClose = useCallback(() => {
    if (isSending)
      return;
    close();
  }, [close, isSending]);

  if (!isOpen || !payload || typeof document === "undefined")
    return null;

  return createPortal(
    <dialog
      open
      className="modal modal-open z-[10050]"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-box max-w-[460px] border border-base-300 bg-base-100 p-0 text-base-content shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
          <div className="text-sm font-semibold">确认发送</div>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            aria-label="关闭"
            onClick={onClose}
            disabled={isSending}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-4 space-y-2">
          <div className="text-sm">{primaryText}</div>
          <div className="text-xs opacity-70">{secondaryText}</div>
        </div>

        <div className="flex justify-end gap-2 border-t border-base-300 px-4 py-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={isSending}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={async () => {
              if (isSending)
                return;
              if (!requests.length) {
                toast.error("没有可发送的消息。");
                close();
                return;
              }
              setIsSending(true);
              const loadingId = toast.loading("发送中…");
              try {
                await tuanchat.chatController.batchSendMessages(requests);
                toast.success(`已发送 ${requests.length} 条消息`, { id: loadingId });
                close();
              }
              catch (error) {
                const message = error instanceof Error ? error.message : "发送失败";
                toast.error(message, { id: loadingId });
              }
              finally {
                setIsSending(false);
              }
            }}
            disabled={isSending || count <= 0}
          >
            {isSending ? "发送中…" : "发送"}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

