/* BearWall wall runtime: one wall of widgets, each of which can be warped by its own 4 corners to fit the real wall; settings and shared data.
 * Widgets live in widgets/*.js, load after this file, and register themselves with BearWall.register().
 * Plain ES2020 for Chrome 95 (the projector's WebView). No build step, no dependencies.
 *
 * ---------------------------------------------------------------------------------------------
 * Widget module contract
 *
 * BearWall.register({
 *   type: 'clock',                    // unique id, stored as widget.type in the layout
 *   name: 'Clock',                    // label in the "Add widget" menu
 *   size: { square: [240, 240], rect: [464, 104] },   // default box in wall px for each mode
 *   options: [                        // per-widget settings, shown in the Layout card when the widget is selected
 *     { key: 'style', label: 'Style', type: 'tabs', choices: [['digital', 'Digital'], ['analog', 'Analog']], value: 'digital' },
 *     { key: 'h24', label: '24-hour time', type: 'switch', value: false },
 *     { key: 'title', label: 'Title', type: 'text', value: '' },          // also type 'date' ('YYYY-MM-DD') and 'time' ('HH:MM')
 *   ],                                // tabs values are strings; switch values are booleans
 *   every: 1000,                      // optional: also call update() every this many ms (a clock wants 1000)
 *   css: `.w-clock .digits { ... }`,  // injected once; scope every rule under .w-<type>
 *   mount(el, ctx) {},                // build your DOM inside el, once
 *   update(el, ctx) {},               // refresh from ctx: after mount, on any change, on resize, and every `every` ms
 * });
 *
 * el is the widget's box. The runtime sets its classes to `wgt w-<type> <square|rect> <left|right>` on every
 * update, so never put your own classes on el itself, only on children. el has a `--u` CSS variable equal to
 * 1% of min(box width, box height) in px: size everything with calc(var(--u) * n) so the widget scales with its
 * box. Text must never overflow or overlap: give a line the `fit` class (nowrap + ellipsis) and call
 * BearWall.util.fit(el) at the end of update() to shrink it down to 50% via `font-size: calc(... * var(--fit, 1))`.
 * Rect mode is one row; anchor 'right' means mirror the order (flex-direction: row-reverse) to hug a right corner.
 * Animate only under `.m-full` / `.m-lite` (see style.css); never run a requestAnimationFrame loop forever.
 * Black is no light: keep backgrounds transparent. Strokes >= 2px and text >= ~18px at 1280x720 wall size.
 *
 * ctx = {
 *   mode: 'square' | 'rect', anchor: 'left' | 'right',
 *   opts,        // this widget's option values, by key
 *   now,         // Date. Follows the sample time-of-day slider in Sample mode.
 *   motion,      // 'full' | 'lite' | 'calm' | 'off'
 *   settings,    // global look: { ring, thick, track, glow, icons, name }
 *   city,        // { name, admin, lat, lon }
 *   weather: { live, cond, temp, hum, feels, hi, lo, night, sunrise: Date, sunset: Date,
 *              hourly: [{ time: Date, temp, cond, night, pop }] },   // next 24 h from this hour, pop = rain chance %
 * }
 * cond is one of 'clear' | 'partly' | 'cloud' | 'rain' | 'thunder' | 'fog'. Temperatures are whole °C.
 *
 * BearWall.util:
 *   iconSVG(cond, night)       -> weather icon <svg> (64x64 viewBox, natural colors, animated by motion level)
 *   ringHTML(innerHTML)        -> '<div class="ring">…<div class="tp">innerHTML</div></div>' (the shared ring)
 *   setRing(ringEl, percent)   -> set the ring's fill 0-100 (animates on change, follows the ring settings)
 *   countTo(el, n, motion)     -> show a whole number, counting up to it when it changes
 *   typeOut(el, text, motion)  -> typewriter text with the blinking cursor; layout never jumps
 *   fit(el)                    -> shrink every `.fit` line inside el so it fits its width (down to 50%)
 *   fmtTime(date, h24)         -> '7:05 PM' or '19:05'
 *   clamp(v, min, max), esc(text)
 * ---------------------------------------------------------------------------------------------
 */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const WALL_W = 1280, WALL_H = 720, GRID = 8, MIN = 48;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const snap = v => Math.round(v / GRID) * GRID;
const copy = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 8);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');

// Saved per browser. Phase 1 moves this to the projector's /api/layout and /api/settings.
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('bearwall.' + k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bearwall.' + k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- shared helpers for widgets ---------- */
const CLOUD = '<path class="cloud c-cloud" d="M19 46h27a9 9 0 0 0 1.5-17.9A13 13 0 0 0 22.4 25 10.5 10.5 0 0 0 19 46z"/>';
const rays = () => Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
  return `<line x1="${32 + c * 16}" y1="${32 + s * 16}" x2="${32 + c * 22}" y2="${32 + s * 22}"/>`; }).join('');
