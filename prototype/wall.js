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
 *   family: 'clock',                  // optional: makes this module a style of the 'clock' widget instead of its own widget
 *   styleName: 'Date',                // its tab in the Style row (a parent without a `style` option uses its own styleName)
 *   when: 'laptop',                   // optional: default "Show when" for new widgets ('always' | 'laptop' | 'phone')
 *   size: { square: [240, 240], rect: [464, 104] },   // default box in wall px for each mode
 *   options: [                        // per-widget settings, shown in the Layout card when the widget is selected
 *     { key: 'style', label: 'Style', type: 'tabs', choices: [['digital', 'Digital'], ['analog', 'Analog']], value: 'digital' },
 *     { key: 'h24', label: '24-hour time', type: 'switch', value: false },
 *     { key: 'title', label: 'Title', type: 'text', value: '' },          // also type 'date' ('YYYY-MM-DD') and 'time' ('HH:MM')
 *     { key: 'tz', label: 'Zone', type: 'select', choices: [['', 'Off'], ['Asia/Tokyo', 'Tokyo']], value: '' },
 *   ],                                // tabs/select values are strings; switch values are booleans
 *   every: 1000,                      // optional: also call update() every this many ms (a clock wants 1000)
 *   keepAspect: true,                 // optional: resizing keeps the box's proportions; Shift + resize changes them (crops)
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
 * Don't reuse the page's class names inside widgets (glass, sel, on, row, note, sub, lbl, tabs, btn, field, chip, sw, section):
 * they carry page styles such as the card blur.
 * Black is no light: keep backgrounds transparent. Strokes >= 2px and text >= ~18px at 1280x720 wall size.
 *
 * ctx = {
 *   mode: 'square' | 'rect', anchor: 'left' | 'right',
 *   opts,        // this widget's option values, by key
 *   now,         // Date. Follows the sample time-of-day slider in Sample mode.
 *   motion,      // 'full' | 'lite' | 'calm' | 'off'
 *   look,        // this widget's own look: { ring, thick, track, glow, icons }. Already applied as the CSS variables
 *                // --ring, --thick, --track, --glow and data-icons on the widget, so CSS can just use var(--ring) etc.
 *   settings,    // shared settings: { name } (the greeting name)
 *   city,        // { name, admin, lat, lon }
 *   weather: { live, cond, temp, hum, feels, hi, lo, night, sunrise: Date, sunset: Date,
 *              hourly: [{ time: Date, temp, cond, night, pop }] },   // next 24 h from this hour, pop = rain chance %
 *   devices: { laptop, phone, phoneSince: Date | null, mic, cam },  // which devices are on the network (simulated
 *                // from the Devices card until the projector app / PC agent detect them); mic/cam = On Air state
 *   alerts: [{ id, kind: 'network' | 'projector' | 'security' | 'update', level: 'info' | 'warning' | 'critical',
 *              title, detail, since: Date }],   // active alerts; empty when all is well
 * }
 * Each saved widget also has `when` ('always' | 'laptop' | 'phone'): it only shows while that device is connected.
 * cond is one of 'clear' | 'partly' | 'cloud' | 'rain' | 'thunder' | 'fog'. Temperatures are whole °C.
 *
 * Sections: every widget lives in a section (`w.section`, default 'wall' = the whole picture) and its x/y/w/h/quad
 * are in that section's own flat space. Widgets don't need to care; the runtime places and warps them.
 * Backgrounds: BearWall.registerBackground({ type, name, options, every, css, mount(el, ctx), update(el, ctx) }) adds a
 * section background (e.g. the Window). el fills the section and has --u; ctx = { now, weather, motion, opts, settings, city }.
 * Photos: an option of type 'photos' gives an upload + thumbnails control; its value is an array of photo ids.
 *
 * BearWall.util:
 *   iconSVG(cond, night)       -> weather icon <svg> (64x64 viewBox, natural colors, animated by motion level)
 *   ringHTML(innerHTML)        -> '<div class="ring">…<div class="tp">innerHTML</div></div>' (the shared ring)
 *   setRing(ringEl, percent)   -> set the ring's fill 0-100 (animates on change, follows the ring settings)
 *   countTo(el, n, motion)     -> show a whole number, counting up to it when it changes
 *   typeOut(el, text, motion)  -> typewriter text with the blinking cursor; layout never jumps
 *   fit(el)                    -> shrink every `.fit` line inside el so it fits its width (down to 50%)
 *   fmtTime(date, h24)         -> '7:05 PM' or '19:05'
 *   photoURL(id)               -> Promise of an object URL for a stored photo (or null)
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
    const thick = parseFloat(getComputedStyle(ringEl).getPropertyValue('--thick')) || 9;   // this widget's own look
    const r = 50 - thick / 2 - 1, arc = ringEl.querySelector('.arc');
    ringEl.querySelectorAll('.trk, .arc').forEach(c => c.setAttribute('r', r));   // only the ring, not content in its center
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
const bgTypes = {};                          // section backgrounds (Window, ...)
// Widgets sit on one wall in wall px (1280x720). A widget may have a `quad`: its 4 corners on the wall,
// ordered [top-left, top-right, bottom-left, bottom-right]; its flat w x h content is warped onto them.
// a fresh wall is empty: you draw sections, then put widgets in them
const DEFAULT_LAYOUT = { windowOn: false, sections: [], widgets: [] };
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
const LOOK_KEYS = ['ring', 'text', 'dim', 'icon', 'thick', 'track', 'glow', 'icons'];
// icons: 'natural' | 'white' | 'ring' | 'custom' (custom uses the `icon` color)
const DEFAULT_LOOK = { ring: '#5ee6ff', text: '#f4f7ff', dim: '#a6a6a6', icon: '#ffd84d', thick: 9, track: .18, glow: .5, icons: 'natural' };
const COLOR_PRESETS = ['#5ee6ff', '#7dffa8', '#ffd84d', '#ff7ac6', '#b18cff', '#ffa24d', '#ff5e5e', '#5b8cff', '#ffffff', '#a6a6a6'];
const DEFAULT_SETTINGS = { city: CITIES[0], name: '', motion: 'full' };

let L = store.get('layout', null);
const savedSettings = store.get('settings', null);
const S = Object.assign(copy(DEFAULT_SETTINGS), savedSettings || {});
if (!savedSettings && matchMedia('(prefers-reduced-motion: reduce)').matches) S.motion = 'calm';
const P = { source: 'live', cond: 'partly', temp: 31, hum: 74, hour: 19.5 };   // sample values, not saved
let live = null, liveState = 'loading';   // loading | live | offline
let sel = null;                           // selected widget id; none = View
let selSec = null;                        // selected section id (a widget and a section are never both selected)
let corner = 0, shiftHeld = false;   // warp editing
// Phase 2 preview: devices on the network (simulated switches for now) and active alerts
const DEV = Object.assign({ laptop: false, phone: false, phoneSince: null, mic: false, cam: false }, store.get('devices', {}));
const saveDevices = () => store.set('devices', DEV);
const devicesNow = () => ({ laptop: !!DEV.laptop, phone: !!DEV.phone, phoneSince: DEV.phoneSince ? new Date(DEV.phoneSince) : null, mic: !!DEV.mic, cam: !!DEV.cam });
const shownNow = w => !w.when || w.when === 'always' || !!DEV[w.when];
let alerts = [];
const inPanel = q => q.every(([x, y]) => x >= 0 && x <= WALL_W && y >= 0 && y <= WALL_H);
const saveLayout = () => store.set('layout', L);
const saveSettings = () => store.set('settings', S);
const widgetOf = id => L.widgets.find(w => w.id === id);
const sectionOf = id => L.sections.find(s => s.id === id);
const defaultOpts = m => Object.fromEntries((m.options || []).map(o => [o.key, o.value]));

