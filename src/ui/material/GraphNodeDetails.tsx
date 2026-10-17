import { useEffect, useState } from 'react';
import type { GraphInlineValue, GraphNode, GxMaterialDoc } from '../../lib/gxMaterial';
import { Field, FieldGroup, SegmentedControl, Select, Toggle } from '../components';
import {
  IND_TEX_BIAS_OPTIONS,
  IND_TEX_FORMAT_OPTIONS,
  IND_TEX_MATRIX_OPTIONS,
  IND_TEX_WRAP_OPTIONS,
  KONST_ALPHA_SEL_OPTIONS,
  KONST_COLOR_SEL_OPTIONS,
  OUTPUT_REGISTER_OPTIONS,
  RAS_CHANNEL_OPTIONS,
  STORED_SLOT_OPTIONS,
  TEV_OP_OPTIONS,
  caLabel,
  ccLabel,
  channelLabel,
  colorRegisterName,
  defaultKonstAlphaSel,
  defaultKonstColorSel,
  konstColorName,
  slotLabel,
  socketLabel,
  storedSlotName,
  tevOpLabel,
} from './gxOptions';
import {
  INLINE_VALUES,
  NODE_SUMMARY,
  inlineValue,
  inlineValueLabel,
  inputSource,
  nodeCaption,
  nodeSpec,
  nodeTitle,
  type EditorShaderGraph,
} from './graphModel';

export interface GraphNodeDetailsProps {
  node: GraphNode;
  graph: EditorShaderGraph;
  doc: GxMaterialDoc | null;
  /** Called with the whole replacement node; the host swaps it into the graph and records history. */
  onChangeNode: (next: GraphNode) => void;
  /** Draws the node's title and one-line description. Off when the host already shows them. */
  showHeader?: boolean;
}

/** Node types that become a step of their own, and so can name where the result is stored. */
const STEP_TYPES = new Set<GraphNode['type']>(['multiply', 'add', 'subtract', 'lerp', 'scale', 'compare']);

const INLINE_OPTIONS = INLINE_VALUES.map((value) => ({ value: String(value), label: inlineValueLabel(value), tooltip: `Use ${value}` }));

/**
 * Everything a graph node can be set to, for the Details panel. The node card on the canvas is
 * kept small, Unreal-style — a title, its pins and a thumbnail or swatch — and every setting that
 * would make it big lives here instead: which slot or channel it reads, the scale and bias, the
 * comparison, where a step stores its result, the warp setup, and again the inline values of its
 * unwired inputs.
 *
 * A texture node's layer (the image, its wrapping and filtering) is the host's to show above
 * this; here are only the node's own fields, which texture slot it samples and with which UV set.
 */
