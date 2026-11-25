// scene.js — modelul 3D al schimbătorului manta–fascicul (Three.js)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';

// Dimensiuni vizuale (unități Three ≈ metri, la scară)
const L = 6.0;          // lungimea mantalei între plăcile tubulare
const R = 0.62;         // raza interioară a mantalei
const T_SHELL = 0.025;  // grosimea peretelui
const R_TUBE = 0.028;   // raza exterioară a țevii (vizual)
const PITCH = 0.118;    // pasul triunghiular
const N_BAFFLES = 5;
const BAFFLE_CUT = 0.25; // fracțiune din diametru
const HEAD_LEN = 0.75;
export const DIM = { L, R, R_TUBE };

export function temperatureColor(t, out = new THREE.Color()) {
  // hartă de culoare albastru → cian → verde → galben → roșu (t ∈ [0,1])
  t = Math.min(1, Math.max(0, t));
  const stops = [
    [0.0, 0.10, 0.25, 0.85],
    [0.25, 0.05, 0.70, 0.95],
    [0.5, 0.30, 0.85, 0.35],
    [0.75, 1.00, 0.80, 0.10],
    [1.0, 0.92, 0.18, 0.08],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const w = (t - a[0]) / (b[0] - a[0]);
      return out.setRGB(a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w, a[3] + (b[3] - a[3]) * w, THREE.SRGBColorSpace);
    }
  }
  return out.setRGB(0.92, 0.18, 0.08, THREE.SRGBColorSpace);
}

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLabel(text, color = '#111') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.6, 0.3, 1);
  s.renderOrder = 10;
  s.userData.set = (txt, col = color) => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.font = '600 38px "Segoe UI", system-ui, sans-serif';
    const w = Math.min(500, g.measureText(txt).width + 36);
    const x0 = (c.width - w) / 2;
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.strokeStyle = col; g.lineWidth = 4;
    g.beginPath(); g.roundRect(x0, 10, w, 76, 18); g.fill(); g.stroke();
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, c.width / 2, 50);
    tex.needsUpdate = true;
  };
  s.userData.set(text, color);
  return s;
}

