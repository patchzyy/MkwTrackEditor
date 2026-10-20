import { ArrowLeft, ArrowRight, Check, Minus, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { LAYOUT_TEMPLATES, type LayoutTemplate } from '../../../lib/create/templates';
import type { KitTheme } from '../../../lib/create/types';
import { Button, IconButton } from '../../components/Button';
import { kitImageUrl, themeGradient } from '../kitImages';
import { uniqueProjectName } from '../session/projectFile';
import type { CreateSession } from '../session/types';
import { TrackOutline } from './TrackOutline';

const STEPS = [
  { id: 'world', label: 'World' },
  { id: 'layout', label: 'Layout' },
  { id: 'name', label: 'Name' },
] as const;

const DEFAULT_TEMPLATE = 'oval';
const PREFERRED_THEME = 'sunny';

/** Moves a radio-card selection with the arrow keys; Enter goes on to the next step. */
export function nextRadioIndex(key: string, index: number, count: number, columns = 1): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'ArrowDown':
      return Math.min(count - 1, index + columns);
    case 'ArrowUp':
      return Math.max(0, index - columns);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * New track: three short steps. World (how it looks), Layout (the starting shape), Name and laps.
 * Everything is preselected, so Enter, Enter, Enter makes a track; every step says what it is for.
 */
export function NewTrackWizard({ session }: { session: CreateSession }) {
  if (!session.wizardOpen || typeof document === 'undefined') return null;
  return createPortal(<WizardDialog session={session} />, document.body);
}

function WizardDialog({ session }: { session: CreateSession }) {
  const { kit, kitError, projects } = session;
  const themes = kit?.catalog.themes ?? [];
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState(0);
  const [themeId, setThemeId] = useState<string>('');
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE);
  const [name, setName] = useState(() => uniqueProjectName('My track', projects.map((p) => p.name)));
  const [laps, setLaps] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselect a world once the kit is there.
  useEffect(() => {
    if (themeId || themes.length === 0) return;
    setThemeId(themes.find((t) => t.id === PREFERRED_THEME)?.id ?? themes[0].id);
  }, [themeId, themes]);

  const theme = themes.find((t) => t.id === themeId) ?? null;
  const template = LAYOUT_TEMPLATES.find((t) => t.id === templateId) ?? LAYOUT_TEMPLATES[0];
  const nameOk = name.trim().length > 0;
  const canNext = step === 0 ? !!theme : step === 1 ? true : nameOk;

  const close = () => {
    if (!busy) session.closeWizard();
  };

  const create = async () => {
    if (!theme || !nameOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.newProject(templateId, { name: name.trim(), themeId: theme.id, laps });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const advance = () => {
    if (!canNext || busy) return;
    if (step < STEPS.length - 1) setStep(step + 1);
    else void create();
  };

  // Put focus where the step's main control is.
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const target =
      step === 2
        ? root.querySelector<HTMLElement>('[data-wizard-name]')
        : root.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? root.querySelector<HTMLElement>('[role="radio"]');
    target?.focus({ preventScroll: true });
    if (step === 2) (target as HTMLInputElement | null)?.select?.();
  }, [step, themes.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement && event.target.getAttribute('role') !== 'radio')) {
      event.preventDefault();
      advance();
    }
  };

  return (
    <div className="createMode createScrim" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div
        ref={dialogRef}
        className="createWizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        data-create-wizard
        data-step={STEPS[step].id}
      >
        <header className="createWizardHead">
          <div>
            <h2 id={titleId} className="createWizardTitle">
              New track
            </h2>
            <p className="createWizardSub">
              {step === 0 && 'First, pick a world. It sets the sky, the light and what your road is made of.'}
              {step === 1 && 'Now pick a starting shape. You can reshape everything afterwards.'}
              {step === 2 && 'Last bit: give it a name and say how many laps a race has.'}
            </p>
          </div>
          <IconButton icon={<X size={16} />} tooltip="Close" shortcut="Esc" variant="ghost" onClick={close} disabled={busy} />
        </header>

        <ol className="createSteps" aria-label="Steps">
          {STEPS.map((entry, index) => (
            <li
              key={entry.id}
              className={index === step ? 'createStep is-current' : index < step ? 'createStep is-done' : 'createStep'}
              aria-current={index === step ? 'step' : undefined}
            >
              <button
                type="button"
                className="createStepButton"
                disabled={index > step || busy}
                onClick={() => setStep(index)}
                aria-label={`Step ${index + 1}: ${entry.label}`}
              >
                <span className="createStepNum">{index < step ? <Check size={12} strokeWidth={3} /> : index + 1}</span>
                <span>{entry.label}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="createWizardBody">
          {kitError ? (
            <div className="createNotice createNotice--error" role="alert">
              <div>
                <strong>The worlds could not be loaded</strong>
                <p>{kitError}</p>
              </div>
              <Button onClick={session.retryKit}>Try again</Button>
            </div>
          ) : !kit ? (
            <p className="createWizardLoading">Getting the worlds ready...</p>
          ) : step === 0 ? (
            <ThemeStep themes={themes} selected={themeId} onSelect={setThemeId} kit={kit} />
          ) : step === 1 ? (
            <LayoutStep selected={templateId} onSelect={setTemplateId} accent={theme?.accent} />
          ) : (
            <NameStep
              name={name}
              onName={setName}
              laps={laps}
              onLaps={setLaps}
              summary={`${theme?.label ?? 'World'} · ${template.label}`}
              accent={theme?.accent}
              outline={template.preview}
            />
          )}
        </div>

        <footer className="createWizardFoot">
          <div className="createWizardError" role="status">
            {error && <span>Could not create the track: {error}</span>}
          </div>
          {step > 0 && (
            <Button icon={<ArrowLeft size={14} />} onClick={() => setStep(step - 1)} disabled={busy}>
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={advance} disabled={!canNext || !kit} data-create-action="wizard-next">
              Next
              <ArrowRight size={14} />
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<Sparkles size={14} />}
              onClick={advance}
              disabled={!canNext || !kit || busy}
              disabledReason={!nameOk ? 'Give your track a name first.' : undefined}
              data-create-action="wizard-create"
            >
              {busy ? 'Creating...' : 'Create track'}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

const THEME_COLUMNS = 4;

function ThemeStep({ themes, selected, onSelect, kit }: { themes: KitTheme[]; selected: string; onSelect: (id: string) => void; kit: NonNullable<CreateSession['kit']> }) {
  return (
    <div className="createCardGrid createCardGrid--worlds" role="radiogroup" aria-label="World">
      {themes.map((theme, index) => {
        const url = kitImageUrl(kit, theme.preview);
        const isSelected = theme.id === selected;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            className={isSelected ? 'createChoice is-selected' : 'createChoice'}
            data-theme-id={theme.id}
            onClick={() => onSelect(theme.id)}
            onKeyDown={(event) => {
              const next = nextRadioIndex(event.key, index, themes.length, THEME_COLUMNS);
              if (next === null) return;
              event.preventDefault();
              onSelect(themes[next].id);
              (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}
          >
            <span className="createChoiceImage" style={{ background: themeGradient(theme.accent) }}>
              {url && <img src={url} alt="" loading="lazy" draggable={false} />}
              {isSelected && (
                <span className="createChoiceCheck" aria-hidden="true">
                  <Check size={13} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="createChoiceText">
              <strong>{theme.label}</strong>
              <span>{theme.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const TEMPLATE_COLUMNS = 3;

function LayoutStep({ selected, onSelect, accent }: { selected: string; onSelect: (id: string) => void; accent: KitTheme['accent'] | undefined }) {
  return (
    <div className="createCardGrid createCardGrid--layouts" role="radiogroup" aria-label="Starting layout">
      {LAYOUT_TEMPLATES.map((template, index) => {
        const isSelected = template.id === selected;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            className={isSelected ? 'createChoice is-selected' : 'createChoice'}
            data-template-id={template.id}
            onClick={() => onSelect(template.id)}
            onKeyDown={(event) => {
              const next = nextRadioIndex(event.key, index, LAYOUT_TEMPLATES.length, TEMPLATE_COLUMNS);
              if (next === null) return;
              event.preventDefault();
              onSelect(LAYOUT_TEMPLATES[next].id);
              (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}
          >
            <span className="createChoiceImage createChoiceImage--outline" style={{ background: themeGradient(accent) }}>
              <TrackOutline points={template.preview} emptyLabel="You draw it" />
              {isSelected && (
                <span className="createChoiceCheck" aria-hidden="true">
                  <Check size={13} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="createChoiceText">
              <strong>{template.label}</strong>
              <span>{template.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NameStep({
  name,
  onName,
  laps,
  onLaps,
  summary,
  accent,
  outline,
}: {
  name: string;
  onName: (name: string) => void;
  laps: number;
  onLaps: (laps: number) => void;
  summary: string;
  accent: KitTheme['accent'] | undefined;
  outline: LayoutTemplate['preview'];
}) {
  return (
    <div className="createNameStep">
      <div className="createNameFields">
        <label className="createFieldLabel" htmlFor="create-track-name">
          Track name
        </label>
        <input
          id="create-track-name"
          data-wizard-name
          className="createTextInput"
          value={name}
          maxLength={60}
          placeholder="My track"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onName(event.target.value)}
        />
        <span className="createFieldHelp">Shown in the race menu and on the track list.</span>

        <span className="createFieldLabel" id="create-laps-label">
          Laps
        </span>
        <div className="createStepper" role="group" aria-labelledby="create-laps-label">
          <IconButton icon={<Minus size={14} />} tooltip="Fewer laps" disabled={laps <= 1} disabledReason="A race needs at least 1 lap" onClick={() => onLaps(Math.max(1, laps - 1))} />
          <output className="createStepperValue" aria-live="polite">
            {laps}
          </output>
          <IconButton icon={<Plus size={14} />} tooltip="More laps" disabled={laps >= 9} disabledReason="The game allows at most 9 laps" onClick={() => onLaps(Math.min(9, laps + 1))} />
        </div>
        <span className="createFieldHelp">Most tracks use 3.</span>
      </div>
      <div className="createNamePreview" style={{ background: themeGradient(accent) }}>
        <TrackOutline points={outline} emptyLabel="You draw it" />
        <span className="createNamePreviewLabel">{summary}</span>
      </div>
    </div>
  );
}
