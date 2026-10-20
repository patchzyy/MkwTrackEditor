# Editor module map

`src/ui/App.tsx` used to be a ~9000 line file that held all UI, state, history, inspectors,
content browser and object metadata. It is now a ~540 line shell that composes panels; everything
else lives in the modules below.

Layering rule: `src/lib/**` is pure logic with no React import, `src/ui/**` is React. UI modules may
import from `src/lib`, never the other way round. The one deliberate exception in the other
direction is `vendor/noclip.website/src/MarioKartWii/EditorMeshPicker.ts`, which imports the
geometry helpers in `src/lib/meshPick.ts` rather than duplicating them in the vendored tree.

Companion documents: `docs/viewport-api.md` (the app ↔ viewport ↔ renderer contract),
`docs/UI.md` (the design system and panel shell), `docs/PLAYTEST.md` (the in-browser playtest),
`docs/MATERIALS.md` (the material and shader editor), `docs/STUDIO.md` (the Model Studio),
`docs/CREATE.md` and `docs/CREATE-KIT.md` (Create mode and its asset kit),
`docs/WORKPLAN.md` (the shared brief).

## Shell

| File | Responsibility |
| --- | --- |
| `src/main.tsx` | React entry point. Also forwards an uncaught startup error to `?smokeCallback=`. |
| `src/ui/App.tsx` | Layout composition only: calls the state hooks, composes the four mode hooks, derives the memoised view models, and renders the top bar, dock panels, viewport, inspector, content browser, status bar and toast stack. |
| `src/ui/topbar/TopBar.tsx`, `FileMenu.tsx`, `recentFiles.ts` | Header bar: the file menu (open `.szs`, import `Common.szs`, recent files), undo/redo, export, and the editor-mode switch. |
| `src/ui/components/` | The design system every panel is built from — `Button`, `Panel`, `Field`, `NumberInput`, `VectorInput`, `Select`, `Toggle`, `Tabs`, `SegmentedControl`, `TreeView`, `Menu`, `Popover`, `Tooltip`, `Toolbar`, `StatusBar`, `Toast`, `ShortcutOverlay`, `EmptyState`, `WelcomeOverlay`, `RefreshTrackButton`, `LoadingOverlay`, `AxisGizmo`, `ColorField` — plus the pure helpers behind them (`numberScrub.ts` for drag-to-scrub, `statusMessage.ts`, `treeModel.ts`) and `components.css`. Documented in `docs/UI.md`. |
| `src/ui/Noclip3DViewport.tsx` | The viewport: canvas and scene lifecycle, picking, gizmos, drag/drop, camera control, camera playback, mesh picking and per-mesh transforms, and the `window.__mkwViewport` dev hook. See `docs/viewport-api.md`. |
| `src/ui/studio/ModelStudio.tsx` | The Model Studio, a full-window workspace layered over the editor. `App` renders it when it is open and keeps the track editor mounted underneath. Documented in `docs/STUDIO.md`. |

`NumberInput` is a text input carrying `role="spinbutton"` rather than `input[type=number]`, so it
can support drag-to-scrub. Anything that looks for numeric fields (the UI probes, for instance) has
to match that role as well as `input[type=number]`.

## Editor modes (`src/ui/{kmp,camera,model,visual,material}/`)

Each mode is a hook that returns a `ModeUi` (`src/ui/modes/types.ts`); `App.tsx` composes them and
renders whichever one is active. A mode owns its own outliner, inspector and viewport overlay, and
may also take over the bottom dock (`ModeUi.bottomDock`, which Material mode uses for the shader
graph in place of the content browser).

| Directory | Mode |
| --- | --- |
| `src/ui/kmp/` | Track data: `KmpOutliner` (the whole track as a friendly-named tree), `KmpInspector` (the tools that apply to the selection), `KmpToolsOverlay` (viewport gestures), `kmpOutlinerModel.ts`, `kmpSelectionContext.ts`, `kmpSections.ts`, `useKmpGraphActions.ts`. |
| `src/ui/camera/` | CAME editing: `CameraOutliner`, `CameraInspector` + `CameraFields` + `cameraFieldMeta.ts` (friendly labels), `ChainEditor` (opening and character-select pans), `CameraPlaybackControls`, `cameraDocument.ts`. |
| `src/ui/model/` | Geometry: `ModelOutliner`, `ModelInspector`, `PlaceObjectPanel`, `useModelEditing.ts`. Selection is per-mesh and is baked into `course_model.brres` on export. |
| `src/ui/visual/` | The track's look: `VisualOutliner` (archive/material/texture/animation browser), `VisualInspector`, `TextureInspector` + `TexturePreview`, `VisualRenderOverlay` (render presets), `visualArchive.ts`, `textureReplace.ts`, `visualScene.ts`, `useVisualArchive.ts`. |
| `src/ui/material/` | One material at a time: `MaterialOutliner`, `MaterialInspector` + `sections/`, `ShaderGraphDock` (Graph / Stages), `GraphEditor` + `GraphNodeCard` + `graphModel.ts` (the node editor and its pure model), `StagesTable`, `graphStore.ts` (IndexedDB), `materialDoc.ts`, `materialOutlinerModel.ts`, `gxOptions.ts`, `materialScene.ts`. Documented in `docs/MATERIALS.md`. |

