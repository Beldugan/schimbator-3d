// cfd-worker.js — rulează solverul CFD 3D într-un fir separat, fără să blocheze interfața
import { CFD3D } from './cfd3d.js';

let sim = null;
let running = false;
let lastFull = 0;
let t0 = 0;

self.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'start') {
    sim = new CFD3D(m.cfg);
    running = true;
    lastFull = 0;
    t0 = performance.now();
    self.postMessage({ type: 'meta', meta: meta() });
    loop();
  } else if (m.cmd === 'pause') {
    running = false;
  } else if (m.cmd === 'resume') {
    if (sim && sim.phase !== 'done') { running = true; loop(); }
  } else if (m.cmd === 'stop') {
    running = false; sim = null;
  }
};

function meta() {
  const tubes = sim.tubes.map((t) => [t.y, t.z, t.pass]);
  return {
    Nx: sim.Nx, Ny: sim.Ny, Nz: sim.Nz, Rc: sim.Rc, type: sim.type.slice(), tubeIndex: sim.tubeIndex.slice(),
    tubes, baffles: sim.baffles, inletCells: sim.inletCells, cells: sim.fluidCells.length,
  };
}

function loop() {
  if (!running || !sim) return;
  const start = performance.now();
  while (performance.now() - start < 150 && sim.phase !== 'done') sim.advance(sim.phase === 'flow' ? 4 : 10);
  const now = performance.now();
  const full = now - lastFull > 700 || sim.phase === 'done';
  const msg = { type: 'update', metrics: sim.metrics(), history: sim.history.slice(-150), elapsed: (now - t0) / 1000,
    cgIters: sim.cgIters, maxDiv: sim.maxDiv, Qv: sim.Qv };
  if (full) {
    lastFull = now;
    msg.fields = { phi: sim.phi.slice(), ux: sim.ux.slice(), uy: sim.uy.slice(), uz: sim.uz.slice(), phiT: sim.phiT.slice(), phase: sim.phase };
  }
  self.postMessage(msg);
  if (sim.phase === 'done') { running = false; return; }
  setTimeout(loop, 0);
}