// Older saved layouts had several "screens"; fold their widgets onto the one wall at the same spots.
function migrate(old) {
  if (!old || !Array.isArray(old.screens)) return old;
  return { widgets: old.screens.flatMap(s => (Array.isArray(s.widgets) ? s.widgets : [])
    .map(w => Object.assign({}, w, { x: (+w.x || 0) + (+s.x || 0), y: (+w.y || 0) + (+s.y || 0) }))) };
}
// the look the whole wall used to share; it becomes each widget's starting look
const oldLook = Object.fromEntries(LOOK_KEYS.filter(k => savedSettings && savedSettings[k] != null).map(k => [k, savedSettings[k]]));
// square or one-row rectangle, from the box's proportions (sticky between 2.0x and 2.4x so it doesn't flicker while resizing)
function autoMode(w) {
  const r = w.w / w.h;
  return r >= 2.4 ? 'rect' : r < 2.0 ? 'square' : (w.mode === 'rect' ? 'rect' : 'square');
}
function normalize() {
  L = migrate(L);
  if (!L || !Array.isArray(L.widgets)) L = copy(DEFAULT_LAYOUT);
  delete L.warp;   // the old whole-wall warp; widgets warp one by one now
  // sections: every widget lives in one. Older saves had a built-in "Wall" section or no sections at all;
  // those widgets end up in an ordinary section called "Main" that covers the whole picture.
  L.sections = Array.isArray(L.sections) ? L.sections.filter(x => x && x.id) : [];
  const oldBase = L.sections.find(x => x.id === 'wall' && x.name === 'Wall');
  if (oldBase) oldBase.name = 'Main';
  const main = () => sectionOf('main') || sectionOf('wall') || (L.sections.push({ id: 'main', name: 'Main', x: 0, y: 0, w: WALL_W, h: WALL_H, bg: 'none', bgOpts: {} }), sectionOf('main'));
  for (const x of L.sections) {
    for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(x[k])) x[k] = k === 'w' ? 480 : k === 'h' ? 320 : 0;
    fitInside(x, WALL_W, WALL_H);
    if (x.quad && !(validQuad(x.quad) && inPanel(x.quad))) delete x.quad;
    x.name = String(x.name || 'Section');
    x.bg = typeof x.bg === 'string' ? x.bg : 'none';
    x.bgOpts = Object.assign(bgTypes[x.bg] ? defaultOpts(bgTypes[x.bg]) : {}, x.bgOpts);
  }
  L.windowOn = !!L.windowOn;
  for (const w of L.widgets) {
    if (!sectionOf(w.section)) w.section = main().id;
    const sp = sectionOf(w.section);
    for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(w[k])) w[k] = k === 'w' || k === 'h' ? 240 : 0;
    fitInside(w, sp.w, sp.h);
    if (w.quad) {   // widgets don't warp any more (their section does): keep the spot, drop the bend
      const xs = w.quad.map(p => +p[0]), ys = w.quad.map(p => +p[1]);
      if (xs.concat(ys).every(Number.isFinite)) { w.x = Math.min(...xs); w.y = Math.min(...ys); }
      delete w.quad; fitInside(w, sp.w, sp.h);
    }
    w.mode = autoMode(w);
    w.anchor = w.anchor === 'left' ? 'left' : 'right';
    w.when = ['laptop', 'phone'].includes(w.when) ? w.when : 'always';
    if (known(w)) w.opts = Object.assign(defaultOpts(types[w.type]), w.opts);   // unknown types are kept but not shown
    w.look = Object.assign({}, DEFAULT_LOOK, oldLook, w.look);   // older saves had one look for the whole wall
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

/* ---------- the wall: sections hold widgets ---------- */
// View: nothing selected. Arrange: a widget or section selected (move, resize). Warp: hold Shift.
// A section is an area of the projected picture (the base "Wall" section covers all of it). It can be warped onto a
// real surface with its 4 corners; its widgets lay out flat inside it and bend with it. Double-click a section to go
// inside it: it fills the preview flat, so you can place its widgets without the warp in the way.
let stage, stageBox, wallEl, inst = [], bgInst = [];
let inside = null;                         // id of the section you're inside, or null
const HANDLES = ['nw', 'ne', 'sw', 'se'].map(h => `<i class="handle" data-h="${h}"></i>`).join('');
const selW = () => (sel && widgetOf(sel)) || null;
const selS = () => (selSec && sectionOf(selSec)) || null;
const target = () => selW() || selS();     // what's selected: a widget or a section
const warpOn = () => !!selS() && shiftHeld && !inside;   // only sections warp; their widgets bend with them
const isSec = t => !!t && !t.type;         // sections have no widget type
const spaceOf = t => isSec(t) ? { w: WALL_W, h: WALL_H } : sectionOf(t.section);   // the box a thing lives in
const quadOf = t => t.quad || rectPts(t.x, t.y, t.w, t.h);
const secEl = s => wallEl.querySelector(`.section[data-sid="${s.id}"]`);
const widEl = w => wallEl.querySelector(`.widget[data-wid="${w.id}"]`);
const windowed = s => L.windowOn && s.bg !== 'none' && !!bgTypes[s.bg];

function place(el, b, pw, ph) {
  el.style.left = b.x / pw * 100 + '%'; el.style.top = b.y / ph * 100 + '%';
  el.style.width = b.w / pw * 100 + '%'; el.style.height = b.h / ph * 100 + '%';
}
// how a section sits in the preview while you're inside it: flat, as large as fits, centered (panel px)
function insideFit(s) {
  const k = Math.min(WALL_W / s.w, WALL_H / s.h);
  return { k, ox: (WALL_W - s.w * k) / 2, oy: (WALL_H - s.h * k) / 2 };
}
// a point in a section's own flat space -> panel px (where it shows in the preview)
function localToPanel(s, [x, y]) {
  if (inside === s.id) { const f = insideFit(s); return [f.ox + x * f.k, f.oy + y * f.k]; }
  if (s.quad) return applyH(homography(rectPts(0, 0, s.w, s.h), s.quad), x, y);
  return [s.x + x, s.y + y];
}
// panel px -> a section's own flat space (undoes its warp, or the inside zoom)
function panelToLocal(s, [x, y]) {
  if (inside === s.id) { const f = insideFit(s); return [(x - f.ox) / f.k, (y - f.oy) / f.k]; }
  if (s.quad) return applyH(homography(s.quad, rectPts(0, 0, s.w, s.h)), x, y);
  return [x - s.x, y - s.y];
}
// where a thing's points are measured: sections in panel px, widgets in their section's flat space
const toSpace = (t, p) => isSec(t) ? p : panelToLocal(sectionOf(t.section), p);
const fromSpace = (t, p) => isSec(t) ? p : localToPanel(sectionOf(t.section), p);

function positionSection(s) {
  const el = secEl(s);
  if (!el) return;
  el.classList.toggle('warped', !!s.quad && inside !== s.id);
  el.classList.toggle('is-inside', inside === s.id);
  el.classList.toggle('win-on', windowed(s));
  el.dataset.label = s.name + (windowed(s) ? ' · window' : '');
  const pw = stage.clientWidth, ph = stage.clientHeight;
  if (inside === s.id) {
    const f = insideFit(s);
    el.style.transform = '';
    place(el, { x: f.ox, y: f.oy, w: s.w * f.k, h: s.h * f.k }, WALL_W, WALL_H);
  } else if (s.quad) {   // lay out flat at its own size, then one homography maps it onto its 4 corners
    Object.assign(el.style, { left: 0, top: 0, width: s.w * pw / WALL_W + 'px', height: s.h * ph / WALL_H + 'px',
      transform: matrix3d(homography(rectPts(0, 0, s.w * pw / WALL_W, s.h * ph / WALL_H), s.quad.map(([x, y]) => [x * pw / WALL_W, y * ph / WALL_H]))) });
  } else {
    el.style.transform = '';
    place(el, s, WALL_W, WALL_H);
  }
  L.widgets.filter(w => w.section === s.id && known(w)).forEach(positionWidget);
}
// A warped widget lays out flat at its own w x h, then a homography maps it onto its 4 corners (in its section's space).
// Widgets lay out flat inside their section; the section's warp bends them.
function positionWidget(w) {
  const el = widEl(w), s = sectionOf(w.section);
  if (!el || !s) return;
  place(el, w, s.w, s.h);
  el.dataset.label = types[w.type].name;
  applyLook(w, el);
}
const positionAll = () => L.sections.forEach(positionSection);
const LOOK_VARS = { ring: '--ring', text: '--w-text', dim: '--w-dim', icon: '--i-custom', thick: '--thick', track: '--track', glow: '--glow' };
function applyLook(w, el) {
  for (const [k, v] of Object.entries(LOOK_VARS)) el.style.setProperty(v, w.look[k]);
  el.dataset.icons = w.look.icons;
}
function drawWarpUI() {
  const ui = $('#warpui'), t = selS(), on = warpOn(), w = selW();
  ui.hidden = !on;
  wallEl.querySelectorAll('.warping').forEach(el => el.classList.remove('warping'));
  if (on) secEl(t).classList.add('warping');
  $('#undo').disabled = !undo.length;
  $('#flatten').disabled = !(t && t.quad);
  $('#warpState').textContent = w ? (types[w.type].keepAspect ? 'Widgets bend with their section. Hold Shift while resizing this one to crop it.' : 'Widgets bend with their section. Select a section and hold Shift to warp it.')
    : !t ? 'Select a section on the wall, then hold Shift to warp it.'
    : inside ? 'Go back to the wall to warp this section.'
    : on ? `Warping “${t.name}”. Drag the colored corners.` : `Hold Shift to warp “${t.name}”.`;
  if (!t) { $('#readout').textContent = '–'; return; }
  const q = quadOf(t);
  $('#readout').textContent = `${CORNERS[corner]} · ${q[corner].map(Math.round).join(', ')}`;
  if (!on) return;
  const P = q.map(p => fromSpace(t, p)), pct = (x, y) => [x / WALL_W * 100 + '%', y / WALL_H * 100 + '%'];
  ui.querySelector('polygon').setAttribute('points', [0, 1, 3, 2].map(i => P[i].join(',')).join(' '));
  ui.querySelectorAll('.ch').forEach(h => { const i = +h.dataset.i; [h.style.left, h.style.top] = pct(...P[i]); h.classList.toggle('on', i === corner); });
  ui.querySelectorAll('.eh').forEach(h => { const [a, b] = EDGES[+h.dataset.e], m = fromSpace(t, [(q[a][0] + q[b][0]) / 2, (q[a][1] + q[b][1]) / 2]); [h.style.left, h.style.top] = pct(...m); });
}

