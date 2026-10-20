# Create mode writers (workstream A)

**Status:** modelWriter ready · kclFlags ready · kclWriter ready (driven by Kinoko) · minimapWriter ready · `index.ts` exports `writers`.

```ts
import { writers, kclFlag, KCL_ROAD, KCL_BOOST_PANEL } from './writers';   // CompileWriters + flag helpers
```

Tests: `npx vitest run src/lib/create/writers` (39 tests; the retail-extract ones skip when the extract is
missing, everything else uses only `public/`). Shared fixtures: `writerFixtures.testdata.ts` (swatches out of
`Common.szs`, meshes, a BRRES decoder) and `stadiumFixture.testdata.ts` (a closed stadium track + minimal KMP).

## Winding convention (read this)

Generators use the usual convention: **counter-clockwise is front, normal = `(b - a) x (c - a)`**, for render
meshes *and* collision. The writers adapt it to the game:

- `buildKcl` uses `(b - a) x (c - a)` as the face normal (the solid side). Roads must wind so this points up.
- `buildModelBrres` flips every triangle whose cross product agrees with its vertex normals, because the game
  draws the side where `(b - a) x (c - a)` points *away* from the normals (measured on retail course models: no
  lit retail road triangle has its cross product along its normal). So give correct, outward normals; the
  visible side follows the normals. Short/missing `normals` count as +Y.
- `buildMinimapBrres` winds everything to face up in the same sense (cross product pointing down).

## `modelWriter.ts` — `buildModelBrres(input)`

Builds a complete `.brres` (MDL0 v11 + TEX0/PLT0 [+ SRT0/PAT0]) from `GeneratedMesh`es.

What the caller must provide

- `meshes[i].surfaceId` must equal one `materials[j].surfaceId` (else it throws).
- `MaterialSource.brres` is the swatch archive; `modelName` / `materialName` locate the material (if `modelName`
  is not found every model of the swatch is searched). The swatch MDL0 must be **version 10 or 11**.
- The material block, its TEV block and the TEX0/PLT0 it samples are copied raw. A texture the swatch does not
  carry is left as a plain name reference.
- `MaterialSource.translucent` picks DrawOpa/DrawXlu and also sets the material's translucency flag to match.
  The same swatch material used both ways becomes two materials (`name`, `name_1`).
- `copyAnimations: true` copies the SRT0 / PAT0 entries that target the copied materials. Animations from
  different swatches are merged into one file per (length, loop mode, tex-matrix mode), named like retail:
  `<modelName>`, `<modelName>2`, `<modelName>3`... (the game finds them that way). CLR0 / CHR0 / SCN0 are not copied.
- **Preview models: give every `modelName` a unique value** (e.g. `preview-road-<id>-<revision>`). noclip keeps a
  global model cache keyed by MDL0 name (`Scenes_MarioKartWii.ts`, `modelCache`), so a second model called
  `course` resolves to the track's own.

What it writes

- One root node (identity), `NodeTree` / `DrawOpa` / `DrawXlu`.
- Per mesh one shape with its own position / normal / colour0 / texcoord0 arrays (float, float, RGBA8, float;
  each array exactly deduplicated) and `GX_TRIANGLES` over 16-bit indices. Pre-primitive display list, CP/XF
  registers and the shape header are byte-identical to retail's layout (checked against retail map models).
- Meshes with more than 65535 distinct vertices become extra shapes named `<name>_1`, `_2`...
  Names are made unique (shapes, materials, textures: two swatches that share a texture *name* with different
  pixels get `name_1`, and every reference is rewritten).
- Bounding boxes: root node bbox and model extents are the exact geometry bounds; each position array carries
  its own min/max. Vertex/face counts are in the model info and every shape header.
- Alignment the console needs: shapes, vertex arrays and TEV blocks start 32-byte aligned; a material's display
  lists (not the block) land on a 32-byte boundary, like retail.
- Colour0 is always written (white when `colors` is short); uvs default to 0.

Not supported: skinned meshes, more than one node, uv sets other than 0, vertex colours other than RGBA8.
Draw order inside a list is mesh order (the priority byte is 0). 70k vertices build in ~70 ms.

## `kclFlags.ts`

`kclFlag(type, variant = 0, { blight, wheelDepth, trickable, softWall, rejectRoad })` and a `KCL_*` constant for
all 32 base types (`KCL_ROAD = 0x00` ... `KCL_INVISIBLE_WALL_2 = 0x1f`, plus alias `KCL_SLOW_RAMP = KCL_JUMP_PAD`).
Layout: bits 0-4 type, 5-7 variant, 8-10 BLIGHT light set, 11-12 wheel depth, 13 trickable, 14 reject road
(`describeKclFlag` does not know it), 15 soft wall. Also `splitKclFlag`, `withBlight`, `withVariant`.

## `kclWriter.ts` — `buildKcl(collision, options?)`

- Header, positions, normals, prisms, octree, written the way retail files are and the way Kinoko's `KColData`
  reads them. Prism edge normals are outward; `enrm1` = edge c-a, `enrm2` = a-b, `enrm3` = b-c (verified on all
  prisms of retail files). Thickness 300 and sphere radius 250 as retail (`options.prismThickness`;
  `KclWriterOptions.sphereRadius` is an extra option).
- Octree: area = bounds of the prism volumes - 250 (+2000 headroom above), ranges are powers of two, cube edge
  2^12..2^15 (about 8 root cells along the longest axis); cubes subdivide while they hold more than
  `maxTrianglesPerLeaf` (default 16) down to `minCubeSize` (default 512). A leaf lists every prism whose
  extruded volume touches the cube grown by the sphere radius (exact SAT), so a sphere query anywhere in the cube
  finds it. Identical leaf lists are shared, empty leaves share one list.
- Degenerate and sliver triangles are dropped (so `parseKcl` may return fewer than you gave); order is kept.
- Limits (u16 indices in the format): 65534 triangles and 65535 distinct first-vertices (throws); more than 65535
  distinct normals (curved meshes) are snapped to a coarser angular grid until they fit. 20k hilly triangles
  build in ~350 ms.

## `minimapWriter.ts` — `buildMinimapBrres({ meshes, material })`

Retail `map_model.brres`: model `map`, nodes `map` (root, owns the geometry) / `posLD` / `posRU` (children whose
translations are the world corners of the area the minimap shows: left-down, right-up, y = 0), one shape per
mesh, positions only plus a one-entry white colour array (8-bit colour indices), no normals/uvs, `DrawOpa` only,
material copied raw. Heights are replaced by 1000; the corner square is the outline's bounds plus 12 % margin on
every side, squared. The swatch (`CreateKitCatalog.minimap`) is any retail map material (the bundled
`ExtractedAssets.u8` has Luigi Circuit's).
