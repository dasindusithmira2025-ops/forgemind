"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Stage, usePointer, useStageQuality } from "../Stage";
import { useIsDark, usePalette } from "../palette";
import { breathe, buildField, FIELD_RADIUS } from "../field";
import { linear, pointMaterial } from "./points";

// Far enough back that the shell sits inside the plate with air around it at
// any panel aspect. Point size divides by view distance in the shader, so the
// dots scale with the object and the density stays the same.
const CAMERA = 12.4;

/**
 * THE CORELITH FIELD, rendered.
 *
 * A dotted shell turning slowly on a lit body, with the far side almost gone.
 * Nothing here is a wireframe and nothing here glows: the object is a density
 * of fine marks over a shaded form, which is the same material the capability
 * core and the delivery diagram are made of.
 *
 * There is exactly one copy of every buffer, and it is the one the GPU reads.
 * The frame loop writes through `geometry.getAttribute(...)` rather than into a
 * parallel array it then copies across — fewer allocations, no chance of the
 * two drifting apart, and no mutable state held in a hook.
 */
function FieldObject({
  detail,
  reduced,
  parallax,
  dark,
}: {
  detail: "full" | "reduced";
  reduced: boolean;
  parallax: boolean;
  dark: boolean;
}) {
  const canvas = useThree((three) => three.gl.domElement);
  const palette = usePalette(canvas);
  const pointer = usePointer(parallax);

  const field = useMemo(() => buildField(detail), [detail]);

  // Allocation only. Nothing writes to these through this binding; they are
  // handed to the geometry and written through it from then on.
  const initial = useMemo(
    () => ({
      position: Float32Array.from(field.base),
      size: new Float32Array(field.count),
      alpha: new Float32Array(field.count),
      colour: new Float32Array(field.count * 3),
    }),
    [field],
  );

  const group = useRef<THREE.Group>(null);
  const points = useRef<THREE.Points>(null);
  const clock = useRef(0);
  const out = useRef({ x: 0, y: 0, z: 0 });

  const material = useMemo(
    () => pointMaterial({ cam: CAMERA, span: FIELD_RADIUS, fade: 1, scale: 300 }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  // Colour and size are fixed per point: only position moves each frame, so
  // they are written once here and again whenever the theme changes.
  useEffect(() => {
    const geometry = points.current?.geometry;
    const size = geometry?.getAttribute("aSize");
    const alpha = geometry?.getAttribute("aAlpha");
    const colour = geometry?.getAttribute("aColor");
    if (!size || !alpha || !colour) return;

    const plain = linear(palette.point);
    const accent = linear(palette.accent);

    for (let i = 0; i < field.count; i++) {
      const marked = field.marked[i] === 1;
      // A point has to land at two or three device pixels to read as a mark.
      // The first pass here worked out to under one, which is why the shell
      // rendered as a smudge.
      size.setX(i, (marked ? 0.15 : 0.078) * field.scale[i]);
      alpha.setX(i, marked ? 1 : dark ? 0.9 : 1);
      const tint = marked ? accent : plain;
      colour.setXYZ(i, tint.r, tint.g, tint.b);
    }

    size.needsUpdate = true;
    alpha.needsUpdate = true;
    colour.needsUpdate = true;
  }, [field, palette, dark]);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05);
    if (!reduced) clock.current += step;
    const t = clock.current;

    const position = points.current?.geometry.getAttribute("position");
    if (position) {
      const array = position.array as Float32Array;
      const point = out.current;
      const base = field.base;
      for (let i = 0; i < field.count; i++) {
        breathe(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], t, point);
        array[i * 3] = point.x;
        array[i * 3 + 1] = point.y;
        array[i * 3 + 2] = point.z;
      }
      position.needsUpdate = true;
    }

    if (group.current) {
      // Slow, precise, controlled. The field turns; it does not spin.
      group.current.rotation.y = t * 0.075 + (parallax ? pointer.x * 0.18 : 0);
      const tilt = -0.16 + (parallax ? -pointer.y * 0.05 : 0);
      group.current.rotation.x += (tilt - group.current.rotation.x) * 0.06;
      group.current.rotation.z = 0.12;
      // Nudged off centre so the lit edge falls to the upper left rather than
      // ringing the object evenly, which would read as a sticker.
      group.current.position.set(0.12, 0.06, 0);
    }
  });

  return (
    <group ref={group}>
      {/* The rim. A slightly larger sphere drawn from the inside, so its lit
          edge shows past the body as a thin bright arc — the one bit of glow on
          the site, and it is a physical highlight rather than a filter. */}
      <mesh scale={FIELD_RADIUS * 1.022} frustumCulled={false}>
        <sphereGeometry args={[1, 64, 48]} />
        <meshBasicMaterial
          color={dark ? "#4a3818" : "#ffffff"}
          side={THREE.BackSide}
          transparent
          opacity={dark ? 0.5 : 0.7}
          depthWrite={false}
        />
      </mesh>

      {/* The body the points sit on. Without it the shell is a cloud; with it
          the object has a lit side and a shaded one, which is what makes a
          field of dots read as a form rather than as noise. */}
      <mesh scale={FIELD_RADIUS * 0.985} frustumCulled={false}>
        <sphereGeometry args={[1, 64, 48]} />
        <meshStandardMaterial color={dark ? "#1c222b" : "#eef1f6"} roughness={1} metalness={0} />
      </mesh>

      <points ref={points} material={material} frustumCulled={false}>
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
    </group>
  );
}

export default function FieldScene({
  parallax = false,
  className = "",
}: {
  parallax?: boolean;
  className?: string;
}) {
  const { detail, reduced } = useStageQuality();
  const dark = useIsDark();

  return (
    <Stage className={className} camera={{ position: [0, 0, CAMERA], fov: 34 }} dark={dark}>
      <FieldObject detail={detail} reduced={reduced} parallax={parallax} dark={dark} />
    </Stage>
  );
}
