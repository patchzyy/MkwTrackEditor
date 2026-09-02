# Editor module map

`src/ui/App.tsx` used to be a ~9000 line file that held all UI, state, history, inspectors,
content browser and object metadata. It is now a ~390 line shell that composes panels; everything
else lives in the modules below. The split was a pure move-and-rename: behaviour, CSS class names
and user-visible text are unchanged.

Layering rule: `src/lib/**` is pure logic with no React import, `src/ui/**` is React. UI modules may
import from `src/lib`, never the other way round.

## Shell

| File | Responsibility |
| --- | --- |
| `src/ui/App.tsx` | Layout composition only: calls the state hooks, derives the memoised view models, and renders `TopBar` / `PlaceAssetsRail` / `Noclip3DViewport` / `InspectorPanel` / `ContentBrowser`. |
| `src/ui/topbar/TopBar.tsx` | Header bar: open `.szs`, import `Common.szs`, undo/redo, inspector toggle, export, status line, editor-mode switch. |

## Editor state (`src/ui/state/`)

All hooks are plain functions returning an object; none of them render anything.

| File | Responsibility |
| --- | --- |
| `types.ts` | `EditorSnapshot`, `InspectorSection`, `EditorModeStub`. |
| `useSelection.ts` | `selectedId` / `selectedIds` plus the synchronous `selectedIdRef` / `selectedIdsRef` mirrors and the select helpers. |
| `useTrackDocument.ts` | The loaded `TrackDocument`, the BRRES editor project state, `Common.szs` handling (bundled, persisted via IndexedDB, or user-imported), the course asset database, content-browser BRRES previews, and the URL parameters (`?track=`, `?smokeTrack=`, `?smokeCallback=`, `?smokeCommon=`). Owns `openFiles` / `importCommonArchive`. |
| `useEditorHistory.ts` | Undo/redo stacks of whole `EditorSnapshot`s, `HISTORY_LIMIT`, edit sessions for viewport drags (`beginEditSession` / `endEditSession`), and the `applyEditorChange` / `applyTransientEditorChange` entry points. |
| `useClipboard.ts` | Copy / paste / duplicate for the current selection. |
| `useKmpEditActions.ts` | Every KMP mutation: move/rotate/scale, add object, add track record, insert/fork route point, object route helpers, delete, reorder, split/merge path groups, batch offset, batch object replace, fill between, and BRRES node transforms. |
| `usePostEffectActions.ts` | Create/patch the track's `posteffect.*` files (fog, bloom, DOF, lighting). |
| `useTrackExport.ts` | Validation prompts, export, archive self-check, download. |
| `useBrowserFolders.ts` | Content browser folder model, active folder and search query. |
| `usePanelLayout.ts` | Dock sizes, collapse state, drag-to-resize handles, and the shell CSS custom properties. |
| `useEditorShortcuts.ts` | Global keyboard shortcuts (undo/redo, clipboard, W/E/R tools, fill between, delete, export). |
| `useSmokeHarness.ts` | Instrumentation for `scripts/browser-smoke*.mjs`. Only runs for `?smokeTrack=` / `?smokeCallback=`. |

`useTrackDocument` and `useEditorHistory` are mutually dependent (loading a track resets history;
history writes the track state). The cycle is broken by `trackDocument.bindHistory(history)`, which
`App` calls during render so the load effects can reach the history stack.

## Inspector (`src/ui/inspector/`)

| File | Responsibility |
| --- | --- |
| `InspectorPanel.tsx` | The right sidebar: Object/Track tabs, details summary, batch tools, KMP overview, post-effects, validation list. |
| `SelectedEntityInspector.tsx` | Binds the selected record to `useKmpEditActions` and renders `Inspector`. |
| `Inspector.tsx` | Property grid for one KMP record; delegates to the section components. |
| `sections/CheckpointSection.tsx` | CKPT endpoints and links. |
| `sections/RoutePointSection.tsx` | ENPT/ITPT point settings, deviation, POTI route/node settings. |
| `sections/AreaSection.tsx` | AREA type/shape/priority plus the per-type labels from `areas/areaInspectorConfig.ts`. |
| `sections/CameraSection.tsx` | CAME settings, camera-chain starts, view start/end. |
| `sections/RespawnCannonSection.tsx` | JGPT, CNPT and MSPT fields. |
| `sections/StageSection.tsx` | STGI track settings and lens-flare colour. |
| `sections/ObjectSetupSection.tsx` | GOBJ friendly setup: title/summary/tips, variant switcher, visibility flags, per-object settings, and the one-click object actions. |
| `sections/AdvancedObjectSection.tsx` | Raw object id / object slots / presence flags. |
| `sections/PathGroupSection.tsx` | Path group info, split/merge, group links. |
| `objectSettings/ObjectSettingsFields.tsx` | Composer for the per-object setting controls. |
| `objectSettings/ObjectSettingsFields{1,2,3}.tsx` | The per-object control blocks. They are one long chain of mutually exclusive `objectProfile.title === '…'` tests, split into three ordered chunks purely so no single file is unreadably long. Render order is preserved by rendering 1, 2, 3 in sequence. |
| `fields/` | `VectorInputs`, `ShortNumberInputs`, `ByteNumberInputs`, `ReferenceSelect`, `NumberOptionSelect`, `RgbColorField`, `RgbaColorField`, `ObjectIdSelect`. |
| `PostEffectsPanel.tsx` | Fog / bloom / DOF / lighting editors. |
| `postEffectResources.ts` | Finds and parses the track's `posteffect.*` files; also the small colour and archive-lookup helpers those editors need. |
| `optionTables.ts` | Dropdown options for the route / area / cannon sections. |
| `BatchSelectionPanel.tsx`, `FillBetweenPanel.tsx`, `KmpOverview.tsx`, `DetailsSummaryBar.tsx` | Multi-selection tools, the fill-between viewport overlay, the track graph summary, and the details header strip. |

