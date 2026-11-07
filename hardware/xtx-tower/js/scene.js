// Three.js scene for the XTX Tower. Builds the chassis from a layout made
// by layout.js (all millimetres) and animates the explode, drawer, glass,
// airflow and x-ray views.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { C } from './layout.js';

const TAU = Math.PI * 2;
const EXPLODE = { drawer: 70, gpu: 150, spine: 95 };
const COOL = new THREE.Color('#58b4ff');
const HOT = new THREE.Color('#ff6a3d');
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------- textures

function canvasTexture(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Hex perforation used as an alpha map: white is metal, black is a hole.
function perforationTexture() {
  return canvasTexture(64, 112, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 112);
    g.fillStyle = '#000';
    for (const [x, y] of [[0, 0], [64, 0], [32, 56], [0, 112], [64, 112]]) {
      g.beginPath();
      g.arc(x, y, 21, 0, TAU);
      g.fill();
    }
  }, { srgb: false });
}

// Light/dark bands that repeat along v (`across` = false) or u (true).
function stripeTexture(light, dark, across = false) {
  const [w, h] = across ? [16, 8] : [8, 16];
  return canvasTexture(w, h, (g) => {
    g.fillStyle = dark;
    g.fillRect(0, 0, w, h);
    g.fillStyle = light;
    if (across) g.fillRect(0, 0, 9, h);
    else g.fillRect(0, 0, w, 9);
  });
}

function textTexture(text, { w = 1024, h = 128, font = '600 72px system-ui, sans-serif', color = '#7d838c', spacing = 18 } = {}) {
  return canvasTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
    const m = g.measureText(text);
    g.fillText(text, (w - m.width) / 2, h / 2 + 4);
  }, { repeat: false });
}

// --------------------------------------------------------------- materials

const std = (color, metalness, roughness, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });

function makeMaterials() {
  return {
    perf: perforationTexture(),
    finsV: stripeTexture('#b3b9c1', '#2c3036'),
    finsU: stripeTexture('#b3b9c1', '#2c3036', true),
    chassis: std('#1b1d21', 0.35, 0.52),
    trim: std('#2a2d33', 0.6, 0.36),
    inner: std('#0c0d0f', 0.1, 0.9),
    seam: new THREE.MeshBasicMaterial({ color: '#050506' }),
    plastic: std('#0e0f11', 0, 0.55),
    pcb: std('#171a1f', 0.15, 0.55),
    silver: std('#c9cdd2', 0.95, 0.25),
    steel: std('#8b9199', 0.85, 0.35),
    copper: std('#c07a4c', 0.95, 0.3),
    gold: std('#caa04a', 1, 0.3),
    rubber: std('#0a0a0b', 0, 0.95),
    cable: std('#141518', 0.05, 0.6),
    riser: std('#2a2c31', 0.45, 0.4, { side: THREE.DoubleSide }),
    fanFrame: std('#17181b', 0.1, 0.6),
    fanBlade: std('#232529', 0.05, 0.45),
    dimm: std('#2c2f35', 0.75, 0.32),
    heatsink: std('#34373d', 0.8, 0.35),
    hole: new THREE.MeshBasicMaterial({ color: '#050506' }),
    port: std('#08090a', 0.2, 0.5),
    portBlue: std('#2b5fd9', 0.1, 0.5),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#b7c2cf', metalness: 0, roughness: 0.03, transparent: true, opacity: 0.14,
      clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.8,
    }),
    frit: std('#060607', 0.2, 0.25),
    led: new THREE.MeshBasicMaterial({ color: '#e4eeff' }),
    floor: std('#0d0f12', 0, 0.92),
    mat: std('#181b20', 0, 0.85),
  };
}

// ----------------------------------------------------------------- helpers

function addBox(parent, mat, x0, y0, z0, w, h, d, opts = {}) {
  if (w <= 0 || h <= 0 || d <= 0) return null;
  const r = opts.radius ? Math.min(opts.radius, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01) : 0;
  const geo = r > 0.2 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x0 + w / 2, y0 + h / 2, z0 + d / 2);
  if (opts.cast) m.castShadow = true;
  if (opts.info) m.userData.info = opts.info;
  if (opts.shell) m.userData.shell = true;
  parent.add(m);
  return m;
}

function addCylinder(parent, mat, r, h, x, y, z, axis = 'y', segments = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Fill the rectangle [z0,z1] x [y0,y1] at x in [x0, x0+t] with plate,
// leaving the given holes open.
function plateWithHoles(parent, mat, x0, t, z0, z1, y0, y1, holes, opts) {
  const ys = [...new Set([y0, y1, ...holes.flatMap((h) => [h.y0, h.y1])])]
    .filter((y) => y >= y0 && y <= y1)
    .sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    const ya = ys[i - 1], yb = ys[i], mid = (ya + yb) / 2;
    const blocking = holes.filter((h) => h.y0 <= mid && h.y1 >= mid).sort((a, b) => a.z0 - b.z0);
    let z = z0;
    for (const h of blocking) {
      if (h.z0 > z) addBox(parent, mat, x0, ya, z, t, yb - ya, h.z0 - z, opts);
      z = Math.max(z, h.z1);
    }
    if (z < z1) addBox(parent, mat, x0, ya, z, t, yb - ya, z1 - z, opts);
  }
}

// --------------------------------------------------------------- fan parts

const fanGeoCache = new Map();
function fanGeometry(size) {
  if (fanGeoCache.has(size)) return fanGeoCache.get(size);
  const half = size / 2, r = size * 0.47;
  const shape = new THREE.Shape();
  const k = 6;
  shape.moveTo(-half + k, -half);
  shape.lineTo(half - k, -half);
  shape.quadraticCurveTo(half, -half, half, -half + k);
  shape.lineTo(half, half - k);
  shape.quadraticCurveTo(half, half, half - k, half);
  shape.lineTo(-half + k, half);
  shape.quadraticCurveTo(-half, half, -half, half - k);
  shape.lineTo(-half, -half + k);
  shape.quadraticCurveTo(-half, -half, -half + k, -half);
  const hole = new THREE.Path();
  hole.absarc(0, 0, r, 0, TAU, true);
  shape.holes.push(hole);
  const frame = new THREE.ExtrudeGeometry(shape, { depth: C.fanT, bevelEnabled: false, curveSegments: 28 });
  frame.translate(0, 0, -C.fanT / 2);
  const geo = {
    frame,
    hub: new THREE.CylinderGeometry(size * 0.17, size * 0.17, C.fanT - 6, 24).rotateX(Math.PI / 2),
    blade: new THREE.BoxGeometry(size * 0.29, size * 0.15, 1.4),
  };
  fanGeoCache.set(size, geo);
  return geo;
}

