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
previewCamera(cameraIdOrIndex, { play?, time?, sequence? })
stopCameraPreview()
playOpeningSequence()
getCameraOverlay()
getCameras()
captureFrame()                             // PNG data URL of the next rendered frame
```

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
