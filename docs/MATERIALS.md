# Materials and shaders

A Mario Kart Wii material is a block inside an MDL0 plus a shared 512-byte "shader" block, and
between them they hold everything the GX hardware needs to draw a surface: which textures to
sample, how their coordinates are generated, how vertex colour and lighting feed in, the TEV
combiner program that mixes it all together, and the blend / depth / alpha-test state around it.

The feature is split in two. `src/lib/gxMaterial/` owns the bytes and the TEV semantics;
`src/ui/material/` owns the editor. `src/lib/gxMaterial/types.ts` is the contract between them —
plain JSON-serialisable data, no classes, so a material document can go in the undo history and
be diffed.

## Library

### File map

| File | What it does |
| --- | --- |
| `types.ts` | The contract: `GxMaterialDoc`, the shader graph, the compiler result, the presets. |
| `gxRegisters.ts` | GX display lists both ways: replay one into registers, emit one back byte-exactly. |
| `materialCodec.ts` | Material block and TEV block ⇄ `GxMaterialDoc`, plus the hardware-limit checks. |
| `archive.ts` | `listArchiveMaterials`, `decodeMaterial`, `applyMaterial`, `addTexture`, `removeTexture`, `renameTexture`. |
| `shaderGraph.ts` | `compileShaderGraph`: lowers a node graph to TEV stages. |
| `decompile.ts` | `decompileShader`: TEV stages back to a node graph, self-checked. |
| `defaults.ts` | `createDefaultMaterialDoc` and the pieces it is made of. |
| `presets.ts` | `SHADER_GRAPH_PRESETS`. |
| `index.ts` | The barrel the editor imports; nothing in `src/ui/` reaches past it. |

Everything is pure TypeScript. The only dependency outside `src/lib/` is the `GX` enum object from
`vendor/noclip.website/src/gx/gx_enum.ts`, which is a dependency-free file of constants.

### The MDL0 v11 material block

Version 11 is what every Mario Kart Wii course and object ships; the decoder refuses anything
else. Offsets are from the start of the block.

```
0x000  u32   block size
0x004  s32   distance back to the MDL0
0x008  s32   name (into the archive's string pool)
0x00C  u32   index in the Materials dictionary
0x010  u32   flags; bit 31 = draw in the translucent pass
0x014  u8    texgen count      0x015 u8 lighting channel count
0x016  u8    TEV stage count   0x017 u8 indirect stage count
0x018  u32   cull mode
0x01C  u8    zCompLoc          0x01D s8 light set   0x01E s8 fog set   0x01F pad
0x020  4xu8  indirect method   0x024 4xs8 normal-map light refs
0x028  u32   offset of the TEV block, relative to this block
0x02C  u32   layer count       0x030 u32 offset of the layer table
0x034  u32   fur data (v10+)   0x038 u32 user data (v11)   0x03C u32 display list offset
0x040        reserved; zero in all 8804 materials this editor has been run over
0x1A8  u32   texture SRT flags, four bits per layer
0x1AC  u32   texture matrix mode: 0 maya, 1 xsi, 2 max
0x1B0  8x14  texture SRTs: scale S/T, rotation, translate S/T
0x250  8x34  texture matrix effects: ref camera, ref light, map mode, misc, 3x4 matrix
0x3F0  2x14  lighting channels: flags, material colour, ambient colour, colour and alpha control
0x418  Nx34  the layer (sampler) table
       ...   padding to a 32-byte boundary
       0x180 the material display list
```

The layer table always starts at 0x418, so the display list starts at
`align(blockStart + 0x418 + layers * 0x34, 32) - blockStart` and the block is that plus 0x180.
The material block itself is only 4-byte aligned in retail files, which is why the display list's
offset depends on where the block sits.

The TEV block is a flat 512 bytes: size, distance back to the MDL0, its index in the Shaders
dictionary, the stage count, eight texture-reference bytes (`i` for each live layer, `0xFF` past
them), then a 480-byte display list at 0x20.

### Canonical display lists

Both lists are fixed-size and every write sits at a fixed offset. A BP write is
`0x61` + `u32(register << 24 | value)`; an XF write is `0x10` + `u16(count - 1)` + `u16(address)`
+ values. A BP write to register `0xFE` is a write mask that applies to the next write only.

Material list, 0x180 bytes:

```
0x00  BP F3 alpha function
0x05  BP 40 z mode
0x0A  BP FE mask 0x00FFE3   (dither and the colour/alpha update bits are left alone)
0x0F  BP 41 blend mode      0x14  BP 42 constant alpha
0x20  TEV colour register C0: RA once, then BG three times, five bytes apart
0x34  C1        0x48  C2
0x60  konst K0: RA then BG    0x6A K1   0x74 K2   0x7E K3   (bit 23 marks the konst bank)
0xA0  BP 25 / 0xA5 BP 26 indirect texture scales
0xAA  BP 06 / 07 / 08 indirect matrix 0
0xE0  per texgen i, 0x12 apart: XF 0x1040+i TexMtxInfo, then XF 0x1050+i PostMtxInfo
```

TEV list, 0x1E0 bytes:

```
0x00  eight (BP FE mask 0x0F, BP F6+n) pairs, 0x0A apart: the four swap tables
0x50  BP 27 indirect texture coordinate / texture map references
0x60  eight 0x30-byte stage pairs; pair k holds
        +0x00  BP FE mask 0xFFFFF0     +0x05  BP F6+k konst selections for both stages
        +0x0A  BP 28+k texture, coordinate and channel order for both stages
        +0x0F  colour env, even stage   +0x14  colour env, odd stage
        +0x19  alpha env, even stage    +0x1E  alpha env, odd stage
        +0x23  indirect command, even   +0x28  indirect command, odd
```

