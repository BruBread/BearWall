// Photos: a slideshow of your own photos, drawn in a style that fits a glowing wall.
// Styles: Plain (crossfade + Ken Burns), Hologram (Star Wars style projected message, tinted with the widget's color),
// Glitch (RGB split + tracking lines). Photos are uploaded on the control page (option type 'photos'); the runtime stores them and hands out
// URLs through BearWall.util.photoURL(id). The real clock drives the slideshow, so it keeps going in Sample mode too.
// Canvas work (Glitch's color channels) runs once per photo and is cached; everything that
// moves is CSS, and only under the Full / Lite motion levels. Calm animates just the change between photos.
(function () {
const U = BearWall.util;
const ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="14" width="46" height="36" rx="5"/><circle cx="23" cy="27" r="4.5"/><path d="M11 46l14-13 10 9 6-5 12 10"/></svg>';
const IMGS = ['g', 'm', 'x1', 'x2', 's1', 's2'].map(k => `<img class="${k}" alt="">`).join('');   // glow, main, 2 extra copies, 2 glitch slices
const urlOf = id => (BearWall.util.photoURL ? BearWall.util.photoURL(id) : Promise.resolve(null)).catch(() => null);
const load = url => new Promise(res => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = url; });
const imgOf = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/* ---------- once-per-photo image work ---------- */
function scaled(img, max) {
  const k = Math.min(1, max / Math.max(img.width, img.height)), c = mk(Math.max(2, Math.round(img.width * k)), Math.max(2, Math.round(img.height * k)));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
// Glitch: the photo split into a red layer and a cyan layer; screen-blended they add back up to the photo
function splitCanvases(img) {
  const c = scaled(img, 640), w = c.width, h = c.height, p = c.getContext('2d').getImageData(0, 0, w, h).data;
  return [[1, 0, 0], [0, 1, 1]].map(keep => {
    const o = mk(w, h), og = o.getContext('2d'), d = og.createImageData(w, h);
    for (let i = 0; i < p.length; i += 4) { d.data[i] = p[i] * keep[0]; d.data[i + 1] = p[i + 1] * keep[1]; d.data[i + 2] = p[i + 2] * keep[2]; d.data[i + 3] = 255; }
    og.putImageData(d, 0, 0);
    return o;
  });
}
const toURL = c => new Promise(res => c.toBlob(b => res(b ? URL.createObjectURL(b) : ''), 'image/png'));

// processed images, cached per photo; oldest are freed
const cache = new Map();
function remember(key, out) {
  cache.set(key, out);
  if (cache.size > 12) { const [k, v] = cache.entries().next().value; Object.values(v).forEach(u => u && URL.revokeObjectURL(u)); cache.delete(k); }   // ponytail: plain LRU-ish by insert order
}
async function sources(style, id, url) {
  if (style !== 'glitch') return {};
  const key = `${id}|glitch`;
  if (cache.has(key)) return cache.get(key);
  const [r, c] = splitCanvases(await imgOf(url)), out = { x1: await toURL(r), x2: await toURL(c) };
  remember(key, out);
  return out;
}

/* ---------- the slideshow ---------- */
// Show photo i on the back layer once it has loaded, then swap layers; CSS runs the style's transition.
async function show(el, ids, i, opts, style) {
  const token = el._token = (el._token || 0) + 1;
  for (let tries = 0; tries < ids.length; tries++, i = (i + 1) % ids.length) {   // skip photos that were deleted
    const url = await urlOf(ids[i]);
    if (token !== el._token) return;   // a newer change won the race
    if (!url) continue;
    let src = null;
    try { src = await sources(style, ids[i], url); } catch (e) { src = null; }
    if (!src || token !== el._token) { if (token !== el._token) return; continue; }
    const main = src.m || src.x1 || url;
    if (!(await load(main)) || token !== el._token) continue;
    const front = el.querySelector('.lay.on'), back = Array.from(el.querySelectorAll('.lay')).find(l => l !== front);
    const S = { g: src.m || url, m: src.m || url, x1: src.x1 || url, x2: src.x2 || url, s1: url, s2: url };
    for (const k in S) { const im = back.querySelector('.' + k); if (im.getAttribute('src') !== S[k]) im.src = S[k]; }
    back.dataset.dir = i % 4;   // vary the Ken Burns pan per photo
    back.classList.remove('in', 'out', 'kbgo'); void back.offsetWidth; back.classList.add('on', 'in', 'kbgo');
    if (front) { front.classList.remove('on', 'in'); front.classList.add('out'); }
    const sw = el.querySelector('.sweep'); sw.classList.remove('go'); void sw.offsetWidth; sw.classList.add('go');
    clearTimeout(el._tt);
    el._tt = setTimeout(() => { back.classList.remove('in'); el.querySelectorAll('.lay.out').forEach(l => l.classList.remove('out')); }, 1600);
    el._i = i; el._shown = true;
    el.querySelector('.cap').textContent = opts.caption ? `${i + 1} / ${ids.length}` : '';
    urlOf(ids[(i + 1) % ids.length]).then(u => u && load(u));   // warm the next one
    return;
  }
  el._shown = false; el._failed = el._key;   // none of the ids resolved to a photo: show the empty state
  el.querySelector('.ph').hidden = true; el.querySelector('.empty').hidden = false;
}

const P = '.w-photos .ph';
const ST = s => `${P}[data-style=${s}]`;
BearWall.register({
  type: 'photos',
  name: 'Photos',
  styleName: 'Slideshow',
  size: { square: [264, 264], rect: [488, 168] },
  keepAspect: true,   // resizing keeps the photo's proportions; Shift + resize crops
  look: o => o.style === 'plain' ? [] : ['ring'], lookLabels: { ring: 'Color' },   // one tint color; Plain uses the photo's own
  options: [
    { key: 'style', label: 'Style', type: 'tabs', choices: [['hologram', 'Hologram'], ['glitch', 'Glitch'], ['plain', 'Plain']], value: 'hologram' },
    { key: 'photos', label: 'Photos', type: 'photos', value: [] },
    { key: 'interval', label: 'Change every', type: 'tabs', choices: [['10', '10 s'], ['30', '30 s'], ['60', '1 min'], ['300', '5 min']], value: '30' },
    { key: 'fit', label: 'Fit', type: 'tabs', choices: [['fit', 'Whole photo'], ['fill', 'Crop to box']], value: 'fit' },
    { key: 'kenburns', label: 'Slow pan and zoom (Plain)', type: 'switch', value: true },
    { key: 'caption', label: 'Show photo number', type: 'switch', value: false }
  ],
  every: 1000,
  css: `
    ${P} { position: absolute; inset: 0; overflow: hidden; border-radius: calc(var(--u) * 2); background: #000; isolation: isolate; }
    ${P} .lay { position: absolute; inset: 0; opacity: 0; z-index: 0; }
    ${P} .lay.on, ${P} .lay.out { opacity: 1; }
    ${P} .lay.on { z-index: 2; } ${P} .lay.out { z-index: 1; }
    ${P} .lay img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: none; }
    ${P}[data-fit=fit] .lay img { object-fit: contain; }
    ${P} > i { position: absolute; inset: 0; display: none; pointer-events: none; }
    ${P}::after { content: ''; position: absolute; z-index: 4; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, transparent 62%, #0008 100%); }
    .m-off .w-photos .lay.in, .m-off .w-photos .lay.out { animation: none !important; }
    .m-off .w-photos .lay.out { opacity: 0; }
    @keyframes bwPhFade { to { opacity: 0; } }

    /* Plain: crossfade + slow Ken Burns pan */
    ${ST('plain')} .m { display: block; }
    ${ST('plain')} .lay.out { opacity: 0; }
    .m-full ${ST('plain')} .lay, .m-lite ${ST('plain')} .lay, .m-calm ${ST('plain')} .lay { transition: opacity 1.2s ease; }
    .m-lite ${ST('plain')} .lay { transition-timing-function: steps(6); }
    .m-full ${ST('plain')}.kb .lay.kbgo .m { animation: bwPhKB var(--dur, 32s) linear forwards; }
    ${P} .lay[data-dir="1"] .m { transform-origin: 0 0; } ${P} .lay[data-dir="2"] .m { transform-origin: 100% 0; }
    ${P} .lay[data-dir="3"] .m { transform-origin: 0 100%; } ${P} .lay[data-dir="0"] .m { transform-origin: 100% 100%; }
    @keyframes bwPhKB { from { transform: scale(1); } to { transform: scale(1.12); } }

    /* Hologram: luminance only, tinted with the ring color, scanlines drifting up, flicker, glitch slices,
       a doubled ghost edge, an emitter glow at the base, and a scan line that materializes each new photo */
    ${ST('hologram')} .g, ${ST('hologram')} .m, ${ST('hologram')} .x1, ${ST('hologram')} .s1, ${ST('hologram')} .s2 { display: block; }
    ${ST('hologram')} .lay img { filter: grayscale(1) contrast(1.75) brightness(1.05); }
    ${ST('hologram')} .lay { -webkit-mask-image: radial-gradient(ellipse 72% 72% at 50% 50%, #000 58%, transparent 100%); mask-image: radial-gradient(ellipse 72% 72% at 50% 50%, #000 58%, transparent 100%); }
    ${ST('hologram')} .lay .g { filter: grayscale(1) brightness(1.6) blur(calc(var(--u) * 1.4)); opacity: calc(var(--glow) * 1.1); }
    ${ST('hologram')} .lay .x1 { opacity: .3; transform: translate(calc(var(--u) * .8), calc(var(--u) * -.3)); }
    ${ST('hologram')} .lay.on { opacity: .93; }
    ${ST('hologram')} .s1, ${ST('hologram')} .s2, ${ST('glitch')} .s1, ${ST('glitch')} .s2 { opacity: 0; }
    ${P} .s1 { clip-path: inset(27% 0 60% 0); } ${P} .s2 { clip-path: inset(63% 0 29% 0); }
    ${ST('hologram')} .tint { display: block; z-index: 3; background: var(--ring); mix-blend-mode: multiply; }
    ${ST('hologram')} .scan { display: block; z-index: 3; opacity: .38;
      background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--u) * .9), #000 calc(var(--u) * .9), #000 calc(var(--u) * 1.7)); }
    ${ST('hologram')} .emit { display: block; z-index: 3; top: auto; height: 26%; left: 8%; right: 8%; mix-blend-mode: screen;
      opacity: calc(var(--glow) * .5 + .15); background: radial-gradient(ellipse 60% 55% at 50% 100%, var(--ring), transparent 75%); }
    ${ST('hologram')} .sweep { z-index: 3; bottom: auto; height: calc(var(--u) * 1.2); background: var(--ring); opacity: 0;
      box-shadow: 0 0 calc(var(--u) * 4 * var(--glow)) var(--ring); }
    ${ST('hologram')} .sweep.go { display: block; animation: bwPhSweep 1.3s ease-out both; }
    .m-off ${ST('hologram')} .sweep { display: none !important; }
    ${ST('hologram')} .lay.in { animation: bwPhReveal 1.3s ease-out both; }
    ${ST('hologram')} .lay.out { animation: bwPhUp 1.3s ease-in both; }
    .m-full ${ST('hologram')} .lay.on .m { animation: bwPhFlicker 3.7s steps(1) infinite; }
    .m-lite ${ST('hologram')} .lay.on .m { animation: bwPhFlicker 3.7s steps(1) infinite; }
    .m-full ${ST('hologram')} .scan { animation: bwPhScan 2.4s linear infinite; }
    .m-lite ${ST('hologram')} .scan { animation: bwPhScan 2.4s steps(8) infinite; }
    .m-full ${P} .lay.on .s1, .m-lite ${P} .lay.on .s1 { animation: bwPhSlice 6.7s steps(1) infinite; }
    .m-full ${P} .lay.on .s2, .m-lite ${P} .lay.on .s2 { animation: bwPhSlice 8.9s steps(1) -3.1s infinite reverse; }
    @keyframes bwPhReveal { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
    @keyframes bwPhUp { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-6%); } }
    @keyframes bwPhSweep { 0% { top: 0; opacity: 1; } 92% { top: 100%; opacity: 1; } 100% { top: 100%; opacity: 0; } }
    @keyframes bwPhScan { from { background-position: 0 0; } to { background-position: 0 calc(var(--u) * -6.8); } }
    @keyframes bwPhFlicker { 0% { opacity: 1; } 21% { opacity: .9; } 23% { opacity: 1; } 47% { opacity: .86; } 49% { opacity: .97; } 71% { opacity: .9; } 74% { opacity: 1; } }
    @keyframes bwPhSlice { 0%, 95% { opacity: 0; transform: none; } 96% { opacity: 1; transform: translateX(5%); } 97% { opacity: 1; transform: translateX(-3%); } 98% { opacity: 0; transform: none; } }

    /* Glitch: red and cyan copies screen-blended back together, jittering apart; tracking line; glitch slices */
    ${ST('glitch')} .x1, ${ST('glitch')} .x2, ${ST('glitch')} .s1, ${ST('glitch')} .s2 { display: block; }
    ${ST('glitch')} .lay .x1, ${ST('glitch')} .lay .x2 { mix-blend-mode: screen; }
    ${ST('glitch')} .lay .x1 { transform: translateX(calc(var(--u) * -.6)); } ${ST('glitch')} .lay .x2 { transform: translateX(calc(var(--u) * .6)); }
    ${ST('glitch')} .scan { display: block; z-index: 3; top: -20%; bottom: auto; height: 12%; opacity: .5; mix-blend-mode: screen;
      background: linear-gradient(to bottom, transparent, #ffffff30 45%, #ffffff55 50%, #ffffff30 55%, transparent); }
    .m-full ${ST('glitch')} .scan { animation: bwPhTrack 6s linear infinite; }
    .m-lite ${ST('glitch')} .scan { animation: bwPhTrack 6s steps(16) infinite; }
    .m-full ${ST('glitch')} .lay.on .x1, .m-lite ${ST('glitch')} .lay.on .x1 { animation: bwPhJitR 5.3s steps(1) infinite; }
    .m-full ${ST('glitch')} .lay.on .x2, .m-lite ${ST('glitch')} .lay.on .x2 { animation: bwPhJitC 7.1s steps(1) infinite; }
    ${ST('glitch')} .lay.in { animation: bwPhGlitchIn .6s steps(6) both; }
    ${ST('glitch')} .lay.out { animation: bwPhFade .4s steps(3) both; }
    @keyframes bwPhTrack { from { top: -20%; } to { top: 110%; } }
    @keyframes bwPhJitR { 0%, 90% { transform: translateX(calc(var(--u) * -.6)); } 91% { transform: translateX(calc(var(--u) * -3)); } 93% { transform: translate(calc(var(--u) * 2), calc(var(--u) * .5)); } 95% { transform: translateX(calc(var(--u) * -.6)); } }
    @keyframes bwPhJitC { 0%, 85% { transform: translateX(calc(var(--u) * .6)); } 86% { transform: translateX(calc(var(--u) * 3.4)); } 88% { transform: translate(calc(var(--u) * -1.5), calc(var(--u) * -.4)); } 90% { transform: translateX(calc(var(--u) * .6)); } }
    @keyframes bwPhGlitchIn { 0% { opacity: 0; transform: translateX(6%); clip-path: inset(40% 0 35% 0); } 33% { opacity: 1; transform: translateX(-4%); clip-path: inset(10% 0 60% 0); }
      66% { transform: translateX(2%); clip-path: inset(0 0 20% 0); } 100% { opacity: 1; transform: none; clip-path: inset(0 0 0 0); } }

    /* caption and empty state */
    .w-photos .cap { position: absolute; z-index: 5; left: 0; right: 0; bottom: 0; padding: calc(var(--u) * 2) calc(var(--u) * 3);
      text-align: right; color: var(--w-dim); font-size: calc(var(--u) * 5 * var(--fit, 1)); text-shadow: 0 0 calc(var(--u) * 2) #000; }
    .w-photos.rect .cap { font-size: calc(var(--u) * 12 * var(--fit, 1)); }
    .w-photos .cap:empty { display: none; }
    .w-photos .empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: calc(var(--u) * 3); border: 2px dashed var(--w-dim); border-radius: calc(var(--u) * 2); opacity: .45; padding: 0 calc(var(--u) * 6); }
    .w-photos .empty svg { width: calc(var(--u) * 26); height: calc(var(--u) * 26); fill: none; stroke: var(--w-dim); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .w-photos.rect .empty { flex-direction: row; }
    .w-photos.rect .empty svg { width: calc(var(--u) * 50); height: calc(var(--u) * 50); flex: none; }
    .w-photos .msg { max-width: 100%; color: var(--w-dim); text-align: center; font-size: calc(var(--u) * 7 * var(--fit, 1)); }
    .w-photos.rect .msg { font-size: calc(var(--u) * 14 * var(--fit, 1)); text-align: left; }`,
  mount(el) {
    el.innerHTML = `<div class="ph"><div class="lay">${IMGS}</div><div class="lay">${IMGS}</div><i class="tint"></i><i class="scan"></i><i class="emit"></i><i class="sweep"></i><div class="cap fit"></div></div>`
      + `<div class="empty">${ICON}<div class="msg fit">Add photos in the widget settings</div></div>`;
  },
  update(el, ctx) {
    const opts = ctx.opts, ids = Array.isArray(opts.photos) ? opts.photos : [], ph = el.querySelector('.ph');
    const style = ['plain', 'hologram', 'glitch'].includes(opts.style) ? opts.style : 'hologram';   // older saves may name a removed style
    const sec = +opts.interval || 30, key = ids.join(',');
    const look = style;
    ph.dataset.style = style;
    ph.dataset.fit = opts.fit === 'fit' ? 'fit' : 'fill';
    ph.classList.toggle('kb', !!opts.kenburns);
    ph.style.setProperty('--dur', sec + 2 + 's');   // the pan lasts through the crossfade into the next photo
    const none = !ids.length || el._failed === key;
    ph.hidden = none; el.querySelector('.empty').hidden = !none;
    if (!ids.length) { el._key = key; el._token = (el._token || 0) + 1; U.fit(el); return; }
    const now = Date.now();
    if (el._key !== key) {   // new or changed photo list: start over at the first one
      el._key = key; el._look = look; el._at = now; el._failed = null;
      ph.hidden = false; el.querySelector('.empty').hidden = true;
      show(el, ids, 0, opts, style);
    } else if (el._look !== look) {   // new style (or LED size): redraw the current photo in place
      el._look = look;
      show(el, ids, el._i || 0, opts, style);
    } else if (now - el._at >= sec * 1000) {
      el._at = now;
      show(el, ids, ((el._i || 0) + 1) % ids.length, opts, style);
    } else if (el._shown) {
      el.querySelector('.cap').textContent = opts.caption ? `${(el._i || 0) + 1} / ${ids.length}` : '';
    }
    U.fit(el);
  }
});
})();
