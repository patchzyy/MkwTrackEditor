# MKW Track Editor – completion work plan

This document is the shared brief for every engineer/agent working on the project.
Read it fully before touching code.

## What this project is

A browser-based Mario Kart Wii track editor. React + TypeScript + Vite. The 3D
viewport is noclip.website's Mario Kart Wii renderer, vendored and edited in-tree at
`vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`. Editor logic lives in
`src/`. The original product brief is `Prompt.txt` (read it once).

Real test tracks (Yaz0 `.szs` archives):

- Custom tracks: `D:\Games\Wii\Dolphin-2\RR\RetroRewind6\CT\Tracks\Z*.szs` (128 tracks)
- Nintendo tracks: `C:\Users\patchzy\AppData\Roaming\Dolphin Emulator\Load\Riivolution\WheelWizard\RRBeta\Tracks\*.szs`
- A few copies are in `public/dev-tracks/` (gitignored) so the dev server can serve them:
  `Z0.szs`, `Z10.szs`, `Z101.szs`, `nintendo_1.szs`.
  Load one in the browser with `http://127.0.0.1:<port>/?smokeTrack=/dev-tracks/Z0.szs`.
  (`smokeTrack` currently also enables "smoke mode" test behaviour; a plain `?track=` param
  that loads without smoke behaviour is a wanted improvement.)

Bundled game data: `public/data/MarioKartWii/Race/Common.szs` (object models + `ObjFlow.bin`),
`public/data/MarioKartWii/Race/Course/ExtractedAssets.u8`, `course-asset-db.json`.

Reference behaviour: Lorenzi's KMP Editor (https://github.com/hlorenzi/kmp-editor) for KMP
semantics, path graphs, KCL raycast, save rules. BrawlCrate for BRRES/MDL0 structure.
Wiki: https://wiki.tockdom.com/wiki/KMP, /wiki/KCL, /wiki/MDL0, /wiki/BRRES.

## State of the code at the start of this effort (2026-09-02)

- `src/ui/App.tsx` is ~9000 lines and holds almost all UI, state, history, inspectors,
  content browser, object profiles. It must be split into modules.
- `src/ui/Noclip3DViewport.tsx` (~3200 lines): viewport, picking, gizmos, drag/drop, camera controls.
- `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts` (~3700 lines): renderer,
  editor overlays (points/lines/gizmo/collision/areas/checkpoints), GOBJ spawning, route motion.
- Only ~80 of the ~870 vendored noclip files are actually imported. The rest is dead weight.
- `npx tsc --noEmit` has 77 errors in `src/` and 245 in `vendor/`. `vite build` succeeds. `vitest` passes.
- Four "editor modes" exist in the top bar: Model / Visual / KMP / Camera. Only KMP really
  works. Model mode can select MDL0 bones (nodes) from a list but has no useful viewport
  interaction. Visual mode shows the same thing as KMP mode. Camera mode does nothing.
- Content browser thumbnails are drawn by a crude CPU rasterizer in `src/lib/noclipBrres.ts`
  and look like grey blobs. They must be rendered with the real noclip renderer.
- There is no CLAUDE.md. The GitHub Pages workflow in `.github/workflows` builds with vite.

## Target product

A track editor a Mario Kart Wii custom-track author would actually use:

1. Drop an `.szs`, see it rendered exactly like noclip.
2. **KMP mode**: everything Lorenzi's KMP Editor can do, in the 3D viewport, with a nicer UI.
3. **Model mode**: click on track geometry in the viewport and select the polygon group /
   mesh (MDL0 shape + draw-op) or bone under the cursor; move/rotate/scale/hide/delete it;
   duplicate it; import an object BRRES from the content browser as a new mesh in
   `course_model.brres`. Selection in the viewport must be "smart": click picks the smallest
   sensible unit (a single tree, a single lamp post), with a way to widen to the whole bone/
   shape. Changes are written back into the BRRES on export.
4. **Visual mode**: the non-KMP look of the track: materials, textures, texture/color/visibility
   animations (SRT0/PAT0/CLR0/CHR0/VIS0), post-effects (fog, bloom, DOF, blight), lighting,
   vrcorn skybox, with a preview + editing UI. KMP overlays hidden.
5. **Camera mode**: CAME editing like Lorenzi's KMP editor and better: camera list, per-camera
   inspector with friendly labels, camera position/target/route handles in the viewport,
   opening-camera chain, in-viewport "play" preview through the camera, replay cameras.