Swap tables and konst selections share registers F6..FD, which is why each write is preceded by
the mask that says which half of the register it owns.

### Byte-exact round trips

`decodeMaterial` followed by `applyMaterial` reproduces the archive byte for byte. That is checked
over every material in every archive the test fixtures find — 8804 materials in 371 course and
object archives on the development machine, and it passes on all of them.

Getting there needs one rule applied everywhere: **the encoder never builds a block from nothing.**
It copies the block it is replacing and patches the fields the document owns, and it starts each
display list from the one it is replacing rather than from zeroes. Everything the format has and
the editor does not model then survives untouched — and there is a surprising amount of it:

- The reserved 0x040..0x1A8 region, the texture-matrix effect matrices, and the data of channels,
  texgens and stages past the live counts.
- The emboss source and input form of a regular texgen, which no reader looks at.
- Fields that only mean something for a stage that does not exist: the unused half of an odd
  stage pair (parked on texmap 7 by some exporters, texmap 0 by others), the texture slot named
  by a stage that samples no texture, the low four bits of the konst register.
- Several encodings of the same thing. Attenuation "none" is stored both as zero and as
  spot-with-attenuation-off; some files leave junk in a channel control's high bits; the
  indirect-reference register's unused slots are `0x000000` in some tracks and `0xFFFFFF` in
  others. A control word is only rewritten when its stored form no longer means what the document
  says.
- Layout the exporter chose and this writer would not: an indirect matrix a file placed at a
  different offset, an indirect command slot given over to a different register entirely.

Two things follow from this. Byte-exactness is a property of *unchanged* fields, not of the
writer's canonical layout, so anything genuinely edited comes out in the canonical form above.
And the tests are the specification: a decoder that quietly dropped a field would show up as a
byte difference, which is the only assertion strong enough to prove the decoder is complete.

The suite also re-parses the result with the vendored noclip BRRES reader — the same code the
viewport uses, and an entirely independent implementation of the format — and checks that the
`GXMaterial` and sampler list it builds are unchanged.

### Writing back

`applyMaterial` works through `Mdl0Editor`, which never re-lays-out a model. Every pointer inside
an MDL0 is relative to the thing that holds it and is read back *unsigned*, so a block can only be
repointed at something that sits after it.

- **In place.** When the encoded block is the same size — which it is unless the layer count
  changed, since both display lists are fixed-size — the bytes are patched where they are.
- **Grown or shrunk.** The block is appended past the model's end, its Materials dictionary entry
  is repointed, and the old bytes are left as dead weight. BrawlBox does the same. The archive
  gains a few hundred bytes; every other offset in the file stays valid.
- **Shared shaders.** Materials commonly point at one TEV block. With `sharedShader: 'clone'`
  (the default) a changed shader is appended as a new 512-byte block, added to the Shaders
  dictionary under the editing material's name, and only that material is repointed at it — the
  block has to land after the material that names it, so it is appended second. With `'shared'`
  the block is overwritten in place; because the *stage count* lives in each material's header
  rather than in the shader, the materials sharing it have their count updated too, and they all
  appear in `affectedMaterials`.
- **Texture links.** The console binds textures by walking the MDL0's `Textures` section, not by
  name: a material missing from it renders untextured on hardware even though a name-resolving
  viewer shows it fine. `applyMaterial` rewrites exactly this material's `(material, sampler)`
  pairs, keeping foreign entries and unchanged pairs in place so an edit that changes nothing
  produces byte-identical link blocks.
- **Names.** A name lives in the archive's string pool, outside the model, and is pointed at
  relative to the field that holds it. Any block the editor writes declares its name pointers
  through `Mdl0Editor.addStringRef` so `writeBrres` can re-derive them. Renaming a material
  renames its dictionary entry and interns the new name; draw ops address materials by index, so
  nothing that draws it needs touching.
- **Draw pass.** Flipping `translucent` moves this material's draw ops between `DrawOpa` and
  `DrawXlu`, because the pass is a property of the bytecode list, not of the flag.

Adding or removing a `TEX0` is a container-level edit. A sub-file that changes position relative
to the string pool has to be able to re-derive its names, so a new texture is inserted right after
the models (which can) and ahead of the animation sub-files (which cannot), and a removed one
leaves its bytes behind as padding for whatever followed it so nothing moves at all.

`applyMaterial` refuses documents the hardware could not run — more than 8 textures or texgens,
16 stages, 4 indirect stages or 2 channels, out-of-range enums, a stage sampling a slot with no
layer — with a plain-English `GxMaterialError`. It refuses what *this edit* broke, though, not
what it inherited: retail tracks really do ship materials whose stage samples a texture slot they
have no layer for, and writing one of those back unchanged has to keep working.

### The shader graph compiler

A TEV stage computes, for colour and alpha independently,

```
out = clamp?( (d ± lerp(a, b, c) + bias) * scale )
```

and binds at most one texture, one texture coordinate, one rasterised channel and one konst
selection. Every node in the graph maps onto something a stage can do, so the compiler is a
lowering pass rather than a search.

Colour and alpha are compiled as two independent trees hanging off the output node, because the
hardware keeps two independent register sets. Lowering each is a post-order walk:

