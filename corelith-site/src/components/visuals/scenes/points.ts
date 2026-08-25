import * as THREE from "three";
import { dotTexture } from "./dot";

/**
 * The one material every Corelith point cloud is drawn with.
 *
 * Per-point size, colour and alpha, plus a depth fade: points on the far side
 * of an object drop to almost nothing so the form is read from its density
 * rather than from a silhouette. That single behaviour is most of what makes
 * the objects on this site look like light rather than like geometry, and it is
 * shared rather than reimplemented — the family resemblance lives here, not in
 * a model reused across sections.
 */
const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;

  uniform float uCam;    // camera distance to the object's centre
  uniform float uSpan;   // half-depth of the object
  uniform float uFade;   // how much the far side falls away, 0..1
  uniform float uScale;  // pixel size at unit distance

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vColor = aColor;
    vec4 view = modelViewMatrix * vec4(position, 1.0);

    // 0 at the back of the object, 1 at the front.
    float facing = clamp((view.z + uCam + uSpan) / (2.0 * uSpan), 0.0, 1.0);

    vAlpha = aAlpha * mix(1.0, 0.04 + facing * facing * 0.96, uFade);
    gl_PointSize = aSize * uScale * mix(1.0, 0.6 + facing * 0.4, uFade) / -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float mask = texture2D(uMap, gl_PointCoord).a;
    if (mask * vAlpha < 0.008) discard;
    gl_FragColor = vec4(vColor, mask * vAlpha);
  }
`;

export function pointMaterial({
  cam,
  span,
  fade = 1,
  scale = 260,
}: {
  cam: number;
  span: number;
  fade?: number;
  scale?: number;
}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTexture() },
      uCam: { value: cam },
      uSpan: { value: span },
      uFade: { value: fade },
      uScale: { value: scale },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
}

/** sRGB values arrive from CSS; the renderer works in linear. */
export function linear(colour: string) {
  return new THREE.Color(colour).convertSRGBToLinear();
}
