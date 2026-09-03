# Materials and shaders

Authoring one Mario Kart Wii material: its textures, the way their coordinates are generated and
transformed, its lighting channels, the TEV combiner stages that make up its "shader", and the
fixed-function state around them.

The contract between the two halves of the feature is `src/lib/gxMaterial/types.ts`, and it is
worth reading first — everything below is either what that file describes or how the editor
presents it.

- `src/lib/gxMaterial/` decodes a material out of an MDL0 into a `GxMaterialDoc`, encodes it back,
  keeps the archive consistent, and compiles / decompiles the node graph.
- `src/ui/material/` is the editor: the outliner, the inspector, the shader-graph dock and the
  live preview. It never touches MDL0 bytes and never implements TEV semantics itself.

## Library

> Owned by the library half. Left for its section at merge.

## Editor

Material mode sits next to KMP / Camera / Model / Visual in the top bar. Like every other mode it
is a hook (`useMaterialMode` in `src/ui/material/MaterialMode.tsx`) that returns a `ModeUi`; the
shell composes it. KMP overlays are hidden while it is active, so the viewport shows what the game
would draw.

![Material mode with nothing selected](screenshots/material-01-mode.png)

### Layout

| Region | What it is |
| --- | --- |
| Left dock | `MaterialOutliner` — the track's BRRES archives → models → materials. |
| Viewport | Unchanged, plus a top-right overlay with the selection, its mesh count and **Solo**. |
| Bottom dock | `ShaderGraphDock` replaces the content browser: **Graph** and **Stages** tabs. |
| Inspector | `MaterialInspector` — seven sections for the selected material. |

The bottom dock takes over the content browser's slot through `ModeUi.bottomDock`, a function the
shell calls with the dock's size, collapse flag and resize handlers (`ModeBottomDock` in
`src/ui/modes/types.ts`). The shell keeps owning that state, so the shader panel resizes and
collapses exactly like the browser and the browser comes back untouched when the mode is left.

### The outliner

Archives in the order an author thinks about them — course model, skybox, minimap, then object
models alphabetically. An archive is only *listed* once expanded, because listing walks the whole
BRRES; the course model is expanded on entering the mode.

Each material row carries its layer textures as the caption and three badges:

- **Blend** — the material draws in the translucent pass.
- **Shared** — its TEV shader block is shared with other materials, so editing the shader has to
  decide whether to clone the block or rewrite it for everyone. The tooltip names them.
- Two numbers: how many meshes draw with it, and how many TEV stages it has.

The search box matches material names, model names, archive labels, texture names and mesh names.
Hovering a row highlights that material's meshes in the viewport; selecting one highlights them
more strongly and fills the inspector and the graph.

![A material selected](screenshots/material-02-selected.png)

### The inspector

Every control writes a whole new `GxMaterialDoc`; nothing in the inspector knows what a byte is.
Sections, in the order an author works in:

| Section | Fields |
| --- | --- |
| **Material** | Name, draw pass (opaque / translucent), which sides are drawn, SCN0 light set and fog index, texture-matrix style. |
| **Layers** | One card per sampler: texture picker with a thumbnail, palette, wrap S/T, min/mag filter, detail (LOD) bias, sharpening (anisotropy), bias clamp, edge mips, map mode; the SRT (scale / rotation / shift, and the reference camera and light for env modes); the texgen (type, source, matrix, normalize). Add, remove and reorder. |
| **Lighting** | Per channel: material and ambient colour, then for the colour and alpha halves — lit by scene lights, where the base and ambient colour come from, falloff, attenuation, and which of the eight lights the half sees. |
| **Colours** | The three colour registers C0..C2 (s10) and the four constants K0..K3, plus the four swap tables. |
| **Blend & alpha** | Blend mode, source and destination factors, logic operation, the constant-alpha register, and the two-part alpha test. |
| **Depth** | Test, comparison, write, and whether the depth test runs before or after texturing. |
| **Advanced** | Indirect stages and the three indirect matrices, as raw fields. |

Numbers scrub (drag the field, Shift for fine, Ctrl for coarse). A drag is one history entry: the
values during the drag are transient and only its release commits.

