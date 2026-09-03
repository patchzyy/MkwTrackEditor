// Body for scripts/ui-shell-probe.mjs. Measures whether the inspector's X/Y/Z rows are wide
// enough for real five-digit track coordinates, in every mode that has them.
//
//   PROBE_SIZE=1280x800 node scripts/ui-shell-probe.mjs "<url>" scripts/probe-vector-fit.js

const out = {};

/** True when the text in an input is wider than the box showing it. */
function clipped(input) {
  return input.scrollWidth > input.clientWidth + 1;
}

function measure() {
  const inspector = document.querySelector('.inspector');
  const fields = [...document.querySelectorAll('.inspector .uiVectorInput .uiNumberField, .inspector .vectorInputs input')];
  return {
    inspectorWidth: inspector ? Math.round(inspector.getBoundingClientRect().width) : null,
    fieldCount: fields.length,
    narrowestFieldPx: fields.length ? Math.round(Math.min(...fields.map((f) => f.getBoundingClientRect().width))) : null,
    clippedValues: fields.filter(clipped).map((f) => f.value),
    sampleValues: fields.slice(0, 6).map((f) => f.value),
  };
}

// KMP mode: select a placed object, which has position, rotation and scale rows.
clickText('KMP');
await sleep(1400);
const objectRow = qa('.kmpTreeRow .kmpTreeLabel').find((n) => /object|item|tree|kuribo/i.test(n.textContent));
if (objectRow) objectRow.click();
await sleep(700);
if (!q('.inspector .uiVectorInput, .inspector .vectorInputs')) {
  // Fall back to whatever the first selectable entity is.
  qa('.kmpTreeRow .kmpTreeLabel')[3]?.click();
  await sleep(700);
}
out.kmp = measure();
await shot('vector-fit-kmp');
await sleep(700);

// Model mode: pick a mesh from the outliner, which has position/rotation/scale too.
clickText('Model');
await sleep(1600);
qa('.modelOutlinerRow')[2]?.click();
await sleep(700);
out.model = measure();
await shot('vector-fit-model');
await sleep(700);

// Camera mode: position, rotation and the two look-at points.
clickText('Camera');
await sleep(1600);
qa('.cameraRow')[0]?.click();
await sleep(700);
out.camera = measure();
await shot('vector-fit-camera');
await sleep(700);

out.anyClipped = [out.kmp, out.model, out.camera].some((m) => m.clippedValues.length > 0);
return out;
