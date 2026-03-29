import { resolveApiBaseUrl } from "../../../api/instance";
import { unwrapOpenApiResultData } from "@/utils/openApiResult";

export type MaterialPackageApiClientOptions = {
  base?: string;
  token?: string;
  includeToken?: boolean;
};

export type ApiResultLike<T> = {
  success?: boolean;
  errCode?: number;
  errMsg?: string;
  data?: T;
};

export type MaterialPackageVisibility = 0 | 1;

export type MaterialPackageContent = {
  version: 1;
  root: MaterialNode[];
};

export type MaterialNode = MaterialFolderNode | MaterialItemNode;

export type MaterialFolderNode = {
  type: "folder";
  name: string;
  children: MaterialNode[];
};

export type MaterialItemNode = {
  type: "material";
  name: string;
  note?: string;
  messages: MaterialMessageItem[];
};

export type MaterialMessageItem = {
  messageType: number;
  content?: string;
  annotations?: string[];
  extra: Record<string, any>;
  webgal?: Record<string, any>;
  roleId?: number;
  avatarId?: number;
};

export type MaterialPackageRecord = {
  packageId: number;
  userId: number;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  visibility: MaterialPackageVisibility;
  status: number;
  content: MaterialPackageContent;
  importCount: number;
  createTime: string;
  updateTime: string;
};

export type SpaceMaterialPackageRecord = {
  spacePackageId: number;
  spaceId: number;
  sourcePackageId?: number | null;
  sourceUserId?: number | null;
  importedBy?: number | null;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  status: number;
  content: MaterialPackageContent;
  createTime: string;
  updateTime: string;
};

export type CreateMaterialPackagePayload = {
  name: string;
  description?: string;
  coverUrl?: string;
  visibility?: MaterialPackageVisibility;
  content: MaterialPackageContent;
};

export type UpdateMaterialPackagePayload = {
  packageId: number;
  name?: string;
  description?: string;
  coverUrl?: string;
  visibility?: MaterialPackageVisibility;
  content?: MaterialPackageContent;
};

export type ImportMaterialPackageToSpacePayload = {
  spaceId: number;
};

export type CreateSpaceMaterialPackagePayload = {
  spaceId: number;
  name: string;
  description?: string;
  coverUrl?: string;
  content: MaterialPackageContent;
};

export type UpdateSpaceMaterialPackagePayload = {
  spacePackageId: number;
  name?: string;
  description?: string;
  coverUrl?: string;
  content?: MaterialPackageContent;
};

