import { seeded } from "./rand";

/**
 * RESEARCH TRACES — the fourth object, and the quietest.
 *
 * A fan of trajectories: every line of enquiry leaves from the same place, most
 * of them bend away and thin out, three carry through to a result. It is the
 * only honest picture of research this site could draw, and it is drawn once on
 * the server — no canvas, no loop, no interaction, because a section about open
 * questions does not need to move to be taken seriously.
 *
 * The first version of this ran the traces almost horizontally and they read as
 * scratches on the page. The fan is the whole point: they have to leave from
 * one origin and diverge, or the picture says nothing.
 */
const W = 1200;
const H = 260;
const TRACES = 38;

export function ResearchTraces({ className = "" }: { className?: string }) {
  const random = seeded(0x2e5ea2c);
  const origin = H / 2;

  const traces = Array.from({ length: TRACES }, (_, i) => {
    // Spread the departure angles evenly, then jitter, so the fan is even
    // without being a comb.
    const spread = (i / (TRACES - 1) - 0.5) * 2;
    const wander = spread * (H * 0.46) + (random() - 0.5) * 22;

    // How far this line gets before it stops being pursued.
    const reach = 0.2 + Math.pow(random(), 1.5) * 0.8;
    // Three of thirty-eight. If a third of them carried, the picture would be
    // saying something flattering and false about how research goes.
    const carries = reach > 0.955;

    const x1 = W * reach;
    const y1 = origin + wander * reach;

    const path = [
      `M 0 ${origin}`,
      `C ${(W * reach * 0.42).toFixed(1)} ${origin},`,
      `${(W * reach * 0.6).toFixed(1)} ${(origin + wander * reach * 0.85).toFixed(1)},`,
      `${x1.toFixed(1)} ${y1.toFixed(1)}`,
    ].join(" ");

    return { path, x1, y1, reach, carries };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      fill="none"
      role="img"
      aria-label="Research traces: many lines of enquiry leave from one place, most thin away, a few carry through to a result."
      preserveAspectRatio="xMidYMid meet"
    >
      {traces.map((trace, i) => (
        <path
          key={i}
          d={trace.path}
          stroke={trace.carries ? "var(--accent)" : "var(--ink-3)"}
          strokeWidth={trace.carries ? 1.6 : 1}
          strokeLinecap="round"
          opacity={trace.carries ? 0.9 : Number((0.13 + trace.reach * 0.3).toFixed(3))}
        />
      ))}
      {traces.map((trace, i) =>
        trace.carries ? (
          <circle key={`m${i}`} cx={trace.x1} cy={trace.y1} r="4.5" fill="var(--accent)" />
        ) : null,
      )}
    </svg>
  );
}
