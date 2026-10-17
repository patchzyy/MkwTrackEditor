# Viewport API

Contract between the app (`src/ui/App.tsx` and whatever replaces it) and
`src/ui/Noclip3DViewport.tsx`, plus the editor methods the vendored noclip Mario Kart Wii
scene exposes.

Everything listed under "New props" is optional and defaults to today's behaviour, so the
current `App.tsx` keeps compiling unchanged. Nothing was removed or renamed.

---

## 1. New viewport props and callbacks

### Editor mode

| Prop | Type | Default | What it does |
| --- | --- | --- | --- |
| `mode` | `'kmp' \| 'camera' \| 'model' \| 'visual'` | `'kmp'` | The editor mode. `'kmp'` is exactly today's behaviour (CAME entries stay lightweight point markers). `'camera'` adds the full CAME gizmos and their picking. `'model'` turns on mesh picking/transforming and hides the KMP overlays. `'visual'` hides the KMP overlays. |

`showKmpEditorOverlay` still works; `mode` is ANDed with it, so KMP overlays are hidden when
either `showKmpEditorOverlay === false` or `mode` is `'model'` / `'visual'`.

Wire it up as `mode={editorMode}` (the app's existing `EditorModeStub` values match exactly).
`EditorModeStub` also has `'material'`, which the app maps to `'visual'` for the viewport: Material
mode wants the same "no KMP overlays, plain game look" viewport that Visual mode has.

### Camera (CAME) mode

| Prop | Type | Default | What it does |
| --- | --- | --- | --- |
| `cameraPreview` | `{ cameraId: string; playing: boolean; time: number; sequence?: boolean } \| null` | `null` | Drives in-viewport camera playback. `cameraId` is a CAME entity id (`"CAME-3"`). `time` is in MKW frames (60 fps) and is used when `playing` is `false`; when `playing` is `true` the viewport advances its own clock. `sequence: true` chains through the opening cameras starting at `cameraId`. Setting it back to `null` restores the previous free camera and controller. |
| `onCameraPreviewEnd` | `() => void` | – | Fired when a playing preview runs past the camera's `time` (or past the end of the opening chain). The app should set `cameraPreview` back to `null`. |
| `onMoveCameraViewPoint` | `(entity: KmpEntity, which: 'start' \| 'end', position: Vec3) => void` | – | A CAME view-point handle was dragged. Apply with `patchKmpCameraViewPosition(document, entity, which, position)` from `src/lib/kmp.ts`. |

While a preview is playing the fly controls are disabled (a no-op `CameraController` is
installed) and the previous controller + camera pose + FOV are restored when it stops.

### Model mode (per-mesh editing)

| Prop | Type | Default | What it does |
| --- | --- | --- | --- |
| `meshGranularity` | `'component' \| 'shape' \| 'node'` | uncontrolled, starts at `'component'` | How much geometry one click selects. If you pass it, the viewport is controlled; if you omit it, the viewport keeps its own state and only reports changes. |
| `meshEdits` | `MeshEdit[]` | – | Mesh edits stored in the track document; re-applied to the renderer whenever the scene reloads. |
| `onSelectMesh` | `(target: EditorMeshTarget \| null, options?: { additive?: boolean; targets?: EditorMeshTarget[] }) => void` | – | Selection changed. `target` is the last-clicked mesh (or `null`), `options.targets` is the full selection. |
| `onTransformMesh` | `(target: EditorMeshTarget, transform: MeshTransform) => void` | – | The gizmo moved/rotated/scaled a mesh. `transform` is relative to the mesh's untransformed bounding-box centre, in KMP/game units and degrees. Store it with `upsertMeshEdit` from `src/lib/brresEditor.ts`. |
| `onChangeMeshGranularity` | `(granularity: MeshSelectionGranularity) => void` | – | The user pressed `]` (widen) or `[` (narrow). |

Model-mode keyboard shortcuts handled inside the viewport:

- `]` widen selection: component → shape → node
- `[` narrow selection: node → shape → component
- `F` frame the camera on the current mesh selection

Mouse: hover highlights the mesh under the cursor, click selects it, shift/ctrl-click adds
to or removes from the selection, and the translate/rotate/scale gizmo attaches to the
selected mesh's bounding-box centre.

### Visual mode (materials, textures, animations, post effects)

| Prop | Type | Default | What it does |
| --- | --- | --- | --- |
| `onVisualSceneChange` | `(scene: VisualRendererScene \| null) => void` | – | Handed the loaded Mario Kart Wii renderer so Visual mode can drive its material/texture/animation methods, and `null` when the scene goes away. Fired after every scene (re)load *and* as soon as the callback itself appears, because Visual mode is usually switched on long after the track finished loading. Held in a ref inside the viewport, so a new callback identity never re-runs the scene load. |

`VisualRendererScene` is declared structurally in `src/ui/visual/visualScene.ts` — like
`EditorMeshRendererScene`, every member is optional, so `src/ui` never imports vendored types.

### Types re-exported by the viewport

```ts
export type EditorMode = 'kmp' | 'camera' | 'model' | 'visual';
export interface CameraPreviewRequest { cameraId: string; playing: boolean; time: number; sequence?: boolean }
export type { MeshSelectionGranularity, EditorMeshTarget } from '../lib/brresEditor';
```

---

## 2. Document model added to `src/lib/brresEditor.ts`

```ts
type MeshSelectionGranularity = 'component' | 'shape' | 'node';

interface EditorMeshTarget {
  archivePath: string;      // './course_model.brres'
  modelName: string;        // 'course'
  shapeIndex: number;       // MDL0 shape index
  drawOpIndex: number;      // index into [DrawOpa..., DrawXlu...]
  componentIndex: number | null;  // connected component inside the shape
  nodeId: number;
  granularity: MeshSelectionGranularity;
}

interface MeshTransform { translation: Vec3; rotation: Vec3; scale: Vec3 }   // game units / degrees
interface MeshEdit { target: EditorMeshTarget; transform: MeshTransform; visible: boolean; deleted: boolean }
interface ImportedMesh { id: string; sourcePath: string; modelName: string; transform: MeshTransform; visible: boolean }
```

Helpers: `meshTargetKey`, `meshTargetEquals`, `widenMeshGranularity`,
`narrowMeshGranularity`, `retargetMeshGranularity`, `findMeshEdit`, `upsertMeshEdit`,
`removeMeshEdit`, `isNeutralMeshEdit`, `createIdentityMeshTransform`, `addImportedMesh`,
`removeImportedMesh`, `updateImportedMesh`.

The track document should carry `meshEdits: MeshEdit[]` and `importedMeshes: ImportedMesh[]`;
the BRRES writer will bake them into `course_model.brres` on export.

---

## 3. Renderer methods (`MarioKartWiiRenderer`)

All of these are reachable from the viewport as `sceneRef.current`.

### Mode and overlays

| Method | Purpose |
| --- | --- |
| `setEditorMode(mode: 'kmp' \| 'camera' \| 'model' \| 'visual')` | Which overlays to draw. |
| `getEditorMode()` | Current mode. |
| `setEditorOverlayData(data)` | Existing call; `data` now also accepts `cameraGizmos` and `cameraChainLinks`. |
| `pickEditorHandle(nx, ny)` | Existing call; can now also return `{ kind: 'cameraViewPoint', id, which }` when in camera mode. |

`EditorOverlayCameraGizmo` fields: `id`, `index`, `type`, `position`, `rotation`,
`viewStart`, `viewEnd`, `zoomStart`, `zoomEnd`, `routePoints[]`, `routeIndex`, `selected`,
`hovered`, `label`, `openingOrder`.
`EditorOverlayCameraChainLink` fields: `from`, `to`, `order`.

### Visual mode: models, animations, render toggles, textures, post effects

| Method | Purpose |
| --- | --- |
| `listEditorSceneModels()` | Every BRRES the scene draws as course geometry, with its MDL0 stats and current visibility. |
| `setEditorSceneModelVisible(archivePath, visible)` | Shows/hides one archive (`./course_model.brres`, `./vrcorn_model.brres`, ...). |
| `setEditorObjectPreviewsVisible(visible)` | Shows/hides every model spawned from the KMP object list. |
| `listEditorAnimations(archivePath)` | Every SRT0/PAT0/CLR0/CHR0/VIS0/SCN0 in a loaded archive, with length, loop mode and whether it is currently bound. SCN0 is reported with `supported: false`. |
| `setEditorAnimationEnabled(archivePath, kind, name, enabled)` | Binds/unbinds one animation. Rebuilds the `MDL0ModelInstance` from the same uploaded `MDL0Model`, because there is no public unbind for CHR0/VIS0. |
| `setEditorAnimationsPlaying(playing)` / `setEditorSceneTimeFrames(frames \| null)` / `getEditorSceneTimeFrames()` | Pause, scrub and read the shared animation clock. The wall time spent paused is subtracted out instead of stopping the viewer, so the free camera keeps working while animations are frozen. |
| `setEditorTexturesEnabled` / `setEditorVertexColorsEnabled` / `setEditorLightingEnabled` / `setEditorBloomEnabled` / `setEditorWireframe` / `setEditorDOFMode` / `setEditorPostProcessingEnabled` | Preview-only render toggles. None of them touch the track files. |
| `getEditorVisualCapabilities()` | `{ bloom, dof, lighting, wireframe }` — which toggles this particular track and device can actually drive. |
| `reloadEditorTexture(name, texture)` | Swaps an already-uploaded TEX0's pixels in place, reusing the `GfxTexture` handle so every material that samples it picks the new pixels up next frame. Requires the same dimensions and format; returns `false` otherwise. |
| `listEditorTextureNames()` | Names in the scene's texture holder. |
| `addEditorTexture(name, texture)` | Uploads a texture the archive did not have before, so an imported PNG is visible immediately. An existing name is routed at `reloadEditorTexture`, which can only replace pixels at the same size and format. |
| `reloadEditorMaterial(archivePath, modelName, materialName, brres)` | Re-parses one material out of edited BRRES bytes and swaps it into every live `MDL0ModelInstance` of that model, without rebuilding the scene. `false` when the scene has not loaded that archive, model or material, or when the bytes do not parse. |
| `applyEditorPostEffectFile(path, data)` | Re-applies an edited `posteffect/*` file without reloading the scene: `.bblm` and `.bdof` rebuild their `EggDrawPath`, `.blight` swaps the `EggLightManager`. Returns `false` for files the renderer does not consume — including `posteffect.bfg`, since this renderer has no course-fog draw path. |

### Mesh picking and editing

| Method | Purpose |
| --- | --- |
| `pickEditorMesh(nx, ny, granularity?)` | Ray/triangle pick. Returns `{ archivePath, modelName, shapeIndex, shapeName, drawOpIndex, componentIndex, nodeId, nodeName, materialName, granularity, hitPoint, distance }` or `null`. `nx`/`ny` are normalized viewport coordinates (0..1, y down). `hitPoint` is in KMP/game units. |
| `pickEditorMeshesInRect(nx0, ny0, nx1, ny1, granularity?)` | Every mesh whose centre projects inside the rectangle. |
| `getEditorMeshComponentBounds(target)` | `{ min, max, center, radius, triangleCount }` in game units, including any live edit. |
| `getEditorMeshComponentCount(target)` | Number of connected components in the target's shape. |
| `setEditorMeshTransform(target, transform)` | Applies an extra transform to that draw call / component. `transform` is `{ kind: 'trs', translation, rotation, scale }` (game units, degrees, pivoting on the mesh centre) or `{ kind: 'matrix', matrix }` (raw scene-space matrix), or `null` to reset. |
| `setEditorMeshVisible(target, visible)` | Hide/show a draw call or a single component. |
| `setEditorMeshHighlight(targets)` | `[{ target, selected }]` — draws depth-tinted wireframe + bounding box through the debug-draw path. |
| `clearEditorMeshEdits()` | Drops every mesh transform/visibility override. |
| `listEditorMeshes()` | All pickable draw calls with shape/material/node names and triangle counts. |
| `refreshEditorMeshSources()` | Rebuilds the picker's source list (call after adding/removing imported models). |
| `setEditorMeshIncludeSkybox(include)` | The `vrcorn` skybox is excluded from picking by default. |
| `getEditorPickRay(nx, ny)` | Diagnostics: the scene-space ray used for picking. |

### Imported meshes

| Method | Purpose |
| --- | --- |
| `addEditorModelInstance(device, brresBuffer, modelName \| null, matrix \| null)` | Renders an imported object BRRES as course geometry (course lighting, opaque layer). Returns an id or `null`. |
| `updateEditorModelInstance(id, matrix)` | Moves it. |
| `setEditorModelInstanceVisible(id, visible)` | Hides it. |
| `removeEditorModelInstance(device, id)` | Removes and destroys it. |
| `listEditorModelInstances()` | Ids of the imported instances. |

---

## 4. Dev hook (`window.__mkwViewport`, `import.meta.env.DEV` only)

Available so the new features can be driven before the app wires them up:

```ts
setMode(mode | null)                       // null clears the dev override
getMode()
pickMeshAt(clientX, clientY)
selectMeshAt(clientX, clientY, additive?)
getSelectedMesh()
setMeshGranularity(granularity)
transformMesh(target, transform | null)
setMeshVisible(target, visible)
listMeshes()
getMeshBounds(target)
frameMeshSelection()
pickRay(clientX, clientY)
addImportedMesh(brres, modelName | null, { position?, rotation?, scale? })
removeImportedMesh(id)
listImportedMeshes()
previewCamera(cameraIdOrIndex, { play?, time?, sequence? })
stopCameraPreview()
playOpeningSequence()
getCameraOverlay()
getCameras()
captureFrame()                             // PNG data URL of the next rendered frame
```

`scripts/viewport-dev-probe.mjs <url> <scriptFile>` drives this hook in a dedicated Edge
instance and writes screenshots to `docs/screenshots/`. Probe bodies live next to it
(`scripts/probe-model-mode.js`, `scripts/probe-camera-mode.js`, `scripts/probe-import-mesh.js`).
Headless Edge cannot run noclip (SwiftShader lacks the required WebGL2 features), so the
harness opens a real window parked off-screen.

---

## 5. CAME semantics used by the preview

From <https://wiki.tockdom.com/wiki/KMP_Editing/Cameras>:

- `time` is in frames (60 fps).
- `vCam` / `vZoom` / `vView` are **units per 100 frames**, so the per-frame rate is `v / 100`.
- POTI route point speeds are **units per frame**; a routed camera moves at the route's speeds
  and falls back to `vCam / 100` when a point's speed is 0.
- The view point starts at `viewStart` and slides to `viewEnd` at `vView / 100` units per
  frame, then stops. The field of view goes from `zoomStart` to `zoomEnd` at `vZoom / 100`
  degrees per frame, then stops.
- The opening pan starts at the camera named in the CAME section header (`firstIntroCam`,
  read with `getKmpCameraHeader`) and follows `nextCam` until `0xFF`.
- Camera types: 0 Goal, 1 FixSearch, 2 PathSearch, 3 KartFollow, 4 KartPathFollow,
  5 OP_FixMoveAt, 6 OP_PathMoveAt, 7 MiniGame, 8 MissionSuccess, 9 Unknown.
  Types 4/5/6 are the opening pans and are fully previewable; 0/1/2/3 track the player at
  runtime, so their preview shows a static pose looking at the view start (a routed type 2
  still walks its route).

Pure implementations live in `src/lib/cameraPreview.ts` (interpolation + chain) and
`src/ui/viewport/cameraOverlay.ts` (KMP → overlay), both unit tested.

---

## 6. Model mode, as finished (agent G)

### Extra viewport props

| Prop | Type | What it does |
| --- | --- | --- |
| `meshSelection` | `EditorMeshTarget[]` | Makes the mesh selection controlled. Pass it and the outliner can drive what the viewport has selected; omit it and the viewport keeps its own. Clicks in the viewport still report through `onSelectMesh` either way. |
| `importedMeshes` | `ImportedMesh[]` | Objects placed as course geometry. Ones with a `sourceShape` are drawn as duplicates of that mesh; the rest are loaded as extra model instances. |
| `resolveImportedMeshSource` | `(sourcePath: string) => Uint8Array \| null` | Supplies the BRRES bytes behind an imported mesh. |

`meshEdits` now **resets** as well as applies: an edit that disappears from the array (undo, or the
inspector's Restore) puts its mesh back where it started, and the selection's stored transform is
refreshed so the gizmo follows.

### Extra renderer method

| Method | Purpose |
| --- | --- |
| `setEditorMeshCopies(target, transforms)` | Replaces the duplicates of a mesh. Each transform is a game-unit TRS pivoting on the target's centre — the same convention as `setEditorMeshTransform` — and draws one more copy of the same geometry. Copies survive the original being hidden, so "duplicate it, then delete the original" works. Costs one draw call and no extra vertex data. |

Underneath, `ShapeInstanceEditorOverride` in `vendor/noclip.website/src/rres/render.ts` gained a
`copyDraws` array, and `EditorMeshPicker` gained `setCopies`.

### Document model

`TrackDocument` now carries the Model-mode edits, so history and export both see them:

```ts
meshEdits?: MeshEdit[];
importedMeshes?: ImportedMesh[];
/** BRRES bytes per `ImportedMesh.sourcePath`, so export stays synchronous. */
meshImportSources?: Record<string, Uint8Array>;
```

`ImportedMesh.sourceShape` is now a full `EditorMeshTarget` (it was a partial one), because both the
exporter and the renderer need to resolve it back to a draw call.

`exportTrack` bakes them through `bakeMeshEdits` → `bakeCourseModel`. With no edits the entry list
and its byte arrays come back untouched, so an unedited track still exports byte-for-byte.

### Reading the model without the renderer

`src/lib/brres/courseMeshes.ts` lists a course model's draw calls straight from the BRRES —
`listCourseMeshes`, `describeCourseMesh`, `courseMeshTarget`, `courseMeshCenter`. The outliner uses
it so it works before the scene has loaded, and its `drawOpIndex` numbering is asserted to match
what the picker reports.

---

## 7. Removed: the BRRES-node transform path

Before Model mode was finished, a gizmo could target an MDL0 **bone** as well as a mesh:
`ViewportTransformSelection.rendererTarget` had a `{ kind: 'brresNode', archivePath, modelName,
nodeId }` variant, `buildBrresViewportBridge` / `toSceneNodeViewportTransformSelection(s)` produced
it from the archive-node list, and the renderer moved the bone through
`MarioKartWiiRenderer.updateEditorBrresNodeTransform`.

Per-mesh editing superseded all of it. Nothing in the product built a `brresNode` target any more,
so the renderer method was unreachable and only the adapter's own unit test exercised the
functions. The variant, the three functions, `BrresViewportBridgeState` and the renderer method
have been deleted.

`rendererTarget` is now a single shape (`{ kind: 'editorMesh', target, baseCenter }`), which is what
`toMeshViewportTransformSelection` produces and what `syncBrresViewportTransformSelectionPreview`
pushes at `setEditorMeshTransform`. If bone-level editing is ever wanted again, it should come back
as a mesh-style target rather than as a second parallel path.


---

## 8. Material mode: swapping a material without rebuilding the scene

Material mode edits a BRRES material and needs the viewport to show the result immediately. A
`sceneKey` bump would work but is the wrong shape: it re-parses and re-uploads the whole track and
throws the camera away. Instead the renderer replaces just that material.

### Vendored renderer additions

`vendor/noclip.website/src/rres/brres.ts`

```ts
export function parseMaterialEntry(
  buffer: ArrayBufferSlice, modelName: string, materialName: string,
): { entry: MDL0_MaterialEntry, index: number } | null
```

Walks only `root` → `3DModels(NW4R)` → the named MDL0's material resource dictionary and runs the
same (module-private) `parseMDL0_MaterialEntry` the full parser uses, so the result is what
`parse()` would have produced. No display list, vertex array or other material is touched.

`vendor/noclip.website/src/rres/render.ts`

| Member | Purpose |
| --- | --- |
| `MDL0Model.replaceMaterial(device, cache, index, entry)` | New `MaterialData` for that index, re-bound to whatever texture holder / res file the model was loaded against (both are now remembered by `bindTextureHolder` / `bindResFile`). |
| `MDL0ModelInstance.replaceMaterial(index)` | Rebuilds the `MaterialInstance`s for that material and repoints the `ShapeInstance`s that used them. Returns how many were replaced. |
| `MDL0ModelInstance.materialInstanceMatIds` | The MDL0 material index behind `materialInstances[i]`. `materialInstances` is per draw op, not per material, so this is the only exact way to find the instances of one material. |
| `MaterialInstance.sortKeyLayer` / `getFogSettings()` | The state a replacement instance inherits, since neither is derivable from the material. |

A `MaterialInstance` copies the material's `GXMaterial` at construction, so mutating
`mdl0.materials[n]` alone changes nothing on screen — the instance must be rebuilt. Nothing on this
path has a `destroy`: programs and samplers come from the shared `GfxRenderCache`, which owns and
dedupes them, so discarding the old material objects leaks nothing.

### App side

`MaterialRendererScene` in `src/ui/material/materialScene.ts` declares `reloadEditorMaterial` and
`addEditorTexture` structurally on top of `VisualRendererScene`, so `src/ui` still imports no
vendored types. Material mode reuses `onVisualSceneChange` to get hold of the scene.

## 9. Rebuilding the scene from the edited track (`sceneRevision`)

Two additive props on `Noclip3DViewport` implement the **Refresh track** button:

```ts
sceneRevision?: number;                              // bump to rebuild the scene
onSceneReload?: (event: SceneReloadEvent) => void;   // { phase: 'start'|'done'|'failed', message }
```

The scene-load effect's dependency list is `[sceneKey, viewerReady, sceneRevision]`. It rebuilds
from `buildU8(track.archiveEntries)` — the same bytes the initial load uses and the same bytes
Export packs — so every archive the editor rewrote is in the scene. When the scene key is the one
the current scene was already built from, the run is treated as a *rebuild* rather than a new
track:

- the camera controller and `viewer.camera.worldMatrix` are saved and restored around
  `Viewer.setScene`, which drops the controller, so the viewpoint (and the orthographic modes'
  orbit) survive;
- `applyViewMode(track, true)` is skipped — it would frame the track from the start line again —
  and only `setEditorViewMode` is re-applied;
- `onSceneReload` reports `start` / `done` / `failed`, so the shell can show progress and
  re-enable its button.

Either way the viewport bumps an internal `sceneEpoch`, which is in the dependency list of every
effect that mirrors editor state into the renderer (mesh transforms, mesh copies, placed model
instances, depth of field, the editor mode, the dev hook). The three "what is applied to the
scene" maps — `appliedMeshEditsRef`, `appliedMeshCopiesRef`, `importedMeshInstancesRef` — are
cleared whenever a new scene is set, because their contents belonged to the scene that was just
destroyed. `deliverVisualScene` hands the new scene to Visual and Material mode, which re-apply
their render toggles, hidden models, post-effect files and animation state.

The one thing a rebuild does not preserve is the scene's animation clock: a scene is created with
`initialSceneTime: 0`.

---

## 10. Mouse model

The viewport owns the mouse outright. `bootViewer` sets `viewer.inputManager.isMouseEnabled =
false`, because noclip's `InputManager` registers its own `mousedown` on the canvas and hands it to
`GlobalGrabManager.takeGrab(..., { takePointerLock: true })` for **any** button. That is what made
an ordinary click take pointer lock, capture the cursor and turn every mouse movement into a camera
turn. The camera controllers are now driven explicitly from `Noclip3DViewport` instead.

The rules live in `src/ui/viewport/pointerIntent.ts` (pure, unit-tested in `pointerIntent.test.ts`);
the handlers that apply them are in the `//#region Mouse model` block of `Noclip3DViewport.tsx`.

### One gesture at a time

Every `pointerdown` on the canvas:

- calls `preventDefault()`, which suppresses the compatibility `mousedown` — nothing else on the
  page, vendored or not, can react to the press;
- focuses the canvas (keyboard fly needs it focused; `GrabManager` used to do this);
- takes **pointer capture** for that pointer id;
- records exactly one `ViewportGesture`. A second button pressed during a gesture is ignored.

| Gesture | Started by | Ends as |
| --- | --- | --- |
| `select` | left press with nothing draggable under it | a selection if the pointer stayed within `CLICK_SLOP_PX` (4 px), otherwise a camera move |
| `drag` | left press on a gizmo handle, an entity, a checkpoint end, a camera view point, a path-link handle, the checkpoint-draw tool, or a marquee | the edit is committed |
| `camera` | right or middle press | camera only |

There is no `onClick` handler any more. Selection is decided on release, from the coordinates of
the **press**, which is why a drag that ends over the inspector can no longer re-pick (and clear)
the selection at the release point.

### Buttons

The viewport toolbar's **Controls** selector remembers a local preference under
`mkw.viewport.navigation`: **Editor** (the default mapping below), **Blender 2.7**,
or **Blender Modern**. Both Blender presets use turntable navigation around a persistent
view pivot, in the track's Y-up coordinate system. They support these controls:

| Input | Blender presets |
| --- | --- |
| Selection click | Right in 2.7, left in Modern; Shift adds/removes |
| MMB drag | Orbit around the pivot without camera roll |
| Shift + MMB | Pan in screen space, moving the eye and pivot together |
| Ctrl + MMB / wheel | Proportional zoom toward/away from the pivot |
| Numpad 1 / 3 / 7 | Front / right / top orthographic views; Ctrl selects the opposite |
| Numpad 5 | Toggle perspective / orthographic without changing the pivot's apparent scale |
| Numpad 2 / 4 / 6 / 8 | Orbit by 15 degrees; Ctrl or Shift pans |
| Numpad 9 | Opposite view |
| Numpad + / − | Zoom in / out |
| Numpad decimal / F | Frame selection and set the orbit pivot |
| Home | Frame the whole track |

Numpad navigation runs while the viewport is hovered or its canvas is focused, and ignores
form fields, dialogs, camera playback, and playtests. Blender gestures use pointer capture
without pointer lock. Empty-space selection drags do not turn the camera. Gizmos and the
editor's track-authoring tools keep their existing actions; these presets cover viewport
navigation and selection, rather than Blender's modeling commands or 3D cursor.

`BlenderCameraController` extends `FPSCameraController` so the existing frame-selection and
camera-pose API can reuse it. Its update ignores noclip movement keys and wheel state;
the editor explicitly drives orbit, pan and zoom. Framing supplies the target as the pivot.
Playback and playtest retain their own camera controllers and restore the saved controller.

| Input | Perspective view modes (`normal`, `dev`) | Orthographic view modes (`ortho`, `topdown`) |
| --- | --- | --- |
| Left click | select what is under the cursor | same |
| Left drag on empty space | look around | orbit |
| Right drag | first-person look | orbit |
| Middle drag | look | pan |
| Wheel | dolly the free camera (shift = 4x) | zoom, through noclip's own `InputManager.dz` |
| `W A S D Q E`, shift | fly, **while a look gesture is held** — the pre-existing `withSuppressedCameraMovementKeys` rule | – |
| `Escape` during a drag | cancel: the renderer is put back where the document has it | same |

Shift-click adds to the selection and never starts a drag. Ctrl/Cmd also add to the selection and
additionally snap a drag to collision features. Alt-click inserts a route point.

`FPSCameraController` ignores `InputManager.dz` (upstream noclip spends the wheel on the move-speed
slider in the app shell, which this fork does not have), so the perspective wheel dolly is applied
by the viewport in `dollyFreeCamera`.

### Capture, not lock

Drags use `setPointerCapture`, so a gizmo, entity, checkpoint, camera view point, path link,
marquee or checkpoint-draw drag keeps every move after the pointer leaves the canvas, leaves the
dock and leaves the window, and it ends when the button comes up *anywhere*. The canvas shows the
gesture with `data-cursor` (`look` / `drag`, styled in `src/styles.css`) instead of hiding the
cursor.

Pointer lock is asked for by **one** gesture only: a right-button first-person look
(`usesPointerLock`). A left click never asks for it. If the browser refuses — it does in the probe
window, with `WrongDocumentError` — the look falls back to client-coordinate deltas and still works.

Three independent nets make a stuck lock impossible:

1. `endPointerGesture` always calls `releaseCameraLook`, which exits the lock, and it is reached
   from `pointerup`, `pointercancel`, `lostpointercapture`, a `pointerup` anywhere on `window`,
   `blur`, `visibilitychange`, `Escape` and unmount.
2. A `pointerlockchange` with no camera gesture running exits the lock unconditionally.
3. Losing the lock mid-gesture ends the gesture rather than leaving it running with no way to move.

### Every drag lands, or is explicitly put back

`shouldCommitOnEnd` says yes for every end reason except `escape`. A committing end runs
`flushPendingInteractionCommit`; a cancelling end drops the pending commit and calls the drag's
revert, which re-pushes the document's own transform at the renderer. Either way the rendered
transform and the track document agree once the gesture is over. The previous code could drop a
`moveTransformSelection` commit — it is not rAF-scheduled, only flushed at drag end — and leave a
mesh drawn somewhere the document had never heard of.

### Picking only hits faces that are drawn

`EditorMeshPicker.pick` now honours each material's GX cull mode (`cullFacingSign` /
`triangleFacing`; GX materials are drawn with `GfxFrontFaceMode.CW`). A `CullMode.ALL` draw is
skipped entirely.

Without this, a course whose own `course_model.brres` carries a sky dome answers *every* click with
the dome: its near half is culled away visually, so you see the track through it, but the pick ray
still crossed it first. On `gpDC` that meant 2 pickable meshes out of 138 — clicking simply could
not select any scenery. With the cull mode applied the same view offers 34.

### Dev hook additions

`window.__mkwViewport` gained `getCameraMatrix()` and `getPointerState()`
(`{ gesture, button, moved, drag, camera, pointerLocked, pointerLockDenied, cursor }`).

### Probes

`scripts/viewport-input-probe.mjs` drives all of this with real CDP mouse input
(`Input.dispatchMouseEvent`), because synthetic `PointerEvent`s cannot exercise pointer capture,
pointer lock or the compatibility mouse events. Unlike the other harnesses the probe body runs in
Node: `scripts/probe-viewport-select.js`, `probe-viewport-gizmo-drag.js`,
`probe-viewport-camera.js`.