export function GraphNodeDetails({ node, graph, doc, onChangeNode, showHeader = true }: GraphNodeDetailsProps) {
  const patch = (fields: Partial<GraphNode>) => onChangeNode({ ...node, ...fields } as GraphNode);
  const caption = nodeCaption(node, doc);
  const spec = nodeSpec(node.type);
  const inputs = node.type === 'rawStage' || node.type === 'comment' ? [] : spec.inputs;

  return (
    <div className="graphDetails">
      {showHeader && (
        <div className="graphDetailsHeader">
          <strong>{nodeTitle(node)}{caption ? <span> · {caption}</span> : null}</strong>
          <p>{NODE_SUMMARY[node.type]}</p>
        </div>
      )}

      {node.unusedResult && (
        <p className="graphDetailsNote">Nothing later in the shader reads this result. The step still runs, but deleting it changes nothing on screen.</p>
      )}

      <NodeSettings node={node} doc={doc} patch={patch} />

      {inputs.length > 0 && (
        <FieldGroup title="Inputs">
          {inputs.map((input) => {
            const edge = inputSource(graph, node.id, input.name);
            const source = edge ? graph.nodes.find((entry) => entry.id === edge.from.node) : null;
            const value = inlineValue(node, input.name);
            return (
              <Field key={input.name} label={socketLabel(input.name)} asGroup>
                {source && edge ? (
                  <span className="graphDetailsWired">Wired from {nodeTitle(source)} · {socketLabel(edge.from.socket)}</span>
                ) : value !== null ? (
                  <SegmentedControl
                    label={`${socketLabel(input.name)} value`}
                    size="sm"
                    value={String(value)}
                    options={INLINE_OPTIONS}
                    onChange={(next) => patch({ inputValues: { ...node.inputValues, [input.name]: Number(next) as GraphInlineValue } })}
                  />
                ) : (
                  <span className="graphDetailsWired">Not wired — reads nothing until something is.</span>
                )}
              </Field>
            );
          })}
        </FieldGroup>
      )}

      {STEP_TYPES.has(node.type) && (
        <FieldGroup title="Result">
          <Field label="Store result in" help="Almost always the working slot. Pick a stored slot when a later step has to read this value after something else has overwritten the working slot.">
            <Select
              label="Store result in"
              size="sm"
              value={String((node as { outputRegister?: 'prev' | 0 | 1 | 2 }).outputRegister ?? 'prev')}
              options={OUTPUT_REGISTER_OPTIONS}
              onChange={(value) => patch({ outputRegister: value === 'prev' ? 'prev' : (Number(value) as 0 | 1 | 2) } as Partial<GraphNode>)}
            />
          </Field>
        </FieldGroup>
      )}

      {node.type !== 'comment' && (
        <FieldGroup>
          <Field label="Note" help="Shown under the node's title. Never becomes anything in the material.">
            <NoteInput
              key={node.id}
              value={node.label ?? ''}
              onCommit={(label) => patch({ label: label || undefined })}
            />
          </Field>
        </FieldGroup>
      )}
    </div>
  );
}

