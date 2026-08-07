import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { useScale } from '../film/Layers';
import { EASE, EASE_CAMERA, ramp, track } from '../film/motion';
import { Copy } from './Copy';
import { LINES } from './script';
import { DISPLAY, SIZE, TRACK } from './type';

/**
 * Sequence 1 — the workflow that already has intelligence in it.
 *
 * This is the only sequence in the film that is not the product, and it is deliberately not a
 * competitor either. There is no VS Code chrome, no GitHub header, no chat-assistant bubble:
 * naming other people's software in a brand film is both a legal question and a weaker argument
 * than the one available here. What is drawn instead is the shape of the problem — six flat
 * surfaces, each holding real work, none of them holding each other.
 *
 * Two rules keep it from becoming the montage of chaos every developer-tool film opens with.
 *
 * The overlap is deliberate and it is the argument. Each new tool covers the corner of the one
 * before it, which is what actually happens to context on a real desktop: nothing is lost,
 * everything is buried, and the thing you most need to see is under three other windows by the
 * time it matters. Nothing is tilted, blurred, made translucent, or placed at random — a heap of
 * skewed glass panels would say "this person is disorganised", which is neither true of the
 * audience nor the point.
 *
 * And every character on screen is legible and means something. The fragments carry a real branch
 * command, a real flaky test, a real permission prompt left unanswered, a real diff hunk. The
 * permission prompt is the seed of the whole film: it is the same question the Fleet Bar answers
 * sixty seconds later, and here nothing is going to answer it.
 */

/** The opening is not the product, so it is set in the brand's own machine face, not the app's. */
const MONO = '"JetBrains Mono", "Cascadia Mono", ui-monospace, monospace';
const UI = DISPLAY;

type Tone = 'dim' | 'fg' | 'green' | 'amber' | 'red' | 'magenta' | 'cyan';

const TONE: Record<Tone, string> = {
  dim: '#5c5c5c',
  fg: '#a3a3a3',
  green: '#4ade80',
  amber: '#fbbf24',
  red: '#f87171',
  magenta: '#c084fc',
  cyan: '#22d3ee',
};

interface Row {
  text: string;
  tone?: Tone;
}

interface FragmentSpec {
  id: string;
  /** Chrome label. Generic tool categories, not product names. */
  label: string;
  /** Top-left in the 1920x1080 design space. Height is derived from the rows. */
  x: number;
  y: number;
  width: number;
  /** Frame this surface appears on. */
  at: number;
  rows: readonly Row[];
}

const ROW_HEIGHT = 21;
const HEADER_HEIGHT = 30;
const BODY_PADDING = 22;
const heightOf = (spec: FragmentSpec) => HEADER_HEIGHT + BODY_PADDING + spec.rows.length * ROW_HEIGHT;

/**
 * Six surfaces in a cascade, in the order a morning actually goes: you branch, you delegate, you
 * delegate again, something fails, something asks you a question, and the review is somewhere else.
 *
 * The fifth is the one that matters. It has been waiting since 09:41, it is the only surface here
 * that needs a human, and it is the most deeply buried.
 */