6. Export a valid playable `.szs`, with validation warnings before export.
7. Polished dark 3D-editor UI (think Unreal/Blender/Unity): collapsible dock panels,
   consistent spacing and iconography, no debug jargon shown to the user.

## Ground rules

- Renderer stays noclip. No three.js, no second renderer. Viewport handles are drawn in
  the noclip scene, not as DOM overlays.
- Keep `npx tsc --noEmit -p tsconfig.json` clean for the files you own and don't introduce new
  errors elsewhere. Keep `npx vitest run` green. Add tests for pure logic you add in `src/lib`.
- Keep `npx vite build` working.
- Don't leave TODO stubs or fake data in the product path. If something can't be finished,
  say so in your report.
- No new npm dependencies unless truly needed; explain in the report if you add one.
- Small, named, single-purpose modules. New UI code goes under `src/ui/<area>/`. New pure
  logic goes under `src/lib/`.
- User-facing text: friendly words, not section codes. ("Enemy route", not "ENPH").
- Windows host. Shell is Git Bash. Node 24. Browser for testing: Microsoft Edge at
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` (there is no Chrome).
- Use the in-session browser preview tools (`preview_open`, `preview_snapshot`,
  `preview_evaluate`, etc.) when available to look at what you built. Run vite with
  `npx vite --host 127.0.0.1 --port <your port> --strictPort`.
- The team works in parallel in separate git worktrees. Stay inside your file ownership;
  if you must change a file you don't own, keep it minimal and additive and call it out in
  your report so the orchestrator can merge.

## Reporting

End your work with a report that lists: what was completed, what was verified and how
(commands, browser checks), what is not done, files touched, and any wiring the
orchestrator has to do in files you did not own.

## Progress log

- 2026-09-02 wave 1 merged: App.tsx split into modules (`docs/ARCHITECTURE.md`); vendor trimmed
  874→73 files; typecheck clean; real-renderer thumbnails (`src/lib/thumbnail`); data layer
  audited (kmpFile/kmpGraph/kmpValidation/kclRaycast, byte-exact on 338 tracks); renderer camera
  gizmos + preview playback and mesh picking/per-mesh transforms (`docs/viewport-api.md`).
- 2026-09-02 mode scaffold: each mode is a hook in `src/ui/{kmp,camera,model,visual}/` returning a
  `ModeUi` (`src/ui/modes/types.ts`); `App.tsx` composes them. Default mode is KMP.
- Wave 2 (in progress): F camera UI, G model UI + BRRES writer, H visual mode, J KMP parity,
  K UI redesign (design system in `src/ui/components`, `docs/UI.md`).

### Agent F — Camera (CAME) mode (wave 2)

Camera mode is complete and works on real tracks. Shipped:

- **Camera outliner** (`src/ui/camera/CameraOutliner.tsx`): every CAME entry with a per-family
  icon, a friendly type name, and badges for opening/selection order, the areas that trigger it
  and its movement path. Filter box; add / duplicate / delete / reorder; "set as opening start"
  and "set as selection-screen start".
- **Chain editors** (`ChainEditor.tsx`): the opening pan and the character-select pan as
  drag-reorderable lists with per-shot durations and a running total, plus a play button.
  Editing a chain rewrites the `nextCam` links and the CAME header's first camera.
- **Friendly inspector** (`CameraInspector.tsx`, `CameraFields.tsx`, `cameraFieldMeta.ts`): every
  CAME field under a plain-language label with a one-line hint, irrelevant fields hidden per
  camera type, duration in both frames and seconds, and X/Y/Z-labelled full-width vector rows.
  Shared with the KMP-mode camera section so a camera reads the same everywhere.
- **Viewport handles**: camera position via the normal gizmo, the two look-at points via
  draggable handles, and the camera's route via the existing POTI points. Camera mode also turns
  the racing-line overlays off so the camera gizmos are actually visible.
- **Playback** (`CameraPlaybackControls.tsx`): play/pause/stop/loop and a scrubber that flies the
  real viewport camera through a shot or the whole opening chain; Escape stops and restores the
  free camera.
- **Replay cameras**: types 0-3 are first-class in the type picker and the outliner shows which
  AREA triggers each one.

Verified with `npx tsc --noEmit -p tsconfig.json` (clean), `npx vitest run` (359 passed),
`npx vite build` (ok), and browser probes against `nintendo_1.szs` and `Z0.szs`
(`scripts/camera-ui-probe.mjs` with `scripts/probe-camera-ui.js` and
`scripts/probe-camera-handle-drag.js`). Screenshots: `docs/screenshots/camera-mode-*.png`.

### Model mode — complete (agent G)

Model mode does what section 3 asks for. Clicking track geometry in the viewport selects the
smallest sensible piece (a connected component of a shape); `]` / `[` widen and narrow that to the
whole mesh or the whole bone, and the inspector has the same control in words. The selection can be
moved, rotated, scaled, hidden, deleted, restored and duplicated, from the gizmo or from numeric
fields, and an object model can be placed into the track as scenery. All of it is baked into
`course_model.brres` on export.

The interesting part was the writer. Three properties of the format each cost a bug:

- A pointer from one block to another (a resource dictionary to its data, a material to its TEV
  shader) is read back **unsigned**, so the target has to sit after the pointer. Appending a grown
  dictionary table past the blocks it indexes produced negative offsets that noclip's parser
  rejected. Dictionaries are now re-emitted into a gap opened in front of the first block.
- Readers over-read the tail of a block on purpose — a fixed-size material display list, four bytes
  past a vertex array — which the next block normally covers. An edited model keeps slack behind
  the last block it appended.
- New textures have to be slotted into the layout ahead of the animation sub-files (SRT0/CLR0/PAT0),
  whose internal name pointers this editor does not model, so those keep their distance to the
  string pool.

Verified with `npx tsc --noEmit`, `npx vitest run` (401 tests), `npx vite build`, and a scripted
browser pass over `Z0.szs` and `nintendo_1.szs` (`scripts/probe-model-ui.mjs` +
`scripts/probe-model-mode-ui.js`, screenshots in `docs/screenshots/model-ui-*.png` and
`model-nintendo-*.png`). An unedited track still exports byte-for-byte identically.

Known gap: a mesh whose vertices are shared between two connected components moves its neighbours
too. The exporter detects this and warns rather than silently corrupting the shape; splitting the
vertex data per component would be the fix.

### Agent H — Visual mode (wave 2)

Visual mode is no longer a placeholder: it is the non-KMP *look* of the track, with every KMP
overlay hidden (`showKmpEditorOverlay: false`). Shipped:

- **Archive browser** (`src/ui/visual/VisualOutliner.tsx`, `visualArchive.ts`): every `.brres` in
  the track, course first, then skybox, minimap and object archives. For the selected archive:
  its MDL0 models (with per-archive show/hide), its materials, its TEX0 textures and its
  animations, all parsed with the vendored noclip parser so the numbers match what is rendered.
- **Texture previews and replacement** (`TexturePreview.tsx`, `TextureInspector.tsx`,
  `textureReplace.ts`, `src/lib/tex0Codec.ts`, `src/lib/tex0Brres.ts`): every TEX0 is decoded with
  noclip's own GX decoder onto an alpha checkerboard. Importing a PNG/JPG re-encodes it to the
  texture's own GX format (I4/I8/IA4/IA8/RGB565/RGB5A3/RGBA8/CMPR) with a generated mip chain,
  patches it into the BRRES in place, pushes it at the live renderer and exports with the track.
  Textures can also be exported back out as PNG.
- **Material inspector**: blend mode, cull mode, alpha test, depth write, TEV/texgen/indirect
  stage counts, light set and fog index, plus the textures the material samples (click-through
  both ways between materials and textures).
- **Animations**: every SRT0/PAT0/CLR0/CHR0/VIS0 (and SCN0, listed but unplayable) with a
  per-animation play/stop toggle and a transport that pauses and scrubs the shared animation clock
  to an exact frame without freezing the free camera.
- **Render toggles and presets** (`VisualRenderOverlay.tsx`): Game look / Flat / Wireframe, and
  the individual textures / vertex colours / lighting / bloom / DOF / skybox / objects / wireframe
  toggles behind them, greyed out when the track has no such resource.
- **Post effects**: the existing `PostEffectsPanel` is now reachable from Visual mode, and edits to
  `posteffect.bblm`, `posteffect.bdof` and `posteffect.blight` are re-applied to the live scene
  without a reload (`applyEditorPostEffectFile`).

**Not done, deliberately:** course fog is *editable and exported* but not *previewed*. A
screen-space `EggDrawPathFog` was written and then removed: its render-graph pass wiped the main
colour target to black in every mode, and rendering GX fog properly means filling the material
`FogBlock` inside `vendor/.../rres/render.ts`, which another mode owns. The post-effects panel says
so in the UI.

Verified with `npx tsc --noEmit -p tsconfig.json` (clean), `npx vitest run` (429 passed, up from
359 on main), `npx vite build` (ok), and a browser probe against `nintendo_1.szs`
(`scripts/camera-ui-probe.mjs` with `scripts/probe-visual-ui.js`). Export correctness is proved by
`src/ui/visual/visualExport.test.ts`, which replaces a texture and edits the fog table on four real
tracks, exports the `.szs`, re-reads it and re-parses the BRRES.
Screenshots: `docs/screenshots/visual-mode-*.png`.

### KMP mode — complete (agent J)

KMP mode is now a real track-data editor rather than a property sheet bolted to a picker.

- **Outliner** (`src/ui/kmp/KmpOutliner.tsx`): the whole track as a tree of sections, groups and
  points, with friendly names only — the twelve headings are "Start points", "Enemy routes",
  "Checkpoints", "Track settings" and so on, never `KTPT`/`ENPH`/`STGI`. Search, expand/collapse,
  per-section eye toggles wired to the same visibility state the viewport uses, group colour dots,
  validation badges that roll up from a point to its group and section, click to select a whole
  group, ctrl-click to add, shift-click for a range, double-click to frame.
- **Tool inspector** (`KmpInspector.tsx`): the buttons that apply to what is selected. Path graphs
  get insert before/after, delete point, split, join, reverse group, reverse path, delete group and
  a prev/next connection editor that respects the six-link limit. Checkpoints get finish
  line/key/ordinary, key renumbering in driving order, nearest-respawn assignment and "new respawn
  here". Routes get append and reverse. A multi-selection gets batch move and batch object-type
  replacement. Everything is one undo step.
- **Viewport gestures** (`KmpToolsOverlay.tsx`): drag a group's end handle onto another group to
  connect it, or onto a group it already leads to, to disconnect it; drag across the track to draw
  a checkpoint; group colours and the checkpoint corridor as overlay switches. F frames, H hides
  the selection's layer, the numpad switches views.
- **Validation** is in the mode's own panel, each message clickable to select and frame the record
  it is about, with a one-click repair where one exists (drop a broken route or camera link, show a
  hidden object, create a route, assign respawns, renumber key checkpoints).

Three real bugs came out of it. `writePathGraph` left a group record's six link slots unpadded, so
an edited `KmpFile` no longer matched a parsed one and the UI printed the 0xFF null slots as
"group 256". Path-graph validation issues carried an entity id (`ENPH-2`) that no entity has, so
they could never select anything. And every message numbered records from 0 while the UI numbered
them from 1 — the whole app is 1-based now. Two gaps were filled: the start point's player index
had no editor at all, and the track settings were an unlabelled row of raw bytes.

Verified with `npx tsc --noEmit -p tsconfig.json` (clean), `npx vitest run` (505 passed, 1
skipped), `npx vite build` (ok), a new round-trip test that drives insert/split/link/renumber/
respawn edits over all 338 real tracks on this machine (`src/lib/kmpEditRoundTrip.test.ts`:
byte-stable untouched, byte- and model-stable after editing, no new validation errors), and a
browser pass over `Z0.szs` and `Z13.szs` (`scripts/kmp-ui-probe.mjs` +
`scripts/probe-kmp-mode-ui.js`). Screenshots: `docs/screenshots/kmp-ui-*.png`.

Validator tuning done at the same time, measured against the 336 real tracks with checkpoints
that are installed on this machine (316 now report no errors at all):

- "Only one lap counter" and "no repeated key checkpoint" both fired on every track that splits
  into parallel routes, which is exactly where repeating a key number is correct. Both rules now
  ask whether a driver would cross the two copies on the *same* run — reachability along `next`
  links, stopping at the group the lap starts in, because a checkpoint path is a loop and plain
  reachability says everything reaches everything.
- A gap in the key numbering is a warning, not an error; ported tracks ship gaps and still count
  laps.
- The character-selection camera index in the CAME header is a warning: a course KMP never drives
  that screen and ports routinely leave a stale value there.
- A camera type that does not travel along a route no longer has its route field checked. Retail
  Bowser's Castle stores 251 in that field on a stationary camera, which the game ignores.

### Agent K — UI redesign and content browser (wave 2)

Section 7 is done: the editor is one dark 3D-editor shell instead of a pile of ad-hoc panels.

- **Design system** (`src/ui/components/`, documented in `docs/UI.md`): tokens for colour,
  spacing, radius, type, elevation, control metrics and motion, plus Panel/PanelHeader/
  PanelSection/PanelRail, Toolbar, Button/IconButton/ToolButton, SegmentedControl, Tabs,
  Field/FieldRow/FieldGroup, NumberInput, VectorInput, Select, Toggle, ColorField, TreeView,
  Tooltip/Kbd, MenuSurface/ContextMenu, Popover, Toast, StatusBar, EmptyState/Skeleton,
  ShortcutOverlay, LoadingOverlay, AxisGizmo. The maths behind the fiddly ones is pure and
  unit tested: `numberScrub.ts` (drag-to-scrub, key stepping, parsing), `treeModel.ts`
  (flatten, virtualisation window, the ARIA keyboard model), `statusMessage.ts` (severity,
  summary/detail split, which messages deserve a toast).
- **Dockable shell**: left, right and bottom docks resize by dragging, reset on double-click,
  collapse to a labelled icon rail that keeps its grid slot (so nothing reflows), and persist
  size + collapse state (`usePanelLayout`, `mkw.editor.layout.v2`). New top bar with a File
  menu (open, import Common.szs, export, recent tracks), the mode switch, dock toggles and
  Export. The old free-text status line in the header became a real status bar (severity icon,
  message, record/route/issue/FPS stats) plus a toast stack for failures and finished
  imports/exports. `?` opens a keyboard-shortcut sheet.
- **Content browser finished**: folder *tree* (Game Objects / Track Data / This Track), search,
  a tile grid with an adjustable tile size, and a details pane that names the asset, its object
  id in hex and decimal, which of its models are loaded, and its shapes/textures/animations.
  `browserEntries.ts` is the one record the grid, the keyboard navigation and the details pane
  all read. Drag-to-place still works for both objects and track-data points.
- **Thumbnails fixed** — the user's named complaint. Wave 1's real-renderer pipeline was
  working, but the 128x128 renders were `object-fit: contain`-ed into a 2:1 tile slot and the
  renderer's clear colour did not match the slot, so every tile had two grey bars: the "broken
  meshes" look. Tile slots are now square and `DEFAULT_BACKGROUND` is exactly `--surface-input`.
  The loaded track's own archives now show their previews too instead of a generic icon.
  Measured in the browser: of 24 sampled tiles on `Z0.szs`, 24 decode to a drawn, multi-colour
  image (73–1884 distinct colours); 201 of 221 shared-object tiles have a real render.
- **Modes restyled onto the tokens**: `camera.css`, `model.css` and `visual.css` went from 132
  raw colour literals and zero `var(--…)` to 3 literals and 316 token references, with an
  empty selector-set diff so every probe hook survived. The left dock's default width went
  232px → 272px because the camera/model/visual outliners were being clipped at 232.
- **Removed**: the "Model Nodes" content-browser folder (model mode's outliner supersedes it,
  per agent G), the dead archive-node inspector block, `CourseAssetThumbnail`, and the dead
  `.status`, `.dockRail*`, `.quickObjects*` and `.previewId` CSS.

Verified with `npx tsc --noEmit -p tsconfig.json` (clean), `npx vitest run` (573 passed / 1
skipped, up from 502), `npx vite build` (ok), and real-browser probes on `Z0.szs`, `Z10.szs`
and a Nintendo track at 1600x1000 and 1280x800 (`scripts/ui-shell-probe.mjs` with
`scripts/probe-ui-shell.js`, `probe-thumbnails.js`, `probe-browser-drag.js`). Every other
agent's probe was re-run green against the restyled build: `probe-camera-ui.js`,
`probe-camera-handle-drag.js`, `probe-model-mode-ui.js`, `probe-visual-ui.js`,
`probe-kmp-regression.js`.

Two probe selectors were updated because the redesign deliberately renamed the hook: `.status`
→ `.uiStatusMessage` and `.button.primary` → `.topBarRight .uiButton--primary` in
`probe-visual-ui.js`, and `input[type="number"]` now also accepts `input[role="spinbutton"]`
(the shared `NumberInput` is a text input with `role="spinbutton"` so it can support
drag-to-scrub and a comma decimal separator).

**Not done:** `src/ui/kmp/**` still uses the pre-redesign markup — agent J was rewriting it in
parallel, so it was left alone by agreement. It already *looks* right (its shell classes are
tokenised); `docs/UI.md` §5 lists exactly what a later pass has to do to move it onto the
primitives. `npm run smoke:browser` still cannot pass on this host: it runs headless Edge,
which only gets SwiftShader, and noclip refuses to start there — its non-WebGL checks
(`hasInspectorToggle`, `hasContentBrowserToggle`, `hasObjectThumbnailImage`) do pass.
