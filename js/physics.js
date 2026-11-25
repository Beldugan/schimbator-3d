// physics.js — modelul termic al schimbătorului manta–fascicul de țevi
// Modul ES pur (fără dependențe), folosit atât în browser cât și în testele Node.
//
// Convenții: fluidul CALD circulă prin MANTA, fluidul RECE prin ȚEVI (ca în Fig. 1).
// Temperaturi în °C, debite capacitive C = m·cp în W/K, U în W/(m²·K), A în m².

export const SHORT = { counter: 'Contracurent', parallel: 'Echicurent', shell12: '1–2 (TEMA E)' };

export const ARRANGEMENTS = {
  counter: 'Contracurent (1 trecere manta / 1 trecere țevi)',
  parallel: 'Echicurent (1 trecere manta / 1 trecere țevi)',
  shell12: 'TEMA E: 1 trecere manta / 2 treceri țevi',
};

/** Coeficientul global efectiv, cu rezistența de depunere Rf [m²K/W]. */
export function effectiveU(Uclean, Rf = 0) {
  return 1 / (1 / Uclean + Rf);
}

/** Eficacitatea ε în funcție de NTU, Cr și schema de curgere (relații clasice ε–NTU). */
export function effectiveness(NTU, Cr, arrangement) {
  if (NTU <= 0) return 0;
  switch (arrangement) {
    case 'parallel':
      return (1 - Math.exp(-NTU * (1 + Cr))) / (1 + Cr);
    case 'counter': {
      if (Math.abs(1 - Cr) < 1e-9) return NTU / (1 + NTU);
      const e = Math.exp(-NTU * (1 - Cr));
      return (1 - e) / (1 - Cr * e);
    }
    case 'shell12': {
      const s = Math.sqrt(1 + Cr * Cr);
      const e = Math.exp(-NTU * s);
      return 2 / (1 + Cr + s * (1 + e) / (1 - e));
    }
    default:
      throw new Error('Schemă necunoscută: ' + arrangement);
  }
}

/** Diferența medie logaritmică de temperatură. */
export function lmtd(dT1, dT2) {
  if (dT1 <= 0 || dT2 <= 0) return NaN;
  if (Math.abs(dT1 - dT2) < 1e-9) return dT1;
  return (dT1 - dT2) / Math.log(dT1 / dT2);
}

/** Factorul de corecție F pentru schimbătorul 1–2 (Bowman–Mueller–Nagle). */
export function correctionF12(Th_in, Th_out, Tc_in, Tc_out) {
  const R = (Th_in - Th_out) / (Tc_out - Tc_in);
  const P = (Tc_out - Tc_in) / (Th_in - Tc_in);
  const s = Math.sqrt(R * R + 1);
  if (Math.abs(R - 1) < 1e-6) {
    // limita pentru R = 1
    const num = (P * Math.SQRT2) / (1 - P);
    const den = Math.log((2 - P * (2 - Math.SQRT2)) / (2 - P * (2 + Math.SQRT2)));
    return num / den;
  }
  const num = (s / (R - 1)) * Math.log((1 - P) / (1 - P * R));
  const den = Math.log((2 - P * (R + 1 - s)) / (2 - P * (R + 1 + s)));
  return num / den;
}

/**
 * Calcul complet. Intrări:
 *  { Th_in, Tc_in, Ch, Cc, U, A, Rf, arrangement }
 * Ieșiri: Q, ε, NTU, Cr, temperaturi de ieșire, ΔTml, F, profile etc.
 */