| Node | Stage form |
| --- | --- |
| `multiply(a, b)` | `A=ZERO B=a C=b D=ZERO` |
| `add(a, b)` | `A=b B=ZERO C=ZERO D=a` — with `c` zero the lerp is just `a`, so no konst is needed |
| `subtract(a, b)` | the same with `TevOp.SUB` |
| `lerp(a, b, t)` | `A=a B=b C=t D=ZERO` |
| `add`/`subtract` whose second input is a `lerp` or `multiply` used nowhere else | fused into one stage: `D` is the first input, `A/B/C` come from the fused node |
| `scale` | folded into the stage that produced its input when that stage still has the default bias and scale; otherwise a pass-through stage carries it |
| `compare` | `A/B/C/D` direct, bias `$HWB_COMPARE`, scale naming the comparison width |
| `alphaAsColor` | the wired source's alpha as a *colour* operand: `CC.TEXA`, `CC.RASA`, `CC.APREV`, `CC.A0..A2`, or `KCSEL_K{n}_A` |
| `storedValue` | reads a register back: `CPREV`/`C0..C2`, or `APREV`/`A0..A2` in the alpha pipeline |
| `texture` | binds the stage's texture and coordinate; `TEXC` or `TEXA` |
| `vertexColor` | binds the channel; `RASC` or `RASA` |
| `constant` | binds `konstColorSel` / `konstAlphaSel`; `KONST` |
| `register` | reads `C0..C2` (or `A0..A2`) as the register's *starting* colour |
| `outputRegister` on a step | the stage's `colorRegId` / `alphaRegId`; the spill allocator never takes a register a graph asked for |
| `value` | `ZERO` / `HALF` / `ONE`; the alpha input set has no half or one, so those come from a konst selection |
| `indirectWarp` | wired into a texture's UV input, it becomes that stage's `indTex*` fields |
| `rawStage` | copied out verbatim; its `prev` input only says what runs before it |

Intermediates live in the previous-stage register when the next stage reads them straight away.
A value is only spilled into C0..C2 when something is about to *overwrite* the register it lives
in and a later node still has a use for it — so two reads by the same stage, which is what
`d + lerp(a, PREV, c)` is, cost nothing, and a stage that stores into C0..C2 rather than the
working slot never triggers a spill at all. A sibling subtree that is about to emit stages spills
whatever the half-lowered parent already has in hand. The allocator never takes a register a
`register` node, a `storedValue` node or an `outputRegister` names. Running out is an `error`
diagnostic saying to split the material or reuse a texture.

A stage half whose result nothing downstream reads still runs on the hardware, and real files are
full of them — a kart body works out an alpha in stage 0 that stage 1 overwrites without looking.
The decompiler marks the cluster's root `unusedResult`, and the compiler emits it after the walk
from the output, placed by its group so it lands where the file had it rather than at the end.
Only the decompiler sets the flag, so a node the author unwires still simply stops doing
anything.

Zipping puts a colour op and an alpha op on the same stage when their texture, channel and
indirect bindings agree (konst is two separate fields, so it never conflicts). Where they
disagree, one side gets a pass-through — `d = PREV`, everything else zero — which leaves the other
pipeline's previous-stage register untouched. Pass-throughs count against the 16-stage limit.

`compileShaderGraph` never throws. Unwired inputs take the socket's `default` from
`GRAPH_NODE_SOCKETS`; nodes that cannot reach the output are `warning` diagnostics; a wire between
the colour and alpha pipelines, a cycle, a sampler the material does not have, and two textures on
one stage are `error` diagnostics, and an errored compile returns no stages. `usage` reports which
samplers, texture coordinates, channels, konst colours, registers and indirect stages the shader
actually touched, so the inspector can grey out the rest.

### The decompiler, and how it stays exact

`decompileShader` builds one cluster per stage, laid out left to right at `x = 260 * index` with
colour on the top row and alpha below. Each stage becomes an `add` (or `subtract`) fed by a
`lerp`, with a `scale` on top when the stage biases, scales or leaves its result unclamped. The
inputs become shared source nodes: one `texture` per (sampler, coordinate) pair, one
`vertexColor` per channel, one `constant` per konst selection, one `register` per register the
material starts with.

`compileShaderGraph(decompileShader(m), m).tevStages` equals `m.tevStages` for every fixture
material — 16671 of them in the measurement below. Two mechanisms get it there:

- **`stageTemplate`.** Every cluster node carries the original stage. Fields the graph has no
  opinion about — the konst selection a stage names even when it reads no konst, the raster
  channel it names when it reads no vertex colour, the swap tables, the indirect setup — are taken
  from it. Without this, roughly half of all retail stages would only round trip approximately.
- **`rawStage`.** Anything the node vocabulary genuinely cannot say becomes a read-only card
  holding the stage verbatim. There is one shape left that qualifies — a stage that reads the
  texture unit while binding no texture — and it accounts for 30 of the 29616 stages measured
  below (0.10%), all of them in custom course models.

Which of the two applies is not guessed. `decompileShader` compiles what it built, compares it
against the material, pins the first stage that came back different as a raw stage and tries
again, and falls back to an all-raw chain if it ever stops making progress. So the round trip
holds by construction, and the raw-stage count is a measure of how much of a real material the
graph model captures rather than something that can silently drift.

The colour and alpha halves of one stage find each other again through a node-id convention:
`s3c`, `s3cl`, `s3cs`, `s3a`, `s3r` all belong to stage 3. Nodes the editor creates have their own
ids and no group, which is right — there is no original stage to line them up with.

### How much of a real material the graph can draw

