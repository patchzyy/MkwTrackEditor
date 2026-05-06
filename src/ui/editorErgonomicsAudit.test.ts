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
    expect(appSource).toContain('copySelectedEntity');
    expect(appSource).toContain('duplicateSelectedEntity');
    expect(appSource).toContain('pasteClipboardEntity');
    expect(appSource).toContain('Duplicate');
    expect(appSource).toContain('Paste');
    expect(appSource).toContain("event.key === 'Delete' || event.key === 'Backspace'");
    expect(appSource).toContain('Snap to Surface');
    expect(appSource).toContain('onDelete={deleteSelectedEntity}');

    expect(viewportSource).toContain('marqueeSelection');
    expect(viewportSource).toContain('event.shiftKey');
    expect(viewportSource).toContain('onSelectMany?.(selectedIds, { additive: marquee.additive })');
    expect(viewportSource).toContain('setHoveredId');
    expect(viewportSource).toContain('invalid:');

    expect(sceneSource).toContain('selected: boolean;');
    expect(sceneSource).toContain('hovered: boolean;');
    expect(sceneSource).toContain('invalid: boolean;');
  });
});