const SUN = `<g class="c-sun"><circle cx="32" cy="32" r="10"/><g class="rays anim">${rays()}</g></g>`;
const MOON = '<path class="moon anim c-moon" d="M41 13a19 19 0 1 0 11 31 15 15 0 0 1-11-31z"/>';
function icon(cond, night) {
  const sky = night ? MOON : SUN;
  if (cond === 'clear') return sky;
  if (cond === 'partly') return `<g transform="translate(-1 -3) scale(.78)">${sky}</g><g class="drift anim">${CLOUD}</g>`;
  if (cond === 'cloud') return `<g class="drift anim">${CLOUD}</g>`;
  if (cond === 'rain') return `<g transform="translate(0 -7)">${CLOUD}</g><line class="drop anim c-rain" x1="24" y1="47" x2="22" y2="53"/><line class="drop anim c-rain" x1="33" y1="47" x2="31" y2="53"/><line class="drop anim c-rain" x1="42" y1="47" x2="40" y2="53"/>`;
  if (cond === 'thunder') return `<g transform="translate(0 -7)">${CLOUD}</g><path class="bolt anim c-bolt" d="M34 41l-6 9h8l-6 10"/>`;
  return `<line class="fogl anim c-fog" x1="14" y1="26" x2="50" y2="26"/><line class="fogl anim c-fog" x1="10" y1="35" x2="46" y2="35"/><line class="fogl anim c-fog" x1="18" y1="44" x2="54" y2="44"/>`;
}
const svg = inner => `<svg viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;

const util = {
  clamp, esc,
  iconSVG: (cond, night) => svg(icon(cond, night)),
  ringHTML: (inner = '') => `<div class="ring"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="45"/><circle class="arc" cx="50" cy="50" r="45" pathLength="100"/></svg><div class="tp">${inner}</div></div>`,
  setRing(ringEl, pct) {
    const r = 50 - S.thick / 2 - 1, arc = ringEl.querySelector('.arc');
    ringEl.querySelectorAll('circle').forEach(c => c.setAttribute('r', r));
    if (!arc.style.strokeDashoffset) arc.getBoundingClientRect();   // first fill: start from empty so it sweeps
    arc.style.strokeDashoffset = 100 - clamp(pct, 0, 100);
  },
  countTo(el, to, motion) {
    if (el._v === to) return;
    const from = el._v == null ? 0 : el._v;
    el._v = to; cancelAnimationFrame(el._raf);
    if (motion === 'off' || from === to) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 900;
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e); if (k < 1) el._raf = requestAnimationFrame(step); };
    el._raf = requestAnimationFrame(step);
  },
  typeOut(el, text, motion) {
    if (el._full === text) return;
    el._full = text; clearInterval(el._tw);
    el.innerHTML = '<span class="ty"></span><i class="cur"></i><span class="rest"></span>';
    const ty = el.firstChild, rest = el.lastChild;   // untyped text stays in the layout, hidden, so nothing jumps
    if (motion === 'off') { ty.textContent = text; return; }
    rest.textContent = text;
    let i = 0;
    el._tw = setInterval(() => { i++; ty.textContent = text.slice(0, i); rest.textContent = text.slice(i); if (i >= text.length) clearInterval(el._tw); }, 42);
  },
  fit(el) {
    for (const c of el.querySelectorAll('.fit')) {
      c.style.setProperty('--fit', 1);
      const k = c.clientWidth / c.scrollWidth;
      if (k < 1) c.style.setProperty('--fit', Math.max(.5, k * .97));
    }
  },
  fmtTime(d, h24) {
    const h = d.getHours(), m = pad(d.getMinutes());
    return h24 ? `${pad(h)}:${m}` : `${(h + 11) % 12 + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  }
};

/* ---------- geometry: grid moves and the 4-corner warp ---------- */
// Move (dir '') or resize from a corner (dir 'nw' | 'ne' | 'sw' | 'se'), snapped to the grid and kept inside the parent.
function moveResize(b, s, dx, dy, dir, pw, ph) {
  if (!dir) { b.x = clamp(snap(s.x + dx), 0, pw - s.w); b.y = clamp(snap(s.y + dy), 0, ph - s.h); return; }
  let l = s.x, t = s.y, r = s.x + s.w, bt = s.y + s.h;
  if (dir.includes('w')) l = clamp(snap(l + dx), 0, r - MIN);
  if (dir.includes('e')) r = clamp(snap(r + dx), l + MIN, pw);
  if (dir.includes('n')) t = clamp(snap(t + dy), 0, bt - MIN);
  if (dir.includes('s')) bt = clamp(snap(bt + dy), t + MIN, ph);
  Object.assign(b, { x: l, y: t, w: r - l, h: bt - t });
}
function fitInside(b, pw, ph) { b.w = Math.min(b.w, pw); b.h = Math.min(b.h, ph); b.x = clamp(b.x, 0, pw - b.w); b.y = clamp(b.y, 0, ph - b.h); }

const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
// Projective transform (3x3, h33 = 1) that maps 4 src points onto 4 dst points: solve the 8x8 system.
function homography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {   // Gauss-Jordan with partial pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((row, i) => row[8] / row[i]).concat(1);
}
const applyH = (H, x, y) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
const matrix3d = H => `matrix3d(${H[0]},${H[3]},0,${H[6]},${H[1]},${H[4]},0,${H[7]},0,0,1,0,${H[2]},${H[5]},0,${H[8]})`;
// A usable quad is convex, not mirrored, and not collapsed: walk it clockwise and every turn must go the same way.
function validQuad(q) {
  if (!Array.isArray(q) || q.length !== 4 || !q.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return false;
  const P = [q[0], q[1], q[3], q[2]];
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) % 4], c = P[(i + 2) % 4];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < 1) return false;
  }
  return true;
}