`scripts/shader-graph-coverage.mjs` decompiles every material of every MDL0 in a corpus of real
archives and records, per stage the decompiler had to keep verbatim, *why*: which operand the node
vocabulary has no source for (`decompileShaderReport().causes`), or which `GxTevStageDoc` fields a
recompile got back wrong. It is the tool that said what to build, and it is the regression test
that says it stayed built.

```bash
node scripts/shader-graph-coverage.mjs --limit 400 --json coverage.json
```

A run over 2343 archives — 319 driver models, 1658 kart models, 328 course models and the object
archives inside `Common.szs` — before and after this work:

| Family | Materials | Stages | Raw before | Raw after |
| --- | --- | --- | --- | --- |
| driver | 1068 | 3177 | 66.3% | **0.00%** |
| kart | 7028 | 13227 | 44.8% | **0.00%** |
| course | 8489 | 13048 | 6.0% | **0.23%** |
| object | 86 | 164 | 42.1% | **0.00%** |
| all | 16671 | 29616 | 31.0% | **0.10%** |

(The "before" column is the same script run against the code as it stood, over the smaller
40-archives-per-family sample it was measured on; the shares are the comparable numbers.)

The histogram of causes, before:

| Cause | Count | driver | kart | course | object |
| --- | --- | --- | --- | --- | --- |
| colour input reads previous alpha (`CC.APREV`) | 947 | 116 | 778 | 10 | 43 |
| colour input reads vertex-colour alpha (`CC.RASA`) | 155 | 122 | 0 | 14 | 19 |
| recompiled differently: `alphaInB/C/D` | 362 | 0 | 306 | 54 | 2 |
| recompiled differently: `channelId` | 82 | 0 | 41 | 41 | 0 |
| colour input reads texture alpha (`CC.TEXA`) | 13 | 0 | 0 | 13 | 0 |
| colour input reads a stored alpha (`CC.A0..A2`) | 4 | 0 | 0 | 1 | 3 |
| everything else (`alphaScale`, `colorRegId`, `konst*Sel`, `indTex*`, `texMap`, …) | 110 | 0 | 31 | 73 | 6 |

And after, over the full 16671-material corpus:

| Cause | Count | driver | kart | course | object |
| --- | --- | --- | --- | --- | --- |
| alpha input reads texture alpha, with no texture bound | 30 | 0 | 0 | 30 | 0 |

![A driver model drawn entirely as nodes](screenshots/shader-driver-01-graph.png)

