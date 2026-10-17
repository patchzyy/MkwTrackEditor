import { AlertTriangle } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { GraphDiagnostic, GraphInlineValue, GxMaterialDoc } from '../../lib/gxMaterial';
import { ColorField, Tooltip } from '../components';
import { TexturePreview } from '../visual/TexturePreview';
import type { VisualTextureInfo } from '../visual/visualArchive';
import { colorRegisterName, konstColorName, socketLabel } from './gxOptions';
import {
  INLINE_VALUES,
  NODE_CATEGORY,
  NODE_SUMMARY,
  inlineValue,
  inlineValueLabel,
  nodeCaption,
  nodeSize,
  nodeSpec,
  nodeTitle,
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
  /** `node|socket|side` of every socket with a wire on it. */
  connected: ReadonlySet<string>;
  onPatch: (patch: Partial<EditorGraphNode>) => void;
  onSetInputValue: (socket: string, value: GraphInlineValue) => void;
  onChangeDoc: MaterialDocChange;
  /**
   * Re-reads the material's stages and rebuilds the graph. Offered on a "Special step" card,
   * because a graph saved before the editor learned a node still holds the read-only version.
   */
  onConvertRawStages?: () => void;
  /** True when a fresh read of this material's stages would draw every step as nodes. */
  rawStagesConvertible?: boolean;
  onPointerDownNode: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void;
  onPointerDownSocket: (event: ReactPointerEvent<HTMLElement>, nodeId: string, socket: string, side: 'input' | 'output') => void;
}

/**
 * Keeps a left press on a control from starting a node drag. Right and middle presses still reach
 * the canvas, so a right-drag pans from anywhere, controls included.
 */
const stop = (event: ReactPointerEvent) => {
  if (event.button === 0) event.stopPropagation();
};

/**
 * One node in the shader graph, drawn the way Unreal draws a material node: a header strip
 * coloured by what kind of node it is, then one tight row per pin — inputs on the left, outputs on
 * the right — and an unwired input shows its value inline, so a literal never needs a node and a
 * wire of its own. Settings live in the Details panel (`GraphNodeDetails`); the card keeps only
 * what is worth reading at a glance: a texture's thumbnail, a colour's swatch, a value.
 *
 * The card is drawn at exactly `nodeSize`, which is what the wires and the layout assume.
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
  connected,
  onPatch,
  onSetInputValue,
  onChangeDoc,
  onConvertRawStages,
  rawStagesConvertible,
  onPointerDownNode,
  onPointerDownSocket,
}: GraphNodeCardProps) {
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
          onPointerDown={stop}
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

  const spec = nodeSpec(node.type);
  const size = nodeSize(node);
  const category = NODE_CATEGORY[node.type] ?? 'math';
  const title = nodeTitle(node);
  const caption = nodeCaption(node, doc);
  const error = diagnostics.find((entry) => entry.severity === 'error');
  const warning = diagnostics.find((entry) => entry.severity === 'warning');
  const rows = Math.max(spec.inputs.length, spec.outputs.length);
  const unused = node.unusedResult === true;

  const tooltip = (
    <span className="graphNodeTip">
      <strong>{title}{caption ? ` · ${caption}` : ''}</strong>
      <span>{NODE_SUMMARY[node.type] ?? ''}</span>
      {unused && <span>Nothing later reads this result, so deleting it changes nothing on screen.</span>}
    </span>
  );

  return (
    <div
      className={[
        'graphNode',
        `graphNode--${category}`,
        node.type === 'output' && 'graphNode--result',
        unused && 'unused',
        selected && 'selected',
        shake && 'shake',
      ].filter(Boolean).join(' ')}
      style={{ left: node.x, top: node.y, width: size.width, height: size.height }}
      data-node={node.id}
      data-node-type={node.type}
      onPointerDown={(event) => onPointerDownNode(event, node.id)}
    >
      <header className="graphNodeHeader">
        <Tooltip label={tooltip} side="top" className="graphNodeTitleAnchor">
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

      <div className="graphNodeRows">
        {Array.from({ length: rows }, (_, index) => {
          const input = spec.inputs[index];
          const output = spec.outputs[index];
          return (
            <div className="graphRow" key={index}>
              {input ? (
                <InputPin
                  node={node}
                  name={input.name}
                  alpha={socketType(graph, node.id, input.name, 'input') === 'alpha'}
                  wired={connected.has(`${node.id}|${input.name}|input`)}
                  onPointerDownSocket={onPointerDownSocket}
                  onSetInputValue={onSetInputValue}
                />
              ) : <span />}
              {output && (
                <span
                  className={[
                    'graphSocket',
                    'graphSocket--out',
                    socketType(graph, node.id, output.name, 'output') === 'alpha' && 'graphSocket--alpha',
                    connected.has(`${node.id}|${output.name}|output`) && 'wired',
                  ].filter(Boolean).join(' ')}
                  data-socket={`${node.id}|${output.name}|output`}
                  title={`${socketLabel(output.name)} — gives ${socketType(graph, node.id, output.name, 'output') === 'alpha' ? 'an alpha' : 'a colour'}. Drag to wire it.`}
                  onPointerDown={(event) => onPointerDownSocket(event, node.id, output.name, 'output')}
                >
                  <span className="graphSocketLabel">{socketLabel(output.name)}</span>
                  <i />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {node.type === 'texture' && (
        <div className="graphNodeBody graphNodeBody--texture">
          <TexturePreview
            archivePath={archivePath}
            archiveBytes={archiveBytes}
            texture={textures.find((texture) => texture.name === doc?.samplers[node.sampler]?.texture) ?? null}
            revision={0}
          />
          <span className="graphNodeMeta">UV set {node.texCoord + 1}</span>
        </div>
      )}

      {node.type === 'constant' && doc?.konstColors[node.slot] && (
        <div className="graphNodeBody" onPointerDown={stop}>
          <ColorField
            label={konstColorName(node.slot)}
            value={colorToRgb255(doc.konstColors[node.slot])}
            onChange={(rgb) => onChangeDoc(setKonstColor(doc, node.slot, rgb255ToColor(rgb, doc.konstColors[node.slot].a)), { status: `${konstColorName(node.slot)} changed.` })}
          />
        </div>
      )}

      {node.type === 'register' && doc?.colorRegisters[node.slot] && (
        <div className="graphNodeBody" onPointerDown={stop}>
          <ColorField
            label={colorRegisterName(node.slot)}
            value={registerToRgb255(doc.colorRegisters[node.slot])}
            onChange={(rgb) => onChangeDoc(setColorRegister(doc, node.slot, rgb255ToRegister(rgb, doc.colorRegisters[node.slot].a)), { status: `${colorRegisterName(node.slot)} changed.` })}
          />
        </div>
      )}

      {node.type === 'output' && (
        <div className="graphNodeBody">
          <span className="graphNodeMeta">What the material draws</span>
        </div>
      )}

      {node.type === 'value' && (
        <div className="graphNodeBody" onPointerDown={stop}>
          <InlineValueSwitch
            label="Value"
            value={node.value}
            onChange={(value) => onPatch({ value } as Partial<EditorGraphNode>)}
          />
        </div>
      )}

      {/* Read-only on purpose: a stage the graph cannot express, kept exactly as the file had it.
          Never a dead end: the card says in one sentence what it is that cannot be drawn, and
          offers to redraw the whole graph. Every field of it is in the Details panel. */}
      {node.type === 'rawStage' && (
        <div className="graphNodeBody graphNodeBody--raw" onPointerDown={stop}>
          <p className="graphRawStageNote">
            {node.reason ?? 'This step does something the node editor cannot draw.'}
            {' '}Kept exactly as the file had it; the <strong>Stages</strong> tab shows every field.
          </p>
          {onConvertRawStages && (
            <button
              type="button"
              className="graphRawStageConvert"
              onClick={onConvertRawStages}
              title={rawStagesConvertible
                ? 'This editor can draw this step now. Rebuild the graph from the material\'s steps.'
                : 'Rebuild the graph from the material\'s steps.'}
            >
              {rawStagesConvertible ? 'Convert to nodes' : 'Rebuild from steps'}
            </button>
          )}
        </div>
      )}

      {node.label && <p className="graphNodeLabel">{node.label}</p>}
    </div>
  );
}