function normalizePath(path: string) {
  const normalized = path.trim();
  if (!normalized)
    return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeBase(base?: string) {
  const trimmed = String(base || "").trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

function resolveClientBaseUrl(client?: MaterialPackageApiClientOptions) {
  const explicitBase = normalizeBase(client?.base);
  if (explicitBase)
    return explicitBase;

  const envBase = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
  return normalizeBase(envBase);
}

function resolveClientToken(client?: MaterialPackageApiClientOptions) {
  if (client?.includeToken === false)
    return "";
  if (typeof client?.token === "string")
    return client.token;
  return globalThis.localStorage?.getItem("token") || "";
}

function buildQueryString(query?: Record<string, unknown>) {
  if (!query)
    return "";

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null)
      return;

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry === undefined || entry === null)
          return;
        params.append(key, String(entry));
      });
      return;
    }

    if (typeof value === "object") {
      params.set(key, JSON.stringify(value));
      return;
    }

    params.set(key, String(value));
  });

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function requestMaterialPackageApi<T>(args: {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  client?: MaterialPackageApiClientOptions;
}): Promise<ApiResultLike<T>> {
  const base = resolveClientBaseUrl(args.client);
  const path = normalizePath(args.path);
  const qs = buildQueryString(args.query);
  const url = base ? `${base}${path}${qs}` : `${path}${qs}`;

  const headers = new Headers({
    "Accept": "application/json",
  });

  const token = resolveClientToken(args.client);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let body: string | undefined;
  if (args.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(args.body);
  }

  const res = await fetch(url, {
    method: args.method,
    headers,
    credentials: "include",
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`请求失败: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }

  const payload = await res.json().catch(() => null) as ApiResultLike<T> | null;
  if (!payload || typeof payload !== "object") {
    throw new Error("接口返回了无效响应");
  }

  return payload;
}

export async function createMaterialPackage(payload: CreateMaterialPackagePayload, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<MaterialPackageRecord>({
    method: "POST",
    path: "/materialPackage",
    body: payload,
    client,
  });
  return unwrapOpenApiResultData(response, "创建素材包失败");
}

export async function updateMaterialPackage(payload: UpdateMaterialPackagePayload, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<MaterialPackageRecord>({
    method: "PUT",
    path: "/materialPackage",
    body: payload,
    client,
  });
  return unwrapOpenApiResultData(response, "更新素材包失败");
}

export async function getMyMaterialPackages(client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<MaterialPackageRecord[]>({
    method: "GET",
    path: "/materialPackage/my",
    client,
  });
  return unwrapOpenApiResultData(response, "获取我的素材包失败");
}

export async function getMaterialPackage(packageId: number, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<MaterialPackageRecord>({
    method: "GET",
    path: `/materialPackage/${packageId}`,
    client,
  });
  return unwrapOpenApiResultData(response, "获取素材包详情失败");
}

export async function deleteMaterialPackage(packageId: number, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<Record<string, any>>({
    method: "DELETE",
    path: `/materialPackage/${packageId}`,
    client,
  });
  return unwrapOpenApiResultData(response, "删除素材包失败");
}

export async function getMaterialPackageSquare(query?: Record<string, unknown>, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<any>({
    method: "GET",
    path: "/materialPackage/square",
    query,
    client,
  });
  return unwrapOpenApiResultData(response, "获取素材广场失败");
}

export async function getMaterialPackagesByUser(userId: number, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<any>({
    method: "GET",
    path: `/materialPackage/user/${userId}`,
    client,
  });
  return unwrapOpenApiResultData(response, "获取用户素材包失败");
}

export async function importMaterialPackageToSpace(
  packageId: number,
  payload: ImportMaterialPackageToSpacePayload,
  client?: MaterialPackageApiClientOptions,
) {
  const response = await requestMaterialPackageApi<any>({
    method: "POST",
    path: `/materialPackage/${packageId}/importToSpace`,
    body: payload,
    client,
  });
  return unwrapOpenApiResultData(response, "导入素材包失败");
}

export async function createSpaceMaterialPackage(payload: CreateSpaceMaterialPackagePayload, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<SpaceMaterialPackageRecord>({
    method: "POST",
    path: "/space/materialPackage",
    body: payload,
    client,
  });
  return unwrapOpenApiResultData(response, "创建局内素材包失败");
}

export async function updateSpaceMaterialPackage(payload: UpdateSpaceMaterialPackagePayload, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<SpaceMaterialPackageRecord>({
    method: "PUT",
    path: "/space/materialPackage",
    body: payload,
    client,
  });
  return unwrapOpenApiResultData(response, "更新局内素材包失败");
}

export async function listSpaceMaterialPackages(spaceId: number, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<SpaceMaterialPackageRecord[]>({
    method: "GET",
    path: "/space/materialPackage/list",
    query: { spaceId },
    client,
  });
  return unwrapOpenApiResultData(response, "获取局内素材包列表失败");
}

export async function getSpaceMaterialPackage(spacePackageId: number, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<SpaceMaterialPackageRecord>({
    method: "GET",
    path: `/space/materialPackage/${spacePackageId}`,
    client,
  });
  return unwrapOpenApiResultData(response, "获取局内素材包详情失败");
}

export async function deleteSpaceMaterialPackage(spacePackageId: number, client?: MaterialPackageApiClientOptions) {
  const response = await requestMaterialPackageApi<Record<string, any>>({
    method: "DELETE",
    path: `/space/materialPackage/${spacePackageId}`,
    client,
  });
  return unwrapOpenApiResultData(response, "删除局内素材包失败");
}

