import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  type Curve,
  Vector3,
} from "three";

export type RibbonOptions = {
  segments: number;
  sides: number;
  /** Half-size of the cross-section along the frame normal. */
  width: (t: number) => number;
  /** Half-size of the cross-section along the binormal. */
  thickness: (t: number) => number;
  /** Total twist in radians. Closed curves need a multiple of 2π. */
  twist?: number;
  closed?: boolean;
  seed?: number;
};

/**
 * Sweeps an elliptical cross-section along a curve.
 * Besides position/normal it stores the centreline, tangent and curve
 * parameter so the liquid shader can swell, draw and bend the stroke.
 */
export function buildRibbon(curve: Curve<Vector3>, options: RibbonOptions) {
  const { segments, sides, closed = false, twist = 0, seed = 0 } = options;
  const frames = curve.computeFrenetFrames(segments, closed);
  const length = curve.getLength();
  const count = (segments + 1) * (sides + 1);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const center = new Float32Array(count * 3);
  const tangent = new Float32Array(count * 3);
  const along = new Float32Array(count);
  const len = new Float32Array(count).fill(length);
  const seeds = new Float32Array(count).fill(seed);
  const indices: number[] = [];
  const point = new Vector3();
  const offset = new Vector3();
  const facing = new Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(closed && i === segments ? 0 : t, point);
    const frame = closed && i === segments ? 0 : i;
    const T = frames.tangents[frame];
    const N = frames.normals[frame];
    const B = frames.binormals[frame];
    const a = options.width(t);
    const b = options.thickness(t);
    const turn = twist * t;
    const ct = Math.cos(turn);
    const st = Math.sin(turn);
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      // Ellipse point and its outward normal, rotated by the twist.
      const ex = c * a;
      const ey = s * b;
      const nx = c * b;
      const ny = s * a;
      offset
        .copy(N)
        .multiplyScalar(ex * ct - ey * st)
        .addScaledVector(B, ex * st + ey * ct);
      facing
        .copy(N)
        .multiplyScalar(nx * ct - ny * st)
        .addScaledVector(B, nx * st + ny * ct)
        .normalize();
      const k = i * (sides + 1) + j;
      position.set(
        [point.x + offset.x, point.y + offset.y, point.z + offset.z],
        k * 3,
      );
      normal.set([facing.x, facing.y, facing.z], k * 3);
      center.set([point.x, point.y, point.z], k * 3);
      tangent.set([T.x, T.y, T.z], k * 3);
      along[k] = t;
      if (i < segments && j < sides) {
        indices.push(
          k,
          k + 1,
          k + sides + 1,
          k + 1,
          k + sides + 2,
          k + sides + 1,
        );
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("normal", new BufferAttribute(normal, 3));
  geometry.setAttribute("aCenter", new BufferAttribute(center, 3));
  geometry.setAttribute("aTangent", new BufferAttribute(tangent, 3));
  geometry.setAttribute("aT", new BufferAttribute(along, 1));
  geometry.setAttribute("aLen", new BufferAttribute(len, 1));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const v = (points: number[][]) =>
  points.map(([x, y, z]) => new Vector3(x, y, z));

// Original calligraphic paths: a rising N and a looping L (not a downloaded model).
const signatureStrokes = [
  v([
    [-2.0, -1.4, 0],
    [-1.75, -0.8, 0.1],
    [-1.2, 0.55, 0.05],
    [-0.55, 1.8, -0.1],
    [-0.35, 1.9, 0],
    [-0.4, 1.35, 0.2],
    [-0.7, -0.65, 0.3],
    [-0.55, -1.05, 0.2],
    [-0.15, -0.25, -0.1],
    [0.5, 1.45, -0.2],
    [1.1, 2.35, 0],
    [1.4, 2.25, 0.15],
    [1.2, 1.6, 0.2],
    [0.5, -0.6, 0.2],
  ]),
  v([
    [0.4, -0.7, 0.4],
    [0.85, 0.6, 0.4],
    [1.8, 1.45, 0.05],
    [2.05, 1.35, -0.1],
    [1.8, 0.7, -0.2],
    [0.75, -0.5, -0.15],
    [-0.15, -1.35, 0.1],
    [-0.2, -1.6, 0.2],
    [0.5, -1.4, 0.4],
    [1.55, -1.75, 0.1],
    [2.1, -1.8, 0],
    [2.5, -1.4, 0.1],
  ]),
];

export function signatureGeometries(mobile: boolean) {
  return signatureStrokes.map((points, stroke) =>
    buildRibbon(new CatmullRomCurve3(points, false, "centripetal"), {
      segments: mobile ? 320 : 480,
      sides: mobile ? 28 : 40,
      twist: Math.PI * 1.6,
      seed: stroke * 0.37,
      width: (t) => {
        const taper = Math.sin(Math.PI * t) ** 0.42;
        return (
          0.012 + taper * (0.19 + 0.12 * Math.sin(t * Math.PI * 4 + stroke))
        );
      },
      thickness: (t) => {
        const taper = Math.sin(Math.PI * t) ** 0.42;
        return (
          0.012 +
          taper * 0.6 * (0.19 + 0.12 * Math.sin(t * Math.PI * 4 + stroke))
        );
      },
    }),
  );
}

/** Trefoil knot swept by a thin twisted band: a Möbius-like sculpture. */
export function knotGeometry(mobile: boolean) {
  const points: Vector3[] = [];
  for (let i = 0; i < 96; i++) {
    const u = (i / 96) * Math.PI * 2;
    const r = 2 + Math.cos(3 * u);
    points.push(
      new Vector3(
        r * Math.cos(2 * u),
        r * Math.sin(2 * u),
        Math.sin(3 * u) * 1.1,
      ).multiplyScalar(0.62),
    );
  }
  return buildRibbon(new CatmullRomCurve3(points, true, "centripetal"), {
    segments: mobile ? 420 : 640,
    sides: mobile ? 24 : 32,
    closed: true,
    twist: Math.PI * 4,
    seed: 0.21,
    width: () => 0.3,
    thickness: () => 0.045,
  });
}

/** Two long flowing bands for the wide projects banner. */
export function waveGeometries(mobile: boolean) {
  const band = (phase: number, lift: number, depth: number) => {
    const points: Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const x = -8 + (16 * i) / 14;
      points.push(
        new Vector3(
          x,
          lift + Math.sin(x * 0.55 + phase) * 1.05,
          depth + Math.cos(x * 0.42 + phase) * 0.9,
        ),
      );
    }
    return new CatmullRomCurve3(points, false, "centripetal");
  };
  const segments = mobile ? 360 : 560;
  const sides = mobile ? 24 : 32;
  return [
    buildRibbon(band(0, 0.1, 0), {
      segments,
      sides,
      twist: Math.PI * 2.2,
      seed: 0.1,
      width: () => 0.62,
      thickness: () => 0.07,
    }),
    buildRibbon(band(2.2, -0.35, -1.2), {
      segments,
      sides,
      twist: -Math.PI * 1.4,
      seed: 0.63,
      width: () => 0.26,
      thickness: () => 0.2,
    }),
  ];
}