## Model Studio (`src/ui/studio/`)

A workspace over the track editor for one model: an orbit preview with its own canvas, `Viewer`
and noclip scene, its animations on one transport, and the material inspector and shader graph
reused verbatim from Material mode. It works with no track loaded, and when it was opened from a
track archive its edits go back into the track document. Documented in `docs/STUDIO.md`.

| File | Responsibility |
| --- | --- |
| `ModelStudio.tsx` | The workspace shell: header, layout, dock sizing, keyboard, and the `window.__mkwStudio` dev hook. |
| `useStudioSession.ts` | All of the state: opening a file, the decoded material documents, the shader graph, the transport, the render toggles, the studio's own undo stack, and the bridge that commits an edit into a loaded track. |
| `StudioViewport.tsx` | Canvas, `Viewer`, `StudioScene`, the orbit camera (never pointer lock), click/hover picking, and the frame readback the probes sample. |
| `StudioOutliner.tsx` | Archives → models → materials, plus textures and animations, with an eye on what is drawn and a play button on what moves. |
| `StudioTransportBar.tsx` | Play/pause, step, scrub, speed and loop under the viewport. |
| `studioDocument.ts` | What is open: `.brres` / `.u8` / `.szs`, the BRRES list inside it, replacement, and export — including the rule that an untouched file exports byte for byte. |
| `studioOutlinerModel.ts`, `animationTransport.ts` | The pure tree/search model and the pure transport maths. |
| `studioScene.ts` | The structural contract for the vendored `StudioScene`, so `src/ui` never imports a vendored type. |
| `studioRecent.ts`, `studioLaunch.ts` | Recent files in IndexedDB, and the request the rest of the editor makes to open the studio. |

`vendor/noclip.website/src/MarioKartWii/StudioScene.ts` is the scene behind it: every MDL0 of the
loaded archives as an `MDL0ModelInstance`, a three-point light rig in every light set (which is
what stops a character rendering as a flat dark-blue silhouette), a ground grid, one animation
clock, picking against the *animated* pose, and the same `reloadEditorMaterial` /
`addEditorTexture` hot-swap API the track scene has.

## Playtest (`src/ui/playtest/`, `src/lib/playtest/`)

Driving the loaded track in the viewport with Mario Kart Wii's physics. Documented in
`docs/PLAYTEST.md`; the contract between the UI and the physics is `src/lib/playtest/types.ts`
and nothing outside `src/lib/playtest/` touches WebAssembly.

| File | Responsibility |
| --- | --- |
| `src/lib/playtest/types.ts` | `PlaytestRuntime` and everything it exchanges: input, kart pose, race state, camera pose, the character/vehicle tables. |
| `src/lib/playtest/mockRuntime.ts` | A deterministic kinematic stand-in implementing the same interface, so the UI can be built, tested and probed without WASM. |
| `src/lib/playtest/playtestLoop.ts` | `planFixedSteps`: real elapsed milliseconds → whole 60 Hz steps, with capped catch-up. |
| `src/ui/playtest/runtimeFactory.ts` | The single place that picks a runtime: Kinoko in the app, the mock for UI-only testing. |
| `src/ui/playtest/usePlaytestSession.ts` | Session lifecycle: packing the course, creating the runtime, the controller listeners, the HUD sample, the borrowed dock layout. |
| `src/ui/playtest/playtestInput.ts` | Pure keyboard/gamepad → `PlaytestInput` mapping and the controls summary. |
| `src/ui/playtest/playtestChaseCamera.ts`, `playtestCamera.ts` | The chase-camera maths, and the `CameraController` installed for the session. |
| `src/ui/playtest/PlaytestMenu.tsx`, `PlaytestHud.tsx`, `playtestHudModel.ts`, `playtestOptions.ts`, `playtest.css` | The top-bar start popover, the in-viewport race HUD and its pure formatting, the curated rosters and their persistence, the styles. |

`src/ui/viewport/` holds the mode-agnostic viewport logic that is pure enough to unit test:
`cameraOverlay.ts` (KMP → camera gizmo overlay), `cameraPlayback.ts` (the playback clock),
`meshSelection.ts` (the mesh selection list and its gizmo ids).

