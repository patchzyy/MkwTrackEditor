import { AlertTriangle, ChevronRight, MousePointerClick, Palette, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GxMaterialDoc, GxMaterialRef, GxMaterialSummary, GxTextureSummary, MaterialIssue } from '../../lib/gxMaterial';
import type { VisualTextureInfo } from '../visual/visualArchive';
import { Button, EmptyState, PanelSection } from '../components';
import { GraphNodeDetails } from './GraphNodeDetails';
import { NODE_SUMMARY, nodeCaption, nodeTitle, type EditorGraphNode, type EditorShaderGraph } from './graphModel';
import { addLayer, MAX_SAMPLERS } from './materialDoc';
import { TextureLayerDetails, TextureList } from './sections/LayersSection';
import { NodeMaterialField } from './sections/NodeMaterialField';
import { ShadingSection } from './sections/ShadingSection';
import { SimpleColorsSection } from './sections/SimpleColorsSection';
import { SurfaceSection } from './sections/SurfaceSection';
import { TransparencySection } from './sections/TransparencySection';
import { describeMaterial } from './materialSimple';
import { useArchiveTextures } from './useArchiveTextures';
import './details.css';

export type MaterialDocChange = (next: GxMaterialDoc, options?: { transient?: boolean; status?: string }) => void;

export interface ImportedTexture {
  name: string;
  format: number;
  width: number;
  height: number;
  mipCount: number;
  data: Uint8Array;
}

