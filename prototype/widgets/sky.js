// Sun & moon: the sun (or moon at night) travelling an arc from sunrise to sunset, plus tonight's moon phase.
(function () {
const U = BearWall.util;
const DAY = 864e5, SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
const ARC = 'M20 92 A80 80 0 0 1 180 92';   // half circle, center (100, 92), r 80, so dash length and angle agree

// f: 0 = new, .5 = full. illum: lit fraction of the disc.
function moonPhase(date) {
  const age = (((date - NEW_MOON) / DAY) % SYNODIC + SYNODIC) % SYNODIC, f = age / SYNODIC;
  return { f, illum: (1 - Math.cos(2 * Math.PI * f)) / 2, name: NAMES[Math.round(f * 8) % 8] };
}
// lit part: limb arc down the lit side, then the terminator (an ellipse arc) back up
function moonPath({ f, illum }) {
  const R = 20, waxing = f < .5, rx = Math.max(.01, R * Math.abs(1 - 2 * illum));
  return `M24 ${24 - R} A${R} ${R} 0 0 ${waxing ? 1 : 0} 24 ${24 + R} A${rx} ${R} 0 0 ${(illum < .5) === waxing ? 0 : 1} 24 ${24 - R}Z`;
}

console.assert(moonPhase(Date.UTC(2000, 0, 21)).illum > .95 && moonPhase(Date.UTC(2000, 0, 21)).name === 'Full moon', 'sky: 2000-01-21 is a full moon');
console.assert(moonPhase(NEW_MOON).illum < .01 && moonPhase(NEW_MOON).name === 'New moon', 'sky: reference date is a new moon');

BearWall.register({
  type: 'sky',
  name: 'Sun & moon', family: 'clock', styleName: 'Sun & moon',
  size: { square: [264, 264], rect: [488, 104] },
  options: [
    { key: 'times', label: 'Sunrise and sunset times', type: 'switch', value: true },
    { key: 'h24', label: '24-hour time', type: 'switch', value: false }
  ],
  every: 60000,
  css: `
    .w-sky .hz { stroke: var(--w-dim); stroke-width: 2.5; stroke-linecap: round; opacity: .5; }
    .w-sky .base { fill: none; stroke: var(--w-text); stroke-width: 3; stroke-linecap: round; opacity: .18; }
    .w-sky .trav { fill: none; stroke: var(--i-sun); stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 100; stroke-dashoffset: 100;
      transition: stroke-dashoffset 1.3s cubic-bezier(.2, .8, .2, 1); filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 2) var(--i-sun)); }
    .w-sky .dot { fill: var(--i-sun); filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 4) var(--i-sun)); }
    .w-sky .night .trav { stroke: var(--i-moon); filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 2) var(--i-moon)); }
    .w-sky .night .dot { fill: var(--i-moon); filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 4) var(--i-moon)); }
    .m-full .w-sky .dot, .m-lite .w-sky .dot { animation: breathe 4s ease-in-out infinite alternate; --st: 32; }
    .m-off .w-sky .trav { transition: none; }
    .w-sky .times { display: flex; justify-content: space-between; color: var(--w-dim); font-weight: 600; white-space: nowrap; }
    .w-sky .times.dim { opacity: .55; }
    .w-sky .mdisc svg { width: 100%; height: 100%; }
    .w-sky .dark { fill: var(--i-moon); fill-opacity: .1; stroke: var(--i-moon); stroke-opacity: .35; stroke-width: 2; }
    .w-sky .lit { fill: var(--i-moon); filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 2) var(--i-moon)); }
    .w-sky .mname { font-weight: 600; text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-sky .mill { color: var(--w-dim); }
    .w-sky.square { display: grid; grid-template-rows: auto auto auto; align-content: space-evenly; justify-items: center; align-items: center; padding: 2% 3%; }
    .w-sky.square .arcbox, .w-sky.square .times { width: min(100%, calc(var(--u) * 94)); }
    .w-sky.square .arcbox { aspect-ratio: 2 / 1; }
    .w-sky.square .times { font-size: calc(var(--u) * 6.4); margin-top: calc(var(--u) * 1.5); }
    .w-sky.square .moonrow { display: flex; align-items: center; justify-content: center; gap: calc(var(--u) * 4); max-width: 100%; min-width: 0; }
    .w-sky.square .mdisc { width: calc(var(--u) * 26); height: calc(var(--u) * 26); flex: none; }
    .w-sky.square .mtx { min-width: 0; }
    .w-sky.square .mname { font-size: calc(var(--u) * 7.6 * var(--fit, 1)); }
    .w-sky.square .mill { font-size: calc(var(--u) * 5.4 * var(--fit, 1)); margin-top: calc(var(--u) * 1); }
    .w-sky.rect { display: flex; align-items: center; gap: calc(var(--u) * 10); }
    .w-sky.rect.right { flex-direction: row-reverse; }
    .w-sky.rect .arcbox { height: 86%; aspect-ratio: 2 / 1; flex: none; }
    .w-sky.rect .times { flex-direction: column; gap: calc(var(--u) * 4); font-size: calc(var(--u) * 15); flex: none; }
    .w-sky.rect.right .times { align-items: flex-end; }
    .w-sky.rect .moonrow { flex: 1 1 0; min-width: 0; height: 100%; display: flex; align-items: center; gap: calc(var(--u) * 8); }
    .w-sky.rect.right .moonrow { flex-direction: row-reverse; text-align: right; }
    .w-sky.rect .mdisc { height: 62%; aspect-ratio: 1; flex: none; }
    .w-sky.rect .mtx { flex: 1 1 0; min-width: 0; }
    .w-sky.rect .mname { font-size: calc(var(--u) * 19 * var(--fit, 1)); }
    .w-sky.rect .mill { font-size: calc(var(--u) * 14 * var(--fit, 1)); margin-top: calc(var(--u) * 3); }`,
  mount(el) {
    el.innerHTML = `<div class="arcbox"><svg viewBox="0 0 200 100" aria-hidden="true"><line class="hz" x1="4" y1="92" x2="196" y2="92"/>`
      + `<path class="base" d="${ARC}"/><path class="trav" d="${ARC}" pathLength="100"/><circle class="dot anim" r="7"/></svg></div>`
      + `<div class="times"><span class="t1"></span><span class="t2"></span></div>`
      + `<div class="moonrow"><div class="mdisc"></div><div class="mtx"><div class="mname fit"></div><div class="mill fit"></div></div></div>`;
  },
  update(el, ctx) {
    const w = ctx.weather, now = ctx.now.getTime(), rise = w.sunrise.getTime(), set = w.sunset.getTime();
    const day = now >= rise && now < set;
    // night runs from yesterday's sunset to sunrise, or from sunset to tomorrow's sunrise (same times shifted a day)
    const [from, to] = day ? [rise, set] : now < rise ? [set - DAY, rise] : [set, rise + DAY];
    const p = U.clamp((now - from) / (to - from), 0, 1), a = Math.PI * p;
    const box = el.querySelector('.arcbox'), trav = el.querySelector('.trav'), dot = el.querySelector('.dot');
    box.classList.toggle('night', !day);
    dot.setAttribute('cx', 100 - 80 * Math.cos(a)); dot.setAttribute('cy', 92 - 80 * Math.sin(a));
    if (!trav.style.strokeDashoffset) trav.getBoundingClientRect();   // first fill: sweep in from the horizon
    trav.style.strokeDashoffset = 100 - p * 100;

    const times = el.querySelector('.times');
    times.hidden = !ctx.opts.times;
    times.classList.toggle('dim', !day);
    el.querySelector('.t1').textContent = '↑ ' + U.fmtTime(w.sunrise, ctx.opts.h24);
    el.querySelector('.t2').textContent = '↓ ' + U.fmtTime(w.sunset, ctx.opts.h24);

    const m = moonPhase(now), disc = el.querySelector('.mdisc'), svg = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="dark" cx="24" cy="24" r="20"/><path class="lit" d="${moonPath(m)}"/></svg>`;
    if (disc._svg !== svg) { disc.innerHTML = svg; disc._svg = svg; }
    el.querySelector('.mname').textContent = m.name;
    el.querySelector('.mill').textContent = Math.round(m.illum * 100) + '% lit';
    U.fit(el);
  }
});
})();
