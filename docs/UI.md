# UI design system

The editor's look is one dark 3D-editor theme in the spirit of Unreal, Blender and Unity:
dock panels with pinned headers, a compact 11–13px type scale, one blue accent, and no debug
jargon anywhere the user can see.

Two files carry it:

- **`src/styles.css`** — design tokens (`:root`), the reset, and the *shell* classes: top bar,
  docks, viewport chrome, inspector property grids, content browser. Imported once from
  `src/main.tsx`. It `@import`s the primitives stylesheet, so importing `styles.css` is enough.
- **`src/ui/components/components.css`** — the primitives. Every class in it is prefixed
  `ui…` so it can never collide with a panel class.

Everything in `src/ui/components/` is re-exported from `src/ui/components/index.ts`:

```tsx
import { Button, Field, NumberInput, Panel, PanelHeader, PanelSection } from '../components';
```

The rule for new UI: **compose primitives, do not write new markup + CSS**. If a primitive is
missing something, add the prop to the primitive rather than a one-off class in a panel.

---

## 1. Tokens

Tokens live in `:root` in `src/styles.css`. They are the only place a raw colour or size is
written down; a panel stylesheet that writes `#1c222b` instead of `var(--surface-3)` is a bug.

### Surfaces

Darkest to lightest. The shell is layered: window → dock → panel → raised control.

| Token | Value | Used for |
| --- | --- | --- |
| `--surface-0` | `#0a0d12` | Window background, behind the viewport |
| `--surface-1` | `#10141a` | Dock panels (left, inspector, content browser) |
| `--surface-2` | `#151a21` | Panel headers, folder column, tiles |
| `--surface-3` | `#1c222b` | Hovered rows, pressed buttons |
| `--surface-4` | `#242c37` | Raised chips and badges |
| `--surface-input` | `#0d1117` | Text/number inputs and thumbnail slots |
| `--surface-hover` | `rgb(255 255 255 / 5%)` | Generic hover wash over any surface |
| `--surface-raised` | `rgb(255 255 255 / 8%)` | Generic active wash |
| `--surface-overlay` | `rgb(16 20 27 / 88%)` | Floating viewport toolbars (with `backdrop-filter`) |
| `--surface-menu` | `#171d25` | Menus and popovers |
| `--surface-tooltip` | `#1b222b` | Tooltips |

> `--surface-input` is also baked into the thumbnail renderer's clear colour
> (`src/lib/thumbnail/webglThumbnailRenderer.ts`, `DEFAULT_BACKGROUND`). If you change the
> token, change that constant too or thumbnails grow a visible frame.

### Borders

`--border-subtle` `#1a2029` · `--border` `#232a34` · `--border-strong` `#2f3844` ·
`--border-hover` `#46536580` · `--border-overlay` `rgb(255 255 255 / 11%)`.

Always `1px solid`, so they stay crisp on HiDPI.

### Text

`--text` `#e8edf5` (body) · `--text-secondary` `#c4ccd9` · `--text-muted` `#93a0b1` (captions)
· `--text-dim` `#6d7889` (metadata) · `--text-disabled` `#556070`.

### Accent, selection and semantics

- Accent: `--accent` `#47a3ff`, `--accent-strong`, `--accent-text`, `--accent-soft`, `--accent-border`
- Selection: `--selection`, `--selection-border`
- `--danger` / `--warning` / `--success`, each with a `-text`, `-soft` and `-border` variant.
  `--danger-soft-strong` is the pressed state of a destructive button.
- Transform axes: `--axis-x` `#ff6b7a`, `--axis-y` `#7fd95f`, `--axis-z` `#5aa9ff`. Shared by the
  gizmo hint and `VectorInput`, so an axis is the same colour everywhere.

### Spacing

`--space-1` 2px · `--space-2` 4px · `--space-3` 8px · `--space-4` 12px · `--space-5` 16px ·
`--space-6` 24px · `--space-7` 32px · `--space-8` 48px.

Inside a panel, `--space-2`/`--space-3` is the default rhythm. `--space-5` and up are for empty
states and dialogs only — the editor is deliberately dense.

### Type scale

