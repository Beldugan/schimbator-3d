// app.js — interfața: parametri, rezultate, grafic, validare
import { solve, warnings, validatePaper, FLUIDS, ARRANGEMENTS, SHORT, bundleArea, effectiveness } from './physics.js';
import { ExchangerScene } from './scene.js';
import { drawProfile } from './chart.js';
import { CFDView } from './cfd-view.js';

const $ = (s) => document.querySelector(s);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');

const CONTROLS = [
  { group: 'Fluid cald – manta', items: [
    { id: 'fluid_h', type: 'select', label: 'Fluid', options: FLUIDS, value: 'ulei' },
    { id: 'Th_in', label: 'Temperatura de intrare', unit: '°C', min: 30, max: 400, step: 1, value: 150 },
    { id: 'm_h', label: 'Debit masic', unit: 'kg/s', min: 0.05, max: 20, step: 0.001, value: 1.190 },
  ] },
  { group: 'Fluid rece – țevi', items: [
    { id: 'fluid_c', type: 'select', label: 'Fluid', options: FLUIDS, value: 'apa' },
    { id: 'Tc_in', label: 'Temperatura de intrare', unit: '°C', min: 0, max: 95, step: 1, value: 20 },
    { id: 'm_c', label: 'Debit masic', unit: 'kg/s', min: 0.05, max: 20, step: 0.001, value: 0.957 },
  ] },
  { group: 'Geometrie (TEMA)', items: [
    { id: 'arrangement', type: 'select', label: 'Schema de curgere', options: ARRANGEMENTS, value: 'counter' },
    { id: 'N', label: 'Număr de țevi', unit: '', min: 5, max: 1500, step: 1, value: 74 },
    { id: 'd', type: 'select', label: 'Diametru exterior țeavă', options: { 16: { name: '16 mm' }, 19.05: { name: '19,05 mm (¾")' }, 25.4: { name: '25,4 mm (1")' } }, value: '19.05' },
    { id: 'Lt', label: 'Lungimea țevilor', unit: 'm', min: 1, max: 12, step: 0.01, value: 3.01 },
  ] },
  { group: 'Transfer termic', items: [
    { id: 'U', label: 'Coeficient global U (curat)', unit: 'W/(m²·K)', min: 10, max: 6000, step: 1, value: 300,
      hint: 'apă–apă 850–1700 · condensator abur 1000–6000 · apă–ulei 110–350 · apă–aer cu aripioare 25–50 [4]' },
    { id: 'Rf', label: 'Rezistență de depunere Rf', unit: 'm²·K/W', min: 0, max: 0.002, step: 0.00005, value: 0,
      hint: 'apă de răcire tratată ≈ 0,0002 · apă de mare ≈ 0,0001–0,0002 · ulei ≈ 0,0002–0,0009' },
  ] },
];

const state = {};
let sim;

