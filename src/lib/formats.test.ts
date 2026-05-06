import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeYaz0, encodeYaz0Uncompressed, isYaz0 } from './yaz0';
import { buildU8, parseU8 } from './u8';
import {
  appendKmpArea,
  appendKmpCamera,
  appendKmpCheckpoint,
  appendKmpGobj,
  appendKmpPoint,
  appendKmpPotiPoint,
  appendKmpPotiRoute,
  deleteKmpEntity,
  getKmpCameraHeader,
  mergeKmpPathGroupWithNext,
  moveKmpEntity,
  parseKmp,
  patchKmpAreaField,
  patchKmpBattleFinishField,
  patchKmpCameraField,
  patchKmpCameraHeaderField,
  patchKmpCameraViewPosition,
  patchKmpCannonField,
  patchKmpCheckpointEndpoint,
  patchKmpCheckpointField,
  patchKmpEntityPosition,
  patchKmpEntityRotation,
  patchKmpEntityRouteIndex,
  patchKmpEntityScale,
  patchKmpGobjObjectId,
  patchKmpGobjPresenceFlags,
  patchKmpGobjSetting,
  patchKmpPathGroupLinks,
  patchKmpPointDeviation,
  patchKmpPointSetting,
  patchKmpPotiPointSetting,
  patchKmpPotiRouteSetting,
  patchKmpRespawnField,
  patchKmpStageField,
  patchKmpStageFlareColor,
  splitKmpPathGroup,
} from './kmp';
import { parseKcl, raycastMesh, snapPointToTriangleFeature } from './kcl';
import { getObjFlowResourceNames, mergeCommonResourceEntries, parseCommonResourceArchive, parseObjFlowContainer } from './objflow';
import { parseNoclipBrresSummary } from './noclipBrres';
import { exportTrack, getExportArchiveEntries, validateExportBytes, validateTrack, type TrackDocument } from './track';

const sampleTrack = '/mnt/c/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks/0.szs';
const realTrackDirs = [
  '/mnt/c/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/Tracks',
  '/mnt/c/Users/patchzy/AppData/Roaming/Dolphin Emulator/Load/Riivolution/WheelWizard/RRBeta/CT/Tracks',
];
const commonArchive = '/mnt/g/Games/Wii/mkwii-europe/Race/Common.szs';
const bundledObjectBrres = '/mnt/g/ai/MkwTrackEditor/public/data/MarioKartWii/Race/Course/Object/kuribo.brres';
const extractedAssetPool = '/mnt/g/ai/MkwTrackEditor/public/data/MarioKartWii/Race/Course/ExtractedAssets.u8';
const realTrackSamples = collectRealTrackSamples(realTrackDirs, 8);

function collectRealTrackSamples(dirs: string[], limit: number): string[] {
  const out: string[] = [];
  const perDir = Math.max(1, Math.ceil(limit / Math.max(1, dirs.length)));
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let fromDir = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.szs')) {
        out.push(join(dir, entry.name));
        fromDir++;
      }
      if (fromDir >= perDir) break;
      if (out.length >= limit) return out;
    }
  }
  return out;
}

describe('Yaz0', () => {
  it('round-trips uncompressed encoded data', () => {
    const source = new TextEncoder().encode('Mario Kart Wii editor data');
    const encoded = encodeYaz0Uncompressed(source);
    expect(isYaz0(encoded)).toBe(true);
    expect([...decodeYaz0(encoded)]).toEqual([...source]);
  });
});

describe('U8', () => {
  it('round-trips a small archive', () => {
    const entries = [
      { path: 'course.kmp', type: 'file' as const, data: new Uint8Array([1, 2, 3]) },
      { path: 'objects/itembox.brres', type: 'file' as const, data: new Uint8Array([4, 5]) },
    ];
    const archive = buildU8(entries);
    const parsed = parseU8(archive);
    expect(parsed.filter((entry) => entry.type === 'file').map((entry) => entry.path).sort()).toEqual(['course.kmp', 'objects/itembox.brres']);
  });

  it.runIf(existsSync(commonArchive))('opens the real Common.szs archive', () => {
    const commonBytes = new Uint8Array(readFileSync(commonArchive));
    const archive = decodeYaz0(commonBytes);
    const entries = parseU8(archive);
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.some((entry) => entry.path.toLowerCase().includes('obj'))).toBe(true);
    const objFlow = parseObjFlowContainer(commonBytes);
    expect(objFlow.entries.length).toBeGreaterThan(100);
    expect(objFlow.byId.get(0x65)?.name).toBeTruthy();
  });

  it.runIf(existsSync(commonArchive) && existsSync(bundledObjectBrres))('merges bundled course object BRRES resources into Common metadata', () => {
    const common = parseCommonResourceArchive(new Uint8Array(readFileSync(commonArchive)));
    const merged = mergeCommonResourceEntries(common, [{ path: 'Object/kuribo.brres', type: 'file', data: new Uint8Array(readFileSync(bundledObjectBrres)) }]);
    expect(merged.byBaseName.has('kuribo.brres')).toBe(true);
    expect(merged.resourceEntries.length).toBe(common.resourceEntries.length + (common.byBaseName.has('kuribo.brres') ? 0 : 1));
    const object = merged.objFlow.entries.find((entry) => getObjFlowResourceNames(entry).some((resource) => resource.toLowerCase() === 'kuribo.brres'));
    expect(object?.name).toBeTruthy();
  });

  it.runIf(existsSync(commonArchive) && existsSync(extractedAssetPool))('resolves extracted common resources for featured browser objects including crab', () => {
    const common = parseCommonResourceArchive(new Uint8Array(readFileSync(commonArchive)));
    const extractedEntries = parseU8(new Uint8Array(readFileSync(extractedAssetPool))).filter((entry) => entry.type === 'file' && entry.data);
    const merged = mergeCommonResourceEntries(common, extractedEntries);
    const featuredObjectIds = [0x65, 0x191, 0x192, 0x194, 0x148, 0x0e5, 0x0ce, 0x197, 0x1a5, 0x162, 0x261];

    for (const objectId of featuredObjectIds) {
      const object = merged.objFlow.byId.get(objectId);
      expect(object, `ObjFlow entry missing for ${objectId.toString(16)}`).toBeTruthy();
      const resources = getObjFlowResourceNames(object!);
      if (resources.length === 0) continue;
      expect(
        resources.some((resource) => merged.byBaseName.has(resource.toLowerCase())),
        `${object?.name ?? objectId.toString(16)} is missing all referenced resources`,
      ).toBe(true);
    }

    expect(merged.byBaseName.has('crab.brres')).toBe(true);
  });
});

