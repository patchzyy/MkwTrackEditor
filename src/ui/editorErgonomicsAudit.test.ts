import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const uiDir = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.resolve(uiDir, 'App.tsx'), 'utf8');
const viewportSource = readFileSync(path.resolve(uiDir, 'Noclip3DViewport.tsx'), 'utf8');
const sceneSource = readFileSync(
  path.resolve(uiDir, '../../vendor/noclip.website/src/MarioKartWii/Scenes_MarioKartWii.ts'),
  'utf8',
);

describe('editor ergonomics audit', () => {
  it('contains structural evidence for multi-select, batch edit, duplicate/delete, and hover/invalid highlighting', () => {
    expect(appSource).toContain("const [selectedIds, setSelectedIds] = useState<string[]>([])");
    expect(appSource).toContain('selectedEntities.length > 1');
    expect(appSource).toContain('BatchSelectionPanel');
    expect(appSource).toContain('Fill Between');
    expect(appSource).toContain('Post Effects');
    expect(appSource).toContain('Create Fog File');
    expect(appSource).toContain('posteffect/posteffect.bdof_demo');
    expect(appSource).toContain('Create Lighting File');
    expect(appSource).toContain('posteffect/posteffect.blight');
    expect(appSource).toContain('fillBetweenPreviewPositions');
    expect(appSource).toContain('copySelectedEntity');
    expect(appSource).toContain('duplicateSelectedEntity');
    expect(appSource).toContain('pasteClipboardEntity');
    expect(appSource).toContain("const isViewportCameraLookActive = () => document.documentElement.dataset.viewportCameraLook === 'active';");
    expect(appSource).toContain("if (event.key.toLowerCase() === 'w') {");
    expect(appSource).toContain("setTool('translate');");
    expect(appSource).toContain("if (event.key.toLowerCase() === 'e') {");
    expect(appSource).toContain("setTool('rotate');");
    expect(appSource).toContain("if (event.key.toLowerCase() === 'r') {");
    expect(appSource).toContain("setTool('scale');");
    expect(appSource).toContain("event.key.toLowerCase() === 'l'");
    expect(appSource).toContain('Duplicate');
    expect(appSource).toContain('Paste');
    expect(appSource).toContain("event.key === 'Delete' || event.key === 'Backspace'");
    expect(appSource).toContain('Snap to Surface');
    expect(appSource).toContain('onDelete={deleteSelectedEntity}');

    expect(viewportSource).toContain('marqueeSelection');
    expect(viewportSource).toContain('event.shiftKey');
    expect(viewportSource).toContain('event.ctrlKey');
    expect(viewportSource).toContain('isAdditiveSelectionModifier');
    expect(viewportSource).toContain('onSelectMany?.(selectedIds, { additive: marquee.additive })');
    expect(viewportSource).toContain('const ENTITY_DRAG_START_THRESHOLD_PX = 4;');
    expect(viewportSource).toContain('pendingEntityDragRef');
    expect(viewportSource).toContain('topRightOverlay');
    expect(viewportSource).toContain('viewportTopRightStack');
    expect(viewportSource).toContain('fillBetweenPreview: SceneOverlayFillBetweenPreview[]');
    expect(viewportSource).toContain('const [hoveredHandle, setHoveredHandle] = useState<GizmoHandleKey | null>(null)');
    expect(viewportSource).toContain('const [previewTransform, setPreviewTransform] = useState<EntityTransformPreview | null>(null)');
    expect(viewportSource).toContain('const deltaDegrees = -normalizeAngle(angle - drag.startAngle) * (180 / Math.PI);');
    expect(viewportSource).toContain('if (selectedIdRef.current && hasCameraPositionChanged(cameraPosition, overlayCameraPositionRef.current)) {');
    expect(viewportSource).toContain('const baseLength = Math.max(180, Math.min(900, scaleLength || 260));');
    expect(viewportSource).toContain('const distanceLength = Math.max(170, distance * 0.08);');
    expect(viewportSource).toContain("const CAMERA_MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'");
    expect(viewportSource).toContain("document.documentElement.dataset.viewportCameraLook = active ? 'active' : 'inactive';");
    expect(viewportSource).toContain('const restoreSuppressedKeys = withSuppressedCameraMovementKeys(result.viewer!);');
    expect(viewportSource).toContain('setDragPreview({ id: entity.id, position, rotation: entity.rotation, scale: entity.scale });');
    expect(viewportSource).toContain('rotation: startEntity.rotation');
    expect(viewportSource).toContain('setHoveredId');
    expect(viewportSource).toContain('invalid:');

    expect(sceneSource).toContain('class EditorStartPreviewRenderer implements BaseObject');
    expect(sceneSource).toContain('PreviewDummies.u8');
    expect(sceneSource).toContain('previewDummyDriverAssetPath');
    expect(sceneSource).toContain('previewDummyKartAssetPath');
    expect(sceneSource).toContain('editorOverlayData.fillBetweenPreview');
    expect(sceneSource).toContain('centerHandle: EditorOverlayCenterHandle | null;');
    expect(sceneSource).toContain('private drawEditorArrowHead(');
    expect(sceneSource).toContain('private getEditorGizmoMetrics(length: number, active: boolean, hovered: boolean):');
    expect(sceneSource).toContain('private drawEditorRotateHandle(axis: EditorOverlayAxis): void');
    expect(sceneSource).toContain('private drawEditorLinearHandle(axis: EditorOverlayAxis, tool: \'translate\' | \'scale\'): void');
    expect(sceneSource).not.toContain('private drawEditorAxisLabel(');
    expect(sceneSource).not.toContain('plane.plane.toUpperCase()');
    expect(sceneSource).toContain('const kartModelNames = kartRRES.mdl0.map');
    expect(sceneSource).toContain('public kartInstances: MDL0ModelInstance[]');
    expect(sceneSource).toContain('selected: boolean;');
    expect(sceneSource).toContain('hovered: boolean;');
    expect(sceneSource).toContain('invalid: boolean;');
  });
});
