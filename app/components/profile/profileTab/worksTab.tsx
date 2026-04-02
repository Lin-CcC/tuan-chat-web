import React, { useMemo, useState } from "react";
import UserRepositoriesList from "@/components/profile/workTabPart/repositoryList";
import RolesList from "@/components/profile/workTabPart/rolesList";
import UserMaterialPackagesList from "@/components/profile/workTabPart/materialPackageList";
import { useRepositoryListByUserQuery } from "../../../../api/hooks/repositoryQueryHooks";
import { useGetUserRolesPageQuery } from "../../../../api/hooks/RoleAndAvatarHooks";
import { useQuery } from "@tanstack/react-query";
import {
  getMaterialPackagesByUser,
  type MaterialPackageRecord,
} from "@/components/materialPackage/materialPackageApi";

type TabType = "repositories" | "roles" | "materialPackages";
interface WorksTabProp {
  userId: number;
}

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

const WorksTab: React.FC<WorksTabProp> = ({ userId }) => {
  const [page, setPage] = useState(1);
  const [repositoryPage, setRepositoryPage] = useState(1);
  const [activeTab, setActiveTab] = useState<TabType>("repositories");
  const { data: response, isLoading: rolesLoading } = useGetUserRolesPageQuery({
    userId,
    pageNo: page,
    pageSize: 10,
  });

  const { data: repositoriesResponse, isLoading: repositoriesLoading } =
    useRepositoryListByUserQuery({
      userId,
      pageNo: repositoryPage,
      pageSize: 10,
    });

  const materialPackagesQuery = useQuery({
    queryKey: ["materialPackagesByUser", userId],
    queryFn: () => getMaterialPackagesByUser(userId),
    enabled:
      activeTab === "materialPackages" && Number.isFinite(userId) && userId > 0,
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const materialPackages = useMemo(() => {
    return normalizeMaterialPackagesResult(materialPackagesQuery.data);
  }, [materialPackagesQuery.data]);

  const renderTabContent = () => {
    switch (activeTab) {
      case "repositories":
        return (
          <UserRepositoriesList
            userId={userId}
            totalRecords={repositoriesResponse?.data?.totalRecords || 0}
            currentPage={repositoryPage}
            onPageChange={setRepositoryPage}
            isLoading={repositoriesLoading}
          />
        );
      case "roles":
        return (
          <RolesList
            userId={userId}
            roles={response?.data?.list ?? []}
            totalRecords={response?.data?.totalRecords || 0}
            currentPage={page}
            onPageChange={setPage}
            isLoading={rolesLoading}
          />
        );
      case "materialPackages":
        return (
          <UserMaterialPackagesList
            userId={userId}
            packages={materialPackages.list}
            totalRecords={materialPackages.totalRecords}
            isLoading={materialPackagesQuery.isLoading}
            isError={materialPackagesQuery.isError}
            onRetry={() => materialPackagesQuery.refetch()}
          />
        );
      default:
        return null;
    }
  };

  const renderTitle = () => {
    switch (activeTab) {
      case "repositories":
        return (
          <>
            <h2 className="text-2xl font-bold">创建的仓库</h2>
            <span className="text-gray-500">
              共 {repositoriesResponse?.data?.totalRecords || 0} 个仓库
            </span>
          </>
        );
      case "roles":
        return (
          <>
            <h2 className="text-2xl font-bold">创建的角色</h2>
            <span className="text-gray-500">
              共 {response?.data?.totalRecords || 0} 个角色
            </span>
          </>
        );
      case "materialPackages":
        return (
          <>
            <h2 className="text-2xl font-bold">创建的素材包</h2>
            <span className="text-gray-500">
              共 {materialPackages.totalRecords} 个素材包
            </span>
          </>
        );
      default:
        return null;
    }
  };

  const renderTabButton = (tab: TabType, label: string) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2 rounded-lg cursor-pointer ${
        activeTab === tab
          ? "bg-success/50 text-base font-medium"
          : "hover:bg-success/30"
      }`}
      type="button"
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col min-h-screen">
      {/* 顶部导航 - 移动端 */}
      <div className="md:hidden overflow-x-auto whitespace-nowrap p-4 border-b border-gray-200">
        <nav className="flex space-x-2">
          {renderTabButton("repositories", "仓库")}
          {renderTabButton("roles", "角色")}
          {renderTabButton("materialPackages", "素材包")}
        </nav>
      </div>

      <div className="flex flex-col md:flex-row flex-1 md:pl-10">
        {/* 左侧导航 - PC端（垂直） */}
        <div className="hidden md:flex md:flex-col w-48 shrink-0 p-4 border-r border-gray-200 pt-10">
          <nav className="space-y-2 flex flex-col">
            {renderTabButton("repositories", "仓库")}
            {renderTabButton("roles", "角色")}
            {renderTabButton("materialPackages", "素材包")}
          </nav>
        </div>

        {/* 主要内容区域 */}
        <div className="flex-1 p-4 md:p-8">
          <div className="flex justify-between items-center mb-6">
            {renderTitle()}
          </div>
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
};

export default WorksTab;
