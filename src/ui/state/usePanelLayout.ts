import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

export const CONTENT_BROWSER_COLLAPSED_HEIGHT = 46;
const CONTENT_BROWSER_DEFAULT_HEIGHT = 248;
const CONTENT_BROWSER_MIN_HEIGHT = 140;
const WORKSPACE_MIN_HEIGHT = 160;
const PLACE_ASSETS_COLLAPSED_WIDTH = 52;
// Wide enough for the KMP outliner's deepest rows (section > group > point) to stay readable.
const PLACE_ASSETS_DEFAULT_WIDTH = 268;
const PLACE_ASSETS_MIN_WIDTH = 160;
const INSPECTOR_DEFAULT_WIDTH = 320;
const INSPECTOR_MIN_WIDTH = 220;
const WORKSPACE_MIN_VIEWPORT_WIDTH = 320;

export type SidebarSide = 'placeAssets' | 'inspector';

/** Dock sizes, collapse state and the drag-to-resize handles for the editor shell. */
export function usePanelLayout() {
  const [browserOpen, setBrowserOpen] = useState(true);
  const [browserHeight, setBrowserHeight] = useState(CONTENT_BROWSER_DEFAULT_HEIGHT);
  const [browserResizing, setBrowserResizing] = useState(false);
  const [placeAssetsOpen, setPlaceAssetsOpen] = useState(true);
  const [placeAssetsWidth, setPlaceAssetsWidth] = useState(PLACE_ASSETS_DEFAULT_WIDTH);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState<SidebarSide | null>(null);

  const appShellRef = useRef<HTMLElement | null>(null);
  const shellBodyRef = useRef<HTMLDivElement | null>(null);
  const topBarRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const browserResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const sidebarResizeRef = useRef<{ side: SidebarSide; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = browserResizeRef.current;
      const shell = appShellRef.current;
      if (!resize || !shell) return;
      const topBarHeight = topBarRef.current?.getBoundingClientRect().height ?? 48;
      const maxHeight = Math.max(
        CONTENT_BROWSER_MIN_HEIGHT,
        Math.floor(shell.getBoundingClientRect().height - topBarHeight - WORKSPACE_MIN_HEIGHT),
      );
      const nextHeight = Math.max(
        CONTENT_BROWSER_MIN_HEIGHT,
        Math.min(maxHeight, Math.round(resize.startHeight + (resize.startY - event.clientY))),
      );
      setBrowserOpen(true);
      setBrowserHeight(nextHeight);
    };

    const stopResize = () => {
      if (!browserResizeRef.current) return;
      browserResizeRef.current = null;
      setBrowserResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = sidebarResizeRef.current;
      const workspace = workspaceRef.current;
      const shellBody = shellBodyRef.current;
      if (!resize || !workspace) return;
      const minWidth = resize.side === 'placeAssets' ? PLACE_ASSETS_MIN_WIDTH : INSPECTOR_MIN_WIDTH;
      const availableWidth = resize.side === 'placeAssets'
        ? workspace.getBoundingClientRect().width
        : (shellBody?.getBoundingClientRect().width ?? workspace.getBoundingClientRect().width + (inspectorOpen ? inspectorWidth : 0));
      const maxWidth = resize.side === 'placeAssets'
        ? Math.max(minWidth, Math.floor(availableWidth - WORKSPACE_MIN_VIEWPORT_WIDTH))
        : Math.max(
            minWidth,
            Math.floor(availableWidth - (placeAssetsOpen ? placeAssetsWidth : PLACE_ASSETS_COLLAPSED_WIDTH) - WORKSPACE_MIN_VIEWPORT_WIDTH),
          );
      const rawWidth = resize.side === 'placeAssets'
        ? resize.startWidth + (event.clientX - resize.startX)
        : resize.startWidth + (resize.startX - event.clientX);
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(rawWidth)));
      if (resize.side === 'placeAssets') {
        setPlaceAssetsOpen(true);
        setPlaceAssetsWidth(nextWidth);
      } else {
        setInspectorOpen(true);
        setInspectorWidth(nextWidth);
      }
    };

    const stopResize = () => {
      if (!sidebarResizeRef.current) return;
      sidebarResizeRef.current = null;
      setSidebarResizing(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [inspectorOpen, inspectorWidth, placeAssetsOpen, placeAssetsWidth]);

  useEffect(() => {
    if (!browserResizing && !sidebarResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = browserResizing ? 'ns-resize' : 'ew-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [browserResizing, sidebarResizing]);

  function beginBrowserResize(event: ReactPointerEvent<HTMLElement>) {
    browserResizeRef.current = {
      startY: event.clientY,
      startHeight: browserOpen ? browserHeight : CONTENT_BROWSER_COLLAPSED_HEIGHT,
    };
    setBrowserOpen(true);
    setBrowserResizing(true);
  }

  function beginSidebarResize(side: SidebarSide, event: ReactPointerEvent<HTMLElement>) {
    sidebarResizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'placeAssets' ? placeAssetsWidth : inspectorWidth,
    };
    if (side === 'placeAssets') setPlaceAssetsOpen(true);
    else setInspectorOpen(true);
    setSidebarResizing(side);
  }

  const workspaceStyle = {
    '--place-assets-width': `${placeAssetsOpen ? placeAssetsWidth : PLACE_ASSETS_COLLAPSED_WIDTH}px`,
    '--inspector-width': `${inspectorOpen ? inspectorWidth : 0}px`,
  } as CSSProperties;

  return {
    appShellRef,
    shellBodyRef,
    topBarRef,
    workspaceRef,
    browserOpen,
    setBrowserOpen,
    browserHeight,
    browserResizing,
    placeAssetsOpen,
    setPlaceAssetsOpen,
    inspectorOpen,
    setInspectorOpen,
    beginBrowserResize,
    beginSidebarResize,
    workspaceStyle,
  };
}
