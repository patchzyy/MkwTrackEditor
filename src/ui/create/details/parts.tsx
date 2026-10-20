import { Minus, Plus } from 'lucide-react';
import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';
import { useEffect, useState, type ReactNode } from 'react';
import type { CreateKit, KitSurface, KitTheme, SurfaceRef } from '../../../lib/create/types';
import { Tooltip } from '../../components/Tooltip';
import { kitImageUrl, themeGradient } from '../kitImages';
import './details.css';

/** Title block at the top of every Details panel: concept-coloured icon, name, one line of context. */
export function DetailsHeader({ icon, accent, title, subtitle, actions }: { icon: ReactNode; accent: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="crDetailsHeader" style={{ ['--details-accent' as string]: accent }}>
      <span className="crDetailsIcon" aria-hidden="true">
        {icon}
      </span>
      <div className="crDetailsHeading">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="crDetailsActions">{actions}</div>}
    </header>
  );
}

/** A field label whose sentence of explanation shows on hover (keeps dense panels short). */
export function HelpLabel({ children, help }: { children: ReactNode; help: string }) {
  return (
    <Tooltip label={help} side="left">
      <span className="crHelpLabel">{children}</span>
    </Tooltip>
  );
}

/** A titled group of fields with an optional sentence of explanation. */
export function Group({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="crGroup">
      <h3 className="crGroupTitle">{title}</h3>
      {help && <p className="crGroupHelp">{help}</p>}
      <div className="crGroupBody">{children}</div>
    </section>
  );
}

/** A text box that edits on Enter / blur, so typing a name is one undo step. */
export function TextField({ value, onCommit, label, placeholder, maxLength = 48 }: { value: string; onCommit: (value: string) => void; label: string; placeholder?: string; maxLength?: number }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <input
      className="crTextInput"
      type="text"
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** − 3 + : for small whole numbers where scrubbing would be silly (laps, item count). */
export function Stepper({ value, min, max, onChange, label, format }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string; format?: (value: number) => string }) {
  return (
    <span className="crStepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={13} />
      </button>
      <output aria-live="polite">{format ? format(value) : value}</output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={13} />
      </button>
    </span>
  );
}

/**
 * The current world as one card with a "Change world" button; the other worlds open in a popover.
 * Keeps the Details panel short while still showing the real sky of every world.
 */
export function WorldPicker({ kit, value, onPick }: { kit: CreateKit | null; value: string; onPick: (theme: KitTheme) => void }) {
  const theme = kit?.theme(value) ?? null;
  if (!kit || !theme) return null;
  const url = kitImageUrl(kit, theme.preview);
  return (
    <div className="crWorld">
      <span className="crWorldPreview" style={{ backgroundImage: url ? `url(${url})` : themeGradient(theme.accent) }} />
      <div className="crWorldText">
        <strong>{theme.label}</strong>
        <span>{theme.description}</span>
        <Popover
          label="Choose a world"
          align="end"
          className="crWorldPopover"
          trigger={({ open, toggle }) => (
            <Button size="sm" active={open} onClick={toggle} data-create-action="change-world">
              Change world
            </Button>
          )}
        >
          <ThemePicker kit={kit} value={value} onPick={onPick} />
        </Popover>
      </div>
    </div>
  );
}

/** Cards for choosing a world: the real sky preview, the name, the one-line description on hover. */
export function ThemePicker({ kit, value, onPick }: { kit: CreateKit | null; value: string; onPick: (theme: KitTheme) => void }) {
  if (!kit) return null;
  return (
    <div className="crThemeGrid" role="radiogroup" aria-label="World">
      {kit.catalog.themes.map((theme) => {
        const url = kitImageUrl(kit, theme.preview);
        const selected = theme.id === value;
        return (
          <Tooltip key={theme.id} label={theme.description} side="left" className="crThemeSlot">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className={`crThemeCard${selected ? ' is-selected' : ''}`}
              data-create-theme={theme.id}
              onClick={() => onPick(theme)}
            >
              <span className="crThemePreview" style={{ backgroundImage: url ? `url(${url})` : themeGradient(theme.accent) }} />
              <span className="crThemeName">{theme.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * A grid of surface swatches with the kit's own thumbnails. `value` is the surface currently in
 * use (resolved), `inherit` adds a first "Style default" cell that clears the override.
 */
export function SurfacePicker({
  kit,
  themeId,
  surfaces,
  value,
  onPick,
  inherit,
  small = false,
}: {
  kit: CreateKit | null;
  themeId: string;
  surfaces: readonly KitSurface[];
  value: SurfaceRef | undefined | null;
  onPick: (ref: SurfaceRef | null) => void;
  inherit?: { label: string; selected: boolean };
  small?: boolean;
}) {
  if (!kit) return null;
  const currentId = value ? kit.resolveSurface(value, themeId).id : null;
  return (
    <div className={`crSurfaceGrid${small ? ' crSurfaceGrid--small' : ''}`} role="radiogroup" aria-label="Surface">
      {inherit && (
        <button type="button" role="radio" aria-checked={inherit.selected} className={`crSurfaceCell crSurfaceCell--inherit${inherit.selected ? ' is-selected' : ''}`} onClick={() => onPick(null)} title="Use the road style's own surface">
          <span>{inherit.label}</span>
        </button>
      )}
      {surfaces.map((surface) => {
        const url = kitImageUrl(kit, surface.thumbnail);
        const selected = !inherit?.selected && surface.id === currentId;
        return (
          <Tooltip key={surface.id} label={surface.label} side="top" className="crSurfaceSlot">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={surface.label}
              className={`crSurfaceCell${selected ? ' is-selected' : ''}`}
              style={{ backgroundImage: url ? `url(${url})` : undefined }}
              onClick={() => onPick({ surfaceId: surface.id })}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Surfaces of one or more categories, the world's own first. */
export function surfacesOf(kit: CreateKit | null, themeId: string, categories: readonly KitSurface['category'][]): KitSurface[] {
  if (!kit) return [];
  const own = new Set(Object.values(kit.theme(themeId)?.slots ?? {}));
  const list = kit.catalog.surfaces.filter((s) => categories.includes(s.category));
  return [...list.filter((s) => own.has(s.id)), ...list.filter((s) => !own.has(s.id))];
}
