// Photos: a slideshow of your own photos. Crossfades between two stacked layers; slow Ken Burns pan in Full motion.
// Photos are uploaded on the control page (option type 'photos'); the runtime stores them and hands out URLs
// through BearWall.util.photoURL(id). The real clock drives the slideshow, so it keeps going in Sample mode too.
(function () {
const U = BearWall.util;
const ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="14" width="46" height="36" rx="5"/><circle cx="23" cy="27" r="4.5"/><path d="M11 46l14-13 10 9 6-5 12 10"/></svg>';
const urlOf = id => (BearWall.util.photoURL ? BearWall.util.photoURL(id) : Promise.resolve(null)).catch(() => null);
const load = url => new Promise(res => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = url; });

// Show photo i on the back layer once it has loaded, then swap layers (the CSS crossfades them).
async function show(el, ids, i, opts) {
  const token = el._token = (el._token || 0) + 1;
  for (let tries = 0; tries < ids.length; tries++, i = (i + 1) % ids.length) {   // skip photos that were deleted
    const url = await urlOf(ids[i]);
    if (token !== el._token) return;   // a newer change won the race
    if (!url || !(await load(url)) || token !== el._token) continue;
    const front = el.querySelector('img.on'), back = el.querySelector('img:not(.on)');
    back.src = url;
    back.dataset.dir = i % 4;   // vary the Ken Burns pan per photo
    back.classList.remove('kb'); void back.offsetWidth; back.classList.add('kb');   // restart the slow pan
    back.classList.add('on'); if (front) front.classList.remove('on');
    el._i = i; el._shown = true;
    el.querySelector('.cap').textContent = opts.caption ? `${i + 1} / ${ids.length}` : '';
    urlOf(ids[(i + 1) % ids.length]).then(u => u && load(u));   // warm the next one
    return;
  }
  el._shown = false; el._failed = el._key;   // none of the ids resolved to a photo: show the empty state
  el.querySelector('.ph').hidden = true; el.querySelector('.empty').hidden = false;
}

BearWall.register({
  type: 'photos',
  name: 'Photos',
  styleName: 'Slideshow',
  size: { square: [264, 264], rect: [488, 168] },
  options: [
    { key: 'photos', label: 'Photos', type: 'photos', value: [] },
    { key: 'interval', label: 'Change every', type: 'tabs', choices: [['10', '10 s'], ['30', '30 s'], ['60', '1 min'], ['300', '5 min']], value: '30' },
    { key: 'fit', label: 'Fit', type: 'tabs', choices: [['fill', 'Fill'], ['fit', 'Fit']], value: 'fill' },
    { key: 'kenburns', label: 'Slow pan and zoom', type: 'switch', value: true },
    { key: 'caption', label: 'Show photo number', type: 'switch', value: false }
  ],
  every: 1000,
  css: `
    .w-photos .ph { position: absolute; inset: 0; overflow: hidden; border-radius: calc(var(--u) * 2); background: #000; }
    .w-photos .ph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; }
    .w-photos .ph[data-fit=fit] img { object-fit: contain; }
    .w-photos .ph img.on { opacity: 1; }
    .m-full .w-photos .ph img, .m-lite .w-photos .ph img { transition: opacity 1.2s ease; }
    .m-lite .w-photos .ph img { transition-timing-function: steps(6); }
    .w-photos .ph::after { content: ''; position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse at center, transparent 62%, #0008 100%); }
    .m-full .w-photos .ph.kb img.kb { animation: bwKB var(--dur, 32s) linear forwards; }
    .w-photos img[data-dir="1"] { transform-origin: 0 0; } .w-photos img[data-dir="2"] { transform-origin: 100% 0; }
    .w-photos img[data-dir="3"] { transform-origin: 0 100%; } .w-photos img[data-dir="0"] { transform-origin: 100% 100%; }
    @keyframes bwKB { from { transform: scale(1); } to { transform: scale(1.12); } }
    .w-photos .cap { position: absolute; z-index: 2; left: 0; right: 0; bottom: 0; padding: calc(var(--u) * 2) calc(var(--u) * 3);
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
    el.innerHTML = `<div class="ph"><img alt=""><img alt=""><div class="cap fit"></div></div><div class="empty">${ICON}<div class="msg fit">Add photos in the widget settings</div></div>`;
  },
  update(el, ctx) {
    const opts = ctx.opts, ids = Array.isArray(opts.photos) ? opts.photos : [], ph = el.querySelector('.ph');
    const sec = +opts.interval || 30, key = ids.join(',');
    ph.dataset.fit = opts.fit === 'fit' ? 'fit' : 'fill';
    ph.classList.toggle('kb', !!opts.kenburns);
    ph.style.setProperty('--dur', sec + 2 + 's');   // the pan lasts through the crossfade into the next photo
    const none = !ids.length || el._failed === key;
    ph.hidden = none; el.querySelector('.empty').hidden = !none;
    if (!ids.length) { el._key = key; el._token = (el._token || 0) + 1; U.fit(el); return; }
    const now = Date.now();
    if (el._key !== key) {   // new or changed photo list: start over at the first one
      el._key = key; el._at = now; el._failed = null;
      ph.hidden = false; el.querySelector('.empty').hidden = true;
      show(el, ids, 0, opts);
    } else if (now - el._at >= sec * 1000) {
      el._at = now;
      show(el, ids, ((el._i || 0) + 1) % ids.length, opts);
    } else if (el._shown) {
      el.querySelector('.cap').textContent = opts.caption ? `${(el._i || 0) + 1} / ${ids.length}` : '';
    }
    U.fit(el);
  }
});
})();