export class ExchangerScene {
  constructor(container) {
    this.container = container;
    this.params = null;
    this.result = null;
    this.running = true;
    this.speed = 1;
    this.showParticles = true;
    this.schematic = true;
    this.cfdView = null;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e9edf2');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
    camera.position.set(3.0, 3.1, 8.6);
    this.camera = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.1, 0);
    controls.enableDamping = true;
    controls.minDistance = 2;
    controls.maxDistance = 20;
    controls.maxPolarAngle = Math.PI * 0.49;
    this.controls = controls;

    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(4, 8, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 4, bottom: -4, near: 1, far: 25 });
    scene.add(sun);
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f99', 0.6));

    const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: '#cfd5dc', roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -R - 0.55;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(20, 40, '#b5bcc6', '#c3c9d1');
    grid.position.y = ground.position.y + 0.002;
    scene.add(grid);

    this.mats = {
      steel: new THREE.MeshStandardMaterial({ color: '#b9bec5', metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide }),
      steelDark: new THREE.MeshStandardMaterial({ color: '#7d838c', metalness: 0.8, roughness: 0.4 }),
      paint: new THREE.MeshStandardMaterial({ color: '#3d5a80', metalness: 0.3, roughness: 0.55, side: THREE.DoubleSide }),
      cut: new THREE.MeshStandardMaterial({ color: '#c94f2c', metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }),
      baffle: new THREE.MeshStandardMaterial({ color: '#9aa1aa', metalness: 0.75, roughness: 0.38, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
      tube: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.35 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#dfe7ef', metalness: 0, roughness: 0.08, transmission: 0.0, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    };

    this.root = new THREE.Group();
    scene.add(this.root);
    this.tubeLayout = this.computeTubeLayout();
    this.buildStatic();
    this.dotTex = makeDotTexture();

    this.last = performance.now();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    renderer.setAnimationLoop(() => this.tick());
  }

  computeTubeLayout() {
    const pts = [];
    const rMax = R - 0.06;
    const rows = Math.ceil(rMax / (PITCH * Math.sin(Math.PI / 3)));
    for (let j = -rows; j <= rows; j++) {
      const y = j * PITCH * Math.sin(Math.PI / 3);
      const off = (j & 1) ? PITCH / 2 : 0;
      for (let i = -12; i <= 12; i++) {
        const z = i * PITCH + off;
        // lăsăm liberă banda centrală pentru șicana de separare a trecerilor (vizual)
        if (Math.hypot(y, z) <= rMax && Math.abs(y) > 0.025) pts.push({ y, z });
      }
    }
    return pts;
  }

  buildStatic() {
    const g = this.root;
    const m = this.mats;
    // --- mantaua: secțiune (tăietură) de 110° spre privitor ---
    this.shellCut = new THREE.Group();
    const cutAngle = THREE.MathUtils.degToRad(115);
    const shellGeoOuter = new THREE.CylinderGeometry(R + T_SHELL, R + T_SHELL, L, 96, 1, true, cutAngle / 2, Math.PI * 2 - cutAngle);
    const shellGeoInner = new THREE.CylinderGeometry(R, R, L, 96, 1, true, cutAngle / 2, Math.PI * 2 - cutAngle);
    const outer = new THREE.Mesh(shellGeoOuter, m.paint);
    const inner = new THREE.Mesh(shellGeoInner, m.steel);
    outer.castShadow = true; inner.receiveShadow = true;
    const local = new THREE.Group();          // coordonate locale ale cilindrului (axa Y)
    local.add(outer, inner);
    // benzile roșii pe marginile tăieturii (ca în desenele de secțiune)
    for (const a of [cutAngle / 2, Math.PI * 2 - cutAngle / 2]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(T_SHELL + 0.004, L, 0.006), m.cut);
      const rr = R + T_SHELL / 2;
      e.position.set(rr * Math.sin(a), 0, rr * Math.cos(a));
      e.rotation.y = a + Math.PI / 2;
      local.add(e);
    }
    local.rotation.z = Math.PI / 2;           // axa cilindrului pe X
    const holder = new THREE.Group();
    holder.add(local);
    holder.rotation.x = -0.5;                 // tăietura privește spre +Z, ușor în sus
    this.shellCut.add(holder);
    g.add(this.shellCut);

    // manta întreagă (transparentă) — alternativă la secțiune
    this.shellFull = new THREE.Mesh(new THREE.CylinderGeometry(R + T_SHELL, R + T_SHELL, L, 96, 1, true), m.glass);
    this.shellFull.rotation.z = Math.PI / 2;
    this.shellFull.visible = false;
    g.add(this.shellFull);

    // --- plăci tubulare și flanșe ---
    for (const sx of [-1, 1]) {
      const ts = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.09, R + 0.09, 0.07, 96), m.steelDark);
      ts.rotation.z = Math.PI / 2;
      ts.position.x = sx * (L / 2 + 0.035);
      ts.castShadow = true;
      g.add(ts);
      // flanșa canalului
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.09, R + 0.09, 0.06, 96), m.steel);
      fl.rotation.z = Math.PI / 2;
      fl.position.x = sx * (L / 2 + 0.1);
      g.add(fl);
      // prezoane
      const bolt = new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10);
      const bolts = new THREE.InstancedMesh(bolt, m.steelDark, 28);
      const mm = new THREE.Matrix4();
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        mm.makeRotationZ(Math.PI / 2);
        mm.setPosition(sx * (L / 2 + 0.07), (R + 0.06) * Math.cos(a), (R + 0.06) * Math.sin(a));
        bolts.setMatrixAt(i, mm);
      }
      g.add(bolts);
      // camera de distribuție (capac) + fund bombat
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(R + T_SHELL, R + T_SHELL, HEAD_LEN, 96, 1, true), m.paint);
      ch.rotation.z = Math.PI / 2;
      ch.position.x = sx * (L / 2 + 0.13 + HEAD_LEN / 2);
      ch.castShadow = true;
      g.add(ch);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(R + T_SHELL, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), m.paint);
      dome.scale.set(1, 0.42, 1);
      dome.rotation.z = -sx * Math.PI / 2;
      dome.position.x = sx * (L / 2 + 0.13 + HEAD_LEN);
      dome.castShadow = true;
      g.add(dome);
    }
    // șicana de separare a trecerilor în capacul frontal (vizibilă doar la 1–2)
    this.passPartition = new THREE.Mesh(new THREE.BoxGeometry(HEAD_LEN, 0.03, 2 * R), m.steelDark);
    this.passPartition.position.x = -(L / 2 + 0.13 + HEAD_LEN / 2);
    g.add(this.passPartition);

    // --- șicane segmentate ---
    this.baffles = [];
    const c = R - 2 * R * BAFFLE_CUT; // înălțimea coardei
    const th = Math.asin(c / R);
    const shape = new THREE.Shape();
    shape.absarc(0, 0, R - 0.004, Math.PI - th, 2 * Math.PI + th, false);
    shape.closePath();
    for (const p of this.tubeLayout) {
      if (p.y < c - 0.03) {
        const h = new THREE.Path();
        h.absarc(p.z, p.y, R_TUBE + 0.004, 0, Math.PI * 2, true);
        shape.holes.push(h);
      }
    }
    const bGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false, curveSegments: 48 });
    bGeo.translate(0, 0, -0.007);
    for (let i = 0; i < N_BAFFLES; i++) {
      const b = new THREE.Mesh(bGeo, m.baffle);
      b.rotation.y = Math.PI / 2; // planul YZ
      b.position.x = -L / 2 + (L * (i + 1)) / (N_BAFFLES + 1);
      b.castShadow = true;
      this.baffles.push(b);
      g.add(b);
    }

    // --- suporți (șei) ---
    for (const sx of [-1, 1]) {
      const sad = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 1.1), m.paint);
      sad.position.set(sx * L * 0.33, -R - 0.25, 0);
      sad.castShadow = true;
      g.add(sad);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 1.3), m.steelDark);
      base.position.set(sx * L * 0.33, -R - 0.53, 0);
      g.add(base);
    }

    // --- racorduri (create dinamic în funcție de schemă) ---
    this.nozzleGroup = new THREE.Group();
    g.add(this.nozzleGroup);
    this.labels = {
      hotIn: makeLabel('', '#c2410c'), hotOut: makeLabel('', '#c2410c'),
      coldIn: makeLabel('', '#1d4ed8'), coldOut: makeLabel('', '#1d4ed8'),
    };
    Object.values(this.labels).forEach((l) => g.add(l));
  }

  addNozzle(x, side, onHead = false) {
    // side: +1 sus, -1 jos
    const m = this.mats;
    const grp = new THREE.Group();
    const len = 0.42;
    const r = 0.18;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 32), m.paint);
    pipe.position.y = side * (R + len / 2 - 0.05);
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.07, r + 0.07, 0.05, 32), m.steel);
    flange.position.y = side * (R + len - 0.05);
    pipe.castShadow = flange.castShadow = true;
    grp.add(pipe, flange);
    grp.position.x = x;
    this.nozzleGroup.add(grp);
    return new THREE.Vector3(x, side * (R + len + 0.05), 0);
  }

  /** Reconstruiește racordurile, culorile țevilor și particulele pentru noii parametri. */
  update(params, result) {
    this.params = params;
    this.result = result;
    const arr = params.arrangement;
    const prof = result.profile;
    const Tlo = Math.min(params.Tc_in, params.Th_in);
    const Thi = Math.max(params.Tc_in, params.Th_in);
    this.Tlo = Tlo; this.Thi = Thi;
    const tn = (T) => (T - Tlo) / Math.max(1e-6, Thi - Tlo);
    this.tn = tn;

    // profiluri interpolabile
    const interp = (arrY) => (xf) => {
      const n = arrY.length - 1;
      const f = Math.min(n, Math.max(0, xf * n));
      const i = Math.min(n - 1, Math.floor(f));
      const w = f - i;
      return arrY[i] * (1 - w) + arrY[i + 1] * w;
    };
    this.Thx = interp(prof.Th);
    this.Tc1x = interp(prof.Tc1 || prof.Tc);
    this.Tc2x = interp(prof.Tc2 || prof.Tc);

    // --- racorduri și etichete ---
    this.nozzleGroup.clear();
    const xs = L / 2 - 0.45;
    let hotInX, hotOutX;
    if (arr === 'parallel') { hotInX = -xs; hotOutX = xs; } else { hotInX = xs; hotOutX = -xs; }
    const pHotIn = this.addNozzle(hotInX, +1);
    const pHotOut = this.addNozzle(hotOutX, -1);
    const headX = L / 2 + 0.13 + HEAD_LEN / 2;
    const pColdIn = this.addNozzle(-headX, +1, true);
    const pColdOut = arr === 'shell12' ? this.addNozzle(-headX, -1, true) : this.addNozzle(headX, -1, true);
    this.passPartition.visible = arr === 'shell12';

    const f1 = (v) => v.toFixed(1).replace('.', ',');
    const L_ = this.labels;
    L_.hotIn.userData.set(`Cald intrare ${f1(params.Th_in)} °C`);
    L_.hotOut.userData.set(`Cald ieșire ${f1(result.Th_out)} °C`);
    L_.coldIn.userData.set(`Rece intrare ${f1(params.Tc_in)} °C`);
    L_.coldOut.userData.set(`Rece ieșire ${f1(result.Tc_out)} °C`);
    L_.hotIn.position.copy(pHotIn).add(new THREE.Vector3(arr === 'parallel' ? 1.0 : 0, 0.25, 0));
    L_.hotOut.position.copy(pHotOut).add(new THREE.Vector3(0, -0.22, 0.55));
    L_.coldIn.position.copy(pColdIn).add(new THREE.Vector3(-0.2, 0.25, 0));
    L_.coldOut.position.copy(pColdOut).add(new THREE.Vector3(arr === 'shell12' ? -1.1 : 0.2, arr === 'shell12' ? 0.12 : -0.22, 0.55));

    // --- țevile colorate după temperatură ---
    if (this.tubeMeshes) this.tubeMeshes.forEach((t) => { this.root.remove(t); t.geometry.dispose(); });
    this.tubeMeshes = [];
    const groups = arr === 'shell12'
      ? [{ sel: (p) => p.y > 0, T: this.Tc1x }, { sel: (p) => p.y < 0, T: this.Tc2x }]
      : [{ sel: () => true, T: this.Tc1x }];
    const tubeLen = L + 0.14;
    for (const grp of groups) {
      const pts = this.tubeLayout.filter(grp.sel);
      const geo = new THREE.CylinderGeometry(R_TUBE, R_TUBE, tubeLen, 14, 80, true);
      geo.rotateZ(Math.PI / 2);
      const pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const cc = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const xf = Math.min(1, Math.max(0, (pos.getX(i) + L / 2) / L));
        temperatureColor(tn(grp.T(xf)), cc);
        cc.convertSRGBToLinear();
        col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mesh = new THREE.InstancedMesh(geo, this.mats.tube, pts.length);
      const mm = new THREE.Matrix4();
      pts.forEach((p, i) => { mm.makeTranslation(0, p.y, p.z); mesh.setMatrixAt(i, mm); });
      mesh.castShadow = true;
      this.root.add(mesh);
      this.tubeMeshes.push(mesh);
    }

    // --- traseul fluidului din manta (zigzag în jurul șicanelor) ---
    const bx = this.baffles.map((b) => b.position.x);
    const order = hotInX > 0 ? [...bx].sort((a, b) => b - a) : [...bx].sort((a, b) => a - b);
    // prima șicană din sensul curgerii are fereastra jos (fluidul intră pe sus)
    const way = [new THREE.Vector3(hotInX, R * 0.92, 0), new THREE.Vector3(hotInX, R * 0.55, 0)];
    order.forEach((x, i) => {
      const winSide = i % 2 === 0 ? -1 : 1;
      way.push(new THREE.Vector3(x, winSide * R * 0.74, 0));
      const next = i < order.length - 1 ? order[i + 1] : hotOutX;
      way.push(new THREE.Vector3((x + next) / 2, 0, 0));
    });
    way.pop();
    way.push(new THREE.Vector3(hotOutX, -R * 0.55, 0), new THREE.Vector3(hotOutX, -R * 0.92, 0));
    this.shellPath = new THREE.CatmullRomCurve3(way, false, 'centripetal');
    this.shellPathLen = this.shellPath.getLength();
    this.shellSamples = this.shellPath.getSpacedPoints(800);
    this.buildFlowRibbon(way);
    // orientarea baffle-urilor (fereastra pe partea corectă)
    this.baffles.forEach((b) => {
      const idx = order.indexOf(b.position.x);
      const winSide = idx % 2 === 0 ? -1 : 1; // -1: fereastră jos → partea plină sus
      b.rotation.x = winSide === -1 ? Math.PI : 0;
    });

    this.buildParticles();
  }

  /** Banda de curgere din manta: traseul în zigzag desenat lângă peretele vizibil, cu săgeți animate. */
  buildFlowRibbon(way) {
    if (this.ribbon) { this.root.remove(this.ribbon); this.ribbon.geometry.dispose(); }
    if (this.arrows) { this.root.remove(this.arrows); }
    // proiectăm punctele spre partea frontală a mantalei (vizibilă prin tăietură)
    const front = way.map((v) => {
      const y = Math.max(-R * 0.8, Math.min(R * 0.8, v.y));
      const z = 0.86 * Math.sqrt(Math.max(0, (R - 0.04) ** 2 - y * y));
      return new THREE.Vector3(v.x, y, z);
    });
    const curve = new THREE.CatmullRomCurve3(front, false, 'centripetal');
    this.ribbonCurve = curve;
    const geo = new THREE.TubeGeometry(curve, 400, 0.028, 10, false);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      temperatureColor(this.tn(this.Thx(Math.min(1, Math.max(0, (pos.getX(i) + L / 2) / L)))), c);
      c.convertSRGBToLinear();
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.ribbon = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.6, roughness: 0.4, depthWrite: false, depthTest: false }));
    this.ribbon.renderOrder = 5;
    this.root.add(this.ribbon);
    const NA = 14;
    const cone = new THREE.ConeGeometry(0.06, 0.16, 16);
    cone.rotateZ(-Math.PI / 2); // vârful pe +X
    this.arrows = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.1, depthTest: false }), NA);
    this.arrows.instanceColor = null;
    this.arrowPhase = Array.from({ length: NA }, (_, i) => i / NA);
    this.arrows.renderOrder = 6;
    this.root.add(this.arrows);
    this.ribbon.visible = this.arrows.visible = this.showParticles && this.schematic;
  }

  animateArrows(dt, vHot) {
    if (!this.arrows) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    const xAxis = new THREE.Vector3(1, 0, 0);
    const c = new THREE.Color();
    for (let i = 0; i < this.arrowPhase.length; i++) {
      this.arrowPhase[i] = (this.arrowPhase[i] + dt * vHot * 0.9) % 1;
      const u = this.arrowPhase[i];
      const p = this.ribbonCurve.getPointAt(u);
      const t = this.ribbonCurve.getTangentAt(u);
      q.setFromUnitVectors(xAxis, t);
      m.compose(p, q, sc);
      this.arrows.setMatrixAt(i, m);
      temperatureColor(this.tn(this.Thx(Math.min(1, Math.max(0, (p.x + L / 2) / L)))), c);
      this.arrows.setColorAt(i, c);
    }
    this.arrows.instanceMatrix.needsUpdate = true;
    if (this.arrows.instanceColor) this.arrows.instanceColor.needsUpdate = true;
  }

  buildParticles() {
    if (this.shellPts) { this.root.remove(this.shellPts); this.shellPts.geometry.dispose(); }
    if (this.tubePts) { this.root.remove(this.tubePts); this.tubePts.geometry.dispose(); }
    const mat = () => new THREE.PointsMaterial({ size: 0.07, vertexColors: true, map: this.dotTex, transparent: true, alphaTest: 0.25, depthWrite: true, sizeAttenuation: true });

    const NS = 1600;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 3), 3));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NS * 3), 3));
    this.shellState = Array.from({ length: NS }, () => ({ s: Math.random(), z: Math.random() < 0.75 ? 0.15 + 0.85 * Math.random() : -Math.random(), j: (Math.random() * 2 - 1), v: 0.8 + Math.random() * 0.4 }));
    this.shellPts = new THREE.Points(sg, mat());
    this.shellPts.frustumCulled = false;
    this.root.add(this.shellPts);

    const NT = 1100;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NT * 3), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NT * 3), 3));
    const tubes = this.tubeLayout;
    this.tubeState = Array.from({ length: NT }, () => ({ s: Math.random(), k: Math.floor(Math.random() * tubes.length), v: 0.85 + Math.random() * 0.3 }));
    this.tubePts = new THREE.Points(tg, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, map: this.dotTex, transparent: true, alphaTest: 0.25, sizeAttenuation: true }));
    this.tubePts.frustumCulled = false;
    this.root.add(this.tubePts);
    this.shellPts.visible = this.tubePts.visible = this.showParticles && this.schematic;
    this.tubeMeshes.forEach((t) => (t.visible = this.schematic));
  }

  /** Comută între vizualizarea schematică (model 1D) și cea CFD. */
  setSchematicVisible(on) {
    this.schematic = on;
    (this.tubeMeshes || []).forEach((t) => (t.visible = on));
    const p = on && this.showParticles;
    if (this.shellPts) this.shellPts.visible = this.tubePts.visible = p;
    if (this.ribbon) this.ribbon.visible = this.arrows.visible = p;
  }

  setCutaway(on) {
    this.shellCut.visible = on;
    this.shellFull.visible = !on;
  }

  setParticles(on) {
    this.showParticles = on;
    this.setSchematicVisible(this.schematic);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.controls.update();
    if (this.params && this.showParticles && this.schematic) this.animateParticles(this.running ? dt * this.speed : 0);
    if (this.cfdView) this.cfdView.animate(this.running ? dt * this.speed : 0);
    this.renderer.render(this.scene, this.camera);
  }

  animateParticles(dt) {
    const p = this.params;
    // viteze vizuale proporționale (logaritmic) cu debitele masice
    const vHot = 0.05 * (0.6 + Math.log10(1 + 10 * p.m_h));
    const vCold = 0.07 * (0.6 + Math.log10(1 + 10 * p.m_c));
    this.animateArrows(dt, vHot);
    const c = new THREE.Color();
    // manta
    {
      const pos = this.shellPts.geometry.attributes.position.array;
      const col = this.shellPts.geometry.attributes.color.array;
      const S = this.shellSamples, nS = S.length - 1;
      for (let i = 0; i < this.shellState.length; i++) {
        const st = this.shellState[i];
        st.s += dt * vHot * st.v;
        if (st.s > 1) st.s -= 1;
        const f = st.s * nS, k = Math.floor(f), w = f - k;
        const a = S[k], b = S[Math.min(nS, k + 1)];
        const x = a.x + (b.x - a.x) * w;
        const y0 = a.y + (b.y - a.y) * w;
        const y = y0 + st.j * 0.06;
        const zMax = Math.sqrt(Math.max(0, (R - 0.05) ** 2 - y * y));
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = st.z * zMax * 0.95;
        temperatureColor(this.tn(this.Thx((x + L / 2) / L)), c);
        c.convertSRGBToLinear();
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      this.shellPts.geometry.attributes.position.needsUpdate = true;
      this.shellPts.geometry.attributes.color.needsUpdate = true;
    }
    // țevi
    {
      const pos = this.tubePts.geometry.attributes.position.array;
      const col = this.tubePts.geometry.attributes.color.array;
      const twoPass = p.arrangement === 'shell12';
      for (let i = 0; i < this.tubeState.length; i++) {
        const st = this.tubeState[i];
        st.s += dt * vCold * st.v;
        if (st.s > 1) st.s -= 1;
        const t = this.tubeLayout[st.k];
        const back = twoPass && t.y < 0;
        const xf = back ? 1 - st.s : st.s;
        const x = -L / 2 - 0.07 + xf * (L + 0.14);
        pos[i * 3] = x; pos[i * 3 + 1] = t.y + 0.6 * (R_TUBE + 0.012); pos[i * 3 + 2] = t.z + 0.8 * (R_TUBE + 0.012);
        const T = back ? this.Tc2x(Math.min(1, Math.max(0, xf))) : this.Tc1x(Math.min(1, Math.max(0, xf)));
        temperatureColor(this.tn(T), c);
        c.lerp(new THREE.Color(1, 1, 1), 0.55);
        c.convertSRGBToLinear();
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      this.tubePts.geometry.attributes.position.needsUpdate = true;
      this.tubePts.geometry.attributes.color.needsUpdate = true;
    }
  }

  resetView() {
    this.camera.position.set(3.0, 3.1, 8.6);
    this.controls.target.set(0, 0.1, 0);
  }
}
