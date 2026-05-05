import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, ChevronDown, ChevronUp, Database, Download, Eye, FolderOpen, Move3D, PanelRightClose, PanelRightOpen, RotateCcw, Scale3D, TriangleAlert } from 'lucide-react';
import {
  appendKmpArea,
  appendKmpCamera,
  appendKmpCheckpoint,
  appendKmpGobj,
  appendKmpPoint,
  appendKmpPotiPoint,
  appendKmpPotiRoute,
  deleteKmpEntity,
  getKmpCameraHeader,
  moveKmpEntity,
  parseKmp,
  patchKmpAreaField,
  patchKmpBattleFinishField,
  patchKmpCameraField,
  patchKmpCameraHeaderField,
  patchKmpCameraViewPosition,
  patchKmpCannonField,
  patchKmpCheckpointEndpoint,
  patchKmpCheckpointField,
  patchKmpEntityPosition,
  patchKmpEntityRotation,
  patchKmpEntityRouteIndex,
  patchKmpEntityScale,
  patchKmpGobjObjectId,
  patchKmpGobjPresenceFlags,
  patchKmpGobjSetting,
  patchKmpPathGroupLinks,
  patchKmpPointSetting,
  patchKmpPotiPointSetting,
  patchKmpPotiRouteSetting,
  patchKmpRespawnField,
  patchKmpStageField,
  patchKmpStageFlareColor,
  mergeKmpPathGroupWithNext,
  splitKmpPathGroup,
  type AppendableKmpSection,
  type AppendableKmpPointSection,
  type KmpAreaField,
  type KmpBattleFinishField,
  type KmpCameraField,
  type KmpCameraHeaderField,
  type KmpCheckpointField,
  type KmpCannonField,
  type KmpDocument,
  type KmpEntity,
  type KmpRespawnField,
  type KmpStageField,
  type Vec3,
} from '../lib/kmp';
import { raycastDown } from '../lib/kcl';
import { getObjFlowResourceNames, mergeCommonResourceEntries, parseCommonResourceArchive, type CommonResourceArchive, type ObjFlowEntry } from '../lib/objflow';
import { parseNoclipBrresSummary, type NoclipBrresSummary } from '../lib/noclipBrres';
import { describeEntity, exportTrack, loadTrackBytes, loadTrackFile, replaceCourseKmp, validateExportBytes, validateTrack, type TrackDocument } from '../lib/track';
import { Noclip3DViewport, type TransformTool } from './Noclip3DViewport';

const objectCatalog = [
  { id: 0x65, label: 'Item Box', category: 'Items' },
  { id: 0xc9, label: 'Goomba', category: 'Enemies' },
  { id: 0xd2, label: 'Route Object', category: 'Route' },
  { id: 0x17d, label: 'Cannon Target', category: 'Gameplay' },
];

const bundledCourseObjectResourceNames = new Set(['castle_tree1.brres', 'castle_tree2.brres', 'choropu.brres', 'kinoko_lift1.brres', 'kuribo.brres', 'npc_mii_a.brres', 'pakkun_f.brres', 'pendulum.brres']);

interface ReferenceCounts {
  routes: number;
  cameras: number;
  enemyPoints: number;
  checkpoints: number;
  respawns: number;
}

const kmpPointCatalog: Array<{ section: AppendableKmpSection; label: string; category: string }> = [
  { section: 'KTPT', label: 'Start Point', category: 'KMP' },
  { section: 'ENPT', label: 'Enemy Route Node', category: 'Routes' },
  { section: 'ITPT', label: 'Item Route Node', category: 'Routes' },
  { section: 'CKPT', label: 'Checkpoint Pair', category: 'Routes' },
  { section: 'POTI', label: 'Object/Camera Route', category: 'Routes' },
  { section: 'CAME', label: 'Camera', category: 'Camera' },
  { section: 'AREA', label: 'Area Trigger', category: 'Gameplay' },
  { section: 'JGPT', label: 'Respawn Point', category: 'Gameplay' },
  { section: 'CNPT', label: 'Cannon Point', category: 'Gameplay' },
  { section: 'MSPT', label: 'Battle Finish Point', category: 'Battle' },
];

