// Hourly forecast: a smooth temperature line with icons, hours and rain chance (square), or a row of slots (rect).
(function () {
const U = BearWall.util;
const pad = n => String(n).padStart(2, '0');
const hourLabel = (t, h24, short) => {
  const h = t.getHours();
  if (h24) return short ? pad(h) : pad(h) + ':00';
  return `${(h + 11) % 12 + 1}${short ? '' : ' '}${h < 12 ? 'AM' : 'PM'}`;
};
// Catmull-Rom through the points, as cubic Béziers
function smooth(p) {
  if (p.length === 1) return `M${p[0][0] - 30} ${p[0][1]}H${p[0][0] + 30}`;
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
    d += `C${b[0] + (c[0] - a[0]) / 6} ${b[1] + (c[1] - a[1]) / 6} ${c[0] - (e[0] - b[0]) / 6} ${c[1] - (e[1] - b[1]) / 6} ${c[0]} ${c[1]}`;
  }
  return d;
}
// one font scale per row of cells, so a row shrinks together (down to 50%) instead of cell by cell
function fitCells(wrap, sel, v, room) {
  const cells = wrap.querySelectorAll(sel);
  wrap.style.setProperty(v, 1);
  let k = 1;
  cells.forEach(c => { const need = c.scrollWidth, have = room ? room() : c.clientWidth; if (need > have + .5) k = Math.min(k, have / need); });
  if (k < 1) wrap.style.setProperty(v, Math.max(.5, k * .97));
}

BearWall.register({
  type: 'hourly',
  name: 'Hourly forecast',
  size: { square: [384, 264], rect: [488, 104] },
  options: [
    { key: 'hours', label: 'Hours ahead', type: 'tabs', choices: [['6', '6 h'], ['12', '12 h']], value: '6' },
    { key: 'step', label: 'Step', type: 'tabs', choices: [['1', 'Every hour'], ['3', 'Every 3 h']], value: '1' },
    { key: 'h24', label: '24-hour time', type: 'switch', value: false },
    { key: 'rain', label: 'Rain chance', type: 'switch', value: true }
  ],
  every: 60000,
  css: `
    .w-hourly .anim { animation: none !important; }   /* many small icons: keep them still */
    .w-hourly .sq { display: flex; flex-direction: column; height: 100%; }
    .w-hourly .plot { position: relative; flex: 1 1 0; min-height: 0; }
    .w-hourly .ln { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .w-hourly .ln path { fill: none; stroke: var(--ring); stroke-width: max(2px, calc(var(--u) * .9)); vector-effect: non-scaling-stroke;
      stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 2) var(--ring)); }
    .w-hourly .dot { position: absolute; width: calc(var(--u) * 2.4); height: calc(var(--u) * 2.4); margin: calc(var(--u) * -1.2) 0 0 calc(var(--u) * -1.2);
      border-radius: 50%; background: var(--ring); box-shadow: 0 0 calc(var(--glow) * var(--u) * 3) var(--ring); }
    .w-hourly .tv { position: absolute; transform: translate(-50%, -135%); font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums;
      font-size: calc(var(--u) * 7.5 * var(--ft, 1)); text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-hourly .cols { display: flex; }
    .w-hourly .cols > span { flex: 1 1 0; min-width: 0; text-align: center; white-space: nowrap; overflow: hidden; padding: 0 calc(var(--u) * .8); }
    .w-hourly .icons { height: calc(var(--u) * 15); margin-top: calc(var(--u) * 2); }
    .w-hourly .icons .ic { height: 100%; }
    .w-hourly .rain { color: var(--i-rain); font-weight: 600; font-size: calc(var(--u) * 5 * var(--fr, 1)); min-height: 1.2em; }
    .w-hourly .hrs { color: var(--w-dim); font-size: calc(var(--u) * 6.2 * var(--fh, 1)); margin-top: calc(var(--u) * 1); }
    .w-hourly .hrs > span:first-child { color: var(--w-text); font-weight: 800; }
    .w-hourly .many .tv { font-size: calc(var(--u) * 5.6 * var(--ft, 1)); }
    .w-hourly .many .icons { height: calc(var(--u) * 10); }
    .w-hourly .many .hrs { font-size: calc(var(--u) * 5 * var(--fh, 1)); }
    .w-hourly .row { display: flex; height: 100%; }
    .w-hourly.right .row { flex-direction: row-reverse; }
    .w-hourly .slot { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--u) * 3); }
    .w-hourly .slot .ic { height: 36%; aspect-ratio: 1; flex: none; }
    .w-hourly .slot .t { font-weight: 800; line-height: 1; font-size: calc(var(--u) * 22 * var(--ft, 1)); white-space: nowrap; max-width: 100%;
      text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; font-variant-numeric: tabular-nums; }
    .w-hourly .slot .h { color: var(--w-dim); line-height: 1; font-size: calc(var(--u) * 14 * var(--fh, 1)); white-space: nowrap; max-width: 100%; }
    .w-hourly .slot:first-child .h { color: var(--w-text); font-weight: 800; }
    .w-hourly .none { color: var(--w-dim); font-size: calc(var(--u) * 7 * var(--fit, 1)); margin: auto; max-width: 100%; }`,
  mount() {},
  update(el, ctx) {
    const o = ctx.opts, step = +o.step || 1, hours = +o.hours || 6;
    const all = (ctx.weather.hourly || []).filter((_, i) => i % step === 0 && i < hours);
    const rect = ctx.mode === 'rect';
    // rect: as many slots as fit cleanly, max 6
    const slots = rect ? all.slice(0, Math.max(1, Math.min(6, Math.floor(el.offsetWidth / Math.max(1, el.offsetHeight) * 1.3)))) : all;
    const n = slots.length, short = n > 6;
    const lab = (s, i) => i === 0 ? 'Now' : hourLabel(s.time, o.h24, short);
    let html;
    if (!n) html = '<div class="sq"><div class="none fit">No forecast yet</div></div>';
    else if (rect) {
      html = `<div class="row">${slots.map((s, i) => `<div class="slot"><div class="ic">${U.iconSVG(s.cond, s.night)}</div><div class="t">${s.temp}°</div><div class="h">${lab(s, i)}</div></div>`).join('')}</div>`;
    } else {
      const ts = slots.map(s => s.temp), mid = (Math.max(...ts) + Math.min(...ts)) / 2, span = Math.max(Math.max(...ts) - Math.min(...ts), 4);
      const pts = slots.map((s, i) => [(i + .5) * 100, 56 - (s.temp - mid) / span * 52]);   // y between 30 and 82
      const at = i => `left:${(i + .5) / n * 100}%;top:${pts[i][1]}%`;
      html = `<div class="sq${short ? ' many' : ''}"><div class="plot"><svg class="ln" viewBox="0 0 ${n * 100} 100" preserveAspectRatio="none"><path d="${smooth(pts)}"/></svg>`
        + slots.map((s, i) => `<i class="dot" style="${at(i)}"></i><span class="tv" style="${at(i)}">${s.temp}°</span>`).join('') + '</div>'
        + `<div class="cols icons">${slots.map(s => `<span class="ic">${U.iconSVG(s.cond, s.night)}</span>`).join('')}</div>`
        + (o.rain ? `<div class="cols rain">${slots.map(s => `<span>${s.pop >= 30 ? s.pop + '%' : ''}</span>`).join('')}</div>` : '')
        + `<div class="cols hrs">${slots.map((s, i) => `<span>${lab(s, i)}</span>`).join('')}</div></div>`;
    }
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    const wrap = el.firstElementChild;
    if (!n) return U.fit(el);
    if (rect) { fitCells(wrap, '.t', '--ft'); fitCells(wrap, '.h', '--fh'); return; }
    const colW = () => el.querySelector('.plot').clientWidth / n * .92;
    fitCells(wrap, '.tv', '--ft', colW);
    fitCells(wrap, '.rain > span', '--fr');
    fitCells(wrap, '.hrs > span', '--fh');
  }
});
})();
