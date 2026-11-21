// Window: turns a section into a framed window onto the real outside right now.
// Sky color follows the real sun (sunrise/sunset), weather adds clouds, rain, lightning or fog.
// Animations run only under .m-full / .m-lite; Calm and Off show a still scene that changes when the data does.
(function () {
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lum = c => .3 * c[0] + .59 * c[1] + .11 * c[2];
const rgb = c => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(235, v)))).join(',')})`;   // capped: no white blowouts
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// Sky colors [top, middle, horizon] at moments of the day, relative to sunrise (sr) and sunset (ss) in minutes.
const NIGHT = [[10, 14, 36], [16, 22, 52], [24, 32, 66]];
const SKY = [
  [-60, [[18, 24, 60], [50, 46, 96], [118, 78, 118]]],     // pre-dawn
  [0, [[66, 86, 156], [196, 138, 166], [250, 168, 128]]],   // dawn
  [90, [[66, 136, 214], [118, 176, 230], [186, 214, 234]]], // morning
  ['noon', [[40, 116, 214], [88, 160, 232], [164, 204, 236]]],
  [-90, [[66, 126, 204], [146, 166, 204], [244, 196, 138]], 'ss'],   // golden hour
  [0, [[58, 58, 126], [186, 98, 126], [250, 138, 80]], 'ss'],        // sunset
  [45, [[24, 28, 68], [68, 50, 98], [136, 68, 88]], 'ss']           // dusk
];
const mins = d => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

// The sky's 3 colors at time m (minutes since midnight) for a day with sunrise sr and sunset ss (minutes).
function skyAt(m, sr, ss) {
  const pts = SKY.map(([off, c, base]) => [off === 'noon' ? (sr + ss) / 2 : (base === 'ss' ? ss : sr) + off, c]);
  pts.unshift([sr - 120, NIGHT]); pts.push([ss + 110, NIGHT]);
  if (m <= pts[0][0] || m >= pts[pts.length - 1][0]) return NIGHT;
  for (let i = 1; i < pts.length; i++) if (m <= pts[i][0]) {
    const [m0, c0] = pts[i - 1], [m1, c1] = pts[i], t = (m - m0) / (m1 - m0 || 1);
    return c0.map((c, j) => lerp(c, c1[j], t));
  }
  return NIGHT;
}
console.assert((() => { const noon = skyAt(720, 360, 1080), night = skyAt(0, 360, 1080);
  return noon[0][2] > night[0][2] + 100 && lum(noon[1]) > lum(night[1]) + 80 && lum(skyAt(1080, 360, 1080)[2]) > lum(night[2]); })(), 'window sky: noon is bluer and brighter than midnight, sunset glows');

// How much each kind of weather greys and dims the sky, how many clouds, how bright the sun shows through.
const WX = {
  clear: { grey: 0, dim: 1, clouds: 1, cloudA: .3, sun: 1 },
  partly: { grey: .12, dim: .96, clouds: 3, cloudA: .85, sun: .75 },
  cloud: { grey: .45, dim: .84, clouds: 6, cloudA: 1, sun: .3 },
  rain: { grey: .6, dim: .66, clouds: 6, cloudA: 1, sun: .12 },
  thunder: { grey: .7, dim: .44, clouds: 6, cloudA: 1, sun: .04 },
  fog: { grey: .55, dim: .82, clouds: 2, cloudA: .5, sun: .3 }
};
const weathered = (c, w) => { const g = lum(c); return lerp(c, [g, g, g], w.grey).map(v => v * w.dim); };

// fixed pseudo-random layout so the scene doesn't jump between updates
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const STARS = Array.from({ length: 26 }, () => `<i style="left:${(rnd() * 96 + 2).toFixed(1)}%;top:${(rnd() * 58 + 2).toFixed(1)}%;animation-delay:${(-rnd() * 4).toFixed(2)}s;--s:${(.4 + rnd() * .6).toFixed(2)}"></i>`).join('');
const CLOUDS = Array.from({ length: 6 }, (_, i) => `<i class="cl anim" style="left:${(rnd() * 70 - 10).toFixed(0)}%;top:${(4 + i * 9 + rnd() * 6).toFixed(0)}%;--w:${(34 + rnd() * 26).toFixed(0)};animation-duration:${(70 + rnd() * 60).toFixed(0)}s;animation-delay:${(-rnd() * 120).toFixed(0)}s"></i>`).join('');
const RAIN = Array.from({ length: 38 }, () => `<i class="anim" style="left:${(rnd() * 110 - 5).toFixed(1)}%;top:${(rnd() * 100).toFixed(0)}%;animation-duration:${(.55 + rnd() * .35).toFixed(2)}s;animation-delay:${(-rnd()).toFixed(2)}s"></i>`).join('');
const DROPS = Array.from({ length: 7 }, () => `<b class="anim" style="left:${(rnd() * 90 + 4).toFixed(0)}%;top:${(rnd() * 40).toFixed(0)}%;animation-duration:${(7 + rnd() * 6).toFixed(1)}s;animation-delay:${(-rnd() * 12).toFixed(1)}s"></b>`).join('');

BearWall.registerBackground({
  type: 'window',
  name: 'Window',
  options: [{ key: 'frame', label: 'Frame', type: 'tabs', value: 'cross',
    choices: [['cross', 'Cross'], ['sliding', 'Sliding'], ['arched', 'Arched'], ['round', 'Round'], ['none', 'None']] }],
  every: 1000,
  css: `
    .bg-window .wv { position: absolute; inset: 0; --ft: calc(var(--u) * 3.2); }
    .bg-window .wf { position: absolute; left: calc(var(--u) * 3); right: calc(var(--u) * 3); top: calc(var(--u) * 2); bottom: calc(var(--u) * 5.5);
      background: linear-gradient(160deg, #3b2e23, #1e1711); border-radius: calc(var(--u) * 1.2);
      box-shadow: 0 0 0 calc(var(--u) * .35) #110c08, 0 calc(var(--u) * 1) calc(var(--u) * 3) #000a; }
    .bg-window .sky { position: absolute; inset: var(--ft); overflow: hidden; border-radius: calc(var(--u) * .5);
      background: linear-gradient(to bottom, var(--s1), var(--s2) 62%, var(--s3)); }
    .bg-window .sky > * { position: absolute; }
    .bg-window .sill { position: absolute; left: 0; right: 0; bottom: calc(var(--u) * 2); height: calc(var(--u) * 3.6);
      background: linear-gradient(#4b3a2c, #231a13); border-radius: calc(var(--u) * .6); box-shadow: 0 calc(var(--u) * 1) calc(var(--u) * 2) #000b; }

    /* sun glow, moon, stars */
    .bg-window .sun { left: var(--sx); top: var(--sy); width: calc(var(--u) * 34); height: calc(var(--u) * 34); transform: translate(-50%, -50%);
      background: radial-gradient(circle, rgba(255,240,206,.95) 0 6%, rgba(255,222,160,.45) 10%, rgba(255,206,130,.18) 24%, rgba(255,196,120,0) 60%); opacity: var(--so); }
    .bg-window .mn { left: var(--mx); top: var(--my); width: calc(var(--u) * 7); height: calc(var(--u) * 7); transform: translate(-50%, -50%); border-radius: 50%;
      background: radial-gradient(circle at 38% 38%, #efe9d2, #c9c2a8 72%); box-shadow: 0 0 calc(var(--u) * 5) rgba(236,230,204,.3); opacity: var(--mo); }
    .bg-window .stars { inset: 0; opacity: var(--st); }
    .bg-window .stars i { position: absolute; width: max(2px, calc(var(--u) * .55)); height: max(2px, calc(var(--u) * .55)); box-shadow: 0 0 calc(var(--u) * .6) rgba(220,226,255,.6); border-radius: 50%; background: #e6eaff; opacity: var(--s); }
    .m-full .bg-window .stars i, .m-lite .bg-window .stars i { animation: bwTwinkle 3.4s ease-in-out infinite alternate; }

    /* clouds: soft gradients, no blur filter (blur is costly on the projector GPU) */
    .bg-window .clouds { inset: 0; }
    .bg-window .cl { position: absolute; width: calc(var(--u) * var(--w)); height: calc(var(--u) * var(--w) * .42); opacity: 0; --st: 60;
      background: radial-gradient(closest-side at 30% 64%, var(--cc) 30%, transparent), radial-gradient(closest-side at 55% 46%, var(--cc) 34%, transparent),
        radial-gradient(closest-side at 76% 64%, var(--cc) 26%, transparent); }
    .m-full .bg-window .cl, .m-lite .bg-window .cl { animation-name: bwDrift; animation-timing-function: linear; animation-iteration-count: infinite; }

    /* rain behind the glass + drops sliding down the glass */
    .bg-window .rain { inset: -10% -5%; transform: rotate(9deg); display: none; }
    .bg-window .rain i { position: absolute; width: calc(var(--u) * .35); height: calc(var(--u) * 9); --st: 4;
      background: linear-gradient(transparent, rgba(196,210,232,.5)); }
    .m-full .bg-window .rain i, .m-lite .bg-window .rain i { animation-name: bwFall; animation-timing-function: linear; animation-iteration-count: infinite; }
    .bg-window .drops { inset: 0; display: none; }
    .bg-window .drops b { position: absolute; width: calc(var(--u) * 1); height: calc(var(--u) * 1.3); border-radius: 50% 50% 50% 50% / 60% 60% 42% 42%; --st: 16;
      background: radial-gradient(circle at 35% 32%, rgba(255,255,255,.5), rgba(170,190,215,.16) 62%); box-shadow: 0 calc(var(--u) * .2) calc(var(--u) * .3) rgba(0,0,0,.25); }
    .m-full .bg-window .drops b, .m-lite .bg-window .drops b { animation-name: bwSlide; animation-timing-function: ease-in; animation-iteration-count: infinite; }
    .bg-window .c-rain .rain, .bg-window .c-thunder .rain, .bg-window .c-rain .drops, .bg-window .c-thunder .drops { display: block; }

    /* lightning: two flashes on different cycles, so the pattern doesn't feel regular */
    .bg-window .fl { inset: 0; background: rgb(214,220,255); opacity: 0; display: none; }
    .bg-window .c-thunder .fl { display: block; }
    .m-full .bg-window .fl1, .m-lite .bg-window .fl1 { animation: bwBolt 7.3s infinite; }
    .m-full .bg-window .fl2, .m-lite .bg-window .fl2 { animation: bwBolt 11.9s 3.1s infinite; }

    .bg-window .fog { inset: 0; background: linear-gradient(to top, var(--fogc) 0, transparent 88%); opacity: 0; }
    .bg-window .c-fog .fog { opacity: .85; }
    .bg-window .c-rain .fog, .bg-window .c-thunder .fog { opacity: .3; }

    /* glass reflection and the inner shadow of the frame, on top of the sky */
    .bg-window .refl { inset: 0; z-index: 7; background: linear-gradient(115deg, rgba(255,255,255,.07) 0 18%, transparent 18% 38%, rgba(255,255,255,.04) 38% 44%, transparent 44%); }
    .bg-window .shade { inset: 0; z-index: 8; box-shadow: inset 0 0 calc(var(--u) * 4) rgba(0,0,0,.6); border-radius: inherit; }

    /* frame bars */
    .bg-window .bar { z-index: 6; display: none; background: linear-gradient(90deg, #2b2119, #403126, #2b2119); box-shadow: 0 0 calc(var(--u) * .5) #000b; }
    .bg-window .bv { top: 0; bottom: 0; left: 50%; width: calc(var(--ft) * .85); transform: translateX(-50%); }
    .bg-window .bh { left: 0; right: 0; top: 44%; height: calc(var(--ft) * .85); transform: translateY(-50%);
      background: linear-gradient(#2b2119, #403126, #2b2119); }
    .bg-window .bs { top: 0; bottom: 0; left: 48%; width: calc(var(--ft) * 1.25);
      background: linear-gradient(90deg, #2b2119 0 40%, #120d09 40% 46%, #3b2d22 46%, #2b2119); }
    .bg-window .f-cross .bv, .bg-window .f-cross .bh, .bg-window .f-arched .bv, .bg-window .f-arched .bh, .bg-window .f-sliding .bs { display: block; }

    .bg-window .f-arched .wf { border-radius: 50% 50% calc(var(--u) * 1.2) calc(var(--u) * 1.2) / calc(var(--u) * 34) calc(var(--u) * 34) calc(var(--u) * 1.2) calc(var(--u) * 1.2); }
    .bg-window .f-arched .sky { border-radius: 50% 50% calc(var(--u) * .5) calc(var(--u) * .5) / calc(var(--u) * 31) calc(var(--u) * 31) calc(var(--u) * .5) calc(var(--u) * .5); }
    .bg-window .f-round .wf { left: 50%; top: 50%; right: auto; bottom: auto; width: calc(var(--u) * 94); height: calc(var(--u) * 94); transform: translate(-50%, -50%);
      border-radius: 50%; background: radial-gradient(circle, #2a2a2e 64%, #5b5b62 69%, #2c2c31 76%, #18181b); }
    .bg-window .f-round .sky { inset: calc(var(--u) * 6.5); border-radius: 50%; }
    .bg-window .f-none .wf { inset: 0; background: none; box-shadow: none; border-radius: 0; }
    .bg-window .f-none .sky { inset: 0; border-radius: 0; }
    .bg-window .f-round .sill, .bg-window .f-none .sill { display: none; }

    @keyframes bwTwinkle { from { opacity: calc(var(--s) * .35); } to { opacity: var(--s); } }
    @keyframes bwDrift { from { transform: translateX(-130%); } to { transform: translateX(460%); } }
    @keyframes bwFall { from { transform: translateY(calc(var(--u) * -70)); } to { transform: translateY(calc(var(--u) * 70)); } }
    @keyframes bwSlide { 0% { transform: translateY(0); opacity: 0; } 8% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateY(calc(var(--u) * 55)); opacity: 0; } }
    @keyframes bwBolt { 0%, 91%, 100% { opacity: 0; } 92% { opacity: .55; } 93% { opacity: .08; } 94.5% { opacity: .42; } 97% { opacity: 0; } }`,

  mount(el) {
    el.innerHTML = `<div class="wv"><div class="wf"><div class="sky">
      <div class="stars">${STARS}</div><div class="sun"></div><div class="mn"></div>
      <div class="clouds">${CLOUDS}</div><div class="rain">${RAIN}</div><div class="fog"></div>
      <div class="fl fl1"></div><div class="fl fl2"></div><div class="refl"></div><div class="drops">${DROPS}</div>
      <i class="bar bv"></i><i class="bar bh"></i><i class="bar bs"></i><div class="shade"></div>
    </div></div><div class="sill"></div></div>`;
  },

  update(el, ctx) {
    const wv = el.querySelector('.wv'), w = ctx.weather || {}, cond = WX[w.cond] ? w.cond : 'clear', wx = WX[cond];
    const now = ctx.now || new Date(), m = mins(now);
    const sr = w.sunrise ? mins(w.sunrise) : 360, ss = w.sunset ? mins(w.sunset) : 1080;
    const sky = skyAt(m, sr, ss).map(c => weathered(c, wx));
    const day = clamp((lum(sky[1]) - 30) / 110, 0, 1);   // 0 = night, 1 = full day
    const base = { clear: [236, 238, 244], partly: [230, 232, 238], cloud: [186, 192, 204], rain: [116, 124, 138], thunder: [72, 76, 90], fog: [196, 200, 208] }[cond];
    const cloud = lerp(lerp(sky[1], base, .7).map(v => v * (.35 + .65 * day)), base.map(v => v * .32), 1 - Math.max(day, .25));

    // sun along its arc by day, moon along the night arc
    const f = (m - sr) / (ss - sr), up = f >= 0 && f <= 1;
    const nStart = m >= ss ? ss : ss - 1440, nEnd = m >= ss ? sr + 1440 : sr, fn = clamp((m - nStart) / (nEnd - nStart), 0, 1);
    const arcX = t => 10 + 80 * t + '%', arcY = t => 82 - 66 * Math.sin(Math.PI * clamp(t, 0, 1)) + '%';
    const vars = {
      '--s1': rgb(sky[0]), '--s2': rgb(sky[1]), '--s3': rgb(sky[2]), '--cc': rgb(cloud),
      '--fogc': rgb(lerp(sky[2], [170, 176, 186], .5).map(v => v * (.4 + .6 * day))),
      '--sx': arcX(clamp(f, 0, 1)), '--sy': arcY(f), '--so': up ? wx.sun : 0,
      '--mx': arcX(fn), '--my': arcY(fn), '--mo': up ? 0 : (cond === 'clear' || cond === 'partly' ? .9 : cond === 'fog' ? .25 : .12),
      '--st': (1 - day) * (cond === 'clear' ? 1 : cond === 'partly' ? .6 : .1)
    };
    const frame = ctx.opts && ctx.opts.frame || 'cross', cls = `wv f-${frame} c-${cond}`;
    if (wv.className !== cls) wv.className = cls;
    const key = JSON.stringify(vars) + wx.clouds;
    if (wv._k === key) return;   // nothing changed: leave the styles alone
    wv._k = key;
    for (const k in vars) wv.style.setProperty(k, vars[k]);
    el.querySelectorAll('.cl').forEach((c, i) => { c.style.opacity = i < wx.clouds ? wx.cloudA : 0; });
  }
});
})();
