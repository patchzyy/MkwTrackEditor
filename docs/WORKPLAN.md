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
