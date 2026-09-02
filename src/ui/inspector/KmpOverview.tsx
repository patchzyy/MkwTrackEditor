import type { KmpDocument } from '../../lib/kmp';
import { friendlySectionLabel } from '../labels';

export function KmpOverview({ kmp, onSelect }: { kmp: KmpDocument; onSelect: (id: string, options?: { additive?: boolean }) => void }) {
  const stage = kmp.entities.find((entity) => entity.section === 'STGI');
  return (
    <>
      <h2>Track Graphs</h2>
      <div className="propertyGrid">
        {stage && (
          <label>
            Track Settings
            <button className="inlineAction" type="button" onClick={(event) => onSelect(stage.id, { additive: event.shiftKey })}>
              Track settings
            </button>
          </label>
        )}
        {kmp.pathGraphs.map((graph) => (
          <label key={graph.groupSection}>
            {friendlySectionLabel(graph.pointSection)}
            <span>
              {graph.groups.length} path groups · {graph.edges.length} connections
            </span>
          </label>
        ))}
        <label>
          Object Routes
          <span>
            {kmp.routes.length} routes · {kmp.routes.reduce((sum, route) => sum + route.points.length, 0)} points
          </span>
        </label>
      </div>
    </>
  );
}
