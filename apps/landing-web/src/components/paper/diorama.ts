import {
  type BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  type Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  Plane,
  PlaneGeometry,
  ShadowMaterial,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
  type WebGLRenderer,
} from "three";
import { type SpriteName, sprites } from "./sprites";
import {
  creaseShade,
  GRID_TILE,
  gridPaper,
  hillStrip,
  LINED_TILE,
  linedPaper,
  PAPER_BACK,
  SEA_TILE,
  seaPaper,
  signText,
  waveStrip,
} from "./textures";

/*
 * A pop-up book diorama on notebook paper, one station per step of the work:
 * a workshop and a treasure map, an easel under a cloud, a ship in its
 * scaffolding, a lighthouse and a rocket, a pier. The camera pans along the
 * stations with the scroll; props fold up from the page as it approaches.
 *
 * Everything is scrubbed by the scroll: the camera, how far each card has
 * unfolded, the ship being built, launched and moored, the rocket, the
 * waves and the sun. The camera and the voyages move smoothly so they track
 * the wheel; the cards follow on twos (12 fps) through a stiff spring, which
 * adds the overshoot, and the boiling jitter and bobbing tick at 12 fps too,
 * like stop-motion.
 */

export const STATIONS = [0, 9.5, 19, 28.5, 38] as const;
/** Where a narrow (phone) frame centres on each station. */
const PHONE_FOCUS = [0.7, 0.3, 0, 0.1, -0.3] as const;
const LAST = STATIONS.length - 1;
const FPS = 12;
/** A card lying on the page, a hair off flat so it never z-fights the paper. */
const FLAT = Math.PI / 2 - 0.015;
const COAST = 23.4;
const LANE_Z = -0.6;
const SEA_Y = -0.16;
const DOCK = { x: STATIONS[2] + 0.05, y: 0.6 };
const MOOR_X = STATIONS[4] - 2.05;
const PIER = { x: STATIONS[4] + 1.1, y: -0.38, z: 1.3, width: 4.6 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const coastX = (z: number) =>
  COAST + Math.sin(z * 1.3) * 0.5 + Math.sin(z * 3.1 + 1) * 0.22;

const aspectOf = (name: SpriteName) =>
  sprites[name].width / sprites[name].height;

/** A plane standing on its bottom edge; anchorX 0.5 pivots at the centre. */
function standing(width: number, height: number, anchorX = 0.5) {
  return new PlaneGeometry(width, height).translate(
    (0.5 - anchorX) * width,
    height / 2,
    0,
  );
}

function scaleUv(geometry: BufferGeometry, su: number, sv: number) {
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Cut-out material: the drawing on the front, plain card stock on the back
 * (a folded-down card shows its white back), alpha-tested silhouette so
 * shadows follow the outline.
 */
function cardMaterial(map: Texture) {
  const material = new MeshBasicMaterial({
    map,
    alphaTest: 0.5,
    side: DoubleSide,
  });
  material.alphaToCoverage = true;
  const back = new Color(PAPER_BACK);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.paperBack = { value: back };
    shader.fragmentShader = `uniform vec3 paperBack;\n${shader.fragmentShader.replace(
      "#include <map_fragment>",
      `vec4 sampledDiffuseColor = texture2D( map, vMapUv );
      if ( ! gl_FrontFacing ) sampledDiffuseColor.rgb = paperBack;
      diffuseColor *= sampledDiffuseColor;`,
    )}`;
  };
  material.customProgramCacheKey = () => "paper-card";
  return material;
}

/** Pop-up ramp width, in stations of scroll. */
const RAMP = 0.35;
/** Ease-out with overshoot: the page snaps a little past upright. */
const backOut = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

/**
 * How far a card in this scroll range has unfolded (0 flat … 1 open):
 * it rises over RAMP stations before the range and folds after it.
 * `lag` staggers cards of one station so they pop one after another.
 */
function unfold(range: [number, number], lag: number, s: number) {
  return (
    smooth(range[0] - RAMP + lag, range[0] + lag, s) *
    (1 - smooth(range[1] - lag, range[1] + RAMP - lag, s))
  );
}

type CardOptions = {
  at: [number, number, number];
  /** Scroll range (in stations) in which the card stands fully up. */
  range: [number, number];
  /** Stagger within a station, in stations of scroll. */
  lag?: number;
  /** Standing angle: 0 upright, negative leans back. */
  open?: number;
  boil?: number;
  flip?: boolean;
  /** 1 folds towards the viewer (face down), -1 away (face up). */
  fold?: 1 | -1;
};

/**
 * A cut-out hinged at its bottom edge. The scroll position scrubs how far
 * it has unfolded; a stiff spring follows on twos, adding the bounce.
 */
class Card {
  readonly rig = new Group();
  readonly body = new Group();
  readonly base = new Vector3();
  /** Stepped offset on top of the base (bobbing, hops). */
  readonly offset = new Vector3();
  readonly range: [number, number];
  readonly lag: number;
  readonly open: number;
  readonly boil: number;
  readonly fold: number;
  angle: number;
  velocity = 0;
  tilt = 0;

  constructor(
    readonly id: number,
    readonly mesh: Mesh,
    options: CardOptions,
  ) {
    this.range = options.range;
    this.lag = options.lag ?? 0;
    this.open = options.open ?? 0;
    this.boil = options.boil ?? 1;
    this.fold = options.fold ?? 1;
    this.angle = this.fold * FLAT;
    this.base.set(...options.at);
    mesh.castShadow = true;
    this.body.add(mesh);
    this.rig.add(this.body);
    if (options.flip) this.rig.scale.x = -1;
    this.rig.rotation.x = this.angle;
    this.place();
  }

  get upright() {
    return Math.abs(this.angle - this.open) < 0.45;
  }

  /** One stop-motion frame: follow the scroll, boil the outline. */
  tick(s: number, frame: number) {
    const flat = this.fold * FLAT;
    const target =
      flat + (this.open - flat) * backOut(unfold(this.range, this.lag, s));
    const h = 1 / FPS / 4;
    for (let i = 0; i < 4; i++) {
      this.velocity += (300 * (target - this.angle) - 21 * this.velocity) * h;
      this.angle += this.velocity * h;
      // Slapping onto the page: a small bounce instead of passing through.
      if (this.fold * this.angle > FLAT) {
        this.angle = flat;
        this.velocity *= -0.3;
      }
    }
    const loop = frame % 3;
    const b = this.boil;
    this.rig.rotation.x = this.angle;
    this.body.rotation.z = (hash(loop, this.id) - 0.5) * 0.024 * b + this.tilt;
    this.body.position.x = (hash(loop + 7, this.id) - 0.5) * 0.03 * b;
    this.body.position.y = (hash(loop + 13, this.id) - 0.5) * 0.02 * b;
  }

  place() {
    this.rig.position.copy(this.base).add(this.offset);
  }
}

/** Clouds and the sun dangle on threads from above the page. */
class Hanger {
  readonly group = new Group();
  readonly swing = new Group();
  drop: number;
  velocity = 0;
  phase: number;

  constructor(
    readonly mesh: Mesh,
    thread: Mesh,
    readonly anchor: Vector3,
    readonly range: [number, number] | null,
  ) {
    this.phase = anchor.x * 0.37;
    this.drop = range ? 7 : 0;
    mesh.castShadow = true;
    this.swing.add(mesh);
    this.group.add(thread, this.swing);
    this.group.position.copy(anchor);
  }

  /** Lowered on its thread as the scroll reaches its range. */
  tick(s: number, time: number) {
    if (this.range) {
      const target = 7 * (1 - backOut(unfold(this.range, 0, s)));
      const h = 1 / FPS / 4;
      for (let i = 0; i < 4; i++) {
        this.velocity += (160 * (target - this.drop) - 12 * this.velocity) * h;
        this.drop += this.velocity * h;
      }
    }
    this.swing.rotation.z = Math.sin(time * 1.1 + this.phase) * 0.06;
  }
}

type Maps = Record<SpriteName, Texture>;

export class Diorama {
  readonly root = new Group();
  private readonly cards: Card[] = [];
  private readonly hangers: Hanger[] = [];
  private readonly waves: Card[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly light = new DirectionalLight(0xffffff, 1);
  private readonly shipClip = new Plane(new Vector3(0, -1, 0), 1000);
  private readonly ship: Card;
  private readonly rocket: Card;
  private readonly lighthouse: Card;
  private readonly island: Card;
  private readonly tree: Card;
  private readonly beam: Mesh;
  private readonly beamMaterial: MeshBasicMaterial;
  private readonly gull: Mesh;
  private readonly sun: Hanger;
  private readonly shipHeight: number;
  private readonly gullDeck: number;
  private time = 0;
  private frame = -1;
  private progress = Number.NaN;
  private speed = 0;
  private cameraX = 0;
  private atSea = 0;
  private slide = 0;
  private flight = 0;

  constructor(maps: Maps, sign: Texture | null, shadowSize: number) {
    for (const map of Object.values(maps)) this.own(map);
    const lined = this.own(linedPaper());
    const grid = this.own(gridPaper());
    const sea = this.own(seaPaper());

    // ── The two pages: the floor and the back wall of the book ──
    const backGeometry = this.own(
      scaleUv(new PlaneGeometry(100, 26), 100 / LINED_TILE, 26 / LINED_TILE),
    );
    const paperMaterial = this.own(new MeshBasicMaterial({ map: lined }));
    const back = new Mesh(backGeometry, paperMaterial);
    back.position.set(25, 13, -5);
    const floorGeometry = this.own(
      scaleUv(new PlaneGeometry(100, 26), 100 / LINED_TILE, 26 / LINED_TILE),
    );
    const floor = new Mesh(floorGeometry, paperMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(25, 0, 8);
    this.root.add(back, floor);

    const crease = new Mesh(
      this.own(new PlaneGeometry(100, 1.6)),
      this.own(
        new MeshBasicMaterial({
          map: this.own(creaseShade()),
          transparent: true,
          depthWrite: false,
        }),
      ),
    );
    crease.position.set(25, 0.8, -4.97);
    this.root.add(crease);

    // The red margin rule, running down the wall and across the floor.
    const marginMaterial = this.own(
      new MeshBasicMaterial({
        color: "#e0574c",
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    for (const dx of [0, 0.11]) {
      const wall = new Mesh(
        this.own(new PlaneGeometry(0.035, 26)),
        marginMaterial,
      );
      wall.position.set(-5.4 + dx, 13, -4.975);
      const run = new Mesh(
        this.own(new PlaneGeometry(0.035, 26)),
        marginMaterial,
      );
      run.rotation.x = -Math.PI / 2;
      run.position.set(-5.4 + dx, 0.003, 8);
      this.root.add(wall, run);
    }

    // ── Land of green grid paper with a cut coastline, sea of blue strips ──
    const coast = (offset: number) => {
      const shape = new Shape();
      shape.moveTo(-30, 5);
      for (let z = -5; z <= 21; z += 0.25) shape.lineTo(coastX(z) + offset, -z);
      shape.lineTo(-30, -21);
      shape.closePath();
      return shape;
    };
    const landBorder = new Mesh(
      this.own(new ShapeGeometry(coast(0.16))),
      this.own(new MeshBasicMaterial({ color: "#fffdf6" })),
    );
    const landGeometry = this.own(new ShapeGeometry(coast(0)));
    scaleUv(landGeometry, 1 / GRID_TILE, 1 / GRID_TILE);
    const land = new Mesh(
      landGeometry,
      this.own(new MeshBasicMaterial({ map: grid })),
    );
    const seaShape = new Shape();
    seaShape.moveTo(COAST - 1.5, 5);
    seaShape.lineTo(80, 5);
    seaShape.lineTo(80, -21);
    seaShape.lineTo(COAST - 1.5, -21);
    seaShape.closePath();
    const seaGeometry = this.own(new ShapeGeometry(seaShape));
    scaleUv(seaGeometry, 1 / SEA_TILE, 1 / SEA_TILE);
    const seaFloor = new Mesh(
      seaGeometry,
      this.own(new MeshBasicMaterial({ map: sea })),
    );
    for (const [mesh, y] of [
      [seaFloor, 0.004],
      [landBorder, 0.008],
      [land, 0.012],
    ] as const) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      this.root.add(mesh);
    }

    // Shadow catchers over both pages: the only lit materials in the scene.
    const shadowMaterial = this.own(
      new ShadowMaterial({
        color: "#3a2814",
        opacity: 0.24,
        depthWrite: false,
      }),
    );
    const floorShadow = new Mesh(
      this.own(new PlaneGeometry(100, 26)),
      shadowMaterial,
    );
    floorShadow.rotation.x = -Math.PI / 2;
    floorShadow.position.set(25, 0.05, 8);
    floorShadow.receiveShadow = true;
    const wallShadow = new Mesh(
      this.own(new PlaneGeometry(100, 26)),
      shadowMaterial,
    );
    wallShadow.position.set(25, 13, -4.985);
    wallShadow.receiveShadow = true;
    this.root.add(floorShadow, wallShadow);

    // ── Cut-outs ──
    const materials = {} as Record<SpriteName, MeshBasicMaterial>;
    for (const name of Object.keys(sprites) as SpriteName[]) {
      materials[name] = this.own(cardMaterial(maps[name]));
    }
    const size = (name: SpriteName, fit: { w?: number; h?: number }) => {
      const aspect = aspectOf(name);
      const h = fit.h ?? (fit.w ?? 1) / aspect;
      return { w: h * aspect, h };
    };
    let id = 0;
    const add = (
      name: SpriteName,
      fit: { w?: number; h?: number },
      options: CardOptions,
      material: Material = materials[name],
    ) => {
      const { w, h } = size(name, fit);
      const mesh = new Mesh(this.own(standing(w, h)), material);
      const card = new Card(id++, mesh, options);
      this.cards.push(card);
      this.root.add(card.rig);
      return card;
    };

    // Hills of grid paper behind the land.
    const hillTiles = [
      { z: -4.4, h: 2.0, seed: 1.3, lag: 0.08 },
      { z: -3.85, h: 1.4, seed: 4.1, lag: 0.16 },
    ];
    for (const hill of hillTiles) {
      const map = this.own(
        hillStrip(grid.image as HTMLCanvasElement, hill.seed),
      );
      const width = 42;
      const geometry = this.own(
        scaleUv(standing(width, hill.h, 0), width / (hill.h * 2), 1),
      );
      const material = this.own(cardMaterial(map));
      const card = new Card(id++, new Mesh(geometry, material), {
        at: [-20, 0.02, hill.z],
        range: [-0.85, 2.45],
        lag: hill.lag,
        boil: 0.4,
      });
      this.cards.push(card);
      this.root.add(card.rig);
    }

    // 1 · Research: the workshop, a tree, a treasure map on a stand.
    add("house", { h: 3 }, { at: [-1.1, 0.02, -1.7], range: [-0.8, 0.45] });
    this.tree = add(
      "tree",
      { h: 3.3 },
      { at: [2.75, 0.02, -2.75], range: [-0.8, 0.45], lag: 0.08 },
    );
    add(
      "map",
      { h: 1.45 },
      {
        at: [0.95, 0.02, 1.35],
        range: [-0.8, 0.45],
        lag: 0.16,
        open: -0.7,
      },
    );

    // 2 · Design: the easel (and a cloud, see the hangers below).
    add(
      "easel",
      { h: 2.9 },
      { at: [STATIONS[1] - 0.1, 0.02, -0.6], range: [0.6, 1.45] },
    );
    add(
      "tree",
      { h: 2.3 },
      {
        at: [STATIONS[1] - 2.6, 0.02, -2.9],
        range: [0.6, 1.45],
        lag: 0.12,
        flip: true,
      },
    );

    // 3 · Development: scaffolding with the ship inside, a server rack.
    // The scaffolding folds away as the ship slides out of it.
    add(
      "scaffold",
      { w: 6.4 },
      { at: [STATIONS[2], 0.02, -0.25], range: [1.6, 2.3] },
    );
    const shipMaterial = this.own(cardMaterial(maps.ship));
    shipMaterial.clippingPlanes = [this.shipClip];
    shipMaterial.clipShadows = true;
    const shipSize = size("ship", { w: 3.4 });
    this.shipHeight = shipSize.h;
    this.ship = add(
      "ship",
      { w: 3.4 },
      {
        at: [DOCK.x, DOCK.y, LANE_Z],
        range: [1.6, 99],
        boil: 0.8,
      },
      shipMaterial,
    );
    add(
      "server",
      { h: 2.6 },
      {
        at: [STATIONS[2] - 3.6, 0.02, -3.0],
        range: [1.6, 2.35],
        lag: 0.12,
        boil: 2.4,
      },
    );

    // 4 · Launch: the sea stands up in strips, a lighthouse, a rocket.
    const waveSpecs = [
      { z: 2.4, h: 0.62, color: "#5fa8dd", lag: 0 },
      { z: 0.5, h: 0.72, color: "#78b9e6", lag: 0.05 },
      { z: -1.6, h: 0.78, color: "#8cc7ee", lag: 0.1 },
      { z: -3.2, h: 0.82, color: "#a3d4f2", lag: 0.15 },
    ];
    waveSpecs.forEach((spec, i) => {
      const map = this.own(waveStrip(spec.color, i * 1.7, 30 + i));
      const start = coastX(spec.z) - 0.25;
      const width = 80 - start;
      const tile = (spec.h * 512) / 150;
      const geometry = this.own(
        scaleUv(standing(width, spec.h, 0), width / tile, 1),
      );
      const card = new Card(
        id++,
        new Mesh(geometry, this.own(cardMaterial(map))),
        {
          at: [start, 0, spec.z],
          range: [1.9, 99],
          lag: spec.lag,
          boil: 0.5,
        },
      );
      this.cards.push(card);
      this.waves.push(card);
      this.root.add(card.rig);
    });
    this.lighthouse = add(
      "lighthouse",
      { h: 4.4 },
      {
        at: [STATIONS[3] - 0.5, -0.28, -2.4],
        range: [2.6, 3.5],
        lag: 0.05,
      },
    );
    this.beamMaterial = this.own(
      new MeshBasicMaterial({
        color: "#fff2a1",
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    const beamShape = new Shape();
    beamShape.moveTo(0, 0.05);
    beamShape.lineTo(6, 0.75);
    beamShape.lineTo(6, -0.75);
    beamShape.lineTo(0, -0.05);
    beamShape.closePath();
    this.beam = new Mesh(
      this.own(new ShapeGeometry(beamShape)),
      this.beamMaterial,
    );
    this.beam.position.set(0, 4.4 * 0.827, 0.04);
    this.lighthouse.body.add(this.beam);
    this.rocket = add(
      "rocket",
      { h: 2.1 },
      {
        at: [STATIONS[3] + 2.5, -0.1, -3.9],
        range: [2.6, 3.6],
        lag: 0.14,
        boil: 1.6,
      },
    );

    // 5 · Support: the pier with its sign and a seagull, an island.
    const pier = add(
      "pier",
      { w: PIER.width },
      {
        at: [PIER.x, PIER.y, PIER.z],
        range: [3.6, 99],
        boil: 0.7,
      },
    );
    const pierHeight = size("pier", { w: PIER.width }).h;
    if (sign) {
      const signMesh = new Mesh(
        this.own(new PlaneGeometry(1.42, 0.76)),
        this.own(
          new MeshBasicMaterial({
            map: this.own(sign),
            transparent: true,
            depthWrite: false,
          }),
        ),
      );
      signMesh.position.set(
        (0.8 - 0.5) * PIER.width,
        0.793 * pierHeight,
        0.015,
      );
      pier.body.add(signMesh);
    }
    const gullSize = size("seagull", { h: 0.95 });
    this.gull = new Mesh(
      this.own(standing(gullSize.w, gullSize.h)),
      materials.seagull,
    );
    this.gull.castShadow = true;
    this.gullDeck = 0.488 * pierHeight;
    this.gull.position.set(-0.5, this.gullDeck, 0.06);
    pier.body.add(this.gull);
    this.island = add(
      "island",
      { w: 4.4 },
      {
        at: [STATIONS[4] + 2.6, -0.2, -4.2],
        range: [3.6, 99],
        lag: 0.12,
      },
    );

    // ── Hangers: clouds and the sun on threads ──
    const threadMaterial = this.own(
      new MeshBasicMaterial({ color: "#6d6353" }),
    );
    const threadGeometry = this.own(
      new PlaneGeometry(0.02, 30).translate(0, 15, -0.02),
    );
    const hang = (
      name: SpriteName,
      width: number,
      anchor: [number, number, number],
      range: [number, number] | null,
      flip = false,
      centred = false,
    ) => {
      const { w, h } = size(name, { w: width });
      const mesh = new Mesh(this.own(new PlaneGeometry(w, h)), materials[name]);
      mesh.position.y = centred ? 0 : -h / 2 + 0.12;
      if (flip) mesh.scale.x = -1;
      const hanger = new Hanger(
        mesh,
        new Mesh(threadGeometry, threadMaterial),
        new Vector3(...anchor),
        range,
      );
      this.hangers.push(hanger);
      this.root.add(hanger.group);
      return hanger;
    };
    // One cloud drifts over each station (they trail the camera by half).
    const clouds: [number, number, number, number, boolean][] = [
      [-2.0, 5.8, -4.2, 2.3, false],
      [6.0, 6.1, -4.4, 1.8, true],
      [16.0, 5.7, -4.0, 2.4, false],
      [25.0, 6.1, -4.3, 2.0, true],
      [34.5, 5.8, -4.1, 2.3, false],
    ];
    for (const [x, y, z, w, flip] of clouds)
      hang("cloud", w, [x, y, z], null, flip);
    hang("cloud", 2.7, [STATIONS[1] + 1.4, 4.9, -1.9], [0.6, 1.45]);
    this.sun = hang("sun", 2.2, [0, 6.2, -4.5], null, false, true);

    // ── Light: only shadows, following the camera ──
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(shadowSize, shadowSize);
    const shadowCamera = this.light.shadow.camera;
    shadowCamera.left = -15;
    shadowCamera.right = 15;
    shadowCamera.top = 12;
    shadowCamera.bottom = -12;
    shadowCamera.near = 0.5;
    shadowCamera.far = 45;
    this.light.shadow.radius = 5;
    this.light.shadow.bias = -0.0006;
    this.root.add(this.light, this.light.target);
  }

  private own<T extends { dispose(): void }>(value: T) {
    this.disposables.push(value);
    return value;
  }

  /** Whether the smoothed scroll has caught up (no frame needed for it). */
  settled(progress: number) {
    return Math.abs(progress - this.progress) < 0.0002 && this.speed === 0;
  }

  /**
   * `progress` is the scroll through the section: 0 when it pins, 1 when it
   * unpins; negative while it scrolls into view (the first station unfolds
   * then), above 1 while it leaves.
   */
  update(
    camera: PerspectiveCamera,
    width: number,
    height: number,
    progress: number,
    delta: number,
  ) {
    // The stop-motion clock skips at most a few frames after a stall; the
    // scroll catches up regardless.
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    const previous = this.progress;
    this.progress = Number.isNaN(previous)
      ? progress
      : MathUtils.damp(previous, progress, 6, Math.min(delta, 0.5));
    if (Math.abs(this.progress - progress) < 0.0002) this.progress = progress;
    const s = this.progress * STATIONS.length - 0.5;
    const speed = Number.isNaN(previous)
      ? 0
      : (Math.abs(this.progress - previous) * STATIONS.length) /
        Math.max(dt, 1e-3);
    this.speed = MathUtils.damp(this.speed, Math.min(speed, 4), 4, dt);
    if (this.speed < 0.005) this.speed = 0;

    // Camera: dwells at each station, pans in between.
    const sc = MathUtils.clamp(s, 0, LAST);
    const segment = Math.min(Math.floor(sc), LAST - 1);
    const pan = smooth(0.2, 0.8, sc - segment);
    const cx = MathUtils.lerp(STATIONS[segment], STATIONS[segment + 1], pan);
    this.cameraX = cx;
    const focus = MathUtils.lerp(
      PHONE_FOCUS[segment],
      PHONE_FOCUS[segment + 1],
      pan,
    );
    this.frameCamera(camera, width, height, width < 768 ? cx + focus : cx);

    const frame = Math.floor(this.time * FPS);
    if (frame !== this.frame) {
      const behind = this.frame < 0 ? 1 : Math.min(frame - this.frame, 3);
      for (let i = behind - 1; i >= 0; i--) this.tick(s, frame - i);
      this.frame = frame;
    }
    this.place(s, cx, width < 768);
  }

  private frameCamera(
    camera: PerspectiveCamera,
    width: number,
    height: number,
    cx: number,
  ) {
    const mobile = width < 768;
    const aspect = width / Math.max(1, height);
    const distance = mobile ? 17.5 : 14;
    const halfWidth = mobile ? 3.7 : 6.2;
    camera.position.set(cx, mobile ? 5.6 : 4.9, distance);
    camera.lookAt(cx, mobile ? 1.6 : 1.9, -1);
    const fromWidth = 2 * Math.atan(halfWidth / (aspect * distance));
    const fromHeight = 2 * Math.atan(3.3 / distance);
    const fov = MathUtils.radToDeg(Math.max(fromWidth, fromHeight));
    camera.fov = MathUtils.clamp(fov, 24, 66);
    camera.near = 0.5;
    camera.far = 120;
    // Lens shift instead of aiming: the station sits right of the caption
    // card on wide screens and above it on phones.
    if (mobile) {
      camera.setViewOffset(width, height, 0, height * 0.06, width, height);
    } else {
      camera.setViewOffset(width, height, -width * 0.14, 0, width, height);
    }
  }

  /** Stop-motion frame: springs, bobbing, boiling outlines. */
  private tick(s: number, frame: number) {
    const t = frame / FPS;
    for (const card of this.cards) card.tick(s, frame);
    for (const hanger of this.hangers) hanger.tick(s, t);

    // Waves roll with time and with the scroll.
    this.waves.forEach((wave, i) => {
      wave.offset.set(
        Math.sin(t * 1.6 + i * 1.9 + s * 2.6) * 0.16,
        Math.sin(t * 2.3 + i + s * 3.1) * 0.025,
        0,
      );
    });
    // The ship rocks harder the faster you scroll.
    const rock = 0.05 + this.speed * 0.05;
    this.ship.offset.y = this.atSea * Math.sin(t * 2.4 + s * 4) * rock;
    this.ship.tilt = this.atSea * Math.sin(t * 1.7 + s * 5) * rock + this.slide;
    this.tree.tilt = Math.sin(t * 1.4) * 0.02;
    this.island.tilt = Math.sin(t * 1.2 + 1) * 0.015;
    this.rocket.tilt = this.flight > 0 ? (hash(frame, 99) - 0.5) * 0.09 : 0;

    // The seagull hops along the deck, turning round now and then.
    const spots = [-1.15, -0.45, 0.3, -0.45, -0.9];
    const cycle = 1.75;
    const hop = Math.floor(t / cycle);
    const phase = (t % cycle) / cycle;
    const from = spots[hop % spots.length];
    const to = spots[(hop + 1) % spots.length];
    const u = clamp01(phase / 0.3);
    this.gull.position.x = MathUtils.lerp(from, to, u);
    this.gull.position.y =
      this.gullDeck + Math.sin(u * Math.PI) * (u < 1 ? 0.32 : 0);
    // The drawing faces left; mirror it when hopping right.
    this.gull.scale.x = to > from ? -1 : 1;
    this.gull.rotation.z = u < 1 ? (to > from ? 0.12 : -0.12) : 0;

    // The lighthouse lamp sweeps round (a flat beam, flipping sides).
    const sweep = Math.cos(t * 2.1 + s * 3);
    this.beam.scale.x = sweep;
    this.beam.visible = this.lighthouse.upright;
    this.beamMaterial.opacity = 0.16 + 0.38 * Math.abs(sweep);

    // The sun turns with the scroll (and a little on its own); the whole
    // page weaves slightly, like a film gate.
    this.sun.mesh.rotation.z = -(t * 0.12 + s * 1.2);
    this.root.position.set(
      (hash(frame, 1) - 0.5) * 0.012,
      (hash(frame, 2) - 0.5) * 0.008,
      0,
    );
    this.light.position.set(this.cameraX - 8, 9, 7);
    this.light.target.position.set(this.cameraX + 1, 0, -2);
  }

  /** Scroll-driven placement, every rendered frame (smooth, not stepped). */
  private place(s: number, cx: number, mobile: boolean) {
    // The ship: built plank by plank while you stay at Development,
    const reveal = clamp01((s - 1.55) / 0.6);
    const built = Math.floor(reveal * 8) / 8;
    this.shipClip.constant =
      reveal >= 1 ? 1000 : this.ship.base.y + built * this.shipHeight;
    // then slides down the slipway past the lighthouse and sails to the pier.
    let x = DOCK.x;
    if (s > 2.3 && s <= 3.1) {
      x = MathUtils.lerp(DOCK.x, STATIONS[3] + 1.3, smooth(2.3, 3.1, s));
    } else if (s > 3.1) {
      x = MathUtils.lerp(STATIONS[3] + 1.3, MOOR_X, smooth(3.1, 3.9, s));
    }
    const shore = coastX(LANE_Z);
    const onLand = clamp01((shore - 0.4 - x) / (shore - 0.4 - DOCK.x));
    const water = smooth(shore - 0.6, shore + 0.6, x);
    // A dip into the water right where it leaves the slipway.
    const splash = Math.sin(clamp01((x - shore + 0.6) / 2.2) * Math.PI);
    const y =
      MathUtils.lerp(0.05, DOCK.y, onLand) * (1 - water) +
      (SEA_Y - splash * 0.18) * water;
    this.ship.base.set(x, y, LANE_Z);
    this.atSea = water;
    this.slide = x > DOCK.x + 0.01 && water < 1 ? -0.09 * (1 - water) : 0;

    // The rocket lifts off past the lighthouse and leaves the frame.
    const lift = clamp01((s - 2.95) / 0.6);
    this.flight = lift;
    const climb = lift * lift;
    this.rocket.offset.set(climb * 5.2, climb * 11, 0);

    // The sun keeps to the sky, drifting back as the story goes on.
    const sc = MathUtils.clamp(s, 0, LAST);
    this.sun.group.position.x = cx + (mobile ? 1.7 : 4.4 - sc * 0.3);
    this.sun.group.position.y = mobile ? 7.4 : 5.1;
    // Clouds trail the camera a little: they read as further away.
    const t = this.frame / FPS;
    for (const hanger of this.hangers) {
      if (hanger === this.sun) continue;
      hanger.group.position.set(
        hanger.anchor.x + Math.sin(t / 3 + hanger.phase) * 0.4 + sc * 0.5,
        hanger.anchor.y + hanger.drop + (mobile ? 1.2 : 0),
        hanger.anchor.z,
      );
    }
    for (const card of this.cards) card.place();
  }

  dispose() {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
  }
}

/** Loads the sprites and the sign, then builds the diorama. */
export async function createDiorama(renderer: WebGLRenderer) {
  const loader = new TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const names = Object.keys(sprites) as SpriteName[];
  const [textures, sign] = await Promise.all([
    Promise.all(
      names.map(async (name) => {
        const map = await loader.loadAsync(sprites[name].src);
        map.colorSpace = SRGBColorSpace;
        map.anisotropy = anisotropy;
        return map;
      }),
    ),
    signText(["ПРИЧАЛ", "№1"]).catch(() => null),
  ]);
  const maps = {} as Maps;
  names.forEach((name, i) => {
    maps[name] = textures[i];
  });
  const small = Math.min(window.innerWidth, window.innerHeight) < 768;
  const diorama = new Diorama(maps, sign, small ? 1024 : 2048);
  return diorama;
}