/* ---------- state ---------- */
const types = {};
const known = w => !!types[w.type];
// Widgets sit on one wall in wall px (1280x720). A widget may have a `quad`: its 4 corners on the wall,
// ordered [top-left, top-right, bottom-left, bottom-right]; its flat w x h content is warped onto them.
const DEFAULT_LAYOUT = { widgets: [
  { id: 'w1', type: 'weather', mode: 'square', anchor: 'right', x: 64, y: 120, w: 264, h: 264, opts: {} },
  { id: 'w3', type: 'clock', mode: 'square', anchor: 'right', x: 360, y: 120, w: 264, h: 264, opts: {} },
  { id: 'w4', type: 'hourly', mode: 'rect', anchor: 'left', x: 64, y: 424, w: 560, h: 112, opts: {} },
  { id: 'w2', type: 'date', mode: 'rect', anchor: 'right', x: 744, y: 32, w: 488, h: 104, opts: {} },
  { id: 'w5', type: 'sky', mode: 'rect', anchor: 'right', x: 744, y: 152, w: 488, h: 104, opts: {} }
] };
const FULL = rectPts(0, 0, WALL_W, WALL_H);
const CORNERS = ['Top left', 'Top right', 'Bottom left', 'Bottom right'];
const EDGES = [[0, 1], [1, 3], [3, 2], [2, 0]];                    // top, right, bottom, left
const CITIES = [
  ['Manila', 'Metro Manila, PH', 14.6, 120.98], ['Quezon City', 'Metro Manila, PH', 14.68, 121.04],
  ['Cebu City', 'Central Visayas, PH', 10.32, 123.89], ['Davao City', 'Davao Region, PH', 7.07, 125.61],
  ['Bacolod City', 'Negros Occidental, PH', 10.68, 122.95], ['Iloilo City', 'Western Visayas, PH', 10.72, 122.56],
  ['Tokyo', 'Tokyo, JP', 35.68, 139.69], ['Singapore', 'SG', 1.29, 103.85],
  ['London', 'England, GB', 51.51, -0.13], ['New York', 'New York, US', 40.71, -74.01]
].map(([name, admin, lat, lon]) => ({ name, admin, lat, lon }));
const DEFAULT_SETTINGS = { city: CITIES[0], name: '', ring: '#5ee6ff', thick: 9, track: .18, glow: .5, motion: 'full', icons: 'natural' };

let L = store.get('layout', null);
const savedSettings = store.get('settings', null);
const S = Object.assign(copy(DEFAULT_SETTINGS), savedSettings || {});
if (!savedSettings && matchMedia('(prefers-reduced-motion: reduce)').matches) S.motion = 'calm';
const P = { source: 'live', cond: 'partly', temp: 31, hum: 74, hour: 19.5 };   // sample values, not saved
let live = null, liveState = 'loading';   // loading | live | offline
let sel = null;                           // selected widget id; none = View
let corner = 0, step = 1, shiftHeld = false;   // warp editing
const inPanel = q => q.every(([x, y]) => x >= 0 && x <= WALL_W && y >= 0 && y <= WALL_H);
const saveLayout = () => store.set('layout', L);
const saveSettings = () => store.set('settings', S);
const widgetOf = id => L.widgets.find(w => w.id === id);
const defaultOpts = m => Object.fromEntries((m.options || []).map(o => [o.key, o.value]));

// Older saved layouts had several "screens"; fold their widgets onto the one wall at the same spots.
function migrate(old) {
  if (!old || !Array.isArray(old.screens)) return old;
  return { widgets: old.screens.flatMap(s => (Array.isArray(s.widgets) ? s.widgets : [])
    .map(w => Object.assign({}, w, { x: (+w.x || 0) + (+s.x || 0), y: (+w.y || 0) + (+s.y || 0) }))) };
}
function normalize() {
  L = migrate(L);
  if (!L || !Array.isArray(L.widgets)) L = copy(DEFAULT_LAYOUT);
  delete L.warp;   // the old whole-wall warp; widgets warp one by one now
  for (const w of L.widgets) {
    if (w.quad && !(validQuad(w.quad) && inPanel(w.quad))) delete w.quad;
    for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(w[k])) w[k] = k === 'w' || k === 'h' ? 240 : 0;
    fitInside(w, WALL_W, WALL_H);
    w.mode = w.mode === 'rect' ? 'rect' : 'square';
    w.anchor = w.anchor === 'left' ? 'left' : 'right';
    if (known(w)) w.opts = Object.assign(defaultOpts(types[w.type]), w.opts);   // unknown types are kept but not shown
  }
}

/* ---------- time and weather ---------- */
const CONDS = [['clear', 'Clear'], ['partly', 'Partly'], ['cloud', 'Cloudy'], ['rain', 'Rain'], ['thunder', 'Thunder'], ['fog', 'Fog']];
// Open-Meteo WMO weather codes -> icon. Snow has no icon of its own yet, so it shows as cloud.
const codeToCond = c => c === 0 ? 'clear' : c <= 2 ? 'partly' : c === 3 ? 'cloud' : c <= 48 ? 'fog' : c >= 95 ? 'thunder'
  : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) ? 'rain' : 'cloud';

function timeNow() {
  if (P.source !== 'sample') return new Date();
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + P.hour * 3600e3);
}
function sampleWeather(now) {
  const at = (h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d; };
  const sunrise = at(5, 48), sunset = at(17, 36);
  const nightAt = t => { const h = t.getHours() + t.getMinutes() / 60; return h < 5.8 || h >= 17.6; };
  const curve = h => 3 * Math.cos((h - 14) / 12 * Math.PI), CYCLE = ['partly', 'cloud', 'rain', 'partly', 'clear', 'clear'];
  const start = new Date(now); start.setMinutes(0, 0, 0);
  const base = P.temp - curve(start.getHours());
  const hourly = Array.from({ length: 24 }, (_, i) => {
    const time = new Date(start.getTime() + i * 3600e3), cond = i < 3 ? P.cond : CYCLE[Math.floor(i / 4) % CYCLE.length];
    return { time, temp: Math.round(base + curve(time.getHours())), cond, night: nightAt(time),
      pop: cond === 'rain' || cond === 'thunder' ? 70 : cond === 'cloud' ? 25 : 5 };
  });
  return { live: false, cond: P.cond, temp: P.temp, hum: P.hum, feels: P.temp + 4, hi: P.temp + 1, lo: P.temp - 6, night: nightAt(now), sunrise, sunset, hourly };
}
const weatherNow = now => (P.source === 'live' && live) ? live : sampleWeather(now);

