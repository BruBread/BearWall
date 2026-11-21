// Storm (Weather style): the PAR map with "No storms in PAR" normally; the storm's track when a tropical cyclone is inside or heading into PAR (the Philippine Area of
// Responsibility). Map of PAR, the Philippines, the storm's track and forecast cone, from GDACS (free, no key).
// PAGASA local names and signal numbers have no API; they need the Phase 1 projector server, so 'signal: n/a' for now.
(function () {
const U = BearWall.util;
// official PAR corners [lon, lat]
const PAR = [[115, 5], [115, 15], [120, 21], [120, 25], [135, 25], [135, 5]];
// low-poly Philippines (lon, lat), good enough at this scale
const PH = [
  [[120, 18.5], [121.2, 18.6], [122.2, 18.5], [122.3, 17.3], [122.5, 16.3], [121.6, 15.7], [121.6, 14.5], [122, 14], [123, 13.8], [124.1, 13], [124, 12.6], [123.3, 12.9], [122.6, 13.3], [121.8, 13.9], [120.9, 13.8], [120.6, 14.4], [120.9, 14.7], [120.5, 14.9], [120, 15.6], [120.3, 16.2], [120.4, 17], [120.5, 17.7]],
  [[120.6, 13.5], [121.4, 13.4], [121.5, 12.6], [121.1, 12.2], [120.7, 12.6], [120.4, 13.2]],
  [[117.2, 8.3], [117.8, 8.8], [118.7, 9.7], [119.4, 10.5], [119.6, 11.3], [119.3, 11.4], [118.4, 10.2], [117.5, 9.1]],
  [[121.9, 11.9], [122.6, 11.6], [123.1, 11.2], [122.7, 10.7], [122, 10.5], [121.9, 11.2]],
  [[122.9, 10.9], [123.5, 10.9], [123.3, 9.6], [123.1, 9.1], [122.6, 9.4], [122.4, 10], [122.9, 10.5]],
  [[123.9, 11.2], [124.1, 10.6], [123.4, 9.5], [123.3, 9.9], [123.7, 10.8]],
  [[123.8, 10.1], [124.5, 10.1], [124.6, 9.7], [124, 9.6]],
  [[124.3, 11.5], [125, 11.3], [125.2, 10.3], [124.8, 10], [124.6, 10.6], [124.4, 10.9]],
  [[124.3, 12.6], [125.2, 12.5], [125.7, 11.6], [125.6, 11.1], [125, 11.3], [124.4, 11.6]],
  [[121.9, 7], [122.2, 7.8], [122.7, 8], [123.4, 8.6], [124, 8.5], [124.8, 9], [125.5, 9.8], [126.1, 9.3], [126.6, 7.6], [126.2, 6.3], [125.4, 5.6], [125.2, 6.8], [124.2, 6.4], [123.6, 7.8], [122.8, 7.4]]
];
function inside(poly, [x, y]) {   // ray casting
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
console.assert(inside(PAR, [125, 12]) && !inside(PAR, [116, 20]) && !inside(PAR, [80, 15]) && inside(PAR, [117, 10]), 'PAR test');

// a cone around a forecast path that widens with time
function cone(path) {
  const L = [], R = [];
  path.forEach((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, r = .3 + i * .55;
    L.push([p[0] - dy / len * r, p[1] + dx / len * r]); R.push([p[0] + dy / len * r, p[1] - dx / len * r]);
  });
  return [L.concat(R.reverse())];
}
const SAMPLE = { sample: true, name: 'Typhoon (sample)', local: 'Bagyong Ada', wind: 150, pos: [128.6, 12.4],
  past: [[[134.2, 10.4], [132.4, 11], [130.5, 11.7], [128.6, 12.4]]], future: [[[128.6, 12.4], [126.6, 13.2], [124.6, 14.1], [122.6, 15.1], [120.6, 16.2]]] };
SAMPLE.cone = cone(SAMPLE.future[0]);

const boxes = new Set();
const redraw = () => boxes.forEach(el => el.isConnected ? draw(el, el._ctx) : boxes.delete(el));
let storm = null, listAt = 0, okAt = 0;
const geoCache = {};
async function load() {
  if (Date.now() - listAt < 30 * 60e3) return;
  listAt = Date.now();
  try {
    const r = await fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const list = (await r.json()).features || [];
    okAt = Date.now();
    // current storms whose centre or extent touches PAR
    const f = list.find(f => String(f.properties.iscurrent).toLowerCase() === 'true' && (inside(PAR, f.geometry.coordinates)
      || (f.bbox && f.bbox[2] >= 115 && f.bbox[0] <= 135 && f.bbox[3] >= 5 && f.bbox[1] <= 25)));
    if (!f) { storm = null; return redraw(); }
    const p = f.properties, gk = p.eventid + '-' + p.episodeid;
    if (!geoCache[gk]) {
      const g = await (await fetch(p.url.geometry)).json();
      const feats = g.features || [];
      geoCache[gk] = {
        past: feats.filter(x => x.geometry.type === 'LineString').map(x => x.geometry.coordinates),
        cone: feats.filter(x => x.geometry.type === 'Polygon' && x.properties.Class === 'Poly_Green').map(x => x.geometry.coordinates[0])
      };
    }
    const sev = p.severitydata || {};
    storm = Object.assign({ name: p.name || p.eventname, local: '', wind: Math.round(sev.severity || 0), pos: f.geometry.coordinates, future: [] }, geoCache[gk]);
  } catch (e) { /* offline or blocked: keep the last result */ }
  redraw();
}

// map: lon 112..138, lat 3..27 -> 260 x 240 view units
const P = ([lon, lat]) => `${((lon - 112) * 10).toFixed(1)},${((27 - lat) * 10).toFixed(1)}`;
const poly = ring => ring.map(P).join(' ');
function draw(el, ctx) {
  if (!ctx) return;
  const s = storm || ((ctx.opts.sample || ctx.weather.live === false) ? SAMPLE : { calm: true, name: 'No storms in PAR', past: [], cone: [] });
  const c = ctx.city, rect = ctx.mode === 'rect';
  const map = `<svg class="map" viewBox="0 0 260 240" preserveAspectRatio="xMidYMid meet">`
    + `<polygon class="par" points="${poly(PAR)}"/>`
    + PH.map(r => `<polygon class="ph" points="${poly(r)}"/>`).join('')
    + (s.cone || []).map(r => `<polygon class="cone" points="${poly(r)}"/>`).join('')
    + (s.past || []).map(l => `<polyline class="trk" points="${poly(l)}"/>`).join('')
    + (s.future || []).map(l => `<polyline class="fut" points="${poly(l)}"/>`).join('')
    + `<circle class="me" cx="${P([c.lon, c.lat]).split(',')[0]}" cy="${P([c.lon, c.lat]).split(',')[1]}" r="3"/>`
    + (s.pos ? `<g transform="translate(${P(s.pos).replace(',', ' ')})"><g class="eye"><path d="M0 -9a9 9 0 0 1 9 9M0 9a9 9 0 0 1 -9 -9"/><circle r="3.2"/></g></g>` : '') + '</svg>';
  const title = U.esc(s.name), sub = s.calm ? U.esc(okAt ? `GDACS · checked ${U.ago(okAt)}` : 'Waiting for GDACS')
    : [s.local, s.wind ? s.wind + ' km/h' : '', 'signal: n/a'].filter(Boolean).map(U.esc).join(' · ');
  const tag = s.sample ? '<b class="tag">SAMPLE</b>' : '';
  const html = rect
    ? `<div class="row">${map}<div class="tx"><div class="big fit">${tag}${title}</div><div class="sm fit">${sub}</div></div></div>`
    : `<div class="sq">${map}<div class="big fit">${tag}${title}</div><div class="sm fit">${sub}</div></div>`;
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  U.fit(el);
}

BearWall.register({
  look: ['ring', 'text', 'dim', 'icons'], lookLabels: { ring: 'Accent color' },
  type: 'storm',
  name: 'Storm track', family: 'weather', styleName: 'Storm',
  size: { square: [264, 264], rect: [488, 104] },
  options: [{ key: 'sample', label: 'Show a sample storm', type: 'switch', value: false }],
  every: 60000,
  css: `
    .w-storm .sq { display: flex; flex-direction: column; height: 100%; text-align: center; }
    .w-storm .map { display: block; width: 100%; flex: 1 1 0; min-height: 0; overflow: visible; }
    .w-storm .par { fill: none; stroke: var(--w-dim); stroke-width: 2px; stroke-dasharray: 5 5; vector-effect: non-scaling-stroke; }
    .w-storm .ph { fill: none; stroke: var(--w-text); stroke-opacity: .55; stroke-width: 2px; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .w-storm .cone { fill: var(--i-rain); fill-opacity: .18; stroke: var(--i-rain); stroke-opacity: .5; stroke-width: 2px; vector-effect: non-scaling-stroke; }
    .w-storm .trk, .w-storm .fut { fill: none; stroke: var(--w-text); stroke-width: 2px; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .w-storm .fut { stroke-dasharray: 4 5; }
    .w-storm .me { fill: var(--ring); filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 2) var(--ring)); }
    .w-storm .eye { fill: none; stroke: var(--w-text); stroke-width: 2.6px; stroke-linecap: round; filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 3) var(--w-text)); }
    .w-storm .eye circle { fill: var(--w-text); stroke: none; }
    .m-full .w-storm .eye, .m-lite .w-storm .eye { animation: bwEye 2.5s linear infinite; }
    .m-lite .w-storm .eye { animation-timing-function: steps(10); }
    @keyframes bwEye { to { transform: rotate(-360deg); } }
    .w-storm .big { font-weight: 800; font-size: calc(var(--u) * 7 * var(--fit, 1)); text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-storm .sm { color: var(--w-dim); font-size: calc(var(--u) * 5 * var(--fit, 1)); margin-top: calc(var(--u) * .8); }
    .w-storm .tag { color: var(--i-bolt); font-size: .62em; margin-right: .6em; vertical-align: middle; }
    .w-storm .row { display: flex; align-items: center; height: 100%; gap: calc(var(--u) * 8); }
    .w-storm.right .row { flex-direction: row-reverse; }
    .w-storm .row .map { flex: none; width: auto; height: 100%; aspect-ratio: 260 / 240; }
    .w-storm .row .tx { flex: 1 1 0; min-width: 0; }
    .w-storm.right .row .tx { text-align: right; }
    .w-storm.rect .big { font-size: calc(var(--u) * 22 * var(--fit, 1)); }
    .w-storm.rect .sm { font-size: calc(var(--u) * 14 * var(--fit, 1)); margin-top: calc(var(--u) * 3); }`,
  mount(el) { boxes.add(el); },
  update(el, ctx) {
    el._ctx = ctx;
    load();
    draw(el, ctx);
  }
});
})();
