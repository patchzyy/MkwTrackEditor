/**
 * One normalised record per content-browser tile.
 *
 * The tile grid, the keyboard navigation and the details pane all read the same entry, so a
 * tile and its details can never disagree. Everything here is pure so it is unit tested in
 * `browserEntries.test.ts`; the thumbnails stay in the React components.
 */

import type { PlaceableCourseAssetRecord } from '../../lib/courseAssets';
import type { AppendableKmpSection } from '../../lib/kmp';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import { describeBrres, describeCourseAsset, friendlySectionSingularLabel, friendlyTrackAssetName, shortAssetName } from '../labels';
import { browserObjectTitle, catalogId, firstResourceSummary, objectAssetLabel, objectResources, type BrowserObject } from '../objects/objectCatalog';
import { isCourseAssetBrowserItem, type BrowserFolder } from './browserFolders';

/** Drag payload types the viewport listens for. */
export const OBJECT_DRAG_TYPE = 'application/mkw-object-id';
export const POINT_DRAG_TYPE = 'application/mkw-point-section';

export type BrowserEntry =
  | { id: string; kind: 'point'; label: string; caption: string; section: AppendableKmpSection; category: string }
  | { id: string; kind: 'object'; label: string; caption: string; objectId: number; object: BrowserObject }
  | { id: string; kind: 'courseAsset'; label: string; caption: string; objectId: number | null; asset: PlaceableCourseAssetRecord }
  | { id: string; kind: 'trackAsset'; label: string; caption: string; path: string };

export interface BrowserFact {
  label: string;
  value: string;
}

/** What a drag of this entry puts on the data transfer, or `null` if it cannot be placed. */
export function browserEntryDrag(entry: BrowserEntry): { type: string; value: string } | null {
  if (entry.kind === 'point') return { type: POINT_DRAG_TYPE, value: entry.section };
  if (entry.kind === 'object') return { type: OBJECT_DRAG_TYPE, value: String(entry.objectId) };
  if (entry.kind === 'courseAsset' && entry.objectId !== null) return { type: OBJECT_DRAG_TYPE, value: String(entry.objectId) };
  return null;
}

/** Hover/aria text: what the entry is and whether it can be dragged into the scene. */
export function browserEntryHint(entry: BrowserEntry): string {
  if (browserEntryDrag(entry)) return `${entry.label} - drag into the viewport to place`;
  if (entry.kind === 'courseAsset') return `${entry.label} - this model has no placeable object id`;
  return `${entry.label} - ${entry.caption}`;
}

/** Flattens a folder into tiles. Folder kinds map one-to-one onto entry kinds. */
export function browserFolderEntries(
  folder: BrowserFolder | null,
  context: {
    track: TrackDocument | null;
    commonArchive: CommonResourceArchive | null;
    commonBrresSummaries: Record<string, NoclipBrresSummary>;
  },
): BrowserEntry[] {
  if (!folder) return [];
  if (folder.kind === 'kmp') {
    return folder.items.map((item) => ({
      id: `point:${item.section}`,
      kind: 'point' as const,
      label: item.label,
      caption: item.category,
      section: item.section,
      category: item.category,
    }));
  }
  if (folder.kind === 'brres') {
    return folder.items.map((path) => ({
      id: `asset:${path}`,
      kind: 'trackAsset' as const,
      label: friendlyTrackAssetName(path),
      caption: describeBrres(context.track?.brresSummaries[path]) || 'Track asset archive',
      path,
    }));
  }
  return folder.items.map((item) =>
    isCourseAssetBrowserItem(item)
      ? {
          id: `courseAsset:${item.id}`,
          kind: 'courseAsset' as const,
          label: item.objectLabel ?? item.baseName.replace(/\.brres$/i, ''),
          caption: describeCourseAsset(item),
          objectId: item.objectId,
          asset: item,
        }
      : {
          id: `object:${catalogId(item)}`,
          kind: 'object' as const,
          label: browserObjectTitle(item),
          caption: objectAssetLabel(item, context.commonArchive, context.commonBrresSummaries),
          objectId: catalogId(item),
          object: item,
        },
  );
}

/** Sentence case, so `friendlySectionSingularLabel`'s lower-case names read as a value. */
function sentenceCase(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function summaryFacts(summary: NoclipBrresSummary | undefined): BrowserFact[] {
  if (!summary) return [];
  const facts: BrowserFact[] = [];
  const model = summary.models[0];
  if (model) facts.push({ label: 'Model', value: `${model.name} - ${model.shapes} shapes, ${model.materials} materials` });
  if (summary.models.length > 1) facts.push({ label: 'Models', value: String(summary.models.length) });
  if (summary.textures.length > 0) {
    const biggest = [...summary.textures].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    facts.push({ label: 'Textures', value: `${summary.textures.length}, largest ${biggest.width}x${biggest.height} ${biggest.format}` });
  }
  const animations = Object.entries(summary.animations)
    .filter(([, names]) => names.length > 0)
    .map(([kind, names]) => `${names.length} ${kind.toUpperCase()}`);
  if (animations.length > 0) facts.push({ label: 'Animations', value: animations.join(', ') });
  return facts;
}

/**
 * Label/value rows for the details pane. Deliberately free of internal ids and file paths,
 * except where the path *is* the thing being described (a track's own asset files).
 */
export function browserEntryFacts(
  entry: BrowserEntry,
  context: {
    track: TrackDocument | null;
    commonArchive: CommonResourceArchive | null;
    commonBrresSummaries: Record<string, NoclipBrresSummary>;
  },
): BrowserFact[] {
  switch (entry.kind) {
    case 'point':
      return [
        { label: 'Kind', value: sentenceCase(friendlySectionSingularLabel(entry.section)) },
        { label: 'Category', value: entry.category },
        { label: 'How to place', value: 'Drag it onto the track where you want the point' },
      ];
    case 'object': {
      const resources = objectResources(entry.object);
      const available = resources.filter((resource) => context.commonArchive?.byBaseName.has(resource.toLowerCase()));
      const summary = firstResourceSummary(resources, context.commonBrresSummaries);
      const facts: BrowserFact[] = [{ label: 'Object id', value: `0x${entry.objectId.toString(16).toUpperCase()} (${entry.objectId})` }];
      if (resources.length > 0) {
        facts.push({ label: 'Models', value: resources.map(shortAssetName).join(', ') });
        facts.push({
          label: 'Available',
          value: available.length === resources.length ? 'All models are loaded' : `${available.length} of ${resources.length} models loaded`,
        });
      } else {
        facts.push({ label: 'Available', value: 'Import Common.szs to load this model' });
      }
      return [...facts, ...summaryFacts(summary)];
    }
    case 'courseAsset': {
      const summary = context.commonBrresSummaries[entry.asset.baseName.toLowerCase()];
      return [
        { label: 'From', value: entry.asset.trackLabel },
        {
          label: 'Object id',
          value: entry.objectId === null ? 'Not placeable - no matching object' : `0x${entry.objectId.toString(16).toUpperCase()} (${entry.objectId})`,
        },
        { label: 'Model file', value: shortAssetName(entry.asset.baseName) },
        ...summaryFacts(summary),
      ];
    }
    case 'trackAsset': {
      const summary = context.track?.brresSummaries[entry.path];
      return [
        { label: 'In this track', value: friendlyTrackAssetName(entry.path) },
        { label: 'File', value: entry.path.replace(/^\.?\/*/, '') },
        ...summaryFacts(summary),
      ];
    }
  }
}