![A kart body: two textures blended by one of them's alpha](screenshots/shader-kart-01-graph.png)

**What is still raw, and why.** A stage that names `TEXA` (or `TEXC`) while its `texMap` is
`TEXMAP_NULL` reads a texture unit with nothing in it. On hardware that is undefined; in the graph
a `texture` node always names a layer, so there is nothing honest to draw. Those 30 stages, spread
over 30 materials in a handful of custom tracks, stay "Special step" cards whose sentence says
exactly that, and the Stages tab shows every field. Two other defects retail content ships —
sampling a slot the material has no layer for, and naming a lighting channel it does not have —
*are* drawn as nodes now, with a warning badge rather than a refusal, because `applyMaterial` is
the backstop that refuses the ones an edit introduces.

![The one shape that is still a Special step, saying so](screenshots/material-graph-03-special-step.png)

The browser checks are `scripts/probe-studio-shader.js` (the Model Studio over a character archive)
and `scripts/probe-material-graph.js` (Material mode over a track):

```bash
PROBE_PREFIX=shader PROBE_PORT=9451 PROBE_SIZE=1720x1000   PROBE_MODEL=/dev-tracks/la_bike-bk-1.szs PROBE_SHOT=shader-kart   node scripts/studio-probe.mjs "http://127.0.0.1:5235/" scripts/probe-studio-shader.js

PROBE_PREFIX=matgraph PROBE_PORT=9455 PROBE_SIZE=1720x1000   node scripts/ui-shell-probe.mjs "http://127.0.0.1:5235/?track=/dev-tracks/Z0.szs"   scripts/probe-material-graph.js
```

The studio probe walks every material in the archive, then edits one through a node that did not
exist before, measures that the rendered pixels move, exports, and opens the export again to check
the edit is in the bytes. Runs at the time of writing: `la_bike-bk-1.szs` 13 materials / 29 stages,
`mc_kart-ca-2.szs` 10 / 23, `Driver/bds-1.brres` 2 / 6 — zero Special steps in all three, and the
untouched export byte-identical to what was opened. Material mode on `Z0.szs`: 54 materials in 11
archives, zero Special steps.

### Adding a node type

1. Add it to `GraphNodeType`, give it an interface, add it to the `GraphNode` union and put its
   sockets in `GRAPH_NODE_SOCKETS` in `types.ts`.
2. Handle it in `Compiler.lowerNodeUncached` in `shaderGraph.ts`. If it computes something, build
   its operands with `lowerInput` and finish with `emitMath`, which takes care of binding
   conflicts, register allocation and stage placement. If it is a source, return an `Operand` with
   the right `CC`/`CA` input and whatever bindings it needs. Add it to `MATH_TYPES` if it emits a
   stage — that is what tells the spill logic a subtree will overwrite the previous-stage register.
3. Teach `decompile.ts` to emit it where it applies, if it has a stage shape to recognise, and
   give it a `NODE_SUMMARY` line and a `nodeTypeTitle` in `src/ui/material/graphModel.ts` — plus a
   place in `ADDABLE_NODE_TYPES`, and in `ADVANCED_NODE_TYPES` if it is the hardware showing
   through rather than something a road needs.
4. Add a unit test in `shaderGraph.test.ts` for the shape it lowers to *and* for the stage shape it
   decompiles from, and re-run `node scripts/shader-graph-coverage.mjs`: the retail round trip is
   the test that catches a node that quietly changes an existing lowering, and the coverage script
   is the one that says whether the new node actually bought anything.

### Contract additions

`types.ts` was extended, backward compatibly, in four places:

- `GxSamplerDoc.tlutId?` — the palette slot a layer binds. A handful of retail layers use 1.
- `GraphNodeBase.stageTemplate?` — see above.
- `GraphConstantNode.colorSel?` / `alphaSel?` — the exact konst selection, for the cases `slot`
  cannot name: the eight hardware fractions and the single-channel reads (`K1[GGG]`).
- `'rawStage'` node type, with a `prev` input so a chain of them keeps its order, and a `reason`
  the decompiler writes for the card to show.
- `GraphVertexColorNode.channel` widened from 0/1 to a whole `GX.RasColorChannelID`, so the
  bump-alpha sources and the constant-black one round trip. 0 and 1 still mean what they did, which
  is why the stored graph version did not have to change.
- `GraphNodeBase.unusedResult?` — the root of a cluster nothing reads; see above.
- `outputRegister?` on the step nodes (`multiply`, `add`, `subtract`, `lerp`, `scale`, `compare`).
- `'storedValue'` and `'alphaAsColor'` node types.

All of these are optional, so `ShaderGraph.version` stays 1 and a graph stored in IndexedDB by an
older build loads unchanged — `graphModel.test.ts` asserts exactly that. What such a graph *does*
still hold is read-only cards for steps this build can now draw, which is what the editor's
one-click **Convert to nodes** is for; see the palette section below.

`GxIndMatrixDoc.m` holds the effective coefficients (the 11-bit hardware values already multiplied
by `2 ** scaleExp`) and `scaleExp` is the hardware's 6-bit exponent field less its bias of 27, so
it runs -27..36. Both are exact.

## Editor

> The same inspector and the same shader-graph dock are also the right-hand and bottom panels of
> the **Model Studio** (`docs/STUDIO.md`), which drives them over a standalone model archive
> instead of a track. Both take a `GxMaterialDoc` and a change callback and know nothing about
> `TrackDocument`, so neither needed a fork; what differs is only who owns the bytes and the undo
> stack. Material mode's **Open in Model Studio** button, under the viewport overlay, hands the
> selected material's archive over.

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

![Back in KMP mode: the content browser is exactly where it was](screenshots/material-13-back-in-kmp.png)

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

**Simple by default, hardware on demand.** A GX material is a pile of fixed-function state, and
the first version of this panel showed all of it: blend factors, depth comparisons, konst
selectors, wrap enums, texgen matrix modes. Almost none of that is what an author is deciding. So
every section now leads with the handful of real choices, in words, and keeps the machinery behind
an `AdvancedBlock` — a disclosure that starts closed and remembers, per section, whether it was
opened (`useRemembered`, `localStorage`). Nothing was removed: every raw field is one disclosure
away from where it used to be, and the panel is about 45% shorter by default.

Header: the material's name as an editable heading, its model and archive, how many meshes draw
with it, a one-line summary (`describeMaterial`, e.g. "See-through · vertex-coloured · 2 textures ·
two-sided.") and a strip of its layer thumbnails.

| Section | Simple | Behind **Advanced** |
| --- | --- | --- |
| **Textures** | Per layer: thumbnail, image picker, **Repeat / Mirror / Clamp**, **Smooth / Pixelated**, tiling scale (U/V), offset (U/V), rotation, an **Environment map** switch, and Replace / Save PNG. Add, remove, reorder. | Palette (and its TLUT slot, for a paletted texture), per-axis wrap, the exact min/mag filters, detail (LOD) bias, sharpening, bias clamp, edge mips, map mode, the reference camera and light, the texgen, and the import encoding — plus, for the section, the indirect stages and matrices. |
| **Transparency** | One **Opaque / Cutout / Transparent** choice, the cut-off slider when it is cutting, and **hides what is behind** (depth write). | Blend mode, source and destination factors, logic operation, the constant-alpha register, the two-part alpha test, and the depth test / comparison / compare-before-texturing. |
| **Lighting** | **Lit / Vertex colours / Unlit**, the base colour when the material supplies it, the ambient colour when it is lit. | Both channels in full: material and ambient colour, and for each of the colour and alpha halves the lighting switch, the two sources, falloff, attenuation and the eight light bits. |
| **Colours** | Only the constants and registers the stages actually read, named **Colour 1..4** and **Start colour 1..3**, each captioned with which stages read it. | All four constants and all three registers, including the ones nothing reads, plus the four swap tables. |
| **Surface** | **Two-sided**, and the shared-shader note. | Draw pass, the four-way culling choice, SCN0 light set and fog index, texture-matrix style. |

The mapping from each simple control to the fields underneath is `src/ui/material/materialSimple.ts`
— pure, and held to two laws by `materialSimple.test.ts`:

1. **Writing back what was just read is the identity**, by reference. That is what lets a retail
   material be opened in the friendly inspector and closed again without a byte changing;
   `materialSimple.byteExact.test.ts` takes the same round trip through `applyMaterial` into real
   MDL0 bytes to prove it.
2. **A setter touches only the fields its choice is about.** Picking "Cutout" rewrites the alpha
   test, the blend mode and the draw pass, and nothing else.

Two of those mappings are worth spelling out. "Is this material cutting holes?" is answered by
*evaluating* the two-part alpha test over all 256 alphas rather than by pattern-matching it,
because there are far too many spellings of "always passes" to list. And "which colours does the
shader read?" only counts a stage with a `KONST` input (every stage names a konst selection whether
it reads it or not) and only counts a register read *before* anything writes to it (a register a
stage overwrites on its way past is scratch space, and its start colour is dead).

Numbers scrub (drag the field, Shift for fine, Ctrl for coarse). A drag is one history entry: the
values during the drag are transient and only its release commits.

Above the sections is a warning strip listing whatever `collectMaterialIssues` reports about the
document right now. It is a strip and not a block on purpose: retail content really does ship
materials whose stage samples a texture slot the material has no layer for, and writing such a
material back unchanged has to keep working. `applyMaterial` only refuses the defects an edit
*introduced*, and returns the rest as warnings.

![The simple view](screenshots/material-after-01-inspector.png)

![Transparency, lighting, colours and surface](screenshots/material-after-02-inspector-bottom.png)

![The same material with every Advanced block open](screenshots/material-after-03-advanced.png)

![What it looked like before](screenshots/material-before-01-inspector.png)

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

A node's card says what it *is*, not what the hardware calls it: `nodeTitle` folds the slot into
the title and `nodeCaption` supplies the dimmed half after the dot, so a card reads
**Texture 1 · road_tex** and **Colour 3** rather than "Texture" over a dropdown holding
`TEXMAP0`. Socket labels go through `socketLabel`, so a lerp's inputs read **A / B / Mix** and a
texture's outputs read **Colour / Alpha**. The names are shared with the inspector
(`konstColorName`, `colorRegisterName`, `channelName` in `gxOptions.ts`), so a konst slot is
"Colour 1" everywhere it is mentioned, including in status messages.

![The node editor](screenshots/material-after-05-graph.png)

#### The node palette

| Node | What it compiles to |
| --- | --- |
| **Material** | The output. Its `color` and `alpha` inputs are the last stage's result. There is exactly one, and it cannot be deleted or duplicated. |
| **Texture** | Binds a layer and a texture-coordinate set to the stage: `TEXC` / `TEXA`. Shows the layer's thumbnail. |
| **Vertex colour** | What the rasteriser hands the stage: **Vertex colour 1 / 2** (the two lighting channels), **Bump alpha** and **Bump alpha, inverted** (fed by an indirect stage), or **Nothing (black)**. |
| **Colour** | One of the konst colours K0..K3 (`KONST`). The swatch edits the material's konst colour, so it previews live. Its **Advanced** block picks the exact selection (`colorSel` / `alphaSel`) for the cases the slot cannot name: the eight hardware fractions and the single-channel reads. |
| **Register** ("Start colour") | The starting value of C0, C1 or C2. The swatch edits the material's register. |
| **Value** | The literals 0, 0.5 and 1, which the hardware supplies for free. |
| **Multiply** | `a x b` — one stage, as `lerp(0, a, b)`. |
| **Add** / **Subtract** | `a + b` / `a - b` — the stage's D input plus or minus the rest. |
| **Lerp** | `lerp(a, b, t)` — exactly one whole TEV stage. |
| **Scale** | Multiplies by 0.5 / 1 / 2 / 4 with an optional ±0.5 bias and a clamp. Free on a stage. |
| *(on every step node)* **Store result in** | Behind the card's **Advanced** disclosure: the working slot (the default) or one of the three stored slots. The compiler honours it and keeps the spill allocator off that slot. |
| **Compare** | The TEV compare ops: `(a op b) ? c : 0`, plus `d`. All eight widths (`R8`, `GR16`, `BGR24`, `RGB8`, each `>` and `=`). |
| **Indirect warp** | Routes an indirect stage into the texture sampled after it. |
| **Alpha as colour** | An alpha source read into a *colour* input. The only place the two halves meet, and what nearly every character model blends two textures with. Only a source can feed it — a texture, a vertex colour, a constant, a start colour or a stored value — because a colour operand names a place, not another step's result; wire a step into it and the message says to store that step in a slot first. |
| **Stored value** | Reads a slot back: the **Working slot** every step writes to unless told otherwise, or one of the three **Stored slots** (C0..C2). Also what a stage reading the working slot before anything wrote it decompiles to. |
| **Comment** | A resizable note. Never compiles to anything. |
| **Special step** (`rawStage`) | A stage the graph cannot express: on the corpus measured above, only a stage that reads a texture while binding none. The decompiler emits one instead of guessing and the compiler copies it out verbatim. Read-only, and never in the palette. Its `prev` input carries no value; it only says which stage runs before it, so a chain of raw stages keeps its order. **It is never a dead end**: the card says in one sentence what it is that cannot be drawn (the `reason` the decompiler wrote), points at the Stages tab, and offers **Convert to nodes** — a one-click re-read of the material's steps, which is what a graph saved before this editor learned a node needs. Reopening such a graph does that re-read automatically, because a graph the editor can actually edit is worth more than a remembered layout. |

The palette has two sections. Everything above the line is what a material is normally made of;
**Advanced** holds the four that are the hardware showing through — *Alpha as colour*, *Stored
value*, *Compare* and *Warp coordinates*. Both are always visible: the heading is a signpost, not a
disclosure, because a node nobody can find may as well not exist.

![The add-node palette, scrolled to its Advanced half](screenshots/material-graph-02-palette.png)

Sockets carry either `rgb` or `alpha`; there is no `rgba` wire, because the colour and alpha
pipelines are compiled separately and zipped onto the same stages. *Alpha as colour* is the single
crossing point, and it only goes one way — a TEV colour operand can name an alpha source, but no
alpha operand can name a colour, so there is no node for the other direction. The maths nodes are
polymorphic: every socket takes the type of whatever is wired in first, and after that they all
agree. A wire whose types do not match is refused with a shake and a message.

Nodes also carry a `stageTemplate` the decompiler fills in — the fields of a TEV stage the graph
has no opinion about (swap tables, the indirect setup, konst and channel selections a stage names
but never reads). The editor never shows it, but it copies it with the node, so duplicating or
pasting a node keeps the material recompiling exactly.

![A rejected connection](screenshots/material-04b-wire-rejected.png)

![A node dragged, with its wires following](screenshots/material-05-graph-node-dragged.png)

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

The toolbar has **Reset from stages** (re-runs `decompileShader`), **Auto layout**, fit, and the
graph's own undo/redo. The presets (`SHADER_GRAPH_PRESETS`) are not in it: they used to be a
dropdown, which is where a one-click "make this look like a normal road" goes to die, so they are
a row of chips across the top of the graph instead — the fastest way out of a graph an author does
not understand should not be three clicks deep. Each chip's tooltip is the preset's description.

Applying a preset does more than swap the graph. It also tops the material's layers up to the
preset's `samplerCount`, and — for the presets in `PRESET_WANTS_LIGHTING` — turns lighting on for
channel 0, which is material state the graph has no way to express.

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
4. any `warnings` the encoder returns are toasted, once per distinct message — including the
   pre-existing defects it decided to write back rather than refuse.

Continuous drags coalesce: `NumberInput`'s `onChange` marks the edit transient (working document
only) and its `onCommit` — fired once, on release — does the four steps above.

