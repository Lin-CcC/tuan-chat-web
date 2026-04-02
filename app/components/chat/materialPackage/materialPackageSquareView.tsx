import type { MaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";

import { PackageIcon, X } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { useLocalStorage } from "@/components/common/customHooks/useLocalStorage";
import { useScreenSize } from "@/components/common/customHooks/useScreenSize";
import {
  buildMaterialPackageDetailQueryKey,
  buildMaterialPackageSquareQueryKey,
} from "@/components/chat/materialPackage/materialPackageQueries";
import { getMockMaterialPackageSquare } from "@/components/chat/materialPackage/materialPackageMock";
import {
  getMaterialPackage,
  getMaterialPackagesByUser,
  getMaterialPackageSquare,
  importMaterialPackageToSpace,
} from "@/components/materialPackage/materialPackageApi";

interface MaterialPackageSquareViewProps {
  activeSpaceId: number | null;
  spaces?: Array<{
    spaceId?: number | null;
    name?: string | null;
    description?: string | null;
  }>;
  onSelectSpace?: (spaceId: number) => void;
  /** 外部希望打开的作者（例如从作品页进入查看某人的素材包） */
  initialAuthorUserId?: number | null;
  /** 外部希望直接打开详情的素材包 ID（例如从作品页点击某个素材包卡片） */
  initialPackageId?: number | null;
  /** 若指定，则导入时不再弹“选择空间”而直接导入到该 spaceId */
  forcedImportSpaceId?: number | null;
  onImportedToSpace?: (payload: { spaceId: number; packageId: number }) => void;
}

function normalizeText(value?: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isValidId(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toPackages(value: unknown): MaterialPackageRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean) as MaterialPackageRecord[];
}

function formatIsoLike(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return "-";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return raw.trim() || "-";
  }
}