![The colour registers and constants](screenshots/material-08b-inspector-colours.png)

#### Importing a texture

Every layer card takes a PNG, either through **Import PNG…** or by dropping the file on the card.
The card's three controls decide how it is encoded:

- **Format** — CMPR by default (smallest), RGB5A3 when soft alpha matters, RGBA8 for full quality,
  plus the greyscale and 16-bit formats.
- **Size** — powers of two up to 1024.
- **Mip levels** — clamped to what the size allows.

The image is decoded with `readImageFile`, encoded with `encodeTex0Data` (both already used by
Visual mode's texture replacement), added to the archive with `addTexture`, and the layer is
pointed at it. **Export PNG** writes the layer's current texture back out through
`exportTextureAsPng`.

### The shader graph

The graph is the authoring model; TEV stages are the target. Every node maps onto something one
TEV stage can do, so compiling is a lowering pass rather than a search.

![The node editor](screenshots/material-03-graph.png)

#### The node palette

| Node | What it compiles to |
| --- | --- |
| **Material** | The output. Its `color` and `alpha` inputs are the last stage's result. There is exactly one, and it cannot be deleted or duplicated. |
| **Texture** | Binds a layer and a texture-coordinate set to the stage: `TEXC` / `TEXA`. Shows the layer's thumbnail. |
| **Vertex colour** | The rasterised lighting channel: `RASC` / `RASA`, and sets the stage's channel. |
| **Colour** | One of the konst colours K0..K3 (`KONST`). The swatch edits the material's konst colour, so it previews live. |
| **Register** | The starting value of C0, C1 or C2. The swatch edits the material's register. |
| **Value** | The literals 0, 0.5 and 1, which the hardware supplies for free. |
| **Multiply** | `a x b` — one stage, as `lerp(0, a, b)`. |
| **Add** / **Subtract** | `a + b` / `a - b` — the stage's D input plus or minus the rest. |
| **Lerp** | `lerp(a, b, t)` — exactly one whole TEV stage. |
| **Scale** | Multiplies by 0.5 / 1 / 2 / 4 with an optional ±0.5 bias and a clamp. Free on a stage. |
| **Compare** | The TEV compare ops: `(a op b) ? c : 0`, plus `d`. |
| **Indirect warp** | Routes an indirect stage into the texture sampled after it. |
| **Comment** | A resizable note. Never compiles to anything. |
| **Raw stage** | A stage the graph cannot express, kept verbatim and shown read-only, so opening a material never loses one. |

Sockets carry either `rgb` or `alpha`; there is no `rgba` wire, because the colour and alpha
pipelines are compiled separately and zipped onto the same stages. The maths nodes are
polymorphic: every socket takes the type of whatever is wired in first, and after that they all
agree. A wire whose types do not match is refused with a shake and a message.

![A rejected connection](screenshots/material-04b-wire-rejected.png)

#### Navigating and editing

| Gesture | Effect |
| --- | --- |
| Middle-drag, Space+drag, two-finger scroll | Pan |
| Wheel | Zoom about the cursor, clamped to 0.25x..2x (the readout is in the corner) |
| Fit button | Frame the whole graph |
| Drag a node | Move it; Ctrl snaps to the 8px grid |
| Drag empty space | Marquee-select |
| Shift+click | Add to or remove from the selection |
| Click a wire | Select it |
| Drag output → input | Connect. An input takes one wire, so this replaces whatever fed it |
| Drag a wire onto empty space | Opens the palette filtered to nodes that could legally be wired there, and connects the one picked |
| Double-click or right-click empty space | Open the "Add node" search palette |
| `Delete` | Delete the selected nodes and wires |
| `Ctrl+D` | Duplicate the selection, with the wires inside it |
| `Ctrl+C` / `Ctrl+V` | Copy the selection as JSON / paste it |
| `Ctrl+A` | Select every node |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo inside the graph (a separate stack from the editor's) |
| `Esc` | Close the palette and clear the selection |

The same list is in the `?` shortcut sheet (`EDITOR_SHORTCUTS`, "Shader graph").

![The add-node palette](screenshots/material-06-add-node-palette.png)

The toolbar has a **Presets** menu (`SHADER_GRAPH_PRESETS`; applying one also tops the material's
layers up to the preset's `samplerCount`), **Reset from stages** (re-runs `decompileShader`),
**Auto layout**, fit, and the graph's own undo/redo.

**Auto layout** is left-to-right and "as late as possible": a node's column is set by how far it
still is from the Material node, so a texture feeding the last stage sits beside that stage rather
than back at the far left with every other source. A freshly decompiled graph is laid out this way
before it is shown, because the decompiler orders nodes by stage but does not know how tall this
editor draws them.

![After auto layout](screenshots/material-07-auto-layout.png)

#### Compiling

The graph is compiled on every change, debounced by 50 ms. When it compiles, the stages go into
the material through `withCompiledShader` and are written back like any other edit. When it does
not, the material keeps the last stages that did and the status line says why. Diagnostics appear
as badges on the nodes and edges they are about, with the message in a tooltip.

The status line on the right of the dock header is the honest one: it reports the stages the
material *actually has*. A freshly decompiled graph is a view of the material's existing stages,
so its compile is only a round trip and is not written back — the graph only becomes what gets
written once it has been edited.

#### The Stages tab

A read-only table of exactly what will be written: per stage, the texture, coordinate set,
channel and konst selections, and both the colour and alpha halves' four inputs, op, bias, scale,
clamp and output register. Every value is named in plain language (`Vertex colour (RGB)`, not
`RASC`), which is also what the unit tests assert.

![The stage table](screenshots/material-04-stages.png)

### Where the graph is stored

A graph is a *view* of a material's stages: the same stages can be drawn as many different node
arrangements and only the author knows which one they meant. So each material's graph is kept:

1. **for the session** in a map in the mode hook, keyed by
   `<archive>|<model>|<material>` (`sessionGraphKey`), and
2. **across sessions** in IndexedDB, in its own database `mkw-track-editor-shader-graphs`, under
   `graph:<archivePath>:<model>:<material>:<hash of tevStages>` (`graphStorageKey`).

The stage hash is an FNV-1a over every field of every stage that the compiler writes, so a stored
graph is only ever re-used while it still describes the material's actual stages. If the stages
changed underneath it — the material was edited elsewhere, or the track was rebuilt — the key no
longer matches and the editor falls back to a fresh `decompileShader`.

It is a separate database rather than a store inside `mkw-track-editor` on purpose: adding a store
means bumping that database's version, and `src/lib/persistedCommon.ts` opens it at version 1,
which would then fail and lose the user's imported `Common.szs`. If IndexedDB is unavailable the
persistence is simply skipped.

### Applying edits, and undo

Every committed edit is one history entry:

1. `applyMaterial(bytes, model, material, doc)` rewrites the archive,
2. the new bytes go into `TrackDocument.archiveEntries` through `replaceArchiveFile`, and into the
   editor history through `history.applyEditorChange` — the same path Visual mode's texture
   replacement uses, so undo and export both see it,
3. the rewritten archive is pushed at the renderer (below),
4. any `warnings` the encoder returns are toasted, once per distinct message.

Continuous drags coalesce: `NumberInput`'s `onChange` marks the edit transient (working document
only) and its `onCommit` — fired once, on release — does the four steps above.

Undo and redo swap the whole `TrackDocument` out from under the mode. Re-decoding the material
from the restored bytes would mean re-parsing a multi-megabyte BRRES on every `Ctrl+Z`, so the
mode keeps a `WeakMap<TrackDocument, docs>` instead and puts the exact document that produced each
version back.

![Editing the culling, live](screenshots/material-09-cull-draw-nothing.png)

### Live preview

The scene is not rebuilt when a material changes. Instead:

```
MarioKartWiiRenderer.reloadEditorMaterial(archivePath, modelName, materialName, brres) -> boolean
```

- `BRRES.parseMaterialEntry` (added to the vendored `rres/brres.ts`) walks only
  `root` → `3DModels(NW4R)` → the named MDL0's material dictionary and runs the same
  `parseMDL0_MaterialEntry` the full parser uses. No display list, no vertex array, no other
  material is touched, so this is cheap enough to run on every committed edit.
- `MDL0Model.replaceMaterial(device, cache, index, entry)` builds a new `MaterialData` for that
  index and re-binds it to the texture holder (or res file) the model was loaded against.
- `MDL0ModelInstance.replaceMaterial(index)` rebuilds the per-draw-call `MaterialInstance`s for
  that material and repoints the `ShapeInstance`s that drew with the old one, carrying across the
  draw layer, visibility, skinning and fog. A `MaterialInstance` copies the material's
  `GXMaterial` at construction, so editing the MDL0 entry alone changes nothing on screen — the
  instance has to be rebuilt. `materialInstances` is per draw op, not per material, so a material
  used by three shapes has three of them; `materialInstanceMatIds` records which MDL0 material
  each one came from.
- The scene then re-applies the editor's render toggles and the enabled animations to the rebuilt
  instances and refreshes the mesh picker's source list.

Nothing on this path has a `destroy`: `GfxProgram`s and `GfxSampler`s come from the shared
`GfxRenderCache`, which owns and dedupes them, so discarding the old material objects leaks
nothing.

`addEditorTexture(name, texture)` uploads a texture the archive did not have before, so an
imported PNG shows up without reloading; an existing name is routed at `reloadEditorTexture`,
which can only replace pixels at the same size and format.

**Limits.**

- It covers every `MDL0ModelInstance` the scene draws — course models, the skybox, imported
  models, object previews — because it walks `baseObjects` through `getModelInstances`, the same
  walk the fog and lighting toggles use.
- It returns `false`, and the status line says the viewport keeps the old look until the track is
  reloaded, when the scene has not loaded that archive (`map_model.brres` is never rendered), when
  the model or material name is not in the edited bytes, or when the bytes do not parse.
- It does **not** fall back to a scene rebuild. A `sceneKey` bump would be a second, much slower
  path for the same job and would throw away the camera; a `false` return and an honest status
  line is better.
- The `Solo` toggle and the mesh highlight use the per-draw visibility overrides Model mode
  introduced (`setEditorMeshVisible` / `setEditorMeshHighlight`). Leaving the mode clears both.

![Solo: every other mesh hidden](screenshots/material-11-solo.png)

### Tests and the browser probe

Pure logic is unit tested with no DOM (`npm test`):

| File | Covers |
| --- | --- |
| `src/ui/material/graphModel.test.ts` | Node geometry and hit testing, marquee, socket typing and the polymorphic maths nodes, every connection rule (side, self, cycle, type), edge replacement, delete / move / snap / duplicate / copy / paste, pan-zoom-fit maths, auto layout. |
| `src/ui/material/materialDoc.test.ts` | Every inspector field → document mapping, colour conversion in both directions, the layer list's add / remove / reorder, the light mask. |
| `src/ui/material/materialOutlinerModel.test.ts` | Archive naming and ordering, the tree, the search, the shared-shader badge, reference keys. |
| `src/ui/material/graphStore.test.ts` | The stage hash and both storage keys. |
| `src/ui/material/MaterialInspector.test.tsx` | The inspector, the outliner, the dock's tab state and the stage table, rendered with `renderToStaticMarkup`; includes the assertion that no raw GX enum identifier reaches the user. |

The end-to-end walkthrough is `scripts/probe-material-ui.js`, driven by `scripts/ui-shell-probe.mjs`
against a real Edge window:

```bash
npx vite --host 127.0.0.1 --port 5197 --strictPort
PROBE_PREFIX=material PROBE_PORT=9352 PROBE_SIZE=1720x1000 \
  node scripts/ui-shell-probe.mjs \
  "http://127.0.0.1:5197/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-material-ui.js
```

It enters the mode, resizes the dock, reads the outliner, searches, selects a material, reads the
graph and the stage table, drags a node, connects a wire and gets one rejected, opens and filters
the palette, adds a node, runs auto layout, zooms, opens every inspector section, edits the
culling and a constant colour, solos, undoes back, and leaves the mode — reporting every number it
saw and writing the screenshots in this document.
