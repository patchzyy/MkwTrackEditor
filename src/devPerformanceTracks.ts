/**
 * Keeps React's development-only "Components" performance track off by default.
 *
 * React 19.2's development build logs every component render onto a DevTools performance track,
 * and each entry carries the component's *changed props*, serialised key by key. This editor
 * hands whole `TrackDocument`s around as props — tens of megabytes of typed arrays and hundreds
 * of KMP records — so the commit that adopts a freshly loaded track makes React walk and
 * stringify the entire document once per component that received it.
 *
 * Measured on this machine, `npm run dev`, opening a 9 MB retail track (`scripts/loading-probe.mjs`):
 *
 *   | React Components track | longest main-thread stall |
 *   | ---------------------- | ------------------------- |
 *   | on (React's default)   | 10 098 ms                 |
 *   | off                    |    231 ms                 |
 *
 * A CPU profile of the first case is 6.1 s in `logComponentRender` and 5.4 s in
 * `addObjectToProperties` / `addValueToProperties`. None of it exists in a production build, so
 * this only ever changes what `npm run dev` feels like.
 *
 * React decides once, while `react-dom` is initialising, by checking that `console.timeStamp`
 * exists. Hiding it for that moment is the only switch there is; the function is put straight
 * back so nothing else loses a standard console method. Import this module **before**
 * `react-dom` — `src/main.tsx` does, and that is the whole reason it is a separate file.
 *
 * Want the track (it is genuinely useful for finding slow renders)? Load the page with
 * `?reactTracks=1`.
 */

function reactTracksRequested(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URL(window.location.href).searchParams.get('reactTracks') === '1';
  } catch {
    return false;
  }
}

if (import.meta.env.DEV && typeof console !== 'undefined' && typeof console.timeStamp === 'function' && !reactTracksRequested()) {
  const timeStamp = console.timeStamp.bind(console);
  Reflect.deleteProperty(console, 'timeStamp');
  // The whole module graph, `react-dom` included, evaluates inside this one task.
  setTimeout(() => {
    console.timeStamp = timeStamp;
  }, 0);
}

export {};
