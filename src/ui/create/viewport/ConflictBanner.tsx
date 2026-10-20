import { TriangleAlert } from 'lucide-react';
import type { CreateConflict } from '../session/types';
import { Button } from '../../components/Button';

/** Joins "checkpoints and routes", "the course model" into one readable phrase. */
export function describeConflicts(conflicts: readonly CreateConflict[]): string {
  const unique = [...new Set(conflicts.map((c) => c.what))];
  if (unique.length === 0) return 'the track';
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/**
 * "You changed checkpoints in KMP mode. [Keep my changes] [Rebuild from the design]". The session
 * chrome (`SessionBanners`) shows the same message; this is the standalone version for hosts that
 * lay the viewport chrome out themselves.
 */
export function ConflictBanner({ conflicts, onResolve }: { conflicts: readonly CreateConflict[]; onResolve: (choice: 'keep' | 'rebuild') => void }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="crBanner" role="alertdialog" aria-label="Changes made in another mode" data-create-conflict-banner>
      <TriangleAlert size={16} />
      <div className="crBannerText">
        <strong>You changed {describeConflicts(conflicts)} in another mode.</strong>
        <span>Keep your changes, or rebuild everything from your design (that replaces them).</span>
      </div>
      <Button onClick={() => onResolve('keep')}>Keep my changes</Button>
      <Button variant="primary" onClick={() => onResolve('rebuild')}>
        Rebuild from the design
      </Button>
    </div>
  );
}
