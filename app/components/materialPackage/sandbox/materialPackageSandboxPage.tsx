import { FolderSimpleIcon, ImageIcon } from "@phosphor-icons/react";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import ChatSpaceSidebar from "@/components/chat/space/chatSpaceSidebar";
import DiscoverArchivedSpacesView from "@/components/chat/discover/discoverArchivedSpacesView";

type TreeNode =
  | { type: "folder"; id: string; name: string; depth: number }
  | { type: "file"; id: string; name: string; depth: number };

type DockHintKind = "top" | "middle" | "bottom";

interface DockHint {
  index: number;
  kind: DockHintKind;
  text: string;
}

const EMPTY_SPACES: any[] = [];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isInsideRect(x: number, y: number, rect: DOMRect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function computeInsertHint(clientY: number, rows: HTMLElement[]): DockHint {
  if (rows.length === 0) {
    return { index: 0, kind: "top", text: "插入到顶部" };
  }

  const rects = rows.map(row => row.getBoundingClientRect());
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const mid = r.top + r.height / 2;
    if (clientY < mid) {
      if (i === 0) {
        return { index: 0, kind: "top", text: "插入到顶部" };
      }
      return { index: i, kind: "middle", text: "插入到这里" };
    }
  }

  return { index: rows.length, kind: "bottom", text: "插入到底部" };
}

