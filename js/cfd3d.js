// cfd3d.js — analiză CFD tridimensională a întregului ansamblu
//
// Geometria urmează modelul 3D din aplicație: manta cilindrică, 5 șicane segmentate (tăietură 25 %),
// racorduri circulare de intrare/ieșire pe manta, fascicul de țevi cu joc față de manta, plăci tubulare,
// camere de distribuție și treceri prin țevi.
//
// Partea de manta (3D):
//   • Curgere: Lattice-Boltzmann D3Q19 (BGK), laminar, la Mach mic; pereții (manta, șicane, plăci tubulare)
//     cu condiție bounce-back; intrare cu viteză impusă, ieșire cu presiune impusă.
//   • Fasciculul de țevi: mediu poros cu rezistență Darcy (abordarea Patankar–Spalding), cu joc liber
//     față de manta (curent de ocolire / bypass).
//   • Temperatura: advecție–difuzie (volume finite, upwind) cu schimb local de căldură cu țevile.
// Partea de țevi (fiecare canal de țevi separat):
//   • Fiecare coloană (y, z) a fasciculului este un canal de țevi cu temperatură proprie de-a lungul axei;
//     debitul de fluid rece se împarte uniform pe țevile unei treceri.
//   • Schema 1–2: trecerea 1 = jumătatea superioară, trecerea 2 = jumătatea inferioară; în camera
//     posterioară fluidul din trecerea 1 se amestecă înainte de a intra în trecerea 2.
// Cuplaj: schimbul local s = β (φ − φ_țeavă) este calibrat astfel încât UA total = UA din modelul 1D.
// Mărimi adimensionale: φ = (T − Tc,in)/(Th,in − Tc,in).

const C = [
  [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1],
  [0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1],
];
const Q = 19;
const CX = C.map((c) => c[0]), CY = C.map((c) => c[1]), CZ = C.map((c) => c[2]);
const W = C.map((c, i) => (i === 0 ? 1 / 3 : Math.abs(c[0]) + Math.abs(c[1]) + Math.abs(c[2]) === 1 ? 1 / 18 : 1 / 36));
const OPP = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17];

export const FLUID = 0, SOLID = 1, INLET = 2, OUTLET = 3;

// dimensiunile modelului 3D vizual (aceleași ca în scene.js)
export const GEOM = { L: 6.0, R: 0.62, nBaffles: 5, baffleCut: 0.25, nozzleOffset: 0.45, nozzleR: 0.18 };

export class CFD3D {
  /**
   * cfg: { D (celule pe diametru), arrangement, NTUh, Rhc, gap (fracțiune din D), kPor,
   *        phiHot0[], phiCold1_0[], phiCold2_0[] }
   */
  constructor(cfg) {
    this.cfg = cfg;
    const D = cfg.D ?? 24;
    this.Rc = D / 2;
    this.Ny = this.Nz = D + 2;
    this.Nx = Math.round((GEOM.L / GEOM.R) * this.Rc) + 2;
    this.N = this.Nx * this.Ny * this.Nz;
    this.SX = 1; this.SY = this.Nx; this.SZ = this.Nx * this.Ny;
    this.tau = cfg.tau ?? 0.75;
    this.uin = cfg.uin ?? 0.06;
    this.alpha = cfg.alpha ?? 0.01;
    this.kPor = cfg.kPor ?? 0.01;
    this.step = 0;
    this.phase = 'flow';
    this.history = [];
    this.build();
    this.init();
  }

  k(x, y, z) { return x + this.Nx * (y + this.Ny * z); }
  /** Conversii grilă ↔ coordonatele scenei 3D. */
  toWorldX(x) { return -GEOM.L / 2 + ((x - 0.5) / (this.Nx - 2)) * GEOM.L; }
  toGridX(X) { return ((X + GEOM.L / 2) / GEOM.L) * (this.Nx - 2) + 0.5; }
  yc(y) { return y - (this.Ny - 1) / 2; }

