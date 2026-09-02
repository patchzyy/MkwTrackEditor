// Built-in object catalog plus the shared object naming/search helpers used by the content
// browser and the inspector. Extracted from src/ui/App.tsx.
import { getObjFlowResourceNames, type CommonResourceArchive, type ObjFlowEntry } from '../../lib/objflow';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import { getKnownObjectName, shortAssetName } from '../labels';

export const objectCatalog = [
  { id: 0x65, label: 'Item Box', category: 'Gameplay' },
  { id: 0x191, label: 'Goomba', category: 'Enemies' },
  { id: 0x192, label: 'Monty Mole', category: 'Enemies' },
  { id: 0x194, label: 'Piranha Plant', category: 'Enemies' },
  { id: 0x148, label: 'Moving Platform', category: 'Gameplay' },
  { id: 0xe5, label: 'Crab', category: 'Enemies' },
  { id: 0xce, label: 'Shy Guy Obstacle', category: 'Gameplay' },
  { id: 0x197, label: 'Cataquack', category: 'Enemies' },
  { id: 0x1a5, label: 'Fire Bar', category: 'Gameplay' },
  { id: 0x162, label: 'Thwomp', category: 'Gameplay' },
  { id: 0x261, label: 'Cannon Object', category: 'Gameplay' },
];

export const featuredObjectIds = [0x65, 0x191, 0x192, 0x194, 0x148, 0xe5, 0xce, 0x197, 0x1a5, 0x162, 0x261] as const;
export interface ObjectOption {
  id: number;
  label: string;
  detail: string;
}

export type BrowserObject = (typeof objectCatalog)[number] | ObjFlowEntry;

export function catalogId(object: (typeof objectCatalog)[number] | ObjFlowEntry): number {
  return 'id' in object ? object.id : object.objectId;
}
export function objectAssetLabel(object: (typeof objectCatalog)[number] | ObjFlowEntry, common: CommonResourceArchive | null, summaries: Record<string, NoclipBrresSummary>): string {
  if ('category' in object) return object.category;
  const resources = objectResources(object);
  if (resources.length === 0) return 'Game Object';
  const available = resources.filter((resource) => common?.byBaseName.has(resource.toLowerCase())).length;
  const summary = firstResourceSummary(resources, summaries);
  return summary
    ? `${available}/${resources.length} resources · ${summary.models.length} models · ${summary.textures.length} textures`
    : `${available}/${resources.length} resources · ${resources.slice(0, 2).map(shortAssetName).join(', ')}`;
}

export function browserObjectTitle(object: (typeof objectCatalog)[number] | ObjFlowEntry): string {
  const knownName = getKnownObjectName(catalogId(object));
  if (knownName) return knownName;
  if ('label' in object) return object.label;
  return object.name || object.resources || 'Unknown object';
}

export function countAvailableResources(object: ObjFlowEntry, common: CommonResourceArchive | null): number {
  return getObjFlowResourceNames(object).filter((resource) => common?.byBaseName.has(resource.toLowerCase())).length;
}

export function objectResources(object: (typeof objectCatalog)[number] | ObjFlowEntry): string[] {
  return 'resources' in object ? getObjFlowResourceNames(object) : [];
}
export function isFeaturedObject(object: BrowserObject): boolean {
  const text = objectSearchText(object);
  return /(kuribo|goomba|tree|item|box|cannon|pakkun|choropu|npc_mii|pendulum|lift|kinoko)/.test(text);
}

export function objectSearchText(object: BrowserObject): string {
  return [
    browserObjectTitle(object),
    'label' in object ? object.label : object.name,
    'category' in object ? object.category : '',
    ...objectResources(object),
  ]
    .join(' ')
    .toLowerCase();
}
export function isBrowsableObjectEntry(entry: ObjFlowEntry): boolean {
  const text = objectSearchText(entry);
  return !/(^|\s)(dummy|escalator_group|sound_lift|truckchimsmk|truckchimsmkw)(\s|$)/.test(text);
}

export function isBrowsableObjectChoice(id: number, label: string, detail: string): boolean {
  const text = `${getKnownObjectName(id) ?? ''} ${label} ${detail}`.toLowerCase();
  return !/(^|\s)(dummy|escalator_group|sound_lift|truckchimsmk|truckchimsmkw)(\s|$)/.test(text);
}
export function firstResourceSummary(resources: string[], summaries: Record<string, NoclipBrresSummary>): NoclipBrresSummary | undefined {
  for (const resource of resources) {
    const summary = summaries[resource.toLowerCase()];
    if (summary) return summary;
  }
  return undefined;
}
