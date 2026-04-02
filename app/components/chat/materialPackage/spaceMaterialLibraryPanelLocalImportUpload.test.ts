import { describe, expect, it, vi } from "vitest";

import { buildSpaceMaterialMessagesFromFile } from "@/components/chat/materialPackage/spaceMaterialLibraryPanel";

describe("spaceMaterialLibraryPanel local import upload", () => {
  it("uploads image file in backend mode", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", {
      type: "image/png",
    });

    const uploadImg = vi.fn().mockResolvedValue("https://example.com/a.png");
    const uploadAudio = vi.fn().mockResolvedValue("https://example.com/a.webm");

    const messages = await buildSpaceMaterialMessagesFromFile({
      file,
      useBackend: true,
      uploadClient: { uploadImg, uploadAudio },
    });

    expect(uploadImg).toHaveBeenCalledTimes(1);
    expect(uploadImg.mock.calls[0]?.[0]).toBe(file);
    expect(uploadImg.mock.calls[0]?.[1]).toBe(4);

    expect(messages).toHaveLength(1);
    const msg = messages[0] as any;
    expect(msg?.messageType).toBe(2);
    expect(msg?.extra?.imageMessage?.url).toBe("https://example.com/a.png");
    expect(msg?.extra?.imageMessage?.fileName).toBe("a.png");
  });

  it("uploads audio file in backend mode", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "b.mp3", {
      type: "audio/mpeg",
    });

    const uploadImg = vi.fn().mockResolvedValue("https://example.com/b.png");
    const uploadAudio = vi.fn().mockResolvedValue("https://example.com/b.webm");

    const messages = await buildSpaceMaterialMessagesFromFile({
      file,
      useBackend: true,
      uploadClient: { uploadImg, uploadAudio },
    });

    expect(uploadAudio).toHaveBeenCalledTimes(1);
    expect(uploadAudio.mock.calls[0]?.[0]).toBe(file);
    expect(uploadAudio.mock.calls[0]?.[1]).toBe(4);
    expect(uploadAudio.mock.calls[0]?.[2]).toBe(0);

    expect(messages).toHaveLength(1);
    const msg = messages[0] as any;
    expect(msg?.messageType).toBe(3);
    expect(msg?.extra?.soundMessage?.url).toBe("https://example.com/b.webm");
    expect(msg?.extra?.soundMessage?.fileName).toBe("b.mp3");
  });

  it("does not upload text file", async () => {
    const file = new File(["hello"], "c.txt", { type: "text/plain" });

    const uploadImg = vi.fn(() => {
      throw new Error("should not call uploadImg");
    });
    const uploadAudio = vi.fn(() => {
      throw new Error("should not call uploadAudio");
    });

    const messages = await buildSpaceMaterialMessagesFromFile({
      file,
      useBackend: true,
      uploadClient: { uploadImg, uploadAudio },
    });

    expect(uploadImg).not.toHaveBeenCalled();
    expect(uploadAudio).not.toHaveBeenCalled();

    expect(messages).toHaveLength(1);
    const msg = messages[0] as any;
    expect(msg?.messageType).toBe(1);
    expect(msg?.content).toBe("hello");
  });
});
