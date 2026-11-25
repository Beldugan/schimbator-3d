// cfd-view.js — afișarea rezultatelor CFD 3D în scena Three.js
import * as THREE from 'three';
import { temperatureColor, DIM } from './scene.js';

const FLUID = 0;
const TMP = { r: 0, g: 0, b: 0 };

export class CFDView {
  constructor(ex) {
    this.ex = ex;               // ExchangerScene
    this.group = new THREE.Group();
    this.group.visible = false;
    ex.root.add(this.group);
    this.opts = { field: 'T', longi: true, trans: true, transX: 0.5, tubes: false, stream: true };
    this.meta = null; this.fields = null;
    this.vScale = 1;            // m/s per unitate de rețea
  }

  setMeta(meta) {
    this.meta = meta;
    const { Nx, Ny, Nz, Rc } = meta;
    this.dx = DIM.L / (Nx - 2);
    this.dr = DIM.R / Rc;
    this.disposeChildren();
    // plan longitudinal (vertical, prin axă)
    this.texL = new THREE.DataTexture(new Uint8Array(Nx * Ny * 4), Nx, Ny, THREE.RGBAFormat);
    this.texL.colorSpace = THREE.SRGBColorSpace;
    this.texL.magFilter = THREE.LinearFilter; this.texL.minFilter = THREE.LinearFilter;
    const mL = new THREE.MeshBasicMaterial({ map: this.texL, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    this.planeL = new THREE.Mesh(new THREE.PlaneGeometry(Nx * this.dx, Ny * this.dr), mL);
    this.planeL.renderOrder = 3;
    this.group.add(this.planeL);
    // secțiune transversală
    this.texT = new THREE.DataTexture(new Uint8Array(Nz * Ny * 4), Nz, Ny, THREE.RGBAFormat);
    this.texT.colorSpace = THREE.SRGBColorSpace;
    this.texT.magFilter = THREE.LinearFilter; this.texT.minFilter = THREE.LinearFilter;
    const mT = new THREE.MeshBasicMaterial({ map: this.texT, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    this.planeT = new THREE.Mesh(new THREE.PlaneGeometry(Nz * this.dr, Ny * this.dr), mT);
    this.planeT.rotation.y = Math.PI / 2;
    this.planeT.renderOrder = 4;
    this.group.add(this.planeT);
    // conturul secțiunii transversale
    const ring = new THREE.Mesh(new THREE.TorusGeometry(DIM.R, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: '#111827' }));
    ring.rotation.y = Math.PI / 2;
    this.ring = ring;
    this.group.add(ring);
    // țevile colorate după temperaturile CFD (geometrie comasată, culori pe vârfuri)
    this.buildTubes();
    // linii de curent (particule advectate în câmpul de viteze CFD)
    const NP = 3200;
    this.pPos = new Float32Array(NP * 3);
    this.pCol = new Float32Array(NP * 3);
    this.pState = new Float32Array(NP * 4); // x, y, z (grilă), vârstă
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.05, vertexColors: true, map: this.ex.dotTex, transparent: true, alphaTest: 0.3, depthTest: false }));
    this.points.renderOrder = 7;
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.fluidList = [];
    for (let k = 0; k < meta.type.length; k++) if (meta.type[k] === FLUID) this.fluidList.push(k);
    for (let i = 0; i < NP; i++) this.spawn(i, Math.random() < 0.5);
    this.applyOptions();
  }

