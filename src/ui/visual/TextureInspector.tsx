import { useEffect, useMemo, useRef, useState } from 'react';
import { canEncodeTex0Format, maxMipCount } from '../../lib/tex0Codec';
import { TexturePreview } from './TexturePreview';
import { listReplacementSizes, type BuildReplacementOptions } from './textureReplace';
import { formatByteSize, type VisualTextureInfo } from './visualArchive';

export interface TextureInspectorProps {
  archivePath: string;
  archiveBytes: Uint8Array | null;
  texture: VisualTextureInfo;
  textureRevision: number;
  /** Resolves with any notes about the replacement (resizes, reduced mips); rejects with a reason. */
  onReplace: (texture: VisualTextureInfo, file: File, options: BuildReplacementOptions) => Promise<string[]>;
  onExport: (texture: VisualTextureInfo) => Promise<void>;
  /** Jump to a material that samples this texture. */
  onSelectMaterial: (modelName: string, materialName: string) => void;
}

/**
 * One TEX0: a decoded preview, its GX format details, the materials that sample it, and the
 * import/export controls. A replacement is written straight into the archive bytes, so it is
 * bounded by the space the original texture reserved — the size picker says which sizes fit.
 */
export function TextureInspector({
  archivePath,
  archiveBytes,
  texture,
  textureRevision,
  onReplace,
  onExport,
  onSelectMaterial,
}: TextureInspectorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sizeIndex, setSizeIndex] = useState(0);
  const [mipCount, setMipCount] = useState(texture.mipCount);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sizes = useMemo(() => listReplacementSizes(texture), [texture]);
  const writable = canEncodeTex0Format(texture.format);

  // Reset the controls whenever the author picks a different texture.
  useEffect(() => {
    setSizeIndex(0);
    setMipCount(texture.mipCount);
    setNotes([]);
    setError(null);
  }, [texture.name, texture.mipCount]);

  const size = sizes[sizeIndex] ?? sizes[0];
  const mipLimit = size ? maxMipCount(size.width, size.height) : 1;

  async function handleFile(file: File | undefined) {
    if (!file || !size) return;
    setBusy(true);
    setError(null);
    setNotes([]);
    try {
      const resultNotes = await onReplace(texture, file, {
        width: size.width,
        height: size.height,
        mipCount: Math.min(mipCount, mipLimit),
      });
      setNotes(resultNotes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <>
      <h2>Texture</h2>
      <div className="visualInspectorHeader">
        <strong>{texture.name}</strong>
        <div className="visualTagRow">
          <span className="visualTag">
            {texture.width} x {texture.height}
          </span>
          <span className="visualTag">{texture.formatLabel}</span>
          <span className="visualTag">{texture.mipCount} mip level{texture.mipCount === 1 ? '' : 's'}</span>
          <span className="visualTag">{formatByteSize(texture.byteLength)}</span>
        </div>
      </div>

      <TexturePreview archivePath={archivePath} archiveBytes={archiveBytes} texture={texture} revision={textureRevision} size="large" />

      <div className="propertyGrid">
        <label>
          Used by
          <span>
            {texture.usedBy.length === 0
              ? 'No material in this archive samples this texture.'
              : `${texture.usedBy.length} material${texture.usedBy.length === 1 ? '' : 's'}`}
          </span>
        </label>
      </div>
      {texture.usedBy.length > 0 && (
        <div className="visualButtonRow">
          {texture.usedBy.map((user) => {
            const [modelName, materialName] = user.split('/');
            return (
              <button key={user} type="button" className="visualInlineButton" onClick={() => onSelectMaterial(modelName, materialName)}>
                {materialName}
              </button>
            );
          })}
        </div>
      )}

      <h2>Replace</h2>
      {writable ? (
        <>
          <div className="propertyGrid">
            <label>
              Size
              <select value={sizeIndex} onChange={(event) => setSizeIndex(Number(event.currentTarget.value))} disabled={busy}>
                {sizes.map((option, index) => (
                  <option key={option.label} value={index} disabled={!option.fits}>
                    {option.label}
                    {option.fits ? '' : ' (does not fit)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mip levels
              <input
                type="number"
                min={1}
                max={mipLimit}
                step={1}
                value={Math.min(mipCount, mipLimit)}
                disabled={busy}
                onChange={(event) => setMipCount(Math.max(1, Math.min(mipLimit, Number(event.currentTarget.value) || 1)))}
              />
            </label>
          </div>
          <p className="visualNote">
            The new image is re-encoded to {texture.formatLabel} and written into the space this texture already reserves
            ({formatByteSize(texture.dataCapacity)}), so it shows in the viewport immediately and exports with the track.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label={`Replace ${texture.name}`}
            disabled={busy}
            onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
          />
        </>
      ) : (
        <p className="visualNote warning">
          {texture.formatLabel} textures can be read but not written by this editor yet, so this one cannot be replaced.
        </p>
      )}

      {busy && <p className="visualNote">Encoding...</p>}
      {error && <p className="visualNote error">{error}</p>}
      {notes.map((note) => (
        <p key={note} className="visualNote">
          {note}
        </p>
      ))}

      <div className="visualButtonRow">
        <button type="button" className="visualInlineButton" disabled={busy} onClick={() => void onExport(texture)}>
          Export as PNG
        </button>
      </div>
    </>
  );
}
