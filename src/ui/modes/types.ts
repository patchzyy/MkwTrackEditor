import type { ComponentProps, Dispatch, MutableRefObject, ReactNode, SetStateAction } from 'react';
import type { EditorProjectState } from '../../lib/brresEditor';
import type { KmpEntity } from '../../lib/kmp';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { TrackDocument } from '../../lib/track';
import type { Noclip3DViewport, TransformTool, ViewMode } from '../Noclip3DViewport';
import type { EditorModeStub } from '../state/types';
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
  selected: KmpEntity | null;
  selectedEntities: KmpEntity[];
  entityLabel: (entity: KmpEntity) => string;
  setStatus: Dispatch<SetStateAction<string>>;
  tool: TransformTool;
  viewMode: ViewMode;
  setEditorMode: (mode: EditorModeStub) => void;
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
}
