import { Download, Image as ImageIcon, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { canEncodeTex0Format, maxMipCount } from '../../lib/tex0Codec';
import { Button } from '../components/Button';
import { InspectorHeader } from '../inspector/InspectorHeader';
import { DetailsCategory, PropertyRow } from '../inspector/PropertySheet';
import { LazyTexture } from './MaterialsDock';
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
  /** Back to whatever was selected before. */
  onClose: () => void;
}

/**
 * One texture: a big preview, its size and format, which materials use it, and the replace and
 * export buttons. A replacement is written straight into the archive bytes, so it is bounded by
 * the space the original texture reserved; the size picker says which sizes fit.
 */
export function TextureInspector({ archivePath, archiveBytes, texture, textureRevision, onReplace, onExport, onClose }: TextureInspectorProps) {
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

  const users = texture.usedBy.map((user) => {
    const [modelName, materialName] = user.split('/');
    return { key: user, modelName, materialName: materialName ?? user };
  });

  return (
    <>
      <InspectorHeader
        title={texture.name}
        typeName={`Texture, ${texture.width} x ${texture.height}`}
        media={<ImageIcon size={16} aria-hidden="true" />}
        actions={[{ id: 'close', label: 'Close', icon: <X size={14} />, onClick: onClose }]}
        sections={[]}
      />

      <DetailsCategory name="Preview" defaultOpen>
        <LazyTexture archivePath={archivePath} archiveBytes={archiveBytes} texture={texture} revision={textureRevision} size="large" />
        <div className="visualButtonRow visualActionRow">
          <Button size="sm" icon={<Download size={13} />} disabled={busy} onClick={() => void onExport(texture)}>
            Export as PNG
          </Button>
        </div>
      </DetailsCategory>

      <DetailsCategory name="Replace image" defaultOpen>
        {writable ? (
          <>
            <PropertyRow label="Size" help="Larger sizes need more room than this texture reserved and are greyed out.">
              <select value={sizeIndex} onChange={(event) => setSizeIndex(Number(event.currentTarget.value))} disabled={busy}>
                {sizes.map((option, index) => (
                  <option key={option.label} value={index} disabled={!option.fits}>
                    {option.label}
                    {option.fits ? '' : ' (does not fit)'}
                  </option>
                ))}
              </select>
            </PropertyRow>
            <PropertyRow label="Detail levels" help="Smaller copies of the image the game switches to at a distance. More levels look smoother far away.">
              <input
                type="number"
                min={1}
                max={mipLimit}
                step={1}
                value={Math.min(mipCount, mipLimit)}
                disabled={busy}
                onChange={(event) => setMipCount(Math.max(1, Math.min(mipLimit, Number(event.currentTarget.value) || 1)))}
              />
            </PropertyRow>
            <div className="visualButtonRow visualActionRow">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                aria-label={`Replace ${texture.name}`}
                disabled={busy}
                onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
              />
              <Button size="sm" variant="primary" icon={<Upload size={13} />} disabled={busy} onClick={() => fileInputRef.current?.click()}>
                {busy ? 'Working...' : 'Choose an image'}
              </Button>
            </div>
            <p className="visualRowNote">
              Saved in {texture.formatLabel}, in the {formatByteSize(texture.dataCapacity)} this texture already uses. It shows in the viewport straight away.
            </p>
          </>
        ) : (
          <p className="visualRowNote">{texture.formatLabel} textures can be viewed and exported but not replaced yet.</p>
        )}
        {error && <p className="visualNote error visualRowNote">{error}</p>}
        {notes.map((note) => (
          <p key={note} className="visualRowNote">
            {note}
          </p>
        ))}
      </DetailsCategory>

      <DetailsCategory name="Used by" badge={users.length} defaultOpen={users.length <= 6}>
        {users.length === 0 ? (
          <p className="visualRowNote">No material in this file uses this texture.</p>
        ) : (
          users.map((user) => (
            <PropertyRow key={user.key} label={user.materialName} help={`In ${user.modelName}`}>
              <span className="visualMuted">{user.modelName}</span>
            </PropertyRow>
          ))
        )}
      </DetailsCategory>

      <DetailsCategory name="Advanced" defaultOpen={false}>
        <PropertyRow label="Format">
          <span className="visualMuted">{texture.formatLabel}</span>
        </PropertyRow>
        <PropertyRow label="Size in file">
          <span className="visualMuted">{formatByteSize(texture.byteLength)}</span>
        </PropertyRow>
        <PropertyRow label="Detail levels">
          <span className="visualMuted">{texture.mipCount}</span>
        </PropertyRow>
      </DetailsCategory>
    </>
  );
}
