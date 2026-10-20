// Dev-only page that mounts `Noclip3DViewport` on its own (no app shell), served by the dev server at
// /scripts/viewport-harness.html?track=/dev-tracks/Z0.szs. The Create mode probes drive it through
// `window.__mkwViewport.create.inject(...)`, so they do not depend on the Create UI being finished.
// `window.__track` is the loaded TrackDocument; `window.__bumpScene()` rebuilds the scene (sceneRevision).
import { createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/styles.css';
import { Noclip3DViewport } from '/src/ui/Noclip3DViewport';
import { loadTrackBytes, type TrackDocument } from '/src/lib/track';

function Harness() {
  const [track, setTrack] = useState<TrackDocument | null>(null);
  const [rev, setRev] = useState(0);
  (window as any).__bumpScene = () => setRev((v) => v + 1);
  useEffect(() => {
    const path = new URL(location.href).searchParams.get('track') ?? '/dev-tracks/Z0.szs';
    void fetch(path).then((r) => r.arrayBuffer()).then((b) => loadTrackBytes(new Uint8Array(b), path.split('/').pop()!)).then(setTrack);
  }, []);
  (window as any).__track = track;
  return createElement('div', { id: 'wrap' }, createElement(Noclip3DViewport, {
    track, sceneRevision: rev, selectedId: null, selectedIds: [], tool: 'translate', viewMode: 'normal', collisionVisible: false,
    onSelect: () => {}, onMoveEntity: () => {},
  }));
}
createRoot(document.getElementById('root')!).render(createElement(Harness));
