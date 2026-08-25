"use client";

import { Canvas, useStore, useThree } from "@react-three/fiber";
import { useEffect, useState, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * The room every Corelith visual is lit in.
 *
 * The objects on this site are deliberately different from each other. What
 * makes them one family is this: the same soft studio light, the same
 * procedural environment behind the glass, the same clamped pixel ratio, the
 * same rule that a canvas off screen does not render. Consistency is the
 * material and the light, never the model.
 */

/**
 * A generated room, used as the reflection source.
 *
 * Glass without an environment is flat. An environment file would be a network
 * request the CSP has to allow and the first paint has to wait for, so three's
 * procedural room is generated locally, converted once and disposed on unmount.
 */
function Environment({ intensity = 1 }: { intensity?: number }) {
  const store = useStore();

  useEffect(() => {
    const { gl, scene } = store.getState();
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = intensity;

    return () => {
      scene.environment = null;
      target.dispose();
      room.dispose();
      pmrem.dispose();
    };
  }, [store, intensity]);

  return null;
}

/**
 * Soft studio light: a broad key from the upper left, a low fill from the
 * right, and ambience. No coloured lamps — an orange key and a blue rim is the
 * exact signature this site was rebuilt to get away from.
 */
function Lighting({ dark }: { dark: boolean }) {
  return (
    <>
      {/* Enough ambience to keep the shadow side readable, and a key strong
          enough that there is a shadow side at all. The first pass ran the
          ambient at 1.35 and every object came out as a flat disc. */}
      <ambientLight intensity={dark ? 0.35 : 0.62} />
      <directionalLight position={[-4.5, 4.5, 5]} intensity={dark ? 1.9 : 3.1} />
      <directionalLight position={[5, 0.5, 1.5]} intensity={dark ? 0.5 : 0.8} />
    </>
  );
}

/** Pauses the render loop whenever the canvas is off screen. */
function VisibilityGate({ onChange }: { onChange: (visible: boolean) => void }) {
  const { gl } = useThree();

  useEffect(() => {
    const element = gl.domElement;
    const observer = new IntersectionObserver(([entry]) => onChange(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [gl, onChange]);

  return null;
}

export type StageQuality = {
  /** Coarser geometry on small screens, where the object is a third the size. */
  detail: "full" | "reduced";
  /** Motion is stilled rather than removed: the object still exists, it holds. */
  reduced: boolean;
};

export function useStageQuality(): StageQuality {
  const [quality, setQuality] = useState<StageQuality>({ detail: "full", reduced: false });

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const small = window.matchMedia("(max-width: 900px)");
    const update = () =>
      setQuality({ detail: small.matches ? "reduced" : "full", reduced: motion.matches });
    update();
    motion.addEventListener("change", update);
    small.addEventListener("change", update);
    return () => {
      motion.removeEventListener("change", update);
      small.removeEventListener("change", update);
    };
  }, []);

  return quality;
}

/** Very shallow pointer response. Depth, not a toy that follows the cursor. */
export function usePointer(active: boolean) {
  const [pointer] = useState(() => ({ x: 0, y: 0 }));

  useEffect(() => {
    if (!active) return;
    const onMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [active, pointer]);

  return pointer;
}

export function Stage({
  className = "",
  camera,
  dark,
  envIntensity,
  children,
}: {
  className?: string;
  camera: { position: [number, number, number]; fov: number };
  dark: boolean;
  envIntensity?: number;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(true);

  return (
    <div className={className} aria-hidden="true">
      <Canvas
        // Clamped so a 3x display does not quietly render nine times the pixels.
        dpr={[1, 1.75]}
        frameloop={visible ? "always" : "never"}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={camera}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.02;
        }}
      >
        <Environment intensity={envIntensity ?? (dark ? 0.85 : 1.1)} />
        <Lighting dark={dark} />
        {children}
        <VisibilityGate onChange={setVisible} />
      </Canvas>
    </div>
  );
}