function buildStage() {
  inst.forEach(i => i.ro.disconnect()); bgInst.forEach(b => b.ro.disconnect());
  if (inside && !sectionOf(inside)) inside = null;
  wallEl.innerHTML = L.sections.map(s => `<div class="section" data-sid="${esc(s.id)}"><div class="sbg"></div>`
    + L.widgets.filter(w => w.section === s.id && known(w)).map(w => `<div class="widget frame" data-wid="${esc(w.id)}"><div class="wgt"></div>${HANDLES}</div>`).join('')
    + HANDLES + '</div>').join('');
  const observe = (el, i) => {
    i.ro = new ResizeObserver(() => {   // layout size, not the warped on-screen size
      el.style.setProperty('--u', Math.min(el.offsetWidth, el.offsetHeight) / 100 + 'px');
      if (i.mounted) i.redo();
    });
    i.ro.observe(el);
  };
  inst = L.widgets.filter(known).map(w => {
    const el = wallEl.querySelector(`.widget[data-wid="${w.id}"] > .wgt`);
    const i = { w, m: types[w.type], el, last: 0, mounted: false };
    i.redo = () => updateInst(i);
    observe(el, i);
    return i;
  });
  bgInst = L.sections.map(s => {
    const el = secEl(s).querySelector('.sbg'), i = { s, el, last: 0, mounted: false, type: null };
    i.redo = () => updateBg(i);
    observe(el, i);
    return i;
  });
  positionAll();
  render();
}

function updateInst(i, now = timeNow(), weather = weatherNow(now)) {
  const ctx = { mode: i.w.mode, anchor: i.w.anchor, opts: i.w.opts, look: i.w.look, now, motion: S.motion, settings: S, city: S.city, weather,
    devices: devicesNow(), alerts };
  i.el.className = `wgt w-${i.w.type} ${i.w.mode} ${i.w.anchor}`;
  try {
    if (!i.mounted) { i.m.mount(i.el, ctx); i.mounted = true; }
    i.m.update(i.el, ctx);
  } catch (e) { console.error(`widget "${i.w.type}" failed:`, e); }
  i.last = Date.now();
}
// a section's background (e.g. the Window): mounted only while Window mode is on for that section
function updateBg(i, now = timeNow(), weather = weatherNow(now)) {
  const s = i.s, m = windowed(s) ? bgTypes[s.bg] : null;
  if (!m) { if (i.type) { i.el.innerHTML = ''; i.el.className = 'sbg'; i.type = null; i.mounted = false; } return; }
  if (i.type !== m.type) { i.el.innerHTML = ''; i.type = m.type; i.mounted = false; }
  const ctx = { now, weather, motion: S.motion, opts: s.bgOpts, settings: S, city: S.city };
  i.el.className = `sbg bg-${m.type}`;
  try {
    if (!i.mounted) { m.mount(i.el, ctx); i.mounted = true; }
    m.update(i.el, ctx);
  } catch (e) { console.error(`background "${m.type}" failed:`, e); }
  i.last = Date.now();
}

function render() {
  const now = timeNow(), weather = weatherNow(now);
  inst.forEach(i => updateInst(i, now, weather));
  bgInst.forEach(i => updateBg(i, now, weather));
  // Show when: hidden in View, faint while arranging (see style.css)
  inst.forEach(i => { const el = widEl(i.w); if (el) el.classList.toggle('off', !shownNow(i.w)); });
  L.sections.forEach(s => { const el = secEl(s); if (el) { el.classList.toggle('win-on', windowed(s)); el.dataset.label = s.name + (windowed(s) ? ' · window' : ''); } });
  renderGallery(now, weather);
  renderControls();
}
// everything that depends on the selection, without re-rendering the widgets
function renderChrome() {
  stage.className = `stage m-${S.motion}` + (target() || inside ? ' sel-on' : '') + (inside ? ' inside' : '');
  stageBox.classList.toggle('editing', !!target() || !!inside);
  wallEl.querySelectorAll('.section.sel').forEach(el => el.classList.remove('sel'));
  const s = selS();
  if (s) secEl(s).classList.add('sel');
  renderSel();
  renderSections();
  drawWarpUI();
}

/* ---------- warp editing (same moves as the keystone page, on the selected widget or section) ---------- */
let undo = [], lastPush = 0, lastKind = null, lastId = null;
// Each drag is one undo step; a run of nudges (or of scrolls) on one thing within 700 ms shares one.
function pushUndo(kind, t) {
  const now = Date.now(), grouped = kind && kind === lastKind && t.id === lastId && now - lastPush < 700;
  lastPush = now; lastKind = kind || null; lastId = t.id;
  if (grouped) return;
  undo.push({ id: t.id, sec: isSec(t), quad: t.quad ? copy(t.quad) : null });
  if (undo.length > 50) undo.shift();
}
function doUndo() {
  const u = undo.pop(), t = u && (u.sec ? sectionOf(u.id) : widgetOf(u.id));
  if (!t) return drawWarpUI();
  if (u.quad) t.quad = u.quad; else delete t.quad;
  reposition(t); saveLayout(); drawWarpUI();
}
const reposition = t => isSec(t) ? positionSection(t) : positionWidget(t);
const clampIn = (t, [x, y]) => { const sp = spaceOf(t); return [clamp(Math.round(x), 0, sp.w), clamp(Math.round(y), 0, sp.h)]; };
const inBounds = (q, sp) => q.every(([x, y]) => x >= 0 && x <= sp.w && y >= 0 && y <= sp.h);
// Accept a new shape only if it stays inside its space and isn't folded or mirrored.
function setQuad(t, q) {
  q = q.map(p => p.map(Math.round));
  if (!validQuad(q) || !inBounds(q, spaceOf(t))) return false;
  t.quad = q; reposition(t); drawWarpUI();
  return true;
}
function moveAll(t, q0, dx, dy) {
  const xs = q0.map(p => p[0]), ys = q0.map(p => p[1]), sp = spaceOf(t);
  dx = clamp(dx, -Math.min(...xs), sp.w - Math.max(...xs)); dy = clamp(dy, -Math.min(...ys), sp.h - Math.max(...ys));
  return setQuad(t, q0.map(([x, y]) => [x + dx, y + dy]));
}
function zoom(t, q0, f) {
  const cx = q0.reduce((a, p) => a + p[0], 0) / 4, cy = q0.reduce((a, p) => a + p[1], 0) / 4;
  return setQuad(t, q0.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]));
}
function nudge(dx, dy) {
  const t = selS();
  if (!t) return;
  pushUndo('nudge', t);
  const q = copy(quadOf(t));
  q[corner] = clampIn(t, [q[corner][0] + dx, q[corner][1] + dy]);
  setQuad(t, q); saveLayout();
}
function flatten(t) {   // back to a plain box where the warp's top-left was
  if (!t || !t.quad) return;
  const sp = spaceOf(t);
  pushUndo(null, t);
  t.x = clamp(snap(Math.min(...t.quad.map(p => p[0]))), 0, sp.w - t.w);
  t.y = clamp(snap(Math.min(...t.quad.map(p => p[1]))), 0, sp.h - t.h);
  delete t.quad;
  reposition(t); saveLayout(); drawWarpUI();
}
// point inside the convex quad (walk it clockwise: every edge keeps the point on its right)
function inQuad(q, [x, y]) {
  const P = [q[0], q[1], q[3], q[2]];
  return P.every((a, i) => { const b = P[(i + 1) % 4]; return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0; });
}

