// Probe body for scripts/viewport-input-probe.mjs — the "a drag keeps the mouse" half of the
// mouse model, driven with real browser mouse input.
//
// Covers the second user report: "when they had a gizmo and moved just a tiny bit out of the view
// area it would (1) desync the model from where it can be selected and (2) instantly lose gizmo
// control. It would be nicer to keep gizmo control until you let go of the mouse."
//
//   1. Model mode: grab a translate handle, drag across the canvas edge into the inspector dock
//      and then outside the window, release out there. The drag must follow the whole way, the
//      document's transform must equal the rendered one, the mesh must be pickable where it is
//      drawn, and Ctrl+Z must put it back.
//   2. Escape mid-drag must put the mesh back instead of leaving the renderer ahead of the
//      document.
//   3. KMP mode: the same off-canvas drag on an object marker.

const results = {};
const rect = JSON.parse(await evaluate('JSON.stringify(window.__canvasRect())'));
const px = (fx, fy) => [rect.left + rect.width * fx, rect.top + rect.height * fy];
const lock = () => evaluate('document.pointerLockElement ? "locked" : null');
const pointerState = async () => JSON.parse(await evaluate('JSON.stringify(window.__mkwViewport.getPointerState())'));

/** Finds a gizmo handle of the given axis around the selected thing. */
const findHandle = (fx, fy, axis) => evaluate(`(() => {
  const r = window.__canvasRect();
  const cx = r.left + r.width * ${fx}, cy = r.top + r.height * ${fy};
  for (let d = 0; d <= 200; d += 4) {
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
      const p = window.__mkwViewport.pickHandleAt(cx + dx, cy + dy);
      if (p && p.kind === 'axis' && p.axis === '${axis}') return { x: cx + dx, y: cy + dy, id: p.id };
    }
  }
  return null;
})()`);

// ============================================================ 1. Model mode
await evaluate(`window.__clickText('Model')`);
await sleep(2000);

const meshSpot = await evaluate(`(() => {
  const r = window.__canvasRect();
  for (let sy = 0.35; sy <= 0.8; sy += 0.02)
    for (let sx = 0.3; sx <= 0.7; sx += 0.02) {
      const x = r.left + r.width * sx, y = r.top + r.height * sy;
      if (window.__mkwViewport.pickMeshAt(x, y)) return { x, y, fx: sx, fy: sy };
    }
  return null;
})()`);
results.meshSpot = meshSpot;
await mouse.click(meshSpot.x, meshSpot.y);
await sleep(700);

const target = await evaluate('JSON.stringify(window.__mkwViewport.getSelectedMesh()[0].target)');
results.selectedLabel = await evaluate('window.__mkwViewport.getSelectedMesh()[0].label');

const read = `(() => {
  const sel = window.__mkwViewport.getSelectedMesh();
  const bounds = window.__mkwViewport.getMeshBounds(${target});
  const doc = window.__mkwTrackDocument;
  const edit = ((doc && doc.meshEdits) || []).find((e) => JSON.stringify(e.target) === JSON.stringify(${target}));
  return JSON.stringify({
    selectionLength: sel.length,
    viewportTranslation: sel.length ? sel[0].transform.translation : null,
    documentTranslation: edit ? edit.transform.translation : null,
    renderedCenter: bounds ? { x: Math.round(bounds.center.x), y: Math.round(bounds.center.y), z: Math.round(bounds.center.z) } : null,
  });
})()`;
results.before = JSON.parse(await evaluate(read));

const handle = await findHandle(meshSpot.fx, meshSpot.fy, 'x');
results.handle = handle;

