import { useEffect, useMemo, useRef } from 'react';
import { deleteSelection } from '../../lib/create/ops';
import type { CreateCameraApi, CreateViewProps } from '../../lib/create/types';
import type { EditorModeContext, ModeShortcuts, ModeUi } from '../modes/types';
import { CreateHome } from './home/CreateHome';
import { NewTrackWizard } from './home/NewTrackWizard';
import { SaveIndicator, SessionBanners } from './session/SessionChrome';
import { createSourceId } from './session/trackBridge';
import { useCreateSession } from './session/useCreateSession';
import type { CreateAssets } from './palette/assets';
import { BuildSlot, ChromeSlot, DetailsSlot, paletteSlot } from './slots';
import { roadsBounds } from './tools/bounds';
import { useCreateTools } from './tools/useCreateTools';
import { openingView } from './viewport/framing';
import './create.css';

/**
 * Create mode: the mode hook the shell calls every render. Composition only -- the session
 * (`session/useCreateSession.ts`) owns all state, the panels (`slots.tsx`) draw it, and this
 * file wires them into the shell's slots and into the viewport's `createView`.
 */
export function useCreateMode(ctx: EditorModeContext): ModeUi {
  const session = useCreateSession(ctx);
  const active = ctx.editorMode === 'create';
  const { project, geometry, samples } = session;
  const cameraApiRef = useRef<CreateCameraApi | null>(null);
  const tools = useCreateTools(session, { enabled: active && !!project, cameraApiRef });
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const assets = useMemo<CreateAssets>(
    () => ({ common: ctx.commonArchive, summaries: ctx.commonBrresSummaries, objectOptions: ctx.objectOptions }),
    [ctx.commonArchive, ctx.commonBrresSummaries, ctx.objectOptions],
  );

  // Dev-only read hook for browser probes, like `__mkwTrackDocument`.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const hooks = window as unknown as { __mkwCreateSession?: typeof session; __mkwCreateCtx?: EditorModeContext };
    hooks.__mkwCreateSession = session;
    hooks.__mkwCreateCtx = ctx;
  }

  // Keyboard handling is one stable object whose methods read the newest session.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const setStatusRef = useRef(ctx.setStatus);
  setStatusRef.current = ctx.setStatus;
  const shortcuts = useMemo<ModeShortcuts>(
    () => ({
      undo: () => sessionRef.current.undo(),
      redo: () => sessionRef.current.redo(),
      deleteSelection: () => {
        const s = sessionRef.current;
        if (s.selection.length === 0) return;
        const targets = s.selection;
        s.edit((p) => deleteSelection(p, targets), { label: 'Delete' });
        s.select(null);
      },
      onKey: (event) => toolsRef.current.onKey(event),
      ownsKey: (event) => toolsRef.current.ownsKey(event),
      testDrive: () => {
        const s = sessionRef.current;
        if (s.canTestDrive) void s.testDrive();
        else setStatusRef.current(s.testDriveDisabledReason ?? 'This track cannot be driven yet.');
      },
    }),
    [],
  );

  // Frame the design once, when it first shows up in the viewport (a blank one: top view).
  const framedFor = useRef<string | null>(null);
  const documentReady = !!project && ctx.track?.sourceId === createSourceId(project.id);
  useEffect(() => {
    if (!active || !project || !documentReady || !geometry) return;
    if (framedFor.current === project.id) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const attempt = () => {
      const api = cameraApiRef.current;
      // The viewport puts its own camera down when it finishes building the scene; frame after that.
      if (!api || !api.isSceneReady()) {
        if (attempts++ < 1800) raf = requestAnimationFrame(attempt);
        return;
      }
      framedFor.current = project.id;
      const view = openingView(project, roadsBounds(project, samples), geometry.bounds);
      if (view.kind === 'top') {
        // Through the tools, so the tool bar's Top view button and the scale grid know.
        toolsRef.current.setTopView(true);
        api.frameBounds(view.min, view.max);
      } else {
        // A previous (blank) design may have left the planning view on.
        if (api.isTopView()) toolsRef.current.setTopView(false);
        api.frameBounds(view.min, view.max, view.options);
      }
    };
    // Give the viewport a beat after the document arrives; `attempt` then waits for the scene.
    timer = setTimeout(attempt, 150);
    return () => {
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [active, documentReady, geometry, project, samples]);

  useEffect(() => {
    if (!project) framedFor.current = null;
  }, [project]);

  // The viewport bridge. Workstream E2's tools plug in here: `overlay` comes from the tools'
  // overlay builder, `onPointer`/`cursor` from `useCreateTools(session, cameraApiRef)`, and
  // `showRaceLines` from the tool bar's toggle. Everything else is the session's.
  const createView = useMemo<CreateViewProps | null>(() => {
    if (!project) return null;
    return {
      hideCourseModel: session.previewModels.length > 0,
      models: session.previewModels,
      overlay: tools.createViewPart.overlay,
      onPointer: tools.createViewPart.onPointer,
      cursor: tools.createViewPart.cursor,
      raycast: session.raycast,
      groundPlaneY: project.terrain.baseHeight,
      showRaceLines: false,
      cameraApiRef,
    };
  }, [project, session.previewModels, session.raycast, tools.createViewPart]);

  const latest = session.projects[0] ?? null;
  const resumeCreate: ModeUi['resumeCreate'] = latest
    ? {
        name: latest.name,
        open: () => {
          ctx.setEditorMode('create');
          void session.openProject(latest.id);
        },
      }
    : undefined;

  if (!active) return { resumeCreate };

  const blockedReason = !project ? 'Open or create a track first.' : !documentReady ? 'Your track is still being built.' : null;

  return {
    resumeCreate,
    workspace: project ? undefined : <CreateHome session={session} />,
    leftPanel: <BuildSlot session={session} tools={tools} assets={assets} />,
    inspector: <DetailsSlot session={session} tools={tools} assets={assets} />,
    bottomDock: (dock) => paletteSlot({ session, tools, assets }, dock),
    viewportProps: { mode: 'create', createView } as ModeUi['viewportProps'],
    viewportOverlay: (
      <div className="createMode createViewportLayer">
        <ChromeSlot session={session} tools={tools} assets={assets} />
        <SessionBanners session={session} />
        {project && (
          <div className="createCorner">
            <SaveIndicator state={session.saveState} />
          </div>
        )}
        <NewTrackWizard session={session} />
      </div>
    ),
    shortcuts,
    testDrive: {
      start: () => void session.testDrive(),
      disabledReason: session.testDriveDisabledReason,
      busy: ctx.playtest.loading,
    },
    prepareExport: session.flushCompile,
    exportGuard: () => {
      const s = sessionRef.current;
      const errors = s.issues.filter((issue) => issue.level === 'error');
      if (errors.length === 0) return null;
      const first = errors.find((issue) => issue.target);
      return {
        problems: errors.map((issue) => issue.message),
        showMe: first?.target
          ? () => {
              s.select([first.target!]);
              toolsRef.current.frameSelection([first.target!]);
            }
          : undefined,
      };
    },
    exportDisabledReason: blockedReason,
  };
}