export function App() {
  const smokeTrackUrl = useMemo(() => (typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('smokeTrack')), []);
  const smokeCallbackUrl = useMemo(() => (typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('smokeCallback')), []);
  const smokeMode = smokeTrackUrl !== null;
  const smokeReportRef = useRef<string | null>(null);
  const [track, setTrack] = useState<TrackDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<TransformTool>('translate');
  const [browserOpen, setBrowserOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [collisionVisible, setCollisionVisible] = useState(false);
  const [status, setStatus] = useState('No track loaded');
  const [commonArchive, setCommonArchive] = useState<CommonResourceArchive | null>(null);
  const [commonBrresSummaries, setCommonBrresSummaries] = useState<Record<string, NoclipBrresSummary>>({});
  const objFlow = commonArchive?.objFlow ?? null;
  const selected = useMemo(() => track?.kmp?.entities.find((entity) => entity.id === selectedId) ?? null, [track, selectedId]);
  const selectedPathInfo = useMemo(() => (selected && track?.kmp ? getPathInfo(track.kmp, selected) : null), [track, selected]);
  const cameraHeader = useMemo(() => (track?.kmp ? getKmpCameraHeader(track.kmp) : null), [track]);
  const referenceCounts = useMemo(() => getReferenceCounts(track?.kmp ?? null), [track?.kmp]);
  const validation = useMemo(() => (track ? validateTrack(track, { common: commonArchive }) : []), [track, commonArchive]);
  const realObjectCatalog = useMemo(() => {
    if (!objFlow) return [];
    return objFlow.entries
      .filter((entry) => entry.name || entry.resources)
      .sort((a, b) => countAvailableResources(b, commonArchive) - countAvailableResources(a, commonArchive))
      .slice(0, 180);
  }, [objFlow, commonArchive]);

  useEffect(() => {
    let cancelled = false;
    async function loadBundledCommon() {
      try {
        const response = await fetch('/data/MarioKartWii/Race/Common.szs');
        if (!response.ok) return;
        const common = await withBundledCourseObjectResources(parseCommonResourceArchive(new Uint8Array(await response.arrayBuffer())));
        if (!cancelled) {
          setCommonArchive((current) => current ?? common);
          setStatus((current) => (current === 'No track loaded' ? `Loaded bundled Common.szs: ${common.objFlow.entries.length} ObjFlow objects` : current));
        }
      } catch {
        // Manual Common.szs loading remains available if the bundled file is absent.
      }
    }
    void loadBundledCommon();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!smokeTrackUrl) return;
    let cancelled = false;
    async function loadSmokeTrack() {
      try {
        setStatus('Loading browser smoke track...');
        const response = await fetch(smokeTrackUrl);
        if (!response.ok) throw new Error(`Smoke track fetch failed: HTTP ${response.status}`);
        const pathName = new URL(smokeTrackUrl, window.location.href).pathname;
        const fileName = decodeURIComponent(pathName.split('/').pop() || 'smoke.szs');
        const loaded = await loadTrackBytes(new Uint8Array(await response.arrayBuffer()), fileName, { brresSummaryLimit: 4 });
        if (cancelled) return;
        setTrack(loaded);
        setSelectedId(null);
        setStatus(`Loaded ${fileName}: ${loaded.archiveEntries.length} archive entries, ${loaded.kmp?.entities.length ?? 0} editable KMP records`);
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
      }
    }
    void loadSmokeTrack();
    return () => {
      cancelled = true;
    };
  }, [smokeTrackUrl]);

  useEffect(() => {
    if (!commonArchive) {
      setCommonBrresSummaries({});
      return;
    }
    let cancelled = false;
    async function parseCommonSummaries() {
      const referencedResources = new Set(commonArchive.objFlow.entries.flatMap((entry) => getObjFlowResourceNames(entry).map((name) => name.toLowerCase())));
      const brresEntries = commonArchive.resourceEntries
        .filter((entry) => entry.type === 'file' && entry.data && entry.path.toLowerCase().endsWith('.brres'))
        .sort((a, b) => scoreCommonPreviewResource(b, referencedResources) - scoreCommonPreviewResource(a, referencedResources))
        .slice(0, smokeMode ? 12 : 96);
      const summaries: Record<string, NoclipBrresSummary> = {};
      for (const entry of brresEntries) {
        if (cancelled || !entry.data) return;
        try {
          const key = entry.path.split('/').pop()?.toLowerCase() ?? entry.path.toLowerCase();
          summaries[key] = await parseNoclipBrresSummary(entry.data);
          if (!cancelled) setCommonBrresSummaries({ ...summaries });
        } catch {
          // Some object resources are special-purpose BRRES files; keep the browser usable if one fails.
        }
      }
      if (!cancelled) setCommonBrresSummaries(summaries);
    }
    void parseCommonSummaries();
    return () => {
      cancelled = true;
    };
  }, [commonArchive, smokeMode]);

  useEffect(() => {
    if (!smokeCallbackUrl || typeof document === 'undefined') return;
    let cancelled = false;
    const sendReport = () => {
      const rendererStatus = document.querySelector('.rendererStatus')?.textContent?.trim() ?? '';
      const report = {
        status,
        rendererStatus,
        loaded: track !== null,
        rendered: rendererStatus.includes('rendered with noclip Mario Kart Wii renderer'),
        hasViewportCanvas: document.querySelector('canvas.noclipCanvas') !== null,
        hasLegacyPointHandles: document.querySelector('.kmp3dHandle') !== null,
        hasNonblankViewportProbe: document.querySelector('[data-viewport-sample="nonblank"]') !== null,
        hasSmokeSelectedGobjRendered: document.querySelector('[data-smoke-selected-gobj-rendered="yes"]') !== null,
        hasSmokeSelectedGobjSnapped: document.querySelector('[data-smoke-selected-gobj-snapped="yes"]') !== null,
        hasAvailableObjectResource: document.querySelector('.thumbnail.objectPreview[data-state="available"]') !== null,
        hasObjectThumbnailImage:
          document.querySelector('.thumbnail.objectPreview[data-state="available"][data-preview="image"] img[src^="data:image/png;base64,"]') !== null,
        hasInspectorToggle: document.querySelector('[aria-label="Hide inspector"], [aria-label="Show inspector"]') !== null,
        hasContentBrowserToggle: document.querySelector('[aria-label="Collapse content browser"], [aria-label="Expand content browser"]') !== null,
      };
      const ready =
        report.loaded &&
        report.rendered &&
        report.hasViewportCanvas &&
        !report.hasLegacyPointHandles &&
        report.hasNonblankViewportProbe &&
        report.hasSmokeSelectedGobjRendered &&
        report.hasSmokeSelectedGobjSnapped &&
        report.hasAvailableObjectResource &&
        report.hasObjectThumbnailImage &&
        report.hasInspectorToggle &&
        report.hasContentBrowserToggle;
      const payload = JSON.stringify({ ...report, ready });
      if (payload === smokeReportRef.current) return;
      smokeReportRef.current = payload;
      const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
      if (!navigator.sendBeacon?.(smokeCallbackUrl, blob)) {
        void fetch(smokeCallbackUrl, { method: 'POST', mode: 'no-cors', body: blob });
      }
    };
    sendReport();
    const interval = window.setInterval(() => {
      if (cancelled) return;
      sendReport();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [smokeCallbackUrl, status, track, commonBrresSummaries]);

  async function openFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      setStatus(`Loading ${file.name}...`);
      const loaded = await loadTrackFile(file);
      setTrack(loaded);
      setSelectedId(null);
      setStatus(`Loaded ${file.name}: ${loaded.archiveEntries.length} archive entries, ${loaded.kmp?.entities.length ?? 0} editable KMP records`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function moveEntity(entity: KmpEntity, position: Vec3) {
    if (!track?.kmp) return;
    const nextKmp = patchKmpEntityPosition(track.kmp, entity, position);
    setTrack(replaceCourseKmp(track, nextKmp));
  }

  function moveCheckpointEndpoint(entity: KmpEntity, side: 'left' | 'right', position: Vec3) {
    if (!track?.kmp) return;
    const nextKmp = patchKmpCheckpointEndpoint(track.kmp, entity, side, position);
    setTrack(replaceCourseKmp(track, nextKmp));
  }

  function rotateEntity(entity: KmpEntity, rotation: Vec3) {
    if (!track?.kmp || !entity.rotation) return;
    setTrack(replaceCourseKmp(track, patchKmpEntityRotation(track.kmp, entity, rotation)));
  }

  function scaleEntity(entity: KmpEntity, scale: Vec3) {
    if (!track?.kmp || !entity.scale) return;
    setTrack(replaceCourseKmp(track, patchKmpEntityScale(track.kmp, entity, scale)));
  }

  function patchSelectedEntity(patch: (kmp: KmpDocument, entity: KmpEntity) => Uint8Array) {
    if (!track?.kmp || !selected) return;
    setTrack(replaceCourseKmp(track, patch(track.kmp, selected)));
  }

  function addObject(objectId: number, position: Vec3) {
    if (!track?.kmp) return;
    try {
      const nextKmp = appendKmpGobj(track.kmp, objectId, position);
      const nextTrack = replaceCourseKmp(track, nextKmp);
      setTrack(nextTrack);
      setSelectedId(`GOBJ-${(nextTrack.kmp?.sections.find((section) => section.name === 'GOBJ')?.count ?? 1) - 1}`);
      setStatus(`Added object ${objectId.toString(16).toUpperCase()} at ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function addKmpPoint(section: AppendableKmpSection, position: Vec3) {
    if (!track?.kmp) return;
    try {
      const nextKmp =
        section === 'CKPT'
          ? appendKmpCheckpoint(track.kmp, position)
          : section === 'POTI'
            ? appendKmpPotiRoute(track.kmp, position)
            : section === 'AREA'
              ? appendKmpArea(track.kmp, position)
              : section === 'CAME'
                ? appendKmpCamera(track.kmp, position)
            : appendKmpPoint(track.kmp, section as AppendableKmpPointSection, position);
      const nextTrack = replaceCourseKmp(track, nextKmp);
      setTrack(nextTrack);
      const nextCount = section === 'POTI' ? (nextTrack.kmp?.routes.length ?? 1) : (nextTrack.kmp?.sections.find((candidate) => candidate.name === section)?.count ?? 1);
      const newIndex = nextCount - 1;
      setSelectedId(section === 'POTI' ? `POTI-${newIndex}-0` : `${section}-${newIndex}`);
      setStatus(`Added ${section} at ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function addPotiNode(entity: KmpEntity) {
    if (!track?.kmp || !entity.routePoint) return;
    try {
      const position = { x: entity.position.x + 300, y: entity.position.y, z: entity.position.z };
      const nextKmp = appendKmpPotiPoint(track.kmp, entity.routePoint.routeIndex, entity.routePoint.pointIndex, position);
      const nextTrack = replaceCourseKmp(track, nextKmp);
      setTrack(nextTrack);
      setSelectedId(`POTI-${entity.routePoint.routeIndex}-${entity.routePoint.pointIndex + 1}`);
      setStatus(`Added node to POTI route ${entity.routePoint.routeIndex}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function deleteSelectedEntity() {
    if (!track?.kmp || !selected) return;
    if (!window.confirm(`Delete ${describeEntity(selected)}?`)) return;
    try {
      const label = describeEntity(selected);
      setTrack(replaceCourseKmp(track, deleteKmpEntity(track.kmp, selected)));
      setSelectedId(null);
      setStatus(`Deleted ${label}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function moveSelectedEntity(direction: -1 | 1) {
    if (!track?.kmp || !selected) return;
    try {
      const nextTrack = replaceCourseKmp(track, moveKmpEntity(track.kmp, selected, direction));
      const nextIndex = selected.routePoint ? selected.routePoint.pointIndex + direction : selected.index + direction;
      const nextId = selected.routePoint ? `POTI-${selected.routePoint.routeIndex}-${nextIndex}` : `${selected.section}-${nextIndex}`;
      setTrack(nextTrack);
      setSelectedId(nextTrack.kmp?.entities.some((entity) => entity.id === nextId) ? nextId : selected.id);
      setStatus(`Moved ${describeEntity(selected)} ${direction < 0 ? 'earlier' : 'later'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function splitSelectedPathGroup() {
    if (!track?.kmp || !selected || !selectedPathInfo) return;
    try {
      setTrack(replaceCourseKmp(track, splitKmpPathGroup(track.kmp, selected.section as 'ENPT' | 'ITPT' | 'CKPT', selectedPathInfo.groupIndex, selectedPathInfo.localIndex)));
      setSelectedId(selected.id);
      setStatus(`Split ${selectedPathInfo.groupSection} group ${selectedPathInfo.groupIndex}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function mergeSelectedPathGroup() {
    if (!track?.kmp || !selected || !selectedPathInfo) return;
    try {
      setTrack(replaceCourseKmp(track, mergeKmpPathGroupWithNext(track.kmp, selected.section as 'ENPT' | 'ITPT' | 'CKPT', selectedPathInfo.groupIndex)));
      setSelectedId(selected.id);
      setStatus(`Merged ${selectedPathInfo.groupSection} group ${selectedPathInfo.groupIndex}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function snapSelectedToCollision() {
    if (!track?.kmp || !track.kcl || !selected) return;
    if (selected.checkpoint) {
      const left = raycastDown(track.kcl, selected.checkpoint.left.x, selected.checkpoint.left.z);
      const right = raycastDown(track.kcl, selected.checkpoint.right.x, selected.checkpoint.right.z);
      if (!left && !right) {
        setStatus('No collision surface found below checkpoint endpoints.');
        return;
      }
      let nextBytes = track.kmp.original;
      if (left) nextBytes = patchKmpCheckpointEndpoint(track.kmp, selected, 'left', left);
      if (right) {
        const nextDoc = parseKmp(nextBytes);
        const nextEntity = nextDoc.entities.find((entity) => entity.id === selected.id) ?? selected;
        nextBytes = patchKmpCheckpointEndpoint(nextDoc, nextEntity, 'right', right);
      }
      setTrack(replaceCourseKmp(track, nextBytes));
      setStatus('Snapped checkpoint endpoints to KCL collision.');
      return;
    }

    const hit = raycastDown(track.kcl, selected.position.x, selected.position.z);
    if (!hit) {
      setStatus(`No collision surface found below ${describeEntity(selected)}.`);
      return;
    }
    setTrack(replaceCourseKmp(track, patchKmpEntityPosition(track.kmp, selected, hit)));
    setStatus(`Snapped ${describeEntity(selected)} to KCL collision.`);
  }

  async function openCommon(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      const common = await withBundledCourseObjectResources(parseCommonResourceArchive(new Uint8Array(await file.arrayBuffer())));
      setCommonArchive(common);
      setStatus(`Loaded ${file.name}: ${common.objFlow.entries.length} ObjFlow object definitions, ${common.resourceEntries.length} resource files`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function entityLabel(entity: KmpEntity): string {
    if (entity.section !== 'GOBJ' || entity.objectId === undefined) return describeEntity(entity);
    const flow = objFlow?.byId.get(entity.objectId);
    return flow ? `${flow.name || flow.resources} #${entity.index} (${entity.objectId.toString(16).toUpperCase()})` : describeEntity(entity);
  }

  function downloadExport() {
    if (!track) return;
    const issues = validateTrack(track, { common: commonArchive });
    if (issues.length > 0) {
      const errors = issues.filter((issue) => issue.level === 'error').length;
      const warnings = issues.length - errors;
      const summary = issues.slice(0, 8).map((issue) => `${issue.level.toUpperCase()}: ${issue.message}`).join('\n');
      const suffix = issues.length > 8 ? `\n...and ${issues.length - 8} more.` : '';
      const proceed = window.confirm(`Export with ${errors} errors and ${warnings} warnings?\n\n${summary}${suffix}`);
      if (!proceed) {
        setStatus('Export cancelled after validation review.');
        return;
      }
      setStatus(`Exporting with ${errors} validation errors and ${warnings} warnings.`);
    }
    const bytes = exportTrack(track, { common: commonArchive });
    const exportIssues = validateExportBytes(track, bytes, { common: commonArchive });
    if (exportIssues.length > 0) {
      const errors = exportIssues.filter((issue) => issue.level === 'error').length;
      const warnings = exportIssues.length - errors;
      const summary = exportIssues.slice(0, 8).map((issue) => `${issue.level.toUpperCase()}: ${issue.message}`).join('\n');
      const suffix = exportIssues.length > 8 ? `\n...and ${exportIssues.length - 8} more.` : '';
      const proceed = errors === 0 && window.confirm(`Export self-check found ${warnings} warnings.\n\n${summary}${suffix}`);
      if (!proceed) {
        setStatus(errors ? `Export blocked: ${errors} exported archive errors.` : 'Export cancelled after archive self-check.');
        return;
      }
    }
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = track.fileName.replace(/\.szs$/i, '') + '.edited.szs';
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${link.download} (${bytes.length.toLocaleString()} bytes).`);
  }

  return (
    <main
      className="appShell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void openFiles(event.dataTransfer.files);
      }}
    >
      <header className="topBar">
        <div className="brand">
          <Box size={18} />
          <strong>MKW Track Editor</strong>
        </div>
        <label className="button">
          <FolderOpen size={16} />
          Open .szs
          <input hidden type="file" accept=".szs" onChange={(event) => void openFiles(event.currentTarget.files)} />
        </label>
        <label className="button">
          <Database size={16} />
          Common
          <input hidden type="file" accept=".szs,.bin" onChange={(event) => void openCommon(event.currentTarget.files)} />
        </label>
        <div className="segmented">
          <button className={tool === 'translate' ? 'active' : ''} onClick={() => setTool('translate')} title="Translate">
            <Move3D size={16} />
          </button>
          <button className={tool === 'rotate' ? 'active' : ''} onClick={() => setTool('rotate')} title="Rotate">
            <RotateCcw size={16} />
          </button>
          <button className={tool === 'scale' ? 'active' : ''} onClick={() => setTool('scale')} title="Scale">
            <Scale3D size={16} />
          </button>
        </div>
        <button className={collisionVisible ? 'button active' : 'button'} onClick={() => setCollisionVisible((value) => !value)}>
          <Eye size={16} />
          KCL
        </button>
        <button
          className={inspectorOpen ? 'button active' : 'button'}
          onClick={() => setInspectorOpen((value) => !value)}
          title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
          aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
        >
          {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          Inspector
        </button>
        <button className="button primary" disabled={!track} onClick={downloadExport}>
          <Download size={16} />
          Export
        </button>
        <span className="status">{status}</span>
      </header>

      <div className={inspectorOpen ? 'workspace' : 'workspace inspectorCollapsed'}>
        <Noclip3DViewport
          track={track}
          selectedId={selectedId}
          tool={tool}
          collisionVisible={collisionVisible}
          getEntityLabel={entityLabel}
          onSelect={setSelectedId}
          onMoveEntity={moveEntity}
          onRotateEntity={rotateEntity}
          onScaleEntity={scaleEntity}
          onMoveCheckpointEndpoint={moveCheckpointEndpoint}
          onAddObject={addObject}
          onAddKmpPoint={addKmpPoint}
        />
        <aside className="inspector">
          <div className="panelHeader">
            <h2>Inspector</h2>
            <button className="iconButton" type="button" onClick={() => setInspectorOpen(false)} title="Hide inspector" aria-label="Hide inspector">
              <PanelRightClose size={16} />
            </button>
          </div>
          {selected ? (
            <Inspector
              entity={selected}
              label={entityLabel(selected)}
              pathInfo={selectedPathInfo}
              cameraHeader={cameraHeader}
              referenceCounts={referenceCounts}
              onChangePosition={(position) => patchSelectedEntity((kmp, entity) => patchKmpEntityPosition(kmp, entity, position))}
              onDelete={selected.section === 'STGI' ? undefined : deleteSelectedEntity}
              onMoveEarlier={selected.section === 'STGI' ? undefined : () => moveSelectedEntity(-1)}
              onMoveLater={selected.section === 'STGI' ? undefined : () => moveSelectedEntity(1)}
              onSnapToCollision={track.kcl ? snapSelectedToCollision : undefined}
              onChangeCheckpointEndpoint={(side, position) => patchSelectedEntity((kmp, entity) => patchKmpCheckpointEndpoint(kmp, entity, side, position))}
              onChangeCheckpointField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpCheckpointField(kmp, entity, field, value))}
              onChangePathGroupLinks={(side, links) => {
                if (!track.kmp || !selectedPathInfo) return;
                setTrack(replaceCourseKmp(track, patchKmpPathGroupLinks(track.kmp, selectedPathInfo.groupSection, selectedPathInfo.groupIndex, side, links)));
              }}
              onSplitPathGroup={selectedPathInfo && selectedPathInfo.localIndex < selectedPathInfo.groupSize - 1 ? splitSelectedPathGroup : undefined}
              onMergePathGroup={selectedPathInfo && selectedPathInfo.nextGroups.length === 1 ? mergeSelectedPathGroup : undefined}
              onChangePointSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpPointSetting(kmp, entity, settingIndex, value))}
              onChangePotiRouteSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpPotiRouteSetting(kmp, entity, settingIndex, value))}
              onChangePotiPointSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpPotiPointSetting(kmp, entity, settingIndex, value))}
              onAddPotiNode={() => addPotiNode(selected)}
              onChangeAreaField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpAreaField(kmp, entity, field, value))}
              onChangeCameraField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpCameraField(kmp, entity, field, value))}
              onChangeCameraHeaderField={(field, value) => {
                if (!track.kmp) return;
                setTrack(replaceCourseKmp(track, patchKmpCameraHeaderField(track.kmp, field, value)));
              }}
              onChangeCameraViewPosition={(side, position) => patchSelectedEntity((kmp, entity) => patchKmpCameraViewPosition(kmp, entity, side, position))}
              onChangeRespawnField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpRespawnField(kmp, entity, field, value))}
              onChangeCannonField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpCannonField(kmp, entity, field, value))}
              onChangeBattleFinishField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpBattleFinishField(kmp, entity, field, value))}
              onChangeStageField={(field, value) => patchSelectedEntity((kmp, entity) => patchKmpStageField(kmp, entity, field, value))}
              onChangeStageFlareColor={(channelIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpStageFlareColor(kmp, entity, channelIndex, value))}
              onChangeRotation={(rotation) => patchSelectedEntity((kmp, entity) => patchKmpEntityRotation(kmp, entity, rotation))}
              onChangeScale={(scale) => patchSelectedEntity((kmp, entity) => patchKmpEntityScale(kmp, entity, scale))}
              onChangeObjectId={(objectId) => patchSelectedEntity((kmp, entity) => patchKmpGobjObjectId(kmp, entity, objectId))}
              onChangeRouteIndex={(routeIndex) => patchSelectedEntity((kmp, entity) => patchKmpEntityRouteIndex(kmp, entity, routeIndex))}
              onChangeObjectSetting={(settingIndex, value) => patchSelectedEntity((kmp, entity) => patchKmpGobjSetting(kmp, entity, settingIndex, value))}
              onChangePresenceFlags={(value) => patchSelectedEntity((kmp, entity) => patchKmpGobjPresenceFlags(kmp, entity, value))}
            />
          ) : (
            <p className="muted">Select an object, route node, checkpoint, start point, camera, cannon point, or respawn point in the viewport.</p>
          )}
          {track?.kmp && <KmpOverview kmp={track.kmp} onSelect={setSelectedId} />}
          <h2>Validation</h2>
          <div className="validationList">
            {validation.length === 0 && <p className="muted">No validation issues for the loaded data.</p>}
            {validation.map((item, index) => (
              <div className={item.level} key={`${item.message}-${index}`}>
                <TriangleAlert size={14} />
                {item.message}
              </div>
            ))}
            {track?.warnings.map((warning, index) => (
              <div className="warning" key={`${warning}-${index}`}>
                <TriangleAlert size={14} />
                {warning}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <section className={browserOpen ? 'contentBrowser' : 'contentBrowser collapsed'}>
        <button className="collapseButton" onClick={() => setBrowserOpen((value) => !value)} aria-label={browserOpen ? 'Collapse content browser' : 'Expand content browser'}>
          {browserOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
        <div className="browserHeader">
          <strong>Content Browser</strong>
          <span>{track ? `${track.brresFiles.length} BRRES resources${objFlow ? ` · ${objFlow.entries.length} ObjFlow objects` : ''}` : 'Load a track to list archive assets'}</span>
        </div>
        <div className="assetStrip">
          {kmpPointCatalog.map((item) => (
            <div className="assetTile" key={item.section} draggable onDragStart={(event) => event.dataTransfer.setData('application/mkw-point-section', item.section)}>
              <div className="thumbnail kmp">{item.section}</div>
              <strong>{item.label}</strong>
              <span>{item.category}</span>
            </div>
          ))}
          {(realObjectCatalog.length ? realObjectCatalog : objectCatalog).map((object) => (
            <div className="assetTile" key={catalogId(object)} draggable onDragStart={(event) => event.dataTransfer.setData('application/mkw-object-id', String(catalogId(object)))}>
              <ObjectThumbnail object={object} common={commonArchive} summaries={commonBrresSummaries} />
              <strong>{'label' in object ? object.label : object.name || object.resources}</strong>
              <span>{objectAssetLabel(object, commonArchive, commonBrresSummaries)}</span>
            </div>
          ))}
          {track?.brresFiles.slice(0, 24).map((path) => (
            <div className="assetTile" key={path}>
              <div className="thumbnail brres">BRRES</div>
              <strong>{path.split('/').pop()}</strong>
              <span>{describeBrres(track.brresSummaries[path]) || path}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

async function withBundledCourseObjectResources(common: CommonResourceArchive): Promise<CommonResourceArchive> {
  try {
    const basePath = '/data/MarioKartWii/Race/Course/Object/';
    const manifestResponse = await fetch(`${basePath}manifest.json`);
    if (!manifestResponse.ok) return common;
    const names = (await manifestResponse.json()) as string[];
    const entries = await Promise.all(
      names.map(async (name) => {
        const response = await fetch(`${basePath}${name}`);
        if (!response.ok) return null;
        return { path: `Object/${name}`, type: 'file' as const, data: new Uint8Array(await response.arrayBuffer()) };
      }),
    );
    return mergeCommonResourceEntries(common, entries.filter((entry): entry is NonNullable<(typeof entries)[number]> => entry !== null));
  } catch {
    return common;
  }
}

function scoreCommonPreviewResource(entry: { path: string }, referencedResources: Set<string>): number {
  const baseName = entry.path.split('/').pop()?.toLowerCase() ?? '';
  return (bundledCourseObjectResourceNames.has(baseName) ? 4 : 0) + (entry.path.toLowerCase().includes('/course/object/') || entry.path.toLowerCase().startsWith('object/') ? 2 : 0) + (referencedResources.has(baseName) ? 1 : 0);
}

function Inspector({
  entity,
  label,
  pathInfo,
  cameraHeader,
  referenceCounts,
  onChangePosition,
  onDelete,
  onMoveEarlier,
  onMoveLater,
  onSnapToCollision,
  onChangeCheckpointEndpoint,
  onChangeCheckpointField,
  onChangePathGroupLinks,
  onSplitPathGroup,
  onMergePathGroup,
  onChangePointSetting,
  onChangePotiRouteSetting,
  onChangePotiPointSetting,
  onAddPotiNode,
  onChangeAreaField,
  onChangeCameraField,
  onChangeCameraHeaderField,
  onChangeCameraViewPosition,
  onChangeRespawnField,
  onChangeCannonField,
  onChangeBattleFinishField,
  onChangeStageField,
  onChangeStageFlareColor,
  onChangeRotation,
  onChangeScale,
  onChangeObjectId,
  onChangeRouteIndex,
  onChangeObjectSetting,
  onChangePresenceFlags,
}: {
  entity: KmpEntity;
  label: string;
  pathInfo: PathInfo | null;
  cameraHeader: ReturnType<typeof getKmpCameraHeader> | null;
  referenceCounts: ReferenceCounts;
  onChangePosition: (position: Vec3) => void;
  onDelete?: () => void;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  onSnapToCollision?: () => void;
  onChangeCheckpointEndpoint: (side: 'left' | 'right', position: Vec3) => void;
  onChangeCheckpointField: (field: KmpCheckpointField, value: number) => void;
  onChangePathGroupLinks: (side: 'prev' | 'next', links: number[]) => void;
  onSplitPathGroup?: () => void;
  onMergePathGroup?: () => void;
  onChangePointSetting: (settingIndex: number, value: number) => void;
  onChangePotiRouteSetting: (settingIndex: number, value: number) => void;
  onChangePotiPointSetting: (settingIndex: number, value: number) => void;
  onAddPotiNode: () => void;
  onChangeAreaField: (field: KmpAreaField, value: number) => void;
  onChangeCameraField: (field: KmpCameraField, value: number) => void;
  onChangeCameraHeaderField: (field: KmpCameraHeaderField, value: number) => void;
  onChangeCameraViewPosition: (side: 'start' | 'end', position: Vec3) => void;
  onChangeRespawnField: (field: KmpRespawnField, value: number) => void;
  onChangeCannonField: (field: KmpCannonField, value: number) => void;
  onChangeBattleFinishField: (field: KmpBattleFinishField, value: number) => void;
  onChangeStageField: (field: KmpStageField, value: number) => void;
  onChangeStageFlareColor: (channelIndex: number, value: number) => void;
  onChangeRotation: (rotation: Vec3) => void;
  onChangeScale: (scale: Vec3) => void;
  onChangeObjectId: (objectId: number) => void;
  onChangeRouteIndex: (routeIndex: number) => void;
  onChangeObjectSetting: (settingIndex: number, value: number) => void;
  onChangePresenceFlags: (value: number) => void;
}) {
  return (
    <div className="propertyGrid">
      <label>
        Name
        <span>{label}</span>
      </label>
      <label>
        Section
        <span>{entity.section}</span>
      </label>
      {onDelete && (
        <label>
          Delete
          <button className="inlineAction" type="button" onClick={onDelete}>
            Delete selected record
          </button>
        </label>
      )}
      {(onMoveEarlier || onMoveLater) && (
        <label>
          Order
          <div className="actionRow">
            <button className="inlineAction" type="button" onClick={onMoveEarlier} disabled={!onMoveEarlier}>
              Earlier
            </button>
            <button className="inlineAction" type="button" onClick={onMoveLater} disabled={!onMoveLater}>
              Later
            </button>
          </div>
        </label>
      )}
      {entity.section !== 'STGI' && (
        <label>
          Position
          <VectorInputs value={entity.position} onChange={onChangePosition} />
        </label>
      )}
      {entity.section !== 'STGI' && onSnapToCollision && (
        <label>
          KCL Snap
          <button className="inlineAction" type="button" onClick={onSnapToCollision}>
            Snap selected to collision
          </button>
        </label>
      )}
      {entity.checkpoint && (
        <>
          <label>
            Left Endpoint
            <VectorInputs value={entity.checkpoint.left} onChange={(position) => onChangeCheckpointEndpoint('left', position)} />
          </label>
          <label>
            Right Endpoint
            <VectorInputs value={entity.checkpoint.right} onChange={(position) => onChangeCheckpointEndpoint('right', position)} />
          </label>
          <label>
            Checkpoint Data
            <div className="settingInputs">
              <ReferenceSelect label="respawnIndex" value={entity.checkpoint.respawnIndex} noneValue={0xff} count={referenceCounts.respawns} optionLabel="Respawn" onChange={(next) => onChangeCheckpointField('respawnIndex', next)} />
              <input
                aria-label="type"
                title="type"
                type="number"
                min="0"
                max="255"
                value={entity.checkpoint.type}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next)) onChangeCheckpointField('type', Math.max(0, Math.min(0xff, Math.trunc(next))));
                }}
              />
              <ReferenceSelect label="prev" value={entity.checkpoint.prev} noneValue={0xff} count={referenceCounts.checkpoints} optionLabel="Checkpoint" onChange={(next) => onChangeCheckpointField('prev', next)} />
              <ReferenceSelect label="next" value={entity.checkpoint.next} noneValue={0xff} count={referenceCounts.checkpoints} optionLabel="Checkpoint" onChange={(next) => onChangeCheckpointField('next', next)} />
            </div>
          </label>
        </>
      )}
      {entity.pointSettings && (
        <label>
          Point Settings
          <div className="settingInputs">
            {entity.pointSettings.map((setting, index) => (
              <input
                key={index}
                aria-label={`Point setting ${index + 1}`}
                type="number"
                min="0"
                max={entity.section === 'ENPT' && index > 0 ? 255 : 65535}
                value={setting}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  const max = entity.section === 'ENPT' && index > 0 ? 0xff : 0xffff;
                  if (Number.isFinite(value)) onChangePointSetting(index, Math.max(0, Math.min(max, Math.trunc(value))));
                }}
              />
            ))}
          </div>
        </label>
      )}
      {entity.poti && (
        <>
          <label>
            Route Settings
            <div className="settingInputs">
              {[entity.poti.routeSetting1, entity.poti.routeSetting2].map((setting, index) => (
                <input
                  key={index}
                  aria-label={`Route setting ${index + 1}`}
                  type="number"
                  min="0"
                  max="255"
                  value={setting}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangePotiRouteSetting(index, Math.max(0, Math.min(0xff, Math.trunc(value))));
                  }}
                />
              ))}
            </div>
          </label>
          <label>
            Route Node Settings
            <div className="settingInputs">
              {[entity.poti.pointSetting1, entity.poti.pointSetting2].map((setting, index) => (
                <input
                  key={index}
                  aria-label={`Route node setting ${index + 1}`}
                  type="number"
                  min="0"
                  max="65535"
                  value={setting}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) onChangePotiPointSetting(index, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                  }}
                />
              ))}
            </div>
          </label>
        </>
      )}
      {entity.area && (
        <label>
          Area Settings
          <div className="settingInputs">
            {(Object.entries(entity.area) as Array<[KmpAreaField, number]>).map(([field, value]) => {
              const byteField = field === 'shape' || field === 'type' || field === 'cameraIndex' || field === 'priority' || field === 'routeIndex' || field === 'enemyIndex';
              if (field === 'cameraIndex') {
                return <ReferenceSelect key={field} label={field} value={value} noneValue={0xff} count={referenceCounts.cameras} optionLabel="Camera" onChange={(next) => onChangeAreaField(field, next)} />;
              }
              if (field === 'routeIndex') {
                return <ReferenceSelect key={field} label={field} value={value} noneValue={0xff} count={referenceCounts.routes} optionLabel="Route" onChange={(next) => onChangeAreaField(field, next)} />;
              }
              if (field === 'enemyIndex') {
                return <ReferenceSelect key={field} label={field} value={value} noneValue={0xff} count={referenceCounts.enemyPoints} optionLabel="Enemy" onChange={(next) => onChangeAreaField(field, next)} />;
              }
              return (
                <input
                  key={field}
                  aria-label={field}
                  title={field}
                  type="number"
                  min="0"
                  max={byteField ? 255 : 65535}
                  value={value}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChangeAreaField(field, Math.max(0, Math.min(byteField ? 0xff : 0xffff, Math.trunc(next))));
                  }}
                />
              );
            })}
          </div>
        </label>
      )}
      {entity.camera && (
        <>
          {cameraHeader && (
            <label>
              CAME Starts
              <div className="vectorInputs">
                <ReferenceSelect
                  label="Intro start camera"
                  value={cameraHeader.firstIntroCam}
                  noneValue={0xff}
                  count={referenceCounts.cameras}
                  optionLabel="Camera"
                  onChange={(next) => onChangeCameraHeaderField('firstIntroCam', next)}
                />
                <ReferenceSelect
                  label="Selection start camera"
                  value={cameraHeader.firstSelectionCam}
                  noneValue={0xff}
                  count={referenceCounts.cameras}
                  optionLabel="Camera"
                  onChange={(next) => onChangeCameraHeaderField('firstSelectionCam', next)}
                />
                <span>CAME</span>
              </div>
            </label>
          )}
          <label>
            Camera Settings
            <div className="settingInputs">
              {(Object.entries(entity.camera) as Array<[KmpCameraField, number]>).map(([field, value]) => {
                const floatField = field === 'zoomStart' || field === 'zoomEnd' || field === 'time';
                const byteField = field === 'type' || field === 'nextCam' || field === 'shake' || field === 'routeIndex' || field === 'start' || field === 'movie';
                if (field === 'nextCam') {
                  return <ReferenceSelect key={field} label={field} value={value} noneValue={0xff} count={referenceCounts.cameras} optionLabel="Camera" onChange={(next) => onChangeCameraField(field, next)} />;
                }
                if (field === 'routeIndex') {
                  return <ReferenceSelect key={field} label={field} value={value} noneValue={0xff} count={referenceCounts.routes} optionLabel="Route" onChange={(next) => onChangeCameraField(field, next)} />;
                }
                return (
                  <input
                    key={field}
                    aria-label={field}
                    title={field}
                    type="number"
                    min={floatField ? undefined : 0}
                    max={floatField ? undefined : byteField ? 255 : 65535}
                    step={floatField ? 0.1 : 1}
                    value={Number.isFinite(value) ? Number(value.toFixed(floatField ? 3 : 0)) : 0}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      if (floatField) onChangeCameraField(field, next);
                      else onChangeCameraField(field, Math.max(0, Math.min(byteField ? 0xff : 0xffff, Math.trunc(next))));
                    }}
                  />
                );
              })}
            </div>
          </label>
          {entity.cameraView && (
            <>
              <label>
                View Start
                <VectorInputs value={entity.cameraView.start} onChange={(position) => onChangeCameraViewPosition('start', position)} />
              </label>
              <label>
                View End
                <VectorInputs value={entity.cameraView.end} onChange={(position) => onChangeCameraViewPosition('end', position)} />
              </label>
            </>
          )}
        </>
      )}
      {entity.respawn && (
        <label>
          Respawn Settings
          <ShortNumberInputs values={entity.respawn} onChange={onChangeRespawnField} />
        </label>
      )}
      {entity.cannon && (
        <label>
          Cannon Settings
          <ShortNumberInputs values={entity.cannon} onChange={onChangeCannonField} />
        </label>
      )}
      {entity.battleFinish && (
        <label>
          Battle Finish Settings
          <ShortNumberInputs values={entity.battleFinish} onChange={onChangeBattleFinishField} />
        </label>
      )}
      {entity.stage && (
        <>
          <label>
            Track Settings
            <div className="settingInputs">
              {(Object.entries(entity.stage).filter(([field]) => field !== 'flareColor') as Array<[KmpStageField, number]>).map(([field, value]) => {
                const speedField = field === 'speedMod';
                return (
                  <input
                    key={field}
                    aria-label={field}
                    title={field}
                    type="number"
                    min={speedField ? 0 : 0}
                    max={speedField ? undefined : 255}
                    step={speedField ? 0.1 : 1}
                    value={Number.isFinite(value) ? Number(value.toFixed(speedField ? 3 : 0)) : 0}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (!Number.isFinite(next)) return;
                      if (speedField) onChangeStageField(field, next);
                      else onChangeStageField(field, Math.max(0, Math.min(0xff, Math.trunc(next))));
                    }}
                  />
                );
              })}
            </div>
          </label>
          <label>
            Lens Flare RGBA
            <div className="settingInputs">
              {entity.stage.flareColor.map((channel, index) => (
                <input
                  key={index}
                  aria-label={`Lens flare channel ${index + 1}`}
                  title={['red', 'green', 'blue', 'alpha'][index]}
                  type="number"
                  min="0"
                  max="255"
                  value={channel}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChangeStageFlareColor(index, Math.max(0, Math.min(0xff, Math.trunc(next))));
                  }}
                />
              ))}
            </div>
          </label>
        </>
      )}
      {entity.rotation && (
        <label>
          Rotation
          <VectorInputs value={entity.rotation} onChange={onChangeRotation} />
        </label>
      )}
      {entity.scale && (
        <label>
          Scale
          <VectorInputs value={entity.scale} onChange={onChangeScale} step={0.1} />
        </label>
      )}
      {entity.objectId !== undefined && (
        <label>
          Object ID
          <input
            className="routeInput"
            type="number"
            min="0"
            max="65535"
            value={entity.objectId}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) onChangeObjectId(Math.max(0, Math.min(0xffff, Math.trunc(value))));
            }}
          />
        </label>
      )}
      {entity.routeIndex !== undefined && (
        <label>
          Route
          <ReferenceSelect label="Object route" value={entity.routeIndex} noneValue={0xffff} count={referenceCounts.routes} optionLabel="Route" onChange={onChangeRouteIndex} />
        </label>
      )}
      {entity.objectSettings && (
        <label>
          Object Settings
          <div className="settingInputs">
            {entity.objectSettings.map((setting, index) => (
              <input
                key={index}
                aria-label={`Setting ${index + 1}`}
                type="number"
                min="0"
                max="65535"
                value={setting}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value)) onChangeObjectSetting(index, Math.max(0, Math.min(0xffff, Math.trunc(value))));
                }}
              />
            ))}
          </div>
        </label>
      )}
      {entity.presenceFlags !== undefined && (
        <label>
          Presence Flags
          <input
            className="routeInput"
            type="number"
            min="0"
            max="65535"
            value={entity.presenceFlags}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) onChangePresenceFlags(Math.max(0, Math.min(0xffff, Math.trunc(value))));
            }}
          />
        </label>
      )}
      {entity.routePoint && (
        <label>
          Route Node
          <div className="actionRow">
            <span>
              route {entity.routePoint.routeIndex} · node {entity.routePoint.pointIndex}
            </span>
            <button className="inlineAction" type="button" onClick={onAddPotiNode}>
              Add Node
            </button>
          </div>
        </label>
      )}
      {pathInfo && (
        <>
          <label>
            Path Group
            <span>
              {pathInfo.groupSection} #{pathInfo.groupIndex} · point {pathInfo.localIndex + 1}/{pathInfo.groupSize}
            </span>
          </label>
          {(onSplitPathGroup || onMergePathGroup) && (
            <label>
              Group Operations
              <div className="actionRow">
                <button className="inlineAction" type="button" onClick={onSplitPathGroup} disabled={!onSplitPathGroup}>
                  Split
                </button>
                <button className="inlineAction" type="button" onClick={onMergePathGroup} disabled={!onMergePathGroup}>
                  Merge Next
                </button>
              </div>
            </label>
          )}
          <label>
            Group Links
            <div className="vectorInputs">
              <input
                aria-label="Previous groups"
                title="Previous groups"
                value={pathInfo.prevGroups.join(', ')}
                onChange={(event) => onChangePathGroupLinks('prev', parseGroupLinkText(event.currentTarget.value))}
              />
              <input
                aria-label="Next groups"
                title="Next groups"
                value={pathInfo.nextGroups.join(', ')}
                onChange={(event) => onChangePathGroupLinks('next', parseGroupLinkText(event.currentTarget.value))}
              />
              <span>{pathInfo.groupSection}</span>
            </div>
          </label>
        </>
      )}
    </div>
  );
}

function VectorInputs({ value, onChange, step = 1 }: { value: Vec3; onChange: (value: Vec3) => void; step?: number }) {
  return (
    <div className="vectorInputs">
      {(['x', 'y', 'z'] as const).map((axis) => (
        <input
          key={axis}
          aria-label={axis.toUpperCase()}
          type="number"
          step={step}
          value={Number.isFinite(value[axis]) ? Number(value[axis].toFixed(4)) : 0}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange({ ...value, [axis]: next });
          }}
        />
      ))}
    </div>
  );
}

function ShortNumberInputs<T extends Record<string, number>>({ values, onChange }: { values: T; onChange: (field: keyof T, value: number) => void }) {
  return (
    <div className="settingInputs">
      {(Object.entries(values) as Array<[keyof T, number]>).map(([field, value]) => (
        <input
          key={String(field)}
          aria-label={String(field)}
          title={String(field)}
          type="number"
          min="0"
          max="65535"
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(field, Math.max(0, Math.min(0xffff, Math.trunc(next))));
          }}
        />
      ))}
    </div>
  );
}

function ByteNumberInputs<T extends Record<string, number>>({ values, onChange }: { values: T; onChange: (field: keyof T, value: number) => void }) {
  return (
    <div className="settingInputs">
      {(Object.entries(values) as Array<[keyof T, number]>).map(([field, value]) => (
        <input
          key={String(field)}
          aria-label={String(field)}
          title={String(field)}
          type="number"
          min="0"
          max="255"
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(field, Math.max(0, Math.min(0xff, Math.trunc(next))));
          }}
        />
      ))}
    </div>
  );
}

function ReferenceSelect({
  label,
  value,
  noneValue,
  count,
  optionLabel,
  onChange,
}: {
  label: string;
  value: number;
  noneValue: number;
  count: number;
  optionLabel: string;
  onChange: (value: number) => void;
}) {
  const normalized = value === noneValue || value >= count ? String(value) : String(value);
  return (
    <select
      className="referenceSelect"
      aria-label={label}
      title={label}
      value={normalized}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    >
      <option value={noneValue}>None</option>
      {value !== noneValue && value >= count && <option value={value}>Missing #{value}</option>}
      {Array.from({ length: count }, (_, index) => (
        <option value={index} key={index}>
          {optionLabel} #{index}
        </option>
      ))}
    </select>
  );
}

function KmpOverview({ kmp, onSelect }: { kmp: KmpDocument; onSelect: (id: string) => void }) {
  const stage = kmp.entities.find((entity) => entity.section === 'STGI');
  return (
    <>
      <h2>KMP Graphs</h2>
      <div className="propertyGrid">
        {stage && (
          <label>
            STGI
            <button className="inlineAction" type="button" onClick={() => onSelect(stage.id)}>
              Track settings
            </button>
          </label>
        )}
        {kmp.pathGraphs.map((graph) => (
          <label key={graph.groupSection}>
            {graph.pointSection}
            <span>
              {graph.groups.length} groups · {graph.edges.length} links
            </span>
          </label>
        ))}
        <label>
          POTI
          <span>
            {kmp.routes.length} routes · {kmp.routes.reduce((sum, route) => sum + route.points.length, 0)} nodes
          </span>
        </label>
      </div>
    </>
  );
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : 'nan';
}

function parseGroupLinkText(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
    .map((part) => Math.max(0, Math.min(255, Math.trunc(part))));
}

function catalogId(object: (typeof objectCatalog)[number] | ObjFlowEntry): number {
  return 'id' in object ? object.id : object.objectId;
}

function ObjectThumbnail({
  object,
  common,
  summaries,
}: {
  object: (typeof objectCatalog)[number] | ObjFlowEntry;
  common: CommonResourceArchive | null;
  summaries: Record<string, NoclipBrresSummary>;
}) {
  const id = catalogId(object);
  const resources = objectResources(object);
  const primaryResource = resources[0] ?? ('resources' in object ? object.resources : object.label);
  const hasModel = resources.some((resource) => common?.byBaseName.has(resource.toLowerCase()));
  const summary = firstResourceSummary(resources, summaries);
  return (
    <div className="thumbnail objectPreview" data-state={hasModel ? 'available' : 'missing'} data-preview={summary?.previewDataUrl ? 'image' : 'fallback'}>
      {summary?.previewDataUrl && <img src={summary.previewDataUrl} alt="" />}
      <span className="previewId">{id.toString(16).toUpperCase()}</span>
      <span className="previewModel">{summary ? `${summary.models.length} MDL0 · ${summary.textures.length} TEX0` : shortAssetName(primaryResource)}</span>
      {!summary?.previewDataUrl && (
        <span className="previewStack" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

function objectAssetLabel(object: (typeof objectCatalog)[number] | ObjFlowEntry, common: CommonResourceArchive | null, summaries: Record<string, NoclipBrresSummary>): string {
  if ('category' in object) return object.category;
  const resources = objectResources(object);
  if (resources.length === 0) return 'ObjFlow';
  const available = resources.filter((resource) => common?.byBaseName.has(resource.toLowerCase())).length;
  const summary = firstResourceSummary(resources, summaries);
  const modelName = summary?.models[0]?.name;
  return `${available}/${resources.length} resources · ${modelName ? `model ${modelName}` : resources.slice(0, 2).map(shortAssetName).join(', ')}`;
}

function countAvailableResources(object: ObjFlowEntry, common: CommonResourceArchive | null): number {
  return getObjFlowResourceNames(object).filter((resource) => common?.byBaseName.has(resource.toLowerCase())).length;
}

function objectResources(object: (typeof objectCatalog)[number] | ObjFlowEntry): string[] {
  return 'resources' in object ? getObjFlowResourceNames(object) : [];
}

function shortAssetName(resource: string): string {
  return resource.replace(/\.[^.]+$/, '').replace(/_/g, ' ').slice(0, 18) || 'model';
}

function firstResourceSummary(resources: string[], summaries: Record<string, NoclipBrresSummary>): NoclipBrresSummary | undefined {
  for (const resource of resources) {
    const summary = summaries[resource.toLowerCase()];
    if (summary) return summary;
  }
  return undefined;
}

function describeBrres(summary: TrackDocument['brresSummaries'][string] | undefined): string {
  if (!summary) return '';
  return `${summary.models.length} models · ${summary.textures.length} textures · ${Object.values(summary.animations).flat().length} animations`;
}

interface PathInfo {
  groupSection: 'ENPH' | 'ITPH' | 'CKPH';
  groupIndex: number;
  groupSize: number;
  localIndex: number;
  prevGroups: number[];
  nextGroups: number[];
}

function getPathInfo(kmp: KmpDocument, entity: KmpEntity): PathInfo | null {
  const graph = kmp.pathGraphs.find((candidate) => candidate.pointSection === entity.section);
  if (!graph) return null;
  const group = graph.groups.find((candidate) => entity.index >= candidate.startIndex && entity.index < candidate.startIndex + candidate.pointCount);
  if (!group) return null;
  return {
    groupSection: graph.groupSection,
    groupIndex: group.index,
    groupSize: group.pointCount,
    localIndex: entity.index - group.startIndex,
    prevGroups: group.prevGroups,
    nextGroups: group.nextGroups,
  };
}

function getReferenceCounts(kmp: KmpDocument | null): ReferenceCounts {
  if (!kmp) return { routes: 0, cameras: 0, enemyPoints: 0, checkpoints: 0, respawns: 0 };
  const sectionCount = (section: string) => kmp.sections.find((candidate) => candidate.name === section)?.count ?? 0;
  return {
    routes: kmp.routes.length || sectionCount('POTI'),
    cameras: sectionCount('CAME'),
    enemyPoints: sectionCount('ENPT'),
    checkpoints: sectionCount('CKPT'),
    respawns: sectionCount('JGPT'),
  };
}