export function solve(p) {
  const { Th_in, Tc_in, Ch, Cc, A, arrangement } = p;
  const U = effectiveU(p.U, p.Rf || 0);
  const UA = U * A;
  const Cmin = Math.min(Ch, Cc);
  const Cmax = Math.max(Ch, Cc);
  const Cr = Cmin / Cmax;
  const NTU = UA / Cmin;
  const eps = effectiveness(NTU, Cr, arrangement);
  const Qmax = Cmin * (Th_in - Tc_in);
  const Q = eps * Qmax;
  const Th_out = Th_in - Q / Ch;
  const Tc_out = Tc_in + Q / Cc;

  let dT1, dT2;
  if (arrangement === 'parallel') {
    dT1 = Th_in - Tc_in; dT2 = Th_out - Tc_out;
  } else {
    // contracurent sau 1–2: ΔTml se calculează pentru contracurent pur
    dT1 = Th_in - Tc_out; dT2 = Th_out - Tc_in;
  }
  const dTml = lmtd(dT1, dT2);
  const F = arrangement === 'shell12' ? correctionF12(Th_in, Th_out, Tc_in, Tc_out) : 1;
  const Q_lmtd = UA * F * dTml;

  const profile = temperatureProfile({ Th_in, Tc_in, Ch, Cc, UA, arrangement, Th_out, Tc_out });

  return { U, UA, Cmin, Cmax, Cr, NTU, eps, Qmax, Q, Th_out, Tc_out, dT1, dT2, dTml, F, Q_lmtd, profile };
}

/**
 * Profilele de temperatură de-a lungul aparatului, x ∈ [0,1].
 * x = 0 este capătul pe unde INTRĂ fluidul rece în țevi (capătul din stânga în 3D).
 * Returnează { x[], Th[], Tc[] } și, pentru 1–2, Tc1[] (trecerea 1) și Tc2[] (trecerea 2).
 */
export function temperatureProfile({ Th_in, Tc_in, Ch, Cc, UA, arrangement }, n = 101) {
  const x = Array.from({ length: n }, (_, i) => i / (n - 1));
  if (arrangement === 'shell12') return profile12({ Th_in, Tc_in, Ch, Cc, UA }, x);

  // Soluții analitice. Variabila ξ urmărește sensul fluidului cald.
  if (arrangement === 'parallel') {
    // ambele fluide de la x=0 la x=1
    const k = UA * (1 / Ch + 1 / Cc);
    const th0 = Th_in - Tc_in;
    const Th = x.map((xi) => Th_in - (UA / Ch) * th0 * (1 - Math.exp(-k * xi)) / k);
    const Tc = x.map((xi, i) => Th[i] - th0 * Math.exp(-k * xi));
    return { x, Th, Tc };
  }
  // contracurent: rece intră la x=0, cald intră la x=1. ξ = 1 - x (sensul caldului)
  const eps = effectiveness(UA / Math.min(Ch, Cc), Math.min(Ch, Cc) / Math.max(Ch, Cc), 'counter');
  const Q = eps * Math.min(Ch, Cc) * (Th_in - Tc_in);
  const Tc_out = Tc_in + Q / Cc;
  const k = UA * (1 / Ch - 1 / Cc);
  const th0 = Th_in - Tc_out; // diferența la ξ = 0 (capătul de intrare al caldului)
  const integ = (xi) => (Math.abs(k) < 1e-12 ? xi : (1 - Math.exp(-k * xi)) / k);
  const Th = x.map((xx) => Th_in - (UA / Ch) * th0 * integ(1 - xx));
  const Tc = x.map((xx, i) => Th[i] - th0 * Math.exp(-k * (1 - xx)));
  return { x, Th, Tc };
}

/**
 * Schimbătorul 1–2: manta (cald) cu o trecere, țevi (rece) cu două treceri.
 * Rece intră în trecerea 1 la x=0, se întoarce în capacul posterior (x=1) și iese prin trecerea 2 la x=0.
 * Fluidul cald intră în manta la x=1 (capătul capacului posterior) și iese la x=0.
 * Sistem liniar rezolvat prin metoda tirului (exact pentru EDO liniare) cu RK4.
 */