## Create mode (`src/lib/create/`, `src/ui/create/`)

A Mario-Maker-style track builder: pick a world, draw a road, dress it, press Test drive, export a
`.szs`. The product spec is `docs/CREATE.md` (§1 and §6), the asset kit is `docs/CREATE-KIT.md`, the
viewport half of the contract is section 11 of `docs/viewport-api.md`, and the single shared contract
is `src/lib/create/types.ts`. Create is the first entry of the mode switch; it has its own undo stack
(`designHistory.ts`) and keeps its design in IndexedDB, but what it produces is a normal
`TrackDocument` (`sourceId` `create:<id>`), so the other modes, Playtest and Export work on it.

### `src/lib/create/` — pure design → track logic (no React)

| File | Responsibility |
| --- | --- |
| `types.ts` | The contract: `CreateProject` (the saved JSON design), `CreateKit`, `CompiledGeometry`, `CompileResult`, and the viewport's `CreateViewProps` / `CreateCameraApi` / `CreateOverlay`. |
| `ops.ts`, `ops/` | Every design edit as a pure `(project, …) → project'` function (`addRoad`, `splitSection`, `setTheme`, `scatterProps`, `deleteSelection`, …). `ops/paramMap.ts` remaps road parameters when points are inserted or removed, `ops/sections.ts` keeps sections valid, `ops/migrate.ts` holds the defaults and loads old saved designs. |
| `templates.ts` | The six starting layouts (`LAYOUT_TEMPLATES`), `createBlankProject` / `createProjectFromTemplate` (the ground starts at the world's `KitTheme.baseHeight`) and the default scenery scatter. |
| `spline.ts`, `sections.ts`, `roadStyles.ts` | The road as a spline (centripetal Catmull-Rom, arc-length samples with bank, projection, parameter ↔ distance), the stretches of a road with their own cross-section, and the built-in road styles. |
| `road.ts`, `terrain.ts`, `horizon.ts`, `pieces.ts`, `props.ts`, `meshBuilder.ts` | Geometry: per-section road meshes and collision, the sculpted and painted heightfield, the far horizon ground (a detailed ring plus flat slabs out to 2,000,000 units, so a far or low camera never looks at the empty clear colour), gameplay pieces and scenery objects. `meshBuilder.ts` holds the mesh and collision accumulators and the winding convention. |
| `kmpGen.ts`, `kclTypes.ts` | Everything the game needs that a designer should not think about: start grid, checkpoints, respawns, driver and item routes, cameras, stage info. |
| `analyze.ts` | `analyzeProject` → friendly `CreateIssue`s with "Show me" targets, and the build checklist. |
| `raycast.ts` | Rays against the design's own collision (the tools click on this, not on the stale scene). |
| `compile.ts` | `compileGeometry` (cheap, runs every drag frame), `compileProject` (adds the KMP and runs the writers), `buildPreviewModels` (one BRRES per chunk for the live viewport), `buildTrackArchive` (the playable `.szs`), file hashing. |
| `kit/` | `loadCreateKit()` reads `public/data/MarioKartWii/Create/create-kit.szs` (worlds, surfaces, swatch BRRES, thumbnails, scenery). Built by `scripts/build-create-kit.mjs`. |
| `writers/` | The binary writers: `modelWriter` (BRRES/MDL0 from scratch), `kclWriter`, `minimapWriter`. See `writers/README.md`. |
| `__tests__/` | The synthetic kit and the Kinoko driving fixtures the generator tests share. |

### `src/ui/create/` — the mode

| File | Responsibility |
| --- | --- |
| `CreateMode.tsx` | `useCreateMode(ctx): ModeUi`, composition only. Wires the session, the tools and the panels into the shell's slots and into the viewport's `createView`, and frames the design when it opens (`viewport/framing.ts`: top view for a blank design, a 3/4 perspective for a template). |
| `slots.tsx` | The four places Create plugs in: Build (left dock), Details (right dock), Palette (bottom dock) and the viewport chrome. |
| `session/` | `useCreateSession.ts` is the state owner: kit, current project, `designHistory.ts` (snapshot undo with coalesced drags), autosave through `projectStore.ts` / `projectFile.ts` (IndexedDB plus the `.mkwcreate.json` file), the derived data (road samples, preview models, raycaster, issues, checklist) and the compile schedule. `compileClient.ts` + `compile.worker.ts` + `compileProtocol.ts` run the full compile off the main thread. `trackBridge.ts` swaps the compiled files into the `TrackDocument`; `conflicts.ts` spots hand-edits made in other modes; `SessionChrome.tsx` is the save indicator and the banners. |
| `tools/` | The viewport tools as pure handlers (`selectTool`, `roadTool`, `sectionTool`, `pieceTool`, `paintTool`, `sculptTool`, `sceneryTool`, `startTool`; `(event, ctx) → step`) and `useCreateTools.ts`, the state machine around them (active tool, armed palette item, hover and drag, keys, palette drag-and-drop). `keys.ts` maps keys, `hints.ts` writes the hint strip, `bounds.ts` works out what "frame" means. |
| `overlay/` | `buildCreateOverlay.ts` turns design + selection + hover + tool ghost into the `CreateOverlay` the noclip scene draws (spline, chevrons, handles, section ticks, brush circles). |
| `home/` | The Create home (saved designs), `NewTrackWizard` (world → layout → name) and `TrackOutline` (the SVG thumbnail). |
| `build/` | The left dock: the checklist and the layers tree. |
| `details/` | The right dock: contextual inspectors (track, road, point, section, piece, prop, multi). `PresetField` + `presets.ts` turn raw numbers (speed, spacings) into named choices with an exact-value escape hatch. |
| `palette/` | The bottom dock: tabs of tiles (roads, surfaces, pieces, scenery, terrain). `dockMetrics.ts` holds the row rhythm that makes the dock open on exactly one whole row and step by whole rows. |
| `viewport/` | The floating tool bar, hint strip, health chip, coach marks, conflict banner, and `framing.ts` (the opening camera). |

### Data flow

The design is one JSON object. Every user action is an op that returns a new `CreateProject`; the
session pushes it onto the design history and, on the next animation frame, recomputes the derived
data: road samples, then `compileGeometry` (meshes by chunk, collision, bounds) on the main thread
and `buildPreviewModels` (one small generated BRRES per chunk: `road:<id>`, `terrain`, `pieces`,
`horizon`). Those go to the viewport as `createView.models`, which hot-swaps them without rebuilding
the noclip scene; the loaded track's own course model is hidden. The tools raycast against that same
collision, and the overlay is rebuilt from the project plus the tool state. About 300 ms after the
last edit (immediately when a drag ends) the full `compileProject` runs in a worker: KMP, the
collision octree, the course model and the minimap. `trackBridge` writes those files into the
`TrackDocument` in place, so Playtest, the other modes and Export always see the current design.
Opening a design for the first time creates that document through `openTrackBytes`, and a world
change needs a scene refresh for its sky and lighting. If the user edits a generated file in another
mode and comes back, `conflicts.ts` detects it by hash and the mode offers "Keep my changes" or
"Rebuild from the design".

The bottom dock height is the one piece of shell layout Create customises. `usePanelLayout` accepts a
`BrowserSizing`; Create passes `CREATE_DOCK_SIZING`, so its palette opens at the height of the tab bar
plus one section title plus one row of tiles, its drag handle snaps by whole rows, and scrolling
inside the dock snaps to rows too. Create keeps its own persisted height; every other mode keeps the
shared 260 px default and 150 px minimum.

## Editor state (`src/ui/state/`)

All hooks are plain functions returning an object; none of them render anything.

| File | Responsibility |
| --- | --- |
| `types.ts` | `EditorSnapshot`, `InspectorSection`, `EditorModeStub`. |
| `useSelection.ts` | `selectedId` / `selectedIds` plus the synchronous `selectedIdRef` / `selectedIdsRef` mirrors and the select helpers. |
| `useTrackDocument.ts` | The loaded `TrackDocument`, the BRRES editor project state, `Common.szs` handling (bundled, persisted via IndexedDB, or user-imported), the course asset database, content-browser BRRES previews, and the URL parameters. Owns `openFiles` / `importCommonArchive` and `openTrackBytes`, the single door every load path goes through (`?track=`, `?smokeTrack=`, the picker, drag-and-drop). Publishes `loadProgress` for the viewport's loading overlay. |
| `useEditorHistory.ts` | Undo/redo stacks of whole `EditorSnapshot`s, `HISTORY_LIMIT`, edit sessions for viewport drags (`beginEditSession` / `endEditSession`), and the `applyEditorChange` / `applyTransientEditorChange` entry points. |
| `useClipboard.ts` | Copy / paste / duplicate for the current selection. |
| `useKmpEditActions.ts` | Every KMP mutation: move/rotate/scale, add object, add track record, insert/fork route point, object route helpers, delete, reorder, split/merge path groups, batch offset, batch object replace, fill between. |
| `usePostEffectActions.ts` | Create/patch the track's `posteffect.*` files (fog, bloom, DOF, lighting). |
| `useTrackExport.ts` | Validation prompts, export, archive self-check, download. |
| `useBrowserFolders.ts` | Content browser folder model, active folder and search query. |
| `usePanelLayout.ts` | Dockable panel layout: sizes, collapse and visibility state, drag-to-resize handles, and the shell CSS custom properties. Persisted in local storage under `mkw.editor.layout.v2`. |
| `useEditorShortcuts.ts` | Global keyboard shortcuts (undo/redo, clipboard, W/E/R tools, fill between, delete, export). |
| `useSmokeHarness.ts` | Instrumentation for `scripts/browser-smoke*.mjs`. Only runs for `?smokeTrack=` / `?smokeCallback=`. |

`useTrackDocument` and `useEditorHistory` are mutually dependent (loading a track resets history;
history writes the track state). The cycle is broken by `trackDocument.bindHistory(history)`, which
`App` calls during render so the load effects can reach the history stack.

### URL parameters

| Parameter | Effect |
| --- | --- |
| `?track=<url>` | Loads a track on startup. Plain editor behaviour, identical to opening the file by hand. This is the one to use for development and for the UI probes. |
| `?smokeTrack=<url>` | Loads a track *and* turns on the browser smoke-test behaviour: a reduced BRRES summary budget, a reduced `Common.szs` preview set, and the `useSmokeHarness` instrumentation. Test-only. |
| `?smokeCommon=<url>` | Overrides where `Common.szs` is fetched from. Test-only. |
| `?smokeCallback=<url>` | Where the smoke harness POSTs its report. Test-only. |
| `?reactTracks=1` | Development only: puts React's "Components" performance track back on. See `src/devPerformanceTracks.ts`. |

`?track=` and `?smokeTrack=` are handled by two separate effects; `?smokeTrack=` wins if both are
given. Nothing outside the smoke path reads any of the `smoke*` parameters.

### Loading a track

Opening a track is two jobs, and the user watches one progress bar across both
(`src/lib/trackLoadProgress.ts`):

1. **Reading** — `trackLoad.worker.ts`: Yaz0, U8 with layout, KMP, KCL, one summary per model
   archive, then `buildEditorProjectState`. Off the main thread, so the page keeps painting.
   Progress: "Unpacking the track archive", "Reading the track layout", "Model 3 of 15", ...
   The finished `TrackDocument` comes back through a *transferring* structured clone, so nothing
   is copied and the export stays byte-for-byte identical (`trackLoader.test.ts`).
2. **Building** — the noclip scene, which has to be on the main thread because it talks to WebGL.
   `SceneContext.onProgress` (a local addition to the vendored `SceneBase.ts`) reports "Building
   the track model", "Placing objects — 142 of 146", and the scene yields between steps on an
   8 ms budget.

`Noclip3DViewport` owns the overlay: it takes `loadProgress` for the first half and produces the
second half itself, so the bar never blinks out at the handover, and it comes down when the scene
is ready *or* when it failed (the message goes to the status line as before).

Measured on this machine with `scripts/loading-probe.mjs`, production build, a 9 MB retail track:
the longest single stall during a load is ~210 ms, and the load takes about 1.6 s end to end.

## Inspector (`src/ui/inspector/`)

| File | Responsibility |
| --- | --- |
| `InspectorPanel.tsx` | The right sidebar: Object/Track tabs, details summary, batch tools, KMP overview, post-effects, validation list. |
| `SelectedEntityInspector.tsx` | Binds the selected record to `useKmpEditActions` and renders `Inspector`. |
| `Inspector.tsx` | Property grid for one KMP record; delegates to the section components. |
| `sections/` | One component per record kind: `CheckpointSection`, `RoutePointSection`, `AreaSection`, `CameraSection`, `RespawnCannonSection`, `StageSection`, `ObjectSetupSection`, `AdvancedObjectSection`, `PathGroupSection`. |
| `objectSettings/ObjectSettingsFields{,1,2,3}.tsx` | The per-object control blocks. One long chain of mutually exclusive `objectProfile.title === '…'` tests, split into three ordered chunks purely so no single file is unreadably long. Render order is preserved by rendering 1, 2, 3 in sequence. |
| `fields/` | `VectorInputs`, `ShortNumberInputs`, `ReferenceSelect`, `NumberOptionSelect`, `RgbColorField`, `RgbaColorField`, `ObjectIdSelect`. |
| `PostEffectsPanel.tsx`, `postEffectResources.ts` | Fog / bloom / DOF / lighting editors and the code that finds and parses the track's `posteffect.*` files. |
| `optionTables.ts` | Dropdown options for the route / area / cannon sections. |
| `BatchSelectionPanel.tsx`, `FillBetweenPanel.tsx`, `KmpOverview.tsx`, `DetailsSummaryBar.tsx` | Multi-selection tools, the fill-between viewport overlay, the track graph summary, and the details header strip. |

## Content browser (`src/ui/contentBrowser/`)

| File | Responsibility |
| --- | --- |
| `ContentBrowser.tsx` | Bottom dock: folder tabs, search, asset strip. |
| `PlaceAssetsRail.tsx` | Left "Place Assets" rail of frequently dragged objects. |
| `browserFolders.ts` | Folder model (`buildBrowserFolders`), folder classification, search text and `filterBrowserFolder`. |
| `browserAssetDedupe.ts` | Collapses duplicated course assets to one representative. |
| `browserEntries.ts` | The flat entry model the browser grid renders. |
| `libraryBrowser.test.ts` | The "My Assets" folder: custom `.brres` files dropped onto the browser, kept in IndexedDB (`src/lib/assetLibrary.ts`, `src/ui/state/useAssetLibrary.ts`). |
| `ObjectThumbnail.tsx`, `EntryThumbnail.tsx` | Asset tile previews, rendered by `src/lib/thumbnail`. |

## Object and label metadata

| File | Responsibility |
| --- | --- |
| `src/ui/objects/objectCatalog.ts` | Built-in object catalog, `featuredObjectIds`, `ObjectOption`, and the object naming/search/resource helpers. |
| `src/ui/objects/objectProfiles.ts` | `getObjectInspectorProfile`, `getObjectVariantOptions`, guidance-only notes, presence-flag descriptions. |
| `src/ui/objects/objectOptionTables.ts` | Per-object dropdown option tables. |
| `src/ui/areas/areaInspectorConfig.ts` | AREA inspector config, presets, and the fog/bloom preset pickers derived from the track archive. |
| `src/ui/labels.ts` | `friendlySectionLabel`, `humanizeObjectName`, `getKnownObjectName`, `shortAssetName`, `describeBrres`, `fmt`, `presentValidationIssue`. No raw KMP section code ever reaches the user. |

## Pure logic (`src/lib/`)

### Container and track formats

| File | Responsibility |
| --- | --- |
| `u8.ts` | The `.szs` container. `parseU8WithLayout` captures everything about the source archive that is not implied by its entry list, so `buildU8` reproduces an untouched archive byte-for-byte. Rejects a file whose magic, size or node table is wrong, in words the status line can show. |
| `yaz0.ts` | Yaz0 compression. `decodeYaz0` bounds the declared output size and detects a truncated stream instead of decoding it to zeroes; `encodeYaz0`'s `searchDepth` trades time for ratio (16 matches Nintendo's). |
| `track.ts` | `TrackDocument`, `loadTrackBytes`, `exportTrack`, `bakeMeshEdits`, `validateTrack` and `validateExportBytes` (re-opens the exported bytes and validates them as if the user had just dropped them in). Also the object-pitfall checks that need the whole archive. `loadTrackBytes` reports progress and can skip the model previews; it is the same function on both loader paths. |
| `trackLoader.ts` | **How a track gets opened.** `loadTrack()` runs `loadTrackBytes` plus `buildEditorProjectState` in `trackLoad.worker.ts` (one worker per load, terminated when it answers, cancellable with an `AbortSignal`) and falls back to `loadTrackOnThisThread` where there are no module workers — vitest, the Vite-SSR batch check, an old browser. Same progress callback either way. |
| `trackLoad.worker.ts` | The worker body. No DOM, so it skips the model previews; the page renders those afterwards. Sends the finished document back with every reachable `ArrayBuffer` transferred rather than copied. |
| `trackLoaderProtocol.ts` | The messages the two sides agree on, and `collectTransferables()`, which walks the document for buffers to move. Kept separate so a test can reach the types without importing a module that calls `self.addEventListener`. |
| `trackLoadProgress.ts` | `TrackLoadProgress` and the two halves of the bar: reading owns 0–`READING_PHASE_END`, the scene build the rest. Also `yieldToHost()`, which waits for a frame *and then a task*, because a promise resolved inside a `requestAnimationFrame` callback resumes before the paint. |
| `binary.ts` | `BinReader` / `BinWriter` / `align`. |