  disposeChildren() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.geometry?.dispose();
      c.material?.map?.dispose?.();
      c.material?.dispose?.();
    }
  }

  buildTubes() {
    const ex = this.ex, { Nx, Ny, Rc } = this.meta;
    const segs = 60;
    const base = new THREE.CylinderGeometry(DIM.R_TUBE, DIM.R_TUBE, DIM.L + 0.14, 10, segs, true);
    base.rotateZ(Math.PI / 2);
    const nv = base.attributes.position.count;
    const pts = ex.tubeLayout;
    const pos = new Float32Array(nv * 3 * pts.length), nor = new Float32Array(nv * 3 * pts.length);
    const idx = [];
    const bi = base.index.array;
    this.tubeMap = [];
    pts.forEach((p, ti) => {
      for (let v = 0; v < nv; v++) {
        pos[(ti * nv + v) * 3] = base.attributes.position.getX(v);
        pos[(ti * nv + v) * 3 + 1] = base.attributes.position.getY(v) + p.y;
        pos[(ti * nv + v) * 3 + 2] = base.attributes.position.getZ(v) + p.z;
        nor[(ti * nv + v) * 3] = base.attributes.normal.getX(v);
        nor[(ti * nv + v) * 3 + 1] = base.attributes.normal.getY(v);
        nor[(ti * nv + v) * 3 + 2] = base.attributes.normal.getZ(v);
      }
      for (let i = 0; i < bi.length; i++) idx.push(bi[i] + ti * nv);
      // canalul CFD corespunzător (cel mai apropiat)
      const gy = Math.round(p.y / this.dr + (Ny - 1) / 2), gz = Math.round(p.z / this.dr + (Ny - 1) / 2);
      let t = this.meta.tubeIndex[gy + Ny * gz];
      if (t < 0) {
        let best = 1e9;
        this.meta.tubes.forEach((tb, j) => { const d = (tb[0] - gy) ** 2 + (tb[1] - gz) ** 2; if (d < best) { best = d; t = j; } });
      }
      this.tubeMap.push(t);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx);
    this.tubeNV = nv;
    this.tubeBaseX = base.attributes.position.array.filter((_, i) => i % 3 === 0);
    base.dispose();
    this.tubesMesh = new THREE.Mesh(g, ex.mats.tube);
    this.tubesMesh.castShadow = true;
    this.group.add(this.tubesMesh);
  }

  setFields(fields, params, metrics) {
    this.fields = fields;
    this.params = params;
    const { Nx, Ny, Nz } = this.meta;
    // scara vitezelor: debitul volumic real / debitul în unități de rețea (similitudine cinematică)
    const rho = params.rho_h || 1000;
    const Vdot = params.m_h / rho;
    // celula de rețea la scara mantalei reale estimate (Dₘ), similitudine cinematică
    const drReal = (params.Ds || 2 * DIM.R) / (2 * this.meta.Rc);
    this.vScale = metrics && metrics.Qv > 0 ? Vdot / (metrics.Qv * drReal * drReal) : 1;
    // viteza de referință pentru culori: percentila 97
    const sp = [];
    for (let i = 0; i < this.fluidList.length; i += 7) {
      const k = this.fluidList[i];
      sp.push(Math.hypot(fields.ux[k], fields.uy[k], fields.uz[k]));
    }
    sp.sort((a, b) => a - b);
    this.uRef = sp[Math.floor(sp.length * 0.97)] || 1e-6;
    let su = 0; for (const v of sp) su += v;
    this.uMean = su / Math.max(1, sp.length);
    this.updateTextures();
    this.updateTubeColors();
  }

  value(k) {
    const f = this.fields;
    if (this.opts.field === 'T') return f.phi[k];
    return Math.min(1, Math.hypot(f.ux[k], f.uy[k], f.uz[k]) / this.uRef);
  }

  updateTextures() {
    if (!this.fields) return;
    const { Nx, Ny, Nz, type } = this.meta;
    const c = new THREE.Color();
    const zMid = Math.floor(Nz / 2), zMid2 = Math.ceil((Nz - 1) / 2);
    const dL = this.texL.image.data;
    for (let y = 0; y < Ny; y++) for (let x = 0; x < Nx; x++) {
      const k1 = x + Nx * (y + Ny * zMid), k2 = x + Nx * (y + Ny * zMid2);
      const o = (y * Nx + x) * 4;
      if (type[k1] !== FLUID && type[k2] !== FLUID) { dL[o + 3] = 0; continue; }
      const v = type[k1] === FLUID && type[k2] === FLUID ? (this.value(k1) + this.value(k2)) / 2 : this.value(type[k1] === FLUID ? k1 : k2);
      temperatureColor(v, c).getRGB(TMP, THREE.SRGBColorSpace);
      dL[o] = TMP.r * 255; dL[o + 1] = TMP.g * 255; dL[o + 2] = TMP.b * 255; dL[o + 3] = 235;
    }
    this.texL.needsUpdate = true;
    const gx = Math.min(Nx - 2, Math.max(1, Math.round(1 + this.opts.transX * (Nx - 3))));
    this.transGX = gx;
    const dT = this.texT.image.data;
    for (let y = 0; y < Ny; y++) for (let z = 0; z < Nz; z++) {
      const k = gx + Nx * (y + Ny * z);
      // textura planului rotit: coloana u corespunde lui −z
      const o = (y * Nz + (Nz - 1 - z)) * 4;
      if (type[k] !== FLUID) { dT[o + 3] = 0; continue; }
      temperatureColor(this.value(k), c).getRGB(TMP, THREE.SRGBColorSpace);
      dT[o] = TMP.r * 255; dT[o + 1] = TMP.g * 255; dT[o + 2] = TMP.b * 255; dT[o + 3] = 240;
    }
    this.texT.needsUpdate = true;
    const X = -DIM.L / 2 + ((gx - 0.5) / (Nx - 2)) * DIM.L;
    this.planeT.position.x = X; this.ring.position.x = X;
  }

  updateTubeColors() {
    if (!this.fields || !this.tubesMesh) return;
    const { Nx } = this.meta;
    const col = this.tubesMesh.geometry.attributes.color.array;
    const c = new THREE.Color();
    const phiT = this.fields.phiT, nv = this.tubeNV;
    this.tubeMap.forEach((t, ti) => {
      for (let v = 0; v < nv; v++) {
        const X = this.tubeBaseX[v];
        const gx = Math.min(Nx - 2, Math.max(1, Math.round(((X + DIM.L / 2) / DIM.L) * (Nx - 2) + 0.5)));
        temperatureColor(phiT[t * Nx + gx], c);
        c.convertSRGBToLinear();
        const o = (ti * nv + v) * 3;
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      }
    });
    this.tubesMesh.geometry.attributes.color.needsUpdate = true;
  }

  applyOptions() {
    if (!this.planeL) return;
    this.planeL.visible = this.opts.longi;
    this.planeT.visible = this.ring.visible = this.opts.trans;
    this.tubesMesh.visible = this.opts.tubes;
    this.points.visible = this.opts.stream;
    this.updateTextures();
  }

  setVisible(on) {
    this.group.visible = on;
    this.ex.setSchematicVisible(!on);
  }

  // --- linii de curent ---
  spawn(i, atInlet) {
    const m = this.meta, s = this.pState;
    let k;
    if (atInlet && m.inletCells.length) k = m.inletCells[Math.floor(Math.random() * m.inletCells.length)];
    else k = this.fluidList[Math.floor(Math.random() * this.fluidList.length)];
    const x = k % m.Nx, r = (k - x) / m.Nx, y = r % m.Ny, z = (r - y) / m.Ny;
    s[i * 4] = x + Math.random() - 0.5; s[i * 4 + 1] = y + Math.random() - 0.5; s[i * 4 + 2] = z + Math.random() - 0.5; s[i * 4 + 3] = 0;
  }

  sample(arr, x, y, z) {
    const { Nx, Ny, Nz, type } = this.meta;
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    let v = 0, wsum = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const xi = x0 + dx, yi = y0 + dy, zi = z0 + dz;
      if (xi < 0 || yi < 0 || zi < 0 || xi >= Nx || yi >= Ny || zi >= Nz) continue;
      const k = xi + Nx * (yi + Ny * zi);
      if (type[k] !== FLUID) continue;
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      v += w * arr[k]; wsum += w;
    }
    return wsum > 1e-6 ? v / wsum : 0;
  }

  animate(dt) {
    if (!this.group.visible || !this.fields || !this.opts.stream) return;
    const m = this.meta, f = this.fields, s = this.pState;
    const K = this.uMean > 0 ? 5 / this.uMean : 0; // ≈ 5 celule/s la viteza medie
    const c = new THREE.Color();
    const n = this.pPos.length / 3;
    for (let i = 0; i < n; i++) {
      let x = s[i * 4], y = s[i * 4 + 1], z = s[i * 4 + 2];
      const u = this.sample(f.ux, x, y, z), v = this.sample(f.uy, x, y, z), w = this.sample(f.uz, x, y, z);
      x += u * K * dt; y += v * K * dt; z += w * K * dt;
      s[i * 4 + 3] += dt;
      const kx = Math.round(x), ky = Math.round(y), kz = Math.round(z);
      const kk = kx + m.Nx * (ky + m.Ny * kz);
      const t = kx < 0 || ky < 0 || kz < 0 || kx >= m.Nx || ky >= m.Ny || kz >= m.Nz ? 1 : m.type[kk];
      if (t !== FLUID || s[i * 4 + 3] > 30 || (u * u + v * v + w * w) * K * K < 1e-4) { this.spawn(i, Math.random() < 0.6); continue; }
      s[i * 4] = x; s[i * 4 + 1] = y; s[i * 4 + 2] = z;
      this.pPos[i * 3] = -DIM.L / 2 + ((x - 0.5) / (m.Nx - 2)) * DIM.L;
      this.pPos[i * 3 + 1] = (y - (m.Ny - 1) / 2) * this.dr;
      this.pPos[i * 3 + 2] = (z - (m.Nz - 1) / 2) * this.dr;
      temperatureColor(this.opts.field === 'T' ? this.sample(f.phi, x, y, z) : Math.min(1, Math.hypot(u, v, w) / this.uRef), c);
      c.lerp(new THREE.Color(1, 1, 1), 0.25);
      c.convertSRGBToLinear();
      this.pCol[i * 3] = c.r; this.pCol[i * 3 + 1] = c.g; this.pCol[i * 3 + 2] = c.b;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