`--font-size-xs` 11px (metadata, badges) · `--font-size-sm` 12px (controls, list rows) ·
`--font-size-md` 13px (body, the `:root` default) · `--font-size-lg` 15px (dialog titles).
`--font-family` is Inter with a system fallback stack.

There is no `h1`. Panel titles are 11px uppercase; section titles are 11px semibold.

### Radii and elevation

`--radius-sm` 3px (inputs, rows) · `--radius-md` 5px (buttons, tiles) · `--radius-lg` 7px
(floating toolbars) · `--radius-xl` 12px (dialogs) · `--radius-pill` 999px.

`--shadow-1` (a hairline lift) · `--shadow-2` (menus, popovers, floating toolbars) ·
`--shadow-3` (modal dialogs).

### Control metrics and motion

`--control-height` 28px · `--control-height-sm` 24px · `--topbar-height` 44px ·
`--panel-header-height` 30px · `--status-bar-height` 24px.

`--dur-fast` 110ms (hover, focus) · `--dur-base` 180ms (dock resize, disclosure) ·
`--ease` `cubic-bezier(0.32, 0.72, 0.35, 1)`. Everything is wrapped in
`@media (prefers-reduced-motion: reduce)` in the reset.

`--focus-ring` / `--focus-ring-color` — never remove a focus ring; the reset already scopes it
to `:focus-visible`.

---

## 2. Primitives

### Panel, PanelHeader, PanelBody, PanelSection, PanelRail

`Panel` is a dock panel: a pinned header strip plus a scrolling body. The header never scrolls
away.

```tsx
<Panel className="myPanel">
  <PanelHeader icon={<Video size={14} />} title="Cameras" subtitle="12" actions={<IconButton … />} />
  <PanelBody>
    <PanelSection title="Opening pan" defaultOpen>…</PanelSection>
    <PanelSection title="Advanced" defaultOpen={false}>…</PanelSection>
  </PanelBody>
</Panel>
```

- `PanelHeader` takes `collapsed`/`onToggleCollapsed` to grow a disclosure triangle.
- `PanelSection` is uncontrolled by default (`defaultOpen`); pass `open`/`onToggle` to own the
  state (for example to persist it).
- `PanelRail` is the slim icon strip a collapsed dock leaves behind. The **shell** renders it,
  not the panel — see §3.

### Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarSpacer

A horizontal strip with `role="toolbar"`. `floating` gives the translucent blurred look used
over the 3D viewport.

### Button, IconButton, ToolButton

`variant`: `default` | `primary` | `ghost` | `danger`. `size`: `sm` (24px) | `md` (28px).

- `tooltip` doubles as the accessible name when there is no visible label — so `IconButton`
  requires it.
- `shortcut="Ctrl+Z"` renders as `<kbd>` chips inside the tooltip.
- `disabledReason` replaces the tooltip while `disabled`, and the tooltip moves to a wrapper so
  it still shows (a disabled button emits no pointer events). **Always give a reason** rather
  than a silently dead button.
- `ToolButton` is the viewport/toolbar variant.

### SegmentedControl

Exclusive choice, 2–5 options, each with an optional icon and tooltip. Used for the editor-mode
switch and the inspector's Object/Track tabs.

```tsx
<SegmentedControl label="Editor mode" value={mode} options={MODE_OPTIONS} onChange={setMode} />
```

### Tabs

Underlined tab strip with roving tabindex and arrow-key movement, plus optional per-tab
`badge`. Render the matching panel yourself with `role="tabpanel"`.

### Field, FieldRow, FieldGroup

`Field` is one labelled property row: label left, control right, optional `help` under and a
short right-aligned `hint` (units, ranges) next to the label.

It renders a `<label>` normally, and a `<div role="group">` when `asGroup` is set — use
`asGroup` for multi-control rows such as `VectorInput`, otherwise clicking the label steals
focus into the first input.

`FieldRow` puts several controls on one line; `FieldGroup` is a titled cluster of fields.

### NumberInput, VectorInput

`NumberInput` is the workhorse: type a value, drag the label to scrub (Blender style), or use
the arrow / Page keys.

- `step`, `min`, `max`, `integer`, `precision`, `unit`.
- Shift = fine (×0.1), Ctrl/Cmd = coarse (×10), for both scrubbing and keys.
- Accepts a comma decimal separator; while what you have typed is not yet a number the draft
  text is kept instead of snapping to 0.