### Track data

| File | Responsibility |
| --- | --- |
| `kmp.ts` | The flat, id-addressed `KmpDocument` the inspector and viewport bind to. |
| `kmpFile.ts` | The fully structured, losslessly round-trippable `KmpFile`. `readKmpFile` / `writeKmpFile` are byte-exact on every real track. |
| `kmpGraph.ts` | The path graphs (`ENPT`/`ITPT`/`CKPT`) and every structural edit on them: insert, split, merge, link, unlink, reverse, delete, renumber key checkpoints, assign nearest respawns. |
| `kmpEdit.ts` | React-free document editing: copy/paste, viewport drag previews, deletion selection, reference counts, and the numeric field codecs. |
| `kmpValidation.ts` | Every rule behind the validation panel, with a level, a code and the entity it is about. |
| `gravityField.ts` | Retro Rewind gravity fields (AREA type 11): the game's field math (volumes, path gate chains, priority resolution, AREA axes as `EGG::Quatf::fromRPY`), the multi-AREA edit plans the inspector applies (chain-wide flags, gate links, remapping on AREA delete/reorder), validation, and the viewport overlay geometry (volumes, chain lofts, animated flow arrows). The inspector lives in `src/ui/areas/GravityFieldSection.tsx`. |
| `kcl.ts`, `kclRaycast.ts` | The collision mesh and the BVH the viewport raycasts against for ground snapping. |
| `posteffects.ts` | `posteffect.bfg` / `.bblm` / `.bdof` / `.blight` read and write. |
| `objflow.ts`, `commonAssets.ts`, `courseAssets.ts`, `persistedCommon.ts`, `assetPaths.ts` | The shared game-asset side: `ObjFlow.bin`, assembling the effective `Common.szs`, the extracted course-asset database, IndexedDB persistence, and `BASE_URL`-aware public asset URLs (which is what makes the build work under a GitHub Pages subpath). |
| `editorDb.ts`, `assetLibrary.ts` | The one IndexedDB database (`mkw-track-editor`, one store per kind of blob) and the user's custom model library kept in it: records hold the `.brres` bytes plus the name, model list and rendered thumbnail the content browser tiles need. |

