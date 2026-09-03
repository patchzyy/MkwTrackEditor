// Probe body for scripts/probe-model-ui.mjs: screenshots the KMP record inspector.
//
//   npx vite --host 127.0.0.1 --port 5181 --strictPort
//   node scripts/probe-model-ui.mjs "http://127.0.0.1:5181/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-inspector-ux.js
//
// Pass INSPECTOR_SHOT_PREFIX=inspector-before to capture the same views from an older build.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prefix = new URLSearchParams(location.search).get('shotPrefix') ?? 'inspector-after';
const log = [];
const note = (message) => log.push(message);

const rows = () => [...document.querySelectorAll('.kmpTreeRow')];
const rowByName = (name) => rows().find((row) => row.querySelector('.kmpTreeName')?.textContent.trim() === name);
const expand = (row) => {
  const chevron = row?.querySelector('.kmpTreeChevron');
  if (chevron && chevron.tagName === 'BUTTON' && row.getAttribute('aria-expanded') === 'false') chevron.click();
};
const byAria = (label) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);
function setInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Make the inspector the star of the screenshot.
[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'KMP')?.click();
await sleep(400);
byAria('Hide content browser')?.click();
byAria('Show left panel')?.click();
await sleep(400);

// --- an object -------------------------------------------------------------
// The search box is the reliable way in: it expands whatever matches in both builds.
const search = document.querySelector('.kmpFilter, input[aria-label="Search track data"]');
setInput(search, 'kuribo');
await sleep(600);
for (const row of rows()) expand(row);
await sleep(400);
const objectRow = rows().find((row) => row.classList.contains('isEntity'));
objectRow?.querySelector('.kmpTreeLabel')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(500);
note(`picked ${objectRow?.querySelector('.kmpTreeName')?.textContent.trim()}`);
setInput(search, '');
await sleep(400);
byAria('Hide left panel')?.click();
await sleep(400);
note(`object inspector: ${document.querySelector('.inspector')?.innerText.replace(/\s*\n\s*/g, ' · ').slice(0, 400)}`);
await shot(`${prefix}-01-object`);

// --- the same object with everything opened --------------------------------
for (const toggle of [...document.querySelectorAll('.inspectorDisclosureToggle, .advancedDetails summary')]) toggle.click();
await sleep(400);
await shot(`${prefix}-02-object-advanced`);

// --- the actions menu ------------------------------------------------------
const actions = byAria('Actions');
if (actions) {
  actions.click();
  await sleep(300);
  note(`actions menu: ${[...document.querySelectorAll('.uiMenu [role="menuitem"]')].map((i) => i.textContent.trim()).join(' | ')}`);
  await shot(`${prefix}-03-actions-menu`);
  actions.click();
  await sleep(200);
}

// --- a checkpoint ----------------------------------------------------------
byAria('Show left panel')?.click();
await sleep(300);
expand(rowByName('Checkpoints'));
await sleep(250);
const groupRow = rows().find((row, index) => row.classList.contains('isGroup') && index > rows().indexOf(rowByName('Checkpoints')));
expand(groupRow);
await sleep(250);
const checkpointRow = rows().find((row) => row.querySelector('.kmpTreeName')?.textContent.startsWith('Checkpoint '));
checkpointRow?.querySelector('.kmpTreeLabel')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(500);
byAria('Hide left panel')?.click();
await sleep(400);
note(`checkpoint inspector: ${document.querySelector('.inspector')?.innerText.replace(/\s*\n\s*/g, ' · ').slice(0, 400)}`);
await shot(`${prefix}-04-checkpoint`);

// --- the other record types still render ------------------------------------
for (const [section, name] of [['Respawns', 'respawn'], ['Areas', 'area'], ['Cameras', 'camera'], ['Track settings', 'stage']]) {
  byAria('Show left panel')?.click();
  await sleep(300);
  const sectionRow = rowByName(section);
  expand(sectionRow);
  await sleep(250);
  const target = section === 'Track settings' ? sectionRow : rows()[rows().indexOf(sectionRow) + 1];
  target?.querySelector('.kmpTreeLabel')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(400);
  byAria('Hide left panel')?.click();
  await sleep(300);
  note(`${name}: ${document.querySelector('.inspector')?.innerText.replace(/\s*\n\s*/g, ' · ').slice(0, 260)}`);
  await shot(`${prefix}-05-${name}`);
}

return { ok: true, log, buttonsInInspector: [...document.querySelectorAll('.inspector button')].length };