  build() {
    const { Nx, Ny, Nz, N, Rc, cfg } = this;
    const type = (this.type = new Uint8Array(N).fill(SOLID));
    const por = (this.por = new Uint8Array(N));
    const R2 = Rc * Rc;
    // interiorul mantalei
    for (let z = 0; z < Nz; z++) for (let y = 0; y < Ny; y++) {
      const r2 = this.yc(y) ** 2 + this.yc(z) ** 2;
      if (r2 > R2) continue;
      for (let x = 1; x < Nx - 1; x++) type[this.k(x, y, z)] = FLUID;
    }
    // racorduri pe manta (circulare): cald intră sus, iese jos
    const hotInRight = cfg.arrangement !== 'parallel';
    const xEnd = GEOM.L / 2 - GEOM.nozzleOffset;
    this.xin = this.toGridX(hotInRight ? xEnd : -xEnd);
    this.xout = this.toGridX(hotInRight ? -xEnd : xEnd);
    const rn = (GEOM.nozzleR / GEOM.R) * Rc;
    this.inletCells = []; this.outletCells = [];
    for (let z = 0; z < Nz; z++) for (let x = 1; x < Nx - 1; x++) {
      const zc = this.yc(z);
      for (const [xc, kind] of [[this.xin, INLET], [this.xout, OUTLET]]) {
        if ((x - xc) ** 2 + zc ** 2 > rn * rn) continue;
        // prima celulă solidă deasupra (intrare) / dedesubtul (ieșire) fluidului
        if (kind === INLET) {
          for (let y = Ny - 1; y >= 0; y--) if (type[this.k(x, y, z)] === FLUID) { type[this.k(x, y + 1, z)] = INLET; this.inletCells.push(this.k(x, y, z)); break; }
        } else {
          for (let y = 0; y < Ny; y++) if (type[this.k(x, y, z)] === FLUID) { type[this.k(x, y - 1, z)] = OUTLET; this.outletCells.push(this.k(x, y, z)); break; }
        }
      }
    }
    // șicane segmentate
    const nb = GEOM.nBaffles;
    const cutY = Rc - 2 * Rc * GEOM.baffleCut; // |yc| al coardei
    this.baffles = [];
    const order = [];
    for (let i = 0; i < nb; i++) order.push(i);
    if (hotInRight) order.reverse();
    for (let i = 0; i < nb; i++) {
      const X = -GEOM.L / 2 + (GEOM.L * (i + 1)) / (nb + 1);
      const x = Math.round(this.toGridX(X));
      const windowBottom = order.indexOf(i) % 2 === 0;
      this.baffles.push({ x, X, windowBottom });
      for (let z = 0; z < Nz; z++) for (let y = 0; y < Ny; y++) {
        const kk = this.k(x, y, z);
        if (type[kk] !== FLUID) continue;
        const yy = this.yc(y);
        const inWindow = windowBottom ? yy < -cutY : yy > cutY;
        if (!inWindow) type[kk] = SOLID;
      }
    }
    // fasciculul (poros) cu joc față de manta
    const gapCells = Math.max(0.8, (cfg.gap ?? 0.04) * 2 * Rc);
    const Rb2 = (Rc - gapCells) ** 2;
    let vpor = 0;
    // canalele de țevi: câte unul pentru fiecare coloană (y, z) din fascicul
    this.tubeIndex = new Int32Array(Ny * Nz).fill(-1);
    this.tubes = [];
    for (let z = 0; z < Nz; z++) for (let y = 0; y < Ny; y++) {
      const r2 = this.yc(y) ** 2 + this.yc(z) ** 2;
      if (r2 > Rb2) continue;
      const pass = cfg.arrangement === 'shell12' ? (this.yc(y) >= 0 ? 1 : 2) : 1;
      this.tubeIndex[y + Ny * z] = this.tubes.length;
      this.tubes.push({ y, z, pass });
      for (let x = 1; x < Nx - 1; x++) {
        const kk = this.k(x, y, z);
        if (type[kk] === FLUID) { por[kk] = 1; vpor++; }
      }
    }
    this.Vpor = vpor;
    this.nT = this.tubes.length;
    this.nPass1 = this.tubes.filter((t) => t.pass === 1).length;
    this.nPass2 = this.nT - this.nPass1;
    this.phiT = new Float32Array(this.nT * Nx); // temperatura fluidului din fiecare canal de țevi
    this.HT = new Float32Array(this.nT * Nx);   // căldura primită pe celulă de canal
    // lista celulelor fluide (pentru bucle rapide)
    const fl = [];
    for (let kk = 0; kk < N; kk++) if (type[kk] === FLUID) fl.push(kk);
    this.fluidCells = Int32Array.from(fl);
    // secțiunea de măsurare a debitului: mijlocul compartimentului central
    const bx = this.baffles.map((b) => b.x).sort((a, b) => a - b);
    this.xMeas = Math.round((bx[1] + bx[2]) / 2);
    this.Qv = this.uin * this.inletCells.length;
    this.beta = (cfg.NTUh * this.Qv) / Math.max(1, vpor);
    // memorie pentru câmpuri
    this.f = new Float32Array(Q * N);
    this.f2 = new Float32Array(Q * N);
    this.ux = new Float32Array(N); this.uy = new Float32Array(N); this.uz = new Float32Array(N);
    this.phi = new Float32Array(N); this.phi2 = new Float32Array(N);
    this.off = C.map((c) => c[0] * this.SX + c[1] * this.SY + c[2] * this.SZ);
  }