All of that maths is pure and lives in `src/ui/components/numberScrub.ts`
(`scrubValue`, `applyKeyStep`, `normalizeNumber`, `parseNumberText`, `formatNumberText`), unit
tested in `numberScrub.test.ts`. Reuse those helpers rather than re-deriving them.

`VectorInput` is three `NumberInput`s labelled X/Y/Z in the axis colours.

### Select

A native `<select>` in editor chrome. Native is deliberate: it keeps keyboard and
screen-reader behaviour correct and copes with the several-hundred-entry object lists. Pass
`options`, or `<option>`/`<optgroup>` children.

### Toggle

`variant="switch"` for property rows, `variant="checkbox"` for lists and visibility popovers.
Supports `indeterminate` and `hideLabel` (the label is still the accessible name).

### ColorField

Swatch + hex text, for RGB and RGBA values. Alpha is a separate slider when present.

### TreeView

Virtualised, keyboard-navigable tree. Only the rows in the scroll window (plus overscan) are in
the DOM, so a thousand-node model tree stays a few dozen elements.

```tsx
<TreeView
  label="Content browser folders"
  nodes={treeNodes}
  selectedId={activeId}
  expandedIds={expanded}
  onChangeExpanded={setExpanded}
  column="eye"                 // 'none' | 'eye' | 'checkbox'
  onToggleColumn={setVisible}
  onSelect={(id, node, { additive }) => …}
  onContextMenu={(id, node, event) => …}
/>
```

A `TreeNode` is `{ id, label, detail?, icon?, children?, disabled?, checked?, data? }`.

The maths is pure and separately tested in `src/ui/components/treeModel.ts` —
`flattenTree`, `computeTreeWindow`, `handleTreeKey` (the WAI-ARIA keyboard model),
`ancestorIds`, `collectDescendantIds`, `collectExpandableIds`. Use `ancestorIds` to reveal a
node you selected from elsewhere.

### Tooltip, Kbd, KbdSequence

`Tooltip` positions itself on a `side` and flips when it would leave the window. `KbdSequence`
turns `"Ctrl+Shift+Z"` into styled `<kbd>` chips.

### MenuSurface, ContextMenu

`MenuSurface` is an anchored menu of `MenuSection[]` → `MenuItem[]`
(`{ id, label, icon?, shortcut?, disabled?, disabledReason?, danger?, onSelect }`). It closes on
Escape, on outside pointerdown, and traps arrow keys. `ContextMenu` is the same surface driven
from a right-click point — pair it with `TreeView`'s `onContextMenu`.

### Popover

Anchored, dismissible container for anything that is not a list of commands (the visibility
toggle grid, colour pickers).

### Toast

Bottom-right stack. Own the store once in the shell and provide it:

```tsx
const toasts = useToastStore();
<ToastProvider value={toasts}>… <ToastViewport toasts={toasts.toasts} onDismiss={toasts.dismissToast} /></ToastProvider>
```

Nested panels call `useToast()`. Outside a provider it returns a no-op store, so components stay
renderable in tests. Errors and finished long jobs stay until dismissed; info and success
auto-dismiss.

### StatusBar

The bottom strip: the current message with a severity icon on the left, document vitals
(`StatusBarStat[]`) on the right. `useFrameRate(enabled)` supplies the FPS stat.

Severity is derived from the message text by `src/ui/components/statusMessage.ts`
(`classifyStatusMessage`, `splitStatusMessage`, `shouldToastStatus`), unit tested in
`statusMessage.test.ts`. That is how the single free-text status string the editor already had
became a typed, presentable thing without rewriting every `setStatus` call site.

### EmptyState, Skeleton

`EmptyState` = icon + one-line title + one sentence + optional action. **Use it instead of a
bare grey paragraph** — every "nothing here" in the editor should say what to do next.
`Skeleton` is the shimmer shown while a thumbnail or list resolves.

### ShortcutOverlay

The `?` sheet. `EDITOR_SHORTCUTS` is the single list of the editor's key bindings; add new
bindings there so the sheet cannot drift from reality.

