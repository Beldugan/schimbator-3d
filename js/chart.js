// chart.js — graficul profilelor de temperatură (canvas 2D, fără dependențe)

export function drawProfile(canvas, profile, params, result, cfdProf = null) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim() || '#1f2933';
  const muted = css.getPropertyValue('--muted').trim() || '#6b7682';
  const grid = css.getPropertyValue('--grid').trim() || '#e3e7ec';
  const hot = '#e8590c', cold = '#1c7ed6';

  const pad = { l: 46, r: 14, t: 14, b: 34 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const all = [...profile.Th, ...profile.Tc, ...(profile.Tc1 || []), ...(profile.Tc2 || []), ...(cfdProf ? [...cfdProf.Th, ...cfdProf.Tc1, ...(cfdProf.Tc2 || [])].filter(Number.isFinite) : [])];
  let lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const step = niceStep(span / 5);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const X = (x) => pad.l + x * pw;
  const Y = (t) => pad.t + (1 - (t - lo) / (hi - lo)) * ph;

  g.font = '11px system-ui, sans-serif';
  g.strokeStyle = grid; g.fillStyle = muted; g.lineWidth = 1;
  for (let t = lo; t <= hi + 1e-9; t += step) {
    g.beginPath(); g.moveTo(pad.l, Y(t)); g.lineTo(W - pad.r, Y(t)); g.stroke();
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText(String(Math.round(t)), pad.l - 6, Y(t));
  }
  for (let x = 0; x <= 1.0001; x += 0.2) {
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(x.toFixed(1).replace('.', ','), X(x), H - pad.b + 6);
  }
  g.fillText('x/L  (0 = capătul de intrare al fluidului rece)', pad.l + pw / 2, H - 14);
  g.save(); g.translate(12, pad.t + ph / 2); g.rotate(-Math.PI / 2);
  g.textAlign = 'center'; g.fillText('T [°C]', 0, 0); g.restore();

  const line = (ys, color, dash = []) => {
    g.strokeStyle = color; g.lineWidth = 2.4; g.setLineDash(dash);
    g.beginPath();
    profile.x.forEach((x, i) => (i ? g.lineTo(X(x), Y(ys[i])) : g.moveTo(X(x), Y(ys[i]))));
    g.stroke(); g.setLineDash([]);
  };
  line(profile.Th, hot);
  if (profile.Tc1) {
    line(profile.Tc1, cold);
    line(profile.Tc2, cold, [6, 4]);
  } else line(profile.Tc, cold);

  // profilul CFD 3D (medii pe secțiune), ca puncte
  if (cfdProf) {
    const dots = (xs, ys, col) => {
      g.fillStyle = '#fff'; g.strokeStyle = col; g.lineWidth = 1.6;
      xs.forEach((x, i) => { if (!Number.isFinite(ys[i])) return; g.beginPath(); g.arc(X(x), Y(ys[i]), 3, 0, Math.PI * 2); g.fill(); g.stroke(); });
    };
    dots(cfdProf.x, cfdProf.Th, hot); dots(cfdProf.x, cfdProf.Tc1, cold);
    if (cfdProf.Tc2) dots(cfdProf.x, cfdProf.Tc2, cold);
  }
  // legendă
  const items = [['fluid cald (manta)', hot, []]];
  if (profile.Tc1) items.push(['rece – trecerea 1', cold, []], ['rece – trecerea 2', cold, [6, 4]]);
  else items.push(['fluid rece (țevi)', cold, []]);
  if (cfdProf) items.push(['○ CFD 3D (medii pe secțiune)', '#0f766e', [2, 2]]);
  let ly = pad.t + 6;
  g.textAlign = 'left'; g.textBaseline = 'middle';
  for (const [txt, col, dash] of items) {
    const lx = W - pad.r - 190;
    g.strokeStyle = col; g.lineWidth = 2.4; g.setLineDash(dash);
    g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 22, ly); g.stroke(); g.setLineDash([]);
    g.fillStyle = ink; g.fillText(txt, lx + 28, ly);
    ly += 16;
  }
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
