import type { Route } from "./+types/chatDiscoverMyRoles";

import DiscoverPage from "@/components/chat/discover/discoverPage";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "发现" },
    { name: "description", content: "发现 · 人物归档" },
  ];
}

export default function ChatDiscoverMyRolesRoute() {
  return (
    <div className="bg-base-200 h-full w-full overflow-y-auto overflow-x-visible">
      <DiscoverPage mode="my" archiveTab="roles" />
    </div>
  );
}
