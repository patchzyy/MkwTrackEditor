import { BinReader } from './binary';
import { decodeYaz0, isYaz0 } from './yaz0';
import { parseU8, type U8Entry } from './u8';

export interface ObjFlowEntry {
  objectId: number;
  name: string;
  resources: string;
}

export interface ObjFlowTable {
  entries: ObjFlowEntry[];
  byId: Map<number, ObjFlowEntry>;
}

export interface CommonResourceArchive {
  objFlow: ObjFlowTable;
  resourceEntries: U8Entry[];
  byBaseName: Map<string, U8Entry>;
}

export function parseObjFlow(data: Uint8Array): ObjFlowTable {
  const reader = new BinReader(data.slice().buffer);
  const count = reader.u16(0);
  const entries: ObjFlowEntry[] = [];
  for (let i = 0, offset = 0x02; i < count && offset + 0x74 <= data.length; i++, offset += 0x74) {
    const objectId = reader.u16(offset);
    const name = reader.ascii(offset + 0x02, 0x20);
    const resources = reader.ascii(offset + 0x22, 0x40);
    entries.push({ objectId, name, resources });
  }
  return { entries, byId: new Map(entries.map((entry) => [entry.objectId, entry])) };
}

export function parseObjFlowContainer(data: Uint8Array): ObjFlowTable {
  return parseCommonResourceArchive(data).objFlow;
}

export function parseCommonResourceArchive(data: Uint8Array): CommonResourceArchive {
  if (!isYaz0(data) && data[0] !== 0x55) {
    const objFlow = parseObjFlow(data);
    return { objFlow, resourceEntries: [], byBaseName: new Map() };
  }

  const decoded = decodeYaz0(data);
  const entries = parseU8(decoded);
  const objFlow = entries.find((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('objflow.bin'));
  if (!objFlow?.data) throw new Error('ObjFlow.bin not found in archive.');
  const resourceEntries = entries.filter((entry) => entry.type === 'file' && entry.data);
  const byBaseName = new Map<string, U8Entry>();
  for (const entry of resourceEntries) {
    const baseName = entry.path.split('/').pop()?.toLowerCase();
    if (baseName && !byBaseName.has(baseName)) byBaseName.set(baseName, entry);
  }
  return { objFlow: parseObjFlow(objFlow.data), resourceEntries, byBaseName };
}

export function mergeCommonResourceEntries(common: CommonResourceArchive, extraEntries: U8Entry[]): CommonResourceArchive {
  const resourceEntries = [...common.resourceEntries];
  const byBaseName = new Map(common.byBaseName);
  for (const entry of extraEntries) {
    if (entry.type !== 'file' || !entry.data) continue;
    const baseName = entry.path.split('/').pop()?.toLowerCase();
    if (!baseName || byBaseName.has(baseName)) continue;
    resourceEntries.push(entry);
    byBaseName.set(baseName, entry);
  }
  return { ...common, resourceEntries, byBaseName };
}

export function getObjFlowResourceNames(entry: ObjFlowEntry): string[] {
  return entry.resources
    .split(/[\s,;]+/)
    .map((resource) => resource.trim())
    .filter((resource) => resource && resource !== '-')
    .map((resource) => {
      const baseName = resource.split('/').pop() ?? resource;
      return /\.[a-z0-9]+$/i.test(baseName) ? baseName : `${baseName}.brres`;
    });
}
