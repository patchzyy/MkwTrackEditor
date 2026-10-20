import { Check, CircleAlert, CloudOff, Hammer, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/Button';
import type { CreateSession, SaveState } from './types';

const SAVE_TEXT: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving...',
  unsaved: 'Saving soon...',
  error: 'Not saved',
};

/** The small "Saved" pill: reassurance that closing the tab loses nothing. */
export function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className={`createSavePill is-${state}`} role="status" aria-live="polite" title={state === 'error' ? 'Your browser would not save this track. Export a design file to keep a copy.' : 'Your track is saved in this browser as you work.'}>
      {state === 'saved' ? <Check size={12} strokeWidth={3} /> : state === 'error' ? <CloudOff size={12} /> : <LoaderCircle size={12} className="createSpin" />}
      {SAVE_TEXT[state]}
    </span>
  );
}

/**
 * The messages that belong to the session rather than to a tool: the track is being built,
 * something failed, or a file was changed in another mode ("Keep my changes" / "Rebuild").
 */
export function SessionBanners({ session }: { session: CreateSession }) {
  const { conflicts, compileError, kitError, compiling, project } = session;
  const building = !!project && compiling && !compileError;
  return (
    <div className="createBanners">
      {conflicts.length > 0 && (
        <div className="createBanner createBanner--warning" role="alertdialog" aria-label="Changes made in another mode" data-create-conflict>
          <TriangleAlert size={16} />
          <div className="createBannerText">
            <strong>You changed {joinWhat(conflicts.map((c) => c.what))} in another mode.</strong>
            <span>Keep your changes, or rebuild everything from your design (that replaces them).</span>
          </div>
          <Button onClick={() => session.resolveConflicts('keep')} data-create-action="keep-changes">
            Keep my changes
          </Button>
          <Button variant="primary" onClick={() => session.resolveConflicts('rebuild')} data-create-action="rebuild">
            Rebuild from the design
          </Button>
        </div>
      )}
      {compileError && (
        <div className="createBanner createBanner--error" role="alert">
          <CircleAlert size={16} />
          <div className="createBannerText">
            <strong>Something went wrong</strong>
            <span>{compileError}</span>
          </div>
        </div>
      )}
      {kitError && !compileError && (
        <div className="createBanner createBanner--error" role="alert">
          <CircleAlert size={16} />
          <div className="createBannerText">
            <strong>Create mode is missing its building blocks</strong>
            <span>{kitError}</span>
          </div>
          <Button onClick={session.retryKit}>Try again</Button>
        </div>
      )}
      {building && !session.geometry && (
        <div className="createBanner" role="status">
          <Hammer size={16} />
          <div className="createBannerText">
            <strong>Building your track...</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function joinWhat(parts: string[]): string {
  const unique = [...new Set(parts)];
  if (unique.length <= 1) return unique[0] ?? 'the track';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}
