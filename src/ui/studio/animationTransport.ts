// The Model Studio's animation transport, as pure maths.
//
// The studio plays every enabled animation together on one clock — a driver's CHR0 and its
// kart's SRT0 at the same time, which is what the game does — so there is exactly one frame
// counter, one speed and one loop flag, and the timeline spans the longest enabled animation.

export interface StudioTransport {
  playing: boolean;
  /** Current position, in 60 fps frames. */
  frame: number;
  /** Playback rate; 1 is real time. */
  speed: number;
  loop: boolean;
}

export const STUDIO_TRANSPORT_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4] as const;

export const defaultStudioTransport: StudioTransport = { playing: true, frame: 0, speed: 1, loop: true };

/** Frames per second the transport counts in. Every BRRES animation is authored at 60. */
export const STUDIO_FPS = 60;

/**
 * Advances the clock by `deltaMs` of wall time.
 *
 * A looping transport wraps; a non-looping one stops on the last frame and clears `playing`, so
 * the play button turns back into a play button when a one-shot animation finishes.
 */
export function advanceTransport(transport: StudioTransport, deltaMs: number, duration: number): StudioTransport {
  if (!transport.playing || !Number.isFinite(deltaMs) || deltaMs <= 0) return transport;
  const next = transport.frame + (deltaMs / 1000) * STUDIO_FPS * transport.speed;
  if (duration <= 0) return { ...transport, frame: 0 };
  if (next <= duration) return { ...transport, frame: next };
  if (transport.loop) return { ...transport, frame: ((next % duration) + duration) % duration };
  return { ...transport, frame: duration, playing: false };
}

/** Moving the scrubber. Always pauses: dragging the timeline is a scrub, not a seek-and-play. */
export function scrubTransport(transport: StudioTransport, frame: number, duration: number): StudioTransport {
  return { ...transport, playing: false, frame: clampFrame(frame, duration) };
}

export function seekTransport(transport: StudioTransport, frame: number, duration: number): StudioTransport {
  return { ...transport, frame: clampFrame(frame, duration) };
}

/** Play/pause. Pressing play at the end of a finished one-shot starts it again from the top. */
export function toggleTransportPlaying(transport: StudioTransport, duration: number): StudioTransport {
  if (transport.playing) return { ...transport, playing: false };
  const atEnd = !transport.loop && duration > 0 && transport.frame >= duration - 1e-6;
  return { ...transport, playing: true, frame: atEnd ? 0 : transport.frame };
}

export function stepTransport(transport: StudioTransport, frames: number, duration: number): StudioTransport {
  return { ...transport, playing: false, frame: clampFrame(transport.frame + frames, duration) };
}

export function clampFrame(frame: number, duration: number): number {
  if (!Number.isFinite(frame)) return 0;
  if (duration <= 0) return 0;
  return Math.min(duration, Math.max(0, frame));
}

/** `12 / 240` — the counter next to the scrubber. */
export function formatTransportPosition(transport: StudioTransport, duration: number): string {
  const frame = Math.round(clampFrame(transport.frame, duration));
  return `${frame} / ${Math.round(Math.max(0, duration))}`;
}

/** `0.20s / 4.00s` — the same thing in the unit an animator thinks in. */
export function formatTransportSeconds(transport: StudioTransport, duration: number): string {
  const seconds = clampFrame(transport.frame, duration) / STUDIO_FPS;
  return `${seconds.toFixed(2)}s / ${(Math.max(0, duration) / STUDIO_FPS).toFixed(2)}s`;
}

export function formatTransportSpeed(speed: number): string {
  return `${speed}x`;
}

/** One line describing what is playing, for the transport's status area. */
export function describeActiveAnimations(active: ReadonlyArray<{ kind: string; name: string }>): string {
  if (active.length === 0) return 'Nothing playing';
  if (active.length === 1) return `Playing ${active[0].name}`;
  if (active.length <= 3) return `Playing ${active.map((entry) => entry.name).join(', ')}`;
  return `Playing ${active.length} animations`;
}
