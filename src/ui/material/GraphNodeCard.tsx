import { AlertTriangle } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { GraphDiagnostic, GxMaterialDoc } from '../../lib/gxMaterial';
import { ColorField, Select, Toggle, Tooltip } from '../components';
import { TexturePreview } from '../visual/TexturePreview';
import type { VisualTextureInfo } from '../visual/visualArchive';
import {
  IND_TEX_BIAS_OPTIONS,
  IND_TEX_FORMAT_OPTIONS,
  IND_TEX_MATRIX_OPTIONS,
  IND_TEX_WRAP_OPTIONS,
  KONST_ALPHA_SEL_OPTIONS,
  KONST_COLOR_SEL_OPTIONS,
  TEV_OP_OPTIONS,
  caLabel,
  ccLabel,
  channelLabel,
  channelName,
  colorRegisterName,
  defaultKonstAlphaSel,
  defaultKonstColorSel,
  konstColorName,
  registerLabel,
  slotLabel,
  socketLabel,
  tevOpLabel,
} from './gxOptions';
import {
  NODE_CATEGORY,
  NODE_SUMMARY,
  nodeCaption,
  nodeSize,
  nodeSpec,
  nodeTitle,
  SOCKET_SPACING,
  SOCKET_TOP,
  socketType,
  type EditorGraphNode,
  type EditorShaderGraph,
} from './graphModel';
import { colorToRgb255, registerToRgb255, rgb255ToColor, rgb255ToRegister, setColorRegister, setKonstColor } from './materialDoc';
import type { MaterialDocChange } from './MaterialInspector';

