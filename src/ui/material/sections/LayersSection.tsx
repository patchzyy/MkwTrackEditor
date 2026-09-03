import { ArrowDown, ArrowUp, Download, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { calcTex0DataSize, encodeTex0Data, floorPowerOfTwo, maxMipCount } from '../../../lib/tex0Codec';
import { Button, EmptyState, Field, FieldGroup, IconButton, NumberInput, Select, Toggle, useToast } from '../../components';
import { TexturePreview } from '../../visual/TexturePreview';
import { exportTextureAsPng, readImageFile } from '../../visual/textureReplace';
import type { VisualTextureInfo } from '../../visual/visualArchive';
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

/** Biggest texture the editor will encode. Bigger than this and a course blows its texture budget. */
const MAX_IMPORT_SIZE = 1024;

/** `GX.TexFormat` C4 / C8 / C14X2 — the formats that read a palette. */
const PALETTED_FORMATS = new Set([0x8, 0x9, 0xa]);

export interface LayersSectionProps {
  doc: GxMaterialDoc;
  textures: VisualTextureInfo[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  onChange: MaterialDocChange;
  onImportTexture: (texture: ImportedTexture) => boolean;
}

/**
 * One card per sampler: which texture it draws, how it is filtered and wrapped, how its UVs are
 * transformed (SRT) and generated (texgen), plus PNG import/export straight into the layer.
 */
export function LayersSection({ doc, textures, archivePath, archiveBytes, onChange, onImportTexture }: LayersSectionProps) {
  const textureOptions = textures.map((texture) => ({ value: texture.name, label: `${texture.name} — ${texture.width}x${texture.height}` }));

  return (
    <div className="materialLayers">
      {doc.samplers.length === 0 && (
        <EmptyState
          size="sm"
          title="No layers"
          description="This material samples no textures. Add a layer to give it one."
        />
      )}

      {doc.samplers.map((sampler, index) => (
        <LayerCard
          key={index}
          index={index}
          doc={doc}
          textures={textures}
          textureOptions={textureOptions}
          archivePath={archivePath}
          archiveBytes={archiveBytes}
          onChange={onChange}
          onImportTexture={onImportTexture}
        />
      ))}

      <Button
        variant="ghost"
        icon={<Plus size={13} />}
        disabled={doc.samplers.length >= MAX_SAMPLERS}
        disabledReason={`A GX material can have at most ${MAX_SAMPLERS} layers.`}
        onClick={() => onChange(addLayer(doc, textures[0]?.name ?? ''), { status: `Added layer ${doc.samplers.length + 1}.` })}
      >
        Add layer
      </Button>
    </div>
  );
}

function LayerCard({
  index,
  doc,
  textures,
  textureOptions,
  archivePath,
  archiveBytes,
  onChange,
  onImportTexture,
}: {
  index: number;
  doc: GxMaterialDoc;
  textures: VisualTextureInfo[];
  textureOptions: Array<{ value: string; label: string }>;
  archivePath: string;
  archiveBytes: Uint8Array | null;
  onChange: MaterialDocChange;
  onImportTexture: (texture: ImportedTexture) => boolean;
}) {
  const sampler = doc.samplers[index];
  const srt = doc.texSrts[index];
  const texGen = doc.texGens[index];
  const texture = textures.find((entry) => entry.name === sampler.texture) ?? null;
  // C4 / C8 / C14X2 — the only formats that read a palette.
  const isPaletted = texture !== null && PALETTED_FORMATS.has(texture.format);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [format, setFormat] = useState<number>(Number(TEXTURE_FORMAT_OPTIONS[0].value));
  const [size, setSize] = useState(256);
  const [mipCount, setMipCount] = useState(1);
  const [busy, setBusy] = useState(false);

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
          onChange(patchSampler(doc, index, { texture: name }), { status: `Layer ${index + 1} now samples ${name}.` });
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
      className={dragOver ? 'materialLayerCard isDragTarget' : 'materialLayerCard'}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        void importFile(event.dataTransfer.files[0]);
      }}
    >
      <header className="materialLayerHeader">
        <span className="materialLayerIndex">Layer {index + 1}</span>
        <span className="materialLayerActions">
          <IconButton
            size="sm"
            variant="ghost"
            icon={<ArrowUp size={13} />}
            tooltip="Move this layer up"
            disabled={index === 0}
            disabledReason="This is already the first layer."
            onClick={() => onChange(moveLayer(doc, index, -1), { status: `Moved layer ${index + 1} up.` })}
          />
          <IconButton
            size="sm"
            variant="ghost"
            icon={<ArrowDown size={13} />}
            tooltip="Move this layer down"
            disabled={index >= doc.samplers.length - 1}
            disabledReason="This is already the last layer."
            onClick={() => onChange(moveLayer(doc, index, 1), { status: `Moved layer ${index + 1} down.` })}
          />
          <IconButton
            size="sm"
            variant="ghost"
            icon={<Trash2 size={13} />}
            tooltip="Remove this layer"
            onClick={() => onChange(removeLayer(doc, index), { status: `Removed layer ${index + 1}.` })}
          />
        </span>
      </header>

      <div className="materialLayerTop">
        <TexturePreview archivePath={archivePath} archiveBytes={archiveBytes} texture={texture} revision={0} />
        <div className="materialLayerTopFields">
          <Field label="Texture">
            <Select
              label={`Layer ${index + 1} texture`}
              value={sampler.texture}
              options={textureOptions.length > 0 ? textureOptions : [{ value: sampler.texture, label: sampler.texture || 'None' }]}
              onChange={(value) => onChange(patchSampler(doc, index, { texture: value }), { status: `Layer ${index + 1} now samples ${value}.` })}
            />
          </Field>
          <p className="materialLayerFacts">
            {texture ? `${texture.width}x${texture.height} ${texture.formatLabel}, ${texture.mipCount} mip${texture.mipCount === 1 ? '' : 's'}` : 'This texture is not in the archive.'}
          </p>
        </div>
      </div>

      <FieldGroup>
        <Field label="Palette" help="Only paletted formats (C4/C8/C14X2) use one.">
          <input
            className="materialTextInput"
            type="text"
            value={sampler.palette}
            aria-label={`Layer ${index + 1} palette`}
            placeholder="None"
            onChange={(event) => onChange(patchSampler(doc, index, { palette: event.currentTarget.value }), { transient: true })}
            onBlur={(event) => onChange(patchSampler(doc, index, { palette: event.currentTarget.value }), { status: `Layer ${index + 1} palette set.` })}
          />
        </Field>
        {/* The palette slot only means anything for a paletted texture, so it stays out of the way
            for the other 99% of layers. */}
        {isPaletted && (
          <Field label="Palette slot" hint="TLUT" help="Which of the hardware's palette slots this layer's palette is loaded into.">
            <NumberInput
              label={`Layer ${index + 1} palette slot`}
              value={sampler.tlutId ?? 0}
              min={0}
              max={15}
              integer
              step={1}
              onChange={(value) => onChange(patchSampler(doc, index, { tlutId: value }), { transient: true })}
              onCommit={(value) => onChange(patchSampler(doc, index, { tlutId: value }), { status: `Layer ${index + 1} palette slot ${value}.` })}
            />
          </Field>
        )}
        <Field label="Wrap across">
          <Select
            label={`Layer ${index + 1} wrap S`}
            value={String(sampler.wrapS)}
            options={WRAP_MODE_OPTIONS}
            onChange={(value) => onChange(patchSampler(doc, index, { wrapS: Number(value) as never }), { status: `Layer ${index + 1} wrap changed.` })}
          />
        </Field>
        <Field label="Wrap down">
          <Select
            label={`Layer ${index + 1} wrap T`}
            value={String(sampler.wrapT)}
            options={WRAP_MODE_OPTIONS}
            onChange={(value) => onChange(patchSampler(doc, index, { wrapT: Number(value) as never }), { status: `Layer ${index + 1} wrap changed.` })}
          />
        </Field>
        <Field label="Minifying">
          <Select
            label={`Layer ${index + 1} minification filter`}
            value={String(sampler.minFilter)}
            options={MIN_FILTER_OPTIONS}
            onChange={(value) => onChange(patchSampler(doc, index, { minFilter: Number(value) as never }), { status: `Layer ${index + 1} filter changed.` })}
          />
        </Field>
        <Field label="Magnifying">
          <Select
            label={`Layer ${index + 1} magnification filter`}
            value={String(sampler.magFilter)}
            options={MAG_FILTER_OPTIONS}
            onChange={(value) => onChange(patchSampler(doc, index, { magFilter: Number(value) as never }), { status: `Layer ${index + 1} filter changed.` })}
          />
        </Field>
        <Field label="Detail bias" hint="-4..4">
          <NumberInput
            label={`Layer ${index + 1} LOD bias`}
            value={sampler.lodBias}
            min={-4}
            max={3.99}
            step={0.05}
            precision={2}
            onChange={(value) => onChange(patchSampler(doc, index, { lodBias: value }), { transient: true })}
            onCommit={(value) => onChange(patchSampler(doc, index, { lodBias: value }), { status: `Layer ${index + 1} detail bias ${value.toFixed(2)}.` })}
          />
        </Field>
        <Field label="Sharpening">
          <Select
            label={`Layer ${index + 1} anisotropy`}
            value={String(sampler.maxAnisotropy)}
            options={ANISOTROPY_OPTIONS}
            onChange={(value) => onChange(patchSampler(doc, index, { maxAnisotropy: Number(value) as never }), { status: `Layer ${index + 1} sharpening changed.` })}
          />
        </Field>
        <Field label="Clamp bias">
          <Toggle
            label={sampler.biasClamp ? 'On' : 'Off'}
            checked={sampler.biasClamp}
            onChange={(checked) => onChange(patchSampler(doc, index, { biasClamp: checked }), { status: `Layer ${index + 1} bias clamp ${checked ? 'on' : 'off'}.` })}
          />
        </Field>
        <Field label="Edge mips">
          <Toggle
            label={sampler.edgeLod ? 'On' : 'Off'}
            checked={sampler.edgeLod}
            onChange={(checked) => onChange(patchSampler(doc, index, { edgeLod: checked }), { status: `Layer ${index + 1} edge mips ${checked ? 'on' : 'off'}.` })}
          />
        </Field>
        <Field label="Mapped from">
          <Select
            label={`Layer ${index + 1} map mode`}
            value={sampler.mapMode}
            options={MAP_MODE_OPTIONS}
            onChange={(value) => onChange(patchSampler(doc, index, { mapMode: value as never }), { status: `Layer ${index + 1} mapping changed.` })}
          />
        </Field>
      </FieldGroup>

      {srt && (
        <FieldGroup title="Placement">
          <Field label="Scale across">
            <NumberInput
              label={`Layer ${index + 1} scale S`}
              value={srt.scaleS}
              step={0.01}
              precision={4}
              onChange={(value) => onChange(patchTexSrt(doc, index, { scaleS: value }), { transient: true })}
              onCommit={(value) => onChange(patchTexSrt(doc, index, { scaleS: value }), { status: `Layer ${index + 1} scale changed.` })}
            />
          </Field>
          <Field label="Scale down">
            <NumberInput
              label={`Layer ${index + 1} scale T`}
              value={srt.scaleT}
              step={0.01}
              precision={4}
              onChange={(value) => onChange(patchTexSrt(doc, index, { scaleT: value }), { transient: true })}
              onCommit={(value) => onChange(patchTexSrt(doc, index, { scaleT: value }), { status: `Layer ${index + 1} scale changed.` })}
            />
          </Field>
          <Field label="Rotation" hint="degrees">
            <NumberInput
              label={`Layer ${index + 1} rotation`}
              value={srt.rotation}
              step={1}
              precision={2}
              unit="°"
              onChange={(value) => onChange(patchTexSrt(doc, index, { rotation: value }), { transient: true })}
              onCommit={(value) => onChange(patchTexSrt(doc, index, { rotation: value }), { status: `Layer ${index + 1} rotated to ${value.toFixed(1)}°.` })}
            />
          </Field>
          <Field label="Shift across">
            <NumberInput
              label={`Layer ${index + 1} translate S`}
              value={srt.translateS}
              step={0.01}
              precision={4}
              onChange={(value) => onChange(patchTexSrt(doc, index, { translateS: value }), { transient: true })}
              onCommit={(value) => onChange(patchTexSrt(doc, index, { translateS: value }), { status: `Layer ${index + 1} shifted.` })}
            />
          </Field>
          <Field label="Shift down">
            <NumberInput
              label={`Layer ${index + 1} translate T`}
              value={srt.translateT}
              step={0.01}
              precision={4}
              onChange={(value) => onChange(patchTexSrt(doc, index, { translateT: value }), { transient: true })}
              onCommit={(value) => onChange(patchTexSrt(doc, index, { translateT: value }), { status: `Layer ${index + 1} shifted.` })}
            />
          </Field>
          {sampler.mapMode !== 'texcoord' && (
            <>
              <Field label="Reference camera" hint="-1 = none">
                <NumberInput
                  label={`Layer ${index + 1} reference camera`}
                  value={srt.refCamera}
                  min={-1}
                  integer
                  step={1}
                  onChange={(value) => onChange(patchTexSrt(doc, index, { refCamera: value }), { transient: true })}
                  onCommit={(value) => onChange(patchTexSrt(doc, index, { refCamera: value }), { status: `Layer ${index + 1} reference camera ${value}.` })}
                />
              </Field>
              <Field label="Reference light" hint="-1 = none">
                <NumberInput
                  label={`Layer ${index + 1} reference light`}
                  value={srt.refLight}
                  min={-1}
                  integer
                  step={1}
                  onChange={(value) => onChange(patchTexSrt(doc, index, { refLight: value }), { transient: true })}
                  onCommit={(value) => onChange(patchTexSrt(doc, index, { refLight: value }), { status: `Layer ${index + 1} reference light ${value}.` })}
                />
              </Field>
            </>
          )}
        </FieldGroup>
      )}

      {texGen && (
        <FieldGroup title="Coordinates">
          <Field label="Generated as">
            <Select
              label={`Layer ${index + 1} texgen type`}
              value={String(texGen.type)}
              options={TEX_GEN_TYPE_OPTIONS}
              onChange={(value) => onChange(patchTexGen(doc, index, { type: Number(value) as never }), { status: `Layer ${index + 1} coordinates changed.` })}
            />
          </Field>
          <Field label="From">
            <Select
              label={`Layer ${index + 1} texgen source`}
              value={String(texGen.source)}
              options={TEX_GEN_SOURCE_OPTIONS}
              onChange={(value) => onChange(patchTexGen(doc, index, { source: Number(value) as never }), { status: `Layer ${index + 1} coordinate source changed.` })}
            />
          </Field>
          <Field label="Through matrix">
            <Select
              label={`Layer ${index + 1} texgen matrix`}
              value={String(texGen.matrix)}
              options={TEX_GEN_MATRIX_OPTIONS}
              onChange={(value) => onChange(patchTexGen(doc, index, { matrix: Number(value) as never }), { status: `Layer ${index + 1} matrix changed.` })}
            />
          </Field>
          <Field label="Normalize">
            <Toggle
              label={texGen.normalize ? 'On' : 'Off'}
              checked={texGen.normalize}
              onChange={(checked) => onChange(patchTexGen(doc, index, { normalize: checked }), { status: `Layer ${index + 1} normalize ${checked ? 'on' : 'off'}.` })}
            />
          </Field>
        </FieldGroup>
      )}

      <div className="materialLayerImport">
        <div className="materialLayerImportRow">
          <Select
            label={`Layer ${index + 1} import format`}
            size="sm"
            value={String(format)}
            options={TEXTURE_FORMAT_OPTIONS}
            onChange={(value) => setFormat(Number(value))}
          />
          <Select
            label={`Layer ${index + 1} import size`}
            size="sm"
            value={String(size)}
            options={[32, 64, 128, 256, 512, 1024].map((value) => ({ value: String(value), label: `${value} x ${value}` }))}
            onChange={(value) => setSize(Number(value))}
          />
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
        </div>
        <div className="materialLayerImportRow">
          <Button
            size="sm"
            variant="ghost"
            icon={<Upload size={13} />}
            disabled={busy}
            disabledReason="Still encoding the last image."
            onClick={() => fileRef.current?.click()}
          >
            Import PNG…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={13} />}
            disabled={!texture || !archiveBytes}
            disabledReason="This layer's texture is not in the archive."
            onClick={() => {
              if (!texture || !archiveBytes) return;
              void exportTextureAsPng(archiveBytes, texture).catch((error: unknown) =>
                toast.showToast({ tone: 'error', title: 'Could not export the texture', detail: error instanceof Error ? error.message : String(error) }),
              );
            }}
          >
            Export PNG
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="materialFileInput"
            aria-label={`Import a texture for layer ${index + 1}`}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importFile(file);
            }}
          />
        </div>
        <p className="materialLayerHint">Drop a PNG on this card to import it straight into the layer.</p>
      </div>
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
