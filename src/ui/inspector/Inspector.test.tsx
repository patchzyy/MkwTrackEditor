import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KmpEntity, Vec3 } from '../../lib/kmp';
import type { PathInfo, ReferenceCounts } from '../../lib/kmpEdit';
import { BatchSelectionPanel } from './BatchSelectionPanel';
import { DetailsSummaryBar } from './DetailsSummaryBar';
import { Inspector } from './Inspector';

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
        area: { shape: 0, type: 0, cameraIndex: 0xff, priority: 0, setting1: 0, setting2: 0, routeIndex: 0xff, enemyIndex: 0xff },
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

describe('multi-selection panels', () => {
  it('offers batch offset and batch object replacement', () => {
    const markup = renderToStaticMarkup(
      <BatchSelectionPanel
        count={3}
        offset={origin}
        onChangeOffset={noop}
        onApplyOffset={noop}
        objectOptions={[{ id: 0x65, label: 'Item Box', detail: 'itembox' }]}
        objectId={0x65}
        onChangeObjectId={noop}
        onApplyObjectId={noop}
        onDelete={noop}
      />,
    );
    expect(markup).toContain('Batch Edit');
    expect(markup).toContain('3 elements selected');
    expect(markup).toContain('Move selected');
    expect(markup).toContain('Replace selected objects');
    expect(markup).toContain('Delete');
  });

  it('hides the object replacement controls when the selection is not all objects', () => {
    const markup = renderToStaticMarkup(
      <BatchSelectionPanel
        count={2}
        offset={origin}
        onChangeOffset={noop}
        onApplyOffset={noop}
        objectOptions={[]}
        objectId={null}
        onChangeObjectId={noop}
        onDelete={noop}
      />,
    );
    expect(markup).toContain('Batch Edit');
    expect(markup).not.toContain('Replace selected objects');
  });
});

describe('DetailsSummaryBar', () => {
  it('renders only the items that have a value', () => {
    const markup = renderToStaticMarkup(
      <DetailsSummaryBar items={[{ label: 'Selection', value: 'Item Box #3' }, { label: 'Multi-Select', value: '' }]} />,
    );
    expect(markup).toContain('Selection');
    expect(markup).toContain('Item Box #3');
    expect(markup).not.toContain('Multi-Select');
  });

  it('renders nothing when every item is empty', () => {
    expect(renderToStaticMarkup(<DetailsSummaryBar items={[{ label: 'Selection', value: '  ' }]} />)).toBe('');
  });
});
