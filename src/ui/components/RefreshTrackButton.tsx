import { RefreshCw } from 'lucide-react';
import { Button } from './Button';

/** The one place the Refresh shortcut is written down, so the button and the sheet agree. */
export const REFRESH_TRACK_SHORTCUT = 'Ctrl+Alt+R';

export interface RefreshTrackButtonProps {
  onRefresh: () => void;
  /** True while a rebuild is running: the button disables itself and the icon spins. */
  refreshing: boolean;
  /** False when no track is loaded, so the button explains itself instead of doing nothing. */
  hasTrack: boolean;
  /** `false` for the compact icon-only form used inside viewport overlays. */
  showLabel?: boolean;
  className?: string;
}

/**
 * "Refresh track": builds the 3D viewport again from the track as it is in memory.
 *
 * Most edits show up immediately because they are swapped into the running scene, but some cannot
 * be — a material on a model the viewport never loaded, a replaced texture of a different size, a
 * whole archive that changed. This is the button that always works. It keeps the camera where it
 * is and takes a moment on a big track.
 */
export function RefreshTrackButton({ onRefresh, refreshing, hasTrack, showLabel = true, className }: RefreshTrackButtonProps) {
  return (
    <Button
      variant="ghost"
      size={showLabel ? 'md' : 'sm'}
      className={className ? `uiRefreshButton ${className}` : 'uiRefreshButton'}
      icon={<RefreshCw size={showLabel ? 15 : 13} className={refreshing ? 'uiRefreshSpin' : undefined} />}
      tooltip="Rebuild the viewport from the track as it is now, so every edit is visible"
      shortcut={REFRESH_TRACK_SHORTCUT}
      disabledReason={hasTrack ? 'Already rebuilding the track' : 'Open a track first'}
      disabled={!hasTrack || refreshing}
      aria-label="Refresh track"
      data-refresh-track={refreshing ? 'busy' : 'idle'}
      onClick={onRefresh}
    >
      {showLabel ? (refreshing ? 'Refreshing' : 'Refresh') : null}
    </Button>
  );
}