const trace = [];
await mouse.down(handle.x, handle.y);
await sleep(120);
trace.push({ where: 'press', ...JSON.parse(await evaluate(read)), pointer: await pointerState() });
const path = [
  ['inside canvas', handle.x + 60, handle.y - 10],
  ['canvas edge', rect.left + rect.width - 2, handle.y - 20],
  ['inspector dock', rect.left + rect.width + 90, handle.y - 30],
  ['outside window', viewport.width + 400, handle.y - 40],
  ['above window', viewport.width + 400, -250],
];
for (const [where, x, y] of path) {
  await mouse.move(x, y, { button: 'left' });
  await sleep(160);
  trace.push({ where, ...JSON.parse(await evaluate(read)), pointer: await pointerState() });
}
await shot('viewport-gizmo-01-dragging-outside');
await mouse.up(viewport.width + 400, -250);
await sleep(700);
results.dragTrace = trace;
results.dragKeptControlOffCanvas = trace.every((t) => t.where === 'press' || t.pointer.drag === 'gizmo');
results.after = JSON.parse(await evaluate(read));
results.lockAtEnd = await lock();
results.pointerStateAtEnd = await pointerState();
await shot('viewport-gizmo-02-after-release-outside');

// The renderer and the document have to agree, and the gizmo has to still be there.
const t = results.after;
results.renderedMatchesDocument =
  t.documentTranslation !== null &&
  t.viewportTranslation !== null &&
  Math.abs(t.documentTranslation.x - t.viewportTranslation.x) < 1e-6 &&
  Math.abs(t.documentTranslation.y - t.viewportTranslation.y) < 1e-6 &&
  Math.abs(t.documentTranslation.z - t.viewportTranslation.z) < 1e-6 &&
  Math.abs(t.renderedCenter.x - (results.before.renderedCenter.x + t.documentTranslation.x)) < 2;
results.selectionSurvivedDrag = t.selectionLength > 0;

// Clicking the mesh where it is now drawn must select it.
const newSpot = await evaluate(`(() => {
  const r = window.__canvasRect();
  const wanted = JSON.stringify(${target});
  for (let sy = 0.05; sy <= 0.95; sy += 0.015)
    for (let sx = 0.03; sx <= 0.97; sx += 0.015) {
      const x = r.left + r.width * sx, y = r.top + r.height * sy;
      const p = window.__mkwViewport.pickMeshAt(x, y);
      if (p && p.drawOpIndex === ${target}.drawOpIndex && p.componentIndex === ${target}.componentIndex) return { x, y };
    }
  return null;
})()`);
results.meshFoundAtNewPosition = newSpot !== null;
if (newSpot) {
  // Deselect first so "it selected" means something.
  await mouse.click(rect.left + rect.width * 0.5, rect.top + rect.height * 0.02);
  await sleep(400);
  await mouse.click(newSpot.x, newSpot.y);
  await sleep(500);
  results.clickAtNewPositionSelectedIt =
    (await evaluate(`JSON.stringify(window.__mkwViewport.getSelectedMesh().map((e) => e.target.drawOpIndex))`)) ===
    (await evaluate(`JSON.stringify([${target}.drawOpIndex])`));
}

// Undo puts it back.
await evaluate('document.querySelector(".viewport canvas").focus()');
await key('z', { code: 'KeyZ', keyCode: 90, modifiers: 2 });
await sleep(900);
results.afterUndo = JSON.parse(await evaluate(read));
results.undoRestoredIt =
  results.afterUndo.documentTranslation === null ||
  (Math.abs(results.afterUndo.documentTranslation.x) < 1e-6 && Math.abs(results.afterUndo.documentTranslation.z) < 1e-6);
results.undoRestoredRender = Math.abs(results.afterUndo.renderedCenter.x - results.before.renderedCenter.x) < 2;
await shot('viewport-gizmo-03-after-undo');

