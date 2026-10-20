import { Children, cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { beginPaletteDrag, endPaletteDrag } from '../tools/useCreateTools';
import type { ArmedItem } from '../tools/types';

/**
 * One tile of the palette. Click arms it (the matching tool turns on), drag it into the viewport
 * to place or apply it right there. The armed tile is clearly lit in its concept colour.
 */
export function PaletteTile({
  item,
  art,
  label,
  description,
  armed,
  badge,
  accent,
  wide = false,
  firstRow = false,
  onActivate,
}: {
  item: ArmedItem;
  art: ReactNode;
  label: string;
  description: string;
  armed: boolean;
  /** Small note on the tile ("In use", "Your world"). */
  badge?: string;
  /** CSS colour of the concept (road blue, pieces amber, ...). */
  accent: string;
  wide?: boolean;
  /** Set by `TileSection` on the tiles of a section's first row, so snapping keeps the title in view. */
  firstRow?: boolean;
  onActivate: (item: ArmedItem) => void;
}) {
  return (
    <Tooltip label={description} side="top" className={firstRow ? 'crTileSlot crTileSlot--first' : 'crTileSlot'}>
      <button
        type="button"
        className={`crTile${armed ? ' is-armed' : ''}${wide ? ' crTile--wide' : ''}`}
        style={{ ['--tile-accent' as string]: accent }}
        aria-pressed={armed}
        draggable
        data-create-tile={item.kind}
        data-armed={armed || undefined}
        onClick={() => onActivate(item)}
        onDragStart={(event) => beginPaletteDrag(item, event.dataTransfer)}
        onDragEnd={endPaletteDrag}
      >
        <span className="crTileArt">{art}</span>
        <span className="crTileLabel">{label}</span>
        {badge && <span className="crTileBadge">{badge}</span>}
        {armed && <span className="crTileCheck" aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}

/**
 * A titled run of tiles. By default the grid has `min(maxColumns, tiles)` fixed columns; with
 * `autoFill` it wraps to the width of the dock instead (scenery, road styles) and the columns are
 * read back from the browser, so the first row of the section can always tell snapping to keep the
 * title in view.
 */
export function TileSection({
  title,
  hint,
  maxColumns = 6,
  autoFill = false,
  children,
}: {
  title: string;
  hint?: string;
  maxColumns?: number;
  autoFill?: boolean;
  children: ReactNode;
}) {
  const tiles = Children.toArray(children);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(1);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!autoFill || !grid) return undefined;
    const measure = () => setMeasured(Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [autoFill, tiles.length]);
  const columns = autoFill ? measured : Math.max(1, Math.min(maxColumns, tiles.length));
  return (
    <section className={autoFill ? 'crTileSection crTileSection--full' : 'crTileSection'}>
      <h3 className="crTileSectionTitle">
        {title}
        {hint && <span>{hint}</span>}
      </h3>
      <div ref={gridRef} className={autoFill ? 'crTileGrid crTileGrid--auto' : 'crTileGrid'} style={autoFill ? undefined : { ['--cols' as string]: columns }}>
        {tiles.map((tile, index) => (isValidElement(tile) && index < columns ? cloneElement(tile as ReactElement<{ firstRow?: boolean }>, { firstRow: true }) : tile))}
      </div>
    </section>
  );
}
