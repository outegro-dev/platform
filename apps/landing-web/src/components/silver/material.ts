import {
  MeshPhysicalMaterial,
  type MeshPhysicalMaterialParameters,
  Vector3,
} from "three";

// Ashima Arts 3D simplex noise (MIT), prefixed to avoid clashes with three's chunks.
const NOISE = /* glsl */ `
vec3 lqMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 lqMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 lqPermute(vec4 x) { return lqMod289(((x * 34.0) + 10.0) * x); }
vec4 lqTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float lqNoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = lqMod289(i);
  vec4 p = lqPermute(lqPermute(lqPermute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = lqTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const HEADER = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uFlow;
uniform float uWaves;
uniform float uSpeed;
uniform float uWobble;
uniform float uClosed;
uniform vec3 uPointer;
uniform float uPointerStrength;
attribute vec3 aCenter;
attribute vec3 aTangent;
attribute float aT;
attribute float aLen;
attribute float aSeed;
${NOISE}
`;

// Swell travelling along the stroke (mercury flowing inside), slow noise bend
// of the whole centreline, a tip that "writes" the stroke, and a local swell
// under the pointer. The normal is tilted by the radius slope so reflections flow too.
const RIBBON_BODY = /* glsl */ `
vec3 lqOffset = position - aCenter;
float lqRadius = length(lqOffset);
float lqEnds = mix(smoothstep(0.0, 0.14, aT) * (1.0 - smoothstep(0.86, 1.0, aT)), 1.0, uClosed);
float lqTau = 6.28318530718;
float lqPhase = (aT * uWaves - uTime * uSpeed + aSeed) * lqTau;
float lqRipple = (aT * uWaves * 3.7 - uTime * uSpeed * 1.9 + aSeed * 2.0) * lqTau;
float lqGrow = 1.0 - smoothstep(uReveal - 0.045, uReveal, aT);
float lqWave = sin(lqPhase) + 0.22 * sin(lqRipple);
float lqSlope = (cos(lqPhase) * uWaves + 0.22 * cos(lqRipple) * uWaves * 3.7) * lqTau;
float lqNt = uTime * 0.24 + aSeed * 3.1;
vec3 lqBend = vec3(
  lqNoise(aCenter * 0.42 + vec3(lqNt, 0.0, 0.0)),
  lqNoise(aCenter * 0.42 + vec3(0.0, lqNt, 7.3)),
  lqNoise(aCenter * 0.42 + vec3(3.1, 0.0, lqNt))
) * uWobble;
vec3 lqToPointer = aCenter + lqBend - uPointer;
float lqTouch = uPointerStrength * exp(-dot(lqToPointer, lqToPointer) * 2.2);
float lqScale = lqGrow * (1.0 + uFlow * lqWave * lqEnds) * (1.0 + lqTouch);
float lqRadiusSlope = lqGrow * uFlow * lqSlope * lqEnds * lqRadius / max(aLen, 0.001);
vec3 objectNormal = normalize(normal - aTangent * lqRadiusSlope);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
vec3 transformed = aCenter + lqBend + lqOffset * lqScale
  + normalize(lqToPointer + vec3(1e-4)) * lqTouch * 0.12 * lqGrow;
`;

// Liquid glass drop: sphere displaced by noise, normal rebuilt from neighbours.
const BLOB_HEADER = /* glsl */ `
uniform float uTime;
uniform float uWobble;
${NOISE}
vec3 lqBlob(vec3 dir, float radius) {
  return dir * radius * (1.0 + uWobble * lqNoise(dir * 1.25 + vec3(uTime * 0.32, uTime * 0.21, 0.0)));
}
`;

const BLOB_BODY = /* glsl */ `
float bpRadius = length(position);
vec3 bpDir = position / bpRadius;
vec3 bpUp = abs(bpDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
vec3 bpT1 = normalize(cross(bpDir, bpUp));
vec3 bpT2 = cross(bpDir, bpT1);
vec3 bpP0 = lqBlob(bpDir, bpRadius);
vec3 bpP1 = lqBlob(normalize(bpDir + bpT1 * 0.02), bpRadius);
vec3 bpP2 = lqBlob(normalize(bpDir + bpT2 * 0.02), bpRadius);
vec3 objectNormal = normalize(cross(bpP1 - bpP0, bpP2 - bpP0));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
vec3 transformed = bpP0;
`;

export type LiquidSettings = {
  flow: number;
  waves: number;
  speed: number;
  wobble: number;
  closed: boolean;
};

export function createLiquidSilver(
  settings: LiquidSettings,
  params: MeshPhysicalMaterialParameters = {},
) {
  const uniforms = {
    uTime: { value: 0 },
    uReveal: { value: 1.1 },
    uFlow: { value: settings.flow },
    uWaves: { value: settings.waves },
    uSpeed: { value: settings.speed },
    uWobble: { value: settings.wobble },
    uClosed: { value: settings.closed ? 1 : 0 },
    uPointer: { value: new Vector3(99, 99, 99) },
    uPointerStrength: { value: 0 },
  };
  const material = new MeshPhysicalMaterial({
    color: "#e6e7e4",
    metalness: 1,
    roughness: 0.055,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.2,
    iridescence: 0.14,
    iridescenceIOR: 1.33,
    iridescenceThicknessRange: [140, 420],
    ...params,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${HEADER}`)
      .replace("#include <beginnormal_vertex>", RIBBON_BODY)
      .replace("#include <begin_vertex>", "");
  };
  material.customProgramCacheKey = () => "liquid-silver-ribbon-1";
  return { material, uniforms };
}

export function createLiquidGlass(wobble: number) {
  const uniforms = { uTime: { value: 0 }, uWobble: { value: wobble } };
  const material = new MeshPhysicalMaterial({
    color: "#ffffff",
    metalness: 0,
    roughness: 0,
    transmission: 1,
    thickness: 1.3,
    ior: 1.62,
    dispersion: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0,
    envMapIntensity: 2.4,
    specularIntensity: 1,
    iridescence: 0.18,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [180, 520],
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${BLOB_HEADER}`)
      .replace("#include <beginnormal_vertex>", BLOB_BODY)
      .replace("#include <begin_vertex>", "");
  };
  material.customProgramCacheKey = () => "liquid-glass-blob-1";
  return { material, uniforms };
}
