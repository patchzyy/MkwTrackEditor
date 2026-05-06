# Prompt Audit

Status: complete against the current `Prompt.txt` scope.

This file maps `Prompt.txt` requirements to current evidence in the repo. It is not a completion claim. Any item marked `open` or `weak` still needs more work or stronger verification.

## Core architecture

- `noclip.website` is the renderer base, vendored and edited in-tree: `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`
- React + TypeScript editor shell: `src/ui/App.tsx`, `src/ui/Noclip3DViewport.tsx`
- Scene-native editor overlays, picking, and gizmos are in the renderer path, not DOM-only overlays:
  - `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`
  - `src/ui/Noclip3DViewport.tsx`
- Status: implemented

## Load / render / edit / export flow

- Drag-and-drop `.szs` loading:
  - `src/ui/App.tsx`
  - `src/lib/track.ts`
- Track render from noclip MKWii stack:
  - `src/ui/Noclip3DViewport.tsx`
  - `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`
- Export playable `.szs`:
  - `src/lib/track.ts`
  - export UI in `src/ui/App.tsx`
- Status: implemented

## Rendering requirements

- BRRES / Common / ObjFlow / posteffect integration:
  - `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`
  - `src/lib/objflow.ts`
  - `src/lib/noclipBrres.ts`
- Browser smoke verifies real render path:
  - `scripts/browser-smoke.mjs`
  - `scripts/browser-smoke-real-tracks.mjs`
- Status: implemented, verified on sampled real tracks

## Editor UI

- First screen is the editor, not a landing page:
  - `src/ui/App.tsx`
- Bottom-docked content browser and collapsible inspector:
  - `src/ui/App.tsx`
  - `src/styles.css`
- View mode toggle:
  - `src/ui/App.tsx`
  - `src/ui/Noclip3DViewport.tsx`
- Status: implemented

## Required tools

- Translate / rotate / scale gizmos:
  - `src/ui/Noclip3DViewport.tsx`
  - `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`
- Fly camera / mouse look:
  - `src/ui/Noclip3DViewport.tsx`
- Scene-native point / route / handle rendering and picking:
  - `src/ui/Noclip3DViewport.tsx`
  - `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`
- Drag-and-drop placement + collision snapping:
  - `src/ui/Noclip3DViewport.tsx`
- Node/path editing:
  - `src/ui/App.tsx`
  - `src/lib/kmp.ts`
- Status: implemented

## Content browser

- Bottom dock, collapsible:
  - `src/ui/App.tsx`
- Real object/resource browser with thumbnails:
  - `src/ui/App.tsx`
  - `src/lib/noclipBrres.ts`
- Course asset database / extracted asset pool:
  - `scripts/build-course-asset-db.mjs`
  - `scripts/build-extracted-asset-pool.mjs`
  - `public/data/MarioKartWii/Race/Course/course-asset-db.json`
  - `public/data/MarioKartWii/Race/Course/ExtractedAssets.u8`
- Status: implemented

## MKWii data requirements

- Yaz0 / U8 / KMP / KCL parsing:
  - `src/lib/yaz0.ts`
  - `src/lib/u8.ts`
  - `src/lib/kmp.ts`
  - `src/lib/kcl.ts`
- Common / ObjFlow mapping:
  - `src/lib/objflow.ts`
- Status: implemented

## KMP editing

- Supported sections:
  - `KTPT`, `ENPT/ENPH`, `ITPT/ITPH`, `CKPT/CKPH`, `GOBJ`, `POTI`, `AREA`, `CAME`, `JGPT`, `CNPT`, `MSPT`, `STGI`
  - evidence: `src/lib/kmp.ts`, `src/ui/App.tsx`
- Unknown data preservation:
  - evidence: `src/lib/kmp.ts`, `src/lib/formats.test.ts`
- Status: implemented, partially verified

## KCL

- Collision parsing / mesh / raycasting:
  - `src/lib/kcl.ts`
- Snap selected objects/path nodes to collision:
  - `src/ui/Noclip3DViewport.tsx`
- Collision overlay:
  - `src/ui/Noclip3DViewport.tsx`
  - `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`
- Status: implemented

## Export / packaging

- Repack edited archive:
  - `src/lib/track.ts`
- Preserve untouched files:
  - `src/lib/formats.test.ts`
- Inject Common resources only when needed:
  - `src/lib/track.ts`
  - `src/lib/formats.test.ts`
