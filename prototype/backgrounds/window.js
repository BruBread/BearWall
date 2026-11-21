// Window: turns a section into a window onto the real outside right now. The frame is unlit wall (black is no light on a
// projector); the sky follows the real sun, weather adds clouds, rain, lightning or fog, and a silhouette sets the view.
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
const STARS = Array.from({ length: 34 }, () => `<i style="left:${(rnd() * 96 + 2).toFixed(1)}%;top:${(rnd() * 58 + 2).toFixed(1)}%;animation-delay:${(-rnd() * 4).toFixed(2)}s;--s:${(.25 + rnd() * .7).toFixed(2)}"></i>`).join('');
// two cloud layers: far ones high, small and slow; near ones lower, bigger and faster. Three shapes so no two look alike.
const CLOUDS = Array.from({ length: 6 }, (_, i) => {
  const far = i % 2 === 0;
  return `<i class="cl v${i % 3} ${far ? 'far' : 'near'} anim" style="left:${(rnd() * 70 - 10).toFixed(0)}%;top:${(far ? 3 + rnd() * 16 : 14 + rnd() * 24).toFixed(0)}%;`
    + `--w:${(far ? 26 + rnd() * 16 : 44 + rnd() * 26).toFixed(0)};animation-duration:${(far ? 160 + rnd() * 80 : 80 + rnd() * 50).toFixed(0)}s;animation-delay:${(-rnd() * 160).toFixed(0)}s"></i>`;
}).join('');
const RAIN = Array.from({ length: 44 }, () => { const near = rnd() < .35;
  return `<i class="anim" style="left:${(rnd() * 110 - 5).toFixed(1)}%;top:${(rnd() * 100).toFixed(0)}%;--o:${near ? .5 : .22};--h:${near ? 11 : 6};`
    + `animation-duration:${(near ? .45 + rnd() * .2 : .75 + rnd() * .35).toFixed(2)}s;animation-delay:${(-rnd()).toFixed(2)}s"></i>`; }).join('');
const DROPS = Array.from({ length: 7 }, () => `<b class="anim" style="left:${(rnd() * 90 + 4).toFixed(0)}%;top:${(rnd() * 40).toFixed(0)}%;animation-duration:${(7 + rnd() * 6).toFixed(1)}s;animation-delay:${(-rnd() * 12).toFixed(1)}s"></b>`).join('');
// skyline: buildings across a 100 x 30 box, some windows lit at night
const CITY = (() => {
  let x = 0, b = '', w = '';
  while (x < 100) {
    const bw = 3 + rnd() * 6, bh = 7 + rnd() * 18;
    b += `<rect x="${x.toFixed(2)}" y="${(30 - bh).toFixed(2)}" width="${(bw + .05).toFixed(2)}" height="${bh.toFixed(2)}"/>`;
    if (rnd() < .2) b += `<rect x="${(x + bw / 2 - .15).toFixed(2)}" y="${(30 - bh - 2.5).toFixed(2)}" width=".3" height="2.5"/>`;
    for (let wy = 30 - bh + 1.2; wy < 29; wy += 1.6) for (let wx = x + .7; wx < x + bw - .6; wx += 1.2)
      if (rnd() < .22) w += `<rect x="${wx.toFixed(2)}" y="${wy.toFixed(2)}" width=".55" height=".7"/>`;
    x += bw;
  }
  return `<svg class="scn city" viewBox="0 0 100 30" preserveAspectRatio="none"><g class="bld">${b}</g><g class="lit">${w}</g></svg>`;
})();
const HILLS = `<svg class="scn hills" viewBox="0 0 100 30" preserveAspectRatio="none">
  <path class="far" d="M0 30 V17 Q9 11 19 15 T38 13 T58 16 T78 11 T100 15 V30 Z"/><path d="M0 30 V23 Q14 17 30 22 T62 21 T100 19 V30 Z"/></svg>`;
const SEA = `<div class="scn sea"><i class="glint anim"></i></div>`;
// a fine grain over the sky, so smooth gradients don't show bands on the projector
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/></filter><rect width="96" height="96" filter="url(#n)" opacity=".55"/></svg>')}")`;

