// Probe body for scripts/probe-model-ui.mjs: drives KMP mode through its real UI on a real track.
//
// Everything goes through the panels a user touches — the outliner tree, its search box and eye
// toggles, the tool inspector's buttons, the viewport HUD — and then reads the scene overlay and
// the track document back to check the edit actually landed.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const buttons = () => [...document.querySelectorAll('button')];
const byText = (text, root = document) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === text.toLowerCase());
const containing = (text, root = document) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase().includes(text.toLowerCase()));
const log = [];
const note = (message) => log.push(message);

function setReactInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function rows() {
  return [...document.querySelectorAll('.kmpTreeRow')];
}

function rowByLabel(text) {
  return rows().find((row) => row.querySelector('.kmpTreeName')?.textContent.trim() === text);
}

function clickRow(row, options = {}) {
  row.querySelector('.kmpTreeLabel').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
}

function expandRow(row) {
  const chevron = row.querySelector('.kmpTreeChevron');
  if (chevron && chevron.tagName === 'BUTTON' && row.getAttribute('aria-expanded') === 'false') chevron.click();
}

// --- 1. KMP mode is the default; the outliner must be there ------------------
byText('KMP')?.click();
await sleep(700);
const panel = document.querySelector('.kmpPanel');
if (!panel) return { error: 'the KMP outliner did not render', log };

const sectionRows = rows().filter((row) => row.classList.contains('isSection'));
const sectionNames = sectionRows.map((row) => row.querySelector('.kmpTreeName').textContent.trim());
note(`outliner sections: ${sectionNames.join(', ')}`);
const expectedSections = ['Start points', 'Enemy routes', 'Item routes', 'Checkpoints', 'Respawns', 'Objects', 'Routes', 'Areas', 'Cameras', 'Cannons', 'Battle finish points', 'Track settings'];
const missingSections = expectedSections.filter((name) => !sectionNames.includes(name));
if (missingSections.length > 0) return { error: `outliner is missing sections: ${missingSections.join(', ')}`, log };
if (sectionNames.some((name) => /^(KTPT|ENPT|ITPT|CKPT|GOBJ|POTI|JGPT|CNPT|MSPT|STGI|AREA|CAME)$/.test(name))) {
  return { error: 'the outliner is still showing raw section codes', log };
}
await shot('kmp-ui-01-outliner');

// --- 2. Expand a path section and select a point -----------------------------
const enemyRow = rowByLabel('Enemy routes');
expandRow(enemyRow);
await sleep(200);
const groupRow = rows().find((row) => row.classList.contains('isGroup') && row.querySelector('.kmpTreeName').textContent.startsWith('Group'));
if (!groupRow) return { error: 'no enemy path group row appeared', log };
const groupDetail = groupRow.querySelector('.kmpTreeDetail').textContent;
note(`first enemy group: ${groupDetail}`);
if (/\b25[0-9]\b/.test(groupDetail)) return { error: `group link summary shows a null slot: ${groupDetail}`, log };
expandRow(groupRow);
await sleep(200);
const pointRows = rows().filter((row) => row.classList.contains('isEntity') && row.querySelector('.kmpTreeName').textContent.startsWith('Point'));
if (pointRows.length < 3) return { error: 'the enemy group did not expand into points', log };
clickRow(pointRows[1]);
await sleep(400);
const selectedAfterClick = mkw.getKmpOverlay();
note(`overlay after selecting a point: ${JSON.stringify(selectedAfterClick)}`);
if (selectedAfterClick.points === 0) return { error: 'the scene overlay is drawing nothing', log };

// --- 3. The path tools appear and can insert a point --------------------------
const pathHeading = [...document.querySelectorAll('.kmpToolGroup h3')].map((h) => h.textContent.trim());
note(`tool groups: ${pathHeading.join(' | ')}`);
if (!pathHeading.some((text) => text.startsWith('Enemy route · group'))) {
  return { error: `the path tools did not appear for an enemy point (${pathHeading.join(' | ')})`, log };
}
const pointsBefore = kmpCounts();
const insertAfter = byText('Insert after');
if (!insertAfter) return { error: 'no "Insert after" button', log };
insertAfter.click();
await sleep(500);
const pointsAfterInsert = kmpCounts();
note(`enemy points ${pointsBefore.enemy} -> ${pointsAfterInsert.enemy}`);
if (pointsAfterInsert.enemy !== pointsBefore.enemy + 1) return { error: 'inserting an enemy point did not change the document', log };

