import { useCallback, useEffect, useRef } from 'react';
import type { CreateSession } from '../session/types';
import type { Mutate } from '../tools/types';

/** Props to spread on a `NumberInput`: scrubbing and typing become one undo step. */
export interface NumberEditProps {
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}

/** Props to spread on a `Slider`: one drag is one undo step. */
export interface SliderEditProps {
  onBegin: () => void;
  onChange: (value: number) => void;
  onEnd: () => void;
}

/**
 * How the Details panels write to the design. A click or toggle is one `edit`; a scrub, a slider
 * drag or a typed number is a *gesture* (live preview every change, a single undo step when it
 * ends) so Ctrl+Z undoes "Widen road" once, not forty times.
 */
export function useEditing(session: CreateSession) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const open = useRef(false);

  const finish = useCallback(() => {
    if (!open.current) return;
    open.current = false;
    sessionRef.current.endGesture();
  }, []);

  // Never leave a gesture hanging when the panel goes away mid-drag.
  useEffect(() => finish, [finish]);

  const set = useCallback((label: string, mutate: Mutate) => {
    finish();
    sessionRef.current.edit(mutate, { label });
  }, [finish]);

  const live = useCallback((label: string, mutate: Mutate) => {
    if (!open.current) {
      open.current = true;
      sessionRef.current.beginGesture({ label });
    }
    sessionRef.current.updateGesture(mutate);
  }, []);

  const num = useCallback(
    (label: string, mutateFor: (value: number) => Mutate): NumberEditProps => ({
      onChange: (value) => live(label, mutateFor(value)),
      onCommit: (value) => {
        // A commit with no preceding change (arrow keys apply and commit in one go).
        if (!open.current) {
          sessionRef.current.beginGesture({ label });
          open.current = true;
          sessionRef.current.updateGesture(mutateFor(value));
        }
        finish();
      },
    }),
    [finish, live],
  );

  const slider = useCallback(
    (label: string, mutateFor: (value: number) => Mutate): SliderEditProps => ({
      onBegin: () => {
        if (!open.current) {
          open.current = true;
          sessionRef.current.beginGesture({ label });
        }
      },
      onChange: (value) => live(label, mutateFor(value)),
      onEnd: finish,
    }),
    [finish, live],
  );

  return { set, live, finish, num, slider };
}

export type Editing = ReturnType<typeof useEditing>;