/* ---------- controls ---------- */
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
  document.querySelectorAll('#conds .chip').forEach(b => b.classList.toggle('on', b.dataset.v === P.cond));
  onTabs('source', P.source); onTabs('motion', S.motion);
  $('#motionNote').textContent = NOTES[S.motion];
  renderChrome();
}

function renderSel() {
  wallEl.querySelectorAll('.widget.sel').forEach(f => f.classList.remove('sel'));
  const w = selW();
  if (!w || !known(w)) sel = null;
  if (sel) wallEl.querySelector(`.widget[data-wid="${w.id}"]`).classList.add('sel');
  $('#selName').textContent = sel ? styleTitle(w) + (w.quad ? ' · warped' : '') : 'Nothing selected · click a widget on the wall';
  $('#widgetTools').hidden = !sel;
  renderLook(sel ? w : null);
  if (sel) {
    onTabs('wAnchor', w.anchor); onTabs('wWhen', w.when);
    $('#anchorRow').hidden = w.mode !== 'rect';
    renderStyles(w);
    renderOpts(w);
    $('#wSectionRow').hidden = L.sections.length < 2;
    $('#wSection').innerHTML = L.sections.map(x => `<option value="${esc(x.id)}"${x.id === w.section ? ' selected' : ''}>${esc(x.name)}</option>`).join('');

  }
}

// the Look card: colors (picker + presets), ring sizes and icon colors of the selected widget
function renderLook(w) {
  $('#lookTools').hidden = !w;
  $('#lookState').textContent = w ? `${parentOf(types[w.type]).name}'s own colors and ring.` : 'Select a widget to change its look.';
  if (!w) return;
  const look = w.look;
  document.querySelectorAll('.colorrow').forEach(row => {
    const v = look[row.dataset.look], pick = row.querySelector('.cpick');
    if (document.activeElement !== pick) pick.value = v;
    row.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  });
  $('#iconRow').hidden = look.icons !== 'custom';
  for (const k of ['thick', 'track', 'glow']) { const r = $('#w' + k[0].toUpperCase() + k.slice(1)); if (document.activeElement !== r) r.value = look[k]; }
  $('#wThickVal').textContent = look.thick; $('#wTrackVal').textContent = Math.round(look.track * 200) + '%'; $('#wGlowVal').textContent = Math.round(look.glow * 100) + '%';
  onTabs('wIcons', look.icons);
}
function setLook(k, v) {
  const w = selW();
  if (!w) return;
  w.look[k] = v; saveLayout();
  applyLook(w, wallEl.querySelector(`.widget[data-wid="${w.id}"]`));
  const i = inst.find(x => x.w === w);
  if (i) updateInst(i);   // the ring radius follows the thickness
  renderLook(w);
}

// the Add gallery: a live, still preview of every widget (styles of a widget are picked after adding it)
function buildGallery() {
  $('#gallery').innerHTML = Object.values(types).filter(m => !m.family).map(m => `<button class="gitem" data-type="${esc(m.type)}" title="Add ${esc(m.name)}"><div class="gprev" data-icons="${DEFAULT_LOOK.icons}"><div class="wgt" style="--ar:${m.size.square[0]} / ${m.size.square[1]}"></div></div>${esc(m.name)}</button>`).join('');
  $('#gallery').querySelectorAll('.gitem').forEach(b => {
    const el = b.querySelector('.wgt');
    new ResizeObserver(() => { el.style.setProperty('--u', Math.min(el.offsetWidth, el.offsetHeight) / 100 + 'px'); renderGallery(); }).observe(el);
  });
}
function renderGallery(now = timeNow(), weather = weatherNow(now)) {
  $('#gallery').querySelectorAll('.gitem').forEach(b => {
    const m = types[b.dataset.type], el = b.querySelector('.wgt');
    const ctx = { mode: 'square', anchor: 'right', opts: defaultOpts(m), look: DEFAULT_LOOK, now, motion: 'off', settings: S, city: S.city, weather,
      devices: { laptop: true, phone: false, phoneSince: null, mic: true, cam: false }, alerts: PREVIEW_ALERTS };
    el.className = `wgt w-${m.type} square right`;
    try { if (!el._mounted) { m.mount(el, ctx); el._mounted = true; } m.update(el, ctx); } catch (e) { console.error(`preview "${m.type}" failed:`, e); }
  });
}

// Styles: a widget's own `style` choices plus every module that names it as its `family`.
const parentOf = m => (m.family && types[m.family]) || m;
function stylesOf(p) {
  const own = (p.options || []).find(o => o.key === 'style' && o.type === 'tabs');
  const list = own ? own.choices.map(([v, n]) => ({ label: n, type: p.type, style: v })) : [{ label: p.styleName || p.name, type: p.type }];
  return list.concat(Object.values(types).filter(m => m.family === p.type).map(m => ({ label: m.styleName || m.name, type: m.type })));
}
const activeStyle = (list, w) => list.findIndex(s => s.type === w.type && (s.style == null || s.style === w.opts.style));
function styleTitle(w) {
  const p = parentOf(types[w.type]), list = stylesOf(p), s = list[activeStyle(list, w)];
  return p.name + (list.length > 1 && s ? ' · ' + s.label : '');
}
function renderStyles(w) {
  const box = $('#wStyle'), p = parentOf(types[w.type]);
  if (box._for !== p.type) { box._for = p.type; box._list = stylesOf(p); box.innerHTML = box._list.map((s, i) => `<button data-i="${i}">${esc(s.label)}</button>`).join(''); }
  const act = activeStyle(box._list, w);
  box.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === act));
}
// switch style in place: keeps position, size, look and warp
function setStyle(s) {
  const w = selW();
  if (!w) return;
  if (s.type !== w.type) w.opts = defaultOpts(types[s.type]);
  w.type = s.type;
  if (s.style != null) w.opts.style = s.style;
  saveLayout(); buildStage();
}