BearWall.registerBackground({
  type: 'window',
  name: 'Window',
  options: [
    { key: 'frame', label: 'Frame', type: 'tabs', value: 'cross',
      choices: [['cross', 'Cross'], ['sliding', 'Sliding'], ['arched', 'Arched'], ['round', 'Round'], ['none', 'None']] },
    { key: 'scene', label: 'Outside', type: 'tabs', value: 'city',
      choices: [['city', 'City'], ['hills', 'Hills'], ['sea', 'Sea'], ['none', 'Sky only']] }],
  every: 1000,
  css: `
    /* the frame is darkness: on a projector black is no light, so the wall itself is the frame */
    .bg-window .wv { position: absolute; inset: 0; --ft: calc(var(--u) * 2.4); }
    .bg-window .wf { position: absolute; left: calc(var(--u) * 2.5); right: calc(var(--u) * 2.5); top: calc(var(--u) * 2.5); bottom: calc(var(--u) * 2.5); background: #000; }
    .bg-window .sky { position: absolute; inset: var(--ft); overflow: hidden; border-radius: calc(var(--u) * .4);
      background: linear-gradient(to bottom, var(--s1), var(--s2) 55%, var(--s3) 82%, var(--hz));
      box-shadow: 0 0 0 max(1px, calc(var(--u) * .18)) var(--rim); }
    .bg-window .sky > * { position: absolute; }
    .bg-window .grain { inset: 0; z-index: 9; background-image: ${GRAIN}; background-size: calc(var(--u) * 24); opacity: .07; mix-blend-mode: overlay; }

    /* sun bloom, moon, stars */
    .bg-window .sun { left: var(--sx); top: var(--sy); width: calc(var(--u) * 46); height: calc(var(--u) * 46); transform: translate(-50%, -50%); opacity: var(--so);
      background: radial-gradient(circle, rgba(255,247,226,1) 0 3.2%, rgba(255,236,196,.6) 5%, rgba(255,214,150,.22) 14%, rgba(255,200,130,.08) 30%, rgba(255,190,120,0) 62%); }
    .bg-window .mn { left: var(--mx); top: var(--my); width: calc(var(--u) * 5); height: calc(var(--u) * 5); transform: translate(-50%, -50%); border-radius: 50%;
      background: radial-gradient(circle at 40% 38%, #f3efe0, #cfc8b0 70%, #b9b29a); box-shadow: 0 0 calc(var(--u) * 6) calc(var(--u) * 1) rgba(220,226,240,.18); opacity: var(--mo); }
    .bg-window .stars { inset: 0; opacity: var(--st); }
    .bg-window .stars i { position: absolute; width: max(1px, calc(var(--u) * .35)); height: max(1px, calc(var(--u) * .35)); border-radius: 50%; background: #e9edff; opacity: var(--s); }
    .m-full .bg-window .stars i, .m-lite .bg-window .stars i { animation: bwTwinkle 3.4s ease-in-out infinite alternate; }

    /* clouds: lit on top, shaded underneath (warm at sunset); soft gradients, no blur filter */
    .bg-window .clouds { inset: 0; }
    .bg-window .cl { position: absolute; width: calc(var(--u) * var(--w)); height: calc(var(--u) * var(--w) * .38); opacity: 0; }
    .bg-window .cl.v0 { background: radial-gradient(closest-side at 28% 40%, var(--cc), transparent), radial-gradient(closest-side at 52% 30%, var(--cc) 20%, transparent),
      radial-gradient(closest-side at 74% 46%, var(--cc), transparent), radial-gradient(ellipse 60% 40% at 50% 72%, var(--cs) 30%, transparent); }
    .bg-window .cl.v1 { background: radial-gradient(closest-side at 22% 56%, var(--cc), transparent), radial-gradient(closest-side at 44% 36%, var(--cc) 30%, transparent),
      radial-gradient(closest-side at 64% 44%, var(--cc) 10%, transparent), radial-gradient(closest-side at 84% 60%, var(--cc), transparent), radial-gradient(ellipse 70% 34% at 52% 76%, var(--cs) 25%, transparent); }
    .bg-window .cl.v2 { background: radial-gradient(ellipse 50% 40% at 50% 45%, var(--cc) 10%, transparent), radial-gradient(closest-side at 26% 58%, var(--cc), transparent),
      radial-gradient(ellipse 80% 30% at 50% 74%, var(--cs) 20%, transparent); }
    .m-full .bg-window .cl, .m-lite .bg-window .cl { animation-name: bwDrift; animation-timing-function: linear; animation-iteration-count: infinite; }

    /* what's outside: a black silhouette costs no light; lit windows appear at night */
    .bg-window .scn { left: 0; right: 0; bottom: 0; width: 100%; height: 30%; display: none; z-index: 4; stroke: none; }   /* .wv's c-cloud/c-rain class would add the icon stroke */
    .bg-window .city .bld, .bg-window .hills path { fill: #000; }
    .bg-window .hills .far { fill: var(--far); }
    .bg-window .city .lit { fill: #ffd28a; opacity: var(--lit); }
    .bg-window .sea { height: 24%; background: linear-gradient(var(--sea1), var(--sea2) 40%, #000); box-shadow: 0 calc(var(--u) * -.1) 0 var(--rim); }   /* a faint lit horizon line */
    .bg-window .glint { left: var(--sx); top: 0; bottom: 0; width: calc(var(--u) * 7); transform: translateX(-50%); opacity: calc(var(--so) * .8);
      background: repeating-linear-gradient(transparent 0 calc(var(--u) * .9), rgba(255,230,190,.55) calc(var(--u) * .9) calc(var(--u) * 1.3));
      -webkit-mask-image: linear-gradient(#000, transparent); mask-image: linear-gradient(#000, transparent); }
    .m-full .bg-window .glint, .m-lite .bg-window .glint { animation: bwGlint 2.6s ease-in-out infinite alternate; }
    .bg-window .s-city .city, .bg-window .s-hills .hills, .bg-window .s-sea .sea { display: block; }

    /* rain at two depths behind the glass, drops sliding down the glass */
    .bg-window .rain { inset: -10% -5%; transform: rotate(8deg); display: none; z-index: 5; }
    .bg-window .rain i { position: absolute; width: max(1px, calc(var(--u) * .18)); height: calc(var(--u) * var(--h)); opacity: var(--o);
      background: linear-gradient(transparent, rgba(206,216,236,.9)); }
    .m-full .bg-window .rain i, .m-lite .bg-window .rain i { animation-name: bwFall; animation-timing-function: linear; animation-iteration-count: infinite; }
    .bg-window .drops { inset: 0; display: none; z-index: 8; }
    .bg-window .drops b { position: absolute; width: calc(var(--u) * .8); height: calc(var(--u) * 1.1); border-radius: 50% 50% 50% 50% / 60% 60% 42% 42%;
      background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.45), rgba(170,190,215,.12) 62%); }
    .m-full .bg-window .drops b, .m-lite .bg-window .drops b { animation-name: bwSlide; animation-timing-function: ease-in; animation-iteration-count: infinite; }
    .bg-window .c-rain .rain, .bg-window .c-thunder .rain, .bg-window .c-rain .drops, .bg-window .c-thunder .drops { display: block; }

    /* lightning lights the clouds from inside, with only a faint flash across the sky */
    .bg-window .fl { inset: 0; opacity: 0; display: none; z-index: 3; }
    .bg-window .fl1 { background: radial-gradient(ellipse 34% 22% at 30% 22%, rgba(222,228,255,.95), rgba(200,210,255,.18) 60%, rgba(200,210,255,.06)); }
    .bg-window .fl2 { background: radial-gradient(ellipse 30% 20% at 70% 16%, rgba(222,228,255,.9), rgba(200,210,255,.14) 60%, rgba(200,210,255,.05)); }
    .bg-window .c-thunder .fl { display: block; }
    .m-full .bg-window .fl1, .m-lite .bg-window .fl1 { animation: bwBolt 7.3s infinite; }
    .m-full .bg-window .fl2, .m-lite .bg-window .fl2 { animation: bwBolt 11.9s 3.1s infinite; }

    .bg-window .fog { inset: 0; background: linear-gradient(to top, var(--fogc) 0, transparent 88%); opacity: 0; z-index: 6; }
    .bg-window .c-fog .fog { opacity: .85; }
    .bg-window .c-rain .fog, .bg-window .c-thunder .fog { opacity: .3; }

    /* faint glass reflection and the frame's shadow on the glass */
    .bg-window .refl { inset: 0; z-index: 7; background: linear-gradient(115deg, rgba(255,255,255,.035) 0 16%, transparent 16% 40%, rgba(255,255,255,.02) 40% 44%, transparent 44%); }
    .bg-window .shade { inset: 0; z-index: 10; box-shadow: inset 0 0 calc(var(--u) * 3) rgba(0,0,0,.55); border-radius: inherit; }

    /* mullions: unlit bars with a thin rim of sky light on their edges */
    .bg-window .bar { z-index: 11; display: none; background: #000; box-shadow: 0 0 0 max(1px, calc(var(--u) * .16)) var(--rim); }
    .bg-window .bv { top: 0; bottom: 0; left: 50%; width: calc(var(--ft) * .7); transform: translateX(-50%); }
    .bg-window .bh { left: 0; right: 0; top: 42%; height: calc(var(--ft) * .7); transform: translateY(-50%); }
    .bg-window .bs { top: 0; bottom: 0; left: 49%; width: calc(var(--ft) * 1.1); }
    .bg-window .f-cross .bv, .bg-window .f-cross .bh, .bg-window .f-arched .bv, .bg-window .f-arched .bh, .bg-window .f-sliding .bs { display: block; }

    .bg-window .f-arched .sky { border-radius: 50% 50% calc(var(--u) * .4) calc(var(--u) * .4) / calc(var(--u) * 30) calc(var(--u) * 30) calc(var(--u) * .4) calc(var(--u) * .4); }
    .bg-window .f-round .wf { left: 50%; top: 50%; right: auto; bottom: auto; width: calc(var(--u) * 94); height: calc(var(--u) * 94); transform: translate(-50%, -50%); border-radius: 50%; }
    .bg-window .f-round .sky { inset: calc(var(--u) * 3); border-radius: 50%; }
    .bg-window .f-none .wf { inset: 0; }
    .bg-window .f-none .sky { inset: 0; border-radius: 0; box-shadow: none; }

    @keyframes bwTwinkle { from { opacity: calc(var(--s) * .35); } to { opacity: var(--s); } }
    @keyframes bwDrift { from { transform: translateX(-130%); } to { transform: translateX(460%); } }
    @keyframes bwFall { from { transform: translateY(calc(var(--u) * -70)); } to { transform: translateY(calc(var(--u) * 70)); } }
    @keyframes bwSlide { 0% { transform: translateY(0); opacity: 0; } 8% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateY(calc(var(--u) * 55)); opacity: 0; } }
    @keyframes bwBolt { 0%, 91%, 100% { opacity: 0; } 92% { opacity: .8; } 93% { opacity: .1; } 94.5% { opacity: .6; } 97% { opacity: 0; } }
    @keyframes bwGlint { from { transform: translateX(-50%) scaleX(.8); } to { transform: translateX(-50%) scaleX(1.15); } }`,

  mount(el) {
    el.innerHTML = `<div class="wv"><div class="wf"><div class="sky">
      <div class="stars">${STARS}</div><div class="sun"></div><div class="mn"></div>
      <div class="fl fl1"></div><div class="fl fl2"></div><div class="clouds">${CLOUDS}</div>
      ${CITY}${HILLS}${SEA}<div class="rain">${RAIN}</div><div class="fog"></div>
      <div class="refl"></div><div class="drops">${DROPS}</div><div class="grain"></div><div class="shade"></div>
      <i class="bar bv"></i><i class="bar bh"></i><i class="bar bs"></i>
    </div></div></div>`;
  },

  update(el, ctx) {
    const wv = el.querySelector('.wv'), w = ctx.weather || {}, cond = WX[w.cond] ? w.cond : 'clear', wx = WX[cond];
    const now = ctx.now || new Date(), m = mins(now);
    const sr = w.sunrise ? mins(w.sunrise) : 360, ss = w.sunset ? mins(w.sunset) : 1080;
    // real skies are less saturated than the key colours: pull each a little toward its own grey
    const sky = skyAt(m, sr, ss).map(c => weathered(c, wx)).map(c => lerp(c, [lum(c), lum(c), lum(c)], .14));
    const day = clamp((lum(sky[1]) - 30) / 110, 0, 1);   // 0 = night, 1 = full day
    const base = { clear: [236, 238, 244], partly: [230, 232, 238], cloud: [186, 192, 204], rain: [116, 124, 138], thunder: [72, 76, 90], fog: [196, 200, 208] }[cond];
    const cloud = lerp(lerp(sky[1], base, .7).map(v => v * (.35 + .65 * day)), base.map(v => v * .32), 1 - Math.max(day, .25));
    // undersides: shaded, and lit warm in the hour around sunrise and sunset
    const glow = Math.max(0, 1 - Math.min(Math.abs(m - ss), Math.abs(m - sr)) / 60) * (1 - wx.grey);
    const shade = lerp(cloud.map(v => v * .72), [244, 140, 92], glow * .6);
    const haze = lerp(sky[2], [255, 236, 214], .18 * day);

    // sun along its arc by day, moon along the night arc
    const f = (m - sr) / (ss - sr), up = f >= 0 && f <= 1;
    const nStart = m >= ss ? ss : ss - 1440, nEnd = m >= ss ? sr + 1440 : sr, fn = clamp((m - nStart) / (nEnd - nStart), 0, 1);
    const arcX = t => 10 + 80 * t + '%', arcY = t => 82 - 66 * Math.sin(Math.PI * clamp(t, 0, 1)) + '%';
    const rimA = (.12 + .28 * day).toFixed(2);
    const vars = {
      '--s1': rgb(sky[0]), '--s2': rgb(sky[1]), '--s3': rgb(sky[2]), '--hz': rgb(haze), '--cc': rgb(cloud), '--cs': rgb(shade),
      '--rim': `rgba(${sky[1].map(v => Math.round(Math.min(235, v + 30))).join(',')},${rimA})`,
      '--far': rgb(lerp(sky[2], [0, 0, 0], .62)),
      '--sea1': rgb(lerp(sky[2], sky[1], .4).map(v => v * .62)), '--sea2': rgb(sky[0].map(v => v * .4)),
      '--lit': (1 - day) * .9,
      '--fogc': rgb(lerp(sky[2], [170, 176, 186], .5).map(v => v * (.4 + .6 * day))),
      '--sx': arcX(clamp(f, 0, 1)), '--sy': arcY(f), '--so': up ? wx.sun : 0,
      '--mx': arcX(fn), '--my': arcY(fn), '--mo': up ? 0 : (cond === 'clear' || cond === 'partly' ? .9 : cond === 'fog' ? .25 : .12),
      '--st': (1 - day) * (cond === 'clear' ? 1 : cond === 'partly' ? .6 : .1)
    };
    const o = ctx.opts || {}, cls = `wv f-${o.frame || 'cross'} s-${o.scene || 'city'} c-${cond}`;
    if (wv.className !== cls) wv.className = cls;
    const key = JSON.stringify(vars) + wx.clouds;
    if (wv._k === key) return;   // nothing changed: leave the styles alone
    wv._k = key;
    for (const k in vars) wv.style.setProperty(k, vars[k]);
    // far clouds are fainter; the count follows the weather
    el.querySelectorAll('.cl').forEach((c, i) => { c.style.opacity = i < wx.clouds ? wx.cloudA * (c.classList.contains('far') ? .7 : 1) : 0; });
  }
});
})();
