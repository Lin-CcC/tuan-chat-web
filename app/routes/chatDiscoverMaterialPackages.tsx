import type { Route } from "./+types/chatDiscoverMaterialPackages";

import DiscoverPage from "@/components/chat/discover/discoverPage";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "发现" },
    { name: "description", content: "发现 · 素材包广场" },
  ];
}

export default function ChatDiscoverMaterialPackagesRoute() {
  return (
    <div className="bg-base-200 h-full w-full overflow-y-auto overflow-x-visible">
      <DiscoverPage mode="square" squareTab="materialPackages" />
    </div>
  );
}
