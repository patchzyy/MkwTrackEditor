// Probe body for scripts/viewport-input-probe.mjs -- Create mode's pointer pipeline with *real*
// browser mouse input (CDP `Input.dispatchMouseEvent`).
//
//   PROBE_PORT=9453 node scripts/viewport-input-probe.mjs \
//     "http://127.0.0.1:5253/scripts/viewport-harness.html?track=/dev-tracks/Z0.szs" scripts/probe-viewport-create-input.js
//
// (any page that mounts Noclip3DViewport with the dev hook works; scripts/viewport-harness.tsx is a 30-line page that
// mounts the viewport alone, because Create mode is driven here through `__mkwViewport.create.inject`).
//
// Checks, in order:
//   a) hover reports ray / hit / handleId, and `leave` fires when the pointer leaves the canvas;
//   b) a consumed press captures the pointer: `move` keeps arriving outside the canvas, `up` lands
//      wherever the button is released, the camera does not move, nothing is pointer-locked;
//   c) Escape during a consumed drag delivers `cancel`;
//   d) a passed press falls back to the camera (left-drag, right-drag, wheel);
//   e) the top view: orthographic, north-up, right/middle drag pans, the wheel zooms about the
//      cursor, and leaving restores the 3D pose.

const results = {};
const rect = JSON.parse(await evaluate('JSON.stringify((() => { const r = document.querySelector(".viewport canvas").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })())'));
const px = (fx, fy) => [rect.left + rect.width * fx, rect.top + rect.height * fy];
const cam = () => evaluate('window.__mkwViewport.getCameraMatrix().map((v) => v.toFixed(3)).join(",")');
const proj = () => evaluate('window.__mkwViewport.getCameraProjectionMatrix().map((v) => v.toFixed(7)).join(",")');
const lock = () => evaluate('document.pointerLockElement ? "locked" : null');
const events = () => evaluate('JSON.stringify(window.__createLog)');
const clearLog = () => evaluate('window.__createLog = []; true');

await evaluate(`(() => {
  window.__createLog = [];
  window.__consume = false;
  window.__apiRef = { current: null };
  const point = (id, x, z) => ({ id, position: { x, y: 0, z }, color: [1, 1, 1, 1], radius: 9, pickable: true });
  window.__mkwViewport.create.inject({
    hideCourseModel: false,
    models: [],
    overlay: { points: [], lines: [], triangles: [], labels: [] },
    groundPlaneY: 0,
    showRaceLines: false,
    cursor: 'copy',
    cameraApiRef: window.__apiRef,
    onPointer: (e) => {
      window.__createLog.push({ phase: e.phase, button: e.button, x: Math.round(e.screen.x), y: Math.round(e.screen.y), handle: e.handleId, hit: !!e.hit, shift: e.shift });
      return e.phase === 'down' && window.__consume ? 'consumed' : 'pass';
    },
  });
  return true;
})()`);
await sleep(1500);

// A pickable handle at the ground point under the canvas centre, so hover can find it.
const centre = JSON.parse(await evaluate(`JSON.stringify(window.__mkwViewport.create.simulatePointer('hover', ${rect.width / 2}, ${rect.height / 2}).event.hit.position)`));
await evaluate(`(() => {
  const c = ${JSON.stringify(centre)};
  window.__mkwViewport.create.inject({
    hideCourseModel: false, models: [], groundPlaneY: 0, showRaceLines: false, cursor: 'copy', cameraApiRef: window.__apiRef,
    overlay: { points: [{ id: 'handle-a', position: { x: c.x, y: 0, z: c.z }, color: [1, 1, 1, 1], radius: 9, pickable: true }], lines: [], triangles: [], labels: [] },
    onPointer: (e) => {
      window.__createLog.push({ phase: e.phase, button: e.button, x: Math.round(e.screen.x), y: Math.round(e.screen.y), handle: e.handleId, hit: !!e.hit, shift: e.shift });
      return e.phase === 'down' && window.__consume ? 'consumed' : 'pass';
    },
  });
  return true;
})()`);
await sleep(800);
results.cursor = await evaluate('document.querySelector(".viewport canvas").style.cursor');

// ---------------------------------------------------------------- a) hover and leave
await clearLog();
const [cx, cy] = px(0.5, 0.5);
await mouse.move(cx - 80, cy - 80);
await mouse.move(cx, cy);
await mouse.move(cx + 2, cy + 1);
await mouse.move(cx + 120, cy + 90);
await mouse.move(rect.left - 20, cy); // out of the canvas (over the page edge / toolbar side)
await sleep(100);
const hoverLog = JSON.parse(await events());
results.hover = {
  count: hoverLog.filter((e) => e.phase === 'hover').length,
  handleOverHandle: hoverLog.some((e) => e.phase === 'hover' && e.handle === 'handle-a'),
  handleAway: hoverLog.filter((e) => e.phase === 'hover' && e.handle === null).length,
  allHaveHit: hoverLog.filter((e) => e.phase === 'hover').every((e) => e.hit),
  leave: hoverLog.filter((e) => e.phase === 'leave').length,
};