function InputPin({
  node,
  name,
  alpha,
  wired,
  onPointerDownSocket,
  onSetInputValue,
}: {
  node: EditorGraphNode;
  name: string;
  alpha: boolean;
  wired: boolean;
  onPointerDownSocket: GraphNodeCardProps['onPointerDownSocket'];
  onSetInputValue: GraphNodeCardProps['onSetInputValue'];
}) {
  const value = wired ? null : inlineValue(node, name);
  return (
    <span className="graphRowIn">
      <span
        className={['graphSocket', 'graphSocket--in', alpha && 'graphSocket--alpha', wired && 'wired'].filter(Boolean).join(' ')}
        data-socket={`${node.id}|${name}|input`}
        title={`${socketLabel(name)} — takes ${alpha ? 'an alpha' : 'a colour'}.${value !== null ? ' Wire something in, or set a value here.' : ' Wire something in.'}`}
        onPointerDown={(event) => onPointerDownSocket(event, node.id, name, 'input')}
      >
        <i />
        <span className="graphSocketLabel">{socketLabel(name)}</span>
      </span>
      {value !== null && (
        <InlineValueSwitch label={socketLabel(name)} value={value} onChange={(next) => onSetInputValue(name, next)} />
      )}
    </span>
  );
}

/**
 * The value typed into an unwired input, Unreal-style. The hardware's free constants are exactly
 * 0, ½ and 1, so this is a three-way switch rather than a number field.
 */
function InlineValueSwitch({ label, value, onChange }: { label: string; value: GraphInlineValue; onChange: (value: GraphInlineValue) => void }) {
  return (
    <span className="graphInline" role="radiogroup" aria-label={`${label} value`} onPointerDown={stop}>
      {INLINE_VALUES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? 'active' : undefined}
          title={`${label} = ${option}`}
          onClick={() => onChange(option)}
        >
          {inlineValueLabel(option)}
        </button>
      ))}
    </span>
  );
}