// --- 4. Split the group, then undo everything --------------------------------
const groupsBefore = kmpCounts().enemyGroups;
const splitButton = byText('Split here');
if (splitButton && !splitButton.disabled) {
  splitButton.click();
  await sleep(500);
  note(`enemy groups ${groupsBefore} -> ${kmpCounts().enemyGroups}`);
  if (kmpCounts().enemyGroups !== groupsBefore + 1) return { error: 'splitting a group did not add a group', log };
}
await shot('kmp-ui-02-path-tools');

// Ctrl+Z twice must put both edits back.
for (let i = 0; i < 2; i++) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await sleep(400);
}
const afterUndo = kmpCounts();
note(`after undo: ${afterUndo.enemy} points, ${afterUndo.enemyGroups} groups`);
if (afterUndo.enemy !== pointsBefore.enemy || afterUndo.enemyGroups !== groupsBefore) {
  return { error: `undo did not restore the path (${afterUndo.enemy}/${afterUndo.enemyGroups} vs ${pointsBefore.enemy}/${groupsBefore})`, log };
}

// --- 5. Checkpoint tools -----------------------------------------------------
const checkpointsRow = rowByLabel('Checkpoints');
expandRow(checkpointsRow);
await sleep(200);
const checkpointGroup = rows().find((row) => row.classList.contains('isGroup') && row.closest('.kmpTree') && row.querySelector('.kmpTreeName').textContent.startsWith('Group') && rows().indexOf(row) > rows().indexOf(checkpointsRow));
expandRow(checkpointGroup);
await sleep(200);
const checkpointRow = rows().find((row) => row.querySelector('.kmpTreeName')?.textContent.startsWith('Checkpoint '));
if (!checkpointRow) return { error: 'no checkpoint row appeared', log };
clickRow(checkpointRow);
await sleep(400);
const checkpointHeadings = [...document.querySelectorAll('.kmpToolGroup h3')].map((h) => h.textContent.trim());
if (!checkpointHeadings.includes('Lap counting') || !checkpointHeadings.includes('Respawn')) {
  return { error: `the checkpoint tools did not appear (${checkpointHeadings.join(' | ')})`, log };
}
const keyButton = byText('Key');
const typesBefore = kmpCounts().keyCheckpoints;
keyButton.click();
await sleep(500);
note(`key checkpoints ${typesBefore} -> ${kmpCounts().keyCheckpoints}`);
if (kmpCounts().keyCheckpoints !== typesBefore + 1) return { error: 'marking a checkpoint as a key did not change the document', log };
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await sleep(400);
await shot('kmp-ui-03-checkpoint-tools');

// --- 6. Search filters the tree ---------------------------------------------
const search = panel.querySelector('.kmpFilter');
setReactInput(search, 'item box');
await sleep(400);
const searchRows = rows().map((row) => row.querySelector('.kmpTreeName').textContent.trim());
note(`search rows: ${searchRows.slice(0, 6).join(', ')} (${searchRows.length} total)`);
if (searchRows.length === 0) return { error: 'searching produced no rows at all', log };
if (searchRows.some((name) => name === 'Cameras')) return { error: 'the search did not filter unrelated sections away', log };
setReactInput(search, '');
await sleep(300);

// --- 7. Layer visibility: the eye toggle changes what the scene draws --------
const objectsRow = rowByLabel('Objects');
const overlayBefore = mkw.getKmpOverlay();
objectsRow.querySelector('.kmpTreeEye').click();
await sleep(500);
const overlayHidden = mkw.getKmpOverlay();
note(`overlay points ${overlayBefore.points} -> ${overlayHidden.points} with objects hidden`);
if (overlayHidden.points >= overlayBefore.points) return { error: 'hiding the object layer did not remove anything from the scene', log };
if (overlayHidden.sections.includes('GOBJ')) return { error: 'objects are still drawn after being hidden', log };
objectsRow.querySelector('.kmpTreeEye').click();
await sleep(400);
if (mkw.getKmpOverlay().points !== overlayBefore.points) return { error: 'showing the object layer again did not bring it back', log };