export default function MaterialPackageSandboxPage() {
  const treeNodes = useMemo<TreeNode[]>(() => {
    return [
      { type: "folder", id: "pack", name: "素材箱示例", depth: 0 },
      { type: "folder", id: "scene", name: "场景", depth: 1 },
      { type: "file", id: "warm", name: "温馨小屋", depth: 2 },
      { type: "file", id: "scene-img", name: "61874825_p0_master1200.jpg", depth: 2 },
      { type: "folder", id: "music", name: "音乐", depth: 1 },
      { type: "file", id: "bgm", name: "阴森BGM", depth: 2 },
      { type: "folder", id: "text", name: "文本", depth: 1 },
      { type: "file", id: "narration", name: "旁白模板", depth: 2 },
    ];
  }, []);

  const mainRef = useRef<HTMLDivElement | null>(null);
  const dockZoneRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const floatRef = useRef<HTMLDivElement | null>(null);
  const floatHeadRef = useRef<HTMLDivElement | null>(null);

  const [showHints, setShowHints] = useState(true);
  const [docked, setDocked] = useState(false);
  const [dockIndex, setDockIndex] = useState(0);
  const [dockHint, setDockHint] = useState<DockHint | null>(null);

  const [isFloatOpen, setIsFloatOpen] = useState(false);
  const [floatPos, setFloatPos] = useState({ x: 120, y: 80 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const draggingFloatRef = useRef(false);

  const [insertLineTop, setInsertLineTop] = useState<number | null>(null);
  const [insertTipTop, setInsertTipTop] = useState<number | null>(null);
  const [insertTipText, setInsertTipText] = useState("");

  const [embedDragging, setEmbedDragging] = useState(false);
  const embedPointerIdRef = useRef<number | null>(null);

  const getDockRows = useCallback(() => {
    const treeEl = treeRef.current;
    if (!treeEl) {
      return [];
    }
    return Array.from(treeEl.querySelectorAll<HTMLElement>("[data-role='row'],[data-role='embed']"));
  }, []);

  const dockToIndex = useCallback((nextIndex: number) => {
    setDocked(true);
    setDockIndex(nextIndex);
    setDockHint(null);
    setInsertLineTop(null);
    setInsertTipTop(null);
    setIsFloatOpen(false);
  }, []);

  const undockToMain = useCallback((clientX: number, clientY: number) => {
    const mainEl = mainRef.current;
    if (!mainEl) {
      setDocked(false);
      setIsFloatOpen(true);
      return;
    }

    const rect = mainEl.getBoundingClientRect();
    setDocked(false);
    setIsFloatOpen(true);
    setDockHint(null);
    setInsertLineTop(null);
    setInsertTipTop(null);
    setFloatPos({
      x: clamp(clientX - rect.left - 120, 8, Math.max(8, rect.width - 420)),
      y: clamp(clientY - rect.top - 24, 8, Math.max(8, rect.height - 160)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!dockHint || !showHints) {
      setInsertLineTop(null);
      setInsertTipTop(null);
      return;
    }
    const zone = dockZoneRef.current;
    const rows = getDockRows();
    if (!zone) {
      return;
    }
    const zoneRect = zone.getBoundingClientRect();
    let y = zoneRect.top + 10;
    const index = clamp(dockHint.index, 0, rows.length);
    if (dockHint.kind === "bottom" && rows.length > 0) {
      const lastRect = rows[rows.length - 1].getBoundingClientRect();
      y = lastRect.bottom + 1;
    }
    else if (dockHint.kind === "top" && rows.length > 0) {
      const firstRect = rows[0].getBoundingClientRect();
      y = firstRect.top;
    }
    else if (rows[index]) {
      const rect = rows[index].getBoundingClientRect();
      y = rect.top;
    }

    const localY = y - zoneRect.top;
    setInsertLineTop(Math.max(8, localY - 1));
    setInsertTipTop(Math.max(6, localY - 18));
    setInsertTipText(`${dockHint.text}（${index}/${rows.length}）`);
  }, [dockHint, getDockRows, showHints]);

  const updateDockHintFromPointer = useCallback((clientX: number, clientY: number) => {
    const zone = dockZoneRef.current;
    const treeEl = treeRef.current;
    if (!zone || !treeEl) {
      setDockHint(null);
      return;
    }
    const zoneRect = zone.getBoundingClientRect();
    if (!isInsideRect(clientX, clientY, zoneRect)) {
      setDockHint(null);
      return;
    }
    const rows = getDockRows();
    const hint = computeInsertHint(clientY, rows);
    setDockHint(hint);
  }, [getDockRows]);

  const setFloatPosFromClient = useCallback((clientX: number, clientY: number) => {
    const mainEl = mainRef.current;
    const floatEl = floatRef.current;
    if (!mainEl || !floatEl) {
      return;
    }
    const rect = mainEl.getBoundingClientRect();
    const offset = dragOffsetRef.current;
    const x = clientX - rect.left - offset.x;
    const y = clientY - rect.top - offset.y;
    const maxX = rect.width - floatEl.offsetWidth - 12;
    const maxY = rect.height - floatEl.offsetHeight - 12;
    setFloatPos({
      x: clamp(x, 8, Math.max(8, maxX)),
      y: clamp(y, 8, Math.max(8, maxY)),
    });
  }, []);

  useEffect(() => {
    const head = floatHeadRef.current;
    if (!head) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!draggingFloatRef.current) {
        return;
      }
      setFloatPosFromClient(event.clientX, event.clientY);
      updateDockHintFromPointer(event.clientX, event.clientY);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!draggingFloatRef.current) {
        return;
      }
      draggingFloatRef.current = false;
      head.releasePointerCapture(event.pointerId);

      const zone = dockZoneRef.current;
      if (!zone) {
        setDockHint(null);
        return;
      }
      const zoneRect = zone.getBoundingClientRect();
      if (!isInsideRect(event.clientX, event.clientY, zoneRect)) {
        setDockHint(null);
        return;
      }

      const rows = getDockRows();
      const hint = computeInsertHint(event.clientY, rows);
      dockToIndex(hint.index);
    };

    head.addEventListener("pointermove", onPointerMove);
    head.addEventListener("pointerup", onPointerUp);
    head.addEventListener("pointercancel", onPointerUp);
    return () => {
      head.removeEventListener("pointermove", onPointerMove);
      head.removeEventListener("pointerup", onPointerUp);
      head.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dockToIndex, getDockRows, setFloatPosFromClient, updateDockHintFromPointer]);

  const openPreviewForNode = useCallback((node: TreeNode) => {
    if (node.type !== "file") {
      return;
    }
    setDocked(false);
    setIsFloatOpen(true);
    setDockHint(null);
    setInsertLineTop(null);
    setInsertTipTop(null);
  }, []);

  const handleFloatHeadPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement | null)?.closest("button")) {
      return;
    }
    const floatEl = floatRef.current;
    if (!floatEl) {
      return;
    }
    event.preventDefault();

    draggingFloatRef.current = true;
    floatHeadRef.current?.setPointerCapture(event.pointerId);

    const rect = floatEl.getBoundingClientRect();
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const handleEmbedPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement | null)?.closest("button")) {
      return;
    }

    embedPointerIdRef.current = event.pointerId;
    setEmbedDragging(true);
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
  }, []);

  const handleEmbedPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!embedDragging) {
      return;
    }
    setEmbedDragging(false);
    embedPointerIdRef.current = null;

    const mainEl = mainRef.current;
    if (!mainEl) {
      return;
    }
    const rect = mainEl.getBoundingClientRect();
    if (isInsideRect(event.clientX, event.clientY, rect)) {
      undockToMain(event.clientX, event.clientY);
    }
  }, [embedDragging, undockToMain]);

  const renderedRows = useMemo(() => {
    const rows: React.ReactNode[] = [];
    const embedNode = docked
      ? (
          <div
            key="embed"
            data-role="embed"
            className={`mx-2 my-1 rounded-md border border-base-300 bg-base-100/70 px-2 py-2 shadow-sm ${embedDragging ? "opacity-80" : ""}`}
            onPointerDown={handleEmbedPointerDown}
            onPointerUp={handleEmbedPointerUp}
            onPointerCancel={handleEmbedPointerUp}
            style={{ touchAction: "none" }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className="badge badge-xs bg-base-200 border border-base-300">预览</span>
                  <span className="truncate">素材箱示例 / 场景</span>
                </div>
                <div className="mt-1 text-[11px] text-base-content/60 truncate">
                  内嵌预览：可拖到右侧工作区恢复为浮窗
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square"
                  onClick={() => undockToMain(300, 120)}
                  aria-label="打开浮窗"
                >
                  ↗
                </button>
              </div>
            </div>
          </div>
        )
      : null;

    const insertAt = clamp(dockIndex, 0, treeNodes.length);
    for (let i = 0; i < treeNodes.length; i++) {
      if (embedNode && i === insertAt) {
        rows.push(embedNode);
      }
      const node = treeNodes[i];
      rows.push(
        <div
          key={node.id}
          data-role="row"
          className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-base-content/90 hover:bg-base-300/50"
          style={{ paddingLeft: 8 + node.depth * 14 }}
          onDoubleClick={() => openPreviewForNode(node)}
        >
          {node.type === "folder"
            ? <FolderSimpleIcon className="size-4 opacity-80" />
            : <ImageIcon className="size-4 opacity-80" />}
          <div className="min-w-0 truncate">{node.name}</div>
        </div>,
      );
    }
    if (embedNode && insertAt >= treeNodes.length) {
      rows.push(embedNode);
    }
    return rows;
  }, [dockIndex, docked, embedDragging, handleEmbedPointerDown, handleEmbedPointerUp, openPreviewForNode, treeNodes, undockToMain]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex h-full shrink-0">
        <ChatSpaceSidebar
          isPrivateChatMode={false}
          isDiscoverMode={false}
          spaces={EMPTY_SPACES}
          activeSpaceId={null}
          getSpaceUnreadMessagesNumber={() => 0}
          privateUnreadMessagesNumber={0}
          onOpenPrivate={() => {}}
          onSelectSpace={() => {}}
          onCreateSpace={() => {}}
          onSpaceContextMenu={() => {}}
        />
      </div>

      <aside className="w-[320px] shrink-0 border-r border-gray-300 dark:border-gray-700 bg-base-200">
        <div className="flex h-12 items-center justify-between border-b border-gray-300 dark:border-gray-700 px-3">
          <div className="min-w-0 truncate font-semibold">我的素材包</div>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setShowHints(prev => !prev)}
          >
            {showHints ? "隐藏提示" : "显示提示"}
          </button>
        </div>

        <div className="relative h-[calc(100%-3rem)] overflow-auto px-2 py-3" ref={dockZoneRef}>
          <div className="mb-3">
            <div className="px-2 pb-2 text-[11px] font-semibold tracking-wider text-base-content/50">OPEN PREVIEWS</div>
          </div>

          <div className="mb-2">
            <div className="px-2 pb-2 text-[11px] font-semibold tracking-wider text-base-content/50">TUAN-CHAT</div>
            <div ref={treeRef} className="relative">
              {renderedRows}
            </div>
          </div>

          {showHints && insertLineTop != null && (
            <div
              className="pointer-events-none absolute left-2 right-2 h-0.5 rounded bg-info"
              style={{ top: insertLineTop }}
            />
          )}
          {showHints && insertTipTop != null && (
            <div
              className="pointer-events-none absolute left-2 rounded-md border border-base-300 bg-base-100/80 px-2 py-0.5 text-[11px] text-base-content/80 backdrop-blur"
              style={{ top: insertTipTop }}
            >
              {insertTipText}
            </div>
          )}
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 bg-base-200" ref={mainRef}>
        <div className="h-full w-full overflow-hidden">
          <DiscoverArchivedSpacesView mode="square" />
        </div>

        {isFloatOpen && !docked && (
          <section
            ref={floatRef}
            className="absolute z-50 min-w-[520px] max-w-[calc(100%-24px)] overflow-hidden rounded-md border border-base-300 bg-base-100 shadow-2xl"
            style={{ left: floatPos.x, top: floatPos.y }}
          >
            <div
              ref={floatHeadRef}
              className="flex h-9 items-center justify-between gap-2 border-b border-base-300 bg-base-200 px-2"
              onPointerDown={handleFloatHeadPointerDown}
              style={{ touchAction: "none" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="px-2 py-1 text-xs text-base-content/80">项目：无标题</div>
                <div className="text-sm font-semibold truncate">素材箱：素材箱示例</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => dockToIndex(0)}
                >
                  插入顶部
                </button>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => dockToIndex(treeNodes.length)}
                >
                  插入底部
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square"
                  onClick={() => setIsFloatOpen(false)}
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="p-3 text-sm text-base-content/70">
              双击左侧任意“文件”打开预览浮窗；拖动浮窗标题栏到左侧目录可显示插入提示线并合并。
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

