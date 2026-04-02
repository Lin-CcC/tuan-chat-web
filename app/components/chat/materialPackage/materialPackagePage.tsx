import { useGetUserActiveSpacesQuery } from "api/hooks/chatQueryHooks";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import ChatPageLayout from "@/components/chat/chatPageLayout";
import { SpaceContext } from "@/components/chat/core/spaceContext";
import useChatPageContextMenus from "@/components/chat/hooks/useChatPageContextMenus";
import useChatPageLeftDrawer from "@/components/chat/hooks/useChatPageLeftDrawer";
import useChatPageNavigation from "@/components/chat/hooks/useChatPageNavigation";
import useChatPageOrdering from "@/components/chat/hooks/useChatPageOrdering";
import useChatPageSpaceContextMenu from "@/components/chat/hooks/useChatPageSpaceContextMenu";
import useChatUnreadIndicators from "@/components/chat/hooks/useChatUnreadIndicators";
import ChatSpaceSidebar from "@/components/chat/space/chatSpaceSidebar";
import SpaceContextMenu from "@/components/chat/space/contextMenu/spaceContextMenu";
import { useDrawerPreferenceStore } from "@/components/chat/stores/drawerPreferenceStore";
import { useLocalStorage } from "@/components/common/customHooks/useLocalStorage";
import { useScreenSize } from "@/components/common/customHooks/useScreenSize";
import { useGlobalContext } from "@/components/globalContextProvider";
import MaterialPackageNavPanel from "@/components/chat/materialPackage/materialPackageNavPanel";
import MaterialPackageSquareView from "@/components/chat/materialPackage/materialPackageSquareView";
import MaterialPreviewFloat from "@/components/chat/materialPackage/materialPreviewFloat";
import {
  getMaterialPreviewDragData,
  getMaterialPreviewDragOrigin,
} from "@/components/chat/materialPackage/materialPackageDnd";

const EMPTY_ARRAY: never[] = [];

