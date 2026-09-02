import { Box, Download, FolderOpen, PanelRightClose, PanelRightOpen, Redo2, Undo2 } from 'lucide-react';
import type { MutableRefObject } from 'react';
import type { EditorModeStub } from '../state/types';

/** Editor header: file commands, undo/redo, inspector toggle, export, status and mode switch. */
export function TopBar({
  topBarRef,
  historyState,
  status,
  editorMode,
  inspectorOpen,
  canExport,
  onOpenFiles,
  onImportCommonArchive,
  onUndo,
  onRedo,
  onToggleInspector,
  onExport,
  onChangeEditorMode,
}: {
  topBarRef: MutableRefObject<HTMLElement | null>;
  historyState: { undo: number; redo: number };
  status: string;
  editorMode: EditorModeStub;
  inspectorOpen: boolean;
  canExport: boolean;
  onOpenFiles: (files: FileList | null) => void;
  onImportCommonArchive: (files: FileList | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleInspector: () => void;
  onExport: () => void;
  onChangeEditorMode: (mode: EditorModeStub) => void;
}) {
  return (
    <header ref={topBarRef} className="topBar">
      <div className="brand">
        <Box size={18} />
        <strong>MKW Track Editor</strong>
      </div>
      <label className="button">
        <FolderOpen size={16} />
        Open .szs
        <input hidden type="file" accept=".szs" onChange={(event) => onOpenFiles(event.currentTarget.files)} />
      </label>
      <label className="button" title="Import Common.szs once and keep it in this browser">
        <FolderOpen size={16} />
        Import Common.szs
        <input
          hidden
          type="file"
          accept=".szs"
          onChange={(event) => {
            onImportCommonArchive(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
      </label>
      <button className="button buttonIconOnly" disabled={historyState.undo === 0} onClick={onUndo} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">
        <Undo2 size={16} />
      </button>
      <button className="button buttonIconOnly" disabled={historyState.redo === 0} onClick={onRedo} title="Redo (Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y)" aria-label="Redo">
        <Redo2 size={16} />
      </button>
      <button
        className={inspectorOpen ? 'button active' : 'button'}
        onClick={onToggleInspector}
        title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
        aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
      >
        {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        Inspector
      </button>
      <button className="button primary" disabled={!canExport} onClick={onExport} title="Export track (Ctrl/Cmd+S)">
        <Download size={16} />
        Export
      </button>
      <span className="status">{status}</span>
      <div className="topBarModeGroup" role="group" aria-label="Editor mode">
        <span className="topBarModeLabel">Mode</span>
        <button className={editorMode === 'model' ? 'button active' : 'button'} type="button" onClick={() => onChangeEditorMode('model')}>
          Model
        </button>
        <button className={editorMode === 'visual' ? 'button active' : 'button'} type="button" onClick={() => onChangeEditorMode('visual')}>
          Visual
        </button>
        <button className={editorMode === 'kmp' ? 'button active' : 'button'} type="button" onClick={() => onChangeEditorMode('kmp')}>
          KMP
        </button>
        <button className={editorMode === 'camera' ? 'button active' : 'button'} type="button" onClick={() => onChangeEditorMode('camera')}>
          Camera
        </button>
      </div>
    </header>
  );
}