function profile12({ Th_in, Tc_in, Ch, Cc, UA }, xs) {
  const a = UA / 2; // fiecare trecere are jumătate din suprafață
  // variabile: [Th, t1, t2], integrare de la x=1 spre x=0 nu e comodă; integrăm de la x=0 la 1.
  // La x=0: t1 = Tc_in (cunoscut), Th = Th_out (necunoscut), t2 = Tc_out (necunoscut).
  // La x=1: Th = Th_in, t1 = t2.
  // Ecuații (x crescător): cald curge spre x descrescător  → dTh/dx = +[a(Th-t1)+a(Th-t2)]/Ch
  //                         trecerea 1 spre x crescător     → dt1/dx = +a(Th-t1)/Cc
  //                         trecerea 2 spre x descrescător  → dt2/dx = -a(Th-t2)/Cc
  const f = (y) => [
    (a * (y[0] - y[1]) + a * (y[0] - y[2])) / Ch,
    (a * (y[0] - y[1])) / Cc,
    (-a * (y[0] - y[2])) / Cc,
  ];
  const integrate = (y0, steps = 400) => {
    const out = [y0.slice()];
    let y = y0.slice();
    const h = 1 / steps;
    for (let i = 0; i < steps; i++) {
      const k1 = f(y);
      const k2 = f(y.map((v, j) => v + (h / 2) * k1[j]));
      const k3 = f(y.map((v, j) => v + (h / 2) * k2[j]));
      const k4 = f(y.map((v, j) => v + h * k3[j]));
      y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      out.push(y.slice());
    }
    return out;
  };
  // Sistem liniar în necunoscutele (Th0, t20): reziduuri r1 = Th(1)-Th_in, r2 = t1(1)-t2(1)
  const res = (Th0, t20) => {
    const tr = integrate([Th0, Tc_in, t20], 200);
    const y = tr[tr.length - 1];
    return [y[0] - Th_in, y[1] - y[2]];
  };
  const g0 = [Tc_in, Tc_in];
  const r0 = res(g0[0], g0[1]);
  const rA = res(g0[0] + 1, g0[1]);
  const rB = res(g0[0], g0[1] + 1);
  const J = [[rA[0] - r0[0], rB[0] - r0[0]], [rA[1] - r0[1], rB[1] - r0[1]]];
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  const d0 = (-r0[0] * J[1][1] + r0[1] * J[0][1]) / det;
  const d1 = (-J[0][0] * r0[1] + J[1][0] * r0[0]) / det;
  const steps = 400;
  const tr = integrate([g0[0] + d0, Tc_in, g0[1] + d1], steps);
  const pick = (xi) => {
    const fpos = xi * steps;
    const i = Math.min(steps - 1, Math.floor(fpos));
    const w = fpos - i;
    return tr[i].map((v, j) => v * (1 - w) + tr[i + 1][j] * w);
  };
  const Th = [], Tc1 = [], Tc2 = [], Tc = [];
  for (const xi of xs) {
    const y = pick(xi);
    Th.push(y[0]); Tc1.push(y[1]); Tc2.push(y[2]); Tc.push((y[1] + y[2]) / 2);
  }
  return { x: xs, Th, Tc, Tc1, Tc2, Th_out: tr[0][0], Tc_out: tr[0][2] };
}

/** Presiunea de saturație a apei, IAPWS-IF97 regiunea 4. T în °C → p în bar. */
export function psatWater(T_C) {
  const n = [0, 0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.12020824702470e5,
    -0.32325550322333e7, 0.14915108613530e2, -0.48232657361591e4, 0.40511340542057e6,
    -0.23855557567849, 0.65017534844798e3];
  const T = T_C + 273.15;
  const th = T + n[9] / (T - n[10]);
  const A = th * th + n[1] * th + n[2];
  const B = n[3] * th * th + n[4] * th + n[5];
  const C = n[6] * th * th + n[7] * th + n[8];
  const pMPa = Math.pow((2 * C) / (-B + Math.sqrt(B * B - 4 * A * C)), 4);
  return pMPa * 10;
}