describe('KCL raycasting', () => {
  it('intersects collision triangles from either side for 3D picking', () => {
    const mesh = {
      warnings: [],
      triangles: [
        {
          a: { x: 0, y: 0, z: 0 },
          b: { x: 100, y: 0, z: 0 },
          c: { x: 0, y: 0, z: 100 },
          flag: 0,
          typeName: 'Road',
          normal: { x: 0, y: 1, z: 0 },
        },
      ],
    };
    expect(raycastMesh(mesh, { x: 20, y: 50, z: 20 }, { x: 0, y: -1, z: 0 })?.position.y).toBeCloseTo(0);
    expect(raycastMesh(mesh, { x: 20, y: -50, z: 20 }, { x: 0, y: 1, z: 0 })?.position.y).toBeCloseTo(0);
  });

  it('snaps hit points to the nearest triangle vertex or edge feature', () => {
    const triangle = {
      a: { x: 0, y: 0, z: 0 },
      b: { x: 100, y: 0, z: 0 },
      c: { x: 0, y: 0, z: 100 },
      flag: 0,
      typeName: 'Road',
      normal: { x: 0, y: 1, z: 0 },
    };
    const nearVertex = snapPointToTriangleFeature({ x: -4, y: 0, z: -6 }, triangle);
    expect(nearVertex.kind).toBe('vertex');
    expect(nearVertex.position).toEqual({ x: 0, y: 0, z: 0 });

    const nearEdge = snapPointToTriangleFeature({ x: 46, y: 0, z: 8 }, triangle);
    expect(nearEdge.kind).toBe('edge');
    expect(nearEdge.position.x).toBeCloseTo(46);
    expect(nearEdge.position.y).toBeCloseTo(0);
    expect(nearEdge.position.z).toBeCloseTo(0);
  });
});

