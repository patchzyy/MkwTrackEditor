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