/** Fluide predefinite (proprietăți medii, aproximative). */
export const FLUIDS = {
  apa: { name: 'Apă', cp: 4180, rho: 990, color: '#2a7de1' },
  ulei: { name: 'Ulei termic', cp: 2100, rho: 870, color: '#f07030' },
  glicol: { name: 'Apă–glicol 30%', cp: 3700, rho: 1030, color: '#3aa58a' },
  aer: { name: 'Aer (≈1 bar)', cp: 1007, rho: 1.2, color: '#9aa4b1' },
};

/** Aria de schimb din geometria fasciculului: N țevi, diametru exterior d [mm], lungime L [m]. */
export function bundleArea(N, d_mm, L) {
  return N * Math.PI * (d_mm / 1000) * L;
}

/** Avertizări inginerești, după afirmațiile din lucrare. */
export function warnings(p, r) {
  const w = [];
  if (p.arrangement === 'parallel' && r.Tc_out > r.Th_out - 0.5)
    w.push('Echicurent: fluidul rece se apropie de temperatura de ieșire a celui cald (limita teoretică).');
  if (p.arrangement === 'shell12' && r.F < 0.75)
    w.push(`F = ${r.F.toFixed(2)} < 0,75: schema 1–2 este ineficientă (încrucișare de temperaturi); se recomandă mai multe mantale în serie sau contracurent.`);
  if (r.Tc_out > r.Th_out && p.arrangement !== 'parallel')
    w.push('Fluidul rece iese mai cald decât iese fluidul cald: posibil doar în contracurent (sau aproape de el).');
  const meanH = (p.Th_in + r.Th_out) / 2, meanC = (p.Tc_in + r.Tc_out) / 2;
  if (meanH - meanC > 50)
    w.push(`Diferența medie manta–țevi ≈ ${(meanH - meanC).toFixed(0)} °C > 50 °C: pentru plăci tubulare fixe (BEM) este necesar compensator de dilatare sau tip U / cap mobil.`);
  if ((p.Rf || 0) > 0)
    w.push(`Depunerile reduc U de la ${p.U.toFixed(0)} la ${r.U.toFixed(0)} W/(m²·K) (−${(100 * (1 - r.U / p.U)).toFixed(0)} %).`);
  return w;
}

/**
 * Validarea afirmațiilor numerice din lucrare.
 * Fiecare test: { id, title, expected, obtained, pass, ref }.
 */