### Models and textures

| File | Responsibility |
| --- | --- |
| `brres/brresRaw.ts` | BRRES container read/write, resource groups, sub-file name resolution. |
| `brres/extractModel.ts` | Pulls one MDL0 and the TEX0 / PLT0 it references out of an archive into a standalone `.brres` with a fresh string pool ("Export model", "Save to My Assets"). |
| `brres/mdl0Raw.ts` | `Mdl0Editor`: in-place MDL0 editing — vertex arrays, shapes, materials, nodes, draw lists, and appending into a grown file. |
| `brres/resDic.ts` | NW4R resource dictionaries, including `buildResDicIndexTree`, which reproduces the exact radix tree Nintendo's tools emit, and `lookupResDicIndex`, the console-side walk used to prove a rebuilt tree resolves every name. |
| `brres/stringPool.ts`, `brres/gxVertex.ts` | The string pool and the GX vertex/primitive encoding. |
| `brres/meshBake.ts` | Turning a mesh edit into transformed vertex data: joint matrices, connected-component splits, affected-vertex sets, position/normal transforms. |
| `brres/mergeModel.ts`, `brres/bakeCourseModel.ts` | Merging an imported object model into the course model, and the top-level bake that folds every Model-mode edit into `course_model.brres`. |
| `brres/courseMeshes.ts` | Listing a course model's draw calls straight from the BRRES, so the outliner works before the scene has loaded. |
| `brresEditor.ts` | The document model the UI binds to: `EditorMeshTarget`, `MeshTransform`, `MeshEdit`, `ImportedMesh`, granularity helpers, and the edit-list helpers. |
| `brresRenderAdapter.ts` | The app-side shape of the renderer's mesh API (`EditorMeshRendererScene`) and the gizmo ↔ mesh transform conversions. Nothing here imports vendored types. |
| `meshPick.ts` | Ray/triangle and ray/AABB intersection, bounds maths, and the connected-component split. Shared with the vendored `EditorMeshPicker`. |
| `mdl0ModelDomain.ts` | The model/mesh naming and grouping domain the outliner presents. |
| `gxMaterial/types.ts` | The material editor's contract: `GxMaterialDoc` and everything around it, the shader-graph node model, and the signatures `src/lib/gxMaterial/` implements. Plain JSON-serialisable data, so a material document can go in the editor history and in IndexedDB. |
| `tex0Brres.ts`, `tex0Codec.ts` | Locating and patching TEX0s in place, and encoding/decoding every GX format the editor can write (I4/I8/IA4/IA8/RGB565/RGB5A3/RGBA8/CMPR) with mip generation. |
| `noclipBrres.ts` | The BRRES summary the content browser and Visual mode read. Never throws: an unreadable archive comes back with an `error` string so one bad file cannot stop a track opening. |
| `thumbnail/` | Real-renderer asset thumbnails: `index.ts` (the service and its cache), `webglThumbnailRenderer.ts`, `framing.ts`, `cache.ts`, `modelSelection.ts`. |
| `cameraPreview.ts` | CAME interpolation and opening-chain walking, shared by the viewport playback and the camera inspector. |