function rotor(mats, radius, blades, spinners, speed, thickness = 1.4) {
  const g = new THREE.Group();
  const hubR = radius * 0.34;
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, 6, 24).rotateX(Math.PI / 2), mats.fanBlade));
  const len = radius - hubR - 1.5;
  const bladeGeo = new THREE.BoxGeometry(len, radius * 0.42, thickness);
  for (let i = 0; i < blades; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / blades) * TAU;
    const b = new THREE.Mesh(bladeGeo, mats.fanBlade);
    b.position.x = hubR + len / 2;
    b.rotation.x = 0.45;
    arm.add(b);
    g.add(arm);
  }
  spinners.push({ obj: g, speed });
  return g;
}

// Case fan facing +Z. Rotate the returned group to aim it.
function caseFan(mats, size, spinners) {
  const geo = fanGeometry(size);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo.frame, mats.fanFrame));
  const r = rotor(mats, size * 0.46, 7, spinners, 22);
  g.add(r);
  return g;
}

// ------------------------------------------------------------------- flows

class Flow {
  constructor(parent, paths, count) {
    this.paths = paths.map((p) => {
      const pts = p.points;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const len = cum[cum.length - 1];
      return { pts, cum, len, heatA: cum[p.heat[0]] / len, heatB: cum[p.heat[1]] / len, speed: p.speed ?? 240 };
    });
    this.items = [];
    this.paths.forEach((p, pi) => {
      for (let i = 0; i < count; i++) this.items.push({ p: pi, phase: i / count + Math.random() * 0.05 });
    });
    const geo = new THREE.SphereGeometry(3, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.items.length);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.mesh.renderOrder = 5;
    const col = new THREE.Color();
    this.items.forEach((_, i) => this.mesh.setColorAt(i, col.copy(COOL)));
    parent.add(this.mesh);
    this.tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), v: new THREE.Vector3(), d: new THREE.Vector3(), c: new THREE.Color() };
  }

  update(time) {
    const { m, q, s, v, d, c } = this.tmp;
    const Z = AXIS_Z;
    this.items.forEach((it, i) => {
      const p = this.paths[it.p];
      const u = (time * p.speed / p.len + it.phase) % 1;
      const dist = u * p.len;
      let k = 1;
      while (k < p.cum.length - 1 && p.cum[k] < dist) k++;
      const a = p.pts[k - 1], b = p.pts[k];
      const seg = p.cum[k] - p.cum[k - 1] || 1;
      v.copy(a).lerp(b, (dist - p.cum[k - 1]) / seg);
      d.copy(b).sub(a).normalize();
      q.setFromUnitVectors(Z, d);
      const fade = Math.min(1, Math.sin(Math.PI * u) * 2.2);
      s.set(fade, fade, fade * 2.6);
      m.compose(v, q, s);
      this.mesh.setMatrixAt(i, m);
      const h = THREE.MathUtils.smoothstep(u, p.heatA, p.heatB);
      this.mesh.setColorAt(i, c.copy(COOL).lerp(HOT, h));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------- scene

export class TowerScene {
  constructor(host) {
    this.host = host;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'dim-layer';
    host.appendChild(this.labelRenderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0d10');
    scene.fog = new THREE.Fog('#0b0d10', 2600, 7000);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.32;
    pmrem.dispose();
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(32, 1, 10, 20000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 250;
    this.controls.maxDistance = 5000;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.addEventListener('start', () => { this.camAnim = null; });

    scene.add(new THREE.HemisphereLight('#d6dde8', '#141518', 0.45));
    const key = new THREE.DirectionalLight('#ffffff', 2.3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 1.5;
    scene.add(key, key.target);
    this.key = key;
    // Key from the front right so its highlight on the roof and drawer tops
    // falls away from the default front-left camera; fill and rim on the left.
    const rim = new THREE.DirectionalLight('#b9cfff', 1.0);
    rim.position.set(-700, 700, -1200);
    scene.add(rim);
    const fill = new THREE.DirectionalLight('#ffeedd', 0.65);
    fill.position.set(-1300, 450, 600);
    scene.add(fill);

    this.mats = makeMaterials();
    this.cache = new Map();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), this.mats.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.raycast = () => {};
    scene.add(floor);

    this.meshMats = new Map();
    this.shellMats = new Set([this.mats.chassis]);
    this.state = { explode: 0, drawer: 0, glass: 0 };
    this.target = { explode: 0, drawer: 0, glass: 0 };
    this.flags = { airflow: false, xray: false, dims: true };
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.last = performance.now();
    this.time = 0;
    this.applied = null;

    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(host);
    this.resize();
    renderer.setAnimationLoop(() => this.tick());
  }

  // Perforated sheet material with holes at a constant real-world pitch.
  meshMat(w, h) {
    const rx = Math.max(1, Math.round((w / 5) * 4) / 4);
    const ry = Math.max(1, Math.round((h / 8.75) * 4) / 4);
    const key = `${rx}x${ry}`;
    if (!this.meshMats.has(key)) {
      const alphaMap = this.mats.perf.clone();
      alphaMap.repeat.set(rx, ry);
      alphaMap.needsUpdate = true;
      const m = std('#24262b', 0.4, 0.55, { alphaMap, alphaToCoverage: true, side: THREE.DoubleSide });
      this.meshMats.set(key, m);
      this.shellMats.add(m);
      this.applyXray(m);
    }
    return this.meshMats.get(key);
  }

  // Materials and textures that depend on the layout are cached by key so
  // rebuilding on every slider change does not leak GPU memory.
  cached(key, make) {
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key);
  }

  finMat(across, ru, rv) {
    return this.cached(`fin:${across}:${ru.toFixed(1)}:${rv.toFixed(1)}`, () => {
      const map = (across ? this.mats.finsU : this.mats.finsV).clone();
      map.repeat.set(ru, rv);
      map.needsUpdate = true;
      return std('#ffffff', 0.82, 0.36, { map });
    });
  }

  colorMat(color, metalness, roughness) {
    return this.cached(`std:${color}:${metalness}:${roughness}`, () => std(color, metalness, roughness));
  }

  textMat(text, opts) {
    return this.cached(`text:${text}:${JSON.stringify(opts ?? {})}`, () =>
      new THREE.MeshBasicMaterial({ map: textTexture(text, opts), transparent: true, depthWrite: false }));
  }

  meshPanel(parent, axis, a0, b0, w, h, at, info) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.meshMat(w, h));
    m.userData.shell = true;
    if (info) m.userData.info = info;
    if (axis === 'xy') m.position.set(a0 + w / 2, b0 + h / 2, at);
    if (axis === 'zy') { m.rotation.y = Math.PI / 2; m.position.set(at, b0 + h / 2, a0 + w / 2); }
    if (axis === 'xz') { m.rotation.x = -Math.PI / 2; m.position.set(a0 + w / 2, at, b0 + h / 2); }
    parent.add(m);
    return m;
  }

  // ------------------------------------------------------------- build

  build(L) {
    this.L = L;
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => {
        if (o.geometry && !isCachedFanGeometry(o.geometry)) o.geometry.dispose();
        if (o.isCSS2DObject) o.element.remove();
      });
    }
    this.spinners = [];
    this.flows = [];
    const root = new THREE.Group();
    root.position.set(-L.W / 2, 0, -L.D / 2);
    this.root = root;
    this.g = {};
    for (const name of ['spine', 'power', 'sleeve', 'drawer', 'gpu', 'risers', 'dims', 'base']) {
      this.g[name] = new THREE.Group();
      root.add(this.g[name]);
    }
    this.buildBase(L);
    this.buildSpine(L);
    this.buildPower(L);
    this.buildDrawer(L);
    this.buildGpuModule(L);
    this.buildDims(L);
    this.buildFlows(L);
    root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.receiveShadow = true; });
    this.scene.add(root);

    const span = Math.max(L.W, L.D, L.H) + 300;
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -span;
    cam.right = cam.top = span;
    cam.near = 10;
    cam.far = 6000;
    cam.updateProjectionMatrix();
    this.key.position.set(800, 1900, 1200);
    this.key.target.position.set(0, L.H / 2, 0);

    this.applied = null;
    this.setFlags(this.flags);
    if (!this.framed) {
      this.view('iso', false);
      this.framed = true;
    }
  }

  // Dark seam along the top edge of a module so the stack reads as three
  // separate boxes.
  seam(g, L, y) {
    const s = C.spine;
    addBox(g, this.mats.seam, s, y - 1, L.D - 0.6, L.W - s, 2, 1.4);
    addBox(g, this.mats.seam, L.W - 0.6, y - 1, 0, 1.4, 2, L.D);
    addBox(g, this.mats.seam, -0.6, y - 1, 0, 1.4, 2, L.D);
  }

  buildBase(L) {
    const g = this.g.base;
    const { W, D } = L;
    const pad = 140;
    const shape = new THREE.Shape();
    const x0 = -pad, z0 = -pad, x1 = W + pad, z1 = D + pad * 1.6, r = 40;
    shape.moveTo(x0 + r, z0);
    shape.lineTo(x1 - r, z0);
    shape.quadraticCurveTo(x1, z0, x1, z0 + r);
    shape.lineTo(x1, z1 - r);
    shape.quadraticCurveTo(x1, z1, x1 - r, z1);
    shape.lineTo(x0 + r, z1);
    shape.quadraticCurveTo(x0, z1, x0, z1 - r);
    shape.lineTo(x0, z0 + r);
    shape.quadraticCurveTo(x0, z0, x0 + r, z0);
    const mat = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.mats.mat);
    mat.rotation.x = Math.PI / 2;
    mat.position.y = 0.6;
    mat.receiveShadow = true;
    mat.raycast = () => {};
    g.add(mat);
  }

  buildSpine(L) {
    const g = this.g.spine;
    const m = this.mats;
    const { W, D, H } = L;
    const s = C.spine;
    const y0 = C.feet;
    const info = { title: 'Spine', detail: 'Every port exits on this side: mains inlet, board I/O and all GPU outputs. The hollow column doubles as the cable chase from the PSUs to the cards. Put it towards the wall.' };

    const holes = [];
    for (const p of L.power.psus) holes.push({ z0: p.z0 + 12, z1: p.z0 + p.w - 12, y0: p.y0 + 10, y1: p.y0 + p.h - 10 });
    const b = L.drawer.board;
    holes.push({ z0: b.z0 + 8, z1: b.z0 + 168, y0: b.top + 1, y1: b.top + 45 });
    const cards = L.gpu.cards;
    const zMin = Math.min(...cards.map((c) => c.z0)) - 6;
    const zMax = Math.max(...cards.map((c) => c.z0 + c.t)) + 6;
    holes.push({ z0: zMin, z1: zMax, y0: L.gpu.cardY0 - 8, y1: L.gpu.cardY0 + 116 });

    plateWithHoles(g, m.chassis, 0, 3, 0, D, y0, H, holes, { shell: true, info, cast: true });
    for (const h of holes) {
      addBox(g, m.inner, 3, h.y0 - 2, h.z0, s - 5, 2, h.z1 - h.z0);
      addBox(g, m.inner, 3, h.y1, h.z0, s - 5, 2, h.z1 - h.z0);
      addBox(g, m.inner, 3, h.y0, h.z0 - 2, s - 5, h.y1 - h.y0, 2);
      addBox(g, m.inner, 3, h.y0, h.z1, s - 5, h.y1 - h.y0, 2);
    }
    // Front and rear faces, top cap and an inner wall.
    addBox(g, m.trim, 0, y0, D - 3, s, H - y0, 3, { radius: 1.5, shell: true, info, cast: true });
    addBox(g, m.trim, 0, y0, 0, s, H - y0, 3, { radius: 1.5, shell: true, info, cast: true });
    addBox(g, m.trim, 0, H - 3, 0, s, 3, D, { radius: 1.5, shell: true, info, cast: true });
    plateWithHoles(g, m.inner, s - 2, 2, 3, D - 3, y0, H - 3, holes);

    // Power button and two USB-C ports on the spine's front face.
    const btn = addCylinder(g, m.silver, 7, 3, s / 2, H - 38, D + 1, 'z', 32);
    btn.userData.info = { title: 'Power button', detail: 'Front I/O sits on the spine: power and two USB-C.' };
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.4, 0.9, 8, 40), m.led);
    ring.position.set(s / 2, H - 38, D + 1.2);
    g.add(ring);
    for (let i = 0; i < 2; i++) addBox(g, m.port, s / 2 - 4.5, H - 70 - i * 16, D - 1, 9, 3.5, 2.5, { radius: 1.2 });
  }

  buildPower(L) {
    const g = this.g.power;
    const m = this.mats;
    const { W, D } = L;
    const { y0, h } = L.power;
    const s = C.spine, w = C.wall;
    const info = { title: 'Power module', detail: `${W} × ${D} × ${h} mm. ${L.power.psus.length === 2 ? 'Two ATX supplies side by side' : 'One ATX supply'}, mains inlet out through the spine, fans breathe through the floor.` };

    for (const [fx, fz] of [[60, 50], [W - 60, 50], [60, D - 50], [W - 60, D - 50]]) {
      const f = addCylinder(g, m.rubber, 16, C.feet, fx, C.feet / 2, fz, 'y', 28);
      f.castShadow = true;
    }
    this.meshPanel(g, 'xz', s, 0, W - s, D, y0 + 0.5, info);
    addBox(g, m.chassis, s, y0 + h - w, 0, W - s, w, D, { shell: true, info, cast: true });
    addBox(g, m.chassis, s, y0, D - w, W - s, h, w, { radius: 1, shell: true, info, cast: true });
    addBox(g, m.chassis, W - w, y0, 0, w, h, D, { shell: true, info, cast: true });
    this.meshPanel(g, 'xy', s, y0, W - s, h, 0.5, info);
    addBox(g, m.trim, W - 10, y0, D - 10, 10, h, 10, { radius: 2, shell: true, cast: true });
    this.seam(g, L, y0 + h);

    const logo = new THREE.Mesh(new THREE.PlaneGeometry(220, 27.5), this.textMat('XTX TOWER'));
    logo.position.set(s + (W - s) / 2, y0 + h / 2, D + 0.4);
    logo.raycast = () => {};
    g.add(logo);
    addBox(g, m.trim, s + 20, y0 + 10, D, W - s - 40, 1.2, 0.6);

    const names = L.power.psus.length === 2 ? ['PSU A', 'PSU B'] : ['PSU'];
    L.power.psus.forEach((p, i) => {
      const supply = L.budget.supplies[i];
      const feeds = [supply.feedsBoard ? 'board + CPU' : null, ...supply.cards.map((c) => `GPU ${c + 1}`)].filter(Boolean).join(', ');
      const pInfo = { title: `${names[i]}: ${supply.rating} W ATX`, detail: `Feeds ${feeds}. Sustained load about ${Math.round(supply.load)} W (${Math.round(supply.pct * 100)} %). Needs ${supply.pinsNeeded} × PCIe 8-pin.` };
      const grp = new THREE.Group();
      grp.userData.info = pInfo;
      g.add(grp);
      addBox(grp, m.plastic, p.x0, p.y0, p.z0, p.l, p.h, p.w, { radius: 2.5 });
      // Mains inlet and switch on the end facing the spine.
      addBox(grp, m.steel, p.x0 - 0.5, p.y0 + 6, p.z0 + 8, 1, p.h - 12, p.w - 16);
      addBox(grp, m.port, p.x0 - 2, p.y0 + p.h / 2 - 12, p.z0 + p.w / 2 - 22, 2, 24, 30, { radius: 2 });
      addBox(grp, m.port, p.x0 - 2.5, p.y0 + p.h / 2 - 8, p.z0 + p.w / 2 + 16, 2.5, 16, 10, { radius: 1.5 });
      // Modular sockets on the far end.
      const cols = 6, rows = 2;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          addBox(grp, m.port, p.x0 + p.l, p.y0 + 14 + r * 30, p.z0 + 12 + c * ((p.w - 24) / cols), 1.5, 22, (p.w - 24) / cols - 4);
        }
      }
      const label = new THREE.Mesh(new THREE.PlaneGeometry(90, 45),
        this.textMat(`${supply.rating} W`, { w: 512, h: 256, font: '700 120px system-ui, sans-serif', color: '#c9ced6', spacing: 4 }));
      label.rotation.x = -Math.PI / 2;
      label.position.set(p.x0 + p.l / 2, p.y0 + p.h + 0.3, p.z0 + p.w / 2);
      label.raycast = () => {};
      grp.add(label);
    });
  }

  buildDrawer(L) {
    const g = this.g.drawer;
    const m = this.mats;
    const { W, D } = L;
    const dr = L.drawer;
    const { y0, h } = dr;
    const s = C.spine, w = C.wall;
    const b = dr.board;
    const info = { title: 'Board drawer', detail: `${W} × ${D} × ${h} mm. The motherboard lies flat on a tray that slides out to the right. Rear I/O lines up with the spine.` };

    // The lid stays in the case as a sleeve; only the tray slides out.
    const sleeve = this.g.sleeve;
    addBox(sleeve, m.chassis, s, y0 + h - w, 0, W - s, w, D, { shell: true, info, cast: true });
    this.seam(sleeve, L, y0 + h);
    for (const r of L.risers) addBox(sleeve, m.hole, r.points[0].x - 47, y0 + h, r.points[0].z - 6, 94, 0.4, 12);
    addBox(g, m.chassis, s, y0, 0, W - s, w, D, { shell: true, info });
    this.meshPanel(g, 'xy', s, y0, W - s, h, D - 0.5, info);
    this.meshPanel(g, 'xy', s, y0, W - s, h, 0.5, info);
    addBox(g, m.chassis, W - w, y0, 0, w, h, D, { shell: true, info, cast: true });
    addBox(g, m.trim, W - 10, y0, D - 10, 10, h - w, 10, { radius: 2, shell: true, cast: true });
    const handle = addBox(g, m.silver, W, y0 + h / 2 - 8, D / 2 - 70, 10, 16, 140, { radius: 4 });
    handle.userData.info = { title: 'Drawer handle', detail: 'Unplug the risers and pull: the board, CPU cooler and RAM come out together.' };

    // Motherboard.
    const boardInfo = { title: L.board.name, detail: `${b.l} × ${b.w} mm board, PCIe slots ${dr.slots.map((x) => x.number).join(', ')} used through risers.` };
    const bg = new THREE.Group();
    bg.userData.info = boardInfo;
    g.add(bg);
    const u = (v) => b.x0 + v;     // distance from the rear edge -> x
    const v = (d) => b.z0 + d;     // distance from the top edge  -> z
    const pcbY = b.top - C.pcb;
    addBox(bg, m.pcb, b.x0, pcbY, b.z0, b.w, C.pcb, b.l);
    for (const [su, sv] of [[6, 6], [b.w - 6, 6], [6, b.l - 6], [b.w - 6, b.l - 6]]) {
      addCylinder(bg, m.silver, 3, C.standoff, u(su), pcbY - C.standoff / 2, v(sv), 'y', 10);
    }
    // Rear I/O cover and plate.
    addBox(bg, m.heatsink, u(0), b.top, v(8), 42, 38, 160, { radius: 3 });
    addBox(bg, m.silver, s + 1, b.top + 1, v(10), 2, 42, 156);
    const ports = [[4, 14, 'port'], [4, 30, 'portBlue'], [4, 46, 'portBlue'], [4, 62, 'port'], [4, 78, 'port'], [4, 96, 'port'], [4, 116, 'port'], [4, 134, 'port'],
      [22, 14, 'port'], [22, 30, 'portBlue'], [22, 46, 'portBlue'], [22, 62, 'port'], [22, 82, 'port'], [22, 112, 'port']];
    for (const [py, pz, mat] of ports) addBox(bg, m[mat], s - 0.5, b.top + py, v(10) + pz, 2, 12, 12.5);

    const sk = b.socket;
    const half = sk.size / 2;
    addBox(bg, m.heatsink, u(48), b.top, v(sk.v - 55), Math.max(8, sk.u - half - 54), 30, 110, { radius: 2 });
    addBox(bg, m.heatsink, u(sk.u - 55), b.top, v(10), 110, 26, Math.max(8, sk.v - half - 18), { radius: 2 });
    addBox(bg, m.silver, u(sk.u - half), b.top, v(sk.v - half), sk.size, 5, sk.size, { radius: 1 });
    for (const du of b.dimms) {
      addBox(bg, m.plastic, u(du) - 1, b.top, v(sk.v - 70), 8, 6, 141);
      addBox(bg, m.dimm, u(du), b.top + 2, v(sk.v - 66), 6.5, 34, 133, { radius: 1 });
    }
    addBox(bg, m.heatsink, u(b.w - 95), b.top, v(b.l - 95), 62, 10, 48, { radius: 2 });
    addBox(bg, m.heatsink, u(140), b.top, v(b.l - 140), 90, 7, 24, { radius: 1.5 });
    addBox(bg, m.plastic, u(b.w - 14), b.top, v(112), 12, 18, 54);
    addBox(bg, m.plastic, u(52), b.top, v(2), 20, 12, 10);
    for (const slot of dr.allSlots) {
      addBox(bg, slot.used ? m.steel : m.plastic, u(C.fingerStart), b.top, slot.z - 3.75, C.fingerLen, 11, 7.5);
    }
    // Riser plugs sitting in the used slots.
    for (const r of L.risers) addBox(bg, m.riser, r.points[0].x - 52, b.top + 11, r.points[0].z - 6, 104, 16, 12, { radius: 2 });

    // CPU cooler.
    const cx = u(sk.u), cz = v(sk.v);
    if (dr.cooler === 'tower') {
      const ci = { title: 'Tower air cooler', detail: `${dr.coolerH} mm tall. Pulls air from the drawer's front fans and blows it out the rear mesh.` };
      const cg = new THREE.Group();
      cg.userData.info = ci;
      g.add(cg);
      const stackY = b.top + 34;
      const stackH = dr.coolerH - 40;
      addBox(cg, m.silver, cx - 25, b.top + 5, cz - 25, 50, 12, 50, { radius: 2 });
      for (const dx of [-30, -10, 10, 30]) addCylinder(cg, m.copper, 3, dr.coolerH - 14, cx + dx, b.top + 5 + (dr.coolerH - 14) / 2, cz, 'y', 10);
      addBox(cg, this.finMat(false, 1, Math.round(stackH / 2.4)), cx - 65, stackY, cz - 27, 130, stackH, 54);
      addBox(cg, m.plastic, cx - 66, stackY + stackH, cz - 28, 132, 6, 56, { radius: 2 });
      const fanSize = stackH >= 118 ? 120 : 92;
      const fan = caseFan(m, fanSize, this.spinners);
      fan.position.set(cx, stackY + stackH / 2, cz + 27 + C.fanT / 2);
      cg.add(fan);
    } else {
      const ci = { title: 'AIO liquid cooler', detail: `Pump on the CPU, ${dr.radiator.fans * 120} mm radiator behind the drawer's front mesh.` };
      const cg = new THREE.Group();
      cg.userData.info = ci;
      g.add(cg);
      addCylinder(cg, m.plastic, 32, 48, cx, b.top + 24, cz, 'y', 40);
      addCylinder(cg, m.silver, 26, 1, cx, b.top + 48.6, cz, 'y', 40);
      const rad = dr.radiator;
      const radZ0 = D - w - 2 - C.fanT - C.radT;
      const radY = y0 + h / 2 - 61;
      addBox(cg, m.heatsink, rad.x0, radY, radZ0, rad.len, 122, C.radT, { radius: 2 });
      for (const dx of [-12, 12]) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(cx + dx, b.top + 40, cz + 20),
          new THREE.Vector3(cx + dx, b.top + 70, cz + 80),
          new THREE.Vector3(rad.x0 + 30 + dx, radY + 90, radZ0 - 60),
          new THREE.Vector3(rad.x0 + 30 + dx, radY + 90, radZ0),
        ]);
        cg.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 5.5, 10), m.cable));
      }
    }
    for (const f of dr.fans) {
      const fan = caseFan(m, f.size, this.spinners);
      fan.position.set(f.x, y0 + h / 2, D - w - 2 - C.fanT / 2);
      fan.userData.info = { title: `Front intake fan, ${f.size} mm`, detail: dr.cooler === 'aio' ? 'Pushes room air through the radiator into the drawer.' : 'Feeds the CPU cooler and VRMs.' };
      g.add(fan);
    }
    const rearX = dr.cooler === 'tower' ? cx : s + (W - s) / 2;
    const rearFan = caseFan(m, 120, this.spinners);
    rearFan.position.set(Math.min(Math.max(rearX, s + 70), W - 70), y0 + Math.max(h / 2, 70), w + 2 + C.fanT / 2);
    rearFan.userData.info = { title: 'Rear exhaust fan, 120 mm', detail: 'Pulls warm air out of the drawer.' };
    g.add(rearFan);
  }

  buildGpuModule(L) {
    const g = this.g.gpu;
    const m = this.mats;
    const { W, D } = L;
    const gm = L.gpu;
    const top = gm.y0 + gm.h;
    const s = C.spine, w = C.wall;
    const n = gm.cards.length;
    const info = { title: 'GPU module', detail: `${W} × ${D} × ${gm.h} mm. ${n} card${n > 1 ? 's' : ''} stand on PCIe 4.0 risers behind the glass. Air comes in through the mesh band and side wall, rises between the cards and leaves through the roof.` };

    // Plenum band and floor.
    this.meshPanel(g, 'xy', s, gm.y0, W - s, C.plenumH, D - 0.5, info);
    this.meshPanel(g, 'xy', s, gm.y0, W - s, C.plenumH, 0.5, info);
    this.meshPanel(g, 'zy', 0, gm.y0, D, C.plenumH, W - 0.5, info);
    addBox(g, m.chassis, s, gm.y0, 0, W - s, w, D, { shell: true, info });
    this.meshPanel(g, 'xz', s + C.riserBay, 0, W - s - C.riserBay, D, gm.chamberY0 - w / 2, info);
    addBox(g, m.chassis, s, gm.chamberY0 - w, 0, C.riserBay, w, D, { shell: true, info });
    addBox(g, m.trim, s, gm.y0 + C.plenumH - 3, D - 8, W - s, 3, 8, { shell: true });

    // Walls and roof.
    addBox(g, m.chassis, s, gm.chamberY0 - w, 0, W - s, top - gm.chamberY0 + w, w, { shell: true, info, cast: true });
    this.meshPanel(g, 'zy', 0, gm.chamberY0, D - 10, top - gm.chamberY0, W - 0.5, info);
    this.meshPanel(g, 'xz', s, 0, W - s, D, top - 0.5, info);
    addBox(g, m.trim, s, top - 3, 0, W - s, 3, 6, { shell: true, cast: true });
    addBox(g, m.trim, s, top - 3, D - 10, W - s, 3, 10, { shell: true, cast: true });
    addBox(g, m.trim, W - 10, gm.y0, D - 10, 10, gm.h, 10, { radius: 2, shell: true, cast: true });
    addBox(g, m.trim, W - 10, gm.y0, 0, 10, gm.h, 10, { radius: 2, shell: true, cast: true });

    // Fans.
    const fanInfo = (kind, size) => ({ title: `${kind} fan, ${size} mm`, detail: kind === 'Roof exhaust' ? 'Pulls the cards\' hot air straight up and out.' : 'Pushes cool air into the gaps in front of each card.' });
    for (const f of gm.floorFans.fans) {
      const fan = caseFan(m, gm.floorFans.size, this.spinners);
      fan.rotation.x = -Math.PI / 2;
      fan.position.set(f.a, gm.y0 + C.plenumH + C.fanT / 2, f.b);
      fan.userData.info = fanInfo('Floor intake', gm.floorFans.size);
      g.add(fan);
    }
    for (const f of gm.roofFans.fans) {
      const fan = caseFan(m, gm.roofFans.size, this.spinners);
      fan.rotation.x = -Math.PI / 2;
      fan.position.set(f.a, top - w - C.fanT / 2, f.b);
      fan.userData.info = fanInfo('Roof exhaust', gm.roofFans.size);
      g.add(fan);
    }
    for (const f of gm.sideFans.fans) {
      const fan = caseFan(m, gm.sideFans.size, this.spinners);
      fan.rotation.y = Math.PI / 2;
      fan.position.set(W - w - 2 - C.fanT / 2, f.b, f.a);
      fan.userData.info = fanInfo('Side intake', gm.sideFans.size);
      g.add(fan);
    }

    // Cards, riser sockets, support bar, power cables.
    const card = L.card;
    for (const c of gm.cards) {
      const riser = L.risers[c.index];
      const cInfo = {
        title: `GPU ${c.index + 1}: ${card.name}`,
        detail: `${card.l} × ${card.h} × ${card.t} mm, ${card.watts} W, ${card.pins} × 8-pin. Riser to slot ${riser.slot} (${riser.lanes}), about ${riser.length} mm: buy ${riser.buy ?? '600+'} mm.`,
      };
      const cg = this.buildCard(card, c, cInfo);
      g.add(cg);
      addBox(g, m.plastic, s + C.fingerStart - 8, gm.chamberY0, c.zPcb - 6, C.fingerLen + 16, C.riserSocketH, 12, { radius: 1.5 });
      // 8-pin cable bundle up and back into the spine.
      const cx = s + card.l - 48 - (card.pins - 1) * 11;
      const z = c.z0 + 8.5;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(cx, gm.cardTop + 8, z),
        new THREE.Vector3(cx, gm.cardTop + 26, z),
        new THREE.Vector3(cx - 40, gm.cardTop + 32, z),
        new THREE.Vector3(s + 30, gm.cardTop + 30, z),
        new THREE.Vector3(s + 2, gm.cardTop + 14, z),
      ], false, 'centripetal');
      const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 3.8 + card.pins * 1.3, 12), m.cable);
      cable.userData.info = { title: `GPU ${c.index + 1} power`, detail: `${card.pins} separate 8-pin cables from ${L.budget.supplies.find((sp) => sp.cards.includes(c.index))?.name ?? 'the PSU'}, routed through the spine.` };
      g.add(cable);
    }
    const zs = gm.cards.map((c) => [c.z0, c.z0 + c.t]).flat();
    const barX = s + card.l - 46;
    const bar = addBox(g, m.steel, barX, gm.chamberY0, Math.min(...zs) - 6, 12, C.riserSocketH, Math.max(...zs) - Math.min(...zs) + 12, { radius: 1.5 });
    bar.userData.info = { title: 'Anti-sag rail', detail: 'Carries the tail end of every card so the riser sockets do not take the weight.' };

    // Light strip and a small fill light inside the chamber.
    addBox(g, m.led, s + 14, top - w - C.fanT - 8, D - C.glass - 10, W - s - 34, 3, 4);
    const lamp = new THREE.PointLight('#e8f0ff', 5000, 0, 2);
    lamp.position.set(s + (W - s) / 2, top - w - C.fanT - 14, D * 0.55);
    g.add(lamp);

    // Glass door, hinged on the front-right post.
    const glassW = W - s - 10;
    const glassH = top - (gm.y0 + C.plenumH);
    const pivot = new THREE.Group();
    pivot.position.set(W - 10, gm.y0 + C.plenumH, D - C.glass / 2);
    g.add(pivot);
    const gi = { title: 'Tempered glass door', detail: 'Hinged on the right edge. Open it to reach the cards and risers.' };
    const pane = new THREE.Mesh(new THREE.BoxGeometry(glassW, glassH, C.glass), m.glass);
    pane.position.set(-glassW / 2, glassH / 2, 0);
    pane.userData.info = gi;
    pane.userData.glass = true;
    pane.renderOrder = 10;
    pivot.add(pane);
    const frit = 9;
    addBox(pivot, m.frit, -glassW, 0, C.glass / 2, glassW, frit, 0.6);
    addBox(pivot, m.frit, -glassW, glassH - frit, C.glass / 2, glassW, frit, 0.6);
    addBox(pivot, m.frit, -glassW, 0, C.glass / 2, frit, glassH, 0.6);
    addBox(pivot, m.frit, -frit, 0, C.glass / 2, frit, glassH, 0.6);
    for (const hy of [glassH * 0.15, glassH * 0.85]) addCylinder(pivot, m.silver, 3.5, 24, 1, hy, 0, 'y', 16);
    this.glassPivot = pivot;
  }

  // Card model: x from the bracket (0) to the tail, y from the edge
  // fingers (0) up, z from the backplate (0) to the fan face.
  buildCard(card, c, info) {
    const m = this.mats;
    const st = card.style;
    const { l, h, t } = c;
    const g = new THREE.Group();
    g.position.set(c.x0, c.y0, c.z0);
    g.userData.info = info;

    addBox(g, m.heatsink, 2, 2, 0, l - 4, h - 4, 2.5, { radius: 1 });
    addBox(g, m.pcb, 4, 4, 2.5, l - 10, h - 10, C.pcb);
    addBox(g, m.gold, C.fingerStart, -8, 2.5, C.fingerLen, 12, C.pcb);
    addBox(g, this.finMat(true, Math.round(l / 2.2), 1), 10, 3, 4.5, l - 16, h - 6, Math.max(4, t - 12.5));

    const pitch = (l - 44) / 3;
    const dia = Math.min(h - 18, pitch - 5);
    const centers = [0, 1, 2].map((i) => [22 + pitch * (i + 0.5), h / 2]);
    const shroud = new THREE.Mesh(shroudGeometry(l - 4, h - 2, centers.map(([x, y]) => [x - 2, y - 1]), dia / 2), this.colorMat(st.shroud, 0.35, 0.45));
    shroud.position.set(2, 1, t - 8.8); // bevel adds 0.8 mm on each face
    g.add(shroud);
    addBox(g, this.colorMat(st.trim, 0.7, 0.3), 2, h - 9, t - 0.4, l - 4, 3, 1, { radius: 0.4 });
    addBox(g, this.cached(`accent:${st.accent}`, () => new THREE.MeshBasicMaterial({ color: st.accent })), l * 0.42, h - 4.5, t - 0.2, l * 0.5, 2.5, 1);
    const ringMat = this.colorMat(st.fanRing, 0.5, 0.35);
    centers.forEach(([fx, fy], i) => {
      const back = new THREE.Mesh(new THREE.CircleGeometry(dia / 2, 40), m.hole);
      back.position.set(fx, fy, t - 7.6);
      g.add(back);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(dia / 2 + 0.5, 1.6, 8, 48), ringMat);
      ring.position.set(fx, fy, t + 0.2);
      g.add(ring);
      const r = rotor(m, dia / 2 - 1.5, 9, this.spinners, i % 2 ? -26 : 26, 1.2);
      r.position.set(fx, fy, t - 4);
      g.add(r);
    });

    // Bracket in the spine, with ports facing out.
    addBox(g, m.silver, -2, -10, 0, 2, 122, t);
    for (let i = 0; i < 4; i++) addBox(g, m.port, -2.6, 8 + i * 22, 7, 1, 7, 17, { radius: 0.6 });
    // 8-pin sockets on the top edge.
    for (let i = 0; i < card.pins; i++) addBox(g, m.plastic, l - 58 - i * 22, h - 1, 4, 20, 9, 9);
    return g;
  }

  buildRisers() {
    const g = this.g.risers;
    while (g.children.length) {
      const o = g.children.pop();
      o.geometry.dispose();
    }
    const L = this.L;
    const e = this.state.explode;
    const dy = [EXPLODE.drawer * e, EXPLODE.drawer * e, EXPLODE.gpu * e, EXPLODE.gpu * e];
    for (const r of L.risers) {
      const pts = r.points.map((p, i) => new THREE.Vector3(p.x, p.y + dy[i], p.z));
      const curve = new THREE.CatmullRomCurve3([
        pts[0], pts[0].clone().lerp(pts[1], 0.6), pts[1], pts[2], pts[2].clone().lerp(pts[3], 0.5), pts[3],
      ], false, 'centripetal');
      const mesh = new THREE.Mesh(ribbonGeometry(curve, 80, 2.6), this.mats.riser);
      mesh.userData.info = { title: `Riser: slot ${r.slot} to GPU ${r.card + 1}`, detail: `Shielded PCIe 4.0 x16 riser, about ${r.length} mm. Stock length to buy: ${r.buy ?? 'over 600'} mm. Link: ${r.lanes}.` };
      g.add(mesh);
    }
  }

  buildDims(L) {
    const g = this.g.dims;
    const mat = new THREE.LineBasicMaterial({ color: '#9aa4b2', transparent: true, opacity: 0.7 });
    const line = (pts) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))), mat);
      l.raycast = () => {};
      g.add(l);
    };
    const label = (text, p) => {
      const el = document.createElement('div');
      el.className = 'dim';
      el.textContent = text;
      const o = new CSS2DObject(el);
      o.position.set(...p);
      g.add(o);
    };
    const { W, D, H } = L;
    const off = 60, tick = 14;
    line([[0, 1, D + off], [W, 1, D + off]]);
    line([[0, 1, D + off - tick], [0, 1, D + off + tick]]);
    line([[W, 1, D + off - tick], [W, 1, D + off + tick]]);
    label(`${W} mm`, [W / 2, 1, D + off]);
    line([[-off, 1, 0], [-off, 1, D]]);
    line([[-off - tick, 1, 0], [-off + tick, 1, 0]]);
    line([[-off - tick, 1, D], [-off + tick, 1, D]]);
    label(`${D} mm`, [-off, 1, D / 2]);
    line([[-off, 0, D], [-off, H, D]]);
    line([[-off - tick, H, D], [-off + tick, H, D]]);
    label(`${H} mm`, [-off, H / 2, D]);
  }

  buildFlows(L) {
    const { W, D } = L;
    const gm = L.gpu;
    const s = C.spine;
    const top = gm.y0 + gm.h;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const gpuPaths = [];
    const fanXs = gm.floorFans.fans.length ? [...new Set(gm.floorFans.fans.map((f) => f.a))] : [W - 80];
    gm.cards.forEach((c, i) => {
      const gap = i === 0 ? L.cfg.glassGap : L.cfg.cardGap;
      const zg = c.z0 + c.t + gap / 2;
      const zc = c.z0 + c.t / 2;
      for (const fx of fanXs) {
        for (const dx of [-40, 0, 40]) {
          const x = Math.min(W - 30, Math.max(s + C.riserBay + 20, fx + dx));
          gpuPaths.push({ points: [V(x, gm.y0 + 14, D + 60), V(x, gm.y0 + 14, zg), V(x, gm.cardY0 + c.h * 0.45, zg), V(x, gm.cardTop + 22, zc), V(x, top + 90, zc)], heat: [2, 3] });
        }
      }
      if (gm.sideFans.fans.length) {
        const y = gm.cardY0 + c.h * 0.55;
        for (const xEnd of [s + 120, s + 220]) {
          gpuPaths.push({ points: [V(W + 60, y, zg), V(xEnd, y, zg), V(xEnd, gm.cardTop + 22, zc), V(xEnd, top + 90, zc)], heat: [1, 2] });
        }
      }
    });
    this.flows.push(new Flow(this.g.gpu, gpuPaths, 5));

    const dr = L.drawer;
    const dy = dr.y0 + dr.h / 2;
    const drawerPaths = [];
    for (const f of dr.fans) {
      for (const dyy of [-25, 25]) {
        drawerPaths.push({ points: [V(f.x, dy + dyy, D + 60), V(f.x, dy + dyy, D - 60), V(f.x, dy + dyy * 0.6, dr.board.z0 + dr.board.socket.v), V(f.x, dy + dyy, -70)], heat: [1, 2], speed: 200 });
      }
    }
    this.flows.push(new Flow(this.g.drawer, drawerPaths, 6));

    const powerPaths = [];
    for (const p of L.power.psus) {
      for (const dz of [-35, 35]) {
        const x = p.x0 + p.l * 0.55, z = p.z0 + p.w / 2 + dz;
        powerPaths.push({ points: [V(x, 2, z), V(x, p.y0 + p.h * 0.5, z), V(p.x0 + 20, p.y0 + p.h * 0.5, z), V(-80, p.y0 + p.h * 0.5, z)], heat: [1, 2], speed: 160 });
      }
    }
    this.flows.push(new Flow(this.g.power, powerPaths, 6));
  }

  // ------------------------------------------------------------- state

  setTargets(t) {
    Object.assign(this.target, t);
  }

  setFlags(f) {
    Object.assign(this.flags, f);
    for (const fl of this.flows ?? []) fl.mesh.visible = this.flags.airflow;
    for (const mat of this.shellMats) this.applyXray(mat);
    this.applied = null;
  }

  applyXray(mat) {
    const on = this.flags.xray;
    const opacity = on ? 0.13 : 1;
    if (mat.opacity === opacity && mat.transparent === on) return;
    mat.opacity = opacity;
    mat.transparent = on;
    mat.depthWrite = !on;
    mat.needsUpdate = true;
  }

  setAutoRotate(on) {
    this.controls.autoRotate = on;
  }

  view(name, animate = true) {
    const L = this.L;
    if (!L) return;
    const dirs = { iso: [-0.8, 0.42, 1], front: [0, 0.1, 1], io: [-1, 0.16, 0.06], top: [0.001, 1, 0.16], back: [0.7, 0.35, -1] };
    const dir = new THREE.Vector3(...(dirs[name] ?? dirs.iso)).normalize();
    const extraH = this.target.explode ? EXPLODE.gpu : 0;
    const target = new THREE.Vector3(0, (L.H + extraH) * 0.45, 0);
    const radius = 0.5 * Math.hypot(L.W + 140, L.D + 120, L.H + extraH);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.12;
    const pos = target.clone().addScaledVector(dir, dist);
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.camAnim = { t: 0, fromP: this.camera.position.clone(), toP: pos, fromT: this.controls.target.clone(), toT: target };
  }

  pick(clientX, clientY) {
    if (!this.root) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.root, true);
    for (const hit of hits) {
      let o = hit.object;
      if (!isVisible(o)) continue;
      if (o.userData.glass && this.state.glass < 0.5) continue;
      if (o.userData.shell && this.flags.xray) continue;
      while (o && !o.userData.info) o = o.parent;
      if (o) return o.userData.info;
    }
    return null;
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    const k = 1 - Math.exp(-dt * 6);
    let moved = false;
    for (const key of Object.keys(this.state)) {
      const d = this.target[key] - this.state[key];
      if (Math.abs(d) > 0.0005) {
        this.state[key] += d * k;
        moved = true;
      } else if (d !== 0) {
        this.state[key] = this.target[key];
        moved = true;
      }
    }
    if (this.root && (moved || !this.applied)) this.applyState();

    if (this.flags.airflow && this.root) {
      for (const sp of this.spinners) sp.obj.rotation.z += sp.speed * dt;
      for (const f of this.flows) f.update(this.time);
    }

    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt / 0.7);
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(a.fromP, a.toP, e);
      this.controls.target.lerpVectors(a.fromT, a.toT, e);
      if (a.t >= 1) this.camAnim = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  applyState() {
    const { explode: e, drawer: d, glass: gl } = this.state;
    const L = this.L;
    this.g.drawer.position.set(d * L.W * 0.62, e * EXPLODE.drawer, 0);
    this.g.sleeve.position.y = e * EXPLODE.drawer;
    this.g.gpu.position.y = e * EXPLODE.gpu;
    this.g.spine.position.x = -e * EXPLODE.spine;
    if (this.glassPivot) this.glassPivot.rotation.y = gl * 1.85;
    const risersOn = d < 0.03;
    if (!this.applied || this.applied.explode !== e) this.buildRisers();
    this.g.risers.visible = risersOn;
    this.g.dims.visible = this.flags.dims && e < 0.02 && d < 0.02;
    for (const o of this.g.dims.children) if (o.isCSS2DObject) o.visible = this.g.dims.visible;
    this.applied = { explode: e };
  }
}

