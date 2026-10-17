import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDefaultMaterialDoc, type GraphNode, type ShaderGraph } from '../../lib/gxMaterial';
import { GraphNodeDetails } from './GraphNodeDetails';
import { addLayer } from './materialDoc';

const doc = addLayer(createDefaultMaterialDoc('road', 0), 'asphalt');

function render(node: GraphNode, graph: ShaderGraph = { version: 1, nodes: [node], edges: [] }, showHeader = true): string {
  return renderToStaticMarkup(<GraphNodeDetails node={node} graph={graph} doc={doc} onChangeNode={() => {}} showHeader={showHeader} />);
}

describe('GraphNodeDetails', () => {
  it('names the node and says what it does in plain words', () => {
    const markup = render({ id: 'm', type: 'multiply', x: 0, y: 0 });
    expect(markup).toContain('Multiply');
    expect(markup).toContain('Tinting and masking');
    expect(render({ id: 'm', type: 'multiply', x: 0, y: 0 }, undefined, false)).not.toContain('graphDetailsHeader');
  });

  it('holds what the card no longer shows: where a step stores its result', () => {
    const markup = render({ id: 'm', type: 'multiply', x: 0, y: 0, outputRegister: 1 });
    expect(markup).toContain('Store result in');
    expect(markup).toContain('Stored slot 2');
  });

  it('shows each unwired input as an inline value, and a wired one as where it comes from', () => {
    const graph: ShaderGraph = {
      version: 1,
      nodes: [
        { id: 'tex', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'l', type: 'lerp', x: 200, y: 0, inputValues: { t: 1 } },
      ],
      edges: [{ id: 'e', from: { node: 'tex', socket: 'rgb' }, to: { node: 'l', socket: 'a' } }],
    };
    const markup = render(graph.nodes[1], graph);
    expect(markup).toContain('Wired from Texture 1');
    expect(markup).toContain('aria-label="B value"');
    expect(markup).toContain('aria-label="Mix value"');
    expect(markup).not.toContain('aria-label="A value"');
  });

  it('gives a texture node only its own fields: which slot, which UV set', () => {
    const markup = render({ id: 'tex', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 });
    expect(markup).toContain('Texture slot');
    expect(markup).toContain('Texture 1 — asphalt');
    expect(markup).toContain('UV set 1');
  });

  it('spells out the scale node and the colour selections in words', () => {
    const scale = render({ id: 's', type: 'scale', scale: 2, bias: 0.5, clamp: true, x: 0, y: 0 });
    expect(scale).toContain('Multiply by');
    expect(scale).toContain('×2');
    expect(scale).toContain('+½');
    const constant = render({ id: 'k', type: 'constant', slot: 1, x: 0, y: 0 });
    expect(constant).toContain('Colour 2');
    expect(constant).toContain('Colour read');
    for (const jargon of ['KCSEL', 'KASEL', 'TEXMAP', 'RASC']) expect(constant).not.toContain(jargon);
  });

  it('says why a special step is read-only, with every field of it', () => {
    const stage = doc.tevStages[0];
    const markup = render({ id: 'r', type: 'rawStage', stage, reason: 'It reads a texture, but none is bound.', x: 0, y: 0 });
    expect(markup).toContain('none is bound');
    expect(markup).toContain('Operation');
    expect(markup).not.toContain('Store result in');
  });
});
