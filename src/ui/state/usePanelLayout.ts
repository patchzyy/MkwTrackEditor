import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

/** Height of the content browser when it is collapsed to just its header strip. */
export const CONTENT_BROWSER_COLLAPSED_HEIGHT = 30;
/** Width the left/right docks keep when collapsed to an icon rail. */
export const DOCK_RAIL_WIDTH = 40;

const CONTENT_BROWSER_DEFAULT_HEIGHT = 260;
const CONTENT_BROWSER_MIN_HEIGHT = 150;
const WORKSPACE_MIN_HEIGHT = 180;
const PLACE_ASSETS_DEFAULT_WIDTH = 232;
const PLACE_ASSETS_MIN_WIDTH = 180;
const INSPECTOR_DEFAULT_WIDTH = 340;
const INSPECTOR_MIN_WIDTH = 260;
const WORKSPACE_MIN_VIEWPORT_WIDTH = 320;

const STORAGE_KEY = 'mkw.editor.layout.v1';

export type SidebarSide = 'placeAssets' | 'inspector';

interface PersistedLayout {
  browserOpen: boolean;
  browserHeight: number;
  placeAssetsOpen: boolean;
  placeAssetsWidth: number;
  inspectorOpen: boolean;
  inspectorWidth: number;
}

const DEFAULT_LAYOUT: PersistedLayout = {
  browserOpen: true,
  browserHeight: CONTENT_BROWSER_DEFAULT_HEIGHT,
  placeAssetsOpen: true,
  placeAssetsWidth: PLACE_ASSETS_DEFAULT_WIDTH,
  inspectorOpen: true,
  inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Reads the persisted dock layout, ignoring anything malformed or out of range. */
function readStoredLayout(): PersistedLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<PersistedLayout>;
    return {
      browserOpen: typeof parsed.browserOpen === 'boolean' ? parsed.browserOpen : DEFAULT_LAYOUT.browserOpen,
      browserHeight: Number.isFinite(parsed.browserHeight)
        ? clamp(Number(parsed.browserHeight), CONTENT_BROWSER_MIN_HEIGHT, 900)
        : DEFAULT_LAYOUT.browserHeight,
      placeAssetsOpen: typeof parsed.placeAssetsOpen === 'boolean' ? parsed.placeAssetsOpen : DEFAULT_LAYOUT.placeAssetsOpen,
      placeAssetsWidth: Number.isFinite(parsed.placeAssetsWidth)
        ? clamp(Number(parsed.placeAssetsWidth), PLACE_ASSETS_MIN_WIDTH, 720)
        : DEFAULT_LAYOUT.placeAssetsWidth,
      inspectorOpen: typeof parsed.inspectorOpen === 'boolean' ? parsed.inspectorOpen : DEFAULT_LAYOUT.inspectorOpen,
      inspectorWidth: Number.isFinite(parsed.inspectorWidth)
        ? clamp(Number(parsed.inspectorWidth), INSPECTOR_MIN_WIDTH, 720)
        : DEFAULT_LAYOUT.inspectorWidth,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/**
 * Dock sizes, collapse state and drag-to-resize handles for the editor shell.
 *
 * Sizes and collapse flags are persisted to `localStorage` so the workspace comes back the
 * way the user left it. Collapsed docks keep a slim rail instead of disappearing, so
 * collapsing never reflows the viewport contents.
 */
export function usePanelLayout() {
  const initial = useMemo(readStoredLayout, []);
  const [browserOpen, setBrowserOpen] = useState(initial.browserOpen);
  const [browserHeight, setBrowserHeight] = useState(initial.browserHeight);
  const [browserResizing, setBrowserResizing] = useState(false);
  const [placeAssetsOpen, setPlaceAssetsOpen] = useState(initial.placeAssetsOpen);
  const [placeAssetsWidth, setPlaceAssetsWidth] = useState(initial.placeAssetsWidth);
  const [inspectorOpen, setInspectorOpen] = useState(initial.inspectorOpen);
  const [inspectorWidth, setInspectorWidth] = useState(initial.inspectorWidth);
  const [sidebarResizing, setSidebarResizing] = useState<SidebarSide | null>(null);

  const appShellRef = useRef<HTMLElement | null>(null);
  const shellBodyRef = useRef<HTMLDivElement | null>(null);
  const topBarRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const browserResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const sidebarResizeRef = useRef<{ side: SidebarSide; startX: number; startWidth: number } | null>(null);

  // Persist on every settled change. Cheap enough that debouncing is not worth the code.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const layout: PersistedLayout = { browserOpen, browserHeight, placeAssetsOpen, placeAssetsWidth, inspectorOpen, inspectorWidth };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Private-mode / quota failures must never break the editor.
    }
  }, [browserHeight, browserOpen, inspectorOpen, inspectorWidth, placeAssetsOpen, placeAssetsWidth]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = browserResizeRef.current;
      const shell = appShellRef.current;
      if (!resize || !shell) return;
      const topBarHeight = topBarRef.current?.getBoundingClientRect().height ?? 44;
      const maxHeight = Math.max(
        CONTENT_BROWSER_MIN_HEIGHT,
        Math.floor(shell.getBoundingClientRect().height - topBarHeight - WORKSPACE_MIN_HEIGHT),
      );
      const nextHeight = clamp(Math.round(resize.startHeight + (resize.startY - event.clientY)), CONTENT_BROWSER_MIN_HEIGHT, maxHeight);
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
            Math.floor(availableWidth - (placeAssetsOpen ? placeAssetsWidth : DOCK_RAIL_WIDTH) - WORKSPACE_MIN_VIEWPORT_WIDTH),
          );
      const rawWidth = resize.side === 'placeAssets'
        ? resize.startWidth + (event.clientX - resize.startX)
        : resize.startWidth + (resize.startX - event.clientX);
      const nextWidth = clamp(Math.round(rawWidth), minWidth, maxWidth);
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

  /** Double-clicking a drag handle puts the dock back to its default size. */
  const resetBrowserSize = useCallback(() => {
    setBrowserOpen(true);
    setBrowserHeight(CONTENT_BROWSER_DEFAULT_HEIGHT);
  }, []);

  const resetSidebarSize = useCallback((side: SidebarSide) => {
    if (side === 'placeAssets') {
      setPlaceAssetsOpen(true);
      setPlaceAssetsWidth(PLACE_ASSETS_DEFAULT_WIDTH);
    } else {
      setInspectorOpen(true);
      setInspectorWidth(INSPECTOR_DEFAULT_WIDTH);
    }
  }, []);

  const workspaceStyle = {
    '--place-assets-width': `${placeAssetsOpen ? placeAssetsWidth : DOCK_RAIL_WIDTH}px`,
    '--inspector-width': `${inspectorOpen ? inspectorWidth : DOCK_RAIL_WIDTH}px`,
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
    placeAssetsWidth,
    inspectorOpen,
    setInspectorOpen,
    inspectorWidth,
    sidebarResizing,
    beginBrowserResize,
    beginSidebarResize,
    resetBrowserSize,
    resetSidebarSize,
    workspaceStyle,
  };
}
