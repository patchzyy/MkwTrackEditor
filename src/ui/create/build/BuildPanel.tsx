import { ArrowLeft, Layers as LayersIcon, Redo2, Undo2 } from 'lucide-react';
import { Button, IconButton } from '../../components/Button';
import { Panel, PanelHeader } from '../../components/Panel';
import type { CreateSession } from '../session/types';
import type { CreateTools } from '../tools/useCreateTools';
import '../create-tools.css';
import './build.css';
import { Checklist } from './Checklist';
import { LayersTree } from './LayersTree';

/**
 * The left "Build" dock: the checklist of what makes a race track, then the Layers outliner.
 */
export function BuildPanel({ session, tools }: { session: CreateSession; tools: CreateTools }) {
  return (
    <aside className="placeAssetsPanel createMode crBuild" data-create-slot="build">
      <Panel>
        <PanelHeader
          title="Build"
          subtitle={session.project?.name}
          actions={
            <>
              <IconButton icon={<Undo2 size={14} />} tooltip={session.undoLabel ? `Undo: ${session.undoLabel}` : 'Undo'} shortcut="Ctrl+Z" disabled={!session.canUndo} disabledReason="Nothing to undo" variant="ghost" size="sm" onClick={session.undo} />
              <IconButton icon={<Redo2 size={14} />} tooltip={session.redoLabel ? `Redo: ${session.redoLabel}` : 'Redo'} shortcut="Ctrl+Shift+Z" disabled={!session.canRedo} disabledReason="Nothing to redo" variant="ghost" size="sm" onClick={session.redo} />
            </>
          }
        />
        <div className="crBuildBody">
          <Checklist session={session} tools={tools} />
          <div className="crLayers">
            <h3 className="crSectionTitle">
              <LayersIcon size={12} aria-hidden="true" /> Layers
            </h3>
            <div className="crLayersTree">
              <LayersTree session={session} tools={tools} />
            </div>
          </div>
          <div className="crBuildFoot">
            <Button icon={<ArrowLeft size={14} />} variant="ghost" onClick={session.closeProject} data-create-action="my-tracks">
              My tracks
            </Button>
          </div>
        </div>
      </Panel>
    </aside>
  );
}
