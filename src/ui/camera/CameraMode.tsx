import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KmpEntity, Vec3 } from '../../lib/kmp';
import { replaceCourseKmp, validateTrack, type TrackIssue } from '../../lib/track';
import type { EditorModeContext, ModeUi } from '../modes/types';
import type { CameraPreviewProgress, CameraPreviewRequest, CameraViewportApi } from '../Noclip3DViewport';
import { CameraInspector } from './CameraInspector';
import { CameraOutliner } from './CameraOutliner';
import { CameraTimeline } from './CameraTimeline';
import {
  NO_CAMERA_LINK,
  addCameraToChain,
  createDefaultCameraValues,
  findCameraEntity,
  getCameraChain,
  listCameraRows,
  type CameraChainKind,
  type CameraRow,
  type CameraValues,
  type IntroCameraShot,
} from './cameraDocument';
import './camera.css';

interface PreviewState {
  cameraIndex: number;
  playing: boolean;
  time: number;
  sequence: boolean;
  /** Bumped to restart the viewport's playback clock at `time`. */
  seek: number;
}

/**
 * Camera (CAME) mode. Owns everything under `src/ui/camera/`.
 *
 * The renderer side (gizmos, view-point handles, preview playback) lives in the viewport; see
 * `docs/viewport-api.md`. This hook supplies the camera outliner, the property inspector and the
 * timeline dock (the pan sequences, playback and scrubbing), and routes every edit through the
 * history stack.
 */
