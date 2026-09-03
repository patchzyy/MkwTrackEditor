import {
  Boxes,
  Download,
  Keyboard,
  Map as MapIcon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Redo2,
  Route,
  Undo2,
  Video,
} from 'lucide-react';
import type { MutableRefObject } from 'react';
import { Button, IconButton } from '../components/Button';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import { ToolbarSeparator } from '../components/Toolbar';
import type { EditorModeStub } from '../state/types';
import { FileMenu } from './FileMenu';
import type { RecentTrack } from './recentFiles';

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<EditorModeStub>> = [
  { value: 'kmp', label: 'KMP', icon: <Route size={14} />, tooltip: 'Track data: routes, checkpoints, objects, areas' },
  { value: 'camera', label: 'Camera', icon: <Video size={14} />, tooltip: 'Cameras: replay and opening camera setup' },
  { value: 'model', label: 'Model', icon: <Boxes size={14} />, tooltip: 'Course geometry: meshes, bones and imports' },
  { value: 'visual', label: 'Visual', icon: <MapIcon size={14} />, tooltip: 'Look of the track: materials, effects, lighting' },
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
  onChangeEditorMode,
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
  onChangeEditorMode: (mode: EditorModeStub) => void;
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
          <span className="topBarTrackName" title={trackName}>
            {trackName}
          </span>
        )}
      </div>

      <div className="topBarCenter">
        <SegmentedControl label="Editor mode" value={editorMode} options={MODE_OPTIONS} onChange={onChangeEditorMode} />
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
        <IconButton icon={<Keyboard size={15} />} tooltip="Keyboard shortcuts" shortcut="?" onClick={onShowShortcuts} />
        <Button
          variant="primary"
          icon={<Download size={15} />}
          tooltip="Export track"
          shortcut="Ctrl+S"
          disabledReason="Export needs a loaded track"
          disabled={!canExport}
          onClick={onExport}
        >
          Export
        </Button>
      </div>
    </header>
  );
}
