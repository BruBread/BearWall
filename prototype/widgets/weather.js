// Weather: condition icon, temperature inside a humidity ring, greeting by time of day, city (+ optional extras).
(function () {
const U = BearWall.util;
const greeting = (h, name) => (h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 18 ? 'Good afternoon' : 'Good evening') + (name.trim() ? `, ${name.trim()}` : '');

BearWall.register({
  type: 'weather',
  name: 'Weather', styleName: 'Now',
  size: { square: [264, 264], rect: [488, 104] },
  options: [
    { key: 'feels', label: 'Feels like', type: 'switch', value: false },
    { key: 'hilo', label: 'High / low', type: 'switch', value: false }
  ],
  every: 60000,   // the greeting follows the clock
  css: `
    .w-weather .tp { font-weight: 800; letter-spacing: -.04em; text-shadow: 0 0 calc(var(--glow) * var(--u) * 5) currentColor; }
    .w-weather .dg { font-weight: 300; opacity: .8; }
    .w-weather .gr { font-weight: 600; text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-weather .mt { color: var(--w-dim); font-weight: 400; }
    .w-weather.square { display: grid; grid-template-rows: 1fr auto; justify-items: center; align-items: center; }
    .w-weather.square .ic { position: absolute; left: 3%; top: 2%; width: 22%; height: 22%; }
    .w-weather.square .ring { width: 60%; margin-top: 6%; }
    .w-weather.square .tp { font-size: calc(var(--u) * 17); }
    .w-weather.square .tx { width: 100%; text-align: center; padding-bottom: 3%; }
    .w-weather.square .gr { font-size: calc(var(--u) * 6.4 * var(--fit, 1)); }
    .w-weather.square .mt { font-size: calc(var(--u) * 4 * var(--fit, 1)); margin-top: calc(var(--u) * 1.6); }
    .w-weather.rect { display: flex; align-items: center; gap: calc(var(--u) * 14); }
    .w-weather.rect.right { flex-direction: row-reverse; }
    .w-weather.rect .ic { height: 64%; aspect-ratio: 1; flex: none; }
    .w-weather.rect .ring { height: 100%; flex: none; }
    .w-weather.rect .tp { font-size: calc(var(--u) * 27); }
    .w-weather.rect .tx { flex: 1 1 0; min-width: 0; }
    .w-weather.rect.right .tx { text-align: right; }
    .w-weather.rect .gr { font-size: calc(var(--u) * 24 * var(--fit, 1)); }
    .w-weather.rect .mt { font-size: calc(var(--u) * 14 * var(--fit, 1)); margin-top: calc(var(--u) * 4); }`,
  mount(el) {
    el.innerHTML = `<div class="ic"></div>${U.ringHTML('<span class="n">0</span><span class="dg">°</span>')}<div class="tx"><div class="gr fit"></div><div class="mt fit"></div></div>`;
  },
  update(el, ctx) {
    const w = ctx.weather, ic = el.querySelector('.ic'), svg = U.iconSVG(w.cond, w.night);
    if (ic._svg !== svg) { ic.innerHTML = svg; ic._svg = svg; }
    U.setRing(el.querySelector('.ring'), w.hum);
    U.countTo(el.querySelector('.n'), w.temp, ctx.motion);
    const d = ctx.devices, home = d && d.phone && d.phoneSince && Date.now() - d.phoneSince < 10 * 60 * 1000;   // phone just joined the Wi-Fi
    U.typeOut(el.querySelector('.gr'), home ? 'Welcome home' + (ctx.settings.name.trim() ? `, ${ctx.settings.name.trim()}` : '') : greeting(ctx.now.getHours(), ctx.settings.name), ctx.motion);
    el.querySelector('.mt').textContent = [ctx.city.name, ctx.opts.feels && `feels ${w.feels}°`, ctx.opts.hilo && `H ${w.hi}° L ${w.lo}°`].filter(Boolean).join(' · ');
    U.fit(el);
  }
});
})();
