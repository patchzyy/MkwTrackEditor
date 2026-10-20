import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { coachSeen, COACH_STEPS, markCoachSeen, placeCoachCard, type Box } from './coach';

function toBox(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * The first-run tour: four short steps that point at the viewport, the tool bar, the palette and
 * the Test drive button. Dismissible at any time and remembered in localStorage.
 */
export function CoachMarks({ active, layerRef }: { active: boolean; layerRef: React.RefObject<HTMLElement | null> }) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(() => coachSeen());
  const [geometry, setGeometry] = useState<{ target: Box | null; bounds: Box; cardHeight: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const current = COACH_STEPS[step];

  useLayoutEffect(() => {
    if (!active || done) return undefined;
    let frame = 0;
    const measure = () => {
      const layer = layerRef.current;
      if (!layer) return;
      const bounds = toBox(layer.getBoundingClientRect());
      const element = current.selector ? document.querySelector<HTMLElement>(current.selector) : null;
      const target = element ? toBox(element.getBoundingClientRect()) : null;
      const cardHeight = cardRef.current?.offsetHeight ?? 160;
      setGeometry((prev) => {
        const next = { target, bounds, cardHeight };
        return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    };
    measure();
    const loop = () => {
      measure();
      frame = window.setTimeout(loop, 400);
    };
    frame = window.setTimeout(loop, 400);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(frame);
      window.removeEventListener('resize', measure);
    };
  }, [active, done, current, layerRef]);

  useEffect(() => {
    if (!active || done) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, done]);

  function finish() {
    markCoachSeen();
    setDone(true);
  }

  if (!active || done || !geometry) return null;
  const layerBounds = geometry.bounds;
  const placed = placeCoachCard(geometry.target, geometry.cardHeight, layerBounds, current.placement);
  const last = step === COACH_STEPS.length - 1;
  const ring = geometry.target;

  return (
    <div className="crCoach" role="dialog" aria-label="Quick tour" data-create-coach>
      {ring && (
        <span
          className="crCoachRing"
          style={{ left: ring.left - layerBounds.left - 4, top: ring.top - layerBounds.top - 4, width: ring.width + 8, height: ring.height + 8 }}
          aria-hidden="true"
        />
      )}
      <div
        ref={cardRef}
        className={`crCoachCard${placed.side ? ` is-${placed.side}` : ''}`}
        style={{ left: placed.left - layerBounds.left, top: placed.top - layerBounds.top, ['--arrow-left' as string]: placed.arrowLeft === null ? undefined : `${placed.arrowLeft}px` }}
      >
        <div className="crCoachStep">
          Step {step + 1} of {COACH_STEPS.length}
        </div>
        <strong>{current.title}</strong>
        <p>{current.body}</p>
        <div className="crCoachActions">
          <span className="crCoachDots" aria-hidden="true">
            {COACH_STEPS.map((s, i) => (
              <i key={s.id} className={i === step ? 'is-current' : i < step ? 'is-past' : ''} />
            ))}
          </span>
          <Button variant="ghost" size="sm" onClick={finish} data-create-action="skip-tour">
            {last ? 'Close' : 'Skip tour'}
          </Button>
          <Button variant="primary" size="sm" onClick={() => (last ? finish() : setStep(step + 1))} data-create-action="next-step">
            {last ? 'Got it' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
