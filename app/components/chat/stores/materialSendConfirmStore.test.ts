import type { ChatMessageRequest } from "../../../../api/models/ChatMessageRequest";

import { describe, expect, it } from "vitest";

import { useMaterialSendConfirmStore } from "./materialSendConfirmStore";

describe("materialSendConfirmStore", () => {
  it("opens and closes with payload", () => {
    const sampleRequests: ChatMessageRequest[] = [];

    useMaterialSendConfirmStore.getState().open({
      roomId: 1,
      roomLabel: "room",
      count: 0,
      requests: sampleRequests,
    });

    const opened = useMaterialSendConfirmStore.getState();
    expect(opened.isOpen).toBe(true);
    expect(opened.payload?.roomId).toBe(1);

    useMaterialSendConfirmStore.getState().close();
    const closed = useMaterialSendConfirmStore.getState();
    expect(closed.isOpen).toBe(false);
    expect(closed.payload).toBe(null);
  });
});