export function useCameraMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'camera';
  const { track, selection, editActions, setStatus, commonArchive, history } = ctx;
  const kmp = track?.kmp ?? null;

  const viewportApiRef = useRef<CameraViewportApi | null>(null);
  const progressRef = useRef<CameraPreviewProgress | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [looping, setLooping] = useState(false);
  const [chainKind, setChainKind] = useState<CameraChainKind>('opening');
  const scrubResumeRef = useRef(false);
  const [introShots, setIntroShots] = useState<IntroCameraShot[]>([
    { points: [], time: 220 }, { points: [], time: 257 }, { points: [], time: 294 },
  ]);
  const [capturingIntro, setCapturingIntro] = useState(false);
  const [introFocalPoints, setIntroFocalPoints] = useState<Vec3[][]>([[], [], []]);
  const [activeIntroShot, setActiveIntroShot] = useState(0);
  const introFocus = introFocalPoints.map((points) => points.length === 2 ? {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
    z: (points[0].z + points[1].z) / 2,
  } : null);

  useEffect(() => {
    setCapturingIntro(false);
    setIntroFocalPoints([[], [], []]);
    setActiveIntroShot(0);
    setIntroShots([{ points: [], time: 220 }, { points: [], time: 257 }, { points: [], time: 294 }]);
  }, [track?.sourceId, track?.fileName]);

  const rows = useMemo(() => listCameraRows(kmp), [kmp]);
  const openingChain = useMemo(() => getCameraChain(kmp, 'opening'), [kmp]);
  const selectionChain = useMemo(() => getCameraChain(kmp, 'selection'), [kmp]);
  const hasOpeningChain = openingChain.order.length > 0 || openingChain.first !== NO_CAMERA_LINK;
  const hasSelectionChain = selectionChain.order.length > 0 || selectionChain.first !== NO_CAMERA_LINK;
  // The switch only exists when both sequences do; otherwise show whichever one there is.
  const activeKind: CameraChainKind = hasOpeningChain && hasSelectionChain ? chainKind : hasSelectionChain ? 'selection' : 'opening';
  const activeChain = activeKind === 'opening' ? openingChain : selectionChain;
  const otherChain = activeKind === 'opening' ? selectionChain : openingChain;
  const routePointCounts = useMemo(() => (kmp?.routes ?? []).map((route) => route.points.length), [kmp]);
  const validation = useMemo(() => (active && track ? validateTrack(track, { common: commonArchive }) : []), [active, track, commonArchive]);

  const selectedRow = useMemo(() => rows.find((row) => row.id === selection.selectedId) ?? null, [rows, selection.selectedId]);
  const selectedEntity = useMemo<KmpEntity | null>(
    () => (selectedRow ? findCameraEntity(kmp, selectedRow.index) : null),
    [kmp, selectedRow],
  );

  const describeCamera = useCallback(
    (index: number) => {
      const row = rows.find((candidate) => candidate.index === index);
      return row ? `camera ${index} — ${row.typeInfo.label}` : `camera ${index}`;
    },
    [rows],
  );

  // Stop the preview when the mode is left, so the free camera always comes back.
  useEffect(() => {
    if (!active && preview) setPreview(null);
  }, [active, preview]);

  // Escape stops playback.
  useEffect(() => {
    if (!active || !preview) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPreview(null);
      setStatus('Stopped the camera preview.');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, preview, setStatus]);

  // The viewport walks the chain once when a sequence preview starts, so an edit to the chain
  // (order or a duration) ends the preview rather than letting it play a stale sequence.
  const chainSignature = `${activeKind}:${activeChain.steps.map((step) => `${step.cameraIndex}/${step.durationFrames}`).join(',')}`;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useEffect(() => {
    if (previewRef.current?.sequence) setPreview(null);
  }, [chainSignature]);

  const previewTotalFrames = useMemo(() => {
    if (!preview) return 0;
    if (preview.sequence) return activeChain.totalFrames;
    const row = rows.find((candidate) => candidate.index === preview.cameraIndex);
    return row ? (row.timeFrames > 0 ? row.timeFrames : row.animatedFrames) : 0;
  }, [activeChain.totalFrames, preview, rows]);

  function startPreview(cameraIndex: number, options: { sequence?: boolean; time?: number } = {}) {
    progressRef.current = null;
    setPreview((current) => ({
      cameraIndex,
      playing: true,
      time: options.time ?? 0,
      sequence: options.sequence ?? false,
      seek: (current?.seek ?? 0) + 1,
    }));
  }

  function selectCamera(row: CameraRow, frameIt = true) {
    selection.selectOnly(row.id);
    if (frameIt) viewportApiRef.current?.frameCamera(row.position, row.viewStart);
  }

  function selectCameraIndex(index: number) {
    const row = rows.find((candidate) => candidate.index === index);
    if (row) selectCamera(row);
  }

  /** Adds a camera at the free camera's pose, looking at whatever is in the middle of the view. */
  function addCameraHere() {
    const pose = viewportApiRef.current?.getFreeCameraPose();
    if (!pose) {
      setStatus('The viewport is not ready yet.');
      return;
    }
    const viewStart = viewportApiRef.current?.pickCenterPoint() ?? pose.target;
    editActions.addCameraFromPose({ position: pose.position, rotation: pose.rotation, viewStart, viewEnd: viewStart });
  }

  function updateSelectedCamera(values: Partial<CameraValues>, statusMessage?: string) {
    if (!selectedRow) return;
    editActions.updateCamera(selectedRow.id, values, statusMessage);
  }

  function lookFromSelectedCamera() {
    if (!selectedRow) return;
    if (viewportApiRef.current?.lookFrom(selectedRow.position, selectedRow.viewStart)) {
      setStatus(`Moved the viewport to ${describeCamera(selectedRow.index)}.`);
    }
  }

  function setSelectedCameraFromViewport() {
    if (!selectedRow) return;
    const pose = viewportApiRef.current?.getFreeCameraPose();
    if (!pose) return;
    updateSelectedCamera({ position: pose.position, rotation: pose.rotation }, `Moved ${describeCamera(selectedRow.index)} to the viewport camera.`);
  }

  function setSelectedViewPointFromViewport(which: 'start' | 'end') {
    if (!selectedRow) return;
    const point: Vec3 | null = viewportApiRef.current?.pickCenterPoint() ?? null;
    if (!point) {
      setStatus('Nothing is under the middle of the viewport.');
      return;
    }
    updateSelectedCamera(
      which === 'start' ? { viewStart: point } : { viewEnd: point },
      `Set the ${which === 'start' ? 'start' : 'end'} look-at point of ${describeCamera(selectedRow.index)}.`,
    );
  }

  /** Play / pause from wherever the playhead is; with nothing playing, starts the sequence. */
  function togglePlay() {
    if (preview?.playing) {
      setPreview((current) => (current ? { ...current, playing: false, time: progressRef.current?.frames ?? current.time } : current));
    } else if (preview) {
      setPreview((current) => (current ? { ...current, playing: true, seek: current.seek + 1 } : current));
    } else if (activeChain.order.length > 0) {
      startPreview(activeChain.order[0], { sequence: true });
    } else if (selectedRow) {
      startPreview(selectedRow.index);
    }
  }

  /**
   * Plays the sequence from `frames`. The viewport starts every new preview at 0, so the preview
   * opens paused at the wanted time and a moment later is told to play from there.
   */
  function playSequenceFrom(frames: number) {
    const first = activeChain.order[0];
    if (first === undefined) return;
    if (frames <= 0) {
      startPreview(first, { sequence: true });
      return;
    }
    progressRef.current = null;
    const time = Math.min(frames, activeChain.totalFrames - 0.5);
    setPreview((current) => ({ cameraIndex: first, playing: false, time, sequence: true, seek: (current?.seek ?? 0) + 1 }));
    // The viewport reports progress once it has shown the paused frame; only then is a seek honoured.
    const waitingSince = performance.now();
    const resume = () => {
      if (progressRef.current === null && performance.now() - waitingSince < 1500) {
        window.setTimeout(resume, 30);
        return;
      }
      setPreview((current) => (current && !current.playing && current.sequence && current.time === time ? { ...current, playing: true, seek: current.seek + 1 } : current));
    };
    window.setTimeout(resume, 30);
  }

  /** Scrubbing pauses playback, shows the sequence at the playhead, and resumes on release. */
  function beginScrub() {
    scrubResumeRef.current = preview?.playing ?? false;
    if (preview?.playing) {
      setPreview((current) => (current ? { ...current, playing: false, time: progressRef.current?.frames ?? current.time } : current));
    }
  }

  function scrubTo(frames: number) {
    const first = activeChain.order[0];
    if (first === undefined) return;
    // Right at the end the sequence has finished, which the viewport treats as "stop".
    const time = Math.max(0, Math.min(frames, activeChain.totalFrames - 0.5));
    setPreview((current) => ({ cameraIndex: first, playing: false, time, sequence: true, seek: (current?.seek ?? 0) + 1 }));
  }

  function endScrub() {
    if (!scrubResumeRef.current) return;
    scrubResumeRef.current = false;
    setPreview((current) => (current ? { ...current, playing: true, seek: current.seek + 1 } : current));
  }

  function changeChainOrder(order: number[], message: string) {
    editActions.setCameraChainOrder(activeKind, order);
    setStatus(message);
  }

  function setShotDuration(cameraIndex: number, frames: number) {
    editActions.updateCamera(`CAME-${cameraIndex}`, { time: frames }, `Camera ${cameraIndex} now lasts ${(frames / 60).toFixed(1)} s.`);
  }

  /** Adds a camera where the free camera is and plays it last in the shown sequence: one undo step. */
  function addShot() {
    if (!track?.kmp) return;
    const pose = viewportApiRef.current?.getFreeCameraPose();
    if (!pose) {
      setStatus('The viewport is not ready yet.');
      return;
    }
    const viewStart = viewportApiRef.current?.pickCenterPoint() ?? pose.target;
    try {
      const values = createDefaultCameraValues({ position: pose.position, rotation: pose.rotation, viewStart, viewEnd: viewStart });
      const result = addCameraToChain(track.kmp, activeKind, values);
      if (!result.selectedId) return;
      history.applyEditorChange(replaceCourseKmp(track, result.bytes), result.selectedId, true, [result.selectedId]);
      setStatus(`Added ${result.selectedId.replace('CAME-', 'camera ')} to the end of the ${activeKind === 'opening' ? 'opening pan' : 'selection screen pan'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  const cameraIssues = useMemo<TrackIssue[]>(() => {
    if (!selectedRow) return [];
    return validation.filter((issue) => {
      if (!issue.code.startsWith('camera.')) return false;
      return issue.entityId === selectedRow.id || issue.entityId === undefined;
    });
  }, [selectedRow, validation]);

  if (!active) return {};

  const previewRequest: CameraPreviewRequest | null = preview
    ? { cameraId: `CAME-${preview.cameraIndex}`, playing: preview.playing, time: preview.time, sequence: preview.sequence, seek: preview.seek }
    : null;

  return {
    viewportProps: {
      mode: 'camera',
      cameraPreview: previewRequest,
      cameraFocusTarget: capturingIntro && !preview ? introFocus[activeIntroShot] : null,
      cameraViewportApiRef: viewportApiRef,
      onCameraPreviewProgress: (progress) => {
        progressRef.current = progress;
      },
      onCameraPreviewEnd: () => {
        if (looping && preview) {
          startPreview(preview.cameraIndex, { sequence: preview.sequence, time: 0 });
          return;
        }
        setPreview(null);
      },
      onMoveCameraViewPoint: (entity, which, position) => {
        editActions.updateCamera(entity.id, which === 'start' ? { viewStart: position } : { viewEnd: position });
      },
    },
    leftPanel: (
      <CameraOutliner
        rows={rows}
        selectedId={selection.selectedId}
        canEdit={kmp !== null}
        introGenerator={
          <section className="cameraChain cameraIntroGenerator">
            <header className="cameraChainHeader">
              <div>
                <strong>Create three intro shots</strong>
                <p className="panelSubtle">Place two focal points for each shot, then capture its camera positions.</p>
              </div>
            </header>
            {!capturingIntro ? (
              <button type="button" className="button" disabled={!kmp || preview !== null} onClick={() => {
                setIntroShots(introShots.map((shot, index) => ({ ...shot, time: openingChain.steps[index]?.durationFrames || shot.time })));
                setCapturingIntro(true);
              }}>Set up intro shots</button>
            ) : (
              <>
                <p className="panelSubtle">Select a shot, then move the camera to each focal point and place it. Each focal point uses the camera’s current position. While capturing positions, the camera stays aimed at that shot’s midpoint. One capture makes a stationary shot.</p>
                {introShots.map((shot, index) => (
                  <div key={index} className="cameraIntroShot">
                    <strong>Shot {index + 1} · {shot.points.length} viewpoint{shot.points.length === 1 ? '' : 's'}</strong>
                    <button type="button" className="button" disabled={preview !== null} aria-pressed={activeIntroShot === index} onClick={() => setActiveIntroShot(index)}>
                      {activeIntroShot === index ? 'Positioning this shot' : 'Position camera for this shot'}
                    </button>
                    {[0, 1].map((pointIndex) => (
                      <div key={pointIndex}>
                        <button type="button" className="button" disabled={!kmp || preview !== null || activeIntroShot !== index || introFocalPoints[index].length !== pointIndex} onClick={() => {
                          const point = viewportApiRef.current?.getFreeCameraPose()?.position;
                          if (!point) {
                            setStatus('The viewport is not ready yet.');
                            return;
                          }
                          setIntroFocalPoints(introFocalPoints.map((points, i) => i === index ? [...points, point] : points));
                          setStatus(`Placed focal point ${pointIndex + 1} for intro shot ${index + 1}.`);
                        }}>Place focal point {pointIndex + 1}</button>
                        {introFocalPoints[index][pointIndex] && <span className="panelSubtle"> {Math.round(introFocalPoints[index][pointIndex].x)}, {Math.round(introFocalPoints[index][pointIndex].y)}, {Math.round(introFocalPoints[index][pointIndex].z)}</span>}
                      </div>
                    ))}
                    <button type="button" className="button" disabled={introFocalPoints[index].length === 0 || preview !== null} onClick={() => {
                      setActiveIntroShot(index);
                      setIntroFocalPoints(introFocalPoints.map((points, i) => i === index ? [] : points));
                    }}>Reset focal points</button>
                    <label>
                      Duration (frames)
                      <input type="number" className="input" min={1} step={1} value={shot.time} onChange={(event) => {
                        const time = event.currentTarget.valueAsNumber;
                        setIntroShots(introShots.map((current, i) => i === index ? { ...current, time } : current));
                      }} />
                    </label>
                    <div className="cameraRowActions">
                      <button type="button" className="button" disabled={!kmp || preview !== null || activeIntroShot !== index || !introFocus[index]} onClick={() => {
                        const pose = viewportApiRef.current?.getFreeCameraPose();
                        if (!pose) {
                          setStatus('The viewport is not ready yet.');
                          return;
                        }
                        setIntroShots(introShots.map((current, i) => i === index ? { ...current, points: [...current.points, { ...pose, target: introFocus[index]! }] } : current));
                        setStatus(`Captured viewpoint ${shot.points.length + 1} for intro shot ${index + 1}.`);
                      }}>Capture viewpoint</button>
                      <button type="button" className="button" disabled={shot.points.length === 0} onClick={() => {
                        setIntroShots(introShots.map((current, i) => i === index ? { ...current, points: current.points.slice(0, -1) } : current));
                      }}>Remove last</button>
                    </div>
                    <ol className="cameraIntroPoints">
                      {shot.points.map((point, pointIndex) => (
                        <li key={pointIndex}>
                          <button type="button" className="inlineAction" disabled={preview !== null} onClick={() => {
                            setActiveIntroShot(index);
                            viewportApiRef.current?.lookFrom(point.position, introFocus[index] ?? point.target);
                          }}>
                            View {pointIndex + 1}: {Math.round(point.position.x)}, {Math.round(point.position.y)}, {Math.round(point.position.z)}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
                <p className="panelSubtle">Updates the first three opening cameras and creates missing ones. Each shot uses one camera with gently rounded path corners and slows down near the endpoint. Movement lasts about half a second beyond the shot’s duration. Other cameras stay available. New shots default to 220, 257 and 294 frames.</p>
                <div className="cameraRowActions">
                  <button type="button" className="button" disabled={!kmp || preview !== null || introFocus.some((focus) => !focus) || introShots.some((shot) => shot.points.length === 0 || !Number.isFinite(shot.time) || shot.time <= 0)} onClick={() => editActions.generateIntroCameraSet(introShots.map((shot, index) => ({ ...shot, points: shot.points.map((point) => ({ ...point, target: introFocus[index]! })) })))}>
                    Generate intro cameras
                  </button>
                  <button type="button" className="button" onClick={() => setCapturingIntro(false)}>Close setup</button>
                </div>
              </>
            )}
          </section>
        }
        onSelect={(row) => selectCamera(row)}
        onPreview={(row) => {
          selectCamera(row, false);
          startPreview(row.index);
        }}
        onAdd={addCameraHere}
        onDuplicate={(row) => editActions.duplicateCameraEntry(row.index)}
        onDelete={(row) => editActions.deleteCameraEntry(row.index)}
        onMove={(row, direction) => editActions.moveCameraEntry(row.index, row.index + direction)}
        onSetChainStart={(kind, index) => editActions.setCameraChainStart(kind, index)}
      />
    ),
    inspector: (
      <CameraInspector
        entity={selectedEntity}
        row={selectedRow}
        cameraCount={rows.length}
        routeCount={kmp?.routes.length ?? 0}
        routePointCounts={routePointCounts}
        issues={cameraIssues}
        hasViewport={viewportApiRef.current !== null}
        onChange={updateSelectedCamera}
        onPreview={() => selectedRow && startPreview(selectedRow.index)}
        onLookFromCamera={lookFromSelectedCamera}
        onSetFromViewport={setSelectedCameraFromViewport}
        onSetViewPointFromViewport={setSelectedViewPointFromViewport}
        onJumpToIssue={(issue) => {
          if (!issue.entityId) return;
          const index = Number(issue.entityId.replace('CAME-', ''));
          if (Number.isFinite(index)) selectCameraIndex(index);
        }}
      />
    ),
    bottomDock: (dock) => (
      <CameraTimeline
        dock={dock}
        chainKind={activeKind}
        showChainSwitch={hasOpeningChain && hasSelectionChain}
        onChangeChainKind={(kind) => {
          if (kind === activeKind) return;
          setPreview(null);
          setChainKind(kind);
        }}
        chain={activeChain}
        otherChainOrder={otherChain.order}
        rows={rows}
        selectedId={selection.selectedId}
        canEdit={kmp !== null}
        preview={preview ? { playing: preview.playing, sequence: preview.sequence, cameraIndex: preview.cameraIndex, time: preview.time } : null}
        previewTotalFrames={previewTotalFrames}
        looping={looping}
        progressRef={progressRef}
        onSelectCamera={selectCameraIndex}
        onTogglePlay={togglePlay}
        onStop={() => setPreview(null)}
        onToggleLoop={() => setLooping((value) => !value)}
        onScrubStart={beginScrub}
        onScrub={scrubTo}
        onScrubEnd={endScrub}
        onPreviewFrom={playSequenceFrom}
        onPreviewCamera={(index) => {
          const row = rows.find((candidate) => candidate.index === index);
          if (row) selectCamera(row, false);
          startPreview(index);
        }}
        onSetDuration={setShotDuration}
        onChangeOrder={changeChainOrder}
        onAddShot={addShot}
      />
    ),
  };
}
