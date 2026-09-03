import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { EmptyState, Field, FieldGroup, NumberInput, Select } from '../../components';
import { IND_TEX_SCALE_OPTIONS } from '../gxOptions';
import type { MaterialDocChange } from '../MaterialInspector';
import { patchIndTexStage, setIndMatrixCell, patchIndMatrix } from '../materialDoc';

const MATRIX_CELLS = ['a', 'b', 'c', 'd', 'e', 'f'];

/**
 * Indirect texturing: the extra texture lookups that warp a later stage's coordinates (water,
 * heat haze, the distortion on some custom tracks). Raw fields on purpose — this is machinery
 * only a handful of materials use, and anyone reaching for it wants the actual numbers.
 */
export function AdvancedSection({ doc, onChange }: { doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  return (
    <>
      <FieldGroup title="Indirect stages">
        {doc.indTexStages.length === 0 && (
          <EmptyState size="sm" title="No indirect stages" description="This material does not warp any texture coordinates." />
        )}
        {doc.indTexStages.map((stage, index) => (
          <div className="materialIndStage" key={index}>
            <div className="materialLayerIndex">Indirect {index + 1}</div>
            <Field label="Texture layer" hint="1-based">
              <NumberInput
                label={`Indirect ${index + 1} texture layer`}
                value={stage.texMap}
                min={0}
                max={7}
                integer
                step={1}
                onChange={(value) => onChange(patchIndTexStage(doc, index, { texMap: value as never }), { transient: true })}
                onCommit={(value) => onChange(patchIndTexStage(doc, index, { texMap: value as never }), { status: `Indirect ${index + 1} layer ${value + 1}.` })}
              />
            </Field>
            <Field label="Coordinate set" hint="1-based">
              <NumberInput
                label={`Indirect ${index + 1} coordinate set`}
                value={stage.texCoordId}
                min={0}
                max={7}
                integer
                step={1}
                onChange={(value) => onChange(patchIndTexStage(doc, index, { texCoordId: value as never }), { transient: true })}
                onCommit={(value) => onChange(patchIndTexStage(doc, index, { texCoordId: value as never }), { status: `Indirect ${index + 1} coordinates ${value + 1}.` })}
              />
            </Field>
            <Field label="Scale across">
              <Select
                label={`Indirect ${index + 1} scale S`}
                value={String(stage.scaleS)}
                options={IND_TEX_SCALE_OPTIONS}
                onChange={(value) => onChange(patchIndTexStage(doc, index, { scaleS: Number(value) as never }), { status: `Indirect ${index + 1} scale changed.` })}
              />
            </Field>
            <Field label="Scale down">
              <Select
                label={`Indirect ${index + 1} scale T`}
                value={String(stage.scaleT)}
                options={IND_TEX_SCALE_OPTIONS}
                onChange={(value) => onChange(patchIndTexStage(doc, index, { scaleT: Number(value) as never }), { status: `Indirect ${index + 1} scale changed.` })}
              />
            </Field>
          </div>
        ))}
      </FieldGroup>

      <FieldGroup title="Indirect matrices">
        {doc.indMatrices.map((matrix, index) => (
          <div className="materialIndMatrix" key={index}>
            <div className="materialLayerIndex">Matrix {index + 1}</div>
            <span className="materialMatrixGrid">
              {matrix.m.map((value, cell) => (
                <NumberInput
                  key={cell}
                  label={`Indirect matrix ${index + 1} ${MATRIX_CELLS[cell]}`}
                  value={value}
                  step={0.01}
                  precision={4}
                  onChange={(next) => onChange(setIndMatrixCell(doc, index, cell, next), { transient: true })}
                  onCommit={(next) => onChange(setIndMatrixCell(doc, index, cell, next), { status: `Indirect matrix ${index + 1} changed.` })}
                />
              ))}
            </span>
            {/* The hardware stores a 6-bit field less a bias of 27, so the usable range is
                -27..36 and `m` already has the exponent multiplied in. */}
            <Field label="Scale exponent" hint="power of two">
              <NumberInput
                label={`Indirect matrix ${index + 1} scale exponent`}
                value={matrix.scaleExp}
                min={-27}
                max={36}
                integer
                step={1}
                onChange={(value) => onChange(patchIndMatrix(doc, index, { scaleExp: value }), { transient: true })}
                onCommit={(value) => onChange(patchIndMatrix(doc, index, { scaleExp: value }), { status: `Indirect matrix ${index + 1} scale ${value}.` })}
              />
            </Field>
          </div>
        ))}
      </FieldGroup>
    </>
  );
}
