import { describe, expect, it, vi } from "vitest";

import {
  createMaterialPackage,
  deleteSpaceMaterialPackage,
  getMaterialPackage,
  getMyMaterialPackages,
  listSpaceMaterialPackages,
} from "./materialPackageApi";

describe("materialPackageApi", () => {
  it("getMyMaterialPackages 会带上 Authorization 并请求正确路径", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({
        success: true,
        data: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchSpy;

    try {
      await getMyMaterialPackages({
        base: "http://example.com/api",
        token: "token-123",
      });
    }
    finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = firstCall;
    expect(url).toBe("http://example.com/api/materialPackage/my");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });

  it("getMaterialPackage 会请求 packageId 详情", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({
        success: true,
        data: { packageId: 1 },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchSpy;

    try {
      await getMaterialPackage(1, { base: "http://example.com/api" });
    }
    finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = firstCall;
    expect(url).toBe("http://example.com/api/materialPackage/1");
    expect(init.method).toBe("GET");
  });

  it("createMaterialPackage 会 POST JSON body", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({
        success: true,
        data: { packageId: 9 },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchSpy;

    try {
      await createMaterialPackage({
        name: "test",
        description: "desc",
        coverUrl: "http://img",
        visibility: 1,
        content: { version: 1, root: [] },
      }, {
        base: "http://example.com/api",
        token: "token-123",
      });
    }
    finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = firstCall;
    expect(url).toBe("http://example.com/api/materialPackage");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(init.body).toBe(JSON.stringify({
      name: "test",
      description: "desc",
      coverUrl: "http://img",
      visibility: 1,
      content: { version: 1, root: [] },
    }));
  });

  it("listSpaceMaterialPackages 会携带 spaceId query", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({
        success: true,
        data: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchSpy;

    try {
      await listSpaceMaterialPackages(2, { base: "http://example.com/api" });
    }
    finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = firstCall;
    expect(url).toBe("http://example.com/api/space/materialPackage/list?spaceId=2");
    expect(init.method).toBe("GET");
  });

  it("deleteSpaceMaterialPackage 会 DELETE 指定 spacePackageId", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({
        success: true,
        data: {},
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchSpy;

    try {
      await deleteSpaceMaterialPackage(3, { base: "http://example.com/api" });
    }
    finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = firstCall;
    expect(url).toBe("http://example.com/api/space/materialPackage/3");
    expect(init.method).toBe("DELETE");
  });
});
