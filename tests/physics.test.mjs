// Rulare: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, effectiveness, psatWater, validatePaper, temperatureProfile } from '../js/physics.js';

const base = { Th_in: 150, Tc_in: 20, Ch: 2500, Cc: 4000, U: 1600, A: 2.5, Rf: 0 };

test('toate verificările lucrării trec', () => {
  for (const t of validatePaper()) assert.ok(t.pass, `${t.id}: ${t.title} → ${t.obtained}`);
});

test('bilanț energetic: Q cald = Q rece', () => {
  for (const arrangement of ['counter', 'parallel', 'shell12']) {
    const r = solve({ ...base, arrangement });
    assert.ok(Math.abs(base.Ch * (base.Th_in - r.Th_out) - base.Cc * (r.Tc_out - base.Tc_in)) < 1e-6);
  }
});

test('ε crește cu NTU și are limitele corecte', () => {
  assert.ok(Math.abs(effectiveness(50, 0.5, 'counter') - 1) < 1e-6);
  assert.ok(Math.abs(effectiveness(50, 1, 'parallel') - 0.5) < 1e-6);
  assert.ok(effectiveness(2, 0.5, 'counter') > effectiveness(2, 0.5, 'shell12'));
  assert.ok(effectiveness(2, 0.5, 'shell12') > effectiveness(2, 0.5, 'parallel'));
});

test('profilele analitice ating temperaturile de ieșire', () => {
  for (const arrangement of ['counter', 'parallel']) {
    const r = solve({ ...base, arrangement });
    const p = r.profile;
    const last = p.x.length - 1;
    if (arrangement === 'parallel') {
      assert.ok(Math.abs(p.Th[last] - r.Th_out) < 1e-6 && Math.abs(p.Tc[last] - r.Tc_out) < 1e-6);
    } else {
      assert.ok(Math.abs(p.Th[0] - r.Th_out) < 1e-6 && Math.abs(p.Tc[last] - r.Tc_out) < 1e-6);
      assert.ok(Math.abs(p.Tc[0] - base.Tc_in) < 1e-6 && Math.abs(p.Th[last] - base.Th_in) < 1e-6);
    }
  }
});

test('Cr = 1 în contracurent (cazul singular)', () => {
  const r = solve({ ...base, Ch: 3000, Cc: 3000, arrangement: 'counter' });
  assert.ok(Number.isFinite(r.Q) && Number.isFinite(r.profile.Th[50]));
});

test('IAPWS-IF97: punct de verificare oficial (T = 300 K → 0,00353658941 MPa)', () => {
  assert.ok(Math.abs(psatWater(300 - 273.15) - 0.0353658941) < 1e-8);
});

import { CFD3D } from '../js/cfd3d.js';

test('CFD 3D: conservarea masei și a energiei (grilă grosieră)', () => {
  const p = { Th_in: 150, Tc_in: 20, Ch: 2500, Cc: 4000, U: 1600, A: 2.5, Rf: 0, arrangement: 'counter' };
  const r = solve(p);
  const n = (T) => (T - 20) / 130;
  const s = new CFD3D({ D: 10, arrangement: 'counter', NTUh: r.UA / p.Ch, Rhc: p.Ch / p.Cc, gap: 0.05, kPor: 0.01,
    phiHot0: r.profile.Th.map(n), phiCold1_0: r.profile.Tc.map(n), phiCold2_0: r.profile.Tc.map(n), maxSteps: 30000 });
  while (s.phase !== 'done') s.advance(500);
  const m = s.metrics();
  assert.ok(s.maxDiv < 1e-9, 'câmp cu divergență nulă după proiecție');
  assert.ok(Math.abs(s.fin - s.fout) / s.fin < 1e-9, 'debit intrare = debit ieșire');
  assert.ok(Math.abs(m.balance) < 0.01, `bilanț energetic ${m.balance}`);
  assert.ok(m.phiOut > 0 && m.phiOut < 1 && m.phicOut > 0 && m.phicOut < 1);
  // CFD nu poate depăși contracurentul ideal
  const phiOut1D = n(r.Th_out);
  assert.ok(m.phiOut > phiOut1D - 0.02, `CFD ${m.phiOut} vs 1D ${phiOut1D}`);
});