export default function MaterialPackageSquareView({
  activeSpaceId,
  onSelectSpace,
  spaces,
  initialAuthorUserId,
  initialPackageId,
  forcedImportSpaceId,
  onImportedToSpace,
}: MaterialPackageSquareViewProps) {
  const queryClient = useQueryClient();
  const screenSize = useScreenSize();
  const isMobile = screenSize === "sm";

  const defaultUseBackend = !(import.meta.env.MODE === "test");
  const [useBackend, setUseBackend] = useLocalStorage<boolean>(
    "tc:material-package:use-backend",
    defaultUseBackend,
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      const next = Boolean(detail?.useBackend);
      setUseBackend(next);
    };
    window.addEventListener(
      "tc:material-package:use-backend-changed",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "tc:material-package:use-backend-changed",
        handler as EventListener,
      );
  }, [setUseBackend]);

  const listQueryKey = buildMaterialPackageSquareQueryKey(useBackend);
  const packagesQuery = useQuery({
    queryKey: listQueryKey,
    queryFn: () =>
      useBackend
        ? getMaterialPackageSquare()
        : Promise.resolve(getMockMaterialPackageSquare()),
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const packages = useMemo(
    () => toPackages(packagesQuery.data),
    [packagesQuery.data],
  );
  const [keyword, setKeyword] = useState("");
  const [activeAuthorUserId, setActiveAuthorUserId] = useState<number | null>(
    null,
  );
  const isAuthorPage = isValidId(activeAuthorUserId);

  const focusConsumedRef = React.useRef<string | null>(null);
  useEffect(() => {
    const authorId = isValidId(initialAuthorUserId)
      ? initialAuthorUserId
      : null;
    const packageId = isValidId(initialPackageId) ? initialPackageId : null;
    if (!authorId && !packageId) return;

    const key = `${authorId ?? ""}:${packageId ?? ""}`;
    if (focusConsumedRef.current === key) return;
    focusConsumedRef.current = key;

    if (authorId) {
      setActiveAuthorUserId(authorId);
    }
    if (packageId) {
      setSelectedPackageId(packageId);
    }
  }, [initialAuthorUserId, initialPackageId]);

  const authorPackagesQuery = useQuery({
    enabled: useBackend && isValidId(activeAuthorUserId),
    queryKey: ["materialPackagesByUser", activeAuthorUserId ?? -1, useBackend],
    queryFn: () => getMaterialPackagesByUser(activeAuthorUserId ?? -1),
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const basePackages = useMemo(() => {
    if (!isAuthorPage) return packages;

    if (useBackend) {
      return toPackages(authorPackagesQuery.data);
    }

    return packages.filter(
      (p) => Number(p.userId) === Number(activeAuthorUserId),
    );
  }, [
    activeAuthorUserId,
    authorPackagesQuery.data,
    isAuthorPage,
    packages,
    useBackend,
  ]);
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(
    null,
  );
  const selectedFromList = useMemo(() => {
    if (!isValidId(selectedPackageId)) return null;
    return (
      packages.find((p) => Number(p.packageId) === selectedPackageId) ?? null
    );
  }, [packages, selectedPackageId]);

  const filteredPackages = useMemo(() => {
    const q = normalizeText(keyword);
    if (!q) return basePackages;
    return basePackages.filter((pkg) => {
      const name = normalizeText(pkg?.name);
      const desc = normalizeText(pkg?.description ?? "");
      return name.includes(q) || desc.includes(q);
    });
  }, [basePackages, keyword]);

  const detailQuery = useQuery({
    enabled: useBackend && isValidId(selectedPackageId),
    queryKey: buildMaterialPackageDetailQueryKey(
      selectedPackageId ?? -1,
      useBackend,
    ),
    queryFn: () => getMaterialPackage(selectedPackageId ?? -1),
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const activeDetail = useBackend
    ? (detailQuery.data ?? null)
    : selectedFromList;
  const isDetailOpen = isValidId(selectedPackageId);

  const openAuthorPage = useCallback((userId: unknown) => {
    const next = Number(userId);
    if (!Number.isFinite(next) || next <= 0) {
      toast.error("作者信息不可用");
      return;
    }
    setSelectedPackageId(null);
    setActiveAuthorUserId(next);
  }, []);

  const closeAuthorPage = useCallback(() => {
    setSelectedPackageId(null);
    setActiveAuthorUserId(null);
  }, []);

  const listIsLoading =
    useBackend && isAuthorPage
      ? authorPackagesQuery.isLoading
      : packagesQuery.isLoading;
  const listIsError =
    useBackend && isAuthorPage
      ? authorPackagesQuery.isError
      : packagesQuery.isError;
  const listRefetch =
    useBackend && isAuthorPage
      ? authorPackagesQuery.refetch
      : packagesQuery.refetch;

  const [isImporting, setIsImporting] = useState(false);
  const [isPickSpaceOpen, setIsPickSpaceOpen] = useState(false);
  const [pendingImportPackageId, setPendingImportPackageId] = useState<
    number | null
  >(null);

  const closePickSpace = useCallback(() => {
    setIsPickSpaceOpen(false);
    setPendingImportPackageId(null);
  }, []);

  const runImport = useCallback(
    async (args: { packageId: number; spaceId: number }) => {
      if (!useBackend) {
        toast.success("mock：已模拟导入到局内（不写入后端）。");
        onImportedToSpace?.({
          spaceId: args.spaceId,
          packageId: args.packageId,
        });
        closePickSpace();
        return;
      }
      setIsImporting(true);
      try {
        await importMaterialPackageToSpace(args.packageId, {
          spaceId: args.spaceId,
        });
        await queryClient.invalidateQueries({
          queryKey: buildMaterialPackageSquareQueryKey(true),
        });
        await queryClient.invalidateQueries({
          queryKey: buildMaterialPackageDetailQueryKey(args.packageId, true),
        });
        toast.success("已导入到当前局内（Space）。");
        onImportedToSpace?.({
          spaceId: args.spaceId,
          packageId: args.packageId,
        });
        closePickSpace();
      } catch (error) {
        const message = error instanceof Error ? error.message : "导入失败。";
        toast.error(message);
      } finally {
        setIsImporting(false);
      }
    },
    [closePickSpace, onImportedToSpace, queryClient, useBackend],
  );

  const handleImport = useCallback(async () => {
    if (!isValidId(selectedPackageId)) return;

    if (isValidId(forcedImportSpaceId)) {
      setPendingImportPackageId(selectedPackageId);
      void runImport({
        packageId: selectedPackageId,
        spaceId: forcedImportSpaceId,
      });
      return;
    }

    const available = Array.isArray(spaces)
      ? spaces.filter((s) => isValidId(s?.spaceId))
      : [];
    if (!available.length) {
      toast("当前没有可用的空间，请先回到聊天创建/选择空间。", { icon: "ℹ️" });
      return;
    }

    setPendingImportPackageId(selectedPackageId);
    setIsPickSpaceOpen(true);
  }, [forcedImportSpaceId, runImport, selectedPackageId, spaces, useBackend]);

  const closeDetail = useCallback(() => {
    setSelectedPackageId(null);
  }, []);

  const detailPanel = (
    <div className={`h-full ${isMobile ? "w-full" : "w-[380px]"} bg-base-100`}>
      <div
        className={`sticky top-0 z-20 border-b border-base-300 bg-base-100/95 backdrop-blur ${isMobile ? "px-4" : "px-5"} py-3`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">素材包详情</div>
            <div className="mt-0.5 text-[11px] text-base-content/60">
              {useBackend ? "数据源：后端" : "数据源：本地 mock（用于验收 UI）"}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            onClick={closeDetail}
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div
        className={`${isMobile ? "px-4" : "px-5"} py-4 space-y-4 overflow-y-auto h-[calc(100%-60px)]`}
      >
        {useBackend && detailQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-base-content/70">
            <span className="loading loading-spinner loading-sm"></span>
            正在加载详情…
          </div>
        )}

        {useBackend && detailQuery.isError && (
          <div className="rounded-xl border border-base-300 bg-base-100 p-4">
            <div className="text-sm font-semibold">暂时无法加载素材包详情</div>
            <div className="mt-1 text-xs text-base-content/60">
              请稍后重试或切换到 mock。
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => detailQuery.refetch()}
              >
                重试
              </button>
            </div>
          </div>
        )}

        {activeDetail && (
          <>
            <div className="rounded-xl border border-base-300 bg-base-100 overflow-hidden">
              <div className="relative aspect-4/3 bg-base-200">
                <img
                  src={activeDetail.coverUrl || "/repositoryDefaultImage.webp"}
                  alt={String(activeDetail.name ?? "")}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-4">
                <div className="text-lg font-semibold truncate">
                  {activeDetail.name}
                </div>
                <div className="mt-1 text-sm text-base-content/70 whitespace-pre-wrap break-words">
                  {String(activeDetail.description ?? "").trim() || "暂无描述"}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="badge badge-outline">{`ID ${activeDetail.packageId}`}</div>
                  <div className="badge badge-outline">{`导入 ${activeDetail.importCount ?? 0}`}</div>
                  <button
                    type="button"
                    className="badge badge-outline hover:border-info hover:text-info"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openAuthorPage(activeDetail.userId);
                    }}
                    title="查看作者的素材包"
                  >
                    {`作者 #${Number(activeDetail.userId) || "-"}`}
                  </button>
                  <div className="badge badge-outline">{`更新 ${formatIsoLike(activeDetail.updateTime)}`}</div>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={isImporting || !isValidId(selectedPackageId)}
              onClick={handleImport}
            >
              {useBackend
                ? isImporting
                  ? "正在导入…"
                  : "选择空间并导入"
                : "选择空间（演示）"}
            </button>
          </>
        )}

        {!activeDetail && !detailQuery.isLoading && (
          <div className="rounded-xl border border-base-300 bg-base-100 p-4 text-sm text-base-content/70">
            请选择一个素材包查看详情。
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative h-full w-full">
      <div className="flex h-full w-full">
        <div className="flex-1 h-full overflow-y-auto">
          <div className="sticky top-0 z-20 bg-base-200 border-b border-base-300">
            <div className="flex items-center justify-between gap-4 px-6 h-12">
              <div className="shrink-0 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  {isValidId(activeAuthorUserId) && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={closeAuthorPage}
                    >
                      返回广场
                    </button>
                  )}
                  <div className="text-sm font-semibold whitespace-nowrap">
                    {isAuthorPage
                      ? `作者 #${activeAuthorUserId} 的素材包`
                      : "素材包广场"}
                  </div>
                </div>
              </div>
              <div className="flex-1 flex justify-end">
                <div className="relative w-full max-w-90">
                  <input
                    className="input input-sm input-bordered w-full rounded-full"
                    placeholder={
                      isAuthorPage ? "搜索该作者素材包" : "搜索素材包"
                    }
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    aria-label="搜索素材包"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-6">
            <div className="relative rounded-xl overflow-hidden border border-base-300 bg-info/10">
              <PackageIcon
                aria-hidden="true"
                weight="duotone"
                className="pointer-events-none absolute -right-24 -top-24 hidden h-88 w-88 text-primary/15 sm:block"
              />
              <div className="relative z-10 px-8 py-8 sm:py-10">
                <div className="text-2xl sm:text-4xl font-extrabold tracking-tight">
                  探索可发现的素材包
                </div>
                <div className="mt-3 text-sm sm:text-base text-base-content/70 max-w-2xl">
                  浏览公开的局外素材包，点击卡片查看详情，并可一键导入到当前空间使用。
                </div>
                <div className="mt-3 text-[11px] text-base-content/60">
                  {useBackend
                    ? "数据源：后端"
                    : "数据源：本地 mock（用于验收 UI）"}
                </div>
              </div>
            </div>

            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {isAuthorPage ? "作者素材包" : "广场素材包"}
                </div>
                <div className="mt-1 text-xs text-base-content/60">
                  按更新时间展示公开素材包。
                </div>
              </div>
              <div className="text-xs text-base-content/60">{`素材包数量 ${filteredPackages.length}`}</div>
            </div>

            {listIsLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="h-56 rounded-xl bg-base-300/50 animate-pulse"
                  />
                ))}
              </div>
            )}

            {listIsError && (
              <div className="rounded-xl border border-base-300 bg-base-100 p-4">
                <div className="text-sm font-semibold">
                  {isAuthorPage
                    ? "暂时无法加载作者素材包"
                    : "暂时无法加载素材包广场"}
                </div>
                <div className="mt-1 text-xs text-base-content/60">
                  请确认后端接口可用，或切换到 mock。
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => listRefetch()}
                  >
                    重试
                  </button>
                </div>
              </div>
            )}

            {!listIsLoading &&
              !listIsError &&
              filteredPackages.length === 0 && (
                <div className="rounded-xl border border-base-300 bg-base-100 p-6">
                  <div className="text-base font-semibold">暂无素材包</div>
                  <div className="mt-2 text-sm text-base-content/60">
                    可以尝试修改搜索关键词或刷新。
                  </div>
                </div>
              )}

            {!listIsLoading && !listIsError && filteredPackages.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredPackages.map((pkg) => {
                  const id = Number(pkg.packageId);
                  const selected =
                    isValidId(selectedPackageId) && id === selectedPackageId;
                  const name = pkg?.name ?? `素材包 #${id}`;
                  const desc = String(pkg?.description ?? "").trim();
                  const cover = pkg?.coverUrl || "/repositoryDefaultImage.webp";
                  const authorId = Number(pkg.userId);
                  const canOpenAuthor =
                    Number.isFinite(authorId) && authorId > 0;
                  return (
                    <div
                      key={id}
                      role="button"
                      tabIndex={0}
                      className={`group rounded-xl border bg-base-100 shadow-sm overflow-hidden transition-transform hover:-translate-y-0.5 hover:shadow-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-info/60 ${
                        selected ? "border-info" : "border-base-300"
                      }`}
                      onClick={() => setSelectedPackageId(id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedPackageId(id);
                        }
                      }}
                    >
                      <div className="relative aspect-4/3 bg-base-300 overflow-hidden">
                        <img
                          src={cover}
                          alt={String(name)}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute left-3 top-3 flex items-center gap-2">
                          <span className="badge badge-sm bg-base-100/70 border border-base-300 text-base-content backdrop-blur">
                            {`导入 ${pkg.importCount ?? 0}`}
                          </span>
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="text-md font-medium truncate">
                          {name}
                        </div>
                        <div className="mt-1 text-xs text-base-content/70 truncate">
                          {desc || "暂无描述"}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-base-content/50">
                          <span className="truncate">{`素材包 #${id}`}</span>
                          <span className="shrink-0">{`更新 ${formatIsoLike(pkg.updateTime)}`}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-base-content/60">
                          <button
                            type="button"
                            className={`link link-hover ${canOpenAuthor ? "" : "opacity-60 pointer-events-none"}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openAuthorPage(authorId);
                            }}
                            title={
                              canOpenAuthor
                                ? "查看作者的素材包"
                                : "作者信息不可用"
                            }
                          >
                            {canOpenAuthor ? `作者 #${authorId}` : "作者 -"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {!isMobile && isDetailOpen && (
          <div className="h-full border-l border-base-300">{detailPanel}</div>
        )}
      </div>

      {isMobile && isDetailOpen && (
        <div className="fixed inset-0 z-[90] bg-base-100">{detailPanel}</div>
      )}

      {isPickSpaceOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 px-4"
          onMouseDown={closePickSpace}
        >
          <div
            className={`w-full ${isMobile ? "max-w-sm" : "max-w-lg"} rounded-xl border border-base-300 bg-base-100 shadow-xl`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  选择要导入的空间
                </div>
                <div className="mt-0.5 text-[11px] text-base-content/60 truncate">
                  导入后会生成局内素材包副本，可独立编辑，不会发布到素材包广场。
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square"
                onClick={closePickSpace}
                aria-label="关闭"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-3">
              <div className="space-y-2">
                {(Array.isArray(spaces) ? spaces : [])
                  .filter((s) => isValidId(s?.spaceId))
                  .map((space) => {
                    const sid = Number(space.spaceId);
                    const label = String(space.name ?? `空间 #${sid}`);
                    const desc = String(space.description ?? "").trim();
                    return (
                      <button
                        key={sid}
                        type="button"
                        className="w-full text-left rounded-lg border border-base-300 bg-base-100 px-3 py-2 hover:bg-base-200/40 disabled:opacity-60"
                        disabled={
                          isImporting || !isValidId(pendingImportPackageId)
                        }
                        onClick={() => {
                          onSelectSpace?.(sid);
                          if (isValidId(pendingImportPackageId))
                            void runImport({
                              packageId: pendingImportPackageId,
                              spaceId: sid,
                            });
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {label}
                            </div>
                            <div className="mt-0.5 text-[11px] text-base-content/60 truncate">
                              {desc || `Space ID ${sid}`}
                            </div>
                          </div>
                          <div className="text-[11px] text-base-content/50">{`#${sid}`}</div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-base-300 px-4 py-3">
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={closePickSpace}
                disabled={isImporting}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
