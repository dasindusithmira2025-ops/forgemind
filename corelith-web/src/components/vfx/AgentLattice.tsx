'use client';

import { useEffect, useRef } from 'react';

/**
 * The field behind the hero: a coordination graph with work moving through it.
 *
 * This is the one piece of the page that is genuinely animated rather than
 * merely revealed, so it is the one piece that has to be *about* something. It
 * is a picture of the product's central claim — an origin on the left, agents
 * working in parallel across the middle, two gates every packet has to clear,
 * and the project on the right. Packets only ever travel left to right, and a
 * packet that reaches a gate rings it before it is allowed on. Nothing here is
 * ambient shapes drifting in a dark rectangle.
 *
 * Drawn as flat marks — hairline edges, small squares, expanding rings. No
 * blur, no shadow, no gradient: the system prints, it does not glow, and a
 * canvas is not exempt from that because it is a canvas.
 *
 * The colours are read from the stylesheet rather than written here, so the
 * field re-inks itself if the palette moves and no token is duplicated in JS.
 */

type Kind = 'hub' | 'agent' | 'gate';

interface LatticeNode {
  /** Normalised position in the field, 0→1 on each axis. */
  x: number;
  y: number;
  kind: Kind;
  /** Per-node offset, so the drift never resolves into a single shared wave. */
  phase: number;
}

/**
 * The graph reads left to right: origin → four agents → three in a second rank
 * → two gates → the project. Hand-placed rather than generated; a random layout
 * puts nodes in a clump about a third of the time.
 */
const NODES: LatticeNode[] = [
  { x: 0.06, y: 0.5, kind: 'hub', phase: 0.0 },
  { x: 0.28, y: 0.16, kind: 'agent', phase: 1.1 },
  { x: 0.31, y: 0.4, kind: 'agent', phase: 2.4 },
  { x: 0.27, y: 0.66, kind: 'agent', phase: 3.7 },
  { x: 0.33, y: 0.9, kind: 'agent', phase: 4.9 },
  { x: 0.55, y: 0.26, kind: 'agent', phase: 0.6 },
  { x: 0.58, y: 0.55, kind: 'agent', phase: 2.0 },
  { x: 0.53, y: 0.84, kind: 'agent', phase: 3.3 },
  { x: 0.78, y: 0.4, kind: 'gate', phase: 5.5 },
  { x: 0.8, y: 0.7, kind: 'gate', phase: 1.7 },
  { x: 0.95, y: 0.55, kind: 'hub', phase: 2.9 },
];

/** Always ordered low → high, which is what makes the flow directional. */
const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 2],
  [1, 5],
  [2, 5],
  [2, 6],
  [3, 6],
  [3, 7],
  [4, 7],
  [6, 7],
  [5, 8],
  [6, 8],
  [6, 9],
  [7, 9],
  [8, 10],
  [9, 10],
];

const PACKET_COUNT = 7;

/** Field units per second. Slow: this is a background, not a screensaver. */
const PACKET_SPEED = 0.34;

/** How far a node wanders from its placed position, in field units. */
const DRIFT = 0.012;

interface Packet {
  edge: number;
  /** Progress along the edge, 0→1. Negative values are the wait before launch. */
  t: number;
  speed: number;
}

interface Ping {
  x: number;
  y: number;
  /** Seconds since the ring was struck. */
  age: number;
}

/** `#rrggbb` → `r, g, b`, ready to interpolate into an `rgba()` string. */
function channels(hex: string): string {
  const value = hex.trim().replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) return '140, 166, 255';
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
}