Undo and redo swap the whole `TrackDocument` out from under the mode. Re-decoding the material
from the restored bytes would mean re-parsing a multi-megabyte BRRES on every `Ctrl+Z`, so the
mode keeps a `WeakMap<TrackDocument, docs>` instead and puts the exact document that produced each
version back.

![Editing the culling, live](screenshots/material-09-cull-draw-nothing.png)

![And back again after Ctrl+Z](screenshots/material-12-after-undo.png)

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
- It returns `false` when the scene has not loaded that archive (`map_model.brres` is never
  rendered), when the model or material name is not in the edited bytes, or when the bytes do not
  parse. The edit is still written into the track; only the picture is behind. The status line
  says exactly that and names the way out: *"… The viewport cannot show this one live, so press
  Refresh (Ctrl+Alt+R) to rebuild it."*
- It does not itself fall back to a scene rebuild, because a rebuild is much slower and should be
  the user's decision rather than a hidden cost of moving a slider. **Refresh track** below is
  that fallback, made explicit.
- The `Solo` toggle and the mesh highlight use the per-draw visibility overrides Model mode
  introduced (`setEditorMeshVisible` / `setEditorMeshHighlight`). Leaving the mode clears both.

### Refresh track

The button that always works. It is in the top bar (so it is reachable from every mode), under the
material overlay in the viewport, and on `Ctrl+Alt+R` — `Ctrl+R` belongs to the browser.

