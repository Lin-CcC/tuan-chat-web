import type { MaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";

import { CompassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { getMaterialPackagesByUser } from "@/components/materialPackage/materialPackageApi";
import { useGlobalContext } from "@/components/globalContextProvider";
import UserMaterialPackagesList from "@/components/profile/workTabPart/materialPackageList";

function normalizeMaterialPackagesResult(payload: unknown) {
  if (Array.isArray(payload)) {
    return {
      list: payload as MaterialPackageRecord[],
      totalRecords: payload.length,
    };
  }
  const maybe = payload as any;
  const list = Array.isArray(maybe?.list)
    ? (maybe.list as MaterialPackageRecord[])
    : [];
  const totalRecords =
    typeof maybe?.totalRecords === "number" &&
    Number.isFinite(maybe.totalRecords)
      ? Math.max(0, Math.floor(maybe.totalRecords))
      : list.length;
  return { list, totalRecords };
}

function normalizeText(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export default function DiscoverArchivedMaterialPackagesView() {
  const globalContext = useGlobalContext();
  const userId = globalContext.userId ?? -1;

  const [keyword, setKeyword] = useState("");

  const materialPackagesQuery = useQuery({
    queryKey: ["discoverArchivedMaterialPackages", userId],
    queryFn: () => getMaterialPackagesByUser(userId),
    enabled: Number.isFinite(userId) && userId > 0,
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const packagesNormalized = useMemo(() => {
    return normalizeMaterialPackagesResult(materialPackagesQuery.data);
  }, [materialPackagesQuery.data]);

  const filteredPackages = useMemo(() => {
    const kw = normalizeText(keyword);
    if (!kw) return packagesNormalized.list;

    return packagesNormalized.list.filter((pkg) => {
      const name = normalizeText(pkg?.name ?? undefined);
      const description = normalizeText(pkg?.description ?? undefined);
      return name.includes(kw) || description.includes(kw);
    });
  }, [keyword, packagesNormalized.list]);

  const countText = materialPackagesQuery.isLoading
    ? "素材包数量 -"
    : `素材包数量 ${filteredPackages.length}`;

  return (
    <div className="flex flex-col w-full h-full min-h-0 min-w-0 bg-base-200 text-base-content">
      <div className="sticky top-0 z-20 bg-base-200 border-t border-b border-gray-300 dark:border-gray-700">
        <div className="flex items-center justify-between gap-4 px-6 h-12">
          <div className="shrink-0 min-w-0">
            <div className="text-sm font-semibold whitespace-nowrap">
              素材包归档
            </div>
          </div>
          <div className="flex-1 flex justify-end">
            <div className="relative w-full max-w-90">
              <input
                className="input input-sm input-bordered w-full rounded-full"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索我的素材包"
                aria-label="搜索我的素材包"
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
                这里是你的素材包归档
              </div>
              <div className="mt-3 text-sm sm:text-base text-base-content/70 max-w-2xl">
                参考个人主页作品页的展示方式，集中查看你创建过的素材包。
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">素材包列表</div>
              <div className="mt-1 text-xs text-base-content/60">
                按名称/描述检索
              </div>
            </div>
            <div className="text-xs text-base-content/60">{countText}</div>
          </div>

          <UserMaterialPackagesList
            userId={userId}
            packages={filteredPackages}
            totalRecords={filteredPackages.length}
            isLoading={materialPackagesQuery.isLoading}
            isError={materialPackagesQuery.isError}
            onRetry={() => materialPackagesQuery.refetch()}
          />
        </div>
      </div>
    </div>
  );
}