// ---------------------------------------------------------------- b) consumed press captures
await evaluate('window.__consume = true; true');
await clearLog();
const camBefore = await cam();
await mouse.down(cx - 200, cy - 100, { button: 'left' });
await mouse.move(cx - 150, cy - 60, { button: 'left' });
await mouse.move(cx, cy, { button: 'left' });
await mouse.move(rect.left + rect.width + 60, cy + 30, { button: 'left' }); // outside the canvas
await sleep(50);
results.consumedState = JSON.parse(await evaluate('JSON.stringify({ captured: window.__mkwViewport.create.isCaptured(), pointer: window.__mkwViewport.getPointerState() })'));
await mouse.up(rect.left + rect.width + 60, cy + 30, { button: 'left' });
await sleep(100);
const dragLog = JSON.parse(await events());
results.consumedDrag = {
  phases: dragLog.map((e) => e.phase).join(','),
  upOutsideCanvas: dragLog.some((e) => e.phase === 'up' && e.x > rect.width),
  cameraUnchanged: (await cam()) === camBefore,
  locked: await lock(),
  capturedAfter: await evaluate('window.__mkwViewport.create.isCaptured()'),
};

// ---------------------------------------------------------------- c) Escape cancels
await clearLog();
await mouse.down(cx, cy, { button: 'left' });
await mouse.move(cx + 40, cy + 20, { button: 'left' });
await key('Escape', { code: 'Escape', keyCode: 27 });
await sleep(100);
await mouse.up(cx + 40, cy + 20, { button: 'left' });
await sleep(100);
const escLog = JSON.parse(await events());
results.escape = { phases: escLog.map((e) => e.phase).join(','), capturedAfter: await evaluate('window.__mkwViewport.create.isCaptured()') };

// A consumed right press is the tools' too (no look, no pointer lock).
await clearLog();
const camBeforeRight = await cam();
await mouse.drag([cx, cy], [cx + 80, cy + 40], { button: 'right', steps: 5 });
await sleep(100);
const rightLog = JSON.parse(await events());
results.consumedRight = { phases: rightLog.map((e) => e.phase).join(','), button: rightLog[0]?.button, cameraUnchanged: (await cam()) === camBeforeRight, locked: await lock() };

// ---------------------------------------------------------------- d) passed presses drive the camera
await evaluate('window.__consume = false; true');
await clearLog();
const c0 = await cam();
await mouse.drag([cx, cy], [cx + 90, cy + 40], { button: 'left', steps: 6 });
const c1 = await cam();
await mouse.drag([cx, cy], [cx - 60, cy - 30], { button: 'right', steps: 6 });
const c2 = await cam();
await mouse.wheel(cx, cy, -240);
const c3 = await cam();
const passLog = JSON.parse(await events());
results.passed = {
  leftDragMovedCamera: c1 !== c0,
  rightDragMovedCamera: c2 !== c1,
  wheelMovedCamera: c3 !== c2,
  phases: passLog.map((e) => e.phase).join(','),
  locked: await lock(),
  pointer: await evaluate('JSON.stringify(window.__mkwViewport.getPointerState())'),
};

// ---------------------------------------------------------------- e) top view
const before3d = await cam();
await evaluate(`window.__apiRef.current.frameBounds({ x: ${centre.x - 3000}, y: 0, z: ${centre.z - 3000} }, { x: ${centre.x + 3000}, y: 100, z: ${centre.z + 3000} }); true`);
await sleep(900);
await evaluate('window.__apiRef.current.setTopView(true); true');
await sleep(900);
const top0 = { cam: await cam(), proj: await proj() };
results.top = JSON.parse(await evaluate('JSON.stringify({ isTop: window.__apiRef.current.isTopView(), pose: window.__apiRef.current.getPose() })'));
const projVals = top0.proj.split(',').map(Number);
results.top.orthographic = projVals[11] === 0 && projVals[15] === 1;

// The world point under the cursor must not move when zooming about it.
const probeAt = [cx + 150, cy - 100];
const worldUnder = (x, y) => evaluate(`JSON.stringify((() => { const r = window.__apiRef.current.screenToRay(${x - rect.left}, ${y - rect.top}); const t = (0 - r.origin.y) / r.direction.y; return { x: Math.round(r.origin.x + r.direction.x * t), z: Math.round(r.origin.z + r.direction.z * t) }; })())`);
const w0 = JSON.parse(await worldUnder(probeAt[0], probeAt[1]));
await mouse.wheel(probeAt[0], probeAt[1], -300);
await sleep(200);
const topZoom = { cam: await cam(), proj: await proj() };
const w1 = JSON.parse(await worldUnder(probeAt[0], probeAt[1]));
results.top.zoom = { scaleChanged: topZoom.proj !== top0.proj, worldBefore: w0, worldAfter: w1, stable: Math.abs(w0.x - w1.x) < 40 && Math.abs(w0.z - w1.z) < 40 };

await mouse.drag([cx, cy], [cx + 100, cy + 60], { button: 'right', steps: 6 });
await sleep(150);
const topPan = await cam();
results.top.pan = { right: topPan !== topZoom.cam, orthographicStill: (await proj()).split(',')[15] === '1.0000000' };
await mouse.drag([cx, cy], [cx - 100, cy - 60], { button: 'middle', steps: 6 });
await sleep(150);
results.top.pan.middle = (await cam()) !== topPan;
await shot('create-d-input-top');
await sleep(600);

await evaluate('window.__apiRef.current.setTopView(false); true');
await sleep(800);
results.top.restoredPerspective = (await proj()).split(',')[11] === '-1.0000000';
results.top.poseAfter = JSON.parse(await evaluate('JSON.stringify(window.__apiRef.current.getPose())'));
results.top.before3dDiffers = before3d !== (await cam());

return results;
