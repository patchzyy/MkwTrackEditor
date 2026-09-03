import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KmpEntity, Vec3 } from '../../lib/kmp';
import { validateTrack, type TrackIssue } from '../../lib/track';
import type { EditorModeContext, ModeUi } from '../modes/types';
import type { CameraPreviewProgress, CameraPreviewRequest, CameraViewportApi } from '../Noclip3DViewport';
import { CameraInspector } from './CameraInspector';
import { CameraOutliner } from './CameraOutliner';
import { CameraPlaybackControls } from './CameraPlaybackControls';
import type { ChainEditorProps } from './ChainEditor';
import {
  NO_CAMERA_LINK,
  findCameraEntity,
  getCameraChain,
  listCameraRows,
  type CameraChainKind,
  type CameraRow,
  type CameraValues,
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
 * `docs/viewport-api.md`. This hook supplies the camera outliner, the two pan-chain editors, the
 * property inspector and the playback HUD, and routes every edit through the history stack.
 */
export function useCameraMode(ctx: EditorModeContext): ModeUi {
  const active = ctx.editorMode === 'camera';
  const { track, selection, editActions, setStatus, commonArchive } = ctx;
  const kmp = track?.kmp ?? null;

  const viewportApiRef = useRef<CameraViewportApi | null>(null);
  const progressRef = useRef<CameraPreviewProgress | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [looping, setLooping] = useState(false);

  const rows = useMemo(() => listCameraRows(kmp), [kmp]);
  const openingChain = useMemo(() => getCameraChain(kmp, 'opening'), [kmp]);
  const selectionChain = useMemo(() => getCameraChain(kmp, 'selection'), [kmp]);
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

  const previewTotalFrames = useMemo(() => {
    if (!preview) return 0;
    if (preview.sequence) return openingChain.totalFrames;
    const row = rows.find((candidate) => candidate.index === preview.cameraIndex);
    return row ? Math.max(row.timeFrames, row.animatedFrames) : 0;
  }, [openingChain.totalFrames, preview, rows]);

  function startPreview(cameraIndex: number, options: { sequence?: boolean; time?: number } = {}) {
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

  function detachFromChain(kind: CameraChainKind, cameraIndex: number) {
    const chain = kind === 'opening' ? openingChain : selectionChain;
    const nextOrder = chain.order.filter((index) => index !== cameraIndex);
    editActions.setCameraChainOrder(kind, nextOrder);
  }

  function buildChainEditor(kind: CameraChainKind): ChainEditorProps {
    const chain = kind === 'opening' ? openingChain : selectionChain;
    return {
      kind,
      title: kind === 'opening' ? 'Opening pan' : 'Selection screen pan',
      description:
        kind === 'opening'
          ? 'Plays over the track before the countdown. Drag to change the order.'
          : 'Plays behind the character-selection screen. Drag to change the order.',
      chain,
      rows,
      selectedId: selection.selectedId,
      canEdit: kmp !== null,
      onSelect: selectCameraIndex,
      onPlay: () => {
        if (chain.order.length === 0) return;
        startPreview(chain.order[0], { sequence: true });
      },
      onReorder: (order) => editActions.setCameraChainOrder(kind, order),
      onRemove: (cameraIndex) => detachFromChain(kind, cameraIndex),
    };
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
        openingChain={buildChainEditor('opening')}
        selectionChain={selectionChain.order.length > 0 || selectionChain.first !== NO_CAMERA_LINK ? buildChainEditor('selection') : null}
        canEdit={kmp !== null}
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
    topRightOverlay: preview ? (
      <CameraPlaybackControls
        cameraIndex={preview.cameraIndex}
        describeCamera={describeCamera}
        sequence={preview.sequence}
        playing={preview.playing}
        looping={looping}
        time={preview.time}
        totalFrames={previewTotalFrames}
        progressRef={progressRef}
        onPlay={() => setPreview((current) => (current ? { ...current, playing: true, seek: current.seek + 1 } : current))}
        onPause={() =>
          setPreview((current) => (current ? { ...current, playing: false, time: progressRef.current?.frames ?? current.time } : current))
        }
        onStop={() => setPreview(null)}
        onScrub={(frames) => setPreview((current) => (current ? { ...current, time: frames, seek: current.seek + 1 } : current))}
        onToggleLoop={() => setLooping((value) => !value)}
        onPlayOpening={() => openingChain.order.length > 0 && startPreview(openingChain.order[0], { sequence: true })}
        canPlayOpening={openingChain.order.length > 0}
      />
    ) : (
      <div className="viewportOverlayPanel cameraPlaybackIdle">
        <div className="viewportOverlayHeader">
          <strong>Camera preview</strong>
        </div>
        <p className="viewportOverlayDetail">
          {rows.length === 0
            ? 'This track has no cameras. Use Add in the camera list to place one where you are looking from.'
            : selectedRow
              ? `Ready to play ${describeCamera(selectedRow.index)}.`
              : 'Pick a camera in the list to preview it.'}
        </p>
        <div className="cameraPlaybackButtons">
          <button type="button" className="button" disabled={!selectedRow} onClick={() => selectedRow && startPreview(selectedRow.index)}>
            Play camera
          </button>
          <button type="button" className="button" disabled={openingChain.order.length === 0} onClick={() => startPreview(openingChain.order[0], { sequence: true })}>
            Play opening sequence
          </button>
        </div>
      </div>
    ),
  };
}
