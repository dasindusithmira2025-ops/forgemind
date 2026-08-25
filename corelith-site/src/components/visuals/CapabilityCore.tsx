"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { CoreState } from "@/content/capabilities";
import { graphElevation } from "./graph";
import { webglAvailable } from "./CorelithField";

const GraphScene = dynamic(() => import("./scenes/GraphScene"), { ssr: false });

/** The arrangement as a flat elevation. Server-rendered, and the real graph. */
export function CapabilityCoreStatic({
  state,
  className = "",
}: {
  state: CoreState;
  className?: string;
}) {
  const { points, edges } = graphElevation(state);
  const round = (n: number) => n.toFixed(2);

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      role="img"
      aria-label="The Corelith capability core: a graph of nodes arranged into the structure the selected capability describes."
    >
      <g stroke="currentColor" strokeWidth="0.2">
        {edges.map((edge, i) => (
          <line
            key={i}
            x1={round(edge.x1)}
            y1={round(edge.y1)}
            x2={round(edge.x2)}
            y2={round(edge.y2)}
            opacity={edge.o.toFixed(3)}
          />
        ))}
      </g>
      {points.map((point, i) => (
        <circle
          key={i}
          cx={round(point.x)}
          cy={round(point.y)}
          r={((point.marked ? 0.9 : 0.5) * (0.6 + point.facing * 0.5)).toFixed(2)}
          fill={point.marked ? "var(--accent)" : "currentColor"}
          opacity={(
            (point.marked ? 1 : 0.6) *
            (0.1 + point.weight * 0.9) *
            (0.25 + point.facing * 0.75)
          ).toFixed(3)}
        />
      ))}
    </svg>
  );
}

export function CapabilityCore({
  state,
  className = "",
}: {
  state: CoreState;
  className?: string;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setReady(webglAvailable()));
    return () => window.cancelAnimationFrame(id);
  }, []);

  if (ready) return <GraphScene state={state} className={className} />;

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <CapabilityCoreStatic state={state} className="h-full w-full text-[var(--ink-3)]" />
    </div>
  );
}
