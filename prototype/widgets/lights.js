// Lights: the room's bulb (run by the projector, see lights.js). Style Bulb: a brightness ring with the bulb's colour,
// the scene and what it's doing. Never blank: before the bulb answers it says so, and off is its own calm view.
(function () {
const U = BearWall.util;

BearWall.register({
  type: 'lights', name: 'Lights', styleName: 'Bulb',
  size: { square: [240, 240], rect: [464, 104] },
  every: 2000,
  look: ['text', 'dim', 'thick', 'track', 'glow'],
  mount(el) {
    el.innerHTML = '<div class="lb">' + U.ringHTML('<i class="dot"></i><span class="v"></span>') + '<div class="tx"><div class="t fit"></div><div class="d fit"></div></div></div>';
  },
  update(el) {
    const L = window.BearWallLights, st = L && L.state, lb = el.querySelector('.lb');
    let pct = 0, title = 'Lights', detail = 'Looking for the bulb…', color = '#555', v = '';
    if (st && !st.bulb.setup) detail = 'Set up the bulb on the Lights page';
    else if (st && st.light) {
      const l = st.light, i = st.settings.scenes.findIndex(s => s.light.on === l.on && s.light.mode === l.mode && s.light.bright === l.bright
        && (l.mode === 'white' ? s.light.temp === l.temp : s.light.h === l.h && s.light.s === l.s));
      color = L.swatch(l);
      if (!l.on) { title = 'Lights off'; detail = st.bulb.found ? 'Light mode on the remote turns them on' : 'Bulb not answering'; }
      else {
        pct = l.bright / 10; v = Math.round(pct) + '%';
        title = i >= 0 ? st.settings.scenes[i].name : l.mode === 'white' ? 'White' : 'Colour';
        detail = l.mode === 'white' ? (l.temp < 350 ? 'Warm white' : l.temp > 700 ? 'Cool white' : 'Neutral white') : 'Colour';
        if (st.active && st.active.length) detail += st.active.indexOf('sunrise') >= 0 ? ' · sunrise' : ' · warming down';
      }
    }
    lb.classList.toggle('off', !pct);
    lb.style.setProperty('--ring', pct ? color : '#666');
    U.setRing(el.querySelector('.ring'), pct);
    el.querySelector('.dot').style.background = el.querySelector('.dot').style.color = color;
    el.querySelector('.v').textContent = v;
    el.querySelector('.t').textContent = title;
    el.querySelector('.d').textContent = detail;
    U.fit(el);
  },
  css: `
  .w-lights .lb { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--u) * 4); text-align: center; }
  .w-lights .ring { width: 58%; }
  .w-lights .tp { display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 2); font-weight: 800; font-size: calc(var(--u) * 11); color: var(--w-text); }
  .w-lights .dot { width: calc(var(--u) * 12); height: calc(var(--u) * 12); border-radius: 50%; box-shadow: 0 0 calc(var(--glow) * var(--u) * 8) currentColor; }
  .w-lights .off .dot { opacity: .35; }
  .w-lights .tx { width: 100%; min-width: 0; }
  .w-lights .t { font-weight: 700; color: var(--w-text); font-size: calc(var(--u) * 7.5 * var(--fit, 1)); }
  .w-lights .d { color: var(--w-dim); font-size: calc(var(--u) * 5.5 * var(--fit, 1)); margin-top: calc(var(--u) * 1.2); }
  .w-lights.rect .lb { flex-direction: row; justify-content: flex-start; text-align: left; gap: calc(var(--u) * 12); }
  .w-lights.rect.right .lb { flex-direction: row-reverse; text-align: right; }
  .w-lights.rect .ring { width: auto; height: 100%; flex: none; }
  .w-lights.rect .tp { font-size: calc(var(--u) * 20); }
  .w-lights.rect .tx { flex: 1 1 0; }
  .w-lights.rect .t { font-size: calc(var(--u) * 24 * var(--fit, 1)); }
  .w-lights.rect .d { font-size: calc(var(--u) * 14 * var(--fit, 1)); margin-top: calc(var(--u) * 3); }`
});
})();
