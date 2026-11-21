// PC · On Air: a glowing sign while your mic or camera is in use (the PC agent reports this in Phase 2; the Devices
// card simulates it for now). Off air it stays a faint outline so you know where it is.
(function () {
const U = BearWall.util;
const MIC = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="14" y="6" width="12" height="18" rx="6"/><path d="M9 20a11 11 0 0 0 22 0M20 31v4"/></svg>';
const CAM = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="12" width="22" height="16" rx="3"/><path d="M27 18l8-5v14l-8-5"/></svg>';

BearWall.register({
  type: 'pc-onair', family: 'pc', name: 'On Air', styleName: 'On Air', when: 'laptop',
  size: { square: [264, 264], rect: [488, 104] },
  css: `
    .w-pc-onair { --air: #ff4d4d; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--u) * 6); }
    .w-pc-onair .sign { border: calc(var(--u) * 1.4) solid var(--air); border-radius: calc(var(--u) * 5); padding: calc(var(--u) * 3) calc(var(--u) * 6);
      color: var(--air); font-weight: 800; letter-spacing: .08em; white-space: nowrap; font-size: calc(var(--u) * 13 * var(--fit, 1));
      opacity: .22; transition: opacity .4s; }
    .w-pc-onair .on .sign { opacity: 1; color: #fff; background: #ff4d4d33;
      box-shadow: 0 0 calc(var(--glow) * var(--u) * 8) var(--air), inset 0 0 calc(var(--glow) * var(--u) * 5) var(--air);
      text-shadow: 0 0 calc(var(--glow) * var(--u) * 4) var(--air); }
    .w-pc-onair .box { display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 6); }
    .w-pc-onair .ico { display: flex; gap: calc(var(--u) * 6); }
    .w-pc-onair .ico i { width: calc(var(--u) * 16); height: calc(var(--u) * 16); color: var(--w-dim); opacity: .3; }
    .w-pc-onair .ico i.live { color: var(--air); opacity: 1; filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 3) var(--air)); }
    .w-pc-onair svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .w-pc-onair.rect .box { flex-direction: row; gap: calc(var(--u) * 12); }
    .w-pc-onair.rect.right .box { flex-direction: row-reverse; }
    .w-pc-onair.rect .sign { font-size: calc(var(--u) * 34 * var(--fit, 1)); border-width: calc(var(--u) * 3); padding: calc(var(--u) * 6) calc(var(--u) * 14); }
    .w-pc-onair.rect .ico i { width: calc(var(--u) * 40); height: calc(var(--u) * 40); }
    .m-full .w-pc-onair .on .sign, .m-lite .w-pc-onair .on .sign { animation: bwAir 2.2s ease-in-out infinite alternate; }
    .m-lite .w-pc-onair .on .sign { animation-timing-function: steps(5); }
    @keyframes bwAir { from { opacity: .8; } to { opacity: 1; } }`,
  mount(el) {
    el.innerHTML = `<div class="box"><div class="sign">ON AIR</div><div class="ico"><i class="mic">${MIC}</i><i class="cam">${CAM}</i></div></div>`;
  },
  update(el, ctx) {
    const d = ctx.devices || {};
    el.querySelector('.box').classList.toggle('on', !!(d.mic || d.cam));
    el.querySelector('.mic').classList.toggle('live', !!d.mic);
    el.querySelector('.cam').classList.toggle('live', !!d.cam);
    U.fit(el);
  }
});
})();
