// Body for scripts/ui-shell-probe.mjs. Checks the hop button behaves like the button it is on a
// real controller: it brakes, so accelerate + hop at a standstill charges a stand-still
// mini-turbo, and it still hops and drifts while moving. Keyboard and gamepad.
//
//   PROBE_PREFIX=playtest-hop PROBE_PORT=9371 PROBE_SIZE=1600x1000 \
//     node scripts/ui-shell-probe.mjs "http://127.0.0.1:5232/?track=/dev-tracks/Z0.szs" \
//     scripts/probe-playtest-hop.js
//
// The HUD publishes `data-playtest-charge` as `kind:level:percent`, where kind is `standstill`
// or `drift` and level is 0 charging / 1 blue / 2 orange -- the shim's kart floats [31..32]
// (see docs/PLAYTEST.md) after `playtestHudCharge` has named them.

const prefix = window.__probePrefix ?? 'playtest-hop';
const report = { prefix };

const hud = () => q('.playtestHud [data-playtest-stage]');
const stage = () => hud()?.dataset.playtestStage ?? null;
const charge = () => hud()?.dataset.playtestCharge ?? '';
const speed = () => Number.parseInt(hud()?.dataset.playtestSpeed ?? '0', 10) || 0;
const hold = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
const release = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
const waitFor = async (predicate, timeoutMs = 25000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(60);
  }
  return false;
};
/** Highest speed and the charge states seen over `ms`. */
const sample = async (ms) => {
  const charges = [];
  let peak = 0;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    peak = Math.max(peak, speed());
    const value = charge();
    if (value && charges[charges.length - 1] !== value) charges.push(value);
    await sleep(30);
  }
  return { peak, charges };
};
/**
 * Restart, and wait for the race to start *again*. Waiting only for `race` would pass instantly,
 * because the stage is still `race` for the frames between the key press and the reset.
 */
const restartRace = async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true, cancelable: true }));
  const backToIntro = await waitFor(() => stage() === 'intro', 5000);
  const racing = await waitFor(() => stage() === 'race', 30000);
  return backToIntro && racing;
};

// ---------------------------------------------------------------- start a session on a kart

const playtestButton = qa('.topBarCenter button').find((n) => n.textContent.trim() === 'Playtest');
if (!playtestButton) return { ...report, error: 'no Playtest button' };
playtestButton.click();
await sleep(300);

report.controlHints = qa('.playtestMenu .playtestControlsRow').map((n) => n.textContent.trim());

// A kart, not the default bike: only karts get the orange super mini-turbo.
const vehicleSelect = qa('.playtestMenu select')[1];
const kartOption = [...(vehicleSelect?.options ?? [])].find((option) => /Wild Wing|Flame Flyer|Standard Kart M/.test(option.textContent));
if (vehicleSelect && kartOption) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(vehicleSelect, kartOption.value);
  vehicleSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(150);
}
report.vehicle = vehicleSelect ? vehicleSelect.options[vehicleSelect.selectedIndex]?.textContent ?? null : null;

// Manual drift, whatever the last session left in localStorage: automatic drift ignores the hop
// button entirely (`KartState` only reads `DriftInput` when `AutoDrift` is off), so the whole
// point of this probe would be untestable.
const manual = qa('.playtestMenu .uiSegment, .playtestMenu button').find((n) => n.textContent.trim() === 'Manual');
if (manual) {
  manual.click();
  await sleep(150);
}
report.driftMode = qa('.playtestMenu .uiSegment, .playtestMenu button')
  .filter((n) => /^(Manual|Auto)$/.test(n.textContent.trim()))
  .map((n) => [n.textContent.trim(), n.getAttribute('aria-checked'), n.getAttribute('aria-pressed'), n.className].join(' | '));

const startButton = qa('.playtestMenu button').find((n) => n.textContent.trim() === 'Start');
if (!startButton) return { ...report, error: 'no Start button' };
startButton.click();

report.hudAppeared = await waitFor(() => !!q('.playtestHud'), 20000);
// Sit still through the intro and the countdown; a stand-still mini-turbo needs a standstill.
report.reachedRace = await waitFor(() => stage() === 'race', 40000);
if (!report.reachedRace) return report;

// ------------------------------------------------- (a) accelerate + Shift at the start line