### QA harness

| File | Responsibility |
| --- | --- |
| `batch/trackPipelineCheck.ts` | The whole-pipeline check for one track: load, parse, export untouched and demand byte-identical bytes, apply one representative edit from each of the four modes, export, and re-open. Every stage is differential — the bar is "no worse than the source", because real tracks ship with their own validation errors. Driven by `scripts/batch-track-check.mjs` over all ~338 real tracks, and by `batch/trackPipelineCheck.test.ts` over a fast subset. |

## Scripts (`scripts/`)

| Script | Purpose |
| --- | --- |
| `batch-track-check.mjs` | The whole-pipeline batch check over every real track on this machine. Loads the TypeScript sources through Vite's SSR pipeline, so no build step and no browser. `--limit`, `--filter`, `--noclip`, `--no-compression`, `--search-depth`, `--json`. |
| `vendor-reachability.mjs` | Recomputes the transitive import closure of `vendor/noclip.website/` from `src/**` and `scripts/**` and reports (or `--delete`s) anything outside it, so the trimmed fork does not re-accumulate dead weight. Also flags relative imports that do not resolve. |
| `browser-smoke.mjs`, `browser-smoke-real-tracks.mjs` | The `?smokeTrack=` end-to-end browser checks. |
| `camera-ui-probe.mjs`, `kmp-ui-probe.mjs`, `probe-model-ui.mjs`, `viewport-dev-probe.mjs` | Harnesses that drive a real off-screen Edge window and run a probe body against it. Headless Edge cannot run noclip, so these are not `--headless`. |
| `studio-probe.mjs`, `studio-dev-restart.sh` | The Model Studio's harness — it waits on `window.__mkwStudio`, so it can drive a studio session with no track loaded — and the dev-server restart the probes need, because Vite's watcher does not see edits inside a git worktree on this host. |
| `loading-probe.mjs` | The same, but for the *load itself*: it installs a main-thread responsiveness recorder before any application code runs and starts the probe body immediately after navigating, so the loading overlay can be watched and screenshotted while it happens. `PROFILE=1` adds a CPU profile of the run; `NO_REACT_TRACKS=1` measures how much of a dev-mode stall is React's own instrumentation. Bodies: `probe-loading.js`, `probe-loading-refresh.js`. Pipe it through `summarize-loading-probe.mjs`. |
| `probe-*.js` | The probe bodies those harnesses execute (`probe-kmp-mode-ui.js`, `probe-camera-ui.js`, `probe-model-mode-ui.js`, `probe-visual-ui.js`, `probe-material-ui.js`, and the older single-feature ones). |
| `build-*.mjs` | The asset-database builders that generate what lives under `public/data/`. |