// per-widget settings, drawn from the module's `options` (a `style` tabs option is shown in the Style row instead)
function optHTML(o) {
  const k = esc(o.key), label = esc(o.label);
  if (o.type === 'tabs') return `<div class="lbl"><span>${label}</span></div><div class="tabs" data-k="${k}">${o.choices.map(([v, n]) => `<button data-v="${esc(v)}">${esc(n)}</button>`).join('')}</div>`;
  if (o.type === 'switch') return `<label class="row">${label}<input type="checkbox" class="switch" data-k="${k}"></label>`;
  if (o.type === 'photos') return `<div class="lbl"><span>${label}</span></div><div class="photos" data-k="${k}"><div class="thumbs"></div><label class="btn quiet addph">Add photos<input type="file" accept="image/*" multiple hidden data-photos="${k}"></label></div>`;
  if (o.type === 'select') return `<div class="lbl"><span>${label}</span></div><select class="field" data-k="${k}" aria-label="${label}">${o.choices.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('')}</select>`;
  const type = o.type === 'date' || o.type === 'time' ? o.type : 'text';
  return `<div class="lbl"><span>${label}</span></div><input class="field" type="${type}" data-k="${k}" maxlength="80" autocomplete="off" aria-label="${label}">`;
}
function renderOpts(w) {
  const box = $('#widgetOpts'), opts = (types[w.type].options || []).filter(o => !(o.key === 'style' && o.type === 'tabs'));
  const key = w.id + ':' + w.type;   // rebuild when the widget or its type changes
  if (box._for !== key) { box._for = key; box.innerHTML = opts.map(optHTML).join(''); }
  for (const o of opts) {
    const v = w.opts[o.key];
    if (o.type === 'tabs') { box.querySelectorAll(`.tabs[data-k="${o.key}"] button`).forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); continue; }
    if (o.type === 'photos') { renderPhotoThumbs(box, o.key, Array.isArray(v) ? v : []); continue; }
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

function select(id) { if (id !== sel) corner = 0; sel = id; if (id) selSec = null; renderChrome(); }
function selectSection(id) { if (id !== selSec) corner = 0; selSec = id; if (id) sel = null; renderChrome(); }
const panelPt = e => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) * WALL_W / r.width, (e.clientY - r.top) * WALL_H / r.height]; };
function enterSection(id) { inside = id; sel = null; selSec = null; positionAll(); renderChrome(); }
function leaveSection() { const id = inside; inside = null; positionAll(); selSec = id; renderChrome(); }

function deleteSelected() {
  const s = selS();
  if (s) return $('#secDel').click();   // same two-step as the button when it has widgets
  if (!sel) return;
  L.widgets = L.widgets.filter(w => w.id !== sel);
  sel = null; saveLayout(); buildStage();
}
// the section new widgets go into: the one you're inside, the selected one, the selected widget's, or the whole wall
const homeSection = () => sectionOf(inside) || selS() || (selW() && sectionOf(selW().section)) || L.sections[L.sections.length - 1] || null;
function addWidget(type) {
  const m = types[type], [w0, h0] = m.size.square, s = homeSection();
  if (!s) return;   // draw a section first (the gallery says so)
  const w = { id: uid(), type, section: s.id, mode: 'square', anchor: 'right', when: m.when || 'always', x: snap((s.w - w0) / 2), y: snap((s.h - h0) / 2), w: w0, h: h0, opts: defaultOpts(m), look: copy(DEFAULT_LOOK) };
  fitInside(w, s.w, s.h);
  w.x = Math.max(0, w.x); w.y = Math.max(0, w.y);
  L.widgets.push(w); sel = w.id; selSec = null; saveLayout(); buildStage();
}
// move a widget or section, flat or warped; arrange moves snap to the 8 px grid
function moveThing(t, start, dx, dy) {
  if (start.quad) return moveAll(t, start.quad, snap(dx), snap(dy));
  const sp = spaceOf(t);
  moveResize(t, start, dx, dy, '', sp.w, sp.h); reposition(t);
}

/* ---------- sections ---------- */
function addSection(box = { x: 400, y: 200, w: 480, h: 320 }) {
  const s = Object.assign({ id: uid(), name: 'Section ' + (L.sections.length + 1), bg: 'none', bgOpts: {} }, box);
  L.sections.push(s); selSec = s.id; sel = null; saveLayout(); buildStage();
}
function deleteSection(s) {   // its widgets go with it (the button asks twice when there are any)
  L.widgets = L.widgets.filter(w => w.section !== s.id);
  L.sections = L.sections.filter(x => x !== s);
  if (inside === s.id) inside = null;
  sel = null; selSec = null; saveLayout(); buildStage();
}
function moveToSection(w, s) {   // keep the spot on the wall when it can, otherwise drop it in the middle
  const from = sectionOf(w.section), at = panelToLocal(s, localToPanel(from, [w.x, w.y]));
  w.section = s.id; delete w.quad;
  w.x = snap(at[0]); w.y = snap(at[1]);
  if (!(w.x >= 0 && w.y >= 0 && w.x < s.w && w.y < s.h)) { w.x = snap((s.w - w.w) / 2); w.y = snap((s.h - w.h) / 2); }
  fitInside(w, s.w, s.h); w.x = Math.max(0, w.x); w.y = Math.max(0, w.y);
  saveLayout(); buildStage();
}
function renderSections() {
  const s = selS(), list = $('#secList');
  list.innerHTML = L.sections.map(x => `<button data-sid="${esc(x.id)}" class="${x === s ? 'on' : ''}">${esc(x.name)}${x.bg !== 'none' ? ' · ' + esc((bgTypes[x.bg] || {}).name || x.bg) : ''}</button>`).join('');
  list.hidden = !L.sections.length;
  $('#secEmpty').hidden = !!L.sections.length;
  $('#gallery').classList.toggle('off', !L.sections.length);
  $('#galleryHint').hidden = !!L.sections.length;
  $('#winBtn').disabled = !L.sections.length;
  $('#secTools').hidden = !s;
  $('#winBtn').classList.toggle('on', !!L.windowOn);
  $('#winBtn').textContent = L.windowOn ? 'Window on' : 'Window';
  $('#backWall').hidden = !inside;
  $('#insideName').hidden = !inside;
  if (inside) $('#insideName').textContent = `Inside “${sectionOf(inside).name}”`;
  if (!s) return;
  if (document.activeElement !== $('#secName')) $('#secName').value = s.name;
  $('#secInside').hidden = inside === s.id;
  const n = L.widgets.filter(w => w.section === s.id).length, del = $('#secDel');
  if (!del.dataset.armed) del.textContent = n ? `Delete section + ${n} widget${n > 1 ? 's' : ''}` : 'Delete section';
  onTabs('secBg', s.bg);
  const m = bgTypes[s.bg], box = $('#secBgOpts');
  const key = s.id + ':' + s.bg;
  if (box._for !== key) { box._for = key; box.innerHTML = m ? (m.options || []).map(optHTML).join('') : ''; }
  if (m) for (const o of m.options || []) {
    const v = s.bgOpts[o.key];
    if (o.type === 'tabs') box.querySelectorAll(`.tabs[data-k="${o.key}"] button`).forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
    else { const input = box.querySelector(`[data-k="${o.key}"]`); if (input && o.type === 'switch') input.checked = !!v; else if (input && document.activeElement !== input) input.value = v == null ? '' : v; }
  }
  $('#secNote').textContent = s.bg !== 'none' && !L.windowOn ? 'Turn on Window (above the wall) to show it. Its widgets hide while it’s a window.'
    : s.bg !== 'none' ? 'This section is a window right now; its widgets are hidden until Window is off.' : '';
}
function setSecBg(v) {
  const s = selS();
  if (!s) return;
  s.bg = v;
  if (bgTypes[v]) s.bgOpts = Object.assign(defaultOpts(bgTypes[v]), s.bgOpts);
  saveLayout(); render();
}
function setSecOpt(k, v) {
  const s = selS();
  if (!s) return;
  s.bgOpts[k] = v; saveLayout();
  const i = bgInst.find(x => x.s === s);
  if (i) updateBg(i);
  renderSections();
}
// Window mode: the header button. With no window section yet, the selected section (or the whole wall) becomes one.
function toggleWindow() {
  if (!L.windowOn && !L.sections.some(s => bgTypes[s.bg])) {
    const s = selS() || sectionOf(inside) || L.sections[0], first = Object.keys(bgTypes)[0];
    if (!first || !s) return;
    s.bg = first; s.bgOpts = Object.assign(defaultOpts(bgTypes[first]), s.bgOpts);
  }
  L.windowOn = !L.windowOn; saveLayout(); render();
}

/* ---------- photos: shrunk on the way in, kept in this browser (IndexedDB) until the projector app stores them ---------- */
const photoDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('bearwall-photos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => { const t = db.transaction('photos', mode), q = fn(t.objectStore('photos')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
  return { put: (id, blob) => tx('readwrite', st => st.put(blob, id)), get: id => tx('readonly', st => st.get(id)), del: id => tx('readwrite', st => st.delete(id)) };
})();
const photoURLs = {};
util.photoURL = id => photoURLs[id] ? Promise.resolve(photoURLs[id])
  : photoDB.get(id).then(b => b ? (photoURLs[id] = URL.createObjectURL(b)) : null).catch(() => null);
