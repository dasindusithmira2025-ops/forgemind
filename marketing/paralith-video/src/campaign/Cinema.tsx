import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { useScale } from '../film/Layers';
import { STARTS } from './script';

/**
 * The film's cinematography layer: atmosphere, light, and the object the product sits on.
 *
 * The earlier cut treated the product as a flat rectangle on pure black, on the principle that
 * anything else would be decoration. That principle produced something accurate and inert. What is
 * here instead is the smallest set of physical cues that make a screen read as an object in a room
 * — a light source, a falloff, a contact shadow, a reflection, and a barely-there atmosphere — with
 * every one of them tuned to be felt rather than noticed.
 *
 * The discipline that keeps this from becoming the glow-and-bloom template: the only hue in the
 * entire layer is sampled from the PARALITH mark's own gradient, it never exceeds 7% opacity, and
 * nothing here ever touches the interface itself. The product stays colour-accurate; the room
 * around it is what got lit.
 */

/** The mark's gradient endpoints — cyan through violet. The only chroma the film's chrome uses. */
export const BRAND = {
  cyan: '34, 211, 238',
  violet: '139, 108, 255',
  indigo: '79, 90, 255',
} as const;

/**
 * The room.
 *
 * A very slow drifting field, brand-tinted, sitting under everything. At 95 seconds a static
 * gradient reads as a flat backdrop; drifting it a few percent over the whole film is what makes
 * the black feel like depth rather than like an empty layer. The movement is far too slow to
 * perceive directly, which is the point — it is felt as space, not seen as motion.
 */
