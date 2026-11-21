// Tide & sea (Weather style): today's tide curve with a "now" marker, high/low times and heights, and the sea
// temperature, from the Open-Meteo Marine API (free, no key).
(function () {
const U = BearWall.util;
const H = 3600e3;

const boxes = new Set();
const redraw = () => boxes.forEach(el => el.isConnected ? draw(el, el._ctx) : boxes.delete(el));
const cache = {};   // per city: { at, times: [ms], h: [m], sst: [°C] } or { at, none: true }
const keyOf = c => c.lat.toFixed(2) + ',' + c.lon.toFixed(2);
async function load(c) {
  const k = keyOf(c), old = cache[k];
  if (old && Date.now() - old.at < H) return;
  cache[k] = Object.assign({}, old, { at: Date.now() });
  try {
    const r = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${c.lat}&longitude=${c.lon}&hourly=sea_level_height_msl,sea_surface_temperature&timezone=auto&forecast_days=2`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), off = j.utc_offset_seconds || 0, hr = j.hourly || {};
    const h = hr.sea_level_height_msl || [];
    cache[k] = h.some(v => v != null)
      ? { at: Date.now(), times: hr.time.map(s => Date.parse(s + 'Z') - off * 1000), h, sst: hr.sea_surface_temperature || [] }
      : { at: Date.now(), none: true };
  } catch (e) { /* keep the last data */ }
  redraw();
}

// Highs and lows from hourly heights, refined with a parabola through each turning point.
function extremes(times, h) {
  const out = [];
  for (let i = 1; i < h.length - 1; i++) {
    const a = h[i - 1], b = h[i], c = h[i + 1];
    if (a == null || b == null || c == null) continue;
    const high = b >= a && b > c, low = b <= a && b < c;
    if (!high && !low) continue;
    const d = a - 2 * b + c, o = d ? .5 * (a - c) / d : 0;
    out.push({ high, t: times[i] + o * (times[i + 1] - times[i]), v: b - .25 * (a - c) * o });
  }
  return out;
}
(function selfTest() {
  const times = Array.from({ length: 25 }, (_, i) => i * H), h = times.map(t => Math.sin(2 * Math.PI * (t / H) / 12.42));
  const e = extremes(times, h);
  console.assert(e.length >= 3 && e[0].high && Math.abs(e[0].t / H - 3.105) < .1 && Math.abs(e[0].v - 1) < .02 && !e[1].high, 'tide extremes', e);
})();

const m = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' m';
function smooth(p) {   // Catmull-Rom as cubic Béziers
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
    d += `C${b[0] + (c[0] - a[0]) / 6} ${b[1] + (c[1] - a[1]) / 6} ${c[0] - (e[0] - b[0]) / 6} ${c[1] - (e[1] - b[1]) / 6} ${c[0]} ${c[1]}`;
  }
  return d;
}

function draw(el, ctx) {
  if (!ctx) return;
  const d = cache[keyOf(ctx.city)], rect = ctx.mode === 'rect', h24 = ctx.opts.h24;
  let html;
  if (!d || (!d.times && !d.none)) html = `<div class="msg fit">Loading tides…</div>`;
  else if (d.none) html = `<div class="msg fit">No sea data here</div>`;
  else {
    const now = ctx.now.getTime(), day = new Date(ctx.now); day.setHours(0, 0, 0, 0);
    const t0 = day.getTime(), t1 = t0 + 24 * H;
    const idx = d.times.map((t, i) => i).filter(i => d.times[i] >= t0 - H && d.times[i] <= t1 + H && d.h[i] != null);
    const all = d.h.filter(v => v != null), lo = Math.min(...all), hi = Math.max(...all), span = Math.max(hi - lo, .2);
    const X = t => (t - t0) / (24 * H) * 240, Y = v => 88 - (v - lo) / span * 72;
    const ex = extremes(d.times, d.h), today = ex.filter(e => e.t >= t0 && e.t < t1), next = ex.find(e => e.t > now);
    // height now: straight line between the two hours around it
    const j = d.times.findIndex(t => t > now), hn = j > 0 && d.h[j - 1] != null && d.h[j] != null
      ? d.h[j - 1] + (d.h[j] - d.h[j - 1]) * (now - d.times[j - 1]) / (d.times[j] - d.times[j - 1]) : null;
    const sstI = d.times.findIndex(t => t > now - H), sst = d.sst[sstI];
    const sea = sst != null ? Math.round(sst) + '°C' : '';
    const nextTxt = next ? `${next.high ? 'High' : 'Low'} ${U.fmtTime(new Date(next.t), h24)} · ${m(next.v)}` : 'No more tides today';
    const curve = idx.length > 1 ? `<path class="cv" d="${smooth(idx.map(i => [X(d.times[i]), Y(d.h[i])]))}"/>` : '';
    const mark = now >= t0 && now < t1 && hn != null ? `<line class="nw" x1="${X(now)}" x2="${X(now)}" y1="4" y2="96"/><circle class="nd" cx="${X(now)}" cy="${Y(hn)}" r="3"/>` : '';
    const svg = `<svg class="plot" viewBox="0 0 240 100" preserveAspectRatio="none">${curve}${mark}</svg>`;
    const then = next && ex.find(e => e.t > next.t);
    const thenTxt = then ? `then ${then.high ? 'High' : 'Low'} ${U.fmtTime(new Date(then.t), h24)} · ${m(then.v)}` : 'Tide & sea';
    if (rect) html = `<div class="row">${svg}<div class="tx"><div class="big fit">${nextTxt}${sea ? ' · ' + sea : ''}</div><div class="sm fit">${thenTxt}</div></div></div>`;
    else html = `<div class="sq"><div class="hd fit">Tide${sea ? ` · <b>Sea ${sea}</b>` : ''}</div>${svg}`
      + `<div class="ex">${today.map(e => `<span class="${e === next ? 'nx' : ''}"><i>${e.high ? '▲' : '▼'}</i> ${U.fmtTime(new Date(e.t), h24)}<br>${m(e.v)}</span>`).join('') || '<span>Flat today</span>'}</div></div>`;
  }
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  U.fit(el);
  if (!rect) {   // one shrink for the whole high/low row so it never wraps
    const row = el.querySelector('.ex');
    if (row) { row.style.setProperty('--fe', 1); if (row.scrollWidth > row.clientWidth + .5) row.style.setProperty('--fe', Math.max(.5, row.clientWidth / row.scrollWidth * .97)); }
  }
}

BearWall.register({
  look: ['ring', 'text', 'dim'], lookLabels: { ring: 'Line color' },
  type: 'tide',
  name: 'Tide & sea', family: 'weather', styleName: 'Tide & sea',
  size: { square: [264, 264], rect: [488, 104] },
  options: [{ key: 'h24', label: '24-hour time', type: 'switch', value: false }],
  every: 60000,
  css: `
    .w-tide .sq { display: flex; flex-direction: column; height: 100%; }
    .w-tide .hd { color: var(--w-dim); font-size: calc(var(--u) * 6.4 * var(--fit, 1)); }
    .w-tide .hd b { color: var(--w-text); }
    .w-tide .plot { display: block; width: 100%; flex: 1 1 0; min-height: 0; overflow: visible; }
    .w-tide .cv { fill: none; stroke: var(--ring); stroke-width: max(2px, calc(var(--u) * .9)); vector-effect: non-scaling-stroke;
      stroke-linecap: round; filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 2) var(--ring)); }
    .w-tide .nw { stroke: var(--w-dim); stroke-width: 2px; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
    .w-tide .nd { fill: var(--w-text); }
    .w-tide .ex { display: flex; justify-content: space-around; gap: calc(var(--u) * 2); white-space: nowrap; overflow: hidden; text-align: center;
      font-size: calc(var(--u) * 5.6 * var(--fe, 1)); color: var(--w-dim); line-height: 1.25; }
    .w-tide .ex .nx { color: var(--w-text); font-weight: 800; text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-tide .ex i { font-style: normal; color: var(--ring); }
    .w-tide .row { display: flex; align-items: center; height: 100%; gap: calc(var(--u) * 10); }
    .w-tide.right .row { flex-direction: row-reverse; }
    .w-tide .row .plot { flex: none; width: calc(var(--u) * 150); height: 80%; }
    .w-tide .row .tx { flex: 1 1 0; min-width: 0; }
    .w-tide.right .row .tx { text-align: right; }
    .w-tide .big { font-weight: 800; font-size: calc(var(--u) * 22 * var(--fit, 1)); text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-tide .sm { color: var(--w-dim); font-size: calc(var(--u) * 13 * var(--fit, 1)); margin-top: calc(var(--u) * 3); }
    .w-tide .msg { color: var(--w-dim); margin: auto; text-align: center; font-size: calc(var(--u) * 7 * var(--fit, 1)); }
    .w-tide.rect .msg { font-size: calc(var(--u) * 20 * var(--fit, 1)); }
    .w-tide > .msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }`,
  mount(el) { boxes.add(el); },
  update(el, ctx) {
    el._ctx = ctx;
    load(ctx.city);
    draw(el, ctx);
  }
});
})();
