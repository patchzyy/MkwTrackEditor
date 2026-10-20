import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KmpEntity, Vec3 } from '../../lib/kmp';
import type { PathInfo, ReferenceCounts } from '../../lib/kmpEdit';
import { Inspector } from './Inspector';
import { AreaSection } from './sections/AreaSection';
import { gravityRecordsFromEntities } from '../../lib/gravityField';

const referenceCounts: ReferenceCounts = { routes: 2, cameras: 1, enemyPoints: 4, checkpoints: 3, respawns: 2 };
const origin: Vec3 = { x: 0, y: 0, z: 0 };
const noop = () => {};

function entityOf(extra: Partial<KmpEntity> & Pick<KmpEntity, 'section'>): KmpEntity {
  return {
    id: `${extra.section}-0`,
    index: 0,
    position: origin,
    rawOffset: 0,
    recordSize: 0x20,
    ...extra,
  } as unknown as KmpEntity;
}

function renderInspector(entity: KmpEntity, pathInfo: PathInfo | null = null): string {
  return renderToStaticMarkup(
    <Inspector
      entity={entity}
      pathInfo={pathInfo}
      cameraHeader={null}
      referenceCounts={referenceCounts}
      areaInspectorResources={{ fogPresets: [], bloomPresets: [] }}
      objectProfile={null}
      objectOptions={[{ id: 0x65, label: 'Item Box', detail: 'itembox' }]}
      objectVariantOptions={[]}
      onChangePosition={noop}
      onChangeCheckpointEndpoint={noop}
      onChangeCheckpointField={noop}
      onChangePointDeviation={noop}
      onChangePathGroupLinks={noop}
      onChangePointSetting={noop}
      onChangePotiRouteSetting={noop}
      onChangePotiPointSetting={noop}
      onAddPotiNode={noop}
      onChangeAreaField={noop}
      onChangeCameraField={noop}
      onChangeCameraHeaderField={noop}
      onChangeCameraViewPosition={noop}
      onChangeRespawnField={noop}
      onChangeCannonField={noop}
      onChangeBattleFinishField={noop}
      onChangeStageField={noop}
      onChangeStageFlareColor={noop}
      onChangeStartPlayerIndex={noop}
      onChangeRotation={noop}
      onChangeScale={noop}
      onChangeObjectId={noop}
      onChangeRouteIndex={noop}
      onChangeObjectSetting={noop}
      onChangePresenceFlags={noop}
    />,
  );
}