async function fetchWeather() {
  const c = S.city;
  try {
    const q = 'current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day'
      + '&hourly=temperature_2m,weather_code,precipitation_probability,is_day'
      + '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=2';
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&${q}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (c !== S.city) return;   // the city changed while this was loading
    const off = j.utc_offset_seconds || 0, t = s => new Date(Date.parse(s + 'Z') - off * 1000);   // city-local ISO -> Date
    const cu = j.current, hr = j.hourly, dy = j.daily, from = Date.now() - 3600e3;
    const hourly = hr.time.map((s, i) => ({ time: t(s), temp: Math.round(hr.temperature_2m[i]), cond: codeToCond(hr.weather_code[i]),
      night: !hr.is_day[i], pop: hr.precipitation_probability[i] == null ? 0 : hr.precipitation_probability[i] }))
      .filter(h => h.time.getTime() > from).slice(0, 24);
    live = { live: true, cond: codeToCond(cu.weather_code), temp: Math.round(cu.temperature_2m), hum: Math.round(cu.relative_humidity_2m),
      feels: Math.round(cu.apparent_temperature), hi: Math.round(dy.temperature_2m_max[0]), lo: Math.round(dy.temperature_2m_min[0]),
      night: !cu.is_day, sunrise: t(dy.sunrise[0]), sunset: t(dy.sunset[0]), hourly, at: Date.now() };
    liveState = 'live';
  } catch (e) {
    if (c !== S.city) return;
    live = null; liveState = 'offline';
  }
  render();
}

/* ---------- the wall ---------- */
// View: nothing selected. Arrange: a widget selected (move, resize). Warp: Shift held or the Warp handles switch on.
let stage, stageBox, wallEl, inst = [];
const HANDLES = ['nw', 'ne', 'sw', 'se'].map(h => `<i class="handle" data-h="${h}"></i>`).join('');
const selW = () => (sel && widgetOf(sel)) || null;
const warpOn = () => !!selW() && (shiftHeld || $('#warpSticky').checked);
const quadOf = w => w.quad || rectPts(w.x, w.y, w.w, w.h);

function place(el, b) {
  el.style.left = b.x / WALL_W * 100 + '%'; el.style.top = b.y / WALL_H * 100 + '%';
  el.style.width = b.w / WALL_W * 100 + '%'; el.style.height = b.h / WALL_H * 100 + '%';
}
// A warped widget lays out flat at its own w x h, then a homography maps that rectangle onto its 4 corners.
function positionWidget(w) {
  const el = wallEl.querySelector(`.widget[data-wid="${w.id}"]`);
  if (!el) return;
  el.classList.toggle('warped', !!w.quad);
  if (w.quad) {
    const kx = stage.clientWidth / WALL_W, ky = stage.clientHeight / WALL_H;
    Object.assign(el.style, { left: 0, top: 0, width: w.w * kx + 'px', height: w.h * ky + 'px',
      transform: matrix3d(homography(rectPts(0, 0, w.w * kx, w.h * ky), w.quad.map(([x, y]) => [x * kx, y * ky]))) });
  } else {
    el.style.transform = '';
    place(el, w);
  }
  el.dataset.label = types[w.type].name + (w.quad ? ' · warped' : '');
}
function drawWarpUI() {
  const ui = $('#warpui'), w = selW(), on = warpOn();
  ui.hidden = !on;
  wallEl.querySelectorAll('.widget').forEach(el => el.classList.toggle('warping', on && el.dataset.wid === sel));
  if (!w) return;
  const q = quadOf(w), pct = (x, y) => [x / WALL_W * 100 + '%', y / WALL_H * 100 + '%'];
  $('#readout').textContent = `${CORNERS[corner]} · ${q[corner].map(Math.round).join(', ')}`;
  document.querySelectorAll('#corners button').forEach(b => b.classList.toggle('on', +b.dataset.i === corner));
  $('#undo').disabled = !undo.length;
  $('#flatten').disabled = !w.quad;
  if (!on) return;
  ui.querySelector('polygon').setAttribute('points', [0, 1, 3, 2].map(i => q[i].join(',')).join(' '));
  ui.querySelectorAll('.ch').forEach(h => { const i = +h.dataset.i; [h.style.left, h.style.top] = pct(...q[i]); h.classList.toggle('on', i === corner); });
  ui.querySelectorAll('.eh').forEach(h => { const [a, b] = EDGES[+h.dataset.e]; [h.style.left, h.style.top] = pct((q[a][0] + q[b][0]) / 2, (q[a][1] + q[b][1]) / 2); });
}

function buildStage() {
  inst.forEach(i => i.ro.disconnect());
  const shown = L.widgets.filter(known);
  wallEl.innerHTML = shown.map(w => `<div class="widget frame" data-wid="${esc(w.id)}"><div class="wgt"></div>${HANDLES}</div>`).join('');
  inst = shown.map(w => {
    const el = wallEl.querySelector(`.widget[data-wid="${w.id}"] > .wgt`);
    const i = { w, m: types[w.type], el, last: 0, mounted: false };
    i.ro = new ResizeObserver(() => {   // layout size, not the warped on-screen size
      el.style.setProperty('--u', Math.min(el.offsetWidth, el.offsetHeight) / 100 + 'px');
      if (i.mounted) updateInst(i);
    });
    i.ro.observe(el);
    return i;
  });
  shown.forEach(positionWidget);
  render();
}

