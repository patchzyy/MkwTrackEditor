import { Layers, Merge, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { deleteSection, updateSection } from '../../../lib/create/ops';
import { resolveEdge } from '../../../lib/create/roadStyles';
import { sectionRanges } from '../../../lib/create/sections';
import { roadParamToDistance } from '../../../lib/create/spline';
import { estimateLapSeconds } from '../../../lib/create/analyze';
import type { EdgeWall, RoadEdge, SectionKind } from '../../../lib/create/types';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/NumberInput';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Toggle } from '../../components/Toggle';
import { SECTION_KIND_LABEL } from '../overlay/buildCreateOverlay';
import type { CreateSession } from '../session/types';
import { SECTION_ICONS } from '../viewport/icons';
import { DetailsHeader, Group, SurfacePicker, surfacesOf } from './parts';
import { useEditing } from './useEditing';

const KIND_HELP: Record<SectionKind, string> = {
  road: 'Normal road on the ground.',
  bridge: 'A road deck with nothing underneath. Falling off means falling for real.',
  gap: 'No road at all: a gap to jump. Put a boost or trick ramp just before it.',
  tunnel: 'Road with walls and a ceiling.',
};

const WALL_OPTIONS: Array<{ value: EdgeWall; label: string; tooltip: string }> = [
  { value: 'none', label: 'None', tooltip: 'No wall: karts can drive off the edge.' },
  { value: 'barrier', label: 'Barrier', tooltip: 'A low guard rail.' },
  { value: 'wall', label: 'Wall', tooltip: 'A tall solid wall.' },
  { value: 'fence', label: 'Fence', tooltip: 'A see-through fence that still stops karts.' },
  { value: 'invisible', label: 'Hidden', tooltip: 'An invisible wall. Karts bounce off it but you cannot see it.' },
];

function EdgeBlock({
  title,
  edge,
  themeId,
  session,
  onPatch,
}: {
  title: string;
  edge: RoadEdge;
  themeId: string;
  session: CreateSession;
  onPatch: (patch: Partial<RoadEdge>, label: string, live?: boolean) => void;
}) {
  const shoulders = surfacesOf(session.kit, themeId, ['ground', 'offroad']).slice(0, 14);
  return (
    <div className="crEdge" data-create-edge={title.toLowerCase()}>
      <h4>{title}</h4>
      <Field label="Curb" help="The red and white stripes along the edge.">
        <Toggle label={`${title} curb`} hideLabel checked={edge.curb} onChange={(v) => onPatch({ curb: v }, `Curb ${v ? 'on' : 'off'}`)} />
      </Field>
      <Field label="Shoulder" asGroup help="The strip of rough ground beyond the curb. It slows karts.">
        <SurfacePicker
          small
          kit={session.kit}
          themeId={themeId}
          surfaces={shoulders}
          value={edge.shoulder}
          inherit={{ label: 'None', selected: edge.shoulder === null }}
          onPick={(ref) => onPatch({ shoulder: ref, shoulderWidth: ref && edge.shoulderWidth <= 0 ? 600 : edge.shoulderWidth }, ref ? 'Set shoulder surface' : 'Remove shoulder')}
        />
      </Field>
      {edge.shoulder && (
        <Field label="Shoulder width">
          <NumberInput label="Shoulder width" value={edge.shoulderWidth} min={100} max={4000} step={50} integer unit="u" onChange={(v) => onPatch({ shoulderWidth: v }, 'Change shoulder width', true)} onCommit={() => onPatch({}, '', true)} />
        </Field>
      )}
      <Field label="Wall" asGroup>
        <SegmentedControl label={`${title} wall`} value={edge.wall} options={WALL_OPTIONS} onChange={(v) => onPatch({ wall: v, wallHeight: v !== 'none' && edge.wallHeight <= 0 ? 300 : edge.wallHeight }, `Wall: ${v}`)} size="sm" />
      </Field>
      {edge.wall !== 'none' && edge.wall !== 'invisible' && (
        <Field label="Wall height">
          <NumberInput label="Wall height" value={edge.wallHeight} min={50} max={1500} step={25} integer unit="u" onChange={(v) => onPatch({ wallHeight: v }, 'Change wall height', true)} onCommit={() => onPatch({}, '', true)} />
        </Field>
      )}
    </div>
  );
}

export function SectionDetails({ session, roadId, sectionId, onSelectRoad }: { session: CreateSession; roadId: string; sectionId: string; onSelectRoad: () => void }) {
  const project = session.project;
  const edit = useEditing(session);
  const [linked, setLinked] = useState(true);
  const road = project?.roads.find((r) => r.id === roadId);
  const ranges = road ? sectionRanges(road) : [];
  const range = ranges.find((r) => r.section.id === sectionId);
  if (!project || !road || !range) return null;
  const index = ranges.indexOf(range);
  const next = ranges[index + 1];
  const section = range.section;
  const left = resolveEdge(range.style.left, section.left);
  const right = resolveEdge(range.style.right, section.right);
  const length = roadParamToDistance(road, range.to) - roadParamToDistance(road, range.from);
  const seconds = Math.max(1, Math.round(estimateLapSeconds(Math.abs(length))));
  const roadSurfaces = surfacesOf(session.kit, project.themeId, ['road']);

  const patchSide = (side: 'left' | 'right') => (patch: Partial<RoadEdge>, label: string, live?: boolean) => {
    if (live && Object.keys(patch).length === 0) {
      edit.finish();
      return;
    }
    const keys = linked ? (['left', 'right'] as const) : ([side] as const);
    const mutate = (p: typeof project) => {
      let out = p;
      for (const key of keys) out = updateSection(out, road.id, section.id, { [key]: patch });
      return out;
    };
    if (live) edit.live(label, mutate);
    else edit.set(label, mutate);
  };

  const KindIcon = SECTION_ICONS[section.kind];

  return (
    <div className="crDetails" data-create-details="section">
      <DetailsHeader
        icon={KindIcon(16)}
        accent="var(--create-section)"
        title={section.label || `Section ${index + 1}`}
        subtitle={
          <>
            part {index + 1} of {ranges.length} of {road.name} ·{' '}
            <button type="button" className="crLink" onClick={onSelectRoad}>
              select the whole road
            </button>
          </>
        }
      />
      <Group title="Kind" help={KIND_HELP[section.kind]}>
        <SegmentedControl
          label="Section kind"
          value={section.kind}
          options={(['road', 'bridge', 'gap', 'tunnel'] as SectionKind[]).map((kind) => ({ value: kind, label: SECTION_KIND_LABEL[kind], icon: SECTION_ICONS[kind](13), tooltip: KIND_HELP[kind] }))}
          onChange={(kind) => edit.set(`Make section a ${SECTION_KIND_LABEL[kind].toLowerCase()}`, (p) => updateSection(p, road.id, section.id, { kind }))}
        />
        <p className="crFact">
          {Math.round(Math.abs(length)).toLocaleString()} units long · about {seconds} s to drive
        </p>
      </Group>

      {section.kind !== 'gap' && (
        <Group title="Surface" help="What the road is made of for this stretch.">
          <SurfacePicker
            small
            kit={session.kit}
            themeId={project.themeId}
            surfaces={roadSurfaces}
            value={section.surface ?? range.style.surface}
            inherit={{ label: 'Style default', selected: !section.surface }}
            onPick={(ref) => edit.set(ref ? 'Set road surface' : 'Use the style surface', (p) => updateSection(p, road.id, section.id, { surface: ref ?? undefined }))}
          />
        </Group>
      )}

      {section.kind !== 'gap' && (
        <Group title="Edges">
          <Field label="Same on both sides">
            <Toggle label="Same on both sides" hideLabel checked={linked} onChange={setLinked} />
          </Field>
          <EdgeBlock title={linked ? 'Both edges' : 'Left edge'} edge={left} themeId={project.themeId} session={session} onPatch={patchSide('left')} />
          {!linked && <EdgeBlock title="Right edge" edge={right} themeId={project.themeId} session={session} onPatch={patchSide('right')} />}
        </Group>
      )}

      <div className="crButtonRow">
        <Button icon={<Merge size={14} />} disabled={!next} disabledReason="This is the last section, so there is nothing after it to merge." onClick={() => next && edit.set('Merge sections', (p) => deleteSection(p, road.id, next.section.id))}>
          Merge with next
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          disabled={ranges.length <= 1}
          disabledReason="A road always has at least one section."
          onClick={() => {
            edit.set('Delete section', (p) => deleteSection(p, road.id, section.id));
            session.select([{ kind: 'road', roadId: road.id }]);
          }}
        >
          Delete section
        </Button>
      </div>
      <p className="crFact">
        <Layers size={12} aria-hidden="true" /> Deleting a section stretches its neighbour over it.
      </p>
    </div>
  );
}