// ============================================================ 2. Escape cancels a drag
const escSpot = await evaluate(`(() => {
  const r = window.__canvasRect();
  for (let sy = 0.35; sy <= 0.8; sy += 0.02)
    for (let sx = 0.3; sx <= 0.7; sx += 0.02) {
      const x = r.left + r.width * sx, y = r.top + r.height * sy;
      if (window.__mkwViewport.pickMeshAt(x, y)) return { x, y, fx: sx, fy: sy };
    }
  return null;
})()`);
if (escSpot) {
  await mouse.click(escSpot.x, escSpot.y);
  await sleep(600);
  const escTarget = await evaluate('JSON.stringify(window.__mkwViewport.getSelectedMesh()[0].target)');
  const escRead = `(() => {
    const b = window.__mkwViewport.getMeshBounds(${escTarget});
    const d = window.__mkwTrackDocument;
    return JSON.stringify({
      renderedCenterX: b ? Math.round(b.center.x) : null,
      edits: ((d && d.meshEdits) || []).length,
    });
  })()`;
  const escBefore = JSON.parse(await evaluate(escRead));
  const escHandle = await findHandle(escSpot.fx, escSpot.fy, 'x');
  if (escHandle) {
    await mouse.down(escHandle.x, escHandle.y);
    await mouse.move(escHandle.x + 120, escHandle.y, { button: 'left' });
    await sleep(200);
    const escDuring = JSON.parse(await evaluate(escRead));
    await key('Escape', { code: 'Escape', keyCode: 27 });
    await sleep(500);
    const escAfter = JSON.parse(await evaluate(escRead));
    await mouse.up(escHandle.x + 120, escHandle.y);
    await sleep(300);
    results.escape = { before: escBefore, during: escDuring, after: escAfter, afterRelease: JSON.parse(await evaluate(escRead)) };
    results.escapeMovedThenPutItBack =
      escDuring.renderedCenterX !== escBefore.renderedCenterX &&
      Math.abs(escAfter.renderedCenterX - escBefore.renderedCenterX) < 2 &&
      escAfter.edits === escBefore.edits;
  }
}

// ============================================================ 3. KMP mode object drag
await evaluate(`window.__clickText('KMP')`);
await sleep(1800);
const marker = await evaluate(`(() => {
  const r = window.__canvasRect();
  for (let sy = 0.15; sy <= 0.9; sy += 0.015)
    for (let sx = 0.08; sx <= 0.92; sx += 0.015) {
      const x = r.left + r.width * sx, y = r.top + r.height * sy;
      const p = window.__mkwViewport.pickHandleAt(x, y);
      if (p && p.kind === 'point' && /^(GOBJ|ENPT|ITPT|JGPT|KTPT|POTI)/.test(p.id)) return { x, y, id: p.id };
    }
  return null;
})()`);
results.kmpMarker = marker;
if (marker) {
  const kmpRead = `(() => {
    const d = window.__mkwTrackDocument;
    const e = d && d.kmp ? d.kmp.entities.find((n) => n.id === ${JSON.stringify(marker.id)}) : null;
    return JSON.stringify(e ? { x: e.position.x, y: e.position.y, z: e.position.z } : null);
  })()`;
  const kmpBefore = JSON.parse(await evaluate(kmpRead));
  await mouse.down(marker.x, marker.y);
  await sleep(120);
  const kmpTrace = [];
  for (const [where, x, y] of [
    ['inside canvas', marker.x + 70, marker.y + 30],
    ['canvas edge', rect.left + rect.width - 2, marker.y + 40],
    ['inspector dock', rect.left + rect.width + 100, marker.y + 50],
    ['outside window', viewport.width + 350, marker.y + 60],
  ]) {
    await mouse.move(x, y, { button: 'left' });
    await sleep(160);
    kmpTrace.push({ where, position: JSON.parse(await evaluate(kmpRead)), pointer: await pointerState() });
  }
  await mouse.up(viewport.width + 350, marker.y + 60);
  await sleep(600);
  const kmpAfter = JSON.parse(await evaluate(kmpRead));
  results.kmpDrag = { before: kmpBefore, trace: kmpTrace, after: kmpAfter };
  results.kmpDragKeptControl = kmpTrace.every((t) => t.pointer.drag === 'entity' || t.pointer.gesture === 'drag');
  results.kmpDragMovedIt = JSON.stringify(kmpBefore) !== JSON.stringify(kmpAfter);
  await shot('viewport-gizmo-04-kmp-drag-outside');

  await evaluate('document.querySelector(".viewport canvas").focus()');
  await key('z', { code: 'KeyZ', keyCode: 90, modifiers: 2 });
  await sleep(800);
  results.kmpAfterUndo = JSON.parse(await evaluate(kmpRead));
  results.kmpUndoRestoredIt = JSON.stringify(results.kmpAfterUndo) === JSON.stringify(kmpBefore);
}