export function AgentLattice({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const styles = getComputedStyle(canvas);
    const core = channels(styles.getPropertyValue('--color-core') || '#4166e4');
    const coreInk = channels(styles.getPropertyValue('--color-core-ink') || '#8ca6ff');
    const ink = channels(styles.getPropertyValue('--color-ink') || '#f2f2f4');

    const stillOnly = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;

    /** Pointer parallax, in device-independent pixels, eased toward the target. */
    let parallaxX = 0;
    let parallaxY = 0;
    let targetX = 0;
    let targetY = 0;

    const packets: Packet[] = Array.from({ length: PACKET_COUNT }, (_, i) => ({
      edge: Math.floor((i * EDGES.length) / PACKET_COUNT),
      // Staggered starts, so the field is already mid-flow on the first frame
      // rather than firing every packet at once.
      t: -i * 0.42,
      speed: PACKET_SPEED * (0.75 + ((i * 7) % 5) / 10),
    }));

    const pings: Ping[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      width = rect.width;
      height = rect.height;

      // Capped at 2: past that the pixel cost doubles again for marks that are
      // one or two pixels across and cannot show the difference.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    /** Placed position plus drift, in pixels, plus the node's share of parallax. */
    const positionOf = (node: LatticeNode, time: number) => {
      const depth = 0.4 + node.x * 0.8;
      return {
        x:
          (node.x + Math.sin(time * 0.32 + node.phase) * DRIFT) * width +
          parallaxX * depth,
        y:
          (node.y + Math.cos(time * 0.27 + node.phase * 1.3) * DRIFT) * height +
          parallaxY * depth,
      };
    };

    const draw = (time: number, delta: number) => {
      context.clearRect(0, 0, width, height);

      const points = NODES.map((node) => positionOf(node, time));

      // Which edges are carrying something right now — a live edge is inked
      // more heavily, so the graph shows where the work is rather than just
      // that work exists.
      const live = new Set(packets.filter((packet) => packet.t >= 0).map((packet) => packet.edge));

      /* --- Edges --- */
      context.lineWidth = 1;
      EDGES.forEach(([from, to], index) => {
        const a = points[from];
        const b = points[to];
        context.strokeStyle = live.has(index)
          ? `rgba(${coreInk}, 0.3)`
          : `rgba(${ink}, 0.075)`;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      });

      /* --- Pings ---
         Struck when a packet clears a node. Rings, drawn as rings: the radius
         grows and the ink thins, and nothing is ever added to the surrounding
         pixels. */
      for (let i = pings.length - 1; i >= 0; i -= 1) {
        const ping = pings[i];
        ping.age += delta;
        const life = ping.age / 1.1;
        if (life >= 1) {
          pings.splice(i, 1);
          continue;
        }
        context.strokeStyle = `rgba(${core}, ${(1 - life) * 0.5})`;
        context.beginPath();
        context.arc(ping.x, ping.y, 4 + life * 26, 0, Math.PI * 2);
        context.stroke();
      }

      /* --- Nodes ---
         Squares, not circles. The mark is hexagonal and the type is squared;
         a field of dots would be the one round thing in the system. */
      NODES.forEach((node, index) => {
        const point = points[index];
        const size = node.kind === 'hub' ? 7 : node.kind === 'gate' ? 5 : 3.5;

        if (node.kind === 'agent') {
          context.fillStyle = `rgba(${ink}, 0.42)`;
          context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
          return;
        }

        // Hubs and gates are structure rather than workers, so they are drawn
        // open — an outline reads as a fixture, a fill reads as a unit of work.
        context.strokeStyle = `rgba(${core}, ${node.kind === 'hub' ? 0.95 : 0.7})`;
        context.lineWidth = 1.5;
        context.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
        context.lineWidth = 1;
      });

      /* --- Packets --- */
      packets.forEach((packet) => {
        if (packet.t < 0) return;
        const [from, to] = EDGES[packet.edge];
        const a = points[from];
        const b = points[to];

        // Eased across the edge: work leaves quickly and settles into its
        // destination, which is the shape of a task being handed over.
        const eased = packet.t * packet.t * (3 - 2 * packet.t);
        const x = a.x + (b.x - a.x) * eased;
        const y = a.y + (b.y - a.y) * eased;

        // A short trail, so direction is legible in a still frame.
        const trail = Math.max(0, eased - 0.12);
        context.strokeStyle = `rgba(${coreInk}, 0.35)`;
        context.beginPath();
        context.moveTo(a.x + (b.x - a.x) * trail, a.y + (b.y - a.y) * trail);
        context.lineTo(x, y);
        context.stroke();

        context.fillStyle = `rgba(${coreInk}, 0.95)`;
        context.fillRect(x - 2, y - 2, 4, 4);
      });
    };

    const advance = (delta: number, points: { x: number; y: number }[]) => {
      packets.forEach((packet) => {
        packet.t += delta * packet.speed;
        if (packet.t < 1) return;

        // Cleared the node at the far end — ring it, then re-target. The next
        // edge is picked from those leaving the node just reached, so a packet
        // keeps travelling toward the project rather than teleporting.
        const arrived = EDGES[packet.edge][1];
        pings.push({ x: points[arrived].x, y: points[arrived].y, age: 0 });

        const onward: number[] = [];
        EDGES.forEach(([from], index) => {
          if (from === arrived) onward.push(index);
        });

        if (onward.length) {
          packet.edge = onward[Math.floor(Math.random() * onward.length)];
          packet.t = 0;
        } else {
          // Reached the project. Start again from an edge leaving the origin,
          // after a beat.
          const fromOrigin: number[] = [];
          EDGES.forEach(([from], index) => {
            if (from === 0) fromOrigin.push(index);
          });
          packet.edge = fromOrigin[Math.floor(Math.random() * fromOrigin.length)];
          packet.t = -Math.random() * 0.9;
        }
      });
    };

    let frame = 0;
    let last = 0;
    let elapsed = 0;
    let running = false;

    const loop = (now: number) => {
      // Clamped: a backgrounded tab resumes with a delta of several seconds,
      // which would otherwise fling every packet across the field at once.
      const delta = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      elapsed += delta;

      parallaxX += (targetX - parallaxX) * 0.06;
      parallaxY += (targetY - parallaxY) * 0.06;

      advance(delta, NODES.map((node) => positionOf(node, elapsed)));
      draw(elapsed, delta);

      frame = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || stillOnly) return;
      running = true;
      last = 0;
      frame = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    resize();
    // A still frame first, so the field is never an empty rectangle for the one
    // frame before the loop starts — and so it is the whole of the render for a
    // reader who has asked for no motion.
    draw(0, 0);
    if (stillOnly) {
      // Give the still frame something to show: run the packets far enough in
      // that the graph reads as carrying work rather than as a bare skeleton.
      packets.forEach((packet, i) => {
        packet.t = 0.2 + (i % 4) * 0.2;
      });
      draw(0, 0);
    }

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw(elapsed, 0);
    });
    resizeObserver.observe(canvas);

    // Off-screen and background tabs cost nothing.
    const visibility = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()),
      { threshold: 0 },
    );
    visibility.observe(canvas);

    const onVisibilityChange = () => (document.hidden ? stop() : undefined);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onPointerMove = (event: PointerEvent) => {
      // Parallax is driven from the window rather than the canvas: the field is
      // masked and largely sits behind copy, so binding it to the canvas would
      // mean it only responds when the pointer is somewhere the reader has no
      // reason to put it.
      targetX = (event.clientX / window.innerWidth - 0.5) * 26;
      targetY = (event.clientY / window.innerHeight - 0.5) * 18;
    };

    if (!stillOnly && window.matchMedia('(pointer: fine)').matches) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
    }

    return () => {
      stop();
      resizeObserver.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`lattice pointer-events-none absolute inset-0 -z-10 h-full w-full ${className}`}
    />
  );
}