export interface MaterialInspectorProps {
  materialRef: GxMaterialRef | null;
  doc: GxMaterialDoc | null;
  /**
   * What is wrong with `doc` right now (`collectMaterialIssues`). Retail materials really do ship
   * with defects — a stage sampling a texture slot the material has no layer for — so these are
   * shown, not blocked; `applyMaterial` only refuses the ones the edit introduced.
   */
  issues: readonly MaterialIssue[];
  summary: GxMaterialSummary | null;
  textures: readonly GxTextureSummary[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  meshCount: number;
  onChange: MaterialDocChange;
  onImportTexture: (texture: ImportedTexture) => boolean;
  hasTrack: boolean;
  /** The shader graph on screen. Without one the panel only ever shows the material overview. */
  graph?: EditorShaderGraph | null;
  /** What is selected in the graph; drives which details are shown. */
  selectedNodeIds?: readonly string[];
  /** Selects these nodes in the graph (and frames them). An empty list goes back to the material. */
  onSelectNodes?: (nodeIds: string[]) => void;
  /** Replaces one node in the graph, as one undoable graph edit. */
  onChangeNode?: (next: EditorGraphNode) => void;
}

/**
 * The right-hand **Details** panel for the selected material, shaped like Unreal's material
 * editor: it shows whatever is selected in the shader graph.
 *
 * - **Nothing selected** (or the Material output node): the material itself — its name, what it
 *   looks like in one line, a compact list of its textures, and the simple Transparency /
 *   Lighting / Colours / Surface sections.
 * - **A texture node**: that one texture — a big preview, replace and export, tiling, sampling,
 *   placement — then the node's own fields.
 * - **Any other node**: the material value it stands for, when it stands for one (a Colour node's
 *   colour, a Vertex colour node's lighting), then the node's own fields.
 * - **Several nodes**: how many, and a way to pick one.
 *
 * Every section is **simple by default, advanced on demand**: it leads with the choices an author
 * actually makes, in words, and keeps the hardware state behind an `AdvancedBlock` that remembers
 * whether it was open. The mapping from a friendly control to the fields underneath lives in
 * `materialSimple.ts`, with tests — including the one that matters most, that reading a value
 * and writing it straight back changes nothing at all.
 *
 * Every control writes a whole new `GxMaterialDoc` through `onChange` (or a whole new node through
 * `onChangeNode`); nothing here knows what a byte is.
 */
export function MaterialInspector({
  materialRef,
  doc,
  issues,
  summary,
  textures,
  archivePath,
  archiveBytes,
  meshCount,
  onChange,
  onImportTexture,
  hasTrack,
  graph = null,
  selectedNodeIds = [],
  onSelectNodes,
  onChangeNode,
}: MaterialInspectorProps) {
  const textureInfos = useArchiveTextures(archiveBytes, textures);
  // A texture opened from the list when no node in the graph samples it — there is nothing to
  // select, but its settings still have to be reachable.
  const [openLayer, setOpenLayer] = useState<number | null>(null);
  const materialKey = materialRef ? `${materialRef.archivePath}|${materialRef.modelName}|${materialRef.materialName}` : '';
  const selectionKey = selectedNodeIds.join(',');
  useEffect(() => setOpenLayer(null), [materialKey, selectionKey]);

  if (!hasTrack) {
    return (
      <div className="materialInspector">
        <EmptyState
          icon={<Palette size={22} />}
          title="No track loaded"
          description="Open a .szs course archive, then pick a material on the left."
        />
      </div>
    );
  }

  if (!materialRef || !doc) {
    return (
      <div className="materialInspector">
        <EmptyState
          icon={<Palette size={22} />}
          title="No material selected"
          description="Pick a material on the left — or click the model — to edit its textures, colours and shader."
        />
      </div>
    );
  }

  const selectedNodes = graph ? graph.nodes.filter((node) => selectedNodeIds.includes(node.id)) : [];
  const single = selectedNodes.length === 1 ? selectedNodes[0] : null;
  // The output node *is* the material, so selecting it shows the material, as in Unreal.
  const focusNode = single && single.type !== 'output' ? single : null;

  const openTexture = (index: number) => {
    const node = graph?.nodes.find((candidate) => candidate.type === 'texture' && candidate.sampler === index);
    if (node && onSelectNodes) onSelectNodes([node.id]);
    else setOpenLayer(index);
  };
  const backToMaterial = () => {
    setOpenLayer(null);
    if (selectedNodeIds.length > 0) onSelectNodes?.([]);
  };

  const crumb = focusNode
    ? nodeHeading(focusNode, doc)
    : selectedNodes.length > 1
      ? `${selectedNodes.length} nodes`
      : openLayer !== null && doc.samplers[openLayer]
        ? `Texture ${openLayer + 1} · ${doc.samplers[openLayer].texture || 'none'}`
        : null;

  let body;
  if (focusNode) {
    body = (
      <NodeDetails
        node={focusNode}
        graph={graph}
        doc={doc}
        textureInfos={textureInfos}
        archivePath={archivePath}
        archiveBytes={archiveBytes}
        onChange={onChange}
        onImportTexture={onImportTexture}
        onChangeNode={onChangeNode}
      />
    );
  } else if (selectedNodes.length > 1) {
    body = <MultiSelection nodes={selectedNodes} doc={doc} onSelectNodes={onSelectNodes} />;
  } else if (openLayer !== null && doc.samplers[openLayer]) {
    body = (
      <TextureLayerDetails
        index={openLayer}
        doc={doc}
        textures={textureInfos}
        archivePath={archivePath}
        archiveBytes={archiveBytes}
        onChange={onChange}
        onImportTexture={onImportTexture}
      />
    );
  } else {
    body = (
      <MaterialOverview
        materialRef={materialRef}
        doc={doc}
        issues={issues}
        summary={summary}
        textureInfos={textureInfos}
        archivePath={archivePath}
        archiveBytes={archiveBytes}
        meshCount={meshCount}
        onChange={onChange}
        onOpenTexture={openTexture}
        hasGraph={graph !== null && onSelectNodes !== undefined}
      />
    );
  }

  return (
    <div className="materialInspector detailsPanel">
      {crumb !== null && (
        <nav className="detailsCrumbs" aria-label="Details path">
          <button type="button" className="detailsCrumb" title="Back to the material's settings" onClick={backToMaterial}>
            {doc.name}
          </button>
          <ChevronRight size={12} aria-hidden="true" />
          <span className="detailsCrumb is-current" aria-current="page">
            {crumb}
          </span>
        </nav>
      )}
      {body}
    </div>
  );
}

/** "Texture 1 · road_tex", "Colour 2", "Multiply" — what the node is, in the graph's own words. */
function nodeHeading(node: EditorGraphNode, doc: GxMaterialDoc): string {
  const caption = nodeCaption(node, doc);
  return caption ? `${nodeTitle(node)} · ${caption}` : nodeTitle(node);
}

function MaterialOverview({
  materialRef,
  doc,
  issues,
  summary,
  textureInfos,
  archivePath,
  archiveBytes,
  meshCount,
  onChange,
  onOpenTexture,
  hasGraph,
}: {
  materialRef: GxMaterialRef;
  doc: GxMaterialDoc;
  issues: readonly MaterialIssue[];
  summary: GxMaterialSummary | null;
  textureInfos: VisualTextureInfo[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  meshCount: number;
  onChange: MaterialDocChange;
  onOpenTexture: (index: number) => void;
  hasGraph: boolean;
}) {
  return (
    <>
      <div className="materialInspectorHeader">
        <input
          className="materialNameInput"
          type="text"
          value={doc.name}
          aria-label="Material name"
          title="Renaming rewrites every reference to this material in the model."
          onChange={(event) => onChange({ ...doc, name: event.currentTarget.value }, { transient: true })}
          onBlur={(event) => onChange({ ...doc, name: event.currentTarget.value }, { status: `Renamed the material to ${event.currentTarget.value}.` })}
        />
        <span className="materialInspectorWhere">
          {materialRef.modelName} · {archivePath.replace(/^\.\//, '')}
          {meshCount > 0 ? ` · ${meshCount} mesh${meshCount === 1 ? '' : 'es'}` : ''}
        </span>
        <span className="materialInspectorSummary">{describeMaterial(doc)}</span>
      </div>

      {hasGraph && (
        <p className="detailsHint">
          <MousePointerClick size={13} aria-hidden="true" />
          <span>Click a node in the shader graph to see just its settings here.</span>
        </p>
      )}

      {issues.length > 0 && (
        <div className="materialIssues" role="status">
          <AlertTriangle size={13} aria-hidden="true" />
          <ul>
            {issues.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <PanelSection title={`Textures (${doc.samplers.length})`} defaultOpen>
        <TextureList
          doc={doc}
          textures={textureInfos}
          archivePath={archivePath}
          archiveBytes={archiveBytes}
          onChange={onChange}
          onOpenLayer={onOpenTexture}
        />
      </PanelSection>

      <PanelSection title="Transparency" defaultOpen>
        <TransparencySection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Lighting" defaultOpen>
        <ShadingSection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Colours" defaultOpen>
        <SimpleColorsSection doc={doc} onChange={onChange} />
      </PanelSection>

      <PanelSection title="Surface" defaultOpen>
        <SurfaceSection doc={doc} summary={summary} onChange={onChange} />
      </PanelSection>
    </>
  );
}

function NodeDetails({
  node,
  graph,
  doc,
  textureInfos,
  archivePath,
  archiveBytes,
  onChange,
  onImportTexture,
  onChangeNode,
}: {
  node: EditorGraphNode;
  graph: EditorShaderGraph | null;
  doc: GxMaterialDoc;
  textureInfos: VisualTextureInfo[];
  archivePath: string;
  archiveBytes: Uint8Array | null;
  onChange: MaterialDocChange;
  onImportTexture: (texture: ImportedTexture) => boolean;
  onChangeNode?: (next: EditorGraphNode) => void;
}) {
  const textureIndex = node.type === 'texture' ? node.sampler : null;
  const missingLayer = textureIndex !== null && !doc.samplers[textureIndex];

  return (
    <>
      <div className="detailsNodeHeader">
        <strong>{nodeHeading(node, doc)}</strong>
        <span>{NODE_SUMMARY[node.type]}</span>
      </div>

      {textureIndex !== null && !missingLayer && (
        <TextureLayerDetails
          key={textureIndex}
          index={textureIndex}
          doc={doc}
          textures={textureInfos}
          archivePath={archivePath}
          archiveBytes={archiveBytes}
          onChange={onChange}
          onImportTexture={onImportTexture}
        />
      )}
      {textureIndex !== null && missingLayer && (
        <div className="detailsMissingLayer">
          <p className="detailsNote">
            This node samples texture {textureIndex + 1}, but the material only has {doc.samplers.length}. Add textures until
            there is one in that slot, or point the node at another one below.
          </p>
          <Button
            size="sm"
            icon={<Plus size={13} />}
            disabled={doc.samplers.length >= MAX_SAMPLERS}
            disabledReason={`A GX material can have at most ${MAX_SAMPLERS} textures.`}
            onClick={() => onChange(addLayer(doc, textureInfos[0]?.name ?? ''), { status: `Added texture ${doc.samplers.length + 1}.` })}
          >
            Add texture {doc.samplers.length + 1}
          </Button>
        </div>
      )}

      <NodeMaterialField node={node} doc={doc} onChange={onChange} />

      {graph && onChangeNode && (
        <PanelSection title="Node" defaultOpen>
          <GraphNodeDetails node={node} graph={graph} doc={doc} onChangeNode={onChangeNode} showHeader={false} />
        </PanelSection>
      )}
    </>
  );
}

function MultiSelection({
  nodes,
  doc,
  onSelectNodes,
}: {
  nodes: readonly EditorGraphNode[];
  doc: GxMaterialDoc;
  onSelectNodes?: (nodeIds: string[]) => void;
}) {
  return (
    <div className="detailsMulti">
      <div className="detailsNodeHeader">
        <strong>{nodes.length} nodes selected</strong>
        <span>Pick one to see its settings. Click an empty spot in the graph to see the whole material again.</span>
      </div>
      <ul className="detailsMultiList">
        {nodes.map((node) => (
          <li key={node.id}>
            <button type="button" className="detailsMultiItem" disabled={!onSelectNodes} onClick={() => onSelectNodes?.([node.id])}>
              {nodeHeading(node, doc)}
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