### LoadingOverlay, AxisGizmo

`LoadingOverlay` is the blocking "working…" cover with an optional progress fraction.
`AxisGizmo` is the viewport orientation widget (`yawFromCameraMatrix` / `pitchFromCameraMatrix`
convert a camera matrix into its angles).

---

## 3. The shell

`src/ui/App.tsx` lays out a three-row grid: top bar, body, status bar.

```
┌──────────────────────── TopBar ────────────────────────┐
│ brand · File menu · undo/redo │ modes │ docks · Export │
├───────────┬────────────────────────────┬───────────────┤
│ left dock │        viewport            │   inspector   │
│           ├────────────────────────────┤               │
│           │      content browser       │               │
├───────────┴────────────────────────────┴───────────────┤
│ StatusBar: message                        stats · FPS  │
└────────────────────────────────────────────────────────┘
```

**Docks.** `src/ui/state/usePanelLayout.ts` owns the sizes, the collapse flags and the
drag-to-resize handles, and persists everything to `localStorage` under
`mkw.editor.layout.v1`. Drag a handle to resize; **double-click it to reset** the dock to its
default size.

A collapsed dock does not disappear — it becomes a `PanelRail` and keeps its grid slot at
`DOCK_RAIL_WIDTH`, so collapsing never reflows the viewport contents. The **shell** owns the
rail and the resize handle, which is why every mode's left panel gets both for free: a mode
only supplies `leftPanel` (an `<aside className="placeAssetsPanel …">`) and `inspector`.

**Top bar.** Brand, the File menu, undo/redo, then the loaded track's name; the mode switch in
the centre; dock visibility toggles, the shortcuts button and Export on the right. The status
line used to live here and is now the bottom status bar.

**File menu** (`src/ui/topbar/FileMenu.tsx`): Open track, Import Common.szs, Export, and a
recent-tracks section. Recents are in `src/ui/topbar/recentFiles.ts` under
`mkw.editor.recentTracks.v1`. A browser cannot re-open a file by path, so only tracks that came
from a URL (`?track=`) are re-openable; file-picked entries are listed disabled with an
explanation rather than silently doing nothing.

**Content browser** (`src/ui/contentBrowser/`): a folder *tree* (groups → folders), a tile grid,
and a details pane. `browserFolders.ts` builds the folder model; `browserEntries.ts` flattens a
folder into `BrowserEntry[]` — the one record the tile, the keyboard navigation and the details
pane all read, so a tile and its details can never disagree. Tile size is a slider persisted
under `mkw.editor.browserTileSize.v1`.