export interface GraphNodeCardProps {
  graph: EditorShaderGraph;
  node: EditorGraphNode;
  doc: GxMaterialDoc | null;
  textures: VisualTextureInfo[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  selected: boolean;
  shake: boolean;
  diagnostics: GraphDiagnostic[];
  onPatch: (patch: Partial<EditorGraphNode>) => void;
  onChangeDoc: MaterialDocChange;
  onPointerDownNode: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void;
  onPointerDownSocket: (event: ReactPointerEvent<HTMLElement>, nodeId: string, socket: string, side: 'input' | 'output') => void;
}

/**
 * One node in the shader graph: a coloured title bar, input sockets down the left, output sockets
 * down the right, and the node's own controls in between. Everything a node edits is either its
 * own field or — for the colour nodes — the material's konst/register colour, so a swatch here
 * changes what the viewport draws immediately.
 */
export function GraphNodeCard({
  graph,
  node,
  doc,
  textures,
  archivePath,
  archiveBytes,
  selected,
  shake,
  diagnostics,
  onPatch,
  onChangeDoc,
  onPointerDownNode,
  onPointerDownSocket,
}: GraphNodeCardProps) {
  const spec = nodeSpec(node.type);
  const size = nodeSize(node);
  const category = NODE_CATEGORY[node.type];
  const title = nodeTitle(node);
  const caption = nodeCaption(node, doc);
  const error = diagnostics.find((entry) => entry.severity === 'error');
  const warning = diagnostics.find((entry) => entry.severity === 'warning');

  if (node.type === 'comment') {
    return (
      <div
        className={selected ? 'graphNode graphComment selected' : 'graphNode graphComment'}
        style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
        data-node={node.id}
        onPointerDown={(event) => onPointerDownNode(event, node.id)}
      >
        <textarea
          className="graphCommentText"
          value={node.text}
          aria-label="Comment"
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => onPatch({ text: event.currentTarget.value } as Partial<EditorGraphNode>)}
        />
        <span
          className="graphCommentResize"
          aria-hidden="true"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            const startX = event.clientX;
            const startY = event.clientY;
            const startWidth = node.width;
            const startHeight = node.height;
            const move = (moveEvent: PointerEvent) => {
              onPatch({
                width: Math.max(120, startWidth + (moveEvent.clientX - startX)),
                height: Math.max(80, startHeight + (moveEvent.clientY - startY)),
              } as Partial<EditorGraphNode>);
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={['graphNode', `graphNode--${category}`, selected && 'selected', shake && 'shake'].filter(Boolean).join(' ')}
      style={{ left: node.x, top: node.y, width: size.width, minHeight: size.height }}
      data-node={node.id}
      onPointerDown={(event) => onPointerDownNode(event, node.id)}
    >
      <header className="graphNodeHeader">
        {/* "Texture 1 · road_tex", not "TEXMAP0 / TEXCOORD0". The caption is the dimmed half and
            the whole thing is one tooltip, because 176px of card cannot hold both in full. */}
        <Tooltip label={`${title}${caption ? ` · ${caption}` : ''} — ${NODE_SUMMARY[node.type]}`} side="top">
          <span className="graphNodeTitle">
            {title}
            {caption && <span className="graphNodeCaption"> · {caption}</span>}
          </span>
        </Tooltip>
        {(error || warning) && (
          <Tooltip label={(error ?? warning)!.message} side="top">
            <span className={error ? 'graphNodeBadge error' : 'graphNodeBadge warning'}>
              <AlertTriangle size={11} />
            </span>
          </Tooltip>
        )}
      </header>

      {spec.inputs.map((input, index) => (
        <span
          key={`in-${input.name}`}
          className={`graphSocket graphSocket--in graphSocket--${socketType(graph, node.id, input.name, 'input')}`}
          style={{ top: SOCKET_TOP + index * SOCKET_SPACING - 5 }}
          data-socket={`${node.id}|${input.name}|input`}
          title={`${socketLabel(input.name)} — takes ${socketType(graph, node.id, input.name, 'input') === 'alpha' ? 'alpha' : 'colour'}`}
          onPointerDown={(event) => onPointerDownSocket(event, node.id, input.name, 'input')}
        >
          <i />
          <label>{socketLabel(input.name)}</label>
        </span>
      ))}

      {spec.outputs.map((output, index) => (
        <span
          key={`out-${output.name}`}
          className={`graphSocket graphSocket--out graphSocket--${socketType(graph, node.id, output.name, 'output')}`}
          style={{ top: SOCKET_TOP + index * SOCKET_SPACING - 5 }}
          data-socket={`${node.id}|${output.name}|output`}
          title={`${socketLabel(output.name)} — gives ${socketType(graph, node.id, output.name, 'output') === 'alpha' ? 'alpha' : 'colour'}`}
          onPointerDown={(event) => onPointerDownSocket(event, node.id, output.name, 'output')}
        >
          <label>{socketLabel(output.name)}</label>
          <i />
        </span>
      ))}

      <div className="graphNodeBody" onPointerDown={(event) => event.stopPropagation()}>
        {node.type === 'texture' && (
          <>
            <TexturePreview
              archivePath={archivePath}
              archiveBytes={archiveBytes}
              texture={textures.find((texture) => texture.name === doc?.samplers[node.sampler]?.texture) ?? null}
              revision={0}
            />
            <Select
              label="Which texture"
              size="sm"
              value={String(node.sampler)}
              options={(doc?.samplers ?? []).map((sampler, index) => ({ value: String(index), label: `Texture ${index + 1} — ${sampler.texture || 'none'}` }))}
              onChange={(value) => onPatch({ sampler: Number(value) } as Partial<EditorGraphNode>)}
            />
            <Select
              label="Coordinates"
              size="sm"
              value={String(node.texCoord)}
              options={Array.from({ length: Math.max(1, doc?.texGens.length ?? 1) }, (_, index) => ({ value: String(index), label: `UV set ${index + 1}` }))}
              onChange={(value) => onPatch({ texCoord: Number(value) } as Partial<EditorGraphNode>)}
            />
          </>
        )}

        {node.type === 'vertexColor' && (
          <Select
            label="Which channel"
            size="sm"
            value={String(node.channel)}
            options={[
              { value: '0', label: channelName(0) },
              { value: '1', label: channelName(1) },
            ]}
            onChange={(value) => onPatch({ channel: Number(value) } as Partial<EditorGraphNode>)}
          />
        )}

        {node.type === 'constant' && doc && (
          <>
            <div className="graphNodeColorRow">
              <ColorField
                label={konstColorName(node.slot)}
                value={colorToRgb255(doc.konstColors[node.slot])}
                onChange={(rgb) => onChangeDoc(setKonstColor(doc, node.slot, rgb255ToColor(rgb, doc.konstColors[node.slot].a)), { status: `${konstColorName(node.slot)} changed.` })}
              />
              <Select
                label="Which colour"
                size="sm"
                value={String(node.slot)}
                options={[0, 1, 2, 3].map((slot) => ({ value: String(slot), label: konstColorName(slot) }))}
                onChange={(value) => {
                  // Changing the slot resets any explicit selection, so the two cannot disagree.
                  const slot = Number(value);
                  onPatch({ slot, colorSel: undefined, alphaSel: undefined } as Partial<EditorGraphNode>);
                }}
              />
            </div>
            {/* Most materials just read the whole K register, so the exact selection is folded
                away; a stage that wants a hardware fraction or a single channel needs it. */}
            <details className="graphNodeAdvanced">
              <summary>Advanced</summary>
              <Select
                label="Colour selection"
                size="sm"
                value={String(node.colorSel ?? defaultKonstColorSel(node.slot))}
                options={KONST_COLOR_SEL_OPTIONS}
                onChange={(value) => onPatch({ colorSel: Number(value) } as Partial<EditorGraphNode>)}
              />
              <Select
                label="Alpha selection"
                size="sm"
                value={String(node.alphaSel ?? defaultKonstAlphaSel(node.slot))}
                options={KONST_ALPHA_SEL_OPTIONS}
                onChange={(value) => onPatch({ alphaSel: Number(value) } as Partial<EditorGraphNode>)}
              />
            </details>
          </>
        )}

        {node.type === 'register' && doc && (
          <div className="graphNodeColorRow">
            <ColorField
              label={colorRegisterName(node.slot)}
              value={registerToRgb255(doc.colorRegisters[node.slot])}
              onChange={(rgb) => onChangeDoc(setColorRegister(doc, node.slot, rgb255ToRegister(rgb, doc.colorRegisters[node.slot].a)), { status: `${colorRegisterName(node.slot)} changed.` })}
            />
            <Select
              label="Which slot"
              size="sm"
              value={String(node.slot)}
              options={[0, 1, 2].map((slot) => ({ value: String(slot), label: colorRegisterName(slot) }))}
              onChange={(value) => onPatch({ slot: Number(value) } as Partial<EditorGraphNode>)}
            />
          </div>
        )}

        {node.type === 'value' && (
          <div className="graphSegmented" role="group" aria-label="Value">
            {[0, 0.5, 1].map((value) => (
              <button
                key={value}
                type="button"
                className={node.value === value ? 'active' : undefined}
                onClick={() => onPatch({ value: value as 0 | 0.5 | 1 } as Partial<EditorGraphNode>)}
              >
                {value}
              </button>
            ))}
          </div>
        )}

        {node.type === 'scale' && (
          <>
            <div className="graphSegmented" role="group" aria-label="Scale">
              {[0.5, 1, 2, 4].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={node.scale === value ? 'active' : undefined}
                  onClick={() => onPatch({ scale: value as 0.5 | 1 | 2 | 4 } as Partial<EditorGraphNode>)}
                >
                  x{value}
                </button>
              ))}
            </div>
            <div className="graphSegmented" role="group" aria-label="Bias">
              {[-0.5, 0, 0.5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={node.bias === value ? 'active' : undefined}
                  onClick={() => onPatch({ bias: value as -0.5 | 0 | 0.5 } as Partial<EditorGraphNode>)}
                >
                  {value > 0 ? `+${value}` : value}
                </button>
              ))}
            </div>
            <Toggle
              variant="checkbox"
              label="Clamp to 0..1"
              checked={node.clamp}
              onChange={(checked) => onPatch({ clamp: checked } as Partial<EditorGraphNode>)}
            />
          </>
        )}

