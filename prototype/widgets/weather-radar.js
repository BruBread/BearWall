// Radar (Weather style): the latest RainViewer rain radar around your city in a round scope, and a
// "Rain in ~15 min · W" line from Open-Meteo's 15-minute forecast at the city and 4 points around it.
(function () {
const U = BearWall.util;
const Z = 7;          // highest zoom RainViewer serves for free
const SPAN = 256;     // world px across the scope at zoom 7, about 300 km
const FRAMES = 5;     // past frames looped in Full motion
const WET = 0.1;      // mm per 15 min that counts as rain
const DIRS = [['', 0, 0], ['N', .25, 0], ['E', 0, .25], ['S', -.25, 0], ['W', 0, -.25]];   // [label, dLat, dLon], ~28 km out

const boxes = new Set();   // mounted widgets, redrawn when data arrives
const redraw = () => boxes.forEach(el => el.isConnected ? draw(el, el._ctx) : boxes.delete(el));

let maps = null, mapsAt = 0;
async function loadMaps() {
  if (Date.now() - mapsAt < 10 * 60e3) return;
  mapsAt = Date.now();
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    maps = { host: j.host, frames: ((j.radar && j.radar.past) || []).slice(-FRAMES) };
  } catch (e) { /* offline or blocked: keep the last frames, or none */ }
  redraw();
}

const near = {};   // per city: { at, pts: [center, N, E, S, W] series of mm per 15 min }
async function loadNear(c) {
  const k = c.lat.toFixed(2) + ',' + c.lon.toFixed(2), old = near[k];
  if (old && Date.now() - old.at < 10 * 60e3) return;
  near[k] = { at: Date.now(), pts: old && old.pts };
  try {
    const lat = DIRS.map(d => (c.lat + d[1]).toFixed(3)).join(','), lon = DIRS.map(d => (c.lon + d[2]).toFixed(3)).join(',');
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&minutely_15=precipitation&forecast_minutely_15=8&past_minutely_15=0&timezone=auto`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    near[k].pts = (Array.isArray(j) ? j : [j]).map(p => p.minutely_15.precipitation.map(v => v || 0));
  } catch (e) { /* keep what we had */ }
  redraw();
}

// pts[0] = the city's next 2 h in 15-min steps; pts[1..4] = N, E, S, W
function summary(pts) {
  if (!pts || pts.length < 5) return '';
  const k = pts[0].findIndex(v => v >= WET);
  const side = DIRS.slice(1).map((d, i) => [d[0], pts[i + 1][0]]).filter(s => s[1] >= WET).sort((a, b) => b[1] - a[1])[0];
  if (k === 0) return 'Raining now';
  if (k > 0) return `Rain in ~${k * 15} min` + (side ? ' · ' + side[0] : '');
  return side ? 'Rain nearby · ' + side[0] : 'No rain nearby';
}
console.assert(summary([[0, 0, .5], [0], [0], [0], [1]]) === 'Rain in ~30 min · W' && summary([[.3], [0], [0], [0], [0]]) === 'Raining now'
  && summary([[0, 0], [0], [.2], [0], [0]]) === 'Rain nearby · E' && summary([[0], [0], [0], [0], [0]]) === 'No rain nearby', 'radar summary');

// lat/lon -> world px at zoom Z (Web Mercator, 256 px tiles)
function world(lat, lon) {
  const n = 256 * 2 ** Z, s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

function draw(el, ctx) {
  if (!ctx) return;
  const c = ctx.city, [wx, wy] = world(c.lat, c.lon);
  const tx = Math.floor(wx / 256 - .5), ty = Math.floor(wy / 256 - .5);   // 2x2 tiles with the city well inside
  const fr = maps ? maps.frames : [];
  const key = `${tx},${ty},${fr.map(f => f.path).join()}`;
  const wl = el.querySelector('.world');
  if (wl._key !== key) {
    wl._key = key;
    const tiles = url => [0, 1].map(dy => [0, 1].map(dx => `<img alt="" src="${url(tx + dx, ty + dy)}" style="left:${dx * 256}px;top:${dy * 256}px">`).join('')).join('');
    wl.innerHTML = `<div class="base">${tiles((x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${Z}/${y}/${x}`)}</div>`
      + fr.map((f, i) => `<div class="fr" style="--i:${i - fr.length}">${tiles((x, y) => `${maps.host}${f.path}/256/${Z}/${x}/${y}/2/1_1.png`)}</div>`).join('');
  }
  const k = el.querySelector('.scope').clientWidth / SPAN;
  wl.style.transform = `scale(${k}) translate(${-(wx - tx * 256 - SPAN / 2)}px, ${-(wy - ty * 256 - SPAN / 2)}px)`;

  const n = near[c.lat.toFixed(2) + ',' + c.lon.toFixed(2)];
  const last = fr[fr.length - 1];
  el.querySelector('.sum').textContent = summary(n && n.pts) || (maps ? 'Checking for rain…' : 'Radar unavailable here');
  el.querySelector('.cr').textContent = (last ? 'Radar ' + U.fmtTime(new Date(last.time * 1000), ctx.opts.h24) + ' · ' : '') + 'RainViewer · Esri';
  U.fit(el);
}

BearWall.register({
  look: ['ring', 'text', 'dim'], lookLabels: { ring: 'Accent color' },
  type: 'radar',
  name: 'Rain radar', family: 'weather', styleName: 'Radar',
  size: { square: [264, 264], rect: [488, 104] },
  options: [{ key: 'h24', label: '24-hour time', type: 'switch', value: false }],
  every: 60000,
  css: `
    .w-radar .rd { display: flex; flex-direction: column; align-items: center; height: 100%; gap: calc(var(--u) * 3); }
    .w-radar .scope { position: relative; flex: none; width: calc(var(--u) * 74); aspect-ratio: 1; border-radius: 50%; overflow: hidden; }
    .w-radar .scope::after { content: ''; position: absolute; inset: 0; border-radius: 50%; box-shadow: inset 0 0 0 max(2px, calc(var(--u) * .7)) var(--ring); opacity: .6; }
    .w-radar .world { position: absolute; left: 0; top: 0; width: 512px; height: 512px; transform-origin: 0 0; }
    .w-radar .world img { position: absolute; width: 256px; height: 256px; }
    .w-radar .base img { filter: brightness(.75); }   /* keep the sea close to black (black = no light) */
    .w-radar .fr { position: absolute; inset: 0; opacity: 0; }
    .w-radar .fr:last-child { opacity: 1; }
    .m-full .w-radar .fr { animation: bwRadar 3s steps(1) infinite; animation-delay: calc(var(--i) * .6s); }
    @keyframes bwRadar { 0% { opacity: 1; } 20%, 100% { opacity: 0; } }
    .w-radar .you { position: absolute; left: 50%; top: 50%; width: calc(var(--u) * 3.2); height: calc(var(--u) * 3.2); margin: calc(var(--u) * -1.6) 0 0 calc(var(--u) * -1.6);
      border-radius: 50%; background: var(--ring); box-shadow: 0 0 calc(var(--glow) * var(--u) * 4) var(--ring); }
    .m-full .w-radar .you, .m-lite .w-radar .you { animation: bwYou 2.4s ease-in-out infinite; }
    .m-lite .w-radar .you { animation-timing-function: steps(6); }
    @keyframes bwYou { 50% { box-shadow: 0 0 0 calc(var(--u) * 3) transparent, 0 0 calc(var(--glow) * var(--u) * 8) var(--ring); } }
    .w-radar .tx { width: 100%; min-width: 0; text-align: center; }
    .w-radar .sum { font-weight: 700; font-size: calc(var(--u) * 7 * var(--fit, 1)); text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-radar .cr { color: var(--w-dim); font-size: calc(var(--u) * 3.6 * var(--fit, 1)); margin-top: calc(var(--u) * .8); }
    .w-radar.rect .rd { flex-direction: row; gap: calc(var(--u) * 10); }
    .w-radar.rect.right .rd { flex-direction: row-reverse; }
    .w-radar.rect .scope { width: auto; height: 100%; }
    .w-radar.rect .tx { flex: 1 1 0; text-align: left; }
    .w-radar.rect.right .tx { text-align: right; }
    .w-radar.rect .sum { font-size: calc(var(--u) * 24 * var(--fit, 1)); }
    .w-radar.rect .cr { font-size: calc(var(--u) * 12 * var(--fit, 1)); margin-top: calc(var(--u) * 4); }`,
  mount(el) {
    el.innerHTML = '<div class="rd"><div class="scope"><div class="world"></div><i class="you"></i></div><div class="tx"><div class="sum fit"></div><div class="cr fit"></div></div></div>';
    boxes.add(el);
  },
  update(el, ctx) {
    el._ctx = ctx;
    loadMaps(); loadNear(ctx.city);
    draw(el, ctx);
  }
});
})();
