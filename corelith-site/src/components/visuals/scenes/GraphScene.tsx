"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CoreState } from "@/content/capabilities";
import { Stage, useStageQuality } from "../Stage";
import { useIsDark, usePalette } from "../palette";
import { layouts, NODE_COUNT } from "../graph";
import { linear, pointMaterial } from "./points";

const CAMERA = 7.9;
const SPAN = 2.1;

/** Every seventh node carries state, so the blue moves with the arrangement. */
const isMarked = (i: number) => i % 7 === 3;

/**
 * THE CORELITH CORE, rendered.
 *
 * One network that reorganises. All the live state is held where it belongs:
 * node positions and their visual attributes are the GPU buffers themselves,
 * the per-node weight rides on the object's own userData, and the skin's
 * presence is the opacity of the skin. Nothing mutable is parked in a hook.
 */
function CapabilityCore({
  state,
  reduced,
  dark,
}: {
  state: CoreState;
  reduced: boolean;
  dark: boolean;
}) {
  const canvas = useThree((three) => three.gl.domElement);
  const palette = usePalette(canvas);
  const all = useMemo(() => layouts(), []);

  const group = useRef<THREE.Group>(null);
  const nodes = useRef<THREE.Points>(null);
  const hull = useRef<THREE.Mesh>(null);
  const lines = useRef<Record<string, THREE.LineSegments | null>>({});
  const clock = useRef(0);

  // Allocation only — the initial arrangement, handed to the geometry and
  // written through it from then on. Deliberately seeded from whichever
  // arrangement mounts first: this is the initial condition, and resetting it
  // when the selection changes would teleport the nodes instead of moving them.
  const initial = useMemo(() => {
    const start = layouts().assembly;
    return {
      position: Float32Array.from(start.positions),
      size: new Float32Array(NODE_COUNT),
      alpha: new Float32Array(NODE_COUNT),
      colour: new Float32Array(NODE_COUNT * 3),
    };
  }, []);

  const material = useMemo(
    () => pointMaterial({ cam: CAMERA, span: SPAN, fade: 0.85, scale: 260 }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05);
    if (!reduced) clock.current += step;
    const t = clock.current;

    const target = all[state];
    const ease = 1 - Math.pow(0.0009, step);

    const geometry = nodes.current?.geometry;
    const position = geometry?.getAttribute("position");
    const size = geometry?.getAttribute("aSize");
    const alpha = geometry?.getAttribute("aAlpha");
    const colour = geometry?.getAttribute("aColor");
    if (!nodes.current || !position || !size || !alpha || !colour) return;

    // Per-node weight is simulation state rather than a GPU buffer, so it rides
    // on the object it describes. Created on the first frame — never during
    // render, which is where mutable state has no business being.
    const store = nodes.current.userData as { weight?: Float32Array };
    if (!store.weight) store.weight = Float32Array.from(all.assembly.weight);
    const weight = store.weight;

    const live = position.array as Float32Array;
    for (let i = 0; i < NODE_COUNT * 3; i++) {
      live[i] += (target.positions[i] - live[i]) * ease;
    }
    position.needsUpdate = true;

    const plain = linear(palette.point);
    const accent = linear(palette.accent);

    for (let i = 0; i < NODE_COUNT; i++) {
      weight[i] += (target.weight[i] - weight[i]) * ease;
      const marked = isMarked(i);
      size.setX(i, (marked ? 0.13 : 0.075) * (0.5 + weight[i] * 0.5));
      alpha.setX(i, (marked ? 1 : dark ? 0.85 : 1) * (0.1 + weight[i] * 0.9));
      const tint = marked ? accent : plain;
      colour.setXYZ(i, tint.r, tint.g, tint.b);
    }
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    colour.needsUpdate = true;

    // Every arrangement's edge set is drawn from the same live node positions;
    // only the active one is opaque, so the network dissolves and reforms
    // through the transition rather than cutting.
    for (const key of Object.keys(all) as CoreState[]) {
      const segments = lines.current[key];
      if (!segments) continue;
      const edges = all[key].edges;
      const attribute = segments.geometry.getAttribute("position");
      const array = attribute.array as Float32Array;
      for (let e = 0; e < edges.length; e++) {
        const i = edges[e];
        array[e * 3] = live[i * 3];
        array[e * 3 + 1] = live[i * 3 + 1];
        array[e * 3 + 2] = live[i * 3 + 2];
      }
      attribute.needsUpdate = true;

      const lineMaterial = segments.material as THREE.LineBasicMaterial;
      // Read at actual size, not at the size a designer inspects it. At a
      // quarter opacity these connections vanished on a bright screen and the
      // core read as an empty plate.
      const wanted = key === state ? (dark ? 0.4 : 0.46) : 0;
      lineMaterial.opacity += (wanted - lineMaterial.opacity) * ease;
      segments.visible = lineMaterial.opacity > 0.004;
    }

    if (hull.current) {
      // The skin's presence is its opacity. There is no second variable
      // tracking it, so the two can never disagree.
      const hullMaterial = hull.current.material as THREE.MeshPhysicalMaterial;
      const wanted = target.hull * (dark ? 0.14 : 0.22);
      hullMaterial.opacity += (wanted - hullMaterial.opacity) * ease;
      hull.current.visible = hullMaterial.opacity > 0.004;
    }

    if (group.current) {
      group.current.rotation.y = t * 0.11;
      group.current.rotation.x = 0.2 + Math.sin(t * 0.22) * 0.04;
    }
  });

  return (
    <group ref={group}>
      {(Object.keys(all) as CoreState[]).map((key) => (
        <lineSegments
          key={key}
          ref={(node) => {
            lines.current[key] = node;
          }}
          frustumCulled={false}
        >
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array(all[key].edges.length * 3), 3]}
              usage={THREE.DynamicDrawUsage}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={palette.point}
            transparent
            opacity={key === state ? 0.46 : 0}
            depthWrite={false}
          />
        </lineSegments>
      ))}

      <points ref={nodes} material={material} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[initial.position, 3]}
            usage={THREE.DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-aSize"
            args={[initial.size, 1]}
            usage={THREE.DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-aAlpha"
            args={[initial.alpha, 1]}
            usage={THREE.DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-aColor"
            args={[initial.colour, 3]}
            usage={THREE.DynamicDrawUsage}
          />
        </bufferGeometry>
      </points>

      {/* The skin, and the only arrangement that shows it. Frosted glass rather
          than a bubble: it is a surface over a system, which is what an
          interface is. */}
      <mesh ref={hull} scale={2.06} frustumCulled={false}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshPhysicalMaterial
          color={dark ? "#d9a53f" : "#ffffff"}
          transparent
          opacity={0}
          roughness={0.16}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.22}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export default function GraphScene({
  state = "assembly",
  className = "",
}: {
  state?: CoreState;
  className?: string;
}) {
  const { reduced } = useStageQuality();
  const dark = useIsDark();

  return (
    <Stage className={className} camera={{ position: [0, 0, CAMERA], fov: 34 }} dark={dark}>
      <CapabilityCore state={state} reduced={reduced} dark={dark} />
    </Stage>
  );
}
