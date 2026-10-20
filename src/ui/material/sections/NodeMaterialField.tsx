import type { GxMaterialDoc } from '../../../lib/gxMaterial';
import { ColorField, Field, FieldGroup } from '../../components';
import { DetailsCategory } from '../../inspector/PropertySheet';
import type { EditorGraphNode } from '../graphModel';
import { channelName, colorRegisterName, konstColorName } from '../gxOptions';
import { colorToRgb255, registerToRgb255, rgb255ToColor, rgb255ToRegister, setColorRegister, setKonstColor } from '../materialDoc';
import type { MaterialDocChange } from '../MaterialInspector';
import { describeStages, usedColorRegisters, usedKonstColors } from '../materialSimple';
import { ShadingSection } from './ShadingSection';

/**
 * The part of the *material* a selected graph node stands for, shown above the node's own fields.
 *
 * A Colour node is a window onto one of the material's four constant colours, a Start colour node
 * onto one of its three registers, and a Vertex colour node onto a lighting channel — so selecting
 * the node is the natural place to edit that value, the way selecting a parameter node in Unreal
 * shows the parameter. Nodes that are pure maths have nothing here and render nothing.
 */
export function NodeMaterialField({ node, doc, onChange }: { node: EditorGraphNode; doc: GxMaterialDoc; onChange: MaterialDocChange }) {
  if (node.type === 'constant') {
    const slot = node.slot;
    const value = doc.konstColors[slot];
    if (!value) return null;
    const readers = usedKonstColors(doc.tevStages).find((entry) => entry.slot === slot)?.stages ?? [];
    return (
      <DetailsCategory name="Colour">
        <FieldGroup>
          <Field
            label={konstColorName(slot)}
            asGroup
            help={readers.length > 0 ? `Read by ${describeStages(readers)}. Every node showing ${konstColorName(slot)} changes with it.` : `Every node showing ${konstColorName(slot)} changes with it.`}
          >
            <ColorField
              label={konstColorName(slot)}
              value={colorToRgb255(value)}
              alpha={Math.round(value.a * 255)}
              onChange={(rgb) => onChange(setKonstColor(doc, slot, rgb255ToColor(rgb, value.a)), { status: `${konstColorName(slot)} changed.` })}
              onChangeAlpha={(alpha) => onChange(setKonstColor(doc, slot, { ...value, a: alpha / 255 }), { status: `${konstColorName(slot)} changed.` })}
            />
          </Field>
        </FieldGroup>
      </DetailsCategory>
    );
  }

  if (node.type === 'register') {
    const slot = node.slot;
    const value = doc.colorRegisters[slot];
    if (!value) return null;
    const readers = usedColorRegisters(doc.tevStages).find((entry) => entry.slot === slot)?.stages ?? [];
    return (
      <DetailsCategory name="Start colour">
        <FieldGroup>
          <Field
            label={colorRegisterName(slot)}
            asGroup
            help={
              readers.length > 0
                ? `${describeStages(readers).replace(/^s/, 'S')} reads it before anything writes to it.`
                : 'The value this slot holds before the first step writes to it.'
            }
          >
            <ColorField
              label={colorRegisterName(slot)}
              value={registerToRgb255(value)}
              alpha={Math.max(0, Math.min(255, value.a))}
              onChange={(rgb) => onChange(setColorRegister(doc, slot, rgb255ToRegister(rgb, value.a)), { status: `${colorRegisterName(slot)} changed.` })}
              onChangeAlpha={(alpha) => onChange(setColorRegister(doc, slot, { ...value, a: alpha }), { status: `${colorRegisterName(slot)} changed.` })}
            />
          </Field>
        </FieldGroup>
      </DetailsCategory>
    );
  }

  if (node.type === 'vertexColor') {
    // Channel 0 is what the simple Lighting controls describe. The second channel and the bump /
    // black sources have no simple view, so they get a sentence pointing at where they live.
    if (node.channel === 0) {
      return (
        <DetailsCategory name="Lighting">
          <ShadingSection doc={doc} onChange={onChange} />
        </DetailsCategory>
      );
    }
    return (
      <DetailsCategory name="Source">
        <p className="detailsNote">
          {node.channel === 1
            ? `${channelName(1)} is the material's second lighting channel. Its settings are under Lighting › Lighting channels on the material.`
            : `${channelName(node.channel)}: this input comes from the rasteriser, not from a value the material stores.`}
        </p>
      </DetailsCategory>
    );
  }

  return null;
}