describe('MKW track loading', () => {
  it.runIf(existsSync(sampleTrack))('opens a real custom track and parses KMP sections', async () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    const courseKcl = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kcl'));
    const courseBrres = entries.find((entry) => entry.path.toLowerCase().endsWith('course_model.brres'));
    expect(courseKmp?.data).toBeTruthy();
    const kmp = parseKmp(courseKmp!.data!);
    expect(kmp.sections.some((section) => section.name === 'GOBJ')).toBe(true);
    expect(kmp.sections.some((section) => section.name === 'KTPT')).toBe(true);
    expect(kmp.pathGraphs.some((graph) => graph.pointSection === 'CKPT' && graph.edges.length > 0)).toBe(true);
    expect(kmp.pathGraphs.some((graph) => graph.pointSection === 'ENPT' && graph.groups.length > 0)).toBe(true);
    const enemyPoint = kmp.entities.find((entity) => entity.section === 'ENPT');
    if (enemyPoint?.pointSettings) {
      expect(enemyPoint.pointSettings.length).toBe(3);
      expect(typeof enemyPoint.pointDeviation).toBe('number');
      const enemyDeviation = enemyPoint.pointDeviation ?? 0;
      const editedEnemyPoint = parseKmp(
        patchKmpPointDeviation(
          parseKmp(patchKmpPointSetting(parseKmp(patchKmpPointSetting(kmp, enemyPoint, 0, 2)), enemyPoint, 2, 7)),
          enemyPoint,
          enemyDeviation + 5,
        ),
      ).entities.find((entity) => entity.id === enemyPoint.id);
      expect(editedEnemyPoint?.pointSettings?.[0]).toBe(2);
      expect(editedEnemyPoint?.pointSettings?.[2]).toBe(7);
      expect(editedEnemyPoint?.pointDeviation).toBeCloseTo(enemyDeviation + 5);
      const deletedEnemyPointKmp = parseKmp(deleteKmpEntity(kmp, enemyPoint));
      expect(deletedEnemyPointKmp.sections.find((section) => section.name === 'ENPT')?.count).toBe((kmp.sections.find((section) => section.name === 'ENPT')?.count ?? 0) - 1);
      const deletedEnemyGraph = deletedEnemyPointKmp.pathGraphs.find((graph) => graph.pointSection === 'ENPT');
      if (deletedEnemyGraph) {
        expect(deletedEnemyGraph.groups.reduce((sum, group) => sum + group.pointCount, 0)).toBeLessThanOrEqual(deletedEnemyPointKmp.sections.find((section) => section.name === 'ENPT')?.count ?? 0);
      }
    }
    const enemyGraph = kmp.pathGraphs.find((graph) => graph.pointSection === 'ENPT');
    const enemyLastGroup = enemyGraph?.groups.at(-1);
    if (enemyGraph && enemyGraph.groups.length > 0) {
      const linkedGroup = Math.min(1, enemyGraph.groups.length - 1);
      const linkEditedKmp = parseKmp(
        patchKmpPathGroupLinks(
          parseKmp(patchKmpPathGroupLinks(kmp, enemyGraph.groupSection, 0, 'next', [linkedGroup, linkedGroup, 0xff])),
          enemyGraph.groupSection,
          linkedGroup,
          'prev',
          [0],
        ),
      );
      const editedEnemyGraph = linkEditedKmp.pathGraphs.find((graph) => graph.pointSection === 'ENPT');
      expect(editedEnemyGraph?.groups[0]?.nextGroups).toEqual([linkedGroup]);
      expect(editedEnemyGraph?.groups[linkedGroup]?.prevGroups).toEqual([0]);
      const splittableGroup = enemyGraph.groups.find((group) => group.pointCount > 1);
      if (splittableGroup) {
        const splitKmp = parseKmp(splitKmpPathGroup(kmp, enemyGraph.pointSection, splittableGroup.index, 0));
        const splitGraph = splitKmp.pathGraphs.find((graph) => graph.pointSection === 'ENPT');
        expect(splitGraph?.groups.length).toBe(enemyGraph.groups.length + 1);
        expect(splitGraph?.groups[splittableGroup.index]?.pointCount).toBe(1);
        expect(splitGraph?.groups[splittableGroup.index]?.nextGroups).toEqual([splittableGroup.index + 1]);
        const mergedKmp = parseKmp(mergeKmpPathGroupWithNext(splitKmp, enemyGraph.pointSection, splittableGroup.index));
        const mergedGraph = mergedKmp.pathGraphs.find((graph) => graph.pointSection === 'ENPT');
        expect(mergedGraph?.groups.length).toBe(enemyGraph.groups.length);
        expect(mergedGraph?.groups[splittableGroup.index]?.pointCount).toBe(splittableGroup.pointCount);
      }
    }
    const originalEnemyCount = kmp.sections.find((section) => section.name === 'ENPT')?.count ?? 0;
    if (enemyLastGroup && enemyLastGroup.startIndex + enemyLastGroup.pointCount === originalEnemyCount) {
      const addedEnemyKmp = parseKmp(appendKmpPoint(kmp, 'ENPT', { x: 12, y: 34, z: 56 }));
      expect(addedEnemyKmp.pathGraphs.find((graph) => graph.pointSection === 'ENPT')?.groups.at(-1)?.pointCount).toBe(enemyLastGroup.pointCount + 1);
    }
    const enphSection = kmp.sections.find((section) => section.name === 'ENPH');
    if (enphSection && originalEnemyCount < 0xff) {
      const noEnemyGroupsBytes = new Uint8Array(kmp.original);
      new DataView(noEnemyGroupsBytes.buffer).setUint16(enphSection.offset + 4, 0, false);
      const addedEnemyKmp = parseKmp(appendKmpPoint(parseKmp(noEnemyGroupsBytes), 'ENPT', { x: 98, y: 76, z: 54 }));
      const createdGroup = addedEnemyKmp.pathGraphs.find((graph) => graph.pointSection === 'ENPT')?.groups[0];
      expect(createdGroup?.startIndex).toBe(originalEnemyCount);
      expect(createdGroup?.pointCount).toBe(1);
    }
    const itemPoint = kmp.entities.find((entity) => entity.section === 'ITPT');
    if (itemPoint?.pointSettings) {
      expect(itemPoint.pointSettings.length).toBe(2);
      expect(typeof itemPoint.pointDeviation).toBe('number');
      const itemDeviation = itemPoint.pointDeviation ?? 0;
      const editedItemPoint = parseKmp(
        patchKmpPointDeviation(parseKmp(patchKmpPointSetting(kmp, itemPoint, 1, 0x1234)), itemPoint, itemDeviation + 3),
      ).entities.find((entity) => entity.id === itemPoint.id);
      expect(editedItemPoint?.pointSettings?.[1]).toBe(0x1234);
      expect(editedItemPoint?.pointDeviation).toBeCloseTo(itemDeviation + 3);
    }
    expect(kmp.routes.length).toBe(kmp.sections.find((section) => section.name === 'POTI')?.count ?? 0);
    const routeNode = kmp.entities.find((entity) => entity.section === 'POTI');
    if (routeNode) {
      const movedRouteKmp = parseKmp(patchKmpEntityPosition(kmp, routeNode, { x: routeNode.position.x + 75, y: routeNode.position.y + 25, z: routeNode.position.z - 35 }));
      const movedNode = movedRouteKmp.routes[routeNode.routePoint!.routeIndex]?.points[routeNode.routePoint!.pointIndex];
      expect(movedNode?.position.x).toBeCloseTo(routeNode.position.x + 75);
      expect(movedNode?.position.y).toBeCloseTo(routeNode.position.y + 25);
      expect(movedNode?.position.z).toBeCloseTo(routeNode.position.z - 35);
      const editedRouteNode = parseKmp(patchKmpPotiPointSetting(parseKmp(patchKmpPotiRouteSetting(kmp, routeNode, 1, 0x12)), routeNode, 0, 0x3456)).entities.find((entity) => entity.id === routeNode.id);
      expect(editedRouteNode?.poti?.routeSetting2).toBe(0x12);
      expect(editedRouteNode?.poti?.pointSetting1).toBe(0x3456);
      const routeBefore = kmp.routes[routeNode.routePoint!.routeIndex];
      const addedNodeKmp = parseKmp(appendKmpPotiPoint(kmp, routeNode.routePoint!.routeIndex, routeNode.routePoint!.pointIndex, { x: 444, y: 555, z: 666 }));
      const routeAfter = addedNodeKmp.routes[routeNode.routePoint!.routeIndex];
      expect(routeAfter.points.length).toBe(routeBefore.points.length + 1);
      expect(routeAfter.points[routeNode.routePoint!.pointIndex + 1]?.position.x).toBeCloseTo(444);
      expect(routeAfter.points[routeNode.routePoint!.pointIndex + 1]?.position.y).toBeCloseTo(555);
      expect(routeAfter.points[routeNode.routePoint!.pointIndex + 1]?.position.z).toBeCloseTo(666);
      expect(addedNodeKmp.sections.find((section) => section.name === 'AREA')?.offset).toBeGreaterThan(kmp.sections.find((section) => section.name === 'AREA')?.offset ?? 0);
      const movedRouteNodeKmp = parseKmp(moveKmpEntity(addedNodeKmp, addedNodeKmp.entities.find((entity) => entity.id === `POTI-${routeNode.routePoint!.routeIndex}-${routeNode.routePoint!.pointIndex + 1}`)!, -1));
      expect(movedRouteNodeKmp.routes[routeNode.routePoint!.routeIndex].points[routeNode.routePoint!.pointIndex]?.position.x).toBeCloseTo(444);
      const deletedRouteNodeKmp = parseKmp(deleteKmpEntity(addedNodeKmp, addedNodeKmp.entities.find((entity) => entity.id === `POTI-${routeNode.routePoint!.routeIndex}-${routeNode.routePoint!.pointIndex + 1}`)!));
      expect(deletedRouteNodeKmp.routes[routeNode.routePoint!.routeIndex].points.length).toBe(routeBefore.points.length);
    }
    const originalRouteCount = kmp.routes.length;
    const addedRouteKmp = parseKmp(appendKmpPotiRoute(kmp, { x: 111, y: 222, z: 333 }));
    expect(addedRouteKmp.routes.length).toBe(originalRouteCount + 1);
    expect(addedRouteKmp.routes[originalRouteCount]?.points[0]?.position.x).toBeCloseTo(111);
    expect(addedRouteKmp.routes[originalRouteCount]?.points[0]?.position.y).toBeCloseTo(222);
    expect(addedRouteKmp.routes[originalRouteCount]?.points[0]?.position.z).toBeCloseTo(333);
    expect(addedRouteKmp.sections.find((section) => section.name === 'AREA')?.offset).toBeGreaterThan(kmp.sections.find((section) => section.name === 'AREA')?.offset ?? 0);
    const deletedRouteKmp = parseKmp(deleteKmpEntity(addedRouteKmp, addedRouteKmp.entities.find((entity) => entity.id === `POTI-${originalRouteCount}-0`)!));
    expect(deletedRouteKmp.routes.length).toBe(originalRouteCount);
    const checkpoint = kmp.entities.find((entity) => entity.section === 'CKPT');
    expect(checkpoint?.recordSize).toBe(0x14);
    expect(checkpoint?.checkpoint?.left).toBeTruthy();
    expect(checkpoint?.checkpoint?.right).toBeTruthy();
    expect(checkpoint?.checkpoint?.respawnIndex).toBeGreaterThanOrEqual(0);
    expect(checkpoint?.checkpoint?.type).toBeGreaterThanOrEqual(0);
    const movedCheckpoint = parseKmp(patchKmpEntityPosition(kmp, checkpoint!, { x: checkpoint!.position.x + 100, y: 0, z: checkpoint!.position.z - 50 }));
    const movedCheckpointEntity = movedCheckpoint.entities.find((entity) => entity.id === checkpoint!.id);
    expect(movedCheckpointEntity?.position.x).toBeCloseTo(checkpoint!.position.x + 100);
    expect(movedCheckpointEntity?.position.z).toBeCloseTo(checkpoint!.position.z - 50);
    const endpointEditedKmp = parseKmp(patchKmpCheckpointEndpoint(kmp, checkpoint!, 'left', { x: checkpoint!.checkpoint!.left.x + 25, y: 0, z: checkpoint!.checkpoint!.left.z - 40 }));
    const endpointEdited = endpointEditedKmp.entities.find((entity) => entity.id === checkpoint!.id);
    expect(endpointEdited?.checkpoint?.left.x).toBeCloseTo(checkpoint!.checkpoint!.left.x + 25);
    expect(endpointEdited?.checkpoint?.left.z).toBeCloseTo(checkpoint!.checkpoint!.left.z - 40);
    expect(endpointEdited?.checkpoint?.right.x).toBeCloseTo(checkpoint!.checkpoint!.right.x);
    const metadataEditedKmp = parseKmp(
      patchKmpCheckpointField(
        parseKmp(patchKmpCheckpointField(parseKmp(patchKmpCheckpointField(parseKmp(patchKmpCheckpointField(kmp, checkpoint!, 'respawnIndex', 3)), checkpoint!, 'type', 1)), checkpoint!, 'prev', 0xff)),
        checkpoint!,
        'next',
        7,
      ),
    );
    const metadataEdited = metadataEditedKmp.entities.find((entity) => entity.id === checkpoint!.id);
    expect(metadataEdited?.checkpoint?.respawnIndex).toBe(3);
    expect(metadataEdited?.checkpoint?.type).toBe(1);
    expect(metadataEdited?.checkpoint?.prev).toBe(0xff);
    expect(metadataEdited?.checkpoint?.next).toBe(7);
    const originalCheckpointCount = kmp.sections.find((section) => section.name === 'CKPT')?.count ?? 0;
    const addedCheckpointKmp = parseKmp(appendKmpCheckpoint(kmp, { x: 1000, y: 0, z: 2000 }, 800));
    const addedCheckpoint = addedCheckpointKmp.entities.find((entity) => entity.id === `CKPT-${originalCheckpointCount}`);
    expect(addedCheckpointKmp.sections.find((section) => section.name === 'CKPT')?.count).toBe(originalCheckpointCount + 1);
    const checkpointLastGroup = kmp.pathGraphs.find((graph) => graph.pointSection === 'CKPT')?.groups.at(-1);
    if (checkpointLastGroup && checkpointLastGroup.startIndex + checkpointLastGroup.pointCount === originalCheckpointCount) {
      expect(addedCheckpointKmp.pathGraphs.find((graph) => graph.pointSection === 'CKPT')?.groups.at(-1)?.pointCount).toBe(checkpointLastGroup.pointCount + 1);
    }
    const ckphSection = kmp.sections.find((section) => section.name === 'CKPH');
    if (ckphSection && originalCheckpointCount < 0xff) {
      const noCheckpointGroupsBytes = new Uint8Array(kmp.original);
      new DataView(noCheckpointGroupsBytes.buffer).setUint16(ckphSection.offset + 4, 0, false);
      const addedUngroupedCheckpointKmp = parseKmp(appendKmpCheckpoint(parseKmp(noCheckpointGroupsBytes), { x: 3000, y: 0, z: 4000 }, 700));
      const createdGroup = addedUngroupedCheckpointKmp.pathGraphs.find((graph) => graph.pointSection === 'CKPT')?.groups[0];
      expect(createdGroup?.startIndex).toBe(originalCheckpointCount);
      expect(createdGroup?.pointCount).toBe(1);
      const trackWithoutCheckpointGroups: TrackDocument = {
        fileName: '0.szs',
        compressed: true,
        archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: noCheckpointGroupsBytes } : entry)),
        kmp: parseKmp(noCheckpointGroupsBytes),
        kcl: courseKcl?.data ? parseKcl(courseKcl.data) : undefined,
        brresFiles: [],
        brresSummaries: {},
        warnings: [],
      };
      expect(validateTrack(trackWithoutCheckpointGroups).some((item) => item.message.includes('without checkpoint path groups'))).toBe(true);
    }
    expect(addedCheckpoint?.position.x).toBeCloseTo(1000);
    expect(addedCheckpoint?.position.z).toBeCloseTo(2000);
    expect(addedCheckpoint?.recordSize).toBe(0x14);
    const originalRespawnCount = kmp.sections.find((section) => section.name === 'JGPT')?.count ?? 0;
    const addedRespawnKmp = parseKmp(appendKmpPoint(kmp, 'JGPT', { x: 11, y: 22, z: 33 }));
    const addedRespawn = addedRespawnKmp.entities.find((entity) => entity.id === `JGPT-${originalRespawnCount}`);
    expect(addedRespawnKmp.sections.find((section) => section.name === 'JGPT')?.count).toBe(originalRespawnCount + 1);
    expect(addedRespawn?.position.x).toBeCloseTo(11);
    expect(addedRespawn?.position.y).toBeCloseTo(22);
    expect(addedRespawn?.position.z).toBeCloseTo(33);
    expect(addedRespawnKmp.sections.find((section) => section.name === 'CNPT')?.offset).toBeGreaterThan(kmp.sections.find((section) => section.name === 'CNPT')?.offset ?? 0);
    const area = kmp.entities.find((entity) => entity.section === 'AREA' && entity.scale);
    if (area?.scale) {
      expect(area.area).toBeTruthy();
      const scaledAreaKmp = parseKmp(patchKmpEntityScale(kmp, area, { x: area.scale.x + 10, y: area.scale.y + 20, z: area.scale.z + 30 }));
      const scaledArea = scaledAreaKmp.entities.find((entity) => entity.id === area.id);
      expect(scaledArea?.scale?.x).toBeCloseTo(area.scale.x + 10);
      expect(scaledArea?.scale?.y).toBeCloseTo(area.scale.y + 20);
      expect(scaledArea?.scale?.z).toBeCloseTo(area.scale.z + 30);
      const editedArea = parseKmp(patchKmpAreaField(parseKmp(patchKmpAreaField(kmp, area, 'type', 3)), area, 'setting1', 0x2345)).entities.find((entity) => entity.id === area.id);
      expect(editedArea?.area?.type).toBe(3);
      expect(editedArea?.area?.setting1).toBe(0x2345);
    }
    const originalAreaCount = kmp.sections.find((section) => section.name === 'AREA')?.count ?? 0;
    const addedAreaKmp = parseKmp(appendKmpArea(kmp, { x: 101, y: 202, z: 303 }));
    const addedArea = addedAreaKmp.entities.find((entity) => entity.id === `AREA-${originalAreaCount}`);
    expect(addedArea?.position.x).toBeCloseTo(101);
    expect(addedArea?.position.y).toBeCloseTo(202);
    expect(addedArea?.position.z).toBeCloseTo(303);
    expect(addedArea?.scale?.x).toBeCloseTo(1);
    expect(addedArea?.area?.cameraIndex).toBe(0xff);
    expect(addedArea?.area?.routeIndex).toBe(0xff);
    const camera = kmp.entities.find((entity) => entity.section === 'CAME' && entity.camera);
    const cameraHeader = getKmpCameraHeader(kmp);
    const patchedCameraHeader = getKmpCameraHeader(parseKmp(patchKmpCameraHeaderField(parseKmp(patchKmpCameraHeaderField(kmp, 'firstIntroCam', 2)), 'firstSelectionCam', 3)));
    expect(patchedCameraHeader.firstIntroCam).toBe(2);
    expect(patchedCameraHeader.firstSelectionCam).toBe(3);
    expect(cameraHeader.firstIntroCam).toBeGreaterThanOrEqual(0);
    expect(cameraHeader.firstSelectionCam).toBeGreaterThanOrEqual(0);
    if ((kmp.sections.find((section) => section.name === 'CAME')?.count ?? 0) > 0) {
      const invalidCameraHeaderBytes = patchKmpCameraHeaderField(parseKmp(patchKmpCameraHeaderField(kmp, 'firstIntroCam', 0xfe)), 'firstSelectionCam', 0xfd);
      const invalidCameraHeaderTrack: TrackDocument = {
        fileName: '0.szs',
        compressed: true,
        archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: invalidCameraHeaderBytes } : entry)),
        kmp: parseKmp(invalidCameraHeaderBytes),
        kcl: courseKcl?.data ? parseKcl(courseKcl.data) : undefined,
        brresFiles: [],
        brresSummaries: {},
        warnings: [],
      };
      const cameraHeaderWarnings = validateTrack(invalidCameraHeaderTrack).map((item) => item.message);
      expect(cameraHeaderWarnings.some((message) => message.includes('CAME intro start references missing camera 254'))).toBe(true);
      expect(cameraHeaderWarnings.some((message) => message.includes('CAME selection start references missing camera 253'))).toBe(true);
    }
    if (camera?.camera) {
      const movedCamera = parseKmp(patchKmpEntityPosition(kmp, camera, { x: camera.position.x + 10, y: camera.position.y + 20, z: camera.position.z + 30 })).entities.find((entity) => entity.id === camera.id);
      expect(movedCamera?.position.x).toBeCloseTo(camera.position.x + 10);
      expect(movedCamera?.position.y).toBeCloseTo(camera.position.y + 20);
      expect(movedCamera?.position.z).toBeCloseTo(camera.position.z + 30);
      const editedCamera = parseKmp(patchKmpCameraField(parseKmp(patchKmpCameraField(kmp, camera, 'type', 2)), camera, 'time', 123.5)).entities.find((entity) => entity.id === camera.id);
      expect(editedCamera?.camera?.type).toBe(2);
      expect(editedCamera?.camera?.time).toBeCloseTo(123.5);
      expect(editedCamera?.camera?.unknown1).toBe(camera.camera.unknown1);
      expect(editedCamera?.camera?.unknown2).toBe(camera.camera.unknown2);
      const editedCameraView = parseKmp(patchKmpCameraViewPosition(kmp, camera, 'end', { x: 7, y: 8, z: 9 })).entities.find((entity) => entity.id === camera.id);
      expect(editedCameraView?.cameraView?.end.x).toBeCloseTo(7);
      expect(editedCameraView?.cameraView?.end.y).toBeCloseTo(8);
      expect(editedCameraView?.cameraView?.end.z).toBeCloseTo(9);
    }
    const originalCameraCount = kmp.sections.find((section) => section.name === 'CAME')?.count ?? 0;
    const addedCameraKmp = parseKmp(appendKmpCamera(kmp, { x: 404, y: 505, z: 606 }));
    const addedCamera = addedCameraKmp.entities.find((entity) => entity.id === `CAME-${originalCameraCount}`);
    expect(addedCamera?.position.x).toBeCloseTo(404);
    expect(addedCamera?.position.y).toBeCloseTo(505);
    expect(addedCamera?.position.z).toBeCloseTo(606);
    expect(addedCamera?.camera?.routeIndex).toBe(0xff);
    expect(addedCamera?.cameraView?.start.x).toBeCloseTo(0);
    expect(addedCamera?.cameraView?.end.z).toBeCloseTo(0);
    const respawn = kmp.entities.find((entity) => entity.section === 'JGPT' && entity.respawn);
    if (respawn?.respawn) {
      const editedRespawn = parseKmp(patchKmpRespawnField(kmp, respawn, 'soundData', 0x3210)).entities.find((entity) => entity.id === respawn.id);
      expect(editedRespawn?.respawn?.id).toBe(respawn.respawn.id);
      expect(editedRespawn?.respawn?.soundData).toBe(0x3210);
    }
    const cannon = kmp.entities.find((entity) => entity.section === 'CNPT' && entity.cannon);
    if (cannon?.cannon) {
      const editedCannon = parseKmp(patchKmpCannonField(kmp, cannon, 'effect', 0x4567)).entities.find((entity) => entity.id === cannon.id);
      expect(editedCannon?.cannon?.id).toBe(cannon.cannon.id);
      expect(editedCannon?.cannon?.effect).toBe(0x4567);
    }
    const battleFinish = kmp.entities.find((entity) => entity.section === 'MSPT' && entity.battleFinish);
    if (battleFinish?.battleFinish) {
      const editedBattleFinish = parseKmp(patchKmpBattleFinishField(kmp, battleFinish, 'id', 0x2345)).entities.find((entity) => entity.id === battleFinish.id);
      expect(editedBattleFinish?.battleFinish?.id).toBe(0x2345);
    }
    const stage = kmp.entities.find((entity) => entity.section === 'STGI' && entity.stage);
    if (stage?.stage) {
      const editedStage = parseKmp(patchKmpStageFlareColor(parseKmp(patchKmpStageField(kmp, stage, 'lapCount', 5)), stage, 2, 0xaa)).entities.find((entity) => entity.id === stage.id);
      expect(editedStage?.stage?.lapCount).toBe(5);
      expect(editedStage?.stage?.flareColor[2]).toBe(0xaa);
    }
    const originalObjectCount = kmp.sections.find((section) => section.name === 'GOBJ')?.count ?? 0;
    const editedKmp = parseKmp(appendKmpGobj(kmp, 0x65, { x: 10, y: 20, z: 30 }));
    const editedObjects = editedKmp.sections.find((section) => section.name === 'GOBJ');
    expect(editedObjects?.count).toBe(originalObjectCount + 1);
    const addedObject = editedKmp.entities.find((entity) => entity.id === `GOBJ-${originalObjectCount}`);
    expect(addedObject?.routeIndex).toBe(0xffff);
    expect(addedObject?.objectSettings).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(addedObject?.presenceFlags).toBe(0x003f);
    if (originalObjectCount > 0) {
      const movedObjectKmp = parseKmp(moveKmpEntity(editedKmp, addedObject!, -1));
      expect(movedObjectKmp.entities.find((entity) => entity.id === `GOBJ-${originalObjectCount - 1}`)?.objectId).toBe(0x65);
    }
    const transformedObject = parseKmp(
      patchKmpGobjPresenceFlags(
        parseKmp(
          patchKmpGobjSetting(
            parseKmp(
              patchKmpGobjObjectId(
                parseKmp(
                  patchKmpEntityRouteIndex(
                    parseKmp(patchKmpEntityScale(parseKmp(patchKmpEntityRotation(editedKmp, addedObject!, { x: 1, y: 2, z: 3 })), addedObject!, { x: 1.5, y: 2, z: 2.5 })),
                    addedObject!,
                    2,
                  ),
                ),
                addedObject!,
                0xc9,
              ),
            ),
            addedObject!,
            3,
            1234,
          ),
        ),
        addedObject!,
        0x0015,
      ),
    ).entities.find((entity) => entity.id === addedObject!.id);
    expect(transformedObject?.rotation?.y).toBeCloseTo(2);
    expect(transformedObject?.scale?.z).toBeCloseTo(2.5);
    expect(transformedObject?.objectId).toBe(0xc9);
    expect(transformedObject?.routeIndex).toBe(2);
    expect(transformedObject?.objectSettings?.[3]).toBe(1234);
    expect(transformedObject?.presenceFlags).toBe(0x0015);
    const deletedObjectKmp = parseKmp(deleteKmpEntity(editedKmp, addedObject!));
    expect(deletedObjectKmp.sections.find((section) => section.name === 'GOBJ')?.count).toBe(originalObjectCount);
    expect(courseKcl?.data).toBeTruthy();
    const kcl = parseKcl(courseKcl!.data!);
    expect(kcl.triangles.length).toBeGreaterThan(100);
    expect(kcl.triangles[0].typeName).toBeTruthy();
    expect(courseBrres?.data).toBeTruthy();
    const brres = await parseNoclipBrresSummary(courseBrres!.data!);
    expect(brres.models.length).toBeGreaterThan(0);
    expect(brres.textures.length).toBeGreaterThan(0);
  }, 60000);

  it.runIf(realTrackSamples.length > 0)('smoke-tests real WheelWizard tracks from both configured directories', () => {
    for (const path of realTrackSamples) {
      const archiveBytes = decodeYaz0(new Uint8Array(readFileSync(path)));
      const entries = parseU8(archiveBytes);
      const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
      const courseKcl = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kcl'));
      expect(courseKmp?.data, path).toBeTruthy();
      const kmp = parseKmp(courseKmp!.data!);
      expect(kmp.sections.length, path).toBeGreaterThan(4);
      expect(kmp.sections.some((section) => section.name === 'KTPT'), path).toBe(true);
      if (courseKcl?.data) expect(parseKcl(courseKcl.data).triangles.length, path).toBeGreaterThan(0);

      const track: TrackDocument = {
        fileName: path.split('/').pop() ?? 'track.szs',
        compressed: true,
        archiveEntries: entries,
        kmp,
        kcl: courseKcl?.data ? parseKcl(courseKcl.data) : undefined,
        brresFiles: entries.filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres')).map((entry) => entry.path),
        brresSummaries: {},
        warnings: [],
      };
      const exportedBytes = exportTrack(track);
      expect(validateExportBytes(track, exportedBytes).filter((issue) => issue.level === 'error'), path).toEqual([]);
      const exportedEntries = parseU8(decodeYaz0(exportedBytes));
      expect(exportedEntries.some((entry) => entry.path.toLowerCase().endsWith('course.kmp')), path).toBe(true);
    }
  }, 120000);

  it.runIf(existsSync(sampleTrack) && existsSync(commonArchive))('injects missing Common object resources during export', () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    expect(courseKmp?.data).toBeTruthy();
    expect(entries.some((entry) => entry.path.toLowerCase().endsWith('kinoko.brres'))).toBe(false);

    const editedKmp = appendKmpGobj(parseKmp(courseKmp!.data!), 0x1f5, { x: 10, y: 20, z: 30 });
    const editedEntries = entries.map((entry) => (entry === courseKmp ? { ...entry, data: editedKmp } : entry));
    const track: TrackDocument = {
      fileName: '0.szs',
      compressed: true,
      archiveEntries: editedEntries,
      kmp: parseKmp(editedKmp),
      brresFiles: [],
      brresSummaries: {},
      warnings: [],
    };
    const common = parseCommonResourceArchive(new Uint8Array(readFileSync(commonArchive)));
    const exportEntries = getExportArchiveEntries(track, common);
    expect(exportEntries.some((entry) => entry.path.toLowerCase() === 'kinoko.brres')).toBe(true);
    expect(validateTrack(track, { common }).some((item) => item.message.includes('kinoko.brres'))).toBe(false);

    const exported = parseU8(decodeYaz0(exportTrack(track, { common })));
    expect(exported.some((entry) => entry.path.toLowerCase().endsWith('kinoko.brres'))).toBe(true);
    expect(validateExportBytes(track, exportTrack(track, { common }), { common }).filter((item) => item.level === 'error')).toEqual([]);
  }, 60000);

  it.runIf(existsSync(sampleTrack) && existsSync(commonArchive))('preserves untouched archive files during export', () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    const courseKcl = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kcl'));
    expect(courseKmp?.data).toBeTruthy();
    expect(courseKcl?.data).toBeTruthy();

    const editedKmp = appendKmpGobj(parseKmp(courseKmp!.data!), 0x65, { x: 10, y: 20, z: 30 });
    const track: TrackDocument = {
      fileName: '0.szs',
      compressed: true,
      archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: editedKmp } : entry)),
      kmp: parseKmp(editedKmp),
      kcl: parseKcl(courseKcl!.data!),
      brresFiles: entries.filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres')).map((entry) => entry.path),
      brresSummaries: {},
      warnings: [],
    };
    const common = parseCommonResourceArchive(new Uint8Array(readFileSync(commonArchive)));
    const exportedEntries = parseU8(decodeYaz0(exportTrack(track, { common })));
    const exportedCourseKcl = exportedEntries.find((entry) => entry.path.toLowerCase().endsWith('course.kcl'));
    const exportedCourseModel = exportedEntries.find((entry) => entry.path.toLowerCase().endsWith('course_model.brres'));
    const originalCourseModel = entries.find((entry) => entry.path.toLowerCase().endsWith('course_model.brres'));

    expect(exportedCourseKcl?.data).toEqual(courseKcl!.data);
    expect(exportedCourseModel?.data).toEqual(originalCourseModel?.data);
    expect(exportedEntries.filter((entry) => entry.path.toLowerCase() === 'course_model.brres')).toHaveLength(1);
  }, 60000);

  it.runIf(existsSync(sampleTrack) && existsSync(commonArchive))('warns when an object resource is absent from the track and Common.szs', () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    expect(courseKmp?.data).toBeTruthy();

    const editedKmp = appendKmpGobj(parseKmp(courseKmp!.data!), 0x07, { x: 10, y: 20, z: 30 });
    const track: TrackDocument = {
      fileName: '0.szs',
      compressed: true,
      archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: editedKmp } : entry)),
      kmp: parseKmp(editedKmp),
      brresFiles: [],
      brresSummaries: {},
      warnings: [],
    };
    const common = parseCommonResourceArchive(new Uint8Array(readFileSync(commonArchive)));
    expect(validateTrack(track, { common }).some((item) => item.message.includes('pocha.brres'))).toBe(true);
  });

  it.runIf(existsSync(sampleTrack) && existsSync(commonArchive))('warns when gameplay objects are hidden in multiplayer via presence flags', () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    expect(courseKmp?.data).toBeTruthy();

    const withGoomba = appendKmpGobj(parseKmp(courseKmp!.data!), 0x191, { x: 10, y: 20, z: 30 });
    const goomba = parseKmp(withGoomba).entities.find((entity) => entity.section === 'GOBJ' && entity.objectId === 0x191 && entity.index === countEntitiesOfSection(parseKmp(courseKmp!.data!), 'GOBJ'));
    expect(goomba).toBeTruthy();
    const hiddenInMultiplayer = patchKmpGobjPresenceFlags(parseKmp(withGoomba), goomba!, 0x0001);
    const track: TrackDocument = {
      fileName: '0.szs',
      compressed: true,
      archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: hiddenInMultiplayer } : entry)),
      kmp: parseKmp(hiddenInMultiplayer),
      brresFiles: [],
      brresSummaries: {},
      warnings: [],
    };
    const common = parseCommonResourceArchive(new Uint8Array(readFileSync(commonArchive)));
    expect(validateTrack(track, { common }).some((item) => item.message.includes('gameplay object') && item.message.includes('0x0001'))).toBe(true);
  });

  it.runIf(existsSync(sampleTrack) && existsSync(commonArchive))('warns when item boxes use unsupported item/timing settings', () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    expect(courseKmp?.data).toBeTruthy();

    const withItemBox = appendKmpGobj(parseKmp(courseKmp!.data!), 0x65, { x: 10, y: 20, z: 30 });
    const baseKmp = parseKmp(courseKmp!.data!);
    const editedKmp = parseKmp(withItemBox);
    const itemBox = editedKmp.entities.find((entity) => entity.section === 'GOBJ' && entity.objectId === 0x65 && entity.index === countEntitiesOfSection(baseKmp, 'GOBJ'));
    expect(itemBox?.objectSettings).toBeTruthy();

    let patched = patchKmpGobjSetting(editedKmp, itemBox!, 1, 0x0011);
    patched = patchKmpGobjSetting(parseKmp(patched), parseKmp(patched).entities.find((entity) => entity.id === itemBox!.id)!, 2, 0x2222);
    const reparsed = parseKmp(patched);
    patched = patchKmpGobjSetting(reparsed, reparsed.entities.find((entity) => entity.id === itemBox!.id)!, 5, 0x0007);

    const track: TrackDocument = {
      fileName: '0.szs',
      compressed: true,
      archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: patched } : entry)),
      kmp: parseKmp(patched),
      brresFiles: [],
      brresSummaries: {},
      warnings: [],
    };
    const common = parseCommonResourceArchive(new Uint8Array(readFileSync(commonArchive)));
    const issues = validateTrack(track, { common }).map((item) => item.message);
    expect(issues.some((message) => message.includes('unsupported player item-box setting') && message.includes('0x0011'))).toBe(true);
    expect(issues.some((message) => message.includes('unsupported CPU item-box setting') && message.includes('0x2222'))).toBe(true);
    expect(issues.some((message) => message.includes('unsupported item-box timing setting') && message.includes('0x0007'))).toBe(true);
  });

  it.runIf(existsSync(sampleTrack))('warns about known vanilla object pitfalls', () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    expect(courseKmp?.data).toBeTruthy();

    const baseKmp = parseKmp(courseKmp!.data!);
    let patched = appendKmpGobj(baseKmp, 0x192, { x: 10, y: 20, z: 30 });
    patched = appendKmpGobj(parseKmp(patched), 0x19a, { x: 40, y: 20, z: 30 });
    patched = appendKmpGobj(parseKmp(patched), 0x214, { x: 70, y: 20, z: 30 });
    const reparsed = parseKmp(patched);
    const inseki = reparsed.entities.find((entity) => entity.section === 'GOBJ' && entity.objectId === 0x214 && entity.index === countEntitiesOfSection(baseKmp, 'GOBJ') + 2);
    expect(inseki?.objectSettings).toBeTruthy();
    patched = patchKmpGobjSetting(reparsed, inseki!, 2, 0);

    const track: TrackDocument = {
      fileName: '0.szs',
      compressed: true,
      archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: patched } : entry)),
      kmp: parseKmp(patched),
      brresFiles: [],
      brresSummaries: {},
      warnings: [],
    };
    const issues = validateTrack(track).map((item) => item.message);
    expect(issues.some((message) => message.includes('choropu and choropu2'))).toBe(true);
    expect(issues.some((message) => message.includes('InsekiA') && message.includes('Setting 3 left at 0'))).toBe(true);
  });

  it.runIf(existsSync(sampleTrack))('warns when a route-driven vanilla object is missing its route', () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    expect(courseKmp?.data).toBeTruthy();

    const baseKmp = parseKmp(courseKmp!.data!);
    const patched = appendKmpGobj(baseKmp, 0x0d0, { x: 10, y: 20, z: 30 });
    const track: TrackDocument = {
      fileName: '0.szs',
      compressed: true,
      archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: patched } : entry)),
      kmp: parseKmp(patched),
      brresFiles: [],
      brresSummaries: {},
      warnings: [],
    };
    const issues = validateTrack(track).map((item) => item.message);
    expect(issues.some((message) => message.includes('kart_truck') && message.includes('requires a route'))).toBe(true);
  });

  it.runIf(existsSync(sampleTrack))('warns when Daisy Circuit Mii audience objects are duplicated', () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    expect(courseKmp?.data).toBeTruthy();

    const baseKmp = parseKmp(courseKmp!.data!);
    let patched = appendKmpGobj(baseKmp, 0x2e8, { x: 10, y: 20, z: 30 });
    patched = appendKmpGobj(parseKmp(patched), 0x2e8, { x: 40, y: 20, z: 30 });
    const track: TrackDocument = {
      fileName: '0.szs',
      compressed: true,
      archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: patched } : entry)),
      kmp: parseKmp(patched),
      brresFiles: [],
      brresSummaries: {},
      warnings: [],
    };
    const issues = validateTrack(track).map((item) => item.message);
    expect(issues.some((message) => message.includes('MiiObjD01') && message.includes('at most one instance'))).toBe(true);
  });

  it.runIf(existsSync(sampleTrack))('warns for slot-restricted objects and begoman_spike ordering', () => {
    const archive = decodeYaz0(new Uint8Array(readFileSync(sampleTrack)));
    const entries = parseU8(archive);
    const courseKmp = entries.find((entry) => entry.path.toLowerCase().endsWith('course.kmp'));
    expect(courseKmp?.data).toBeTruthy();

    const baseKmp = parseKmp(courseKmp!.data!);
    let patched = appendKmpGobj(baseKmp, 0x72, { x: 10, y: 20, z: 30 });
    patched = appendKmpGobj(parseKmp(patched), 0x1a3, { x: 40, y: 20, z: 30 });

    const track: TrackDocument = {
      fileName: '0.szs',
      compressed: true,
      archiveEntries: entries.map((entry) => (entry === courseKmp ? { ...entry, data: patched } : entry)),
      kmp: parseKmp(patched),
      brresFiles: [],
      brresSummaries: {},
      warnings: [],
    };
    const issues = validateTrack(track).map((item) => item.message);
    expect(issues.some((message) => message.includes('slot-restricted objects') && message.includes('sunDS') && message.includes('begoman_spike'))).toBe(true);
    expect(issues.some((message) => message.includes('begoman_spike must be the first placed game object'))).toBe(true);
  });
});

function countEntitiesOfSection(kmp: ReturnType<typeof parseKmp>, section: string): number {
  return kmp.entities.filter((entity) => entity.section === section).length;
}