export const Atmosphere: React.FC<{ intensity?: number }> = ({ intensity = 1 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / Math.max(1, durationInFrames);

  /** Two slow orbits, out of phase, so the field never repeats within the running time. */
  const x1 = 50 + Math.sin(t * Math.PI * 1.1) * 11;
  const y1 = 40 + Math.cos(t * Math.PI * 0.8) * 8;
  const x2 = 50 + Math.cos(t * Math.PI * 0.7 + 1.2) * 14;
  const y2 = 62 + Math.sin(t * Math.PI * 1.3 + 0.4) * 9;

  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(58% 52% at ${x1}% ${y1}%, rgba(${BRAND.indigo}, ${0.055 * intensity}) 0%, rgba(0,0,0,0) 68%)`,
          `radial-gradient(52% 46% at ${x2}% ${y2}%, rgba(${BRAND.violet}, ${0.04 * intensity}) 0%, rgba(0,0,0,0) 66%)`,
          `radial-gradient(120% 100% at 50% 44%, rgba(255,255,255,0.032) 0%, rgba(255,255,255,0.008) 44%, rgba(0,0,0,0) 74%)`,
        ].join(','),
        pointerEvents: 'none',
      }}
    />
  );
};

/**
 * A single soft key, high and slightly camera-left, and the falloff it creates across the frame.
 *
 * This sits *above* the product rather than under it, which is the one place the film knowingly
 * puts something on top of the interface. It is a 3.5% white wash at its brightest and it is what
 * stops a 1440px near-black window from reading as a cutout pasted onto a near-black field.
 */
export const KeyLight: React.FC<{ intensity?: number }> = ({ intensity = 1 }) => (
  <AbsoluteFill
    style={{
      background:
        `radial-gradient(80% 70% at 34% 8%, rgba(255,255,255,${0.035 * intensity}) 0%, rgba(255,255,255,${0.012 * intensity}) 38%, rgba(0,0,0,0) 72%)`,
      mixBlendMode: 'screen',
      pointerEvents: 'none',
    }}
  />
);

/**
 * The edges of the frame, closed down.
 *
 * Slightly stronger than the previous cut's vignette and, crucially, elliptical rather than
 * circular, so a 16:9 frame darkens at the left and right edges without pulling a dark band across
 * the top and bottom of a 9:16 one.
 */
export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(128% 108% at 50% 46%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.28) 78%, rgba(0,0,0,0.62) 100%)',
      pointerEvents: 'none',
    }}
  />
);

export interface Shot {
  scale: number;
  offset: { x: number; y: number };
}

/**
 * The stage: where the product window sits, and what makes it read as a lit object.
 *
 * Beyond the previous cut's hairline and contact shadow, three things were added and each one is
 * doing a job that a flat rectangle could not:
 *
 * **A specular top edge.** A real display has a bright line along its top bezel where the room
 * reflects off it. Without it the window's top edge is the same value as its interior and the
 * object has no thickness.
 *
 * **A floor reflection.** A soft, heavily-faded, vertically-flipped ghost beneath the window. It is
 * clipped to a shallow band and never exceeds 12% — enough to imply the surface the window is
 * standing on, not enough to be looked at.
 *
 * **Optional perspective.** A few degrees of Y-rotation with a long perspective distance. Used
 * sparingly and never while text is being read: it is on for the establishing and closing shots,
 * off for every shot where the viewer is meant to read the interface, because rotated type is
 * harder to read and the film's whole argument is made of small type.
 */
export const Stage: React.FC<{
  width: number;
  height: number;
  shot: Shot;
  radius?: number;
  opacity?: number;
  /** Degrees of Y-rotation. Keep under 6; past that the far edge softens visibly. */
  tilt?: number;
  /** 0-1. Blurs the whole object, for shots where it is not the subject. */
  defocus?: number;
  children: React.ReactNode;
}> = ({ width, height, shot, radius = 12, opacity = 1, tilt = 0, defocus = 0, children }) => {
  const { scale, offset } = shot;
  const edge = Math.max(1, scale);

  const frame = (
    <div
      style={{
        position: 'relative',
        width: width * scale,
        height: height * scale,
        borderRadius: radius * scale,
        overflow: 'hidden',
        boxShadow: [
          `0 ${52 * scale}px ${130 * scale}px rgba(0,0,0,0.78)`,
          `0 ${10 * scale}px ${30 * scale}px rgba(0,0,0,0.55)`,
          `0 0 ${90 * scale}px rgba(${BRAND.indigo},0.07)`,
        ].join(','),
        outline: `${edge}px solid rgba(255,255,255,0.09)`,
        outlineOffset: -edge,
      }}
    >
      {children}

      {/* The specular top edge. One pixel of light along the bezel, falling off over ~90px. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `linear-gradient(to bottom, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.028) ${1.5 * scale}px, rgba(255,255,255,0) ${90 * scale}px)`,
        }}
      />
    </div>
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: offset.x,
        top: offset.y,
        width: width * scale,
        height: height * scale,
        opacity,
        perspective: 2600 * scale,
        filter: defocus > 0.002 ? `blur(${defocus * 9 * Math.max(1, scale)}px)` : undefined,
      }}
    >
      <div style={{ transform: tilt ? `rotateY(${tilt}deg)` : undefined, transformStyle: 'preserve-3d' }}>
        {frame}

        {/*
          The floor. A flipped, blurred, steeply-faded ghost of the window. It is drawn from the
          same children rather than as a generic gradient so the reflection actually corresponds to
          what is on screen — a reflection that does not match its object is worse than none.
        */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: height * scale,
            left: 0,
            width: width * scale,
            height: Math.min(height * scale * 0.3, 240 * scale),
            overflow: 'hidden',
            pointerEvents: 'none',
            // 7%, not 12%, and blurred four pixels rather than two. At the first setting the
            // reflected terminal text was still readable upside-down under the window, which pulls
            // the eye straight to it — a reflection has to be inferred, never read.
            opacity: 0.07,
            transform: 'scaleY(-1)',
            transformOrigin: 'top',
            maskImage: 'linear-gradient(to top, rgba(0,0,0,0) 18%, rgba(0,0,0,0.7) 82%)',
            WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,0) 18%, rgba(0,0,0,0.7) 82%)',
            filter: `blur(${4.5 * Math.max(1, scale)}px)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              width: width * scale,
              height: height * scale,
              borderRadius: radius * scale,
              overflow: 'hidden',
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * A brand-tinted bloom behind the mark.
 *
 * Only ever used on the two frames that hold the logo. A mark on pure black has nothing to sit in;
 * this gives it a room without putting a glow on the artwork itself, which would thicken its
 * strokes and is the single fastest way to make a wordmark look cheap.
 */
export const MarkBloom: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => {
  const k = useScale();
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 1180 * k,
          height: 520 * k,
          background: [
            `radial-gradient(closest-side, rgba(${BRAND.indigo},0.16), rgba(0,0,0,0) 72%)`,
            `radial-gradient(closest-side, rgba(${BRAND.cyan},0.07), rgba(0,0,0,0) 60%)`,
          ].join(','),
          filter: `blur(${34 * k}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Sequence-aware defocus for the transition frames.
 *
 * Rather than cutting hard from a dense interface into the endcard, the product is allowed to fall
 * out of focus for a few frames on either side of the two structural transitions. It reads as a
 * lens change rather than as an edit, and it is the cheapest way to make eight hard cuts feel like
 * one continuous piece of camerawork.
 */
export const useTransitionDefocus = (): number => {
  const frame = useCurrentFrame();
  const points = [STARTS.arrival, STARTS.close];
  return points.reduce((value, point) => {
    const distance = Math.abs(frame - point);
    const span = 26;
    return Math.max(value, distance > span ? 0 : 1 - distance / span);
  }, 0);
};