It rebuilds the noclip scene from the **track document as it is in memory**: the same
`buildU8(track.archiveEntries)` the initial load uses, so every archive the editor has rewritten —
a material, an imported texture, a replaced `posteffect` file, an edited `course.kmp` — is in the
bytes the renderer parses. It is the picture of what Export would write, not of the file on disk.

The wiring is a `sceneRevision` prop on `Noclip3DViewport` plus an `onSceneReload` callback:

```
App:      refreshTrack()  ->  sceneRevision + 1, status "Rebuilding the track with your edits..."
Viewport: scene-load effect re-runs, notices the scene key did not change -> rebuild, not reopen
App:      onSceneReload({ phase: 'done' })  ->  status "Track refreshed.", button re-enabled
```

**What survives the rebuild.** `Viewer.setScene` drops the camera controller, so the rebuild saves
it together with the camera's world matrix and puts both back — the viewpoint, and for the
orthographic view modes the orbit, are exactly where they were. The editor mode, the selection, the
material highlight, the `Solo` state, the visibility layers, the render toggles and the enabled
animations all come back because they live in React state and are re-applied to the new scene:
`deliverVisualScene` hands it to Visual and Material mode, and a new `sceneEpoch` re-runs the
effects that mirror mesh edits, placed objects, depth of field and the editor mode into the
renderer. The undo history is untouched — Refresh never edits the track — so `Ctrl+Z` after a
refresh undoes the material edit, not the refresh.

**What does not.** The scene's animation clock restarts at frame 0, because a scene is created with
`initialSceneTime: 0`. Anything mid-animation (a texture SRT, the water) jumps back to its start.

Measured on `Z0.szs` by `scripts/probe-refresh-track.js` (see "Tests and the browser probe"):
two rebuilds of the same document produce frames that differ by 0.02/255 mean (0.01% of pixels),
so the rebuild is deterministic; a rebuild with one material's culling set to *Draw nothing*
differs from a clean rebuild in 5–6% of pixels (how much depends on how much of that material the
starting view shows), and matches the live hot-swapped frame to within 0.03/255. The camera ray
through the same screen point is bit-identical before and after.

![A constant colour edited live](screenshots/material-10-constant-colour.png)

![A preset applied](screenshots/material-10b-preset-applied.png)

![Solo: every other mesh hidden](screenshots/material-11-solo.png)

### Tests and the browser probe

Pure logic is unit tested with no DOM (`npm test`):