// ============================================================ 4. The window loses focus mid-drag
// A drag interrupted by anything other than Escape must still land its edit and let go of the
// mouse, or the renderer and the document drift apart with no way back.
await evaluate(`window.__clickText('Model')`);
await sleep(1800);
const blurSpot = await evaluate(`(() => {
  const r = window.__canvasRect();
  for (let sy = 0.35; sy <= 0.8; sy += 0.02)
    for (let sx = 0.3; sx <= 0.7; sx += 0.02) {
      const x = Math.round(r.left + r.width * sx), y = Math.round(r.top + r.height * sy);
      if (window.__mkwViewport.pickMeshAt(x, y)) return { x, y, fx: sx, fy: sy };
    }
  return null;
})()`);
if (blurSpot) {
  await mouse.click(blurSpot.x, blurSpot.y);
  await sleep(700);
  const blurTarget = await evaluate('JSON.stringify(window.__mkwViewport.getSelectedMesh()[0].target)');
  const blurRead = `(() => {
    const b = window.__mkwViewport.getMeshBounds(${blurTarget});
    const d = window.__mkwTrackDocument;
    const e = ((d && d.meshEdits) || []).find((n) => JSON.stringify(n.target) === JSON.stringify(${blurTarget}));
    return JSON.stringify({ renderedX: b ? Math.round(b.center.x) : null, docX: e ? e.transform.translation.x : null });
  })()`;
  const blurBefore = JSON.parse(await evaluate(blurRead));
  const blurHandle = await findHandle(blurSpot.fx, blurSpot.fy, 'x');
  if (blurHandle) {
    await mouse.down(blurHandle.x, blurHandle.y);
    await mouse.move(blurHandle.x + 140, blurHandle.y, { button: 'left' });
    await sleep(200);
    const blurDuring = JSON.parse(await evaluate(blurRead));
    await blurWindow();
    const blurAfter = JSON.parse(await evaluate(blurRead));
    const blurPointer = await pointerState();
    mouse.reset();
    await sleep(300);
    results.blur = { before: blurBefore, during: blurDuring, after: blurAfter, pointer: blurPointer };
    results.blurEndedTheDragAndCommitted =
      blurPointer.gesture === null &&
      blurAfter.docX !== null &&
      Math.abs(blurAfter.renderedX - (blurBefore.renderedX + blurAfter.docX)) < 2;
    // And the viewport is still usable afterwards.
    const nextSpot = await evaluate(`(() => {
      const r = window.__canvasRect();
      for (let sy = 0.3; sy <= 0.85; sy += 0.02)
        for (let sx = 0.25; sx <= 0.75; sx += 0.02) {
          const x = Math.round(r.left + r.width * sx), y = Math.round(r.top + r.height * sy);
          const p = window.__mkwViewport.pickMeshAt(x, y);
          if (p && !window.__mkwViewport.pickHandleAt(x, y)) return [x, y];
        }
      return null;
    })()`);
    if (nextSpot) {
      await mouse.click(nextSpot[0], nextSpot[1]);
      await sleep(600);
      results.stillSelectableAfterBlur = (await evaluate('window.__mkwViewport.getSelectedMesh().length')) > 0;
    }
    await shot('viewport-gizmo-05-after-window-blur');
  }
}

results.finalLock = await lock();
results.finalPointerState = await pointerState();
return results;
