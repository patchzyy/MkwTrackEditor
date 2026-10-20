/**
 * The editor's shared UI primitives. Everything the mode panels need should come from here
 * rather than from hand-rolled markup; see `docs/UI.md` for usage and the design tokens.
 */

export { AxisGizmo, pitchFromCameraMatrix, yawFromCameraMatrix } from './AxisGizmo';
export { Button, IconButton, ToolButton, type ButtonSize, type ButtonVariant } from './Button';
export { ColorField } from './ColorField';
export { EmptyState, Skeleton } from './EmptyState';
export { Field, FieldGroup, FieldRow } from './Field';
export { LoadingOverlay } from './LoadingOverlay';
export { ContextMenu, MenuSurface, type MenuItem, type MenuSection } from './Menu';
export { NumberInput, type NumberInputProps } from './NumberInput';
export {
  applyKeyStep,
  clampNumber,
  decimalsForStep,
  formatNumberText,
  normalizeNumber,
  parseNumberText,
  roundToPrecision,
  scrubMultiplier,
  scrubValue,
  stepsForKey,
  type NumberRange,
  type ScrubModifiers,
  type ScrubOptions,
} from './numberScrub';
export { Panel, PanelBody, PanelHeader, PanelRail, PanelSection } from './Panel';
export { REFRESH_TRACK_SHORTCUT, RefreshTrackButton, type RefreshTrackButtonProps } from './RefreshTrackButton';
export { Popover } from './Popover';
export { Select, type SelectOption } from './Select';
export { SegmentedControl, type SegmentedOption } from './SegmentedControl';
export { EDITOR_SHORTCUTS, ShortcutOverlay, type ShortcutEntry, type ShortcutGroup } from './ShortcutOverlay';
export { StatusBar, useFrameRate, type StatusBarStat } from './StatusBar';
export { classifyStatusMessage, shouldToastStatus, splitStatusMessage, type StatusTone } from './statusMessage';
export { Tabs, type TabOption } from './Tabs';
export { ToastProvider, ToastViewport, useToast, useToastStore, type Toast, type ToastApi } from './Toast';
export { Toggle } from './Toggle';
export { Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarSpacer } from './Toolbar';
export { Kbd, KbdSequence, Tooltip, type TooltipSide } from './Tooltip';
export { TreeView, type TreeViewProps } from './TreeView';
export {
  ancestorIds,
  collectDescendantIds,
  collectExpandableIds,
  computeTreeWindow,
  flattenTree,
  handleTreeKey,
  type FlatTreeRow,
  type TreeNode,
  type TreeWindow,
} from './treeModel';
export { VectorInput, type Vector3Value } from './VectorInput';
export { ConfirmDialog } from './ConfirmDialog';