## Tests

Unit tests sit next to what they cover. The ones that matter most:

| File | Covers |
| --- | --- |
| `src/lib/kmpFile.test.ts`, `kmpGraph.test.ts`, `kmpGraphEdit.test.ts`, `kmpValidation.test.ts` | The KMP model, its graph edits and every validation rule. |
| `src/lib/kmpEditRoundTrip.test.ts` | Insert/split/link/renumber/respawn edits over all 338 real tracks: byte-stable untouched, byte- and model-stable after editing, no new validation errors. |
| `src/lib/batch/trackPipelineCheck.test.ts` | The fast subset of the whole-pipeline batch check (three custom + three retail tracks, every mode's edit, exported and re-opened). |
| `src/lib/trackLoadErrors.test.ts` | What the editor does with a file it cannot use: empty, too small, wrong format, an impossible compression header, a truncated stream, a corrupt file table, and the partial cases (no layout data, unreadable model or collision mesh) that must load with a warning rather than fail. |
| `src/lib/trackExport.test.ts`, `formats.test.ts` | U8/Yaz0 round trips and the export path. |
| `src/lib/meshExport.test.ts`, `meshEdits.test.ts`, `brres/*.test.ts` | The BRRES writer, end to end and per layer. `brres/resDic.test.ts` proves every rebuilt name tree resolves under the console-side lookup. |
| `src/ui/visual/visualExport.test.ts` | A texture replacement and a fog edit applied to real tracks, exported, re-read and re-parsed. |
| `src/ui/objects/objectProfiles.test.tsx`, `src/ui/inspector/Inspector.test.tsx`, `src/ui/labels.test.ts` | That every object has a usable inspector and that no raw section code reaches the user. |
| `src/ui/studio/studioDocument.test.ts` | What the Model Studio opens and exports: an untouched `.brres` / `.u8` / `.szs` comes back byte for byte, and an edited archive still reproduces every file it did not touch. |
| `src/ui/studio/animationTransport.test.ts`, `studioOutlinerModel.test.ts`, `studioRecent.test.ts` | The studio's transport maths, its outliner tree and search, and its recent-files list. |
