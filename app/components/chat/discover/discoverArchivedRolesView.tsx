import { CompassIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { tuanchat } from "api/instance";
import { useGlobalContext } from "@/components/globalContextProvider";
import RolesList from "@/components/profile/workTabPart/rolesList";

function normalizeText(value?: string) {
  return String(value ?? "").trim();
}

export default function DiscoverArchivedRolesView() {
  const globalContext = useGlobalContext();
  const userId = globalContext.userId ?? -1;

  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");

  const roleName = useMemo(() => {
    const next = normalizeText(keyword);
    return next ? next : undefined;
  }, [keyword]);

  useEffect(() => {
    setPage(1);
  }, [roleName, userId]);

  const rolesQuery = useQuery({
    queryKey: ["discoverArchivedRoles", userId, page, roleName],
    queryFn: () =>
      tuanchat.roleController.getRolesByPage({
        userId,
        pageNo: page,
        pageSize: 10,
        roleName,
      }),
    enabled: Number.isFinite(userId) && userId > 0,
    staleTime: 10 * 60 * 1000,
  });

  const roles = rolesQuery.data?.data?.list ?? [];
  const totalRecords = rolesQuery.data?.data?.totalRecords ?? roles.length;

  const countText = rolesQuery.isLoading
    ? "人物数量 -"
    : `人物数量 ${totalRecords}`;

  return (
    <div className="flex flex-col w-full h-full min-h-0 min-w-0 bg-base-200 text-base-content">
      <div className="sticky top-0 z-20 bg-base-200 border-t border-b border-gray-300 dark:border-gray-700">
        <div className="flex items-center justify-between gap-4 px-6 h-12">
          <div className="shrink-0 min-w-0">
            <div className="text-sm font-semibold whitespace-nowrap">
              人物归档
            </div>
          </div>
          <div className="flex-1 flex justify-end">
            <div className="relative w-full max-w-90">
              <input
                className="input input-sm input-bordered w-full rounded-full"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索我的人物"
                aria-label="搜索我的人物"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-6">
          <div className="relative rounded-xl overflow-hidden border border-base-300 bg-info/10">
            <CompassIcon
              aria-hidden="true"
              weight="duotone"
              className="pointer-events-none absolute -right-24 -top-24 hidden h-88 w-88 text-primary/15 sm:block"
            />
            <div className="relative z-10 px-8 py-8 sm:py-10">
              <div className="text-2xl sm:text-4xl font-extrabold tracking-tight">
                这里是你的人物归档
              </div>
              <div className="mt-3 text-sm sm:text-base text-base-content/70 max-w-2xl">
                参考个人主页作品页的展示方式，集中查看你创建过的人物（角色）。
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">人物列表</div>
              <div className="mt-1 text-xs text-base-content/60">
                支持名称模糊查询
              </div>
            </div>
            <div className="text-xs text-base-content/60">{countText}</div>
          </div>

          {rolesQuery.isError ? (
            <div className="text-center py-10 rounded-lg">
              <div className="text-error text-lg mb-2">加载失败</div>
              <div className="text-base-content/60 text-sm mb-4">
                请稍后再试
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => rolesQuery.refetch()}
              >
                重新加载
              </button>
            </div>
          ) : (
            <RolesList
              userId={userId}
              roles={roles}
              totalRecords={totalRecords}
              currentPage={page}
              onPageChange={setPage}
              isLoading={rolesQuery.isLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
}