describe('Inspector', () => {
  it('leads with a friendly header and the placement editor', () => {
    const markup = renderInspector(entityOf({ section: 'JGPT', rotation: origin, respawn: { id: 0, soundData: 0 } }));
    expect(markup).toContain('class="propertyGrid"');
    expect(markup).toContain('Respawn point');
    expect(markup).toContain('Position');
    expect(markup).toContain('Rotation');
    // The two raw respawn words are Advanced, so they must not be in the closed sheet.
    expect(markup).not.toContain('Respawn id and sound');
  });

  it('shows checkpoint endpoints and the respawn picker, and hides the link chain', () => {
    const markup = renderInspector(
      entityOf({
        section: 'CKPT',
        checkpoint: { left: origin, right: origin, respawnIndex: 0, type: 0xff, prev: 0xff, next: 0xff },
      }),
    );
    expect(markup).toContain('Left end');
    expect(markup).toContain('Right end');
    expect(markup).toContain('Respawn used here');
    expect(markup).not.toContain('Previous checkpoint');
    expect(markup).not.toContain('Checkpoint type byte');
  });

  it('shows the enemy-route choices in plain language and hides the spare byte', () => {
    const markup = renderInspector(entityOf({ section: 'ENPT', pointSettings: [0, 0, 0], pointDeviation: 25 }));
    expect(markup).toContain('Mushroom / wheelie');
    expect(markup).toContain('Drifting');
    expect(markup).not.toContain('Spare byte');
    expect(markup).not.toContain('Corridor width');
  });

  it('shows what an area does and keeps its priority byte for Advanced', () => {
    const markup = renderInspector(
      entityOf({
        section: 'AREA',
        rotation: origin,
        scale: { x: 1, y: 1, z: 1 },
        area: { shape: 0, type: 0, cameraIndex: 0xff, priority: 0, setting1: 0, setting2: 0, routeIndex: 0xff, enemyIndex: 0xff, flags: 0 },
      }),
    );
    expect(markup).toContain('What it does');
    expect(markup).toContain('Shape');
    expect(markup).toContain('Rotation');
    expect(markup).toContain('Size');
    expect(markup).not.toContain('Overlap priority');
  });

  it('offers an object a single movement-path row and hides every raw value', () => {
    const markup = renderInspector(
      entityOf({
        section: 'GOBJ',
        objectId: 0x65,
        routeIndex: 0xffff,
        objectSettings: [0, 0, 0, 0, 0, 0, 0, 0],
        presenceFlags: 0x003f,
        rotation: origin,
        scale: { x: 1, y: 1, z: 1 },
      }),
    );
    expect(markup).toContain('Movement path');
    expect(markup).toContain('Appears in');
    expect(markup).toContain('Does not follow a path');
    expect(markup).toContain('Advanced');
    // Everything technical is behind the closed disclosure, so none of it is rendered.
    expect(markup).not.toContain('Raw setting slots');
    expect(markup).not.toContain('Presence flags');
    expect(markup).not.toContain('Object id');
  });

  it('keeps the low-level path group links out of the open sheet', () => {
    const pathInfo: PathInfo = {
      groupSection: 'ENPH',
      groupIndex: 1,
      groupSize: 4,
      localIndex: 1,
      prevGroups: [0],
      nextGroups: [2, 3],
    };
    const markup = renderInspector(entityOf({ section: 'ENPT', pointSettings: [0, 0, 0] }), pathInfo);
    expect(markup).toContain('Advanced');
    expect(markup).not.toContain('Group links');
    expect(markup).not.toContain('2, 3');
  });
});

describe('Gravity field AREAs', () => {
  const gravityArea = (index: number, routeIndex: number, enemyIndex: number, flags = 0) =>
    entityOf({
      section: 'AREA',
      index,
      id: `AREA-${index}`,
      rotation: origin,
      scale: { x: 1, y: 1, z: 1 },
      position: { x: 0, y: 0, z: index * 10000 },
      area: { shape: 0, type: 11, cameraIndex: 0xff, priority: 0, setting1: 1300, setting2: 10, routeIndex, enemyIndex, flags },
    });

  function renderGravity(entity: KmpEntity, all: KmpEntity[], scope: 'essentials' | 'advanced' = 'essentials'): string {
    return renderToStaticMarkup(
      <AreaSection
        scope={scope}
        entity={entity}
        referenceCounts={referenceCounts}
        areaInspectorResources={{ fogPresets: [], bloomPresets: [] }}
        onChangeAreaField={noop}
        gravityRecords={gravityRecordsFromEntities(all)}
        onApplyAreaPatches={noop}
        onSelectArea={noop}
      />,
    );
  }

  it('replaces the raw AREA rows with gravity controls', () => {
    const area = gravityArea(0, 3, 1, 1);
    const markup = renderGravity(area, [area]);
    expect(markup).toContain('Field mode');
    expect(markup).toContain('Outside tube');
    expect(markup).toContain('Volume');
    expect(markup).toContain('Strength');
    expect(markup).toContain('Gravity resets');
    expect(markup).toContain('On leaving');
    expect(markup).toContain('Camera');
    expect(markup).not.toContain('Enemy route point');
    expect(markup).not.toContain('Gate chain');
  });

  it('shows the chain of a path gate and only the priority in Advanced', () => {
    const gates = [gravityArea(0, 5, 1), gravityArea(1, 5, 0xff, 2)];
    const markup = renderGravity(gates[0], gates);
    expect(markup).toContain('Gate chain');
    expect(markup).toContain('gate 1 of 2');
    expect(markup).toContain('Next gate');
    expect(markup).toContain('Applies to the whole chain.');
    expect(markup).not.toContain('>Volume<');
    const advanced = renderGravity(gates[0], gates, 'advanced');
    expect(advanced).toContain('Overlap priority');
    expect(advanced).not.toContain('Spare setting');
  });
});