function NodeSettings({ node, doc, patch }: { node: GraphNode; doc: GxMaterialDoc | null; patch: (fields: Partial<GraphNode>) => void }) {
  switch (node.type) {
    case 'texture':
      return (
        <FieldGroup>
          <Field label="Texture slot">
            <Select
              label="Texture slot"
              size="sm"
              value={String(node.sampler)}
              options={Array.from({ length: Math.max(doc?.samplers.length ?? 0, node.sampler + 1) }, (_, index) => ({
                value: String(index),
                label: `Texture ${index + 1} — ${doc?.samplers[index]?.texture || 'none'}`,
              }))}
              onChange={(value) => patch({ sampler: Number(value) } as Partial<GraphNode>)}
            />
          </Field>
          <Field label="Coordinates">
            <Select
              label="Coordinates"
              size="sm"
              value={String(node.texCoord)}
              options={Array.from({ length: Math.max(1, doc?.texGens.length ?? 1, node.texCoord + 1) }, (_, index) => ({ value: String(index), label: `UV set ${index + 1}` }))}
              onChange={(value) => patch({ texCoord: Number(value) } as Partial<GraphNode>)}
            />
          </Field>
        </FieldGroup>
      );

    case 'vertexColor':
      return (
        <FieldGroup>
          <Field label="Source">
            <Select label="Source" size="sm" value={String(node.channel)} options={RAS_CHANNEL_OPTIONS} onChange={(value) => patch({ channel: Number(value) } as Partial<GraphNode>)} />
          </Field>
        </FieldGroup>
      );

    case 'constant':
      return (
        <FieldGroup>
          <Field label="Colour slot">
            <Select
              label="Colour slot"
              size="sm"
              value={String(node.slot)}
              options={[0, 1, 2, 3].map((slot) => ({ value: String(slot), label: konstColorName(slot) }))}
              // Changing the slot resets any explicit selection, so the two cannot disagree.
              onChange={(value) => patch({ slot: Number(value), colorSel: undefined, alphaSel: undefined } as Partial<GraphNode>)}
            />
          </Field>
          <Field label="Colour read" help="Which part of the colour the step reads: all of it, one channel, or one of the hardware's fixed fractions.">
            <Select
              label="Colour read"
              size="sm"
              value={String(node.colorSel ?? defaultKonstColorSel(node.slot))}
              options={KONST_COLOR_SEL_OPTIONS}
              onChange={(value) => patch({ colorSel: Number(value) } as Partial<GraphNode>)}
            />
          </Field>
          <Field label="Alpha read">
            <Select
              label="Alpha read"
              size="sm"
              value={String(node.alphaSel ?? defaultKonstAlphaSel(node.slot))}
              options={KONST_ALPHA_SEL_OPTIONS}
              onChange={(value) => patch({ alphaSel: Number(value) } as Partial<GraphNode>)}
            />
          </Field>
        </FieldGroup>
      );

    case 'register':
      return (
        <FieldGroup>
          <Field label="Slot">
            <Select
              label="Slot"
              size="sm"
              value={String(node.slot)}
              options={[0, 1, 2].map((slot) => ({ value: String(slot), label: colorRegisterName(slot) }))}
              onChange={(value) => patch({ slot: Number(value) } as Partial<GraphNode>)}
            />
          </Field>
        </FieldGroup>
      );

    case 'storedValue':
      return (
        <FieldGroup>
          <Field label="Reads">
            <Select
              label="Reads"
              size="sm"
              value={String(node.slot)}
              options={STORED_SLOT_OPTIONS}
              onChange={(value) => patch({ slot: value === 'prev' ? 'prev' : (Number(value) as 0 | 1 | 2) } as Partial<GraphNode>)}
            />
          </Field>
        </FieldGroup>
      );

    case 'value':
      return (
        <FieldGroup>
          <Field label="Value" asGroup>
            <SegmentedControl label="Value" size="sm" value={String(node.value)} options={INLINE_OPTIONS} onChange={(value) => patch({ value: Number(value) as GraphInlineValue } as Partial<GraphNode>)} />
          </Field>
        </FieldGroup>
      );

    case 'scale':
      return (
        <FieldGroup>
          <Field label="Multiply by" asGroup>
            <SegmentedControl
              label="Multiply by"
              size="sm"
              value={String(node.scale)}
              options={[0.5, 1, 2, 4].map((value) => ({ value: String(value), label: `×${value === 0.5 ? '½' : value}` }))}
              onChange={(value) => patch({ scale: Number(value) as 0.5 | 1 | 2 | 4 } as Partial<GraphNode>)}
            />
          </Field>
          <Field label="Then add" asGroup>
            <SegmentedControl
              label="Then add"
              size="sm"
              value={String(node.bias)}
              options={[-0.5, 0, 0.5].map((value) => ({ value: String(value), label: value === 0 ? '0' : value > 0 ? '+½' : '−½' }))}
              onChange={(value) => patch({ bias: Number(value) as -0.5 | 0 | 0.5 } as Partial<GraphNode>)}
            />
          </Field>
          <Field label="Clamp" asGroup>
            <Toggle label="Keep the result between 0 and 1" variant="checkbox" checked={node.clamp} onChange={(clamp) => patch({ clamp } as Partial<GraphNode>)} />
          </Field>
        </FieldGroup>
      );

    case 'compare':
      return (
        <FieldGroup>
          <Field label="Comparison" help="If A compares to B this way, the result is “If true”, otherwise 0 — plus “Plus” either way.">
            <Select
              label="Comparison"
              size="sm"
              value={String(node.op)}
              options={TEV_OP_OPTIONS.filter((option) => option.numeric >= 8)}
              onChange={(value) => patch({ op: Number(value) } as Partial<GraphNode>)}
            />
          </Field>
        </FieldGroup>
      );

    case 'indirectWarp':
      return (
        <FieldGroup>
          <Field label="Warp stage">
            <Select
              label="Warp stage"
              size="sm"
              value={String(node.indStage)}
              options={[0, 1, 2, 3].map((slot) => ({ value: String(slot), label: `Stage ${slot + 1}` }))}
              onChange={(value) => patch({ indStage: Number(value) } as Partial<GraphNode>)}
            />
          </Field>
          <Field label="Matrix">
            <Select label="Matrix" size="sm" value={String(node.matrix)} options={IND_TEX_MATRIX_OPTIONS} onChange={(value) => patch({ matrix: Number(value) } as Partial<GraphNode>)} />
          </Field>
          <Field label="Format">
            <Select label="Format" size="sm" value={String(node.format)} options={IND_TEX_FORMAT_OPTIONS} onChange={(value) => patch({ format: Number(value) } as Partial<GraphNode>)} />
          </Field>
          <Field label="Bias">
            <Select label="Bias" size="sm" value={String(node.bias)} options={IND_TEX_BIAS_OPTIONS} onChange={(value) => patch({ bias: Number(value) } as Partial<GraphNode>)} />
          </Field>
          <Field label="Wrap across">
            <Select label="Wrap across" size="sm" value={String(node.wrapS)} options={IND_TEX_WRAP_OPTIONS} onChange={(value) => patch({ wrapS: Number(value) } as Partial<GraphNode>)} />
          </Field>
          <Field label="Wrap down">
            <Select label="Wrap down" size="sm" value={String(node.wrapT)} options={IND_TEX_WRAP_OPTIONS} onChange={(value) => patch({ wrapT: Number(value) } as Partial<GraphNode>)} />
          </Field>
          <Field label="Accumulate" asGroup>
            <Toggle label="Add the previous warp" variant="checkbox" checked={node.addPrevious} onChange={(addPrevious) => patch({ addPrevious } as Partial<GraphNode>)} />
          </Field>
        </FieldGroup>
      );

    case 'rawStage': {
      const stage = node.stage;
      return (
        <>
          <p className="graphDetailsNote">
            {node.reason ?? 'This step does something the node editor cannot draw.'} It is kept exactly as the file had it
            and written back untouched.
          </p>
          <dl className="graphDetailsStage">
            <dt>Texture</dt>
            <dd>{`${slotLabel(stage.texMap)} · ${channelLabel(stage.channelId)}`}</dd>
            <dt>Colour</dt>
            <dd>{`${ccLabel(stage.colorInA)}, ${ccLabel(stage.colorInB)}, ${ccLabel(stage.colorInC)}, ${ccLabel(stage.colorInD)}`}</dd>
            <dt>Alpha</dt>
            <dd>{`${caLabel(stage.alphaInA)}, ${caLabel(stage.alphaInB)}, ${caLabel(stage.alphaInC)}, ${caLabel(stage.alphaInD)}`}</dd>
            <dt>Operation</dt>
            <dd>{`${tevOpLabel(stage.colorOp)} → ${storedSlotName(stage.colorRegId === 0 ? 'prev' : ((stage.colorRegId - 1) as 0 | 1 | 2))}`}</dd>
          </dl>
        </>
      );
    }

    case 'comment':
      return (
        <FieldGroup>
          <Field label="Text">
            <textarea
              className="materialTextInput graphDetailsText"
              value={node.text}
              rows={4}
              onChange={(event) => patch({ text: event.currentTarget.value } as Partial<GraphNode>)}
            />
          </Field>
        </FieldGroup>
      );

    default:
      return null;
  }
}

/**
 * The note is typed into a local draft and written on blur or Enter, so a sentence is one undo
 * step rather than one per keystroke. Esc throws the draft away.
 */
function NoteInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className="materialTextInput"
      type="text"
      value={draft}
      placeholder="Add a note"
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          event.stopPropagation();
        }
      }}
    />
  );
}
