import { FolderOpen, MousePointerClick, Pencil, Route, Sparkles, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

export interface WelcomeOverlayProps {
  /** Opens the file picker. */
  onOpenTrack: () => void;
  /** The most recently opened track that can actually be re-opened, if there is one. */
  recentTrackName?: string | null;
  onOpenRecent?: () => void;
  /** Switches to Create mode and opens the new-track wizard. */
  onCreateTrack?: () => void;
  /** The newest Create design, when there is one: carry on where you left off. */
  createContinue?: { name: string; onOpen: () => void };
}

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="uiWelcomeStep">
      <span className="uiWelcomeStepIcon" aria-hidden="true">
        {icon}
      </span>
      <span className="uiWelcomeStepText">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </li>
  );
}

/**
 * First-run panel over the empty viewport. It answers the only question a new user has — "what do
 * I do first?" — in three steps, and puts the one button that starts everything under the cursor.
 */
export function WelcomeOverlay({ onOpenTrack, recentTrackName, onOpenRecent, onCreateTrack, createContinue }: WelcomeOverlayProps) {
  return (
    <div className="uiWelcomeScrim" data-welcome="empty">
      <section className="uiWelcomePanel" aria-label="Getting started">
        <span className="uiWelcomeMark" aria-hidden="true">
          <Route size={22} />
        </span>
        <h1 className="uiWelcomeTitle">{onCreateTrack ? 'Open a Mario Kart Wii track, or build a new one' : 'Open a Mario Kart Wii track to start'}</h1>
        <p className="uiWelcomeLead">
          Drop a course archive anywhere in this window, or pick one below. Everything you change stays in the browser
          until you export it again.
        </p>
        <ol className="uiWelcomeSteps">
          <Step icon={<Upload size={15} />} title="1. Open a course">
            A <code>.szs</code> file from a track pack or from your own build. Drag and drop works too.
          </Step>
          <Step icon={<MousePointerClick size={15} />} title="2. Pick a mode">
            KMP for the race layout, Camera for the intro shots, Model for geometry, Visual and Material for how it
            looks.
          </Step>
          <Step icon={<FolderOpen size={15} />} title="3. Export when you are happy">
            Export writes a playable <code>.szs</code>. The editor checks it for you first.
          </Step>
        </ol>
        <div className="uiWelcomeActions">
          {onCreateTrack && (
            <Button variant="primary" icon={<Sparkles size={15} />} onClick={onCreateTrack} data-welcome-action="create">
              Create a new track
            </Button>
          )}
          <Button variant="primary" icon={<Upload size={15} />} onClick={onOpenTrack}>
            Open a track
          </Button>
          {createContinue && (
            <Button variant="ghost" icon={<Pencil size={15} />} onClick={createContinue.onOpen} data-welcome-action="continue-create">
              Continue "{createContinue.name}"
            </Button>
          )}
          {recentTrackName && onOpenRecent && (
            <Button variant="ghost" icon={<FolderOpen size={15} />} onClick={onOpenRecent}>
              {recentTrackName}
            </Button>
          )}
        </div>
        <p className="uiWelcomeHint">
          Press <kbd>?</kbd> at any time for the keyboard shortcuts.
        </p>
      </section>
    </div>
  );
}
