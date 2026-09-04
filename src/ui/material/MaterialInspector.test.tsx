import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createDefaultMaterialDoc,
  type GxMaterialDoc,
  type GxMaterialRef,
  type MaterialIssue,
  type ShaderGraph,
  type ShaderGraphPreset,
} from '../../lib/gxMaterial';
import { MaterialInspector } from './MaterialInspector';
import { MaterialOutliner } from './MaterialOutliner';
import { ShaderGraphDock } from './ShaderGraphDock';
import { StagesTable } from './StagesTable';
import { addLayer } from './materialDoc';
import { buildMaterialTree, listMaterialArchives } from './materialOutlinerModel';
import type { TrackDocument } from '../../lib/track';

const noop = () => {};
const ref: GxMaterialRef = { archivePath: 'course_model.brres', modelName: 'course', materialName: 'road' };

function docWithLayer(): GxMaterialDoc {
  return {
    ...addLayer(createDefaultMaterialDoc('road', 0), 'asphalt'),
    channels: [
      {
        materialColor: { r: 1, g: 1, b: 1, a: 1 },
        ambientColor: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
        color: { lightingEnabled: true, materialSource: 0 as never, ambientSource: 0 as never, litMask: 3, diffuseFunction: 2 as never, attenuationFunction: 2 as never },
        alpha: { lightingEnabled: false, materialSource: 1 as never, ambientSource: 0 as never, litMask: 0, diffuseFunction: 0 as never, attenuationFunction: 2 as never },
      },
    ],
    indTexStages: [{ texCoordId: 0 as never, texMap: 1 as never, scaleS: 0 as never, scaleT: 0 as never }],
    tevStages: [sampleStage()],
  };
}

/** One plain "texture x vertex colour" stage, the shape most course surfaces use. */
function sampleStage() {
  return {
    colorInA: 15, colorInB: 8, colorInC: 10, colorInD: 15,
    colorOp: 0, colorBias: 0, colorScale: 0, colorClamp: true, colorRegId: 0,
    alphaInA: 7, alphaInB: 4, alphaInC: 5, alphaInD: 7,
    alphaOp: 0, alphaBias: 0, alphaScale: 0, alphaClamp: true, alphaRegId: 0,
    texCoordId: 0, texMap: 0, channelId: 0,
    konstColorSel: 0x0c, konstAlphaSel: 0x1c,
    rasSwapTable: 0, texSwapTable: 0,
    indTexStage: 0, indTexFormat: 0, indTexBiasSel: 0, indTexAlphaSel: 0,
    indTexMatrix: 0, indTexWrapS: 0, indTexWrapT: 0,
    indTexAddPrev: false, indTexUseOrigLOD: false,
  } as GxMaterialDoc['tevStages'][number];
}

function renderInspector(
  doc: GxMaterialDoc | null,
  materialRef: GxMaterialRef | null = ref,
  hasTrack = true,
  issues: MaterialIssue[] = [],
): string {
  return renderToStaticMarkup(
    <MaterialInspector
      materialRef={materialRef}
      doc={doc}
      issues={issues}
      summary={null}
      textures={[]}
      archivePath="course_model.brres"
      archiveBytes={null}
      meshCount={4}
      onChange={noop}
      onImportTexture={() => true}
      hasTrack={hasTrack}
    />,
  );
}