        {node.type === 'compare' && (
          <Select
            label="Comparison"
            size="sm"
            value={String(node.op)}
            options={TEV_OP_OPTIONS.filter((option) => option.numeric >= 8)}
            onChange={(value) => onPatch({ op: Number(value) } as Partial<EditorGraphNode>)}
          />
        )}

        {node.type === 'indirectWarp' && (
          <>
            <Select
              label="Indirect stage"
              size="sm"
              value={String(node.indStage)}
              options={[0, 1, 2, 3].map((slot) => ({ value: String(slot), label: `Stage ${slot + 1}` }))}
              onChange={(value) => onPatch({ indStage: Number(value) } as Partial<EditorGraphNode>)}
            />
            <Select
              label="Matrix"
              size="sm"
              value={String(node.matrix)}
              options={IND_TEX_MATRIX_OPTIONS}
              onChange={(value) => onPatch({ matrix: Number(value) } as Partial<EditorGraphNode>)}
            />
            <Select
              label="Format"
              size="sm"
              value={String(node.format)}
              options={IND_TEX_FORMAT_OPTIONS}
              onChange={(value) => onPatch({ format: Number(value) } as Partial<EditorGraphNode>)}
            />
            <Select
              label="Bias"
              size="sm"
              value={String(node.bias)}
              options={IND_TEX_BIAS_OPTIONS}
              onChange={(value) => onPatch({ bias: Number(value) } as Partial<EditorGraphNode>)}
            />
            <Select
              label="Wrap across"
              size="sm"
              value={String(node.wrapS)}
              options={IND_TEX_WRAP_OPTIONS}
              onChange={(value) => onPatch({ wrapS: Number(value) } as Partial<EditorGraphNode>)}
            />
            <Select
              label="Wrap down"
              size="sm"
              value={String(node.wrapT)}
              options={IND_TEX_WRAP_OPTIONS}
              onChange={(value) => onPatch({ wrapT: Number(value) } as Partial<EditorGraphNode>)}
            />
            <Toggle
              variant="checkbox"
              label="Add the previous warp"
              checked={node.addPrevious}
              onChange={(checked) => onPatch({ addPrevious: checked } as Partial<EditorGraphNode>)}
            />
          </>
        )}

