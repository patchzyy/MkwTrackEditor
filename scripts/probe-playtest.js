// Body for scripts/ui-shell-probe.mjs. Drives the whole playtest feature against the mock
// runtime: opens the top-bar popover, starts a session, holds accelerate through the countdown
// and into the race, restarts, and leaves. Reports enough for Node to assert on.
//
//   node scripts/ui-shell-probe.mjs "http://127.0.0.1:5186/?smokeTrack=/dev-tracks/Z0.szs" scripts/probe-playtest.js
//
// The session runs against `createMockPlaytestRuntime` (see src/ui/playtest/runtimeFactory.ts),
// so this probe never needs the Kinoko WebAssembly module.

const prefix = window.__probePrefix ?? 'playtest';
const report = { prefix };

const hudProbe = () => q('.playtestHud [data-playtest-stage]');
const hudState = () => {
  const node = hudProbe();
  if (!node) return null;
  return { stage: node.dataset.playtestStage, speed: node.dataset.playtestSpeed, time: node.dataset.playtestTime };
};
const speedValue = () => Number.parseInt(hudState()?.speed ?? '0', 10) || 0;
const holdKey = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
const releaseKey = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
const waitFor = async (predicate, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(100);
  }
  return false;
};

// ---------------------------------------------------------------- before

report.before = {
  toolbar: !!q('.viewportToolbar'),
  routeHud: !!q('.routeVisibilityHud'),
  status: q('.uiStatusMessage')?.textContent ?? null,
  kmpOverlayPoints: mkw?.getKmpOverlay?.().points ?? null,
  docksCollapsed: qa('.uiPanelRail').length,
};

// ---------------------------------------------------------------- popover

const playtestButton = qa('.topBarCenter button').find((n) => n.textContent.trim() === 'Playtest');
report.buttonFound = !!playtestButton;
report.buttonDisabled = playtestButton ? playtestButton.disabled : null;
if (!playtestButton) return report;
playtestButton.click();
await sleep(250);

report.menu = {
  open: !!q('.playtestMenu .uiPopover'),
  fields: qa('.playtestMenu .uiFieldLabel').map((n) => n.textContent.trim()),
  vehicleGroups: qa('.playtestMenu optgroup').map((n) => n.label),
  characters: qa('.playtestMenu select')[0]?.options.length ?? 0,
  vehicles: qa('.playtestMenu select')[1]?.options.length ?? 0,
  driftModes: qa('.playtestMenu .uiSegment').map((n) => n.textContent.trim()),
  controls: qa('.playtestMenu .playtestControlsRow').map((n) => n.textContent.trim()),
};
await shot(`${prefix}-01-menu`);
await sleep(500);

// ---------------------------------------------------------------- start

const startButton = qa('.playtestMenu button').find((n) => n.textContent.trim() === 'Start');
report.startFound = !!startButton;
if (!startButton) return report;
startButton.click();

report.hudAppeared = await waitFor(() => !!q('.playtestHud'), 15000);
report.running = await waitFor(() => hudState() !== null && hudState().stage !== 'loading', 20000);
report.duringSession = {
  status: q('.uiStatusMessage')?.textContent ?? null,
  toolbarHidden: !q('.viewportToolbar'),
  routeHudHidden: !q('.routeVisibilityHud'),
  viewportPlaytesting: !!q('.viewport.isPlaytesting'),
  docksCollapsed: qa('.uiPanelRail').length,
};

// Hold accelerate through the countdown and into the race.
holdKey('Space');
report.countdownStage = hudState()?.stage ?? null;
await sleep(1200);
await shot(`${prefix}-02-countdown`);

report.reachedRace = await waitFor(() => hudState()?.stage === 'race', 20000);
const speedAtFlag = speedValue();
await sleep(2000);
const speedAfter = speedValue();
report.race = {
  stage: hudState()?.stage ?? null,
  time: hudState()?.time ?? null,
  speedAtFlag,
  speedAfter,
  accelerated: speedAfter > speedAtFlag && speedAfter > 0,
  lap: q('.playtestHudLap')?.textContent ?? null,
  speedText: q('.playtestHudSpeed')?.textContent ?? null,
  timeText: q('.playtestHudTime')?.textContent ?? null,
};
await shot(`${prefix}-03-racing`);
await sleep(600);

// Steering has to reach the runtime as well; the kart keeps rolling while it turns.
holdKey('ArrowRight');
await sleep(1200);
releaseKey('ArrowRight');
report.steering = { speed: hudState()?.speed ?? null, time: hudState()?.time ?? null };

// ---------------------------------------------------------------- restart

const timeBeforeRestart = hudState()?.time ?? null;
releaseKey('Space');
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true, cancelable: true }));
await sleep(400);
report.restart = {
  timeBefore: timeBeforeRestart,
  stageAfter: hudState()?.stage ?? null,
  timeAfter: hudState()?.time ?? null,
  wentBackToIntro: hudState()?.stage === 'intro',
};

// ---------------------------------------------------------------- exit

window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));
report.exited = await waitFor(() => !q('.playtestHud'), 8000);
await sleep(900);
report.after = {
  toolbar: !!q('.viewportToolbar'),
  routeHud: !!q('.routeVisibilityHud'),
  status: q('.uiStatusMessage')?.textContent ?? null,
  kmpOverlayPoints: mkw?.getKmpOverlay?.().points ?? null,
  playtestFlag: document.documentElement.dataset.playtest ?? null,
};
report.overlayRestored = report.after.kmpOverlayPoints === report.before.kmpOverlayPoints;
await shot(`${prefix}-04-back-in-editor`);
await sleep(400);

report.ok =
  report.menu.open &&
  report.running &&
  report.reachedRace &&
  report.race.accelerated &&
  report.duringSession.toolbarHidden &&
  report.restart.wentBackToIntro &&
  report.exited &&
  report.after.toolbar &&
  report.overlayRestored;

return report;
