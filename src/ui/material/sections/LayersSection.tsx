import { ArrowDown, ArrowUp, ChevronRight, Download, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { calcTex0DataSize, encodeTex0Data, floorPowerOfTwo, maxMipCount } from '../../../lib/tex0Codec';
import { Button, EmptyState, Field, FieldGroup, IconButton, NumberInput, SegmentedControl, Select, Toggle, useToast } from '../../components';
import { TexturePreview } from '../../visual/TexturePreview';
import { exportTextureAsPng, readImageFile } from '../../visual/textureReplace';
import type { VisualTextureInfo } from '../../visual/visualArchive';
import { AdvancedBlock } from '../AdvancedBlock';
import {
  ANISOTROPY_OPTIONS,
  MAG_FILTER_OPTIONS,
  MAP_MODE_OPTIONS,
  MIN_FILTER_OPTIONS,
  TEXTURE_FORMAT_OPTIONS,
  TEX_GEN_MATRIX_OPTIONS,
  TEX_GEN_SOURCE_OPTIONS,
  TEX_GEN_TYPE_OPTIONS,
  WRAP_MODE_OPTIONS,
  mapModeLabel,
  wrapChoiceLabel,
} from '../gxOptions';
import type { ImportedTexture, MaterialDocChange } from '../MaterialInspector';
import {
  addLayer,
  MAX_SAMPLERS,
  moveLayer,
  patchSampler,
  patchTexGen,
  patchTexSrt,
  removeLayer,
} from '../materialDoc';
import {
  getLayerFilter,
  getLayerWrap,
  isEnvironmentMapped,
  setEnvironmentMapped,
  setLayerFilter,
  setLayerWrap,
  wrapChoiceOf,
  type FilterChoice,
  type WrapChoice,
} from '../materialSimple';
import { AdvancedSection } from './AdvancedSection';

/** Biggest texture the editor will encode. Bigger than this and a course blows its texture budget. */
const MAX_IMPORT_SIZE = 1024;

/** `GX.TexFormat` C4 / C8 / C14X2 — the formats that read a palette. */
const PALETTED_FORMATS = new Set([0x8, 0x9, 0xa]);

const WRAP_CHOICES: Array<{ value: WrapChoice; label: string; tooltip: string }> = [
  { value: 'repeat', label: 'Repeat', tooltip: 'The texture tiles over and over.' },
  { value: 'mirror', label: 'Mirror', tooltip: 'Every other tile is flipped, so the seams line up.' },
  { value: 'clamp', label: 'Clamp', tooltip: 'The edge pixel is stretched out past the edge. No tiling.' },
];

const FILTER_CHOICES: Array<{ value: FilterChoice; label: string; tooltip: string }> = [
  { value: 'smooth', label: 'Smooth', tooltip: 'Blends between texels. What almost every course texture wants.' },
  { value: 'pixelated', label: 'Pixelated', tooltip: 'Shows hard texel edges close up. For pixel art and sharp signage.' },
];

export interface TextureListProps {
  doc: GxMaterialDoc;
  textures: VisualTextureInfo[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  onChange: MaterialDocChange;
  /** Opens one texture's full details — in the graph hosts, by selecting its node. */
  onOpenLayer: (index: number) => void;
}

/**
 * The material's textures as a compact list: a thumbnail, the slot and the image name. This is
 * the overview, not the editor — clicking a row opens that one texture's details (the host
 * selects its node in the shader graph), which is where tiling, sampling, placement and the
 * replace/export actions live. Reordering and removing are list operations, so they stay here.
 *
 * The indirect-texture stages, which warp a later layer's coordinates, are a property of the
 * material rather than of one layer, so they get the list's own disclosure at the bottom.
 */
export function TextureList({ doc, textures, archivePath, archiveBytes, onChange, onOpenLayer }: TextureListProps) {
  return (
    <div className="detailsTextureList">
      {doc.samplers.length === 0 ? (
        <EmptyState
          size="sm"
          title="No textures"
          description="This material samples no textures. Add one to give it a surface."
        />
      ) : (
        <ul className="detailsTextureRows" aria-label="Textures this material uses">
          {doc.samplers.map((sampler, index) => {
            const texture = textures.find((entry) => entry.name === sampler.texture) ?? null;
            return (
              <li key={index} className="detailsTextureRow">
                <button
                  type="button"
                  className="detailsTextureOpen"
                  title={`Show texture ${index + 1}'s settings`}
                  onClick={() => onOpenLayer(index)}
                >
                  <span className="detailsTextureThumb">
                    <TexturePreview archivePath={archivePath} archiveBytes={archiveBytes} texture={texture} revision={0} />
                  </span>
                  <span className="detailsTextureText">
                    <span className="detailsTextureSlot">Texture {index + 1}</span>
                    <strong className="detailsTextureName">{sampler.texture || 'None'}</strong>
                    <span className="detailsTextureFacts">{texture ? textureFacts(texture) : 'Not in this archive'}</span>
                  </span>
                  <ChevronRight size={14} className="detailsTextureChevron" aria-hidden="true" />
                </button>
                <span className="detailsTextureActions">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    icon={<ArrowUp size={13} />}
                    tooltip="Move this texture up"
                    disabled={index === 0}
                    disabledReason="This is already the first texture."
                    onClick={() => onChange(moveLayer(doc, index, -1), { status: `Moved texture ${index + 1} up.` })}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    icon={<ArrowDown size={13} />}
                    tooltip="Move this texture down"
                    disabled={index >= doc.samplers.length - 1}
                    disabledReason="This is already the last texture."
                    onClick={() => onChange(moveLayer(doc, index, 1), { status: `Moved texture ${index + 1} down.` })}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={13} />}
                    tooltip="Remove this texture"
                    onClick={() => onChange(removeLayer(doc, index), { status: `Removed texture ${index + 1}.` })}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="detailsTextureAdd">
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={13} />}
          disabled={doc.samplers.length >= MAX_SAMPLERS}
          disabledReason={`A GX material can have at most ${MAX_SAMPLERS} textures.`}
          onClick={() => onChange(addLayer(doc, textures[0]?.name ?? ''), { status: `Added texture ${doc.samplers.length + 1}.` })}
        >
          Add texture
        </Button>
      </div>

      <AdvancedBlock
        storageKey="indirect"
        title="Indirect texturing"
        hint="The extra lookups that warp another layer's coordinates — water, heat haze, distortion"
      >
        <AdvancedSection doc={doc} onChange={onChange} />
      </AdvancedBlock>
    </div>
  );
}

/** "256x128 CMPR · 1 mip" — what a texture is, in one line. */
function textureFacts(texture: VisualTextureInfo): string {
  return `${texture.width}x${texture.height} ${texture.formatLabel} · ${texture.mipCount} mip${texture.mipCount === 1 ? '' : 's'}`;
}

export interface TextureLayerDetailsProps {
  /** Which of `doc.samplers` this is. */
  index: number;
  doc: GxMaterialDoc;
  textures: VisualTextureInfo[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  onChange: MaterialDocChange;
  onImportTexture: (texture: ImportedTexture) => boolean;
}

/**
 * Everything about one texture layer, for the Details panel when its node is selected: a big
 * preview, what the image is, replace and export, and then how it is sampled — tiling,
 * smoothing, environment mapping, placement on the surface — with the sampler and texture
 * coordinate machinery folded into the layer's own **Advanced** disclosure.
 *
 * The whole panel is a drop target: an image dropped anywhere on it replaces the texture.
 */
export function TextureLayerDetails({ index, doc, textures, archivePath, archiveBytes, onChange, onImportTexture }: TextureLayerDetailsProps) {
  const sampler = doc.samplers[index];
  const srt = doc.texSrts[index];
  const texGen = doc.texGens[index];
  const texture = textures.find((entry) => entry.name === sampler.texture) ?? null;
  const textureOptions = textures.map((entry) => ({ value: entry.name, label: `${entry.name} — ${entry.width}x${entry.height}` }));
  // C4 / C8 / C14X2 — the only formats that read a palette.
  const isPaletted = texture !== null && PALETTED_FORMATS.has(texture.format);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [format, setFormat] = useState<number>(Number(TEXTURE_FORMAT_OPTIONS[0].value));
  const [size, setSize] = useState(256);
  const [mipCount, setMipCount] = useState(1);
  const [busy, setBusy] = useState(false);

  const wrap = getLayerWrap(sampler);
  const filter = getLayerFilter(sampler);
  const envMapped = isEnvironmentMapped(sampler);

  const importFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const image = await readImageFile(file);
        const clamped = Math.min(MAX_IMPORT_SIZE, Math.max(1, floorPowerOfTwo(size)));
        const mips = Math.max(1, Math.min(mipCount, maxMipCount(clamped, clamped)));
        const data = encodeTex0Data(image, format, clamped, clamped, mips);
        const name = uniqueTextureName(file.name, textures);
        const stored = onImportTexture({ name, format, width: clamped, height: clamped, mipCount: mips, data });
        if (stored) {
          onChange(patchSampler(doc, index, { texture: name }), { status: `Texture ${index + 1} is now ${name}.` });
          toast.showToast({
            tone: 'success',
            title: `Imported ${name}`,
            detail: `${clamped}x${clamped}, ${mips} mip level${mips === 1 ? '' : 's'}, ${calcTex0DataSize(format, clamped, clamped, mips)} bytes.`,
          });
        }
      } catch (error) {
        toast.showToast({ tone: 'error', title: 'Could not import that image', detail: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(false);
      }
    },
    [doc, format, index, mipCount, onChange, onImportTexture, size, textures, toast],
  );

  return (
    <section
      className={dragOver ? 'detailsTexture isDragTarget' : 'detailsTexture'}
      aria-label={`Texture ${index + 1}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        void importFile(event.dataTransfer.files[0]);
      }}
    >
      <div className="detailsTexturePreview">
        <TexturePreview archivePath={archivePath} archiveBytes={archiveBytes} texture={texture} revision={0} size="large" />
        <span className="detailsTextureDropHint" aria-hidden="true">
          <Upload size={14} /> Drop an image to replace this texture
        </span>
      </div>

      <div className="detailsTextureIdentity">
        <Select
          label={`Texture ${index + 1} image`}
          value={sampler.texture}
          options={textureOptions.length > 0 ? textureOptions : [{ value: sampler.texture, label: sampler.texture || 'None' }]}
          onChange={(value) => onChange(patchSampler(doc, index, { texture: value }), { status: `Texture ${index + 1} is now ${value}.` })}
        />
        <p className="detailsTextureFactsLine">{texture ? textureFacts(texture) : 'This texture is not in the archive.'}</p>
        <div className="detailsTextureButtons">
          <Button
            size="sm"
            icon={<Upload size={13} />}
            disabled={busy}
            disabledReason="Still encoding the last image."
            tooltip="Pick a PNG or JPEG; it is encoded with the settings under Advanced › Import encoding"
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Encoding…' : 'Replace…'}
          </Button>
          <Button
            size="sm"
            icon={<Download size={13} />}
            disabled={!texture || !archiveBytes}
            disabledReason="This texture is not in the archive."
            tooltip="Download this texture as a PNG"
            onClick={() => {
              if (!texture || !archiveBytes) return;
              void exportTextureAsPng(archiveBytes, texture).catch((error: unknown) =>
                toast.showToast({ tone: 'error', title: 'Could not export the texture', detail: error instanceof Error ? error.message : String(error) }),
              );
            }}
          >
            Save PNG
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="materialFileInput"
            aria-label={`Import an image for texture ${index + 1}`}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importFile(file);
            }}
          />
        </div>
      </div>

      <FieldGroup>
        <Field label="Tiling" asGroup help={wrap === null ? `Across: ${wrapChoiceLabel(wrapChoiceOf(sampler.wrapS))} · down: ${wrapChoiceLabel(wrapChoiceOf(sampler.wrapT))}. Pick one to use it on both.` : undefined}>
          <SegmentedControl
            label={`Texture ${index + 1} tiling`}
            size="sm"
            value={wrap ?? ('' as WrapChoice)}
            options={WRAP_CHOICES}
            onChange={(value) => onChange(setLayerWrap(doc, index, value), { status: `Texture ${index + 1} tiling: ${wrapChoiceLabel(value)}.` })}
          />
        </Field>

        <Field label="Sampling" asGroup>
          <SegmentedControl
            label={`Texture ${index + 1} filtering`}
            size="sm"
            value={filter}
            options={FILTER_CHOICES}
            onChange={(value) => onChange(setLayerFilter(doc, index, value), { status: `Texture ${index + 1} is ${value === 'smooth' ? 'smoothed' : 'pixelated'}.` })}
          />
        </Field>

        <Field
          label="Environment map"
          help={envMapped ? `Coordinates come from ${mapModeLabel(sampler.mapMode).toLowerCase()}, so the texture slides over the surface like a reflection.` : undefined}
        >
          <Toggle
            label={envMapped ? mapModeLabel(sampler.mapMode) : 'Off'}
            checked={envMapped}
            onChange={(checked) => onChange(setEnvironmentMapped(doc, index, checked), { status: `Texture ${index + 1} ${checked ? 'reflects the camera' : "uses the mesh's UVs"}.` })}
          />
        </Field>
      </FieldGroup>

      {srt && (
        <FieldGroup title="Placement">
          <Field label="Scale" asGroup hint="tiles">
            <span className="materialPairRow">
              <NumberInput
                label={`Texture ${index + 1} scale across`}
                axis="U"
                value={srt.scaleS}
                step={0.01}
                precision={4}
                onChange={(value) => onChange(patchTexSrt(doc, index, { scaleS: value }), { transient: true })}
                onCommit={(value) => onChange(patchTexSrt(doc, index, { scaleS: value }), { status: `Texture ${index + 1} scale changed.` })}
              />
              <NumberInput
                label={`Texture ${index + 1} scale down`}
                axis="V"
                value={srt.scaleT}
                step={0.01}
                precision={4}
                onChange={(value) => onChange(patchTexSrt(doc, index, { scaleT: value }), { transient: true })}
                onCommit={(value) => onChange(patchTexSrt(doc, index, { scaleT: value }), { status: `Texture ${index + 1} scale changed.` })}
              />
            </span>
          </Field>
          <Field label="Offset" asGroup>
            <span className="materialPairRow">
              <NumberInput
                label={`Texture ${index + 1} offset across`}
                axis="U"
                value={srt.translateS}
                step={0.01}
                precision={4}
                onChange={(value) => onChange(patchTexSrt(doc, index, { translateS: value }), { transient: true })}
                onCommit={(value) => onChange(patchTexSrt(doc, index, { translateS: value }), { status: `Texture ${index + 1} moved.` })}
              />
              <NumberInput
                label={`Texture ${index + 1} offset down`}
                axis="V"
                value={srt.translateT}
                step={0.01}
                precision={4}
                onChange={(value) => onChange(patchTexSrt(doc, index, { translateT: value }), { transient: true })}
                onCommit={(value) => onChange(patchTexSrt(doc, index, { translateT: value }), { status: `Texture ${index + 1} moved.` })}
              />
            </span>
          </Field>
          <Field label="Rotation" hint="degrees">
            <NumberInput
              label={`Texture ${index + 1} rotation`}
              value={srt.rotation}
              step={1}
              precision={2}
              unit="°"
              onChange={(value) => onChange(patchTexSrt(doc, index, { rotation: value }), { transient: true })}
              onCommit={(value) => onChange(patchTexSrt(doc, index, { rotation: value }), { status: `Texture ${index + 1} rotated to ${value.toFixed(1)}°.` })}
            />
          </Field>
        </FieldGroup>
      )}

      <AdvancedBlock
        storageKey={`layer.${index}`}
        hint="Per-axis wrapping, the exact filters, mip bias, mapping, coordinates and the import encoding"
      >
        <FieldGroup title="Sampler">
          <Field label="Palette" help="Only paletted formats (C4/C8/C14X2) use one.">
            <input
              className="materialTextInput"
              type="text"
              value={sampler.palette}
              aria-label={`Texture ${index + 1} palette`}
              placeholder="None"
              onChange={(event) => onChange(patchSampler(doc, index, { palette: event.currentTarget.value }), { transient: true })}
              onBlur={(event) => onChange(patchSampler(doc, index, { palette: event.currentTarget.value }), { status: `Texture ${index + 1} palette set.` })}
            />
          </Field>
          {/* The palette slot only means anything for a paletted texture, so it stays out of the way
              for the other 99% of layers. */}
          {isPaletted && (
            <Field label="Palette slot" hint="TLUT" help="Which of the hardware's palette slots this layer's palette is loaded into.">
              <NumberInput
                label={`Texture ${index + 1} palette slot`}
                value={sampler.tlutId ?? 0}
                min={0}
                max={15}
                integer
                step={1}
                onChange={(value) => onChange(patchSampler(doc, index, { tlutId: value }), { transient: true })}
                onCommit={(value) => onChange(patchSampler(doc, index, { tlutId: value }), { status: `Texture ${index + 1} palette slot ${value}.` })}
              />
            </Field>
          )}
          <Field label="Wrap across">
            <Select
              label={`Texture ${index + 1} wrap S`}
              value={String(sampler.wrapS)}
              options={WRAP_MODE_OPTIONS}
              onChange={(value) => onChange(patchSampler(doc, index, { wrapS: Number(value) as never }), { status: `Texture ${index + 1} wrap changed.` })}
            />
          </Field>
          <Field label="Wrap down">
            <Select
              label={`Texture ${index + 1} wrap T`}
              value={String(sampler.wrapT)}
              options={WRAP_MODE_OPTIONS}
              onChange={(value) => onChange(patchSampler(doc, index, { wrapT: Number(value) as never }), { status: `Texture ${index + 1} wrap changed.` })}
            />
          </Field>
          <Field label="Minifying">
            <Select
              label={`Texture ${index + 1} minification filter`}
              value={String(sampler.minFilter)}
              options={MIN_FILTER_OPTIONS}
              onChange={(value) => onChange(patchSampler(doc, index, { minFilter: Number(value) as never }), { status: `Texture ${index + 1} filter changed.` })}
            />
          </Field>
          <Field label="Magnifying">
            <Select
              label={`Texture ${index + 1} magnification filter`}
              value={String(sampler.magFilter)}
              options={MAG_FILTER_OPTIONS}
              onChange={(value) => onChange(patchSampler(doc, index, { magFilter: Number(value) as never }), { status: `Texture ${index + 1} filter changed.` })}
            />
          </Field>
          <Field label="Detail bias" hint="-4..4">
            <NumberInput
              label={`Texture ${index + 1} LOD bias`}
              value={sampler.lodBias}
              min={-4}
              max={3.99}
              step={0.05}
              precision={2}
              onChange={(value) => onChange(patchSampler(doc, index, { lodBias: value }), { transient: true })}
              onCommit={(value) => onChange(patchSampler(doc, index, { lodBias: value }), { status: `Texture ${index + 1} detail bias ${value.toFixed(2)}.` })}
            />
          </Field>
          <Field label="Sharpening">
            <Select
              label={`Texture ${index + 1} anisotropy`}
              value={String(sampler.maxAnisotropy)}
              options={ANISOTROPY_OPTIONS}
              onChange={(value) => onChange(patchSampler(doc, index, { maxAnisotropy: Number(value) as never }), { status: `Texture ${index + 1} sharpening changed.` })}
            />
          </Field>
          <Field label="Clamp bias">
            <Toggle
              label={sampler.biasClamp ? 'On' : 'Off'}
              checked={sampler.biasClamp}
              onChange={(checked) => onChange(patchSampler(doc, index, { biasClamp: checked }), { status: `Texture ${index + 1} bias clamp ${checked ? 'on' : 'off'}.` })}
            />
          </Field>
          <Field label="Edge mips">
            <Toggle
              label={sampler.edgeLod ? 'On' : 'Off'}
              checked={sampler.edgeLod}
              onChange={(checked) => onChange(patchSampler(doc, index, { edgeLod: checked }), { status: `Texture ${index + 1} edge mips ${checked ? 'on' : 'off'}.` })}
            />
          </Field>
          <Field label="Mapped from">
            <Select
              label={`Texture ${index + 1} map mode`}
              value={sampler.mapMode}
              options={MAP_MODE_OPTIONS}
              onChange={(value) => onChange(patchSampler(doc, index, { mapMode: value as never }), { status: `Texture ${index + 1} mapping changed.` })}
            />
          </Field>
        </FieldGroup>

        {srt && sampler.mapMode !== 'texcoord' && (
          <FieldGroup title="Reflection">
            <Field label="Reference camera" hint="-1 = none">
              <NumberInput
                label={`Texture ${index + 1} reference camera`}
                value={srt.refCamera}
                min={-1}
                integer
                step={1}
                onChange={(value) => onChange(patchTexSrt(doc, index, { refCamera: value }), { transient: true })}
                onCommit={(value) => onChange(patchTexSrt(doc, index, { refCamera: value }), { status: `Texture ${index + 1} reference camera ${value}.` })}
              />
            </Field>
            <Field label="Reference light" hint="-1 = none">
              <NumberInput
                label={`Texture ${index + 1} reference light`}
                value={srt.refLight}
                min={-1}
                integer
                step={1}
                onChange={(value) => onChange(patchTexSrt(doc, index, { refLight: value }), { transient: true })}
                onCommit={(value) => onChange(patchTexSrt(doc, index, { refLight: value }), { status: `Texture ${index + 1} reference light ${value}.` })}
              />
            </Field>
          </FieldGroup>
        )}

        {texGen && (
          <FieldGroup title="Coordinates">
            <Field label="Generated as">
              <Select
                label={`Texture ${index + 1} texgen type`}
                value={String(texGen.type)}
                options={TEX_GEN_TYPE_OPTIONS}
                onChange={(value) => onChange(patchTexGen(doc, index, { type: Number(value) as never }), { status: `Texture ${index + 1} coordinates changed.` })}
              />
            </Field>
            <Field label="From">
              <Select
                label={`Texture ${index + 1} texgen source`}
                value={String(texGen.source)}
                options={TEX_GEN_SOURCE_OPTIONS}
                onChange={(value) => onChange(patchTexGen(doc, index, { source: Number(value) as never }), { status: `Texture ${index + 1} coordinate source changed.` })}
              />
            </Field>
            <Field label="Through matrix">
              <Select
                label={`Texture ${index + 1} texgen matrix`}
                value={String(texGen.matrix)}
                options={TEX_GEN_MATRIX_OPTIONS}
                onChange={(value) => onChange(patchTexGen(doc, index, { matrix: Number(value) as never }), { status: `Texture ${index + 1} matrix changed.` })}
              />
            </Field>
            <Field label="Normalize">
              <Toggle
                label={texGen.normalize ? 'On' : 'Off'}
                checked={texGen.normalize}
                onChange={(checked) => onChange(patchTexGen(doc, index, { normalize: checked }), { status: `Texture ${index + 1} normalize ${checked ? 'on' : 'off'}.` })}
              />
            </Field>
          </FieldGroup>
        )}

        <FieldGroup title="Import encoding">
          <Field label="Format" help="How an imported PNG is packed into the archive. Applies to the next Replace.">
            <Select
              label={`Texture ${index + 1} import format`}
              size="sm"
              value={String(format)}
              options={TEXTURE_FORMAT_OPTIONS}
              onChange={(value) => setFormat(Number(value))}
            />
          </Field>
          <Field label="Size">
            <Select
              label={`Texture ${index + 1} import size`}
              size="sm"
              value={String(size)}
              options={[32, 64, 128, 256, 512, 1024].map((value) => ({ value: String(value), label: `${value} x ${value}` }))}
              onChange={(value) => setSize(Number(value))}
            />
          </Field>
          <Field label="Mip levels">
            <NumberInput
              label="Mip levels"
              value={mipCount}
              min={1}
              max={maxMipCount(size, size)}
              integer
              step={1}
              scrub={false}
              onChange={setMipCount}
            />
          </Field>
        </FieldGroup>
      </AdvancedBlock>

    </section>
  );
}

/** `grass.png` becomes `grass`, and `grass_2` if `grass` is taken. */
function uniqueTextureName(fileName: string, textures: readonly VisualTextureInfo[]): string {
  const base = (fileName.replace(/\.[^.]+$/, '') || 'texture').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 28);
  const taken = new Set(textures.map((texture) => texture.name));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString(36)}`;
}
