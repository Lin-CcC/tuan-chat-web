import type { MaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";

import React, { useMemo } from "react";
import { Link, useNavigate } from "react-router";

import { useGlobalContext } from "@/components/globalContextProvider";
import { ContentCard } from "@/components/repository/home/RepositoryHome";

interface UserMaterialPackagesListProps {
  userId: number;
  packages: MaterialPackageRecord[];
  totalRecords: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

const UserMaterialPackagesList: React.FC<UserMaterialPackagesListProps> = ({
  userId,
  packages,
  totalRecords,
  isLoading,
  isError,
  onRetry,
}) => {
  const navigate = useNavigate();
  const currentUserId = useGlobalContext().userId ?? -1;

  const items = useMemo(() => {
    const list = Array.isArray(packages) ? packages : [];
    return list
      .filter((pkg) => pkg && Number(pkg.packageId) > 0)
      .map((pkg) => ({
        id: `user-material-package-${pkg.packageId}`,
        packageId: pkg.packageId,
        title: pkg.name,
        image: pkg.coverUrl ?? undefined,
        content: pkg.description ?? "",
        createTime: pkg.createTime,
      }));
  }, [packages]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {Array.from({ length: 8 }, (_, i) => `skeleton-${i}`).map((key) => (
          <div key={key} className="animate-pulse">
            <div className="bg-base-300 aspect-square rounded-none mb-4"></div>
            <div className="h-4 bg-base-300 rounded mb-2"></div>
            <div className="h-3 bg-base-300 rounded mb-1"></div>
            <div className="h-3 bg-base-300 rounded w-2/3"></div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-10 rounded-lg">
        <div className="text-error text-lg mb-2">加载失败</div>
        <div className="text-base-content/60 text-sm mb-4">请稍后再试</div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onRetry}
        >
          重新加载
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-10 rounded-lg">
        {currentUserId === userId ? (
          <div className="w-full flex flex-col items-center justify-center text-gray-500 gap-2 mt-8">
            <Link
              to="/chat/material-package"
              className="w-12 h-12 flex items-center justify-center rounded-full bg-blue-100 text-blue-500 hover:bg-blue-200 transition-colors duration-200"
              aria-label="去创建素材包"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </Link>
            <p className="text-center leading-snug text-sm mt-2">
              还没有创建素材包呢…
              <br />
              先从整理你的灵感开始吧！
            </p>
          </div>
        ) : (
          <p className="text-gray-500">
            这里还没有他的素材包...也许正在整理中...
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {items.map((pkg) => (
          <ContentCard
            key={pkg.id}
            title={pkg.title}
            image={pkg.image}
            content={pkg.content}
            type="mixed"
            createTime={pkg.createTime}
            onClick={() => {
              // 目前没有单独的“素材包详情”路由；先复用现有素材包页面入口。
              navigate("/chat/material-package", {
                state: {
                  from: "profileWorks",
                  packageId: pkg.packageId,
                  userId,
                },
              });
            }}
          />
        ))}
      </div>

      {totalRecords > items.length && (
        <div className="mt-6 text-sm text-base-content/60">
          当前仅展示 {items.length} 个素材包
        </div>
      )}
    </>
  );
};

export default UserMaterialPackagesList;
