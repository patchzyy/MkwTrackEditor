// Probe body for scripts/viewport-input-probe.mjs — the camera controls that must keep working
// now that the editor, not noclip's InputManager, owns the mouse:
// keyboard fly (WASD / Q / E / shift), wheel zoom, right-drag look, left-drag look on empty
// space, and the orthographic view modes' orbit.
const out = {};
const rect = JSON.parse(await evaluate('JSON.stringify(window.__canvasRect())'));
const px = (fx, fy) => [Math.round(rect.left + rect.width * fx), Math.round(rect.top + rect.height * fy)];
const cam = () => evaluate('window.__mkwViewport.getCameraMatrix().map((v) => v.toFixed(3)).join(",")');
const eye = async () => {
  const m = JSON.parse(await evaluate('JSON.stringify(window.__mkwViewport.getCameraMatrix())'));
  return [m[12], m[13], m[14]];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

await evaluate('document.querySelector(".viewport canvas").focus()');
await sleep(300);

// --- keyboard fly ------------------------------------------------------------------------
const holdKey = async (code, keyCode, ms) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await sleep(ms);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await sleep(250);
};

// Fly keys only move the camera while a look gesture is held — the same "hold the mouse to fly"
// rule the editor already had (`withSuppressedCameraMovementKeys`), and the same one Unreal uses.
const flyWhileLooking = async (code, keyCode, ms = 500) => {
  const [dx, dy] = px(0.5, 0.5);
  const from = await eye();
  await mouse.down(dx, dy, { button: 'right' });
  await holdKey(code, keyCode, ms);
  await mouse.up(dx, dy, { button: 'right' });
  await sleep(250);
  return Math.round(dist(from, await eye()));
};

const idleBefore = await eye();
await holdKey('KeyW', 87, 400);
out.forwardWithoutMouseHeld = Math.round(dist(idleBefore, await eye()));
out.forwardDistance = await flyWhileLooking('KeyW', 87);
out.backDistance = await flyWhileLooking('KeyS', 83);
out.strafeDistance = await flyWhileLooking('KeyD', 68);
out.riseDistance = await flyWhileLooking('KeyE', 69);
out.sinkDistance = await flyWhileLooking('KeyQ', 81);
out.shiftFastDistance = await (async () => {
  const [dx, dy] = px(0.5, 0.5);
  const from = await eye();
  await mouse.down(dx, dy, { button: 'right' });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 8 });
  await holdKey('KeyW', 87, 500);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  await mouse.up(dx, dy, { button: 'right' });
  await sleep(250);
  return Math.round(dist(from, await eye()));
})();
out.keyboardFlyWorks = out.forwardDistance > 0 && out.backDistance > 0 && out.strafeDistance > 0 && out.riseDistance > 0 && out.sinkDistance > 0;
out.shiftMakesFlyFaster = out.shiftFastDistance > out.forwardDistance;

// --- wheel zoom --------------------------------------------------------------------------
const [wx, wy] = px(0.5, 0.5);
let before = await eye();
for (let i = 0; i < 6; i++) await mouse.wheel(wx, wy, -240);
await sleep(500);
const afterZoomIn = await eye();
out.wheelInDistance = Math.round(dist(before, afterZoomIn));
for (let i = 0; i < 6; i++) await mouse.wheel(wx, wy, 240);
await sleep(500);
out.wheelOutDistance = Math.round(dist(afterZoomIn, await eye()));
out.wheelZoomWorks = out.wheelInDistance > 0 && out.wheelOutDistance > 0;

// --- right-drag look ---------------------------------------------------------------------
let camBefore = await cam();
await mouse.drag(px(0.5, 0.5), px(0.25, 0.6), { button: 'right', steps: 8 });
await sleep(300);
out.rightDragLook = camBefore !== (await cam());
out.lockAfterRightDrag = await evaluate('document.pointerLockElement ? "locked" : null');

// --- left-drag look on empty space -------------------------------------------------------
camBefore = await cam();
await mouse.drag(px(0.5, 0.06), px(0.7, 0.2), { button: 'left', steps: 8 });
await sleep(300);
out.leftDragLook = camBefore !== (await cam());
out.lockAfterLeftDrag = await evaluate('document.pointerLockElement ? "locked" : null');

// --- orthographic orbit (Numpad 7 = top-down) ---------------------------------------------
await evaluate('document.querySelector(".viewport canvas").focus()');
await key('7', { code: 'Numpad7', keyCode: 103, location: 3 });
await sleep(1200);
out.viewMode = await evaluate(`(() => { const s = document.querySelector('.viewportModeSelect select'); return s ? s.value : null; })()`);
camBefore = await cam();
// From a corner, where there is no KMP marker to grab.
await mouse.drag(px(0.06, 0.08), px(0.2, 0.2), { button: 'left', steps: 8 });
await sleep(400);
out.orthoLeftDragOrbits = camBefore !== (await cam());
camBefore = await cam();
await mouse.drag(px(0.5, 0.5), px(0.66, 0.6), { button: 'right', steps: 8 });
await sleep(400);
out.orthoRightDragOrbits = camBefore !== (await cam());
camBefore = await cam();
for (let i = 0; i < 4; i++) await mouse.wheel(wx, wy, -240);
await sleep(400);
out.orthoWheelZooms = camBefore !== (await cam());
await shot('viewport-camera-01-ortho-orbit');
await key('1', { code: 'Numpad1', keyCode: 97, location: 3 });
await sleep(1000);
out.viewModeBack = await evaluate(`(() => { const s = document.querySelector('.viewportModeSelect select'); return s ? s.value : null; })()`);

// --- nothing left holding the mouse ------------------------------------------------------
out.finalLock = await evaluate('document.pointerLockElement ? "locked" : null');
out.finalBodyCursor = await evaluate('document.body.style.cursor');
out.finalPointerState = JSON.parse(await evaluate('JSON.stringify(window.__mkwViewport.getPointerState())'));
return out;
