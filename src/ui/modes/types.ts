import type { ComponentProps, Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from 'react';
import type { EditorProjectState } from '../../lib/brresEditor';
import type { KmpEntity } from '../../lib/kmp';
import type { TrackIssue } from '../../lib/kmpValidation';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { TrackDocument } from '../../lib/track';
import type { Noclip3DViewport, TransformTool, ViewMode } from '../Noclip3DViewport';
import type { ObjectOption } from '../objects/objectCatalog';
import type { EditorModeStub } from '../state/types';
import type { PlaytestSession } from '../playtest/usePlaytestSession';
import type { OpenModelStudio } from '../studio/studioLaunch';
import type { useClipboard } from '../state/useClipboard';
import type { useEditorHistory } from '../state/useEditorHistory';
import type { useKmpEditActions } from '../state/useKmpEditActions';
import type { useSelection } from '../state/useSelection';

export type ViewportProps = ComponentProps<typeof Noclip3DViewport>;

/**
 * Everything a mode needs from the shell. Modes never reach into `App.tsx`; they read this
 * context and return a `ModeUi` describing the panels and viewport props they want.
 */
export interface EditorModeContext {
  editorMode: EditorModeStub;
  track: TrackDocument | null;
  trackRef: MutableRefObject<TrackDocument | null>;
  projectState: EditorProjectState | null;
  objFlow: CommonResourceArchive['objFlow'] | null;
  commonArchive: CommonResourceArchive | null;
  commonBrresSummaries: Record<string, NoclipBrresSummary>;
  selection: ReturnType<typeof useSelection>;
  history: ReturnType<typeof useEditorHistory>;
  editActions: ReturnType<typeof useKmpEditActions>;
  clipboard: ReturnType<typeof useClipboard>;
  selected: KmpEntity | null;
  selectedEntities: KmpEntity[];
  /** The shared property sheet for `selected`, already bound to `editActions`. */
  selectedInspector: ReactNode;
  /** Pre-export validation for the loaded track, recomputed on every edit. */
  validation: TrackIssue[];
  /** Every placeable object type, for the object pickers. */
  objectOptions: ObjectOption[];
  /** True when the whole selection is objects, so a batch type swap is meaningful. */
  canBatchReplaceObjects: boolean;
  entityLabel: (entity: KmpEntity) => string;
  setStatus: Dispatch<SetStateAction<string>>;
  tool: TransformTool;
  viewMode: ViewMode;
  setEditorMode: (mode: EditorModeStub) => void;
  /**
   * "Refresh track": rebuilds the viewport from the track as it is now. Modes that edit archive
   * bytes (materials, textures) offer it where the edit happens, because a live hot swap cannot
   * always apply. Does nothing while a rebuild is already running or no track is loaded.
   */
  refreshScene: () => void;
  /** True while a `refreshScene` rebuild is in flight, so buttons can disable themselves. */
  sceneRefreshing: boolean;
  /**
   * Opens the Model Studio — the full-window workspace for one model's shaders and animations.
   * Passing a track archive path opens that archive with its edits wired back into the track.
   */
  openModelStudio?: OpenModelStudio;
  /** The playtest session (Create mode starts it from its Test drive button). */
  playtest: PlaytestSession;
  /**
   * Opens a track from bytes, exactly like dropping a file. `sourceId` fixes the document's
   * identity so later in-place updates do not rebuild the scene. Resolves `true` when it opened.
   */
  openTrackBytes: (bytes: Uint8Array, fileName: string, options?: { sourceId?: string }) => Promise<boolean>;
  /** Replaces the loaded track document without a history step (Create mode's compile result). */
  applyGeneratedTrack: (next: TrackDocument) => void;
  /** The Create mode "New track" wizard, owned by the shell so the welcome screen can open it. */
  createWizard: { open: boolean; setOpen: (open: boolean) => void };
}

/** What a mode wants the global keyboard handler to do. Stable object; methods read fresh state. */
export interface ModeShortcuts {
  undo: () => void;
  redo: () => void;
  deleteSelection: () => void;
  testDrive?: () => void;
  /**
   * Any other key (tool letters, `[`/`]`, Escape...). Return true when handled. The shell has
   * already skipped text inputs, playtest and Ctrl/Alt-modified keys it owns.
   */
  onKey?: (event: KeyboardEvent) => boolean;
  /**
   * True when the mode's active tool wants this key even though it is also a global command
   * (Backspace while drawing a road takes a point back; it must not delete the selection). The
   * shell then skips its own handling and offers the key to `onKey`.
   */
  ownsKey?: (event: KeyboardEvent) => boolean;
}

/** What a mode wants the shell to ask before Export writes a file that may not work. */
export interface ExportGuard {
  /** One plain sentence per problem. */
  problems: string[];
  /** Jump to the first problem ("Show me"). */
  showMe?: () => void;
}

/** The top bar's Test drive button (shown in place of the Playtest popover). */
export interface ModeTestDrive {
  start: () => void;
  disabledReason: string | null;
  busy: boolean;
}

/**
 * The bottom dock's size and collapse state, handed to a mode that replaces the content browser
 * with a panel of its own. Exactly the props `ContentBrowser` takes, so the two are interchangeable.
 */
export interface ModeBottomDock {
  open: boolean;
  height: number;
  collapsedHeight: number;
  resizing: boolean;
  onBeginResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onResetSize: () => void;
  onToggleOpen: () => void;
}

/** What a mode contributes to the shell layout. Every field is optional. */
export interface ModeUi {
  /**
   * Replaces the docks *and* the viewport with a full workspace while set (Create mode's home
   * screen). The viewport stays mounted underneath so leaving the workspace is instant.
   */
  workspace?: ReactNode;
  /** Rendered in the viewport's full-viewport overlay layer (floating tool bar, hints, banners). */
  viewportOverlay?: ReactNode;
  /** Mode keyboard handling (undo/redo/delete/tools); see `ModeShortcuts`. */
  shortcuts?: ModeShortcuts;
  /** Shows the big green Test drive button in the top bar; hides Refresh and Model Studio. */
  testDrive?: ModeTestDrive;
  /** Runs synchronously before Export, e.g. to flush a pending compile into the track document. */
  prepareExport?: () => void;
  /** Asked at Export: a non-null answer makes the shell confirm first ("Your track has 4 problems..."). */
  exportGuard?: () => ExportGuard | null;
  /** Why Export is unavailable right now (no design open), or null. */
  exportDisabledReason?: string | null;
  /**
   * Offered by the welcome screen of any mode: carry on with the newest Create design. Returned
   * even while Create mode is not the active mode.
   */
  resumeCreate?: { name: string; open: () => void };
  /** Replaces the left "Place Assets" rail while the mode is active. */
  leftPanel?: ReactNode;
  /** Replaces the inspector body (object/track tabs) while the mode is active. */
  inspector?: ReactNode;
  /** Extra props spread onto the viewport (mode, callbacks, overlays). Applied last, so they win. */
  viewportProps?: Partial<ViewportProps>;
  /** Overlay rendered in the viewport's top-right stack. */
  topRightOverlay?: ReactNode;
  /**
   * Replaces the content browser in the bottom dock while the mode is active. The shell keeps
   * owning the dock's size and collapse state and passes them in, so a mode panel resizes exactly
   * like the browser and the browser comes back untouched when the mode is left.
   */
  bottomDock?: (dock: ModeBottomDock) => ReactNode;
}
