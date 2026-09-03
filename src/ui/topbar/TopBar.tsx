import {
  Boxes,
  Download,
  Keyboard,
  Map as MapIcon,
  PanelBottom,
  Palette,
  PanelLeft,
  PanelRight,
  Redo2,
  Route,
  Undo2,
  Video,
} from 'lucide-react';
import type { MutableRefObject, ReactNode } from 'react';
import { Button, IconButton } from '../components/Button';
import { RefreshTrackButton } from '../components/RefreshTrackButton';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import { ToolbarSeparator } from '../components/Toolbar';
import type { EditorModeStub } from '../state/types';
import { FileMenu } from './FileMenu';
import type { RecentTrack } from './recentFiles';

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<EditorModeStub>> = [
  { value: 'kmp', label: 'KMP', icon: <Route size={14} />, tooltip: 'Lay out the race: driving routes, checkpoints, start points, objects and areas.' },
  { value: 'camera', label: 'Camera', icon: <Video size={14} />, tooltip: 'Set up the cameras the game flies: the opening pan, replays and the character-select shot.' },
  { value: 'model', label: 'Model', icon: <Boxes size={14} />, tooltip: 'Change the course geometry: move, hide, duplicate or delete a mesh, and place new scenery.' },
  { value: 'visual', label: 'Visual', icon: <MapIcon size={14} />, tooltip: 'Change how the track looks: textures, animations, fog, bloom and lighting.' },
  { value: 'material', label: 'Material', icon: <Palette size={14} />, tooltip: 'Author one surface at a time: its texture layers, colours, blending and its shader graph.' },
];

/**
 * Editor header. Left: brand, File menu and history. Centre: the editor-mode switch.
 * Right: dock visibility, help and Export.
 *
 * The status line used to live here; it is now the bottom status bar.
 */
export function TopBar({
  topBarRef,
  historyState,
  editorMode,
  inspectorOpen,
  leftDockOpen,
  browserOpen,
  canExport,
  trackName,
  recentTracks,
  onOpenFiles,
  onImportCommonArchive,
  onOpenRecent,
  onClearRecent,
  onUndo,
  onRedo,
  onToggleInspector,
  onToggleLeftDock,
  onToggleBrowser,
  onShowShortcuts,
  onExport,
  onRefreshTrack,
  refreshingTrack,
  unsavedChanges,
  onChangeEditorMode,
  playtestControl,
}: {
  topBarRef: MutableRefObject<HTMLElement | null>;
  historyState: { undo: number; redo: number };
  editorMode: EditorModeStub;
  inspectorOpen: boolean;
  leftDockOpen: boolean;
  browserOpen: boolean;
  canExport: boolean;
  trackName: string | null;
  recentTracks: RecentTrack[];
  onOpenFiles: (files: FileList | null) => void;
  onImportCommonArchive: (files: FileList | null) => void;
  onOpenRecent: (entry: RecentTrack) => void;
  onClearRecent: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleInspector: () => void;
  onToggleLeftDock: () => void;
  onToggleBrowser: () => void;
  onShowShortcuts: () => void;
  onExport: () => void;
  /** Rebuilds the 3D viewport from the track as it is now. */
  onRefreshTrack: () => void;
  refreshingTrack: boolean;
  /** True when the track has edits that have not been exported yet. */
  unsavedChanges: boolean;
  onChangeEditorMode: (mode: EditorModeStub) => void;
  /** The Playtest button and its start popover, rendered next to the editor-mode switch. */
  playtestControl?: ReactNode;
}) {
  return (
    <header ref={topBarRef} className="topBar">
      <div className="topBarLeft">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">
            <Route size={15} />
          </span>
          <strong className="brandName">MKW Track Editor</strong>
        </div>
        <FileMenu
          canExport={canExport}
          recentTracks={recentTracks}
          onOpenFiles={onOpenFiles}
          onImportCommonArchive={onImportCommonArchive}
          onExport={onExport}
          onOpenRecent={onOpenRecent}
          onClearRecent={onClearRecent}
        />
        <ToolbarSeparator />
        <IconButton
          icon={<Undo2 size={15} />}
          tooltip="Undo"
          shortcut="Ctrl+Z"
          disabledReason="Nothing to undo"
          disabled={historyState.undo === 0}
          onClick={onUndo}
        />
        <IconButton
          icon={<Redo2 size={15} />}
          tooltip="Redo"
          shortcut="Ctrl+Shift+Z"
          disabledReason="Nothing to redo"
          disabled={historyState.redo === 0}
          onClick={onRedo}
        />
        {trackName && (
          <span className={unsavedChanges ? 'topBarTrackName hasUnsavedChanges' : 'topBarTrackName'} title={unsavedChanges ? `${trackName} - edited, not exported yet` : trackName}>
            {trackName}
            {unsavedChanges && <span className="topBarUnsavedDot" role="img" aria-label="Edited since the last export" />}
          </span>
        )}
      </div>

      <div className="topBarCenter">
        <SegmentedControl label="Editor mode" value={editorMode} options={MODE_OPTIONS} onChange={onChangeEditorMode} />
        {playtestControl}
      </div>

      <div className="topBarRight">
        <IconButton
          icon={<PanelLeft size={15} />}
          tooltip={leftDockOpen ? 'Hide left panel' : 'Show left panel'}
          active={leftDockOpen}
          onClick={onToggleLeftDock}
        />
        <IconButton
          icon={<PanelBottom size={15} />}
          tooltip={browserOpen ? 'Hide content browser' : 'Show content browser'}
          active={browserOpen}
          onClick={onToggleBrowser}
        />
        <IconButton
          icon={<PanelRight size={15} />}
          tooltip={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
          aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
          active={inspectorOpen}
          onClick={onToggleInspector}
        />
        <ToolbarSeparator />
        <RefreshTrackButton onRefresh={onRefreshTrack} refreshing={refreshingTrack} hasTrack={canExport} />
        <IconButton icon={<Keyboard size={15} />} tooltip="Keyboard shortcuts" shortcut="?" onClick={onShowShortcuts} />
        <Button
          variant="primary"
          icon={<Download size={15} />}
          tooltip={unsavedChanges ? 'Save your edits as a playable .szs' : 'Save the track as a playable .szs'}
          shortcut="Ctrl+S"
          disabledReason="Export needs a loaded track"
          disabled={!canExport}
          onClick={onExport}
        >
          Export
          {unsavedChanges && <span className="topBarUnsavedDot" aria-hidden="true" />}
        </Button>
      </div>
    </header>
  );
}
