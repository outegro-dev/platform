import {
  BackSide,
  BufferAttribute,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  type WebGLRenderer,
} from "three";

/**
 * Photographic chrome studio, generated in code (no HDR download):
 * a graded dome plus bright softboxes and dark flags. Silver reads
 * crisp only with high-contrast reflections, so the env map is 1024 px
 * (three's default is 256 px, which is what made the metal look soft).
 */
export function createStudioEnvironment(gl: WebGLRenderer, size = 1024) {
  const scene = new Scene();
  const dome = new SphereGeometry(40, 64, 32);
  const colors = new Float32Array(dome.attributes.position.count * 3);
  const floor = new Color("#646662");
  const horizon = new Color("#a9aba7");
  const sky = new Color("#f6f6f4");
  const mixed = new Color();
  for (let i = 0; i < dome.attributes.position.count; i++) {
    const y = dome.attributes.position.getY(i) / 40;
    if (y < 0) mixed.lerpColors(horizon, floor, Math.min(1, -y * 2.4));
    else mixed.lerpColors(horizon, sky, Math.min(1, y * 1.7));
    colors.set([mixed.r, mixed.g, mixed.b], i * 3);
  }
  dome.setAttribute("color", new BufferAttribute(colors, 3));
  scene.add(
    new Mesh(
      dome,
      new MeshBasicMaterial({
        vertexColors: true,
        side: BackSide,
        toneMapped: false,
      }),
    ),
  );

  const panel = (
    width: number,
    height: number,
    intensity: number,
    position: [number, number, number],
    dark = false,
  ) => {
    const material = new MeshBasicMaterial({
      color: dark
        ? new Color("#3a3b39")
        : new Color(1, 1, 1).multiplyScalar(intensity),
      side: DoubleSide,
      toneMapped: false,
    });
    const mesh = new Mesh(new PlaneGeometry(width, height), material);
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  // Key softbox above-front, long strips left/right, rim behind, a kicker below.
  panel(16, 6, 3.2, [0, 14, 8]);
  panel(2.2, 18, 4.5, [-13, 2, 4]);
  panel(1.6, 16, 3.4, [13, 0, 5]);
  panel(20, 1.4, 5, [0, 4, -14]);
  panel(8, 1.2, 2.2, [4, -9, 10]);
  // Negative fill: dark flags give the metal its defining black bands.
  panel(5, 18, 0, [-9, 0, 12], true);

  const generator = new PMREMGenerator(gl);
  const target = generator.fromScene(scene, 0.02, 0.1, 100, { size });
  generator.dispose();
  scene.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      (object.material as MeshBasicMaterial).dispose();
    }
  });
  return target;
}
