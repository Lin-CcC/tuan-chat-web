import type { Route } from "./+types/chatMaterialPackage";

import MaterialPackageSandboxPage from "@/components/materialPackage/sandbox/materialPackageSandboxPage";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "我的素材包" },
    { name: "description", content: "我的素材包" },
  ];
}

export default function ChatMaterialPackageRoute() {
  return (
    <div className="bg-base-200 h-full w-full overflow-hidden">
      <div className="fixed right-3 top-3 z-[9999] rounded-md border border-error/40 bg-error/10 px-2 py-1 text-xs font-semibold text-error">
        SANDBOX /chat/material-package 已加载（2026-03-29）
      </div>
      <MaterialPackageSandboxPage />
    </div>
  );
}