        {/* Read-only on purpose: this is a stage the graph cannot express, kept exactly as the
            file had it. Its `prev` socket carries no value, only the order it runs in. */}
        {node.type === 'rawStage' && (
          <>
            <p className="graphRawStageNote">
              This step does something the node editor cannot draw, so it is kept exactly as the
              file had it and written back untouched. Everything else in the graph still compiles
              around it.
            </p>
            <dl className="graphRawStage">
              <div>
                <dt>Texture</dt>
                <dd>{`${slotLabel(node.stage.texMap)} · ${channelLabel(node.stage.channelId)}`}</dd>
              </div>
              <div>
                <dt>Colour</dt>
                <dd title={`${ccLabel(node.stage.colorInA)}, ${ccLabel(node.stage.colorInB)}, ${ccLabel(node.stage.colorInC)}, ${ccLabel(node.stage.colorInD)}`}>
                  {`${ccLabel(node.stage.colorInA)}, ${ccLabel(node.stage.colorInB)}, ${ccLabel(node.stage.colorInC)}, ${ccLabel(node.stage.colorInD)}`}
                </dd>
              </div>
              <div>
                <dt>Alpha</dt>
                <dd title={`${caLabel(node.stage.alphaInA)}, ${caLabel(node.stage.alphaInB)}, ${caLabel(node.stage.alphaInC)}, ${caLabel(node.stage.alphaInD)}`}>
                  {`${caLabel(node.stage.alphaInA)}, ${caLabel(node.stage.alphaInB)}, ${caLabel(node.stage.alphaInC)}, ${caLabel(node.stage.alphaInD)}`}
                </dd>
              </div>
              <div>
                <dt>Op</dt>
                <dd>{`${tevOpLabel(node.stage.colorOp)} → ${registerLabel(node.stage.colorRegId)}`}</dd>
              </div>
            </dl>
          </>
        )}
      </div>

      {node.label && <p className="graphNodeLabel">{node.label}</p>}
    </div>
  );
}
