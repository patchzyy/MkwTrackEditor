import { Boxes, Eye, Layers, Package, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { materialRefEquals } from './materialOutlinerModel';
import type { GxMaterialRef, GxTextureSummary } from '../../lib/gxMaterial';
import { IconButton, Tooltip } from '../components';
import { TexturePreview } from '../visual/TexturePreview';
import { describeContext, filterModelMaterialRows, type MaterialContext, type ModelMaterialRow } from './materialContext';
import { useArchiveTextures } from './useArchiveTextures';

/** More rows than this and the list gets a filter box and its own scroll. */
const FILTER_ABOVE = 8;

export interface ModelMaterialsStripProps {
  context: MaterialContext;
  rows: readonly ModelMaterialRow[];
  /** The material being edited; its row is the active one. */
  selected: GxMaterialRef | null;
  onSelect: (ref: GxMaterialRef) => void;
  archiveBytes: Uint8Array | null;
  textures: readonly GxTextureSummary[];
  solo: boolean;
  onToggleSolo: () => void;
  soloDisabled: boolean;
  onOpenInStudio?: () => void;
  /** Placed models are edited in Model mode; this takes you there. */
  onOpenModelMode?: () => void;
}

/**
 * The top of the Details panel, like Unreal's component list: "On this Item Box", then one compact
 * row (texture thumbnail and material name) for every material the clicked model draws with. The
 * clicked material is the active row; picking another row switches what the panel below edits.
 */
export function ModelMaterialsStrip({
  context,
  rows,
  selected,
  onSelect,
  archiveBytes,
  textures,
  solo,
  onToggleSolo,
  soloDisabled,
  onOpenInStudio,
  onOpenModelMode,
}: ModelMaterialsStripProps) {
  const textureInfos = useArchiveTextures(archiveBytes, textures);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement | null>(null);
  const modelKey = `${context.archivePath}|${context.modelName}`;
  useEffect(() => setQuery(''), [modelKey]);

  const visible = useMemo(() => filterModelMaterialRows(rows, query), [rows, query]);
  const selectedName = selected?.materialName ?? null;
  // The clicked material may be far down a long list (the whole course): bring it into view.
  useEffect(() => {
    listRef.current?.querySelector('.materialSlotRow.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [selectedName, modelKey, rows.length]);

  const Icon = context.kind === 'course' ? Layers : context.kind === 'object' ? Package : Boxes;
  const long = rows.length > FILTER_ABOVE;
  const shared = context.source === 'common' && !context.placed;

  return (
    <section className="materialSlots" aria-label={`Materials on ${context.title}`}>
      <header className="materialSlotsHeader">
        <span className="materialSlotsIcon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <div className="materialSlotsTitle">
          <strong title={context.title}>On this {context.title}</strong>
          <span>
            {describeContext(context, rows.length)}
            {shared && (
              <Tooltip
                label="This model comes from the game's shared files. Your track gets its own copy the first time you change something."
                side="bottom"
              >
                <span className="materialSlotsShared">Shared model</span>
              </Tooltip>
            )}
          </span>
        </div>
        <div className="materialSlotsActions">
          {!context.placed && (
            <IconButton
              size="sm"
              variant="ghost"
              icon={<Eye size={14} />}
              tooltip={solo ? 'Show everything again' : 'Show only this material'}
              active={solo}
              disabled={soloDisabled}
              disabledReason="The viewport is not drawing this material, so there is nothing to isolate."
              onClick={onToggleSolo}
            />
          )}
          {onOpenInStudio && !context.placed && (
            <IconButton
              size="sm"
              variant="ghost"
              icon={<Boxes size={14} />}
              tooltip="Open this model in the Model Studio, with its animations and a bigger shader canvas"
              onClick={onOpenInStudio}
            />
          )}
        </div>
      </header>

      {context.placed ? (
        <p className="materialSlotsNote">
          You placed this model from the content browser. Its materials are edited in Model mode.
          {onOpenModelMode && (
            <button type="button" className="materialSlotsLink" onClick={onOpenModelMode}>
              Open Model mode
            </button>
          )}
        </p>
      ) : (
        <>
          {long && (
            <label className="materialSlotsFilter">
              <Search size={12} aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder={`Filter ${rows.length} materials`}
                aria-label="Filter the materials on this model"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          )}
          {rows.length === 0 && <p className="materialSlotsNote">This model does not draw anything with a material.</p>}
          <ul ref={listRef} className={long ? 'materialSlotList is-scrolling' : 'materialSlotList'}>
            {visible.map((row) => {
              const active = materialRefEquals(row.ref, selected);
              const textureName = row.textureNames[0] ?? null;
              const texture = textureName ? (textureInfos.find((entry) => entry.name === textureName) ?? null) : null;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    className={active ? 'materialSlotRow is-active' : 'materialSlotRow'}
                    aria-pressed={active}
                    onClick={() => onSelect(row.ref)}
                  >
                    <span className="materialSlotThumb" aria-hidden="true">
                      {texture ? (
                        <TexturePreview archivePath={context.archivePath} archiveBytes={archiveBytes} texture={texture} revision={0} />
                      ) : (
                        <Sparkles size={12} />
                      )}
                    </span>
                    <span className="materialSlotText">
                      <strong title={row.materialName}>{row.materialName}</strong>
                      <span>{textureName ?? 'Colour only'}</span>
                    </span>
                    {row.translucent && (
                      <Tooltip label="Drawn with transparency" side="left">
                        <span className="materialTag">Blend</span>
                      </Tooltip>
                    )}
                    {row.drawCalls > 1 && (
                      <Tooltip label={`Paints ${row.drawCalls} parts of this model. Editing it changes all of them.`} side="left">
                        <span className="materialSlotCount">×{row.drawCalls}</span>
                      </Tooltip>
                    )}
                  </button>
                </li>
              );
            })}
            {long && visible.length === 0 && <li className="materialSlotsNote">No material matches.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