## Content browser (`src/ui/contentBrowser/`)

| File | Responsibility |
| --- | --- |
| `ContentBrowser.tsx` | Bottom dock: folder tabs, search, asset strip. |
| `PlaceAssetsRail.tsx` | Left "Place Assets" rail of frequently dragged objects. |
| `browserFolders.ts` | Folder model (`buildBrowserFolders`), folder classification, search text and `filterBrowserFolder`. |
| `browserAssetDedupe.ts` | Collapses duplicated course assets to one representative (moved from `src/ui/`). |
| `ObjectThumbnail.tsx`, `CourseAssetThumbnail.tsx` | Asset tile previews. |

## Object and label metadata

| File | Responsibility |
| --- | --- |
| `src/ui/objects/objectCatalog.ts` | Built-in object catalog, `featuredObjectIds`, `ObjectOption`, and the object naming/search/resource helpers. |
| `src/ui/objects/objectProfiles.ts` | `getObjectInspectorProfile`, `getObjectVariantOptions`, guidance-only notes, presence-flag descriptions. |
| `src/ui/objects/objectOptionTables.ts` | Per-object dropdown option tables. |
| `src/ui/areas/areaInspectorConfig.ts` | AREA inspector config, presets, and the fog/bloom preset pickers derived from the track archive. |
| `src/ui/labels.ts` | `friendlySectionLabel`, `friendlySectionSingularLabel`, `friendlyGroupSectionLabel`, `humanizeObjectName`, `getKnownObjectName`, `fallbackObjectName`, `shortAssetName`, `friendlyTrackAssetName`, `describeBrres`, `describeCourseAsset`, `fmt`, `presentValidationIssue`. |

## Pure logic (`src/lib/`)

| File | Responsibility |
| --- | --- |
| `kmpEdit.ts` | React-free KMP document editing: copy/paste (`appendCopiedEntity`, `appendCopiedPotiPoint`, `patchCopiedEntity`), viewport drag previews (`previewMoved*`, `previewRotatedEntity`, `previewScaledEntity`, `materializeViewportInteractionTrack`), deletion selection (`getSelectionIdAfterRoutePointDeletion`), `getPathInfo`, `getReferenceCounts`, `countSectionEntities`, `parseGroupLinkText`, and the numeric field codecs (`toSigned16`/`toUnsigned16`, `decodeSigned16`/`encodeSigned16`, `setMaskedBits`, `decodeWrappedSpin`/`encodeWrappedSpin`). |
| `courseAssets.ts` | `CourseAssetRecord`, `PlaceableCourseAssetRecord`, `CourseAssetDatabase`, `mapCourseAssetToPlaceable`, `findObjectIdForAsset`, `loadCourseAssetDatabase`. `mapCourseAssetToPlaceable` takes a label resolver so this module stays free of UI imports. |
| `commonAssets.ts` | Assembling the effective `Common.szs` archive (bundled course objects, extracted asset pool, smoke-mode subset). |

## Tests

The four source-grep "audit" tests were deleted and replaced with tests that import the extracted
modules:

| File | Covers |
| --- | --- |
| `src/lib/kmpEdit.test.ts` | Builds a synthetic empty `course.kmp`, then exercises copy/paste of a GOBJ, a route point and a checkpoint, the clipboard anchor/ordering rules, route-point deletion selection, reference counts, and the numeric codecs. |
| `src/ui/objects/objectProfiles.test.tsx` | Every known object id gets a profile; every hand-written profile has dedicated controls, a path binding, or a guidance note (checked by actually rendering `ObjectSettingsFields` / `ObjectSetupSection`); featured objects are never left on the generic fallback; every variant option is a known object id. |
| `src/ui/inspector/Inspector.test.tsx` | Renders `Inspector` for each record kind and asserts the section headers, plus `BatchSelectionPanel` and `DetailsSummaryBar`. |
| `src/ui/labels.test.ts` | No raw KMP section code ever reaches the user; object name humanising; validation message rewriting. |
| `src/ui/contentBrowser/browserFolders.test.ts` | Folder model, classification, and every branch of `filterBrowserFolder`. |
