import { Boxes } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CreateKit } from '../../../lib/create/types';
import { ObjectThumbnail } from '../../contentBrowser/ObjectThumbnail';
import { kitImageUrl } from '../kitImages';
import type { CreateAssets } from './assets';

/** The picture on a palette tile or a picker card: a kit thumbnail, an object render or an icon. */
export function SurfaceThumb({ kit, surfaceId, size = 56, className }: { kit: CreateKit | null; surfaceId: string; size?: number; className?: string }) {
  const surface = kit?.surface(surfaceId) ?? null;
  const url = kitImageUrl(kit, surface?.thumbnail);
  return (
    <span className={`crThumb${className ? ` ${className}` : ''}`} style={{ width: size, height: size, backgroundImage: url ? `url(${url})` : undefined }} aria-hidden="true" />
  );
}

/** A render of a game object (tree, sign, Goomba...) from the editor's shared object archive. */
export function ObjectArt({ objectId, assets, fallback }: { objectId: number; assets: CreateAssets; fallback?: ReactNode }) {
  const entry = assets.common?.objFlow.byId.get(objectId) ?? null;
  if (!entry) return <span className="crObjectFallback">{fallback ?? <Boxes size={22} />}</span>;
  return (
    <span className="crObjectArt">
      <ObjectThumbnail object={entry} common={assets.common} summaries={assets.summaries} />
    </span>
  );
}