// Fan-face cover of a card: a rounded plate with round fan openings,
// 8 mm deep, origin at its lower-left-back corner.
function shroudGeometry(w, h, centers, r) {
  const k = 6;
  const shape = new THREE.Shape();
  shape.moveTo(k, 0);
  shape.lineTo(w - k, 0);
  shape.quadraticCurveTo(w, 0, w, k);
  shape.lineTo(w, h - k);
  shape.quadraticCurveTo(w, h, w - k, h);
  shape.lineTo(k, h);
  shape.quadraticCurveTo(0, h, 0, h - k);
  shape.lineTo(0, k);
  shape.quadraticCurveTo(0, 0, k, 0);
  for (const [x, y] of centers) {
    const hole = new THREE.Path();
    hole.absarc(x, y, r, 0, TAU, true);
    shape.holes.push(hole);
  }
  return new THREE.ExtrudeGeometry(shape, { depth: 8, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 2, curveSegments: 40 });
}

function isVisible(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function isCachedFanGeometry(geo) {
  for (const g of fanGeoCache.values()) if (g.frame === geo || g.hub === geo || g.blade === geo) return true;
  return false;
}

// A flat ribbon (riser cable) that follows a curve in the YZ plane, `width`
// wide along X.
function ribbonGeometry(curve, width, thick) {
  const steps = 64;
  const pos = [], idx = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const faces = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const nrm = new THREE.Vector3(0, -t.z, t.y).normalize();
    if (nrm.lengthSq() < 1e-6) nrm.set(0, 0, 1);
    samples.push({ p, nrm });
  }
  for (const [a, b] of faces) {
    const base = pos.length / 3;
    for (const { p, nrm } of samples) {
      for (const c of [a, b]) {
        const [sx, sn] = corners[c];
        pos.push(p.x + (sx * width) / 2 + nrm.x * sn * thick / 2, p.y + nrm.y * sn * thick / 2, p.z + nrm.z * sn * thick / 2);
      }
    }
    for (let i = 0; i < steps; i++) {
      const v0 = base + i * 2, v1 = v0 + 1, v2 = v0 + 2, v3 = v0 + 3;
      idx.push(v0, v2, v1, v1, v2, v3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