function buildControls() {
  const host = $('#controls');
  for (const grp of CONTROLS) {
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>${grp.group}</legend>`;
    for (const c of grp.items) {
      state[c.id] = c.type === 'select' ? c.value : +c.value;
      const row = document.createElement('div');
      row.className = 'ctl';
      if (c.type === 'select') {
        const opts = Object.entries(c.options).map(([k, v]) => `<option value="${k}" ${k === c.value ? 'selected' : ''}>${typeof v === 'string' ? v : v.name}</option>`).join('');
        row.innerHTML = `<label for="${c.id}">${c.label}</label><select id="${c.id}">${opts}</select>`;
        row.querySelector('select').addEventListener('change', (e) => { state[c.id] = e.target.value; recompute(); });
      } else {
        row.innerHTML = `<label for="${c.id}">${c.label}${c.unit ? ` <span class="unit">[${c.unit}]</span>` : ''}</label>
          <div class="pair"><input type="range" id="${c.id}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}">
          <input type="number" id="${c.id}_n" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"></div>
          ${c.hint ? `<small class="hint">${c.hint}</small>` : ''}`;
        const r = row.querySelector('input[type=range]'), n = row.querySelector('input[type=number]');
        r.addEventListener('input', () => { n.value = r.value; state[c.id] = +r.value; recompute(); });
        n.addEventListener('change', () => {
          const v = Math.min(c.max, Math.max(c.min, +n.value)); n.value = v; r.value = v; state[c.id] = v; recompute();
        });
      }
      fs.appendChild(row);
    }
    host.appendChild(fs);
  }
}

function setValue(id, v) {
  state[id] = typeof v === 'string' ? v : +v;
  const el = document.getElementById(id);
  if (el) el.value = v;
  const n = document.getElementById(id + '_n');
  if (n) n.value = v;
}

function currentParams() {
  const ch = FLUIDS[state.fluid_h].cp, cc = FLUIDS[state.fluid_c].cp;
  const A = bundleArea(state.N, +state.d, state.Lt);
  return {
    arrangement: state.arrangement, Th_in: state.Th_in, Tc_in: state.Tc_in,
    m_h: state.m_h, m_c: state.m_c, cp_h: ch, cp_c: cc,
    Ch: state.m_h * ch, Cc: state.m_c * cc, U: state.U, Rf: state.Rf, A,
  };
}

function recompute() {
  const p = currentParams();
  if (p.Th_in <= p.Tc_in) {
    $('#warnings').innerHTML = '<li class="err">Temperatura de intrare a fluidului cald trebuie să fie mai mare decât a celui rece.</li>';
    return;
  }
  const r = solve(p);
  sim.update(p, r);
  renderResults(p, r);
  cfdCheckStale(p);
  drawProfile($('#chart'), r.profile, p, r, cfd.profile && !cfd.stale ? cfd.profile : null);
  updateLegend();
}

function renderResults(p, r) {
  const rows = [
    ['Putere termică Q', `${fmt(r.Q / 1000, 1)} kW`],
    ['Eficacitate ε', fmt(r.eps, 3)],
    ['NTU = UA/Cmin', fmt(r.NTU, 2)],
    ['Cr = Cmin/Cmax', fmt(r.Cr, 3)],
    ['Ieșire cald / rece', `${fmt(r.Th_out)} / ${fmt(r.Tc_out)} °C`],
    [p.arrangement === 'parallel' ? 'ΔTml (echicurent)' : p.arrangement === 'shell12' ? 'ΔTml (contracurent pur)' : 'ΔTml', `${fmt(r.dTml)} K`],
    ['Factor F', fmt(r.F, 3)],
    ['Arie A', `${fmt(p.A, 2)} m²`],
    ['U efectiv (cu depuneri)', `${fmt(r.U, 0)} W/(m²·K)`],
    ['Verificare U·A·F·ΔTml', `${fmt(r.Q_lmtd / 1000, 1)} kW`],
  ];
  $('#results').innerHTML = rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('');

  // comparația schemelor pentru aceiași parametri
  const cmp = Object.keys(ARRANGEMENTS).map((a) => {
    const q = solve({ ...p, arrangement: a });
    return { a, Q: q.Q, eps: q.eps };
  });
  const qmax = Math.max(...cmp.map((c) => c.Q));
  $('#compare').innerHTML = cmp.map((c) => `
    <div class="bar ${c.a === p.arrangement ? 'on' : ''}">
      <span>${SHORT[c.a]}</span>
      <div class="track"><div class="fill" style="width:${(100 * c.Q / qmax).toFixed(1)}%"></div></div>
      <b>${fmt(c.Q / 1000, 1)} kW</b></div>`).join('');

  const w = warnings(p, r);
  $('#warnings').innerHTML = w.length ? w.map((x) => `<li>${x}</li>`).join('') : '<li class="ok">Fără observații pentru parametrii actuali.</li>';
  $('#legendLo').textContent = `${fmt(Math.min(p.Tc_in, p.Th_in), 0)} °C`;
  $('#legendHi').textContent = `${fmt(Math.max(p.Tc_in, p.Th_in), 0)} °C`;
}

function renderValidation() {
  const tests = validatePaper();
  const passed = tests.filter((t) => t.pass).length;
  $('#valSummary').innerHTML = `<b>${passed} / ${tests.length}</b> verificări confirmate`;
  $('#valSummary').className = 'summary ' + (passed === tests.length ? 'ok' : 'err');
  $('#valTable tbody').innerHTML = tests.map((t) => `
    <tr class="${t.pass ? 'ok' : 'err'}">
      <td class="st">${t.pass ? '✓' : '✗'}</td>
      <td>${t.title}<br><small>${t.ref}</small></td>
      <td>${t.expected}</td><td>${t.obtained}</td></tr>`).join('');
}

function loadFig2() {
  // Ch = 1,190 · 2100 ≈ 2500 W/K ; Cc = 0,957 · 4180 ≈ 4000 W/K ; UA ≈ 300 · 13,33 ≈ 4000 W/K → NTU = 1,6
  setValue('fluid_h', 'ulei'); setValue('fluid_c', 'apa');
  setValue('Th_in', 150); setValue('Tc_in', 20);
  setValue('m_h', 1.190); setValue('m_c', 0.957);
  setValue('N', 74); setValue('d', '19.05'); setValue('Lt', 3.01);
  setValue('U', 300); setValue('Rf', 0);
  recompute();
}

function initTabs() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === b.dataset.tab));
    if (b.dataset.tab === 'tab-sim') recompute();
  }));
}

function init() {
  buildControls();
  sim = new ExchangerScene($('#viewport'));
  initTabs();
  $('#btnFig2').addEventListener('click', loadFig2);
  $('#btnPlay').addEventListener('click', (e) => { sim.running = !sim.running; e.target.textContent = sim.running ? '⏸ Pauză' : '▶ Pornește'; });
  $('#btnCut').addEventListener('click', (e) => { const on = !sim.shellCut.visible; sim.setCutaway(on); e.target.textContent = on ? 'Manta transparentă' : 'Secțiune'; });
  $('#btnParticles').addEventListener('click', (e) => { sim.setParticles(!sim.showParticles); e.target.classList.toggle('off', !sim.showParticles); });
  $('#btnView').addEventListener('click', () => sim.resetView());
  $('#speed').addEventListener('input', (e) => { sim.speed = +e.target.value; });
  $('#btnRunVal').addEventListener('click', renderValidation);
  initCFD();
  $('#btnValFig2').addEventListener('click', () => { loadFig2(); document.querySelector('[data-tab=tab-sim]').click(); });
  window.addEventListener('resize', () => recompute());
  recompute();
  renderValidation();
  window.__app = { state, sim, recompute, setValue, solve, effectiveness, cfd };
}


// ---------------------------------------------------------------------------
// Analiza CFD 3D
// ---------------------------------------------------------------------------
const cfd = { worker: null, running: false, paused: false, params: null, result: null, meta: null, metrics: null,
  history: [], stale: false, profile: null, key: null, elapsed: 0 };

/** Diametrul mantalei estimat din numărul de țevi (corelația fasciculului, pas triunghiular 1,25·d). */
function shellDiameter(N, d_mm, passes) {
  const [K1, n1] = passes === 2 ? [0.249, 2.207] : [0.319, 2.142];
  const Db = (d_mm / 1000) * Math.pow(N / K1, 1 / n1);
  return Db * 1.04 + 0.012; // joc fascicul–manta tipic
}

const paramKey = (p) => JSON.stringify([p.arrangement, p.Th_in, p.Tc_in, p.Ch, p.Cc, p.U, p.Rf, p.A]);

function initCFD() {
  $('#cfdGap').addEventListener('input', (e) => { $('#cfdGapV').textContent = `${fmt(e.target.value * 100, 1)} %`; });
  $('#cfdK').addEventListener('input', (e) => { $('#cfdKV').textContent = fmt(+e.target.value, 3); });
  $('#cfdStart').addEventListener('click', cfdStart);
  $('#cfdPause').addEventListener('click', cfdPause);
  $('#cfdStop').addEventListener('click', () => cfdStop('Analiza a fost oprită.'));
  $('#btnCFD').addEventListener('click', () => {
    const panel = $('#cfdPanel');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.classList.remove('flash'); void panel.offsetWidth; panel.classList.add('flash');
    if (!cfd.running) cfdStart();
  });
  document.querySelectorAll('#cfdViewOpts .seg button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#cfdViewOpts .seg button').forEach((x) => x.classList.toggle('on', x === b));
    if (sim.cfdView) { sim.cfdView.opts.field = b.dataset.field; sim.cfdView.applyOptions(); }
    updateLegend();
  }));
  const bind = (id, key, isRange) => $(id).addEventListener('input', (e) => {
    if (!sim.cfdView) return;
    sim.cfdView.opts[key] = isRange ? +e.target.value : e.target.checked;
    sim.cfdView.applyOptions();
  });
  bind('#cfdLongi', 'longi'); bind('#cfdTrans', 'trans'); bind('#cfdTransX', 'transX', true);
  bind('#cfdTubes', 'tubes'); bind('#cfdStream', 'stream');
  $('#cfdShow').addEventListener('input', (e) => { if (sim.cfdView) sim.cfdView.setVisible(e.target.checked && !cfd.stale); updateLegend(); });
  $('#cfdPNG').addEventListener('click', () => download('analiza-cfd-3d.png', sim.renderer.domElement.toDataURL('image/png')));
  $('#cfdCSV').addEventListener('click', exportCSV);
}

function cfdStart() {
  const p = currentParams();
  if (p.Th_in <= p.Tc_in) return;
  if (cfd.worker) cfd.worker.terminate();
  const r = solve(p);
  const n = (T) => (T - p.Tc_in) / (p.Th_in - p.Tc_in);
  const cfg = {
    D: +$('#cfdRes').value, arrangement: p.arrangement, NTUh: r.UA / p.Ch, Rhc: p.Ch / p.Cc,
    gap: +$('#cfdGap').value, kPor: +$('#cfdK').value,
    phiHot0: r.profile.Th.map(n), phiCold1_0: (r.profile.Tc1 || r.profile.Tc).map(n), phiCold2_0: (r.profile.Tc2 || r.profile.Tc).map(n),
  };
  const Ds = shellDiameter(state.N, +state.d, p.arrangement === 'shell12' ? 2 : 1);
  Object.assign(cfd, { params: { ...p, rho_h: FLUIDS[state.fluid_h].rho, Ds }, result: r, meta: null, metrics: null, history: [],
    stale: false, profile: null, key: paramKey(p), running: true, paused: false, cfg });
  cfd.worker = new Worker(new URL('./cfd-worker.js', import.meta.url), { type: 'module' });
  cfd.worker.onmessage = onCFDMessage;
  cfd.worker.onerror = (e) => { setStatus(`Eroare în solverul CFD: ${e.message}`); cfdButtons(); };
  cfd.worker.postMessage({ cmd: 'start', cfg });
  setStatus('Se generează rețeaua de calcul 3D…');
  $('#cfdResults').innerHTML = '';
  cfdButtons();
}

function cfdPause() {
  if (!cfd.worker) return;
  cfd.paused = !cfd.paused;
  cfd.worker.postMessage({ cmd: cfd.paused ? 'pause' : 'resume' });
  $('#cfdPause').textContent = cfd.paused ? 'Continuă' : 'Pauză';
}

function cfdStop(msg) {
  if (cfd.worker) { cfd.worker.terminate(); cfd.worker = null; }
  cfd.running = false; cfd.paused = false;
  if (msg) setStatus(msg);
  cfdButtons();
}

function cfdButtons() {
  $('#cfdStart').textContent = cfd.meta || cfd.stale ? 'Repornește' : 'Pornește';
  $('#cfdPause').disabled = !cfd.running;
  $('#cfdStop').disabled = !cfd.running;
  $('#cfdPause').textContent = cfd.paused ? 'Continuă' : 'Pauză';
  $('#btnCFD').textContent = cfd.running ? '◼ CFD în lucru…' : '▶ Analiză CFD 3D';
}

function cfdCheckStale(p) {
  if (!cfd.key || cfd.stale) return;
  if (paramKey(p) !== cfd.key) {
    cfd.stale = true;
    cfdStop();
    if (sim.cfdView) sim.cfdView.setVisible(false);
    setStatus('⚠ Parametrii s-au modificat: rezultatele CFD nu mai corespund. Apăsați „Repornește”.');
    $('#cfdResults').innerHTML = '';
    updateLegend();
    cfdButtons();
  }
}

function onCFDMessage(e) {
  const m = e.data;
  if (m.type === 'meta') {
    cfd.meta = m.meta;
    if (!sim.cfdView) sim.cfdView = new CFDView(sim);
    sim.cfdView.setMeta(m.meta);
    sim.cfdView.opts.field = document.querySelector('#cfdViewOpts .seg button.on').dataset.field;
    ['longi', 'trans', 'tubes', 'stream'].forEach((k) => (sim.cfdView.opts[k] = $('#cfd' + k[0].toUpperCase() + k.slice(1)).checked));
    sim.cfdView.opts.transX = +$('#cfdTransX').value;
    sim.cfdView.applyOptions();
    $('#cfdViewOpts').hidden = false;
    setStatus(`Rețea: ${m.meta.Nx} × ${m.meta.Ny} × ${m.meta.Nz} (${m.meta.cells.toLocaleString('ro-RO')} celule fluide, ${m.meta.tubes.length} canale de țevi). Se calculează curgerea…`);
    return;
  }
  if (m.type !== 'update' || cfd.stale) return;
  cfd.metrics = m.metrics; cfd.history = m.history; cfd.elapsed = m.elapsed; cfd.cg = m.cgIters; cfd.maxDiv = m.maxDiv;
  if (m.fields) {
    cfd.fields = m.fields;
    sim.cfdView.setFields(m.fields, cfd.params, { Qv: m.Qv });
    if (!sim.cfdView.group.visible && $('#cfdShow').checked) sim.cfdView.setVisible(true);
    if (m.metrics.phase !== 'flow') cfd.profile = axialProfile(m.fields);
    updateLegend();
  }
  if (m.metrics.phase !== 'flow' && sim.cfdView?.group.visible) {
    const dT = cfd.params.Th_in - cfd.params.Tc_in;
    sim.labels.hotOut.userData.set(`Cald ieșire ${fmt(cfd.params.Tc_in + dT * m.metrics.phiOut)} °C (CFD)`);
    sim.labels.coldOut.userData.set(`Rece ieșire ${fmt(cfd.params.Tc_in + dT * m.metrics.phicOut)} °C (CFD)`);
  }
  if (m.metrics.phase === 'done') { cfd.running = false; cfdButtons(); recomputeChartOnly(); }
  renderCFD();
}

function recomputeChartOnly() {
  if (!cfd.result) return;
  drawProfile($('#chart'), cfd.result.profile, cfd.params, cfd.result, cfd.profile);
}

function axialProfile(f) {
  // medii pe secțiune: fluidul cald (ponderat cu volumul) și canalele de țevi pe treceri
  const { Nx, Ny, Nz, type, tubes } = cfd.meta;
  const p = cfd.params, dT = p.Th_in - p.Tc_in;
  const xs = [], Th = [], Tc1 = [], Tc2 = [];
  for (let x = 1; x < Nx - 1; x += 2) {
    let s = 0, n = 0;
    for (let z = 0; z < Nz; z++) for (let y = 0; y < Ny; y++) {
      const k = x + Nx * (y + Ny * z);
      if (type[k] === 0) { s += f.phi[k]; n++; }
    }
    if (!n) continue;
    let a1 = 0, n1 = 0, a2 = 0, n2 = 0;
    tubes.forEach((t, j) => { const v = f.phiT[j * Nx + x]; if (t[2] === 1) { a1 += v; n1++; } else { a2 += v; n2++; } });
    xs.push((x - 0.5) / (Nx - 2));
    Th.push(p.Tc_in + dT * s / n);
    Tc1.push(p.Tc_in + dT * a1 / Math.max(1, n1));
    Tc2.push(n2 ? p.Tc_in + dT * a2 / n2 : NaN);
  }
  return { x: xs, Th, Tc1, Tc2: Tc2.some((v) => !Number.isNaN(v)) ? Tc2 : null };
}

function setStatus(t) { $('#cfdStatus').innerHTML = t; }

function renderCFD() {
  const m = cfd.metrics, p = cfd.params, r = cfd.result;
  if (!m || !p) return;
  const dT = p.Th_in - p.Tc_in;
  let prog;
  if (m.phase === 'flow') prog = 0.05 + 0.45 * Math.min(1, Math.log10(1 / Math.max(m.flowRes, 1e-6)) / Math.log10(1 / 1.5e-4));
  else if (m.phase === 'thermal') prog = 0.5 + 0.48 * Math.min(1, Math.max(0, Math.log10(0.05 / Math.max(m.thermalRes, 1e-6)) / Math.log10(0.05 / 1e-4)));
  else prog = 1;
  $('#cfdBar').style.width = `${(100 * Math.max(0.02, prog)).toFixed(0)}%`;
  const phaseTxt = { flow: 'Etapa 1/2 – câmpul de curgere (Lattice-Boltzmann D3Q19)', thermal: 'Etapa 2/2 – transfer termic manta ↔ țevi', done: '✓ Convergență atinsă' }[m.phase];
  const res = m.phase === 'flow' ? `reziduu viteze ${m.flowRes.toExponential(1)}` : `variație temperaturi ${Math.max(0, m.thermalRes).toExponential(1)}`;
  setStatus(`<b>${phaseTxt}</b><br>pas ${m.step.toLocaleString('ro-RO')} · ${res} · ${fmt(cfd.elapsed, 0)} s`);

  if (m.phase === 'flow') {
    $('#cfdResults').innerHTML = `<div class="cfdnote">Se stabilește câmpul de viteze în manta (curgerea în jurul șicanelor, prin fereastră și prin jocul fascicul–manta). Temperaturile apar în etapa a doua.</div>`;
    return;
  }
  const ThC = p.Tc_in + dT * m.phiOut, TcC = p.Tc_in + dT * m.phicOut;
  const QC = p.Ch * (p.Th_in - ThC);
  const epsC = QC / (Math.min(p.Ch, p.Cc) * dT);
  const d = (a, b, u = '') => `${a >= b ? '+' : ''}${fmt(a - b, 1)}${u}`;
  const ratio = QC / r.Q;
  const v = sim.cfdView;
  const vMean = v ? v.uMean * v.vScale : NaN;
  $('#cfdResults').innerHTML = `
    <table class="cfdtable">
      <tr><th>Mărime</th><th>CFD 3D</th><th>Model 1D</th><th>Dif.</th></tr>
      <tr><td>Ieșire fluid cald</td><td>${fmt(ThC)} °C</td><td>${fmt(r.Th_out)} °C</td><td>${d(ThC, r.Th_out)}</td></tr>
      <tr><td>Ieșire fluid rece</td><td>${fmt(TcC)} °C</td><td>${fmt(r.Tc_out)} °C</td><td>${d(TcC, r.Tc_out)}</td></tr>
      <tr><td>Putere Q</td><td>${fmt(QC / 1000)} kW</td><td>${fmt(r.Q / 1000)} kW</td><td>${d(100 * ratio, 100, ' %')}</td></tr>
      <tr><td>Eficacitate ε</td><td>${fmt(epsC, 3)}</td><td>${fmt(r.eps, 3)}</td><td></td></tr>
    </table>
    <table class="cfdtable">
      <tr><th>Indicator CFD</th><th></th></tr>
      <tr><td>Bilanț energetic manta ↔ țevi</td><td>${fmt(100 * m.balance, 2)} %</td></tr>
      <tr><td>Debit prin jocul fascicul–manta (bypass)</td><td>${fmt(100 * m.bypass, 1)} %</td></tr>
      <tr><td>Zone moarte în fascicul (v &lt; 10 % din medie)</td><td>${fmt(100 * m.dead, 1)} %</td></tr>
      <tr><td>Viteză max. în fereastră / medie fascicul</td><td>${fmt(m.windowRatio, 1)} ×</td></tr>
      <tr><td>Viteză medie în manta (Dₘ ≈ ${fmt(p.Ds, 2)} m)</td><td>${fmt(vMean, 3)} m/s</td></tr>
      <tr><td>Neuniformitate ieșire țevi (max − min)</td><td>${fmt(m.tubeSpread * dT, 1)} K</td></tr>
      <tr><td>Celule / iterații Poisson / div. max</td><td>${m.cells.toLocaleString('ro-RO')} / ${cfd.cg ?? '—'} / ${cfd.maxDiv ? cfd.maxDiv.toExponential(0) : '—'}</td></tr>
    </table>
    ${m.phase === 'done' ? `<div class="cfdnote">${interpret(ratio, m)}</div>` : ''}`;
  $('#cfdConv').hidden = false;
  $('#cfdExport').hidden = false;
  drawConv();
}

function interpret(ratio, m) {
  const dq = (1 - ratio) * 100;
  const dir = dq >= 0 ? `cu ${fmt(dq, 1)} % mai mică decât` : `cu ${fmt(-dq, 1)} % mai mare decât`;
  return `Puterea obținută prin CFD este ${dir} cea din modelul 1D (ε–NTU). Modelul 1D presupune curgere ideală prin manta; ` +
    `CFD arată că ${fmt(100 * m.bypass, 0)} % din debit ocolește fasciculul prin jocul față de manta, iar ${fmt(100 * m.dead, 0)} % din volumul fasciculului ` +
    `este zonă moartă (în spatele șicanelor). ${Math.abs(dq) < 6 ? 'Abaterea mică confirmă relațiile și valorile folosite în lucrare.' : 'Abaterea mare indică faptul că geometria șicanelor și jocurile influențează semnificativ performanța (vezi metoda Bell–Delaware).'}`;
}

function drawConv() {
  const c = $('#cfdConv');
  const h = cfd.history.filter((x) => Number.isFinite(x.phiOut));
  const W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (h.length < 2) return;
  const p = cfd.params, dT = p.Th_in - p.Tc_in;
  const ys = h.map((x) => p.Tc_in + dT * x.phiOut);
  const ref = cfd.result.Th_out;
  let lo = Math.min(...ys, ref), hi = Math.max(...ys, ref); const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
  const X = (i) => 34 + (i / (h.length - 1)) * (W - 40), Y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 24);
  g.font = '10px system-ui'; g.fillStyle = '#64748b';
  g.fillText('Th,ieș CFD pe parcursul iterațiilor', 34, H - 3);
  g.fillText(fmt(hi, 0), 2, 12); g.fillText(fmt(lo, 0), 2, H - 16);
  g.strokeStyle = '#94a3b8'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(34, Y(ref)); g.lineTo(W - 6, Y(ref)); g.stroke(); g.setLineDash([]);
  g.fillText('1D', W - 20, Y(ref) - 3);
  g.strokeStyle = '#0f766e'; g.lineWidth = 2; g.beginPath();
  ys.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
}

function updateLegend() {
  const p = currentParams();
  const v = sim.cfdView;
  if (v && v.group.visible && v.opts.field === 'V' && v.uRef) {
    $('#legendLo').textContent = '0 m/s';
    $('#legendHi').textContent = `${fmt(v.uRef * v.vScale, 2)} m/s`;
  } else {
    $('#legendLo').textContent = `${fmt(Math.min(p.Tc_in, p.Th_in), 0)} °C`;
    $('#legendHi').textContent = `${fmt(Math.max(p.Tc_in, p.Th_in), 0)} °C`;
  }
}

function download(name, url) {
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

function exportCSV() {
  const m = cfd.metrics, p = cfd.params, r = cfd.result;
  if (!m || !p) return;
  const dT = p.Th_in - p.Tc_in, ThC = p.Tc_in + dT * m.phiOut, TcC = p.Tc_in + dT * m.phicOut, QC = p.Ch * (p.Th_in - ThC);
  const rows = [
    ['Analiza CFD 3D - schimbator manta-fascicul de tevi'], [],
    ['Schema', p.arrangement], ['Th_in [C]', p.Th_in], ['Tc_in [C]', p.Tc_in], ['m_h [kg/s]', p.m_h], ['m_c [kg/s]', p.m_c],
    ['U [W/m2K]', p.U], ['Rf [m2K/W]', p.Rf], ['A [m2]', p.A.toFixed(3)],
    ['Retea', `${cfd.meta.Nx}x${cfd.meta.Ny}x${cfd.meta.Nz}`], ['Joc fascicul-manta', cfd.cfg.gap], ['Rezistenta fascicul', cfd.cfg.kPor], [],
    ['Marime', 'CFD 3D', 'Model 1D'],
    ['Th_out [C]', ThC.toFixed(2), r.Th_out.toFixed(2)], ['Tc_out [C]', TcC.toFixed(2), r.Tc_out.toFixed(2)],
    ['Q [kW]', (QC / 1000).toFixed(2), (r.Q / 1000).toFixed(2)], [],
    ['Bilant energetic [%]', (100 * m.balance).toFixed(3)], ['Bypass [%]', (100 * m.bypass).toFixed(2)],
    ['Zone moarte [%]', (100 * m.dead).toFixed(2)], ['Viteza fereastra/medie', m.windowRatio.toFixed(2)],
    ['Neuniformitate iesire tevi [K]', (m.tubeSpread * dT).toFixed(2)], [],
    ['Profil axial CFD'], ['x/L', 'T cald mediu [C]', 'T teava trecerea 1 [C]', 'T teava trecerea 2 [C]'],
  ];
  const pr = cfd.profile;
  if (pr) pr.x.forEach((x, i) => rows.push([x.toFixed(4), pr.Th[i].toFixed(2), pr.Tc1[i].toFixed(2), pr.Tc2 ? pr.Tc2[i].toFixed(2) : '']));
  const csv = rows.map((r) => r.join(';')).join('\n');
  download('analiza-cfd-3d.csv', URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })));
}

init();