describe('MaterialInspector', () => {
  it('asks for a track before anything else', () => {
    const markup = renderInspector(null, null, false);
    expect(markup).toContain('No track loaded');
  });

  it('asks for a selection when a track is open but nothing is picked', () => {
    expect(renderInspector(null, null)).toContain('No material selected');
  });

  it('shows the five plain-language sections for a selected material', () => {
    const markup = renderInspector(docWithLayer());
    for (const title of ['Textures (1)', 'Transparency', 'Lighting', 'Colours', 'Surface']) {
      expect(markup).toContain(title);
    }
  });

  it('leads with the simple choices, in words', () => {
    const markup = renderInspector(docWithLayer());
    for (const choice of ['Opaque', 'Cutout', 'Transparent', 'Repeat', 'Mirror', 'Clamp', 'Smooth', 'Pixelated', 'Two-sided', 'Environment map']) {
      expect(markup).toContain(choice);
    }
  });

  it('keeps the hardware controls behind closed disclosures', () => {
    const markup = renderInspector(docWithLayer());
    // The Advanced blocks are collapsed, so their contents are not even rendered...
    expect(markup).toContain('Advanced');
    expect(markup).toContain('aria-expanded="false"');
    for (const raw of ['Blend source factor', 'Depth comparison', 'Swap table', 'texgen', 'Indirect matrix']) {
      expect(markup).not.toContain(raw);
    }
  });

  it('shows only the colours the shader actually reads', () => {
    // `sampleStage` reads no konst colour and no register, so there is nothing to show.
    expect(renderInspector(docWithLayer())).toContain('No colours in the shader');

    const tinted = docWithLayer();
    // Konst as the C input, selecting K1: exactly one swatch, named "Colour 2".
    tinted.tevStages = [{ ...tinted.tevStages[0], colorInC: 14, konstColorSel: 0x0d }];
    const markup = renderInspector(tinted);
    expect(markup).toContain('Colour 2');
    expect(markup).not.toContain('Colour 4');
  });

  it('names the material, its model and how much of the course it draws', () => {
    const markup = renderInspector(docWithLayer());
    expect(markup).toContain('road');
    expect(markup).toContain('course');
    expect(markup).toContain('4 meshes');
  });

  it('binds the material fields to the document', () => {
    const doc = { ...docWithLayer(), cullMode: 0 as never, translucent: true, blend: { ...docWithLayer().blend, mode: 1 as never } };
    const markup = renderInspector(doc);
    // The name is the inspector's heading field, and the simple controls read the document.
    expect(markup).toContain('value="road"');
    expect(markup).toContain('Both sides');
    expect(markup).toContain('See-through');
  });

  it('shows a layer\'s texture and its placement', () => {
    const doc = docWithLayer();
    doc.texSrts[0] = { ...doc.texSrts[0], rotation: 45, scaleS: 2 };
    const markup = renderInspector(doc);
    expect(markup).toContain('Placement');
    expect(markup).toContain('45');
    // The texgen fields moved into the layer's own Advanced block, which starts closed.
    expect(markup).not.toContain('Generated as');
  });

  it('says so when a material has no layers and no colours', () => {
    const markup = renderInspector({ ...createDefaultMaterialDoc('flat', 0), channels: [], samplers: [], tevStages: [] });
    expect(markup).toContain('No textures');
    expect(markup).toContain('No lighting channels');
    expect(markup).toContain('No colours in the shader');
  });

  it('shows the defects the library reports, without blocking the edit', () => {
    const markup = renderInspector(docWithLayer(), ref, true, [
      { code: 'stage.texmap', message: 'Stage 0 samples texture slot 3, which has no layer.' },
    ]);
    expect(markup).toContain('Stage 0 samples texture slot 3, which has no layer.');
    expect(markup).toContain('materialIssues');
    // A clean material shows no strip at all.
    expect(renderInspector(docWithLayer())).not.toContain('materialIssues');
  });

  it('hides the palette slot unless the layer samples a paletted texture', () => {
    // No textures are handed in, so no layer can be paletted.
    expect(renderInspector(docWithLayer())).not.toContain('Palette slot');
  });

  it('never shows a raw GX enum identifier', () => {
    const markup = renderInspector(docWithLayer());
    for (const jargon of ['RASC', 'TEXC', 'KCSEL', 'LIN_MIP_LIN', 'INVSRCALPHA', 'CompareType', 'GX.']) {
      expect(markup).not.toContain(jargon);
    }
  });
});

describe('StagesTable', () => {
  it('says so when there are no stages', () => {
    expect(renderToStaticMarkup(<StagesTable stages={[]} />)).toContain('No stages');
  });

  it('names every stage input in plain language', () => {
    const markup = renderToStaticMarkup(<StagesTable stages={[sampleStage()]} />);
    expect(markup).toContain('Texture (RGB)');
    expect(markup).toContain('Vertex colour (RGB)');
    expect(markup).toContain('Channel 1');
    expect(markup).toContain('K0');
    expect(markup).not.toContain('RASC');
    expect(markup).not.toContain('TEXC');
  });
});

function renderDock(
  tab: 'graph' | 'stages',
  open = true,
  doc: GxMaterialDoc | null = docWithLayer(),
  extra: { graph?: ShaderGraph; presets?: ShaderGraphPreset[]; convertible?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <ShaderGraphDock
      open={open}
      height={260}
      collapsedHeight={30}
      resizing={false}
      onBeginResize={noop}
      onResetSize={noop}
      onToggleOpen={noop}
      tab={tab}
      onChangeTab={noop}
      materialRef={doc ? ref : null}
      doc={doc}
      graph={extra.graph ?? { version: 1, nodes: [{ id: 'o', type: 'output', x: 0, y: 0 }], edges: [] }}
      compiled={null}
      graphDrivesMaterial={false}
      presets={extra.presets ?? []}
      historyState={{ undo: 0, redo: 0 }}
      textures={[]}
      archivePath="course_model.brres"
      archiveBytes={null}
      onChangeGraph={noop}
      onUndo={noop}
      onRedo={noop}
      onResetFromStages={noop}
      onConvertRawStages={noop}
      rawStagesConvertible={extra.convertible ?? false}
      onApplyPreset={noop}
      onAutoLayout={noop}
      onChangeDoc={noop}
    />,
  );
}

