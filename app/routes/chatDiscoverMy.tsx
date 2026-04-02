import type { Route } from "./+types/chatDiscoverMy";

import DiscoverPage from "@/components/chat/discover/discoverPage";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "发现" },
    { name: "description", content: "发现 · 仓库归档" },
  ];
}

export default function ChatDiscoverMyRoute() {
  return (
    <div className="bg-base-200 h-full w-full overflow-y-auto overflow-x-visible">
      <DiscoverPage mode="my" archiveTab="repositories" />
    </div>
  );
}