function shrinkPhoto(file, max = 1280) {   // keep the projector's ~1 GB of RAM happy
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => { if (!b) return rej(new Error('could not shrink')); b.w = c.width; b.h = c.height; res(b); }, 'image/jpeg', .85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('not an image')); };
    img.src = url;
  });
}
async function addPhotos(key, files) {
  const w = selW();
  if (!w) return;
  const ids = (w.opts[key] || []).slice(), wasEmpty = !ids.length;
  let first = null;
  for (const f of files) {
    try { const id = 'p' + uid() + uid(), b = await shrinkPhoto(f); await photoDB.put(id, b); ids.push(id); first = first || b; }
    catch (e) { console.warn('skipped a photo:', f.name, e.message); }
  }
  if (wasEmpty && first && types[w.type].keepAspect) {   // the box takes the first photo's proportions, so nothing is cropped
    const sp = spaceOf(w), r = first.w / first.h;
    w.h = Math.round(w.w / r);
    if (w.h > sp.h) { w.h = sp.h; w.w = Math.round(w.h * r); }
    fitInside(w, sp.w, sp.h); w.mode = autoMode(w); positionWidget(w);
  }
  setOpt(key, ids);
}
function removePhoto(key, id) {
  const w = selW();
  if (!w) return;
  photoDB.del(id).catch(() => {});
  if (photoURLs[id]) { URL.revokeObjectURL(photoURLs[id]); delete photoURLs[id]; }
  setOpt(key, (w.opts[key] || []).filter(x => x !== id));
}
function renderPhotoThumbs(box, key, ids) {
  const wrap = box.querySelector(`.photos[data-k="${key}"] .thumbs`);
  if (!wrap || wrap._ids === ids.join()) return;
  wrap._ids = ids.join();
  wrap.innerHTML = ids.map(id => `<span class="thumb" data-id="${esc(id)}"><img alt=""><button type="button" aria-label="Remove photo">×</button></span>`).join('') || '<span class="none">No photos yet</span>';
  wrap.querySelectorAll('.thumb').forEach(t => util.photoURL(t.dataset.id).then(u => { if (u) t.querySelector('img').src = u; }));
}

let drag = null, pinch = null;
// resize from a corner but keep the start box's proportions (snapped width, kept inside the parent)
function resizeKeep(b, s, dx, dy, dir, pw, ph) {
  const r = s.w / s.h, left = dir.includes('w'), top = dir.includes('n');
  let w = Math.max(s.w + (left ? -dx : dx), (s.h + (top ? -dy : dy)) * r);   // follow whichever edge moved further
  const maxW = Math.min(left ? s.x + s.w : pw - s.x, (top ? s.y + s.h : ph - s.y) * r);
  w = clamp(snap(w), Math.max(MIN, MIN * r), maxW);
  const h = Math.round(w / r);
  Object.assign(b, { w, h, x: left ? s.x + s.w - w : s.x, y: top ? s.y + s.h - h : s.y });
}
// the dashed box you see while drawing a new section (snapped to the grid, kept on the wall)
function drawBox(d, p) {
  const x0 = clamp(snap(Math.min(d.p0[0], p[0])), 0, WALL_W), y0 = clamp(snap(Math.min(d.p0[1], p[1])), 0, WALL_H);
  const x1 = clamp(snap(Math.max(d.p0[0], p[0])), 0, WALL_W), y1 = clamp(snap(Math.max(d.p0[1], p[1])), 0, WALL_H);
  d.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const el = $('#drawBox');
  el.hidden = d.box.w < 8 && d.box.h < 8;
  place(el, d.box, WALL_W, WALL_H);
}
const pointers = new Map();
function bindStage() {
  stageBox.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const p = panelPt(e), t = selS();
    if (t && warpOn()) {   // Warp: corners, edges, inside; two fingers zoom
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()].map(x => toSpace(t, x));
        pinch = { t, q0: copy(quadOf(t)), d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 }; drag = null; pushUndo(null, t);
        stageBox.setPointerCapture(e.pointerId); e.preventDefault();
        return;
      }
      const q0 = copy(quadOf(t)), ch = e.target.closest('.ch'), eh = e.target.closest('.eh'), lp = toSpace(t, p);
      const kind = ch ? 'corner' : eh ? 'edge' : inQuad(q0, lp) ? 'all' : null;
      if (kind) {
        if (ch) corner = +ch.dataset.i;
        drag = { kind, t, edge: eh ? +eh.dataset.e : 0, q0, l0: lp };   // keeps going if Shift is let go mid-drag
        pushUndo(null, t); stageBox.setPointerCapture(e.pointerId); e.preventDefault(); drawWarpUI();
        return;
      }
      pointers.delete(e.pointerId);
    }
    // look through everything under the pointer: a widget beats the section it sits in or any section covering it
    const stack = document.elementsFromPoint(e.clientX, e.clientY), hh = e.target.closest('.handle'), up = (cls) => stack.map(el => el.closest && el.closest(cls)).find(Boolean);
    const f = hh && hh.parentElement.classList.contains('widget') ? hh.parentElement : up('.widget');
    const sf = hh && hh.parentElement.classList.contains('section') ? hh.parentElement : up('.section');
    let thing;
    if (f && (!inside || sectionOf(inside).id === widgetOf(f.dataset.wid).section)) { select(f.dataset.wid); thing = selW(); }
    else if (sf && (!inside || inside === sf.dataset.sid)) { if (inside) { select(null); return; } selectSection(sf.dataset.sid); thing = selS(); }
    else {   // empty wall: View. Dragging here draws a new section.
      sel = null; selSec = null; renderChrome();
      if (!inside) { drag = { kind: 'draw', p0: p }; stageBox.setPointerCapture(e.pointerId); e.preventDefault(); }
      return;
    }
    const h = e.target.closest('.handle');
    const owner = h && (h.parentElement.dataset.wid || h.parentElement.dataset.sid);
    if (thing.quad) pushUndo(null, thing);
    drag = { kind: h && owner === thing.id && !thing.quad ? 'resize' : 'move', t: thing, start: copy(thing), l0: toSpace(thing, p), dir: h ? h.dataset.h : '' };
    stageBox.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stageBox.addEventListener('pointermove', e => {
    const p = panelPt(e);
    if (pinch && pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, p);
      const [a, b] = [...pointers.values()].map(x => toSpace(pinch.t, x));
      zoom(pinch.t, pinch.q0, Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d0);
      return;
    }
    if (!drag) return;
    if (drag.kind === 'draw') return drawBox(drag, p);
    const l = toSpace(drag.t, p), dx = l[0] - drag.l0[0], dy = l[1] - drag.l0[1];
    if (drag.kind === 'move') return moveThing(drag.t, drag.start, dx, dy);
    if (drag.kind === 'resize') {
      const sp = spaceOf(drag.t), m = !isSec(drag.t) && types[drag.t.type];
      if (m && m.keepAspect && !shiftHeld) resizeKeep(drag.t, drag.start, dx, dy, drag.dir, sp.w, sp.h);
      else {
        moveResize(drag.t, drag.start, dx, dy, drag.dir, sp.w, sp.h);
        if (m && m.keepAspect && drag.t.opts.fit !== 'fill') { drag.t.opts.fit = 'fill'; const i = inst.find(x => x.w === drag.t); if (i) updateInst(i); }   // Shift: crop
      }
      reposition(drag.t);
      if (!isSec(drag.t) && autoMode(drag.t) !== drag.t.mode) {   // shape follows the proportions
        drag.t.mode = autoMode(drag.t);
        const i = inst.find(x => x.w === drag.t);
        if (i) updateInst(i);
        renderSel();
      }
      return;
    }
    if (drag.kind === 'all') return moveAll(drag.t, drag.q0, dx, dy);
    const q = copy(drag.q0);
    const idx = drag.kind === 'corner' ? [corner] : EDGES[drag.edge];
    idx.forEach(i => { q[i] = clampIn(drag.t, [q[i][0] + dx, q[i][1] + dy]); });
    setQuad(drag.t, q);
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (drag && drag.kind === 'draw') {   // a real drag makes a section; a plain click just leaves you in View
      const b = drag.box; drag = null; $('#drawBox').hidden = true;
      if (b && b.w >= MIN && b.h >= MIN) addSection(b);
      return;
    }
    if (drag || pinch) saveLayout();
    if (pointers.size < 2) pinch = null;
    drag = null;
    drawWarpUI();
  };
  stageBox.addEventListener('pointerup', end);
  stageBox.addEventListener('pointercancel', end);
  // double-click a section to go inside it; double-click outside it to come back
  // (pointer capture sends the dblclick to stageBox, so look at what's under the pointer instead of e.target)
  stageBox.addEventListener('dblclick', e => {
    const stack = document.elementsFromPoint(e.clientX, e.clientY), up = cls => stack.map(el => el.closest && el.closest(cls)).find(Boolean);
    const sf = up('.section');
    if (inside) { if (!sf || sf.dataset.sid !== inside) leaveSection(); return; }
    const wf = up('.widget');
    if (sf && !(wf && sf.contains(wf))) enterSection(sf.dataset.sid);   // a widget of this section takes the double-click itself
  });
  stageBox.addEventListener('wheel', e => {
    const t = selS();
    if (!t || !warpOn()) return;
    e.preventDefault();
    pushUndo('wheel', t); zoom(t, copy(quadOf(t)), Math.exp(-e.deltaY * 0.0015)); saveLayout();
  }, { passive: false });
  new ResizeObserver(positionAll).observe(stage);   // warps are in px
}

