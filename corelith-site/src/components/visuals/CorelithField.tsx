"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { FieldStatic } from "./FieldStatic";

// The renderer is a route-level chunk that is never part of the first load.
// Until it arrives — and permanently, where WebGL is unavailable — the flat
// elevation of the same lattice stands in its place.
const FieldScene = dynamic(() => import("./scenes/FieldScene"), { ssr: false });

export function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch {
    return false;
  }
}

export function CorelithField({
  parallax = false,
  className = "",
}: {
  parallax?: boolean;
  className?: string;
}) {
  // Deferred one frame past mount so the scene never competes with the hero's
  // own paint for main-thread time.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setReady(webglAvailable()));
    return () => window.cancelAnimationFrame(id);
  }, []);

  if (ready) return <FieldScene parallax={parallax} className={className} />;

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <FieldStatic className="h-full w-full text-[var(--ink-3)]" />
    </div>
  );
}