hold('Space');
hold('ShiftLeft');
// ~90 frames at 60 Hz.
const charging = await sample(1600);
const chargedState = charge();
// The charge bar is the only thing that tells the user a mini-turbo is building, so check it is
// actually on screen and not just in the DOM.
const chargeNode = q('.playtestHudCharge');
const chargeRect = chargeNode ? chargeNode.getBoundingClientRect() : null;
report.chargeIndicator = {
  present: !!chargeNode,
  label: chargeNode ? chargeNode.textContent.trim() : null,
  visible: !!chargeRect && chargeRect.width > 0 && chargeRect.height > 0 && chargeRect.bottom <= window.innerHeight && chargeRect.right <= window.innerWidth,
  rect: chargeRect ? { x: Math.round(chargeRect.x), y: Math.round(chargeRect.y), w: Math.round(chargeRect.width), h: Math.round(chargeRect.height) } : null,
  viewport: { w: window.innerWidth, h: window.innerHeight },
};
await shot(`${prefix}-01-standstill-charge`);
release('ShiftLeft');
const afterRelease = await sample(1200);
release('Space');

report.hopStandstill = {
  chargeWhileHeld: chargedState,
  chargesSeen: charging.charges,
  speedWhileCharging: charging.peak,
  peakAfterRelease: afterRelease.peak,
};

// Control: the same 1.6 s of accelerate with no hop, so "well above walking speed" is measured
// against this machine's own number rather than a guess.
await restartRace();
hold('Space');
await sample(1600);
const plain = await sample(1200);
release('Space');
report.plainStart = { peak: plain.peak };
report.standstillMiniTurboWorks =
  /^standstill:1:/.test(report.hopStandstill.chargeWhileHeld) &&
  report.hopStandstill.peakAfterRelease > report.plainStart.peak * 1.3;

// ------------------------------------------------- (b) Shift while moving still hops + drifts

await restartRace();
hold('Space');
// Get up to drifting speed first -- Mario Kart Wii will not start a manual drift from a crawl.
// ~103 km/h is 48 units/frame, which is where the start straight on the test track runs out.
await waitFor(() => speed() >= 100, 10000);
const cruising = speed();
hold('ShiftLeft');
hold('ArrowRight');
// About 85 frames: long enough for the hop, the drift and a blue mini-turbo, short enough that
// full lock has not put the kart into the scenery yet.
const drifting = await sample(1400);
await shot(`${prefix}-02-drift-charge`);
release('ShiftLeft');
release('ArrowRight');
const afterDrift = await sample(1200);
release('Space');

const driftLevels = drifting.charges.filter((entry) => entry.startsWith('drift:')).map((entry) => Number(entry.split(':')[1]));
report.hopDrift = {
  cruisingSpeed: cruising,
  chargesSeen: drifting.charges.slice(0, 12),
  maxDriftLevel: driftLevels.length > 0 ? Math.max(...driftLevels) : null,
  speedDuringDrift: drifting.peak,
  peakAfterDrift: afterDrift.peak,
};
report.driftMiniTurboWorks =
  report.hopDrift.cruisingSpeed >= 100 && report.hopDrift.maxDriftLevel !== null && report.hopDrift.maxDriftLevel >= 1;

// ------------------------------------------------- (c) the same through a gamepad

const fakePad = {
  connected: true,
  id: 'probe pad',
  index: 0,
  mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
};
const pressPad = (index, down) => {
  fakePad.buttons[index] = { pressed: down, touched: down, value: down ? 1 : 0 };
};
Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [fakePad] });

await restartRace();
pressPad(0, true); // A: accelerate
pressPad(5, true); // RB: hop / drift
const padCharging = await sample(1600);
const padChargedState = charge();
await shot(`${prefix}-03-gamepad-charge`);
pressPad(5, false);
const padAfterRelease = await sample(1200);
pressPad(0, false);

report.gamepadStandstill = {
  chargeWhileHeld: padChargedState,
  chargesSeen: padCharging.charges,
  peakAfterRelease: padAfterRelease.peak,
};
report.gamepadMiniTurboWorks =
  /^standstill:1:/.test(padChargedState) && padAfterRelease.peak > report.plainStart.peak * 1.3;

window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));
report.exited = await waitFor(() => !q('.playtestHud'), 10000);

report.ok = report.standstillMiniTurboWorks && report.driftMiniTurboWorks && report.gamepadMiniTurboWorks && report.exited;
return report;