export function validatePaper() {
  const T = [];
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');

  // Scenariul Fig. 2: NTU = 1,6; Cmin/Cmax = 0,625; ulei 150 °C (cald = Cmin), apă 20 °C
  const fig2 = { Th_in: 150, Tc_in: 20, Ch: 2500, Cc: 4000, U: 1600, A: 2.5, Rf: 0 };
  const par = solve({ ...fig2, arrangement: 'parallel' });
  const cnt = solve({ ...fig2, arrangement: 'counter' });
  T.push({ id: 'fig2-par', title: 'Fig. 2a – echicurent: temperaturi de ieșire',
    expected: 'cald 76 °C, rece 66 °C', obtained: `cald ${fmt(par.Th_out)} °C, rece ${fmt(par.Tc_out)} °C`,
    pass: near(par.Th_out, 76, 0.6) && near(par.Tc_out, 66, 0.6), ref: 'Fig. 2, text' });
  T.push({ id: 'fig2-cnt', title: 'Fig. 2b – contracurent: temperaturi de ieșire',
    expected: 'rece 76 °C, cald 61 °C', obtained: `rece ${fmt(cnt.Tc_out)} °C, cald ${fmt(cnt.Th_out)} °C`,
    pass: near(cnt.Tc_out, 76, 0.6) && near(cnt.Th_out, 61, 0.6), ref: 'Fig. 2, text' });
  T.push({ id: 'cnt-better', title: 'La aceeași arie, contracurentul transferă mai multă căldură',
    expected: 'Q contracurent > Q echicurent', obtained: `${fmt(cnt.Q / 1000)} kW > ${fmt(par.Q / 1000)} kW`,
    pass: cnt.Q > par.Q, ref: 'secțiunea „Schema generală”' });
  T.push({ id: 'cross', title: 'Contracurent: caldul poate ieși sub temperatura de ieșire a recelui',
    expected: 'Th,ieș < Tc,ieș', obtained: `${fmt(cnt.Th_out)} °C < ${fmt(cnt.Tc_out)} °C`,
    pass: cnt.Th_out < cnt.Tc_out, ref: 'secțiunea „Schema generală”' });

  // Echicurent: Tc_out < Th_out pentru orice parametri
  let ok = true;
  for (let i = 0; i < 300; i++) {
    const q = { Th_in: 60 + Math.random() * 300, Tc_in: 5 + Math.random() * 50, Ch: 200 + Math.random() * 1e4,
      Cc: 200 + Math.random() * 1e4, U: 50 + Math.random() * 3000, A: 0.5 + Math.random() * 100, arrangement: 'parallel' };
    const r = solve(q);
    if (!(r.Tc_out <= r.Th_out + 1e-9)) ok = false;
  }
  T.push({ id: 'par-limit', title: 'Echicurent: recele nu depășește ieșirea caldului (300 cazuri aleatoare)',
    expected: 'Tc,ieș ≤ Th,ieș mereu', obtained: ok ? 'respectat în toate cazurile' : 'încălcat', pass: ok, ref: 'secțiunea „Schema generală”' });

  // Q = U·A·F·ΔTml echivalent cu ε–NTU
  for (const arr of ['counter', 'parallel', 'shell12']) {
    const r = solve({ ...fig2, arrangement: arr });
    const err = Math.abs(r.Q_lmtd - r.Q) / r.Q * 100;
    T.push({ id: 'lmtd-' + arr, title: `Relația Q = U·A·F·ΔTml – ${SHORT[arr]}`,
      expected: 'identică cu metoda ε–NTU', obtained: err < 1e-3 ? 'abatere < 0,001 %' : `abatere ${fmt(err, 3)} %`, pass: err < 0.05, ref: 'relația fundamentală' });
  }
  const r12 = solve({ ...fig2, arrangement: 'shell12' });
  T.push({ id: 'F', title: 'Factorul de corecție pentru 1–2 respectă F ≤ 1',
    expected: 'F ≤ 1', obtained: `F = ${fmt(r12.F, 3)}`, pass: r12.F <= 1 + 1e-9 && r12.F > 0, ref: 'relația fundamentală' });
  const pr = r12.profile;
  T.push({ id: 'ode12', title: 'Model numeric 1–2 (EDO) vs. relația analitică ε–NTU',
    expected: `Th,ieș = ${fmt(r12.Th_out, 2)} °C`, obtained: `${fmt(pr.Th_out, 2)} °C`,
    pass: near(pr.Th_out, r12.Th_out, 0.05) && near(pr.Tc_out, r12.Tc_out, 0.05), ref: 'verificare internă' });

  // Tabelul 1: presiunea de saturație în condensator
  const p30 = psatWater(30), p50 = psatWater(50);
  T.push({ id: 'psat', title: 'Tabelul 1 – condensator: psat(30…50 °C)',
    expected: '0,042–0,124 bar abs.', obtained: `${fmt(p30, 4)}–${fmt(p50, 4)} bar`,
    pass: near(p30, 0.0425, 0.0005) && near(p50, 0.1235, 0.0005), ref: 'Tabelul 1 (IAPWS-IF97)' });

  // Fixed tubesheet / plausibilitatea U pentru exemplul ulei–apă
  const Uex = 300, Aex = fig2.U * fig2.A / Uex;
  T.push({ id: 'U-range', title: 'Exemplul Fig. 2 cu U apă–ulei din intervalul [4] (110–350)',
    expected: 'arie realistă pentru manta–fascicul', obtained: `U = 300 W/(m²·K) → A = ${fmt(Aex, 1)} m² (≈ ${Math.round(Aex / bundleArea(1, 19.05, 3))} țevi Ø19,05 × 3 m)`,
    pass: Aex > 1 && Aex < 1000, ref: 'valori U [4]' });

  return T;
}