export default function MaterialPackagePage() {
  const screenSize = useScreenSize();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParam] = useSearchParams();
  const globalContext = useGlobalContext();
  const userId = globalContext.userId ?? -1;

  const initialFocus = useMemo(() => {
    const parseId = (value: unknown) => {
      const next = Number(value);
      return Number.isFinite(next) && next > 0 ? Math.floor(next) : null;
    };

    const state = (location.state ?? {}) as any;
    const stateAuthorUserId = parseId(state?.userId);
    const statePackageId = parseId(state?.packageId);

    const queryAuthorUserId = parseId(searchParam.get("authorUserId"));
    const queryPackageId = parseId(searchParam.get("packageId"));

    return {
      authorUserId: stateAuthorUserId ?? queryAuthorUserId,
      packageId: statePackageId ?? queryPackageId,
    };
  }, [location.state, searchParam]);
  const [storedIds, setStoredChatIds] = useLocalStorage<{
    spaceId?: number | null;
    roomId?: number | null;
  }>("storedChatIds", {});
  const activeSpaceId = useMemo(() => {
    const id = storedIds?.spaceId;
    return typeof id === "number" && Number.isFinite(id) ? id : null;
  }, [storedIds?.spaceId]);

  const { isOpenLeftDrawer, toggleLeftDrawer, closeLeftDrawer } =
    useChatPageLeftDrawer({
      screenSize,
      isPrivateChatMode: false,
      mobileStateKey: "chat-material-package",
    });

  const userSpacesQuery = useGetUserActiveSpacesQuery();
  const spaces = userSpacesQuery.data?.data ?? EMPTY_ARRAY;
  const {
    orderedSpaces,
    orderedSpaceIds,
    setUserSpaceOrder,
    spaceRoomIdsByUser,
  } = useChatPageOrdering({
    userId,
    activeSpaceId,
    isPrivateChatMode: false,
    spaces,
    rooms: EMPTY_ARRAY,
  });

  const { unreadMessagesNumber, privateEntryBadgeCount } =
    useChatUnreadIndicators({
      globalContext,
      userId,
      isPrivateChatMode: false,
      activeRoomId: null,
    });

  const getSpaceUnreadMessagesNumber = useCallback(
    (spaceId: number) => {
      const roomIds =
        spaceRoomIdsByUser[String(userId)]?.[String(spaceId)] ?? [];
      let result = 0;
      for (const roomId of roomIds) {
        result += unreadMessagesNumber[roomId] ?? 0;
      }
      return result;
    },
    [spaceRoomIdsByUser, unreadMessagesNumber, userId],
  );

  const { handleOpenPrivate, setActiveRoomId, setActiveSpaceId } =
    useChatPageNavigation({
      activeSpaceId,
      isOpenLeftDrawer,
      navigate,
      screenSize,
      searchParam,
      setStoredChatIds,
    });

  const { spaceContextMenu, handleSpaceContextMenu, closeSpaceContextMenu } =
    useChatPageContextMenus();
  const { isSpaceContextArchived, isSpaceContextOwner } =
    useChatPageSpaceContextMenu({
      currentUserId: globalContext.userId,
      spaceContextMenu,
      spaces,
    });

  const handleCreateSpace = useCallback(() => {
    navigate("/chat?addSpacePop=true");
  }, [navigate]);
  const activeSpace = useMemo(() => {
    if (activeSpaceId == null) return null;
    return spaces.find((space) => space.spaceId === activeSpaceId) ?? null;
  }, [activeSpaceId, spaces]);
  const spaceContextValue = useMemo(() => {
    return {
      spaceId: activeSpaceId ?? undefined,
      isSpaceOwner: Boolean(
        activeSpace && activeSpace.userId === globalContext.userId,
      ),
      setActiveSpaceId,
      setActiveRoomId,
      toggleLeftDrawer,
      spaceMembers: EMPTY_ARRAY,
    };
  }, [
    activeSpace,
    activeSpaceId,
    globalContext.userId,
    setActiveRoomId,
    setActiveSpaceId,
    toggleLeftDrawer,
  ]);

  const chatLeftPanelWidth = useDrawerPreferenceStore(
    (state) => state.chatLeftPanelWidth,
  );
  const setChatLeftPanelWidth = useDrawerPreferenceStore(
    (state) => state.setChatLeftPanelWidth,
  );

  const leftDrawerToggleLabel = isOpenLeftDrawer ? "收起侧边栏" : "展开侧边栏";
  const shouldShowLeftDrawerToggle = screenSize === "sm";

  const mainRef = useRef<HTMLDivElement | null>(null);
  const [activePreview, setActivePreview] =
    useState<ReturnType<typeof getMaterialPreviewDragData>>(null);
  const [dockedPreview, setDockedPreview] =
    useState<ReturnType<typeof getMaterialPreviewDragData>>(null);
  const [dockedIndex, setDockedIndex] = useState<number>(0);
  const [previewHintPos, setPreviewHintPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [showMainDropPreview, setShowMainDropPreview] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as any;
      setShowMainDropPreview(Boolean(detail?.visible));
    };
    window.addEventListener(
      "tc:material-package:main-drop-preview",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "tc:material-package:main-drop-preview",
        handler as EventListener,
      );
  }, []);

  const openPreview = useCallback(
    (
      payload: ReturnType<typeof getMaterialPreviewDragData>,
      hintPosition?: { x: number; y: number } | null,
    ) => {
      if (!payload) return;
      setActivePreview(payload);
      setPreviewHintPos(hintPosition ?? null);
      if (screenSize === "sm") closeLeftDrawer();
    },
    [closeLeftDrawer, screenSize],
  );

  const dockPreview = useCallback(
    (
      payload: ReturnType<typeof getMaterialPreviewDragData>,
      options?: { index?: number; placement?: "top" | "bottom" },
    ) => {
      if (!payload) return;
      setDockedPreview(payload);
      if (
        typeof options?.index === "number" &&
        Number.isFinite(options.index)
      ) {
        setDockedIndex(Math.max(0, Math.floor(options.index)));
      } else if (options?.placement === "bottom") {
        setDockedIndex(Number.MAX_SAFE_INTEGER);
      } else {
        setDockedIndex(0);
      }
      setActivePreview(null);
      setPreviewHintPos(null);
    },
    [],
  );

  const undockPreview = useCallback(() => {
    setDockedPreview(null);
  }, []);

  const handleDropToMain = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setShowMainDropPreview(false);
      const payload = getMaterialPreviewDragData(event.dataTransfer);
      if (!payload) return;
      const origin = getMaterialPreviewDragOrigin(event.dataTransfer);
      if (origin === "docked") {
        undockPreview();
      }

      const el = mainRef.current;
      if (!el) {
        openPreview(payload, null);
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      openPreview(payload, { x: Math.max(8, x - 80), y: Math.max(8, y - 16) });
    },
    [openPreview, undockPreview],
  );

  const mainContent = (
    <div
      ref={mainRef}
      className="relative w-full h-full"
      data-role="material-package-main-zone"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={handleDropToMain}
    >
      <div className="w-full h-full">
        <MaterialPackageSquareView
          activeSpaceId={activeSpaceId}
          spaces={orderedSpaces}
          onSelectSpace={setActiveSpaceId}
          initialAuthorUserId={initialFocus.authorUserId}
          initialPackageId={initialFocus.packageId}
        />
      </div>

      {activePreview && (
        <MaterialPreviewFloat
          payload={activePreview}
          onClose={() => setActivePreview(null)}
          onDock={dockPreview}
          initialPosition={previewHintPos}
        />
      )}

      {showMainDropPreview && (
        <div className="pointer-events-none absolute inset-0 z-[80] rounded-md border border-info/30 bg-info/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset] backdrop-blur-[1px]" />
      )}
    </div>
  );

  return (
    <SpaceContext value={spaceContextValue}>
      <>
        <ChatPageLayout
          screenSize={screenSize}
          isOpenLeftDrawer={isOpenLeftDrawer}
          shouldShowLeftDrawerToggle={shouldShowLeftDrawerToggle}
          leftDrawerToggleLabel={leftDrawerToggleLabel}
          toggleLeftDrawer={toggleLeftDrawer}
          chatLeftPanelWidth={chatLeftPanelWidth}
          setChatLeftPanelWidth={setChatLeftPanelWidth}
          spaceSidebar={
            <ChatSpaceSidebar
              isPrivateChatMode={false}
              isDiscoverMode={false}
              isMaterialPackageMode
              spaces={orderedSpaces}
              spaceOrderIds={orderedSpaceIds}
              onReorderSpaceIds={setUserSpaceOrder}
              activeSpaceId={activeSpaceId}
              getSpaceUnreadMessagesNumber={getSpaceUnreadMessagesNumber}
              privateUnreadMessagesNumber={privateEntryBadgeCount}
              onOpenPrivate={handleOpenPrivate}
              onSelectSpace={setActiveSpaceId}
              onCreateSpace={handleCreateSpace}
              onSpaceContextMenu={handleSpaceContextMenu}
              onToggleLeftDrawer={toggleLeftDrawer}
              isLeftDrawerOpen={isOpenLeftDrawer}
            />
          }
          sidePanelContent={
            <MaterialPackageNavPanel
              onCloseLeftDrawer={closeLeftDrawer}
              onToggleLeftDrawer={toggleLeftDrawer}
              isLeftDrawerOpen={isOpenLeftDrawer}
              dockedPreview={dockedPreview}
              dockedIndex={dockedIndex}
              onDockPreview={dockPreview}
              onMoveDockedPreview={(nextIndex) => setDockedIndex(nextIndex)}
              onUndockPreview={undockPreview}
              onOpenPreview={(payload, hintPosition) =>
                openPreview(payload, hintPosition)
              }
            />
          }
          mainContent={mainContent}
        />
        <SpaceContextMenu
          contextMenu={spaceContextMenu}
          isSpaceOwner={isSpaceContextOwner}
          isArchived={isSpaceContextArchived}
          onClose={closeSpaceContextMenu}
        />
      </>
    </SpaceContext>
  );
}