// --- 8. Multi-select: shift-range and the batch tools ------------------------
expandRow(rowByLabel('Enemy routes'));
await sleep(200);
const enemyPoints = rows().filter((row) => row.classList.contains('isEntity') && row.querySelector('.kmpTreeName').textContent.startsWith('Point'));
if (enemyPoints.length >= 4) {
  clickRow(enemyPoints[0]);
  await sleep(250);
  clickRow(enemyPoints[3], { shiftKey: true });
  await sleep(400);
  const heading = [...document.querySelectorAll('.kmpToolGroup h3')].map((h) => h.textContent.trim());
  note(`multi-select headings: ${heading.slice(0, 3).join(' | ')}`);
  if (!heading.some((text) => /^\d+ selected$/.test(text))) return { error: 'shift-clicking did not produce a multi-selection', log };
  if (!heading.includes('Move them together')) return { error: 'the batch move tools did not appear', log };
}
await shot('kmp-ui-04-multi-select');

// --- 9. Viewport HUD toggles -------------------------------------------------
const hud = document.querySelector('.kmpToolsOverlay');
if (!hud) return { error: 'the KMP tool HUD did not render', log };
const corridor = containing('Checkpoint corridor', hud);
const wallsBefore = mkw.getKmpOverlay().routeDeviationSegments;
corridor.click();
await sleep(500);
const wallsAfter = mkw.getKmpOverlay().routeDeviationSegments;
note(`checkpoint corridor quads ${wallsBefore} -> ${wallsAfter}`);
if (wallsAfter <= wallsBefore) return { error: 'the checkpoint corridor toggle drew nothing', log };
corridor.click();
await sleep(300);

const connectEnemy = containing('Enemy', hud);
connectEnemy.click();
await sleep(500);
const linkOverlay = mkw.getKmpOverlay();
note(`overlay with connect mode armed: ${linkOverlay.points} points`);
if (linkOverlay.points <= overlayBefore.points) return { error: 'arming connect mode did not add the group end handles', log };
await shot('kmp-ui-05-connect-mode');
connectEnemy.click();
await sleep(300);

// --- 10. Validation list selects the record it is about ----------------------
const issueLinks = [...document.querySelectorAll('.kmpIssueLink')];
note(`validation issues with a target: ${issueLinks.length}`);
if (issueLinks.length > 0) {
  const message = issueLinks[0].textContent.trim();
  issueLinks[0].click();
  await sleep(600);
  const selectedName = document.querySelector('.kmpSelectionName')?.textContent.trim();
  note(`clicking "${message}" selected: ${selectedName}`);
  if (!selectedName || selectedName === 'Nothing selected') return { error: 'clicking a validation issue selected nothing', log };
}
await shot('kmp-ui-06-validation');

// --- 11. Every remaining section opens its own property sheet ----------------
const sheets = {};
for (const [sectionLabel, expected] of [
  ['Respawns', 'Respawn'],
  ['Cannons', 'Cannon'],
  ['Battle finish points', 'Battle'],
  ['Start points', 'Used by'],
  ['Track settings', 'Lap'],
]) {
  const row = rowByLabel(sectionLabel);
  if (!row) { sheets[sectionLabel] = 'section missing'; continue; }
  expandRow(row);
  await sleep(200);
  const target = sectionLabel === 'Track settings' ? row : rows()[rows().indexOf(row) + 1];
  if (!target || (sectionLabel !== 'Track settings' && !target.classList.contains('isEntity'))) {
    sheets[sectionLabel] = 'empty in this track';
    continue;
  }
  clickRow(target);
  await sleep(450);
  const labels = [...document.querySelectorAll('.kmpInspector label')].map((l) => l.childNodes[0]?.textContent?.trim() ?? '');
  sheets[sectionLabel] = labels.some((text) => text.toLowerCase().includes(expected.toLowerCase()))
    ? 'ok'
    : `no "${expected}" field (${labels.slice(0, 8).join(', ')})`;
}
note(`property sheets: ${JSON.stringify(sheets)}`);
const brokenSheets = Object.entries(sheets).filter(([, value]) => value !== 'ok' && value !== 'empty in this track');
if (brokenSheets.length > 0) return { error: `property sheets missing fields: ${JSON.stringify(brokenSheets)}`, log };
await shot('kmp-ui-07-track-settings');

function kmpCounts() {
  const doc = window.__mkwTrackDocument;
  const file = doc && doc.kmpFile;
  if (!file) return { enemy: -1, enemyGroups: -1, keyCheckpoints: -1 };
  return {
    enemy: file.enemyPoints.length,
    enemyGroups: file.enemyGroups.length,
    keyCheckpoints: file.checkpoints.filter((c) => c.type !== 0xff && c.type !== 0).length,
  };
}

return { ok: true, sections: sectionNames, log };