function bindControls() {
  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
  const setShift = on => { if (shiftHeld !== on) { shiftHeld = on; drawWarpUI(); } };
  document.addEventListener('keyup', e => { if (e.key === 'Shift') setShift(false); });
  window.addEventListener('blur', () => setShift(false));
  document.addEventListener('keydown', e => {
    if (typing()) return;
    if (e.key === 'Shift') { setShift(true); return; }
    if (e.key === 'Escape' && inside && !target()) { leaveSection(); return; }
    const w = target();
    if (!w) return;
    if (e.key === 'Escape') { sel = null; selSec = null; renderChrome(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); flatten(selS()); return; }   // with nothing selected, Ctrl+R reloads as usual
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    if (warpOn() && /^Digit[1-4]$/.test(e.code)) { corner = +e.code.slice(5) - 1; drawWarpUI(); return; }
    const D = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!D) return;
    e.preventDefault();
    if (warpOn()) return nudge(D[0], D[1]);
    if (w.quad) pushUndo('move', w);
    moveThing(w, copy(w), D[0] * GRID, D[1] * GRID); saveLayout();
  });

  // warp tools
  $('#undo').onclick = doUndo;
  $('#flatten').onclick = () => flatten(selS());
  // widget tools
  $('#del').onclick = deleteSelected;
  buildGallery();
  $('#gallery').onclick = e => { const b = e.target.closest('.gitem'); if (b && types[b.dataset.type]) addWidget(b.dataset.type); };
  document.querySelectorAll('.colorrow').forEach(row => {   // full color picker + quick presets
    const k = row.dataset.look;
    row.innerHTML = `<input type="color" class="cpick" aria-label="Pick a ${k} color">` + COLOR_PRESETS.map(c => `<button class="sw" style="--s:${c}" data-v="${c}" aria-label="${c}"></button>`).join('');
    row.addEventListener('input', e => { if (e.target.classList.contains('cpick')) setLook(k, e.target.value); });
    row.addEventListener('click', e => { const b = e.target.closest('.sw'); if (b) setLook(k, b.dataset.v); });
  });
  for (const k of ['thick', 'track', 'glow']) $('#w' + k[0].toUpperCase() + k.slice(1)).oninput = e => setLook(k, +e.target.value);
  $('#wIcons').onclick = e => { const b = e.target.closest('button'); if (b) setLook('icons', b.dataset.v); };
  $('#wStyle').onclick = e => { const b = e.target.closest('button'), list = $('#wStyle')._list; if (b && list) setStyle(list[+b.dataset.i]); };
  $('#wAnchor').onclick = e => {
    const b = e.target.closest('button'), w = selW();
    if (!b || !w) return;
    w.anchor = b.dataset.v; saveLayout(); render();
  };
  $('#wWhen').onclick = e => {
    const b = e.target.closest('button'), w = selW();
    if (!b || !w) return;
    w.when = b.dataset.v; saveLayout(); render();
  };
  bindDevices();
  // sections + Window mode
  $('#secBg').innerHTML = '<button data-v="none">None</button>' + Object.values(bgTypes).map(m => `<button data-v="${esc(m.type)}">${esc(m.name)}</button>`).join('');
  $('#winBtn').onclick = toggleWindow;
  $('#winBtn').hidden = !Object.keys(bgTypes).length;
  $('#backWall').onclick = leaveSection;
  $('#secAdd').onclick = () => addSection();
  $('#secList').onclick = e => { const b = e.target.closest('button'); if (b) { if (inside && inside !== b.dataset.sid) leaveSection(); selectSection(b.dataset.sid); } };
  $('#secName').oninput = e => { const s = selS(); if (!s) return; s.name = e.target.value.trim() || 'Section'; saveLayout(); positionSection(s); renderSections(); };
  $('#secBg').onclick = e => { const b = e.target.closest('button'); if (b) setSecBg(b.dataset.v); };
  $('#secBgOpts').addEventListener('click', e => { const b = e.target.closest('.tabs button'); if (b) setSecOpt(b.parentElement.dataset.k, b.dataset.v); });
  $('#secBgOpts').addEventListener('input', e => { const t = e.target; if (t.dataset.k) setSecOpt(t.dataset.k, t.type === 'checkbox' ? t.checked : t.value); });
  $('#secDel').onclick = e => {   // two taps when the section still has widgets
    const s = selS(), b = e.currentTarget;
    if (!s) return;
    const n = L.widgets.filter(w => w.section === s.id).length;
    clearTimeout(b._t);
    if (b.dataset.armed || !n) { delete b.dataset.armed; deleteSection(s); return; }
    b.dataset.armed = '1'; b.textContent = `Tap again to delete it + ${n} widget${n > 1 ? 's' : ''}`;
    b._t = setTimeout(() => { delete b.dataset.armed; renderSections(); }, 3000);
  };
  $('#secInside').onclick = () => { const s = selS(); if (s) enterSection(s.id); };
  $('#wSection').onchange = e => { const w = selW(), s = sectionOf(e.target.value); if (w && s && s.id !== w.section) moveToSection(w, s); };
  $('#widgetOpts').addEventListener('change', e => { const t = e.target; if (t.dataset.photos) { addPhotos(t.dataset.photos, [...t.files]); t.value = ''; } });
  $('#widgetOpts').addEventListener('click', e => { const b = e.target.closest('.thumb button'); if (b) removePhoto(b.closest('.photos').dataset.k, b.parentElement.dataset.id); });
  $('#widgetOpts').addEventListener('click', e => { const b = e.target.closest('.tabs button'); if (b) setOpt(b.parentElement.dataset.k, b.dataset.v); });
  $('#widgetOpts').addEventListener('input', e => { const t = e.target; if (t.dataset.k) setOpt(t.dataset.k, t.type === 'checkbox' ? t.checked : t.value); });
  $('#reset').onclick = e => {   // two taps instead of confirm(), which embedded pages can't show
    const b = e.currentTarget, disarm = () => { delete b.dataset.armed; b.textContent = 'Clear wall'; };
    clearTimeout(b._t);
    if (b.dataset.armed) { disarm(); L = copy(DEFAULT_LAYOUT); normalize(); sel = null; selSec = null; inside = null; undo = []; saveLayout(); buildStage(); return; }
    b.dataset.armed = '1'; b.textContent = 'Tap again to reset';
    b._t = setTimeout(disarm, 3000);
  };

  $('#conds').innerHTML = CONDS.map(([v, n]) => `<button class="chip" data-v="${v}">${svg(icon(v, false))}${n}</button>`).join('');
  $('#conds').onclick = e => { const b = e.target.closest('.chip'); if (b) { P.cond = b.dataset.v; render(); } };
  $('#motion').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    S.motion = b.dataset.v; saveSettings(); buildStage();
  };
  $('#source').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    P.source = b.dataset.v; if (P.source === 'live' && liveState === 'offline') fetchWeather(); render();
  };
  for (const id of ['temp', 'hum', 'hour']) { const r = $('#' + id); r.value = P[id]; r.oninput = () => { P[id] = +r.value; render(); }; }
  $('#name').value = S.name;
  $('#name').oninput = e => { S.name = e.target.value; saveSettings(); render(); };
  $('#replay').onclick = buildStage;   // remounting replays every intro animation
  if (document.fullscreenEnabled) $('#full').onclick = () => $('#wallWrap').requestFullscreen().catch(() => {});
  else $('#full').hidden = true;
  bindCitySearch();
}

