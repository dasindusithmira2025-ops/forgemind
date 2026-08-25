"use client";

import { useRef, useState, type CSSProperties } from "react";
import { lifecycle } from "@/content/company";
import {
  PROCESS_H,
  PROCESS_W,
  processEdges,
  processLayouts,
  type LifecycleState,
} from "./process";

/**
 * How Corelith builds, as one system moving through six states.
 *
 * Not six diagrams and not a row of cards. The same ninety points are on screen
 * the whole time; selecting a phase moves them into the arrangement that phase
 * actually produces, and the connections between them fade in and out around
 * the new shape. The transformation is the argument — that this is one process
 * rather than six stages bolted together.
 *
 * Everything the visual says is also said in words: the phase names are real
 * controls and the body copy changes with them, so nothing here is available
 * only through the animation.
 */
export function ProcessSystem() {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const layouts = processLayouts();
  const edges = processEdges();
  const state = lifecycle[active].state as LifecycleState;
  const layout = layouts[state];

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? lifecycle.length - 1
          : (active +
              (event.key === "ArrowRight" ? 1 : -1) +
              lifecycle.length) %
            lifecycle.length;
    setActive(next);
    buttons.current[next]?.focus();
  };

  return (
    <div>
      {/* On a plate, like every other visual here. A diagram floating directly
          on the page has no edge and reads as something that failed to load. */}
      <div className="viz-panel px-[clamp(16px,3vw,44px)] py-[clamp(24px,3.5vw,48px)]">
        <svg
          viewBox={`0 0 ${PROCESS_W} ${PROCESS_H}`}
          className="block w-full"
          aria-hidden="true"
          fill="none"
        >
          <g stroke="var(--ink-3)" strokeWidth="0.22">
            {edges.map((edge, i) => {
              const a = layout.points[edge.a];
              const b = layout.points[edge.b];
              return (
                <line
                  key={i}
                  className="proc-edge"
                  x1={a.x.toFixed(2)}
                  y1={a.y.toFixed(2)}
                  x2={b.x.toFixed(2)}
                  y2={b.y.toFixed(2)}
                  opacity={edge.states.has(state) ? 0.34 : 0}
                  style={{ "--i": i % 40 } as CSSProperties}
                />
              );
            })}
          </g>
          {layout.points.map((point, i) => (
            <circle
              key={i}
              className="proc-node"
              cx={point.x.toFixed(2)}
              cy={point.y.toFixed(2)}
              r={point.marked ? 0.8 : 0.62}
              fill={point.marked ? "var(--accent)" : "var(--ink-3)"}
              opacity={point.marked ? 1 : 0.62}
              style={{ "--i": i % 40 } as CSSProperties}
            />
          ))}
        </svg>
      </div>

      <div
        role="tablist"
        aria-label="How Corelith builds"
        onKeyDown={onKeyDown}
        className="mt-10 grid grid-cols-2 gap-x-6 border-t sm:grid-cols-3 lg:grid-cols-6"
        style={{ borderColor: "var(--hair)" }}
      >
        {lifecycle.map((phase, i) => {
          const selected = i === active;
          return (
            <button
              key={phase.step}
              ref={(node) => {
                buttons.current[i] = node;
              }}
              type="button"
              role="tab"
              id={`phase-tab-${i}`}
              aria-selected={selected}
              aria-controls="phase-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              className="group -mt-px cursor-pointer border-t pt-5 pb-6 text-left transition-colors duration-[260ms]"
              style={{
                borderColor: selected ? "var(--accent)" : "transparent",
              }}
            >
              <span
                className="index-lg block transition-opacity duration-[260ms]"
                style={{ opacity: selected ? 1 : 0.45 }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className="font-display mt-2.5 block text-[17px] leading-tight font-medium transition-colors duration-[260ms]"
                style={{ color: selected ? "var(--ink)" : "var(--ink-2)" }}
              >
                {phase.step}
              </span>
            </button>
          );
        })}
      </div>

      <p
        id="phase-panel"
        role="tabpanel"
        aria-labelledby={`phase-tab-${active}`}
        className="mt-8 max-w-[var(--measure-text)] text-[length:var(--step-lead)] leading-[1.6] text-[var(--ink-2)]"
      >
        {lifecycle[active].body}
      </p>
    </div>
  );
}
