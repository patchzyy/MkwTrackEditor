import { useCallback, useRef } from 'react';
import type { CreateIssue } from '../../../lib/create/types';
import type { CreateSession } from '../session/types';
import type { CreateTools } from '../tools/useCreateTools';
import './../create-tools.css';
import { ConflictBanner } from './ConflictBanner';
import { CoachMarks } from './CoachMarks';
import { CreateToolbar } from './CreateToolbar';
import { HealthChip } from './HealthChip';
import { HintStrip } from './HintStrip';

const BRUSH_TOOLS: Record<string, 'paintRadius' | 'sculptRadius' | 'sceneryRadius'> = { paint: 'paintRadius', sculpt: 'sculptRadius', scenery: 'sceneryRadius' };

export function brushReadout(radius: number): string {
  return `Brush ${radius >= 1000 ? `${(radius / 1000).toFixed(1).replace(/\.0$/, '')}k` : radius}`;
}

/**
 * Everything Create mode draws over the viewport: the floating tool bar, the hint strip under it,
 * the health chip (bottom left) and the first-run tour. Pointer events fall through everywhere
 * except on the controls themselves.
 */
export function CreateChrome({ session, tools, showConflicts = false }: { session: CreateSession; tools: CreateTools; showConflicts?: boolean }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hasDesign = !!session.project;
  const brushKey = BRUSH_TOOLS[tools.activeTool];

  const showMe = useCallback(
    (issue: CreateIssue) => {
      if (!issue.target) return;
      session.select([issue.target]);
      tools.frameSelection([issue.target]);
    },
    [session, tools],
  );

  if (!hasDesign) return null;
  const noRoads = session.project!.roads.length === 0;

  return (
    <div ref={rootRef} className="crChrome">
      <div className="crTopStack">
        <CreateToolbar
          activeTool={tools.activeTool}
          onSelectTool={tools.setTool}
          topView={tools.topView}
          onToggleTopView={tools.toggleTopView}
        />
        {/* A design with no road gets exactly one thing to read: how to start one. */}
        {noRoads && tools.activeTool !== 'road' ? (
          <button type="button" className="crNudge" onClick={() => tools.setTool('road')} data-create-action="start-road">
            Press <kbd className="uiKbd">R</kbd> or click Road to draw your first road
          </button>
        ) : (
          <HintStrip tool={tools.activeTool} hint={tools.hint} brushLabel={brushKey ? brushReadout(tools.brush[brushKey]) : null} />
        )}
      </div>
      {tools.showGrid && (
        <div className="crScaleChip" data-create-scale>
          <i aria-hidden="true" />
          One square is about 2 seconds of driving
        </div>
      )}
      {!noRoads && <HealthChip issues={session.issues} busy={session.compiling} hasDesign={hasDesign && !!session.geometry} onShowMe={showMe} />}
      {showConflicts && <ConflictBanner conflicts={session.conflicts} onResolve={session.resolveConflicts} />}
      <CoachMarks active={hasDesign && !!session.geometry && !session.gestureActive} layerRef={rootRef} />
    </div>
  );
}