/* ---------- alerts: things the system notices (real internet check + sample triggers for the rest) ---------- */
const SAMPLE_ALERTS = {
  'net-down': { kind: 'network', level: 'critical', title: 'Offline 3 min', detail: 'No internet (sample)', label: 'Offline' },
  'net-device': { kind: 'network', level: 'info', title: 'New device on Wi-Fi', detail: 'Galaxy-A52 joined', label: 'New device' },
  'proj-hot': { kind: 'projector', level: 'warning', title: 'Running hot · 78°C', detail: 'Projector chip temperature', label: 'Hot' },
  'proj-storage': { kind: 'projector', level: 'warning', title: 'Storage 92% full', detail: 'Projector storage', label: 'Storage' },
  'proj-power': { kind: 'projector', level: 'info', title: 'Power cut at 2:14 AM', detail: 'Back at 2:31 AM', label: 'Power cut' },
  'proj-uptime': { kind: 'projector', level: 'info', title: 'Running 14 days', detail: 'A restart would help', label: 'Uptime' },
  'sec-malware': { kind: 'security', level: 'critical', title: 'Proxy malware is back', detail: 'itvbox · prebuilt · port 9000 · daemon12138', label: 'Malware' },
  'sec-adb': { kind: 'security', level: 'warning', title: 'New ADB connection', detail: 'Something connected to the debug port', label: 'ADB' }
};
const PREVIEW_ALERTS = [Object.assign({ id: 'preview', since: new Date() }, SAMPLE_ALERTS['net-device'])];
function setAlert(id, a) {
  const old = alerts.find(x => x.id === id);
  if (old && old.level === a.level && old.title === a.title && old.detail === a.detail) return;
  alerts = alerts.filter(x => x.id !== id).concat(Object.assign({ id, since: old ? old.since : new Date() }, a));
  render();
}
function clearAlert(id) { if (alerts.some(x => x.id === id)) { alerts = alerts.filter(x => x.id !== id); render(); } }

// Real internet check. A failed request only counts as "offline" once a request has worked here before, or when the
// browser itself says it's offline, so a sandbox that blocks requests (like the artifact viewer) doesn't cry wolf.
let netOk = false, netDownSince = null, netSlow = 0;
async function checkNet() {
  let ms = null;
  if (navigator.onLine) {
    const t0 = performance.now();
    try { await fetch('https://www.google.com/generate_204', { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }); ms = Math.round(performance.now() - t0); } catch (e) {}
  }
  if (ms == null && (netOk || !navigator.onLine)) {
    netDownSince = netDownSince || Date.now();
    const mins = Math.max(1, Math.round((Date.now() - netDownSince) / 60000));
    return setAlert('net', { kind: 'network', level: 'critical', title: `Offline ${mins} min`, detail: 'No internet' });
  }
  if (ms == null) return;
  netOk = true; netDownSince = null;
  netSlow = ms > 800 ? netSlow + 1 : 0;   // ponytail: 2 slow checks in a row = slow; a ping sweep on the projector replaces this in Phase 1
  if (netSlow >= 2) setAlert('net', { kind: 'network', level: 'warning', title: `Slow · ${ms} ms`, detail: 'Internet is slow' });
  else clearAlert('net');
}

/* ---------- update check: is there a newer BearWall on GitHub? ---------- */
// Phase 1: "Update projector" makes the projector app download the new web files from GitHub. In the prototype
// it just records the new version as installed and reloads.
let upd = { state: 'checking' };
async function checkUpdate() {
  try {
    const r = await fetch('https://api.github.com/repos/BruBread/BearWall/commits/main', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), sha = j.sha, installed = store.get('installed', null);
    if (!installed) store.set('installed', sha);   // the first check sets the baseline
    if (!installed || installed === sha) { upd = { state: 'current', sha }; clearAlert('update'); }
    else {
      upd = { state: 'available', sha, msg: String(j.commit.message).split('\n')[0], date: new Date(j.commit.committer.date) };
      setAlert('update', { kind: 'update', level: 'info', title: 'Update available', detail: `${sha.slice(0, 7)} · ${upd.msg}` });
    }
  } catch (e) { upd = { state: 'unknown' }; }
  renderUpdate();
}
function renderUpdate() {
  $('#updState').textContent = upd.state === 'checking' ? 'Checking for updates…'
    : upd.state === 'current' ? `Up to date · ${upd.sha.slice(0, 7)}`
    : upd.state === 'available' ? `Update available · ${upd.sha.slice(0, 7)}` : "Can't check for updates here.";
  $('#updBtn').hidden = upd.state !== 'available';
  $('#updNote').hidden = upd.state !== 'available';
  if (upd.state === 'available') $('#updNote').textContent = `${upd.msg} · ${upd.date.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

/* ---------- Devices card (Phase 2 preview) ---------- */
function bindDevices() {
  for (const k of ['laptop', 'phone', 'mic', 'cam']) {
    const c = $('#dev' + k[0].toUpperCase() + k.slice(1));
    c.checked = !!DEV[k];
    c.onchange = () => {
      DEV[k] = c.checked;
      if (k === 'phone') DEV.phoneSince = c.checked ? Date.now() : null;   // drives the "Welcome home" greeting
      saveDevices(); render();
    };
  }
  $('#alertTest').innerHTML = Object.entries(SAMPLE_ALERTS).map(([id, a]) => `<button class="btn quiet" data-id="${id}" title="${esc(a.title)}">${esc(a.label)}</button>`).join('');
  $('#alertTest').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.id;
    if (alerts.some(x => x.id === id)) clearAlert(id); else setAlert(id, SAMPLE_ALERTS[id]);
    document.querySelectorAll('#alertTest button').forEach(x => x.classList.toggle('on', alerts.some(a => a.id === x.dataset.id)));
  };
  $('#updBtn').onclick = () => { if (upd.sha) { store.set('installed', upd.sha); location.reload(); } };
  window.addEventListener('online', checkNet);
  window.addEventListener('offline', checkNet);
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
  const sq = { id: 'x', x: 0, y: 0, w: 400, h: 300, quad: [[100, 50], [700, 120], [60, 500], [720, 430]] };
  const back2 = panelToLocal(sq, localToPanel(sq, [123, 77]));
  ok(Math.abs(back2[0] - 123) < 1e-6 && Math.abs(back2[1] - 77) < 1e-6, 'section mapping round-trips');
  const kb = {}; resizeKeep(kb, { x: 0, y: 0, w: 400, h: 200 }, 100, 0, 'se', 1280, 720);
  ok(kb.w === 504 && kb.h === 252 && kb.x === 0, 'photo resize keeps proportions', kb);
  resizeKeep(kb, { x: 100, y: 100, w: 400, h: 200 }, -900, 0, 'nw', 1280, 720);
  ok(kb.x >= 0 && kb.y >= 0 && Math.abs(kb.w / kb.h - 2) < .02, 'kept proportions stay inside', kb);
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
  registerBackground(m) {
    bgTypes[m.type] = m;
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
    checkNet(); setInterval(checkNet, 30 * 1000);
    checkUpdate(); setInterval(checkUpdate, 30 * 60 * 1000);
    setInterval(() => {   // widgets with `every` refresh on their own clock
      const t = Date.now(), due = inst.filter(i => i.m.every && t - i.last >= i.m.every - 100);
      const bgDue = bgInst.filter(i => i.type && bgTypes[i.type].every && t - i.last >= bgTypes[i.type].every - 100);
      if (!due.length && !bgDue.length) return;
      const now = timeNow(), weather = weatherNow(now);
      due.forEach(i => updateInst(i, now, weather));
      bgDue.forEach(i => updateBg(i, now, weather));
    }, 1000);
  },
  _test: { homography, applyH, validQuad, inQuad, localToPanel, panelToLocal, get inside() { return inside; }, checkUpdate, checkNet, get layout() { return L; }, get alerts() { return alerts; }, get upd() { return upd; } }
};
})();