| File | Covers |
| --- | --- |
| `src/ui/material/graphModel.test.ts` | Node geometry and hit testing, marquee, socket typing and the polymorphic maths nodes, every connection rule (side, self, cycle, type), edge replacement, delete / move / snap / duplicate / copy / paste (including `stageTemplate` surviving both), pan-zoom-fit maths, auto layout, and the raw-stage node's shape. |
| `src/ui/material/materialDoc.test.ts` | Every inspector field → document mapping, colour conversion in both directions, the layer list's add / remove / reorder, the light mask, and the preset's channel-0 lighting. |
| `src/ui/material/materialSimple.test.ts` | Every simple control → GX fields mapping: the three transparency modes and the alpha-test evaluator behind them, wrap and filter choices, environment mapping, the three shading modes, two-sidedness and depth write, which konst colours and registers a stage list really reads — and the identity law, that writing back what was just read returns the same document by reference. |
| `src/ui/material/materialSimple.byteExact.test.ts` | The same round trip through `applyMaterial` into real MDL0 bytes: touching every simple control without changing a choice leaves the archive byte-for-byte identical. Runs on the object archives inside the bundled `Common.szs`, so it has teeth under `MKW_TEST_FIXTURES=bundled` too. |
| `src/ui/material/materialOutlinerModel.test.ts` | Archive naming and ordering, the tree, the search, the shared-shader badge, reference keys. |
| `src/ui/material/graphStore.test.ts` | The stage hash and both storage keys. |
| `src/lib/gxMaterial/shaderGraph.test.ts` | The retail round trip with a per-family raw-stage ceiling (zero for drivers, karts and objects; 1% for course models), a compile *and* a decompile test per node, and that every "Special step" carries a sentence. |
| `src/ui/material/MaterialInspector.test.tsx` | The inspector, the outliner, the dock's tab state and the stage table, rendered with `renderToStaticMarkup`: the five simple sections, that the hardware controls really are behind closed disclosures, that only the colours the shader reads are shown, that the preset chips are on the graph tab, that node titles name the thing rather than the register — and the assertion that no raw GX enum identifier reaches the user. |

`scripts/probe-refresh-track.js` covers Refresh on its own: it rebuilds twice to measure the noise
floor, edits a material, rebuilds again and compares the frames, checks the camera ray, the mode,
the selection and the mesh highlight are unchanged, that `Ctrl+Z` still undoes the edit afterwards,
that the keyboard shortcut disables the button while it runs, and that editing a material in
`map_model.brres` — which the scene never draws — produces the "press Refresh" status line.

```bash
PROBE_PREFIX=refresh PROBE_PORT=9355 PROBE_SIZE=1600x1000 node scripts/ui-shell-probe.mjs \
  "http://127.0.0.1:5183/?track=/dev-tracks/Z0.szs" scripts/probe-refresh-track.js
```

![Material mode with Refresh under the material overlay](screenshots/refresh-01-material-mode.png)

![The same view after Refresh, with the edited material](screenshots/refresh-02-after-refresh.png)

The end-to-end walkthrough is `scripts/probe-material-ui.js`, driven by `scripts/ui-shell-probe.mjs`
against a real Edge window:

```bash
npx vite --host 127.0.0.1 --port 5197 --strictPort
PROBE_PREFIX=material PROBE_PORT=9352 PROBE_SIZE=1720x1000 \
  node scripts/ui-shell-probe.mjs \
  "http://127.0.0.1:5197/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-material-ui.js
```

It enters the mode, resizes the dock, reads the outliner, searches, selects a material, reads the
graph and the stage table, checks the raw-stage card is read-only, drags a node, connects a wire
and gets one rejected, opens and filters the palette, adds a node, runs auto layout, zooms, opens
every inspector section, edits the culling and a constant colour, applies the lit preset and
checks it turned channel-0 lighting on, solos, undoes back, leaves the mode and reads the stored
graphs out of IndexedDB — reporting every number it saw and writing the screenshots in this
document.

A run on `Z0.szs` at the time of writing: 40 materials in 11 archives, 35 of them sharing a shader
block; the selected material decompiles to 13 nodes and 22 wires including one raw stage, compiles
back to its own 3 stages, and its `Draw nothing` culling edit reaches the viewport through
`reloadEditorMaterial` (the status line says nothing about refreshing, because it did not have to)
and comes back on `Ctrl+Z`.

`scripts/probe-material-simple.js` is the second body, for the simple/advanced split:

```bash
PROBE_PREFIX=matafter PROBE_PORT=9358 node scripts/ui-shell-probe.mjs   "http://127.0.0.1:5182/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-material-simple.js
```

It shoots the inspector as it opens and again with every disclosure expanded (1987px against
8779px on a two-layer retail material, where the old panel was 3652px with three of its seven
sections open), reads back every field label and every node title, checks no GX identifier is on
screen, and drives the live preview: it switches the skybox material's shading to Unlit and
measures how far the rendered frame moves, against a baseline of how far two frames of the
unchanged scene move on their own. A run gives 2.91 against 0.01 — the simple controls reach the
renderer.

**A gap that pass found, fixed at merge time.** `Ctrl+Z` restored the document — the control
snapped back and the status bar said "Undid last edit" — but the viewport kept the undone look,
because `MaterialMode.tsx`'s undo path restored the decoded documents out of its `WeakMap` without
pushing the restored bytes at `reloadEditorMaterial`. It now hot-swaps every material whose
document differs between the version that was showing and the one just restored, so undo and redo
both reach the viewport; when a swap cannot apply, the status line points at Refresh.