- Status: implemented, verified

## Validation

- Validation before export and sidebar presentation:
  - `src/lib/track.ts`
  - `src/ui/App.tsx`
- Friendly presentation instead of raw engine jargon:
  - `src/ui/App.tsx`
- Status: implemented

## Testing requirements

- Unit/integration coverage:
  - `src/lib/formats.test.ts`
- Browser smoke:
  - `scripts/browser-smoke.mjs`
- Real-track browser smoke from both prompt directories:
  - `scripts/browser-smoke-real-tracks.mjs`
- Status: implemented, verified on sampled tracks

## Added requirements

### 1. Course asset extraction database

- Evidence:
  - `scripts/build-course-asset-db.mjs`
  - `public/data/MarioKartWii/Race/Course/course-asset-db.json`
- Status: implemented

### 2. Easy access to common objects / nicer inspector

- Evidence:
  - quick-access strip in `src/ui/App.tsx`
  - object thumbnails / search / grouped folders in `src/ui/App.tsx`
- Status: implemented

### 3. Base-game logic objects should have nice inspector tabs

- Prompt status:
  - deferred for now in `Prompt.txt` (`NOT FOR NOW! 3. ...`)
- Evidence:
  - profile generation in `src/ui/App.tsx`
  - object-specific setup branches in `src/ui/App.tsx`
- audit check:
  - `src/ui/objectProfileAudit.test.ts`
  - verifies every named object profile in `getObjectInspectorProfile(...)` is either backed by explicit inspector controls or explicitly marked guidance-only
  - verifies the profiled inspector exposes `Object Setup`, `Setup Surface`, and `Advanced object data`
  - `src/ui/objectProfileFeaturedCoverage.test.ts`
  - verifies every highlighted common object in the content browser maps to a specific inspector profile instead of falling through to the generic object fallback
  - `src/ui/objectProfileVariantCoverage.test.ts`
  - verifies every variant-switcher family in the inspector maps to a specific profile with concrete object ids
- Status: substantial coverage implemented, with stronger structural verification than before
- Deferred:
  - not currently a completion blocker because the prompt explicitly marks this item as "NOT FOR NOW!"

### 4. Drag/drop and moving items should raycast against KCL

- Evidence:
  - `src/ui/Noclip3DViewport.tsx`
  - browser smoke verifies collision-snapped placement
- Status: implemented, partially verified

### 5. Better gizmo

- Evidence:
  - scene-native axis / plane / center handles in `src/ui/Noclip3DViewport.tsx`
  - renderer-side draw/pick support in `vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts`
- Status: implemented

### 6. Normal / Dev / Top / Ortho views

- Evidence:
  - `src/ui/App.tsx`
  - `src/ui/Noclip3DViewport.tsx`
- Status: implemented

### 7. Hold button to snap to edges / vertices / points

- Evidence:
  - `src/lib/kcl.ts`
  - `src/ui/Noclip3DViewport.tsx`
- Status: implemented

### 8. Full undo/redo stack

- Evidence:
  - history implementation in `src/ui/App.tsx`
  - browser smoke now exercises duplicate + undo + redo on a real placed object
- Status: implemented, partially verified

### 9. Selection & editing ergonomics

- Evidence:
  - multi-select and marquee in `src/ui/Noclip3DViewport.tsx`
  - copy / duplicate / paste / delete / batch edits in `src/ui/App.tsx`
  - selected / hovered / invalid scene highlights in renderer path
- audit check:
  - `src/ui/editorErgonomicsAudit.test.ts`
  - verifies structural evidence for multi-select state, marquee selection, batch selection UI, copy/duplicate/paste/delete paths, batch snap, and renderer-backed selected/hovered/invalid highlight state
- Status: implemented, with stronger structural verification than before

### 10. Avoid spamming technical details

- Evidence:
  - content browser / validation / status wording cleanup in `src/ui/App.tsx`
- Status: implemented

## Current open audit items

- No current prompt blockers.
- Final verification evidence:
  - `npm test` passed (`20/20` tests)
  - `npm run build` passed
  - `npm run smoke:browser` passed
  - `npm run smoke:browser:real-tracks` passed across both prompt track directories
  - `curl -I http://localhost:5175/` returned `HTTP/1.1 200 OK`
  - post-run `tasklist.exe /FI "IMAGENAME eq chrome.exe"` returned `INFO: No tasks are running which match the specified criteria.`
