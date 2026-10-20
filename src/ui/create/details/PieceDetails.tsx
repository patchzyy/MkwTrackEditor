import { Trash2 } from 'lucide-react';
import { updatePiece, deletePiece } from '../../../lib/create/ops';
import { evaluateRoadAt, distanceToRoadParam, roadLength, roadParamToDistance } from '../../../lib/create/spline';
import type { LaneModeValue } from './pieceLane';
import { laneOf } from './pieceLane';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/NumberInput';
import { Select } from '../../components/Select';
import { SegmentedControl } from '../../components/SegmentedControl';
import { placementForLane } from '../tools/lanes';
import { PIECE_LABELS } from '../tools/armed';
import { HAZARDS } from '../palette/paletteModel';
import type { CreateSession } from '../session/types';
import { PIECE_ICONS } from '../viewport/icons';
import { pieceLabel } from '../build/layersModel';
import { DetailsHeader, Group, Stepper } from './parts';
import { Slider } from './Slider';
import { useEditing } from './useEditing';

const PIECE_BLURB: Record<string, string> = {
  boostPanel: 'Karts that drive over it get a speed boost.',
  boostRamp: 'Boosts karts and launches them. Follow it with a gap.',
  trickRamp: 'A ramp to do a trick off. Follow it with a gap.',
  itemRow: 'Racers drive through the boxes to get an item.',
  object: 'A hazard or object attached to the road.',
};

export function PieceDetails({ session, pieceId }: { session: CreateSession; pieceId: string }) {
  const project = session.project;
  const edit = useEditing(session);
  const piece = project?.pieces.find((p) => p.id === pieceId);
  const road = project && piece ? project.roads.find((r) => r.id === piece.roadId) : null;
  if (!project || !piece || !road) return null;
  const frame = road.points.length >= 2 ? evaluateRoadAt(road, piece.param) : null;
  const roadWidth = frame?.width ?? 3600;
  const total = road.points.length >= 2 ? roadLength(road) : 0;
  const distance = road.points.length >= 2 ? roadParamToDistance(road, piece.param) : 0;
  const lane = laneOf(piece.lateral, piece.kind === "object" ? 0 : piece.width, roadWidth);
  const hasArea = piece.kind === 'boostPanel' || piece.kind === 'boostRamp' || piece.kind === 'trickRamp';
  const isRamp = piece.kind === 'boostRamp' || piece.kind === 'trickRamp';

  return (
    <div className="crDetails" data-create-details="piece">
      <DetailsHeader icon={PIECE_ICONS[piece.kind](16)} accent="var(--create-piece)" title={pieceLabel(piece)} subtitle={PIECE_BLURB[piece.kind]} />
      <Group title="Where">
        <Field label="Lane" asGroup help="Which part of the road it sits on.">
          <SegmentedControl<LaneModeValue>
            label="Lane"
            value={lane}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'centre', label: 'Centre' },
              { value: 'right', label: 'Right' },
              { value: 'full', label: 'Full' },
            ]}
            onChange={(next) => {
              const placement = placementForLane(piece.kind, next, roadWidth, piece.objectId);
              edit.set(`Move ${pieceLabel(piece).toLowerCase()} to ${next}`, (p) =>
                updatePiece(p, piece.id, { lateral: placement.lateral, ...(piece.kind !== 'object' ? { width: placement.width } : {}), ...(placement.count !== undefined ? { count: placement.count } : {}) }),
              );
            }}
            size="sm"
          />
        </Field>
        <Field label="Across the road" hint="−1 left, +1 right">
          <Slider label="Position across the road" min={-1} max={1} step={0.05} value={piece.lateral} format={(v) => v.toFixed(2)} {...edit.slider('Slide piece across the road', (v) => (p) => updatePiece(p, piece.id, { lateral: v }))} />
        </Field>
        <Field label="Along the road">
          <Slider
            label="Position along the road"
            min={0}
            max={Math.max(1, Math.round(total))}
            step={100}
            value={Math.round(distance)}
            format={(v) => `${Math.round((v / Math.max(1, total)) * 100)}%`}
            {...edit.slider('Slide piece along the road', (v) => (p) => {
              const r = p.roads.find((x) => x.id === piece.roadId);
              return r ? updatePiece(p, piece.id, { param: distanceToRoadParam(r, v) }) : p;
            })}
          />
        </Field>
      </Group>

      {piece.kind !== 'object' && (
        <Group title="Size">
          <Field label="Width">
            <NumberInput label="Width" value={piece.width} min={300} max={Math.max(600, roadWidth)} step={50} integer unit="u" {...edit.num('Change piece width', (v) => (p) => updatePiece(p, piece.id, { width: v }))} />
          </Field>
          {hasArea && (
            <Field label="Length">
              <NumberInput label="Length" value={piece.length} min={300} max={8000} step={100} integer unit="u" {...edit.num('Change piece length', (v) => (p) => updatePiece(p, piece.id, { length: v }))} />
            </Field>
          )}
          {isRamp && (
            <Field label="Ramp height" help="How high the tip of the ramp is. Taller ramps launch farther.">
              <NumberInput label="Ramp height" value={piece.height ?? 400} min={100} max={1500} step={20} integer unit="u" {...edit.num('Change ramp height', (v) => (p) => updatePiece(p, piece.id, { height: v }))} />
            </Field>
          )}
          {piece.kind === 'itemRow' && (
            <Field label="Item boxes">
              <Stepper label="Item boxes" value={piece.count ?? 5} min={1} max={9} onChange={(v) => edit.set('Change item box count', (p) => updatePiece(p, piece.id, { count: v }))} />
            </Field>
          )}
        </Group>
      )}

      {piece.kind === 'object' && (
        <Group title="Object">
          <Field label="Kind">
            <Select
              label="Object kind"
              value={piece.objectId ?? 0}
              options={[
                { value: 0x65, label: 'Item box' },
                ...HAZARDS.map((h) => ({ value: h.objectId, label: h.label })),
                ...(piece.objectId !== undefined && piece.objectId !== 0x65 && !HAZARDS.some((h) => h.objectId === piece.objectId) ? [{ value: piece.objectId, label: pieceLabel(piece) }] : []),
              ]}
              onChange={(v) => edit.set('Change object', (p) => updatePiece(p, piece.id, { objectId: Number(v), settings: undefined }))}
            />
          </Field>
        </Group>
      )}

      <div className="crButtonRow">
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => {
            edit.set(`Delete ${PIECE_LABELS[piece.kind].toLowerCase()}`, (p) => deletePiece(p, piece.id));
            session.select([]);
          }}
        >
          Delete piece
        </Button>
      </div>
    </div>
  );
}