function updateInst(i, now = timeNow(), weather = weatherNow(now)) {
  const ctx = { mode: i.w.mode, anchor: i.w.anchor, opts: i.w.opts, now, motion: S.motion, settings: S, city: S.city, weather };
  i.el.className = `wgt w-${i.w.type} ${i.w.mode} ${i.w.anchor}`;
  try {
    if (!i.mounted) { i.m.mount(i.el, ctx); i.mounted = true; }
    i.m.update(i.el, ctx);
  } catch (e) { console.error(`widget "${i.w.type}" failed:`, e); }
  i.last = Date.now();
}

function render() {
  const root = document.documentElement.style, now = timeNow(), weather = weatherNow(now);
  stage.dataset.icons = S.icons;
  root.setProperty('--ring', S.ring); root.setProperty('--thick', S.thick); root.setProperty('--track', S.track); root.setProperty('--glow', S.glow);
  inst.forEach(i => updateInst(i, now, weather));
  renderControls();
}
// everything that depends on the selection, without re-rendering the widgets
function renderChrome() {
  stage.className = `stage m-${S.motion}` + (selW() ? ' sel-on' : '');
  stageBox.classList.toggle('editing', !!selW());
  renderSel();
  drawWarpUI();
}

/* ---------- warp editing (same moves as the keystone page, on the selected widget) ---------- */
let undo = [], lastPush = 0, lastKind = null, lastId = null;
// Each drag is one undo step; a run of nudges (or of scrolls) on one widget within 700 ms shares one.
function pushUndo(kind, w) {
  const t = Date.now(), grouped = kind && kind === lastKind && w.id === lastId && t - lastPush < 700;
  lastPush = t; lastKind = kind || null; lastId = w.id;
  if (grouped) return;
  undo.push({ id: w.id, quad: w.quad ? copy(w.quad) : null });
  if (undo.length > 50) undo.shift();
}
function doUndo() {
  const u = undo.pop(), w = u && widgetOf(u.id);
  if (!w) return drawWarpUI();
  if (u.quad) w.quad = u.quad; else delete w.quad;
  positionWidget(w); saveLayout(); drawWarpUI();
}
const clampPt = ([x, y]) => [clamp(Math.round(x), 0, WALL_W), clamp(Math.round(y), 0, WALL_H)];
// Accept a new shape only if it stays on the wall and isn't folded or mirrored.
function setQuad(w, q) {
  q = q.map(p => p.map(Math.round));
  if (!validQuad(q) || !inPanel(q)) return false;
  w.quad = q; positionWidget(w); drawWarpUI();
  return true;
}
function moveAll(w, q0, dx, dy) {
  const xs = q0.map(p => p[0]), ys = q0.map(p => p[1]);
  dx = clamp(dx, -Math.min(...xs), WALL_W - Math.max(...xs)); dy = clamp(dy, -Math.min(...ys), WALL_H - Math.max(...ys));
  return setQuad(w, q0.map(([x, y]) => [x + dx, y + dy]));
}
function zoom(w, q0, f) {
  const cx = q0.reduce((a, p) => a + p[0], 0) / 4, cy = q0.reduce((a, p) => a + p[1], 0) / 4;
  return setQuad(w, q0.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]));
}
function nudge(dx, dy) {
  const w = selW();
  if (!w) return;
  pushUndo('nudge', w);
  const q = copy(quadOf(w));
  q[corner] = clampPt([q[corner][0] + dx, q[corner][1] + dy]);
  setQuad(w, q); saveLayout();
}
function flatten(w) {   // back to a plain box where the warp's top-left was
  if (!w || !w.quad) return;
  pushUndo(null, w);
  w.x = clamp(snap(Math.min(...w.quad.map(p => p[0]))), 0, WALL_W - w.w);
  w.y = clamp(snap(Math.min(...w.quad.map(p => p[1]))), 0, WALL_H - w.h);
  delete w.quad;
  positionWidget(w); saveLayout(); drawWarpUI();
}
// point inside the convex quad (walk it clockwise: every edge keeps the point on its right)
function inQuad(q, [x, y]) {
  const P = [q[0], q[1], q[3], q[2]];
  return P.every((a, i) => { const b = P[(i + 1) % 4]; return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0; });
}

/* ---------- controls ---------- */
const RINGS = ['#5ee6ff', '#7dffa8', '#ffd84d', '#ff7ac6', '#ffffff'];
const NOTES = {
  full: 'Everything moves: sun rays turn, clouds drift, rain falls, the cursor blinks. Smoothest, but the projector redraws the warped wall every frame.',
  lite: 'Same motion at about 8 frames a second. Feels alive, much lighter on the projector. Likely the everyday default.',
  calm: 'Still between updates. Rings sweep, numbers count and text types only when the data changes.',
  off: 'Nothing moves. Values just change in place.' };
