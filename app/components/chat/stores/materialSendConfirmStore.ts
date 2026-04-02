import type { ChatMessageRequest } from "../../../../api/models/ChatMessageRequest";

import { create } from "zustand";

export type MaterialSendConfirmPayload = {
  roomId: number;
  roomLabel?: string | null;
  count: number;
  requests: ChatMessageRequest[];
};

type MaterialSendConfirmState = {
  isOpen: boolean;
  payload: MaterialSendConfirmPayload | null;
  open: (payload: MaterialSendConfirmPayload) => void;
  close: () => void;
};

export const useMaterialSendConfirmStore = create<MaterialSendConfirmState>(
  (set) => ({
    isOpen: false,
    payload: null,
    open: (payload) =>
      set({
        isOpen: true,
        payload,
      }),
    close: () =>
      set({
        isOpen: false,
        payload: null,
      }),
  }),
);