describe('ShaderGraphDock', () => {
  it('offers the Graph and Stages tabs', () => {
    const markup = renderDock('graph');
    expect(markup).toContain('Graph');
    expect(markup).toContain('Stages');
    expect(markup).toContain('role="tablist"');
  });

  it('marks the active tab and renders its panel', () => {
    expect(renderDock('stages')).toContain('aria-label="TEV stages"');
    expect(renderDock('graph')).toContain('aria-label="Shader graph"');
  });

  it('shows the graph surface on the Graph tab and the table on the Stages tab', () => {
    expect(renderDock('graph')).toContain('graphSurface');
    expect(renderDock('stages')).toContain('materialStagesTable');
    expect(renderDock('stages')).not.toContain('graphSurface');
  });

  it('reports the stage and texture count from the material when nothing has compiled yet', () => {
    expect(renderDock('graph')).toContain('1 stage · 1 texture');
  });

  it('keeps the header but drops the body when collapsed', () => {
    const markup = renderDock('graph', false);
    expect(markup).toContain('Shader');
    expect(markup).not.toContain('graphSurface');
    expect(markup).toContain('contentBrowser collapsed');
  });

  it('asks for a selection when no material is picked', () => {
    expect(renderDock('graph', true, null)).toContain('No material selected');
  });

  it('takes the content browser\'s dock slot and its resize handle', () => {
    const markup = renderDock('graph');
    expect(markup).toContain('contentBrowserResizeHandle');
    expect(markup).toContain('height:260px');
  });

  it('puts the presets in the open, one click each', () => {
    const presets: ShaderGraphPreset[] = [
      { id: 'unlit-texture', title: 'Texture x vertex colour', description: 'What most road materials do.', samplerCount: 1, graph: { version: 1, nodes: [], edges: [] } },
    ];
    const markup = renderDock('graph', true, docWithLayer(), { presets });
    expect(markup).toContain('materialPresetBar');
    expect(markup).toContain('Texture x vertex colour');
    // ...and only on the graph tab, where they mean something.
    expect(renderDock('stages', true, docWithLayer(), { presets })).not.toContain('materialPresetBar');
  });

  it('names the nodes after what they are, not after the hardware', () => {
    const graph: ShaderGraph = {
      version: 1,
      nodes: [
        { id: 'tex', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
        { id: 'vc', type: 'vertexColor', channel: 0, x: 0, y: 120 },
        { id: 'k', type: 'constant', slot: 2, x: 0, y: 240 },
        { id: 'o', type: 'output', x: 300, y: 0 },
      ],
      edges: [],
    };
    const markup = renderDock('graph', true, docWithLayer(), { graph });
    expect(markup).toContain('Texture 1');
    expect(markup).toContain('asphalt');
    expect(markup).toContain('Vertex colour');
    expect(markup).toContain('Colour 3');
    for (const jargon of ['TEXMAP', 'TEXCOORD', 'KCSEL', 'RASC']) expect(markup).not.toContain(jargon);
  });

  it('explains the read-only stage it cannot draw', () => {
    const graph: ShaderGraph = {
      version: 1,
      nodes: [
        { id: 'raw', type: 'rawStage', stage: sampleStage(), x: 0, y: 0 },
        { id: 'o', type: 'output', x: 300, y: 0 },
      ],
      edges: [],
    };
    const markup = renderDock('graph', true, docWithLayer(), { graph });
    expect(markup).toContain('Special step');
    expect(markup).toContain('cannot draw');
  });
});

describe('MaterialOutliner', () => {
  const track = {
    archiveEntries: [
      { type: 'file' as const, path: 'course_model.brres', data: new Uint8Array(4) },
      { type: 'file' as const, path: 'vrcorn_model.brres', data: new Uint8Array(4) },
    ],
  } as unknown as TrackDocument;

  function render(query = '', archives = new Map()): string {
    return renderToStaticMarkup(
      <MaterialOutliner
        tree={buildMaterialTree(listMaterialArchives(track), archives, query)}
        query={query}
        onChangeQuery={noop}
        expanded={['course_model.brres']}
        onChangeExpanded={noop}
        selected={null}
        onSelect={noop}
        onHover={noop}
        loading={false}
        error={null}
        hasTrack
      />,
    );
  }

  it('lists the track\'s archives by their friendly names', () => {
    const markup = render();
    expect(markup).toContain('Track model');
    expect(markup).toContain('Skybox');
    expect(markup).not.toContain('vrcorn_model.brres');
  });

  it('shows an unopened archive as still loading', () => {
    expect(render()).toContain('Reading course_model.brres');
  });

  it('offers a search box', () => {
    expect(render()).toContain('aria-label="Search materials"');
  });

  it('asks for a track when there is none', () => {
    const markup = renderToStaticMarkup(
      <MaterialOutliner
        tree={[]}
        query=""
        onChangeQuery={noop}
        expanded={[]}
        onChangeExpanded={noop}
        selected={null}
        onSelect={noop}
        onHover={noop}
        loading={false}
        error={null}
        hasTrack={false}
      />,
    );
    expect(markup).toContain('No track loaded');
  });
});