const onTabs = (id, v) => document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === v));
const clockLabel = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${(hh + 11) % 12 + 1}:${pad(mm)} ${hh < 12 ? 'AM' : 'PM'}`; };

function renderControls() {
  const st = P.source === 'sample' ? 'sample' : liveState;
  $('#status').dataset.state = st;
  $('#statusText').textContent = st === 'sample' ? 'Sample weather'
    : st === 'live' ? `Live · ${S.city.name} · ${util.fmtTime(new Date(live.at))}`
    : st === 'loading' ? 'Loading weather…' : 'Live weather unavailable here · showing sample';
  $('#sample').hidden = P.source !== 'sample';
  $('#tempVal').textContent = P.temp + '°C'; $('#humVal').textContent = P.hum + '%'; $('#hourVal').textContent = clockLabel(P.hour);
  $('#thickVal').textContent = S.thick; $('#trackVal').textContent = Math.round(S.track * 200) + '%'; $('#glowVal').textContent = Math.round(S.glow * 100) + '%';
  document.querySelectorAll('#conds .chip').forEach(b => b.classList.toggle('on', b.dataset.v === P.cond));
  document.querySelectorAll('#swatches .sw').forEach(b => b.classList.toggle('on', b.dataset.v === S.ring));
  onTabs('source', P.source); onTabs('motion', S.motion); onTabs('icons', S.icons); onTabs('step', String(step));
  $('#motionNote').textContent = NOTES[S.motion];
  renderChrome();
}

function renderSel() {
  wallEl.querySelectorAll('.widget.sel').forEach(f => f.classList.remove('sel'));
  const w = selW();
  if (!w || !known(w)) sel = null;
  if (sel) wallEl.querySelector(`.widget[data-wid="${w.id}"]`).classList.add('sel');
  $('#selName').textContent = sel ? types[w.type].name + (w.quad ? ' · warped' : '') : 'Nothing selected · click a widget on the wall';
  $('#widgetTools').hidden = !sel;
  if (sel) {
    onTabs('mode', w.mode); onTabs('wAnchor', w.anchor);
    $('#anchorRow').hidden = w.mode !== 'rect';
    renderOpts(w);
  }
}

// per-widget settings, drawn from the module's `options`
function optHTML(o) {
  const k = esc(o.key), label = esc(o.label);
  if (o.type === 'tabs') return `<div class="lbl"><span>${label}</span></div><div class="tabs" data-k="${k}">${o.choices.map(([v, n]) => `<button data-v="${esc(v)}">${esc(n)}</button>`).join('')}</div>`;
  if (o.type === 'switch') return `<label class="row">${label}<input type="checkbox" class="switch" data-k="${k}"></label>`;
  const type = o.type === 'date' || o.type === 'time' ? o.type : 'text';
  return `<div class="lbl"><span>${label}</span></div><input class="field" type="${type}" data-k="${k}" maxlength="40" autocomplete="off" aria-label="${label}">`;
}
function renderOpts(w) {
  const box = $('#widgetOpts'), opts = types[w.type].options || [];
  if (box._for !== w) { box._for = w; box.innerHTML = opts.map(optHTML).join(''); }
  for (const o of opts) {
    const v = w.opts[o.key];
    if (o.type === 'tabs') { box.querySelectorAll(`.tabs[data-k="${o.key}"] button`).forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); continue; }
    const input = box.querySelector(`[data-k="${o.key}"]`);
    if (o.type === 'switch') input.checked = !!v;
    else if (document.activeElement !== input) input.value = v == null ? '' : v;
  }
}
function setOpt(key, value) {
  const w = selW();
  if (!w) return;
  w.opts[key] = value; saveLayout();
  const i = inst.find(x => x.w === w);
  if (i) updateInst(i);
  renderOpts(w);
}

function select(id) { if (id !== sel) corner = 0; sel = id; renderChrome(); }
const panelPt = e => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) * WALL_W / r.width, (e.clientY - r.top) * WALL_H / r.height]; };

function deleteSelected() {
  if (!sel) return;
  L.widgets = L.widgets.filter(w => w.id !== sel);
  sel = null; saveLayout(); buildStage();
}
function addWidget(type) {
  const m = types[type], [w0, h0] = m.size.square;
  const w = { id: uid(), type, mode: 'square', anchor: 'right', x: snap((WALL_W - w0) / 2), y: snap((WALL_H - h0) / 2), w: w0, h: h0, opts: defaultOpts(m) };
  fitInside(w, WALL_W, WALL_H);
  L.widgets.push(w); sel = w.id; saveLayout(); buildStage();
}
// move a widget, flat or warped; arrange moves snap to the 8 px grid
function moveWidget(w, start, dx, dy) {
  if (start.quad) return moveAll(w, start.quad, snap(dx), snap(dy));
  moveResize(w, start, dx, dy, '', WALL_W, WALL_H); positionWidget(w);
}

let drag = null, pinch = null;
const pointers = new Map();
function bindStage() {
  stageBox.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const p = panelPt(e), w = selW();
    if (w && warpOn()) {   // Warp: corners, edges, inside; two fingers zoom
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { w, q0: copy(quadOf(w)), d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 }; drag = null; pushUndo(null, w);
        stageBox.setPointerCapture(e.pointerId); e.preventDefault();
        return;
      }
      const q0 = copy(quadOf(w)), ch = e.target.closest('.ch'), eh = e.target.closest('.eh');
      const kind = ch ? 'corner' : eh ? 'edge' : inQuad(q0, p) ? 'all' : null;
      if (kind) {
        if (ch) corner = +ch.dataset.i;
        drag = { kind, w, edge: eh ? +eh.dataset.e : 0, q0, p0: p };   // keeps going if Shift is let go mid-drag
        pushUndo(null, w); stageBox.setPointerCapture(e.pointerId); e.preventDefault(); drawWarpUI();
        return;
      }
      pointers.delete(e.pointerId);
    }
    const f = e.target.closest('.widget');
    if (!f) { select(null); return; }   // empty wall: View
    select(f.dataset.wid);
    const t = selW(), h = e.target.closest('.handle');
    if (t.quad) pushUndo(null, t);
    drag = { kind: h && !t.quad ? 'resize' : 'move', w: t, start: copy(t), p0: p, dir: h ? h.dataset.h : '' };
    stageBox.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stageBox.addEventListener('pointermove', e => {
    const p = panelPt(e);
    if (pinch && pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, p);
      const [a, b] = [...pointers.values()];
      zoom(pinch.w, pinch.q0, Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d0);
      return;
    }
    if (!drag) return;
    const dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1];
    if (drag.kind === 'move') return moveWidget(drag.w, drag.start, dx, dy);
    if (drag.kind === 'resize') { moveResize(drag.w, drag.start, dx, dy, drag.dir, WALL_W, WALL_H); return positionWidget(drag.w); }
    if (drag.kind === 'all') return moveAll(drag.w, drag.q0, dx, dy);
    const q = copy(drag.q0);
    const idx = drag.kind === 'corner' ? [corner] : EDGES[drag.edge];
    idx.forEach(i => { q[i] = clampPt([q[i][0] + dx, q[i][1] + dy]); });
    setQuad(drag.w, q);
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (drag || pinch) saveLayout();
    if (pointers.size < 2) pinch = null;
    drag = null;
    drawWarpUI();
  };
  stageBox.addEventListener('pointerup', end);
  stageBox.addEventListener('pointercancel', end);
  stageBox.addEventListener('wheel', e => {
    const w = selW();
    if (!w || !warpOn()) return;
    e.preventDefault();
    pushUndo('wheel', w); zoom(w, copy(quadOf(w)), Math.exp(-e.deltaY * 0.0015)); saveLayout();
  }, { passive: false });
  new ResizeObserver(() => L.widgets.forEach(w => w.quad && known(w) && positionWidget(w))).observe(stage);   // warps are in px
}

function bindControls() {
  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
  const setShift = on => { if (shiftHeld !== on) { shiftHeld = on; drawWarpUI(); } };
  document.addEventListener('keyup', e => { if (e.key === 'Shift') setShift(false); });
  window.addEventListener('blur', () => setShift(false));
  document.addEventListener('keydown', e => {
    if (typing()) return;
    if (e.key === 'Shift') { setShift(true); return; }
    const w = selW();
    if (!w) return;
    if (e.key === 'Escape') { select(null); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    if (warpOn() && /^Digit[1-4]$/.test(e.code)) { corner = +e.code.slice(5) - 1; drawWarpUI(); return; }
    const D = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!D) return;
    e.preventDefault();
    if (warpOn()) return nudge(D[0] * step, D[1] * step);
    if (w.quad) pushUndo('move', w);
    moveWidget(w, copy(w), D[0] * GRID, D[1] * GRID); saveLayout();
  });

  // warp tools
  $('#warpSticky').onchange = drawWarpUI;
  $('#corners').onclick = e => { const b = e.target.closest('button'); if (b) { corner = +b.dataset.i; drawWarpUI(); } };
  $('#dpad').onclick = e => { const b = e.target.closest('button'); if (!b) return; const [dx, dy] = b.dataset.nudge.split(',').map(Number); nudge(dx * step, dy * step); };
  $('#step').onclick = e => { const b = e.target.closest('button'); if (b) { step = +b.dataset.v; onTabs('step', String(step)); } };
  $('#undo').onclick = doUndo;
  $('#flatten').onclick = () => flatten(selW());
  // widget tools
  $('#del').onclick = deleteSelected;
  $('#addType').innerHTML = Object.values(types).map(m => `<option value="${esc(m.type)}">${esc(m.name)}</option>`).join('');
  $('#addWidget').onclick = () => { const t = $('#addType').value; if (types[t]) addWidget(t); };
  $('#mode').onclick = e => {
    const b = e.target.closest('button'), w = selW();
    if (!b || !w || w.mode === b.dataset.v) return;
    [w.w, w.h] = types[w.type].size[b.dataset.v]; w.mode = b.dataset.v;
    fitInside(w, WALL_W, WALL_H); positionWidget(w); saveLayout(); render();
  };
  $('#wAnchor').onclick = e => {
    const b = e.target.closest('button'), w = selW();
    if (!b || !w) return;
    w.anchor = b.dataset.v; saveLayout(); render();
  };
  $('#widgetOpts').addEventListener('click', e => { const b = e.target.closest('.tabs button'); if (b) setOpt(b.parentElement.dataset.k, b.dataset.v); });
  $('#widgetOpts').addEventListener('input', e => { const t = e.target; if (t.dataset.k) setOpt(t.dataset.k, t.type === 'checkbox' ? t.checked : t.value); });
  $('#reset').onclick = e => {   // two taps instead of confirm(), which embedded pages can't show
    const b = e.currentTarget, disarm = () => { delete b.dataset.armed; b.textContent = 'Reset widgets'; };
    clearTimeout(b._t);
    if (b.dataset.armed) { disarm(); L.widgets = copy(DEFAULT_LAYOUT.widgets); normalize(); sel = null; undo = []; saveLayout(); buildStage(); return; }
    b.dataset.armed = '1'; b.textContent = 'Tap again to reset';
    b._t = setTimeout(disarm, 3000);
  };

  $('#conds').innerHTML = CONDS.map(([v, n]) => `<button class="chip" data-v="${v}">${svg(icon(v, false))}${n}</button>`).join('');
  $('#conds').onclick = e => { const b = e.target.closest('.chip'); if (b) { P.cond = b.dataset.v; render(); } };
  $('#swatches').innerHTML = RINGS.map(c => `<button class="sw" style="--s:${c}" data-v="${c}" aria-label="Ring color ${c}"></button>`).join('');
  $('#swatches').onclick = e => { const b = e.target.closest('.sw'); if (b) { S.ring = b.dataset.v; saveSettings(); render(); } };
  for (const id of ['motion', 'icons']) $('#' + id).onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    S[id] = b.dataset.v; saveSettings(); if (id === 'motion') buildStage(); else render();
  };
  $('#source').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    P.source = b.dataset.v; if (P.source === 'live' && liveState === 'offline') fetchWeather(); render();
  };
  for (const id of ['temp', 'hum', 'hour']) { const r = $('#' + id); r.value = P[id]; r.oninput = () => { P[id] = +r.value; render(); }; }
  for (const id of ['thick', 'track', 'glow']) { const r = $('#' + id); r.value = S[id]; r.oninput = () => { S[id] = +r.value; saveSettings(); render(); }; }
  $('#name').value = S.name;
  $('#name').oninput = e => { S.name = e.target.value; saveSettings(); render(); };
  $('#replay').onclick = buildStage;   // remounting replays every intro animation
  if (document.fullscreenEnabled) $('#full').onclick = () => $('#wallWrap').requestFullscreen().catch(() => {});
  else $('#full').hidden = true;
  bindCitySearch();
}

/* ---------- city search (Open-Meteo geocoding, free, no key) ---------- */
function bindCitySearch() {
  let suggestions = [], timer, n = 0;
  const show = (list, q) => {
    suggestions = list;
    const ul = $('#sugg');
    ul.hidden = !q;
    ul.innerHTML = list.length ? list.map((c, i) => `<li><button type="button" data-i="${i}">${esc(c.name)} <span>· ${esc(c.admin)}</span></button></li>`).join('')
      : `<li class="none">No city called “${esc(q)}” found</li>`;
  };
  const search = async q => {
    const mine = ++n; let list;
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      list = (j.results || []).map(x => ({ name: x.name, admin: [x.admin1, x.country_code].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude }));
    } catch (e) {   // offline or blocked: search the built-in list instead
      const ql = q.toLowerCase(); list = CITIES.filter(c => c.name.toLowerCase().includes(ql));
    }
    if (mine === n) show(list, q);
  };
  $('#city').value = S.city.name;
  $('#city').oninput = e => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) { show([], ''); return; }
    timer = setTimeout(() => search(q), 300);
  };
  $('#sugg').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    S.city = suggestions[+b.dataset.i]; $('#city').value = S.city.name; show([], '');
    saveSettings(); live = null; liveState = 'loading'; render(); fetchWeather();
  };
}


/* ---------- self-check of the logic that's easy to break (results in the browser console) ---------- */
function selfTest() {
  const ok = console.assert;
  const b = { x: 0, y: 0, w: 100, h: 100 };
  moveResize(b, Object.assign({}, b), 13, -50, '', 200, 200);
  ok(b.x === 16 && b.y === 0, 'move snaps to 8 px and stays inside', b);
  moveResize(b, Object.assign({}, b), 500, 0, 'se', 200, 200);
  ok(b.x === 16 && b.w === 184, 'resize stops at the parent edge', b);
  moveResize(b, Object.assign({}, b), 500, 0, 'nw', 200, 200);
  ok(b.w === MIN && b.x === 152, 'resize keeps the minimum size', b);
  ok(['clear', 'partly', 'cloud', 'fog', 'rain', 'rain', 'cloud', 'thunder'].join() === [0, 2, 3, 45, 63, 81, 73, 96].map(codeToCond).join(), 'weather codes map to icons');
  const quad = [[100, 50], [700, 120], [60, 500], [720, 430]], H = homography(FULL, quad);
  ok(FULL.every((p, i) => { const q = applyH(H, p[0], p[1]); return Math.abs(q[0] - quad[i][0]) < 1e-6 && Math.abs(q[1] - quad[i][1]) < 1e-6; }), 'warp maps the wall corners onto the warp corners');
  const back = applyH(homography(quad, FULL), ...applyH(H, 123, 77));
  ok(Math.abs(back[0] - 123) < 1e-6 && Math.abs(back[1] - 77) < 1e-6, 'reverse warp round-trips');
  ok(validQuad(quad) && !validQuad([[0, 0], [100, 0], [100, 100], [0, 100]]) && !validQuad([[0, 0], [0, 0], [0, 9], [9, 9]]), 'folded or collapsed warps are refused');
  ok(inQuad(quad, [400, 300]) && !inQuad(quad, [20, 20]), 'inside-the-picture test');
  const m = migrate({ screens: [{ x: 100, y: 50, widgets: [{ id: 'a', x: 8, y: 16 }] }] });
  ok(!m.warp && m.widgets[0].x === 108 && m.widgets[0].y === 66, 'old screen layouts fold onto one wall', m);
}

/* ---------- public API ---------- */
let booted = false;
window.BearWall = {
  util,
  register(m) {
    types[m.type] = m;
    if (m.css) { const st = document.createElement('style'); st.textContent = m.css; document.head.appendChild(st); }
    if (booted) { normalize(); buildStage(); }
  },
  boot() {
    if (booted) return;
    booted = true;
    stage = $('#stage'); stageBox = $('#stageBox'); wallEl = $('#wall');
    selfTest();
    normalize();
    bindStage(); bindControls();
    buildStage();
    fetchWeather();
    setInterval(fetchWeather, 10 * 60 * 1000);
    setInterval(() => {   // widgets with `every` refresh on their own clock
      const t = Date.now(), due = inst.filter(i => i.m.every && t - i.last >= i.m.every - 100);
      if (!due.length) return;
      const now = timeNow(), weather = weatherNow(now);
      due.forEach(i => updateInst(i, now, weather));
    }, 1000);
  },
  _test: { homography, applyH, validQuad, inQuad, get layout() { return L; } }
};
})();