  init() {
    const { N, Nx, cfg } = this;
    for (let i = 0; i < Q; i++) this.f.fill(W[i], i * N, (i + 1) * N);
    const sample = (arr, xf) => {
      if (!arr || !arr.length) return 0.5;
      const f = Math.min(1, Math.max(0, xf)) * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(f)), w = f - i;
      return arr[i] * (1 - w) + arr[i + 1] * w;
    };
    const xf = (x) => (x - 0.5) / (Nx - 2);
    for (const kk of this.fluidCells) this.phi[kk] = sample(cfg.phiHot0, xf(kk % Nx));
    for (let t = 0; t < this.nT; t++) {
      const src = this.tubes[t].pass === 1 ? cfg.phiCold1_0 : cfg.phiCold2_0;
      for (let x = 0; x < Nx; x++) this.phiT[t * Nx + x] = sample(src, xf(x));
    }
  }

  stepFlow() {
    const { N, type, por, f, f2, ux, uy, uz, off } = this;
    const itau = 1 / this.tau, uin = this.uin, kp = this.kPor, damp = 1 - this.tau * kp, corr = 1 - kp / 2;
    const fi = new Float64Array(Q);
    const cells = this.fluidCells;
    for (let n = 0; n < cells.length; n++) {
      const k = cells[n];
      let r = 0, mx = 0, my = 0, mz = 0;
      for (let i = 0; i < Q; i++) {
        const s = k - off[i];
        const t = type[s];
        let v;
        if (t === FLUID) v = f[i * N + s];
        else if (t === SOLID) v = f[OPP[i] * N + k];
        else if (t === INLET) v = feq(i, 1, 0, -uin, 0);
        else v = feq(i, 1, ux[k], uy[k], uz[k]);
        fi[i] = v; r += v; mx += v * CX[i]; my += v * CY[i]; mz += v * CZ[i];
      }
      let u = mx / r, w = my / r, q = mz / r;
      let ue = u, we = w, qe = q;
      if (por[k]) { ue *= damp; we *= damp; qe *= damp; u *= corr; w *= corr; q *= corr; }
      const usq = 1.5 * (ue * ue + we * we + qe * qe);
      for (let i = 0; i < Q; i++) {
        const cu = 3 * (CX[i] * ue + CY[i] * we + CZ[i] * qe);
        const eq = W[i] * r * (1 + cu + 0.5 * cu * cu - usq);
        f2[i * N + k] = fi[i] - (fi[i] - eq) * itau;
      }
      ux[k] = u; uy[k] = w; uz[k] = q;
    }
    this.f = f2; this.f2 = f;
  }

  /**
   * Proiecția câmpului de viteze pe un câmp de fluxuri pe fețe cu divergență nulă (ecuația Poisson pentru
   * corecția de presiune, rezolvată cu gradienți conjugați). Rezultatul garantează conservarea exactă a
   * masei și a energiei în transportul termic.
   */
  project() {
    const { N, type, ux, uy, uz, SY, SZ } = this;
    const cells = this.fluidCells, M = cells.length;
    const cid = new Int32Array(N).fill(-1);
    for (let n = 0; n < M; n++) cid[cells[n]] = n;
    const Fx = (this.Fx = new Float64Array(N)), Fy = (this.Fy = new Float64Array(N)), Fz = (this.Fz = new Float64Array(N));
    const Qin = this.axialFlux();
    const nIn = this.inletCells.length;
    this.Qv = Qin;
    const isF = (k) => type[k] === FLUID;
    for (let n = 0; n < M; n++) {
      const k = cells[n];
      if (isF(k + 1)) Fx[k] = 0.5 * (ux[k] + ux[k + 1]);
      if (isF(k + SY)) Fy[k] = 0.5 * (uy[k] + uy[k + SY]);
      else if (type[k + SY] === INLET) Fy[k] = -Qin / nIn;
      if (isF(k + SZ)) Fz[k] = 0.5 * (uz[k] + uz[k + SZ]);
      if (type[k - SY] === OUTLET) Fy[k - SY] = uy[k];
    }
    // divergența și matricea (SPD): deg·ψ_k − Σ ψ_vecini = −div_k
    const nb = new Int32Array(6 * M).fill(-1), deg = new Float64Array(M), rhs = new Float64Array(M);
    const offs = [1, -1, SY, -SY, SZ, -SZ];
    for (let n = 0; n < M; n++) {
      const k = cells[n];
      const div = Fx[k] - Fx[k - 1] + Fy[k] - Fy[k - SY] + Fz[k] - Fz[k - SZ];
      rhs[n] = -div;
      for (let d = 0; d < 6; d++) {
        const sIdx = k + offs[d];
        if (isF(sIdx)) { nb[6 * n + d] = cid[sIdx]; deg[n]++; }
        else if (d === 3 && type[sIdx] === OUTLET) deg[n]++; // față de ieșire: ψ = 0
      }
    }
    const Ax = (v, out) => {
      for (let n = 0; n < M; n++) {
        let sum = deg[n] * v[n];
        for (let d = 0; d < 6; d++) { const m = nb[6 * n + d]; if (m >= 0) sum -= v[m]; }
        out[n] = sum;
      }
    };
    const psi = new Float64Array(M), r = Float64Array.from(rhs), pv = Float64Array.from(rhs), Ap = new Float64Array(M);
    let rr = r.reduce((acc, v) => acc + v * v, 0);
    const rr0 = rr;
    let it = 0;
    for (; it < 4000 && rr > 1e-22 * Math.max(1, rr0) && rr > 1e-24; it++) {
      Ax(pv, Ap);
      let pAp = 0; for (let n = 0; n < M; n++) pAp += pv[n] * Ap[n];
      const al = rr / pAp;
      let rn = 0;
      for (let n = 0; n < M; n++) { psi[n] += al * pv[n]; r[n] -= al * Ap[n]; rn += r[n] * r[n]; }
      const be = rn / rr; rr = rn;
      for (let n = 0; n < M; n++) pv[n] = r[n] + be * pv[n];
    }
    this.cgIters = it;
    // corecția fluxurilor
    for (let n = 0; n < M; n++) {
      const k = cells[n];
      if (isF(k + 1)) Fx[k] -= psi[cid[k + 1]] - psi[n];
      if (isF(k + SY)) Fy[k] -= psi[cid[k + SY]] - psi[n];
      if (isF(k + SZ)) Fz[k] -= psi[cid[k + SZ]] - psi[n];
      if (type[k - SY] === OUTLET) Fy[k - SY] -= psi[n]; // F_ieșire = F* + ψ_k (în sensul −y)
    }
    let maxDiv = 0, maxOut = 0;
    for (let n = 0; n < M; n++) {
      const k = cells[n];
      const div = Fx[k] - Fx[k - 1] + Fy[k] - Fy[k - SY] + Fz[k] - Fz[k - SZ];
      maxDiv = Math.max(maxDiv, Math.abs(div));
      const out = Math.max(0, Fx[k]) + Math.max(0, -Fx[k - 1]) + Math.max(0, Fy[k]) + Math.max(0, -Fy[k - SY]) + Math.max(0, Fz[k]) + Math.max(0, -Fz[k - SZ]);
      maxOut = Math.max(maxOut, out);
    }
    this.maxDiv = maxDiv;
    this.beta = (this.cfg.NTUh * this.Qv) / Math.max(1, this.Vpor);
    this.dtT = Math.min(0.9 / Math.max(1e-9, maxOut + 6 * this.alpha + this.beta), 12);
  }

  /**
   * Transport termic, volume finite conservative pe fluxurile proiectate: upwind pe fețe, difuzie
   * centrală, schimb local cu canalele de țevi. Pe pereți fluxul este nul.
   */
  stepThermal(dt) {
    const { Nx, Ny, type, por, phi, phi2, phiT, HT, tubeIndex, SY, SZ, Fx, Fy, Fz } = this;
    const a = this.alpha, b = this.beta;
    HT.fill(0);
    const cells = this.fluidCells;
    let fin = 0, foutPhi = 0, fout = 0;
    for (let n = 0; n < cells.length; n++) {
      const k = cells[n];
      const p = phi[k];
      let adv = 0, dif = 0;
      // fețele ±x, ±y, ±z: F = flux care iese din celulă
      for (let d = 0; d < 6; d++) {
        let F, sIdx;
        switch (d) {
          case 0: F = Fx[k]; sIdx = k + 1; break;
          case 1: F = -Fx[k - 1]; sIdx = k - 1; break;
          case 2: F = Fy[k]; sIdx = k + SY; break;
          case 3: F = -Fy[k - SY]; sIdx = k - SY; break;
          case 4: F = Fz[k]; sIdx = k + SZ; break;
          default: F = -Fz[k - SZ]; sIdx = k - SZ;
        }
        const t = type[sIdx];
        if (t === FLUID) { const q = phi[sIdx]; adv += F * (F > 0 ? p : q); dif += q - p; }
        else if (t === INLET) { if (F < 0) { adv += F; fin -= F; } else adv += F * p; }
        else if (t === OUTLET) { adv += F * p; foutPhi += F * p; fout += F; }
      }
      let snk = 0;
      if (por[k]) {
        const x = k % Nx, rest = (k - x) / Nx, y = rest % Ny, z = (rest - y) / Ny;
        const j = tubeIndex[y + Ny * z] * Nx + x;
        snk = b * (p - phiT[j]);
        HT[j] += snk;
      }
      phi2[k] = p + dt * (-adv + a * dif - snk);
    }
    this.fin = fin; this.fout = fout; this.foutPhi = foutPhi;
    this.phi = phi2; this.phi2 = phi;
    this.updateTubes();
  }

  /** Bilanțul pe fiecare canal de țevi; amestec în camera posterioară la schema 1–2. */
  updateTubes() {
    const { Nx, nT, tubes, phiT, HT, cfg } = this;
    const Qc = this.Qv / cfg.Rhc;           // debitul capacitiv al fluidului rece (adimensional)
    const w = 0.5;
    const march = (t, dir, start, share) => {
      let c = start;
      const x0 = dir > 0 ? 1 : Nx - 2, x1 = dir > 0 ? Nx - 1 : 0;
      for (let x = x0; x !== x1; x += dir) {
        const j = t * Nx + x;
        const dq = HT[j] / share;
        const nv = c + dq / 2;
        phiT[j] += w * (nv - phiT[j]);
        c += dq;
      }
      return c;
    };
    if (cfg.arrangement === 'shell12') {
      const s1 = Qc / Math.max(1, this.nPass1), s2 = Qc / Math.max(1, this.nPass2);
      let mix = 0;
      for (let t = 0; t < nT; t++) if (tubes[t].pass === 1) mix += march(t, +1, 0, s1);
      mix /= Math.max(1, this.nPass1);          // amestec în camera posterioară
      let out = 0;
      for (let t = 0; t < nT; t++) if (tubes[t].pass === 2) out += march(t, -1, mix, s2);
      this.phicMid = mix;
      this.phicOut = out / Math.max(1, this.nPass2);
    } else {
      const s1 = Qc / Math.max(1, nT);
      let out = 0;
      for (let t = 0; t < nT; t++) out += march(t, +1, 0, s1);
      this.phicOut = out / Math.max(1, nT);
    }
  }

  axialFlux() {
    const { Ny, Nz, type, ux } = this;
    let q = 0;
    for (let z = 0; z < Nz; z++) for (let y = 0; y < Ny; y++) {
      const kk = this.k(this.xMeas, y, z);
      if (type[kk] === FLUID) q += ux[kk];
    }
    return Math.abs(q);
  }

  maxSpeed() {
    let m = 0;
    for (const kk of this.fluidCells) {
      const s = this.ux[kk] ** 2 + this.uy[kk] ** 2 + this.uz[kk] ** 2;
      if (s > m) m = s;
    }
    return Math.sqrt(m);
  }

  advance(n) {
    for (let s = 0; s < n && this.phase !== 'done'; s++) {
      if (this.phase === 'flow') {
        this.stepFlow();
      } else {
        this.stepThermal(this.dtT);
      }
      this.step++;
      if (this.step % 100 === 0) this.checkConvergence();
    }
  }

  checkConvergence() {
    if (this.phase === 'flow') {
      let s = 0;
      for (const kk of this.fluidCells) s += Math.abs(this.ux[kk]) + Math.abs(this.uy[kk]) + Math.abs(this.uz[kk]);
      this.flowRes = this.lastSum ? Math.abs(s - this.lastSum) / s : 1;
      this.lastSum = s;
      if ((this.flowRes < 1.5e-4 && this.step > 800) || this.step > (this.cfg.maxFlowSteps ?? 12000)) {
        this.project();
        this.phase = 'thermal';
        this.thermalStart = this.step;
      }
    }
    const m = this.metrics();
    this.history.push({ step: this.step, phiOut: m.phiOut, phicOut: m.phicOut });
    if (this.history.length > 300) this.history.shift();
    if (this.phase === 'thermal') {
      const h = this.history, nH = h.length;
      if (nH > 8 && this.step - this.thermalStart > 800) {
        const d = Math.max(Math.abs(h[nH - 1].phiOut - h[nH - 8].phiOut), Math.abs(h[nH - 1].phicOut - h[nH - 8].phicOut));
        this.thermalRes = d;
        this.balanceErr = Math.abs(m.balance);
        if ((d < 1e-4 && this.balanceErr < 0.005) || this.step > (this.cfg.maxSteps ?? 40000)) this.phase = 'done';
      }
    }
  }

  metrics() {
    const { Nx, type, por, ux, uy, uz, phi } = this;
    const phiOut = this.fout > 0 ? this.foutPhi / this.fout : NaN;
    const Qv = this.Qv;
    const heatHot = (this.fin ?? Qv) - (this.foutPhi ?? 0);
    const heatCold = (Qv / this.cfg.Rhc) * (this.phicOut ?? 0);
    let Hsum = 0; for (let j = 0; j < this.HT.length; j++) Hsum += this.HT[j];
    // bypass: fracțiunea debitului axial prin jocul fascicul–manta, în compartimentele interioare
    const bx = this.baffles.map((b) => b.x).sort((a, b) => a - b);
    let gap = 0, tot = 0;
    for (let i = 0; i < bx.length - 1; i++) {
      const x = Math.round((bx[i] + bx[i + 1]) / 2);
      for (let z = 0; z < this.Nz; z++) for (let y = 0; y < this.Ny; y++) {
        const kk = this.k(x, y, z);
        if (type[kk] !== FLUID) continue;
        const q = Math.abs(ux[kk]); tot += q; if (!por[kk]) gap += q;
      }
    }
    let sum = 0, n = 0;
    for (const kk of this.fluidCells) if (por[kk]) { sum += Math.hypot(ux[kk], uy[kk], uz[kk]); n++; }
    const mean = sum / Math.max(1, n);
    let dead = 0, wmax = 0;
    for (const kk of this.fluidCells) if (por[kk] && Math.hypot(ux[kk], uy[kk], uz[kk]) < 0.1 * mean) dead++;
    for (const b of this.baffles) for (let z = 0; z < this.Nz; z++) for (let y = 0; y < this.Ny; y++) {
      const kk = this.k(b.x, y, z);
      if (type[kk] === FLUID) wmax = Math.max(wmax, Math.hypot(ux[kk], uy[kk], uz[kk]));
    }
    // neuniformitatea temperaturii la ieșirea din țevi
    let tmin = Infinity, tmax = -Infinity;
    const lastPass = this.cfg.arrangement === 'shell12' ? 2 : 1;
    for (let t = 0; t < this.nT; t++) {
      if (this.tubes[t].pass !== lastPass) continue;
      const v = this.phiT[t * Nx + (lastPass === 2 ? 1 : Nx - 2)];
      tmin = Math.min(tmin, v); tmax = Math.max(tmax, v);
    }
    return {
      phiOut, phicOut: this.phicOut ?? NaN, heatHot, heatCold, Hsum,
      balance: heatHot > 0 ? (heatHot - heatCold) / heatHot : 0,
      bypass: tot > 0 ? gap / tot : 0, dead: dead / Math.max(1, n), windowRatio: mean > 0 ? wmax / mean : 0,
      tubeSpread: tmax - tmin, step: this.step, phase: this.phase,
      flowRes: this.flowRes ?? 1, thermalRes: this.thermalRes ?? 1, cells: this.fluidCells.length,
    };
  }
}

function feq(i, r, u, v, w) {
  const cu = 3 * (CX[i] * u + CY[i] * v + CZ[i] * w);
  return W[i] * r * (1 + cu + 0.5 * cu * cu - 1.5 * (u * u + v * v + w * w));
}
