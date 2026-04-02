import type { Route } from "./+types/chatDiscoverMyMaterialPackages";

import DiscoverPage from "@/components/chat/discover/discoverPage";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "发现" },
    { name: "description", content: "发现 · 素材包归档" },
  ];
}

export default function ChatDiscoverMyMaterialPackagesRoute() {
  return (
    <div className="bg-base-200 h-full w-full overflow-y-auto overflow-x-visible">
      <DiscoverPage mode="my" archiveTab="materialPackages" />
    </div>
  );
}
