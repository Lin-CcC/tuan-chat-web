import type { FeedWithStatsResponse } from "api/models/FeedWithStatsResponse";

import { useQuery } from "@tanstack/react-query";
import { tuanchat } from "api/instance";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import UserAvatarComponent from "@/components/common/userAvatar";
import { useGlobalContext } from "@/components/globalContextProvider";
import { SidebarSimpleIcon } from "@/icons";

interface ChatDiscoverNavPanelProps {
  onCloseLeftDrawer: () => void;
  onToggleLeftDrawer?: () => void;
  isLeftDrawerOpen?: boolean;
  activeMode: "square" | "my";
}

type DiscoverEntryKind = "materialPackage" | "repository";

interface FollowingUpdateItem {
  kind: DiscoverEntryKind;
  actorUserId?: number;
  targetId: number;
  title: string;
  summary: string;
  timestamp?: string;
}

function isValidId(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toEpochMs(value?: string) {
  if (!value)
    return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function formatTime(value?: string) {
  if (!value)
    return "";
  const ms = toEpochMs(value);
  if (!ms)
    return "";
  return new Date(ms).toLocaleString("zh-CN");
}

function parseRepositoryUpdateTitle(response: Record<string, any>, repositoryId: number) {
  const title = String(response?.name ?? "").trim();
  return title ? title : `仓库 #${repositoryId}`;
}

function parseRepositoryUpdateSummary(type?: number) {
  // 这里故意做成“短句”而不是复用 feed 卡片里的复杂逻辑，避免耦合 UI。
  switch (type) {
    case 5:
      return "发布了仓库";
    case 6:
      return "Fork 了仓库";
    case 7:
      return "贡献了仓库";
    case 8:
      return "收藏了仓库";
    default:
      return "仓库动态";
  }
}

const REPOSITORY_UPDATES_PAGE_SIZE = 20;
const MAX_UPDATES_TO_RENDER = 5;

function extractRepositoryId(response: any): number | null {
  const direct = Number(response?.repositoryId ?? response?.repoId);
  if (isValidId(direct))
    return direct;

  const nestedRepo = response?.repository;
  const nested = Number(nestedRepo?.repositoryId ?? nestedRepo?.id);
  if (isValidId(nested))
    return nested;

  const fallback = Number(response?.targetRepositoryId ?? response?.targetId);
  return isValidId(fallback) ? fallback : null;
}

function extractActorUserId(response: any): number | null {
  const direct = Number(response?.userId ?? response?.actorUserId);
  return isValidId(direct) ? direct : null;
}

export default function ChatDiscoverNavPanel({ onCloseLeftDrawer, onToggleLeftDrawer, isLeftDrawerOpen, activeMode }: ChatDiscoverNavPanelProps) {
  const leftDrawerLabel = isLeftDrawerOpen ? "收起侧边栏" : "展开侧边栏";
  const navigate = useNavigate();
  const globalContext = useGlobalContext();
  const currentUserId = globalContext.userId ?? -1;
  const shouldLogDebug = import.meta.env.DEV || import.meta.env.MODE === "test";

  const [expandedEntry, setExpandedEntry] = useState<DiscoverEntryKind | null>(null);
  const toggleExpandedEntry = useCallback((next: DiscoverEntryKind) => {
    setExpandedEntry(prev => prev === next ? null : next);
  }, []);

  const navItemBase = "group flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors";
  const navItemInactive = "text-base-content/70 hover:bg-base-300/60 hover:text-base-content";
  const navItemActive = "bg-base-300 text-base-content";
  const entryRowBase = "group flex items-center justify-between rounded-md px-2 py-2 text-sm font-medium transition-colors";
  const entryRowInactive = "text-base-content/80 hover:bg-base-300/60 hover:text-base-content";
  const entryRowActive = "bg-base-300 text-base-content";

  const repositoryFollowingQuery = useQuery({
    queryKey: ["discoverFollowingRepositoryUpdates", currentUserId],
    queryFn: () => tuanchat.feedController.getFollowingMomentFeed({ pageSize: REPOSITORY_UPDATES_PAGE_SIZE }),
    enabled: currentUserId > 0,
    staleTime: 60000,
    retry: 0,
  });

  useEffect(() => {
    if (!shouldLogDebug)
      return;

    const payload: any = repositoryFollowingQuery.data;
    if (!payload) {
      if (repositoryFollowingQuery.isError) {
        console.debug("[discover-following-updates] query error", repositoryFollowingQuery.error);
      }
      return;
    }

    const list: any[] = payload?.data?.list;
    const types = new Map<number, number>();
    if (Array.isArray(list)) {
      for (const item of list) {
        const t = Number(item?.type);
        if (Number.isFinite(t))
          types.set(t, (types.get(t) ?? 0) + 1);
      }
    }
    const first = Array.isArray(list) ? list[0] : null;
    const firstResponse = first?.response;
    const firstResponseKeys = firstResponse && typeof firstResponse === "object" ? Object.keys(firstResponse).slice(0, 12) : [];

    console.debug("[discover-following-updates] payload", {
      success: payload?.success,
      errCode: payload?.errCode,
      errMsg: payload?.errMsg,
      listLen: Array.isArray(list) ? list.length : null,
      types: Object.fromEntries(types.entries()),
      first: first ? { type: first?.type, responseKeys: firstResponseKeys, repositoryId: firstResponse?.repositoryId, userId: firstResponse?.userId } : null,
    });
  }, [repositoryFollowingQuery.data, repositoryFollowingQuery.error, repositoryFollowingQuery.isError, shouldLogDebug]);

  const repositoryUpdates = useMemo<FollowingUpdateItem[]>(() => {
    const list = repositoryFollowingQuery.data?.data?.list ?? [];
    if (!Array.isArray(list) || list.length === 0)
      return [];

    const result: FollowingUpdateItem[] = [];
    for (const item of list as FeedWithStatsResponse[]) {
      const type = item?.type;
      const response = item?.response as any;
      const repositoryId = extractRepositoryId(response);
      if (!repositoryId)
        continue; // 只显示能识别出仓库 ID 的动态

      const actorUserId = extractActorUserId(response);
      const timestamp = String(response?.createTime ?? response?.updateTime ?? "").trim() || undefined;

      result.push({
        kind: "repository",
        actorUserId: actorUserId ?? undefined,
        targetId: repositoryId,
        title: parseRepositoryUpdateTitle(response, repositoryId),
        summary: parseRepositoryUpdateSummary(type),
        timestamp,
      });

      if (result.length >= MAX_UPDATES_TO_RENDER)
        break;
    }

    return result;
  }, [repositoryFollowingQuery.data]);

  const materialPackageUpdates = useMemo<FollowingUpdateItem[]>(() => {
    // 阶段 1：暂无后端 feed，先把交互做出来；后续接入接口后替换这里的数据源。
    return [];
  }, []);

  const handleNavigate = useCallback((to: string) => {
    navigate(to);
    onCloseLeftDrawer();
  }, [navigate, onCloseLeftDrawer]);

  const openRepositoryDetail = useCallback((repositoryId: number) => {
    if (!isValidId(repositoryId))
      return;
    navigate(`/chat/discover?repositoryId=${repositoryId}`);
    onCloseLeftDrawer();
  }, [navigate, onCloseLeftDrawer]);

  const renderUpdatesPanel = useCallback((kind: DiscoverEntryKind) => {
    const isExpanded = expandedEntry === kind;
    if (!isExpanded)
      return null;

    if (currentUserId <= 0) {
      return (
        <div className="pl-4 text-xs text-base-content/60">
          登录后可查看关注更新
        </div>
      );
    }

    const isRepository = kind === "repository";
    const updates = isRepository ? repositoryUpdates : materialPackageUpdates;
    const isLoading = isRepository ? repositoryFollowingQuery.isLoading : false;
    const isError = isRepository ? repositoryFollowingQuery.isError : false;

    if (isLoading) {
      return (
        <div className="pl-4 flex items-center gap-2 text-xs text-base-content/60">
          <span className="loading loading-spinner loading-xs" />
          加载中…
        </div>
      );
    }

    if (isError) {
      return (
        <div className="pl-4 text-xs text-base-content/60">
          <button
            type="button"
            className="btn btn-xs btn-ghost px-2 -ml-2"
            onClick={() => repositoryFollowingQuery.refetch()}
          >
            加载失败，点此重试
          </button>
        </div>
      );
    }

    if (updates.length === 0) {
      return (
        <div className="pl-4 text-xs text-base-content/60">
          {isRepository ? "暂无更新" : "暂无更新（待后端接口）"}
        </div>
      );
    }

    return (
      <div className="pl-4">
        <div className="space-y-0.5">
          {updates.map((u) => {
            const timeText = formatTime(u.timestamp);
            const actorId = u.actorUserId ?? -1;
            const key = `${u.kind}-${u.targetId}-${u.timestamp ?? ""}-${actorId}`;
            return (
              <button
                key={key}
                type="button"
                className="w-full rounded-md px-2 py-2 text-left hover:bg-base-300/60 transition-colors"
                onClick={() => {
                  if (u.kind === "repository") {
                    openRepositoryDetail(u.targetId);
                  } else {
                    handleNavigate("/chat/material-package");
                  }
                }}
              >
                <div className="flex items-start gap-2 min-w-0">
                  {actorId > 0
                    ? (
                        <div className="pt-0.5 shrink-0">
                          <UserAvatarComponent
                            userId={actorId}
                            width={6}
                            isRounded
                            withName
                            stopToastWindow
                            clickEnterProfilePage={false}
                          />
                        </div>
                      )
                    : (
                        <div className="size-6 rounded-full bg-base-300/70 shrink-0 mt-0.5" />
                      )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate">
                      {`${u.summary}「${u.title}」`}
                    </div>
                    <div className="text-[11px] text-base-content/50 truncate">
                      {timeText}
                    </div>
                  </div>
                  <div className="text-[11px] text-base-content/40 shrink-0 pt-0.5">
                    ↗
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }, [
    currentUserId,
    expandedEntry,
    handleNavigate,
    materialPackageUpdates,
    openRepositoryDetail,
    repositoryFollowingQuery,
    repositoryUpdates,
  ]);

  const repositoryUpdateCount = repositoryUpdates.length;
  const materialPackageUpdateCount = materialPackageUpdates.length;
  const repositoryToggleLabel = expandedEntry === "repository" ? "收起仓库关注更新" : "展开仓库关注更新";
  const materialToggleLabel = expandedEntry === "materialPackage" ? "收起素材包关注更新" : "展开素材包关注更新";

  return (
    <div className="flex flex-col w-full h-full flex-1 min-h-0 min-w-0 rounded-tl-xl border-l border-t border-gray-300 dark:border-gray-700 bg-base-200 text-base-content">
      <div className="flex items-center justify-between h-12 gap-2 min-w-0 border-b border-gray-300 dark:border-gray-700 rounded-tl-xl px-3">
        <div className="min-w-0 font-semibold truncate">发现</div>
        {onToggleLeftDrawer && (
          <div className="tooltip tooltip-bottom" data-tip={leftDrawerLabel}>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square hover:text-info"
              onClick={onToggleLeftDrawer}
              aria-label={leftDrawerLabel}
              aria-pressed={Boolean(isLeftDrawerOpen)}
            >
              <SidebarSimpleIcon />
            </button>
          </div>
        )}
      </div>

      <div className="px-3 pt-3 pb-2 space-y-4">
        <div>
          <div className="px-1 pb-2 text-[11px] font-semibold tracking-wider text-base-content/50">
            广场
          </div>

          <div className="space-y-1">
            <div className={`${entryRowBase} ${activeMode === "square" ? entryRowActive : entryRowInactive}`}>
              <button
                type="button"
                className="flex-1 min-w-0 text-left"
                onClick={() => handleNavigate("/chat/discover")}
                aria-label="进入仓库广场"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="size-2 rounded-full bg-info opacity-80" />
                  <div className="truncate">仓库广场</div>
                </div>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs min-h-0 h-7 px-2 opacity-70 hover:opacity-100"
                onClick={() => toggleExpandedEntry("repository")}
                aria-label={repositoryToggleLabel}
              >
                {repositoryUpdateCount > 0 && <span className="size-1.5 rounded-full bg-error" />}
                {repositoryUpdateCount > 0 && <span>{repositoryUpdateCount}</span>}
                <span className={`ml-0.5 inline-block transition-transform ${expandedEntry === "repository" ? "rotate-90" : "rotate-180"}`}>▸</span>
              </button>
            </div>
            {renderUpdatesPanel("repository")}

            <div className={`${entryRowBase} ${entryRowInactive}`}>
              <button
                type="button"
                className="flex-1 min-w-0 text-left"
                onClick={() => handleNavigate("/chat/material-package")}
                aria-label="进入素材包广场"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="size-2 rounded-full bg-success opacity-80" />
                  <div className="truncate">素材包广场</div>
                </div>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs min-h-0 h-7 px-2 opacity-70 hover:opacity-100"
                onClick={() => toggleExpandedEntry("materialPackage")}
                aria-label={materialToggleLabel}
              >
                {materialPackageUpdateCount > 0 && <span className="size-1.5 rounded-full bg-error" />}
                {materialPackageUpdateCount > 0 && <span>{materialPackageUpdateCount}</span>}
                <span className={`ml-0.5 inline-block transition-transform ${expandedEntry === "materialPackage" ? "rotate-90" : "rotate-180"}`}>▸</span>
              </button>
            </div>
            {renderUpdatesPanel("materialPackage")}
          </div>
        </div>

        <div>
          <div className="px-1 pb-2 text-[11px] font-semibold tracking-wider text-base-content/50">
            归档
          </div>

          <div className="space-y-1">
            <Link
              to="/chat/discover/my"
              className={`${navItemBase} ${activeMode === "my" ? navItemActive : navItemInactive}`}
              onClick={onCloseLeftDrawer}
            >
              <span className="size-2 rounded-full bg-primary opacity-70 group-hover:opacity-100" />
              我的归档
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