**My Assets** is the last group in that tree: the user's own `.brres` files. Dropping `.brres`
files anywhere on the content browser (or the Import button in its header) parses them, renders
a thumbnail and stores them in IndexedDB (`src/lib/assetLibrary.ts`, `src/ui/state/useAssetLibrary.ts`),
so they are back the next time the editor opens in that browser. A library tile drags into the
viewport like an object tile does, but it is merged into the course model as scenery (Model
mode's "place as scenery" path, `placeModelAsset`) because a custom model has no KMP object id;
the editor switches to Model mode so the gizmo is on it. The details pane renames, exports and
removes library assets, and for the track's own archives offers "Export archive" plus, per model,
"Export as .brres" and "Save to My Assets", which use `src/lib/brres/extractModel.ts` to pull one
MDL0 and the textures it references into a standalone file. Exports are the archive as loaded:
Model-mode edits are baked on track export, not here.

---

## 4. House rules

1. **Plain language.** "Enemy route", never `ENPH`. Section codes, node ids, byte offsets and
   raw archive paths belong in developer tooling, not in the product path. `src/ui/labels.ts`
   has the translations (`friendlySectionLabel`, `friendlySectionSingularLabel`,
   `friendlyTrackAssetName`, `presentValidationIssue`).
2. **Every icon has a name.** `IconButton` requires `tooltip`; that tooltip is the accessible
   name. Icons are [lucide-react](https://lucide.dev) at 13px (dense rows), 14px (panel
   headers, tabs) or 15px (top bar, menus). Do not mix in another icon set.
3. **Disabled things explain themselves** via `disabledReason`.
4. **No dead ends.** Any empty region gets an `EmptyState` that says what to do next.
5. **Pure logic is separate and tested.** Scrub maths, tree maths, status classification and the
   browser entry model are all plain modules with unit tests. Keep it that way.
6. **Tokens only.** No new colour literals in a panel stylesheet.

---

## 5. KMP mode

KMP mode (`src/ui/kmp/**`) is on this system: `kmp.css` uses the tokens, its rows and buttons
use the same selection recipe and control metrics as everything else, and it sits in the same
dock/rail/status-bar/toast shell. Its inspector renders the shared property sheet, so its
fields are `Field` + `NumberInput` / `VectorInput` / `Select` already.

**It keeps its own outliner** (`KmpOutliner.tsx`) rather than using `TreeView`, on purpose:

- one KMP row can stand for *many* entities (clicking "Group 3" selects all of its points), so
  selection is `string[]`, not one id;
- section rows carry viewport **visibility layers** (`kmpSections.ts`), which is a different
  model from `TreeView`'s per-node `checked`;
- rows carry a path-group accent colour and a validation badge;
- shift-click does range selection over the flattened rows.

`TreeView` could grow all four, but the generic component would end up shaped entirely by this
one caller. If you do unify them later, these are the contracts `scripts/probe-kmp-mode-ui.js`
depends on and that any rewrite has to preserve (or update in the probe):

1. `.kmpTreeChevron` is a `<button>` when the row is expandable and a
   `<span class="kmpTreeChevron kmpTreeChevronSpacer">` when it is not — the probe asserts
   `tagName === 'BUTTON'`.
2. `aria-expanded` lives on `.kmpTreeRow`, not on the chevron.
3. `.kmpTreeLabel` is the click target and handles a bubbling `MouseEvent` with `shiftKey`;
   `.kmpTreeName` contains only the label text.
4. Rows carry exactly one of `isSection` / `isGroup` / `isEntity`, plus optional `isSelected`,
   `isPrimary`, `isHidden`, and live inside `.kmpTree` inside `.kmpPanel`.
5. Tool-section headings are `<h3>` inside `.kmpToolGroup`.
6. `.kmpInspector label` rows keep the field name as `childNodes[0]` — `Field` satisfies this
   with its `<span class="uiFieldLabel">`, but `Field asGroup` renders a `<div role="group">`
   and is invisible to that check.

## 6. Material mode

Material mode (`src/ui/material/**`, `material.css`) is on the same system: tokens only, the shared
primitives for every control, and the same dock/rail/status-bar/toast shell. Two things about it
are new to the design system and are worth knowing before adding a mode of your own.

**A mode can take the bottom dock.** `ModeUi.bottomDock` is a function the shell calls with the
dock's size, collapse flag and resize handlers (`ModeBottomDock` in `src/ui/modes/types.ts`); the
returned node replaces `ContentBrowser` while the mode is active. The shell keeps owning that
state, so a mode panel resizes and collapses exactly like the browser, and the browser comes back
untouched. A mode panel that does this should keep the browser's `contentBrowser` /
`contentBrowser collapsed` / `resizing` classes and its `contentBrowserResizeHandle`, which is what
makes the two interchangeable.

**The node editor is not built from primitives.** `GraphEditor.tsx` is SVG wires plus absolutely
positioned DOM inside one transformed pan/zoom layer, and its nodes are hand-built cards — a
property row would be the wrong shape for a socket. Everything *inside* a node is still a
primitive (`Select`, `Toggle`, `ColorField`), and all the geometry, hit testing, selection and
layout maths is pure and separately tested in `graphModel.ts`, following house rule 5.

Documented in full in `docs/MATERIALS.md`.

## 7. What is left

Nothing in the shell. Two smaller things a later pass could pick up:

- KMP mode uses raw `title=` attributes where the rest of the app uses `Tooltip`. It reads
  fine, it is just not the styled tooltip.
- `Toolbar`/`ToolbarGroup` are used by the viewport chrome but not by the mode panels, which
  lay their button rows out by hand (`.kmpButtonRow`, `.cameraInspectorActions`,
  `.modelInspectorActions`, `.visualButtonRow`). Converging those on `FieldRow`/`Toolbar` would
  remove four near-identical rules.
