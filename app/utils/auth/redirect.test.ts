import { afterEach, describe, expect, it } from "vitest";

import { normalizeAuthRedirectPath } from "./redirect";

type MockWindow = {
  location: {
    origin: string;
  };
};

function installMockWindow(origin = "http://localhost:5187") {
  const mockWindow: MockWindow = {
    location: {
      origin,
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: mockWindow,
  });
}

describe("normalizeAuthRedirectPath", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  afterEach(() => {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
      return;
    }
    // @ts-expect-error test cleanup
    delete globalThis.window;
  });

  it("空值时返回 fallback", () => {
    expect(normalizeAuthRedirectPath(null, "/"))
      .toBe("/");
    expect(normalizeAuthRedirectPath("", "/"))
      .toBe("/");
  });

  it("站内路径保持不变", () => {
    expect(normalizeAuthRedirectPath("/chat?tab=room#msg"))
      .toBe("/chat?tab=room#msg");
  });

  it("绝对地址会被归一化为当前站点内路径", () => {
    installMockWindow("http://localhost:5187");

    expect(normalizeAuthRedirectPath("http://localhost:5180/chat/1?x=1#y", "/"))
      .toBe("/chat/1?x=1#y");
  });

  it("应拒绝明显的后端 API 路径（/user/*）", () => {
    expect(normalizeAuthRedirectPath("/user/login", "/chat"))
      .toBe("/chat");

    installMockWindow("http://localhost:5187");
    expect(normalizeAuthRedirectPath("http://localhost:5187/user/login", "/chat"))
      .toBe("/chat");
  });
});
