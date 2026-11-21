// PC · Now playing: song, artist, album-art square inside a progress ring. Sample data until the PC agent (Phase 2)
// reports what's really playing. New PC widgets show only while the laptop is connected.
(function () {
const U = BearWall.util;
// ponytail: sample playlist; the PC agent's Windows media session replaces it in Phase 2
const SONGS = [['Midnight Drive', 'Sample Artist', 214], ['Paper Lanterns', 'Sample Band', 187], ['Low Tide', 'Sample Duo', 241]];
const NOTE = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M16 28V10l15-4v18"/><circle class="hd" cx="11.5" cy="28" r="4.5"/><circle class="hd" cx="26.5" cy="24" r="4.5"/></svg>';
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

BearWall.register({
  look: ['ring', 'text', 'dim', 'thick', 'track', 'glow'],
  type: 'pc', name: 'PC', styleName: 'Now playing', when: 'laptop',
  size: { square: [264, 264], rect: [488, 104] },
  every: 1000,
  css: `
    .w-pc .art { width: 58%; height: 58%; border-radius: 14%; border: calc(var(--u) * .9) solid var(--ring); color: var(--ring);
      display: flex; align-items: center; justify-content: center; box-shadow: 0 0 calc(var(--glow) * var(--u) * 5) var(--ring); }
    .w-pc .art svg { width: 72%; height: 72%; fill: none; stroke: currentColor; stroke-width: 3.4; stroke-linecap: round; stroke-linejoin: round; }
    .w-pc .art .hd { fill: currentColor; }
    .w-pc .t { font-weight: 800; color: var(--w-text); text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-pc .a, .w-pc .p { color: var(--w-dim); }
    .w-pc.square { display: grid; grid-template-rows: 1fr auto; justify-items: center; align-items: center; }
    .w-pc.square .ring { width: 58%; margin-top: 4%; }
    .w-pc.square .tx { width: 100%; text-align: center; padding-bottom: 3%; }
    .w-pc.square .t { font-size: calc(var(--u) * 7.5 * var(--fit, 1)); }
    .w-pc.square .a { font-size: calc(var(--u) * 5 * var(--fit, 1)); margin-top: calc(var(--u) * 1); }
    .w-pc.square .p { font-size: calc(var(--u) * 4.2 * var(--fit, 1)); margin-top: calc(var(--u) * 1); }
    .w-pc.rect { display: flex; align-items: center; gap: calc(var(--u) * 12); }
    .w-pc.rect.right { flex-direction: row-reverse; }
    .w-pc.rect .ring { height: 100%; flex: none; }
    .w-pc.rect .tx { flex: 1 1 0; min-width: 0; }
    .w-pc.rect.right .tx { text-align: right; }
    .w-pc.rect .t { font-size: calc(var(--u) * 24 * var(--fit, 1)); }
    .w-pc.rect .a { font-size: calc(var(--u) * 15 * var(--fit, 1)); }
    .w-pc.rect .p { font-size: calc(var(--u) * 13 * var(--fit, 1)); }`,
  mount(el) {
    el.innerHTML = `${U.ringHTML(`<div class="art">${NOTE}</div>`)}<div class="tx"><div class="t fit"></div><div class="a fit"></div><div class="p fit"></div></div>`;
  },
  update(el, ctx) {
    const total = SONGS.reduce((s, x) => s + x[2], 0);
    let t = (Date.now() / 1000) % total, i = 0;
    while (t >= SONGS[i][2]) t -= SONGS[i++][2];
    const [title, artist, len] = SONGS[i];
    U.setRing(el.querySelector('.ring'), t / len * 100);
    el.querySelector('.t').textContent = title;
    el.querySelector('.a').textContent = artist;
    el.querySelector('.p').textContent = `${mmss(t)} / ${mmss(len)} · sample`;
    U.fit(el);
  }
});
})();
