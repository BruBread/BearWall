// PC · PC stats: CPU, GPU and RAM rings. Sample values that drift slightly until the PC agent sends real ones.
(function () {
const U = BearWall.util;
const STATS = [['CPU', 32, 10, 7], ['GPU', 48, 15, 11], ['RAM', 61, 3, 23]];   // label, base %, swing, period (s)

BearWall.register({
  type: 'pc-stats', family: 'pc', name: 'PC stats', styleName: 'PC stats', when: 'laptop',
  size: { square: [264, 264], rect: [488, 104] },
  every: 2000,
  css: `
    .w-pc-stats { display: flex; align-items: center; justify-content: center; gap: calc(var(--u) * 4); }
    .w-pc-stats.rect.right { flex-direction: row-reverse; }
    .w-pc-stats .st { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 2); }
    .w-pc-stats .tp { font-weight: 800; color: var(--w-text); font-size: calc(var(--u) * 7); text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-pc-stats .lb { color: var(--w-dim); font-weight: 600; font-size: calc(var(--u) * 5.5 * var(--fit, 1)); text-align: center; width: 100%; }
    .w-pc-stats.square .ring { width: 92%; }
    .w-pc-stats.rect .st { flex-direction: row; justify-content: center; gap: calc(var(--u) * 6); }
    .w-pc-stats.rect .ring { height: calc(var(--u) * 90); flex: none; }
    .w-pc-stats.rect .tp { font-size: calc(var(--u) * 24); }
    .w-pc-stats.rect .lb { width: auto; font-size: calc(var(--u) * 16 * var(--fit, 1)); }`,
  mount(el) {
    el.innerHTML = STATS.map(([lb]) => `<div class="st">${U.ringHTML('<span class="n">0</span>')}<div class="lb fit">${lb}</div></div>`).join('');
  },
  update(el, ctx) {
    const t = Date.now() / 1000;
    el.querySelectorAll('.st').forEach((st, i) => {
      const [, base, swing, period] = STATS[i], v = Math.round(base + swing * Math.sin(t / period));
      U.setRing(st.querySelector('.ring'), v);
      U.countTo(st.querySelector('.n'), v, ctx.motion);
    });
    U.fit(el);
  }
});
})();
