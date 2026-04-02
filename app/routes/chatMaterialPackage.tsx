import type { Route } from "./+types/chatMaterialPackage";

import MaterialPackagePage from "@/components/chat/materialPackage/materialPackagePage";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "我的素材包" },
    { name: "description", content: "我的素材包 · 局外素材库" },
  ];
}

export default function ChatMaterialPackageRoute() {
  return (
    <div className="bg-base-200 h-full w-full overflow-y-auto overflow-x-visible">
      <MaterialPackagePage />
    </div>
  );
}

