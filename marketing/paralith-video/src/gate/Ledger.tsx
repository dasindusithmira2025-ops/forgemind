import React from 'react';
import { INK, MONO, SIZE, STATE, TRACK, U, useFrameBox, useScale } from './design';
import { ramp } from './motion';

/**
 * The ledger: the machine's own record of what just happened, along the bottom of the frame.
 *
 * Every sequence writes to it, and it is the film's second continuity device after the rail — the
 * lines are set in the machine voice, they arrive at the exact frame the thing they describe
 * happens, and they never scroll backwards. It is the reason the film can make a claim about an
 * audit trail without ever cutting to a screen labelled "audit trail": the trail is being written
 * in front of the viewer for seventy-eight seconds.
 *
 * Each entry is owned by the sequence that writes it, keyed to that sequence's own local frames.
 * Nothing here reads the master timeline, so an excerpt in a trailer shows exactly the ledger lines
 * that belong to the frames it is playing — a thirty-second cut is never haunted by log lines from
 * a sequence it does not contain.
 */

export interface Entry {
  /** Sequence-local frame at which this line is written. */
  at: number;
  /** The event name, in the product's own dotted form. */
  event: string;
  /** The subject: a branch, a path, a check, an id. */
  detail?: string;
  tone?: 'default' | 'accent' | 'pass' | 'fail';
}

const toneColour = (tone: Entry['tone']) => {
  switch (tone) {
    case 'accent':
      return STATE.accent;
    case 'pass':
      return STATE.pass;
    case 'fail':
      return STATE.fail;
    default:
      return INK.faint;
  }
};

/**
 * The visible window is four lines.
 *
 * Not eight, and not "everything so far". Four is the most a viewer can take in peripherally while
 * reading a statement in the middle of the frame, and the ledger's job is to be *noticed*, not to
 * be read — a viewer who stops to read the log has stopped watching the film. The oldest of the
 * four is held at 40% and the newest at full, so the eye is pulled to the line that just arrived.
 */
const WINDOW = 4;

export const Ledger: React.FC<{ frame: number; entries: readonly Entry[]; opacity?: number }> = ({
  frame,
  entries,
  opacity = 1,
}) => {
  const k = useScale();
  const box = useFrameBox();

  const written = entries.filter((entry) => frame >= entry.at);
  const visible = written.slice(-WINDOW);
  if (visible.length === 0) return null;

  /** Portrait keeps the ledger but pulls it in — there is no 1920 of width to run it across. */
  const left = box.portrait ? 48 : 104;
  const bottom = box.portrait ? 96 : 74;

  return (
    <div
      style={{
        position: 'absolute',
        left: left * k,
        top: (box.height - bottom - WINDOW * 19) * k,
        opacity,
        pointerEvents: 'none',
      }}
    >
      {visible.map((entry, index) => {
        const age = visible.length - 1 - index;
        /** The newest line fades and slides in over ten frames; the rest simply hold. */
        const arrive = ramp(frame, entry.at, 10);
        const dim = [1, 0.72, 0.54, 0.4][Math.min(age, 3)];

        return (
          <div
            key={`${entry.event}-${entry.at}`}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: U * k,
              height: 19 * k,
              opacity: dim * (age === 0 ? arrive : 1),
              transform: age === 0 ? `translateX(${(1 - arrive) * -8 * k}px)` : undefined,
              fontFamily: MONO,
              fontSize: SIZE.ledger * k,
              letterSpacing: TRACK.ledger,
              whiteSpace: 'nowrap',
            }}
          >
            {/*
              A one-character gutter mark rather than a timestamp. A timestamp would have to be
              real to be honest, and a real one changes every frame — which draws the eye straight
              to the least important thing on the screen.
            */}
            <span style={{ color: INK.ghost, width: 8 * k }}>{age === 0 ? '›' : ' '}</span>
            <span style={{ color: toneColour(entry.tone) }}>{entry.event}</span>
            {entry.detail ? <span style={{ color: INK.ghost }}>{entry.detail}</span> : null}
          </div>
        );
      })}
    </div>
  );
};
