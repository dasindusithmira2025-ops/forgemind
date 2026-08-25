import * as THREE from "three";

/**
 * The point sprite: one soft round dot, generated locally.
 *
 * A square point is the giveaway that a scene is a particle demo. This is drawn
 * once into a 64px canvas with a falloff at the rim, so a point stays a fine
 * circular mark at any size rather than a hard disc with aliased edges — the
 * difference between a data point and a speck of dust.
 */
let cached: THREE.Texture | null = null;

export function dotTexture() {
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d context unavailable");

  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.82, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cached = texture;
  return texture;
}