const FRAGMENTS: readonly FragmentSpec[] = [
  {
    id: 'shell',
    label: 'Terminal',
    x: 150,
    y: 156,
    width: 560,
    at: 0,
    rows: [
      { text: '$ git switch -c feat/idempotent-checkout', tone: 'fg' },
      { text: 'Switched to a new branch', tone: 'dim' },
      { text: '$ npm run dev', tone: 'fg' },
      { text: 'ready in 412 ms', tone: 'dim' },
    ],
  },
  {
    id: 'agent-a',
    label: 'Agent session',
    x: 604,
    y: 232,
    width: 596,
    at: 34,
    rows: [
      { text: '> split checkout into a two-phase commit', tone: 'magenta' },
      { text: '', tone: 'dim' },
      { text: '● Edit services/checkout/session.ts', tone: 'green' },
      { text: '  +64 −19', tone: 'dim' },
      { text: '● Bash npm test -- checkout', tone: 'green' },
      { text: '  57 passed', tone: 'dim' },
    ],
  },
  {
    id: 'agent-b',
    label: 'Agent session',
    x: 1108,
    y: 150,
    width: 566,
    at: 62,
    rows: [
      { text: '› add the ledger_entries migration', tone: 'cyan' },
      { text: '', tone: 'dim' },
      { text: 'apply_patch 0042_ledger_entries.sql', tone: 'fg' },
      { text: 'CREATE TABLE', tone: 'dim' },
      { text: 'CREATE INDEX', tone: 'dim' },
    ],
  },
  {
    id: 'ci',
    label: 'Pipeline',
    x: 214,
    y: 470,
    width: 532,
    at: 96,
    rows: [
      { text: 'webhooks › dispatch.test.ts', tone: 'fg' },
      { text: '1 intermittent across 20 runs', tone: 'amber' },
      { text: '', tone: 'dim' },
      { text: 'assertion raced the retry', tone: 'dim' },
    ],
  },
  {
    id: 'waiting',
    label: 'Agent session',
    x: 660,
    y: 566,
    width: 596,
    at: 128,
    rows: [
      { text: '● Bash git push origin payment-retries', tone: 'green' },
      { text: '', tone: 'dim' },
      { text: '  Allow this command?', tone: 'amber' },
      { text: '  ❯ 1. Yes', tone: 'fg' },
      { text: '    2. No, tell Claude what to do differently', tone: 'dim' },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    x: 1160,
    y: 500,
    width: 566,
    at: 160,
    rows: [
      { text: '@@ -118,7 +118,19 @@', tone: 'cyan' },
      { text: '-  if (session.reserved) return session', tone: 'red' },
      { text: '+  const existing = await ledger.find(key)', tone: 'green' },
      { text: '+  if (existing) return existing.session', tone: 'green' },
      { text: '', tone: 'dim' },
      { text: '2 files · awaiting review', tone: 'dim' },
    ],
  },
];

/**
 * One surface.
 *
 * A hairline border, a flat near-black fill, a label, and monospace rows. No shadow that would
 * imply it floats, no blur, no tilt, no gradient. It rises five pixels as it arrives — the same
 * entrance the product's own popovers use — and then sits perfectly still, because a window that
 * keeps drifting is a screensaver.
 */
const Fragment: React.FC<{
  spec: FragmentSpec;
  frame: number;
  k: number;
  dim: number;
  /** How many surfaces have landed on top of this one. Older windows recede. */
  buried: number;
}> = ({ spec, frame, k, dim, buried }) => {
  const enter = ramp(frame, spec.at, 26, EASE);
  if (enter <= 0) return null;

  const lift = (1 - enter) * 5;

  /**
   * Depth. A surface dims as the next one lands on it — 9% per window, floored at 52% — so the
   * cascade reads front to back without anything being tinted or blurred. This is the only
   * treatment in the sequence that is not simply "a window with text in it", and it is doing the
   * sequence's actual work: the newest thing is the brightest, and what you started the morning
   * with is the hardest to see.
   */
  const depth = Math.max(0.52, 1 - buried * 0.09);

  return (
    <div
      style={{
        position: 'absolute',
        left: spec.x * k,
        top: (spec.y + lift) * k,
        width: spec.width * k,
        height: heightOf(spec) * k,
        opacity: enter * dim * depth,
        background: '#0a0a0a',
        border: `${Math.max(1, k)}px solid #1f1f1f`,
        borderRadius: 8 * k,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: HEADER_HEIGHT * k,
          padding: `0 ${13 * k}px`,
          display: 'flex',
          alignItems: 'center',
          gap: 8 * k,
          borderBottom: `${Math.max(1, k)}px solid #171717`,
          color: '#525252',
          fontFamily: UI,
          fontSize: SIZE.label * k,
          letterSpacing: TRACK.label,
          textTransform: 'uppercase',
        }}
      >
        <span
          style={{
            width: 5 * k,
            height: 5 * k,
            borderRadius: '50%',
            background: spec.id === 'waiting' ? '#a16207' : '#2e2e2e',
          }}
        />
        {spec.label}
      </div>

      <div style={{ padding: `${11 * k}px ${13 * k}px` }}>
        {spec.rows.map((row, index) => (
          <div
            key={index}
            style={{
              height: ROW_HEIGHT * k,
              color: TONE[row.tone ?? 'dim'],
              fontFamily: MONO,
              fontSize: 13 * k,
              lineHeight: `${ROW_HEIGHT * k}px`,
              whiteSpace: 'pre',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.text || ' '}
          </div>
        ))}
      </div>
    </div>
  );
};

export const Fragments: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const k = useScale();

  /**
   * The camera pulls back very slightly across the whole sequence — 1.06x to 1.0x over twelve
   * seconds. It is barely perceptible per frame and it is the reason the sequence feels like it is
   * accumulating: each new surface arrives into a frame that is fractionally wider than the one
   * before, so the composition keeps making room for one more thing.
   */
  const zoom = track(frame, [0, 640], [1.06, 1.0], EASE_CAMERA);

  /** Everything recedes together at the end. The dip to black finishes the job. */
  const settle = 1 - ramp(frame, 620, 100, EASE);

  /**
   * The cascade is centred on its own measured extent rather than on a guessed height, so a change
   * to any fragment's rows re-centres the composition instead of drifting it off frame.
   */
  const top = Math.min(...FRAGMENTS.map((spec) => spec.y));
  const bottom = Math.max(...FRAGMENTS.map((spec) => spec.y + heightOf(spec)));
  const offsetY = (height / k - (bottom - top)) / 2 - top;

  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          width,
          height,
          transform: `scale(${zoom})`,
          transformOrigin: '50% 50%',
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: offsetY * k, width, height }}>
          {FRAGMENTS.map((spec, index) => (
            <Fragment
              key={spec.id}
              spec={spec}
              frame={frame}
              k={k}
              dim={settle}
              buried={FRAGMENTS.filter((other, i) => i > index && other.at <= frame).length}
            />
          ))}
        </div>
      </div>

      <Copy frame={frame} lines={LINES.fragments} />
    </AbsoluteFill>
  );
};
