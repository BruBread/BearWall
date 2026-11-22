// Dynamic: one big card at a time, the most relevant thing right now (spec: docs/superpowers/specs/2026-11-22-dynamic-widget-design.md).
// Cards come from the wall's feed (BearWall.cards()). Tiers: urgent interrupts, heads-up pops once per change, ambient rotates,
// base is the never-blank default. Main (the first Dynamic set to Main) gets every urgent card, the debrief and the strip;
// the others are Secondary: only their sources, and never the card Main is showing.
(function () {
const U = BearWall.util;
const RANK = { urgent: 3, heads: 2, ambient: 1, base: 0 };
const SRC = ['weather', 'alerts', 'time', 'lights'];
const BASE_ORDER = ['weather', 'time', 'alerts', 'lights'];   // a Secondary's default: its first ticked source
const showing = {};   // widget id -> card id, so a Secondary skips what Main shows
const ICONS = {
  alert: '<circle cx="32" cy="32" r="22"/><path d="M32 20v16M32 44v1"/>',
  ok: '<circle cx="32" cy="32" r="22"/><path d="M22 33l7 7 13-15"/>',
  day: '<rect x="12" y="16" width="40" height="36" rx="5"/><path d="M12 26h40M22 11v9M42 11v9"/>',
  bulb: '<path d="M24 40c0-6-6-9-6-17a14 14 0 0 1 28 0c0 8-6 11-6 17zM25 46h14M27 52h10"/>',
  school: '<path d="M6 26l26-12 26 12-26 12zM16 31v12c8 7 24 7 32 0V31"/>',
  sunset: '<path d="M14 44a18 18 0 0 1 36 0M6 44h52M32 14v8M14 26l5 5M50 26l-5 5"/>',
  moon: '<path class="c-moon" d="M41 13a19 19 0 1 0 11 31 15 15 0 0 1-11-31z"/>'
};
const WX = ['clear', 'partly', 'cloud', 'rain', 'thunder', 'fog'];
const iconOf = c => WX.indexOf(c.icon) >= 0 ? U.iconSVG(c.icon, !!c.night)
  : ICONS[c.icon] ? `<svg viewBox="0 0 64 64" aria-hidden="true">${ICONS[c.icon]}</svg>` : '';

function body(c) {
  if (c.kind === 'clock') return `<div class="dy-clk"><div class="dy-big fit">${U.esc(c.title)}</div><div class="dy-d fit">${U.esc(c.detail || '')}</div></div>`;
  if (c.kind === 'now') return `<div class="dy-now"><div class="dy-i">${iconOf(c)}</div><div class="dy-tx"><div class="dy-big fit">${U.esc(c.title)}</div>`
    + `<div class="dy-d fit">${U.esc(c.detail || '')}</div></div></div><div class="dy-nx fit">${c.next ? 'Next · ' + U.esc(c.next) : ''}</div>`;
  if (c.kind === 'timeline') return `<div class="dy-t fit">${U.esc(c.title)}</div><div class="dy-tl">`
    + (c.hours || []).map(h => `<div><div class="dy-d">${U.esc(h.t)}</div><div class="dy-si">${U.iconSVG(h.c, h.n)}</div><div class="dy-tt">${h.temp}°</div></div>`).join('') + '</div>';
  return `<div class="dy-row"><div class="dy-i">${iconOf(c)}</div><div class="dy-tx"><div class="dy-t fit">${U.esc(c.title)}</div><div class="dy-d fit">${U.esc(c.detail || '')}</div></div></div>`;
}
const sig = c => c.id + '|' + c.key + '|' + c.title + '|' + c.detail + '|' + (c.next || '');

BearWall.register({
  type: 'dynamic', name: 'Dynamic', styleName: 'Dynamic',
  size: { square: [320, 240], rect: [488, 104] },
  every: 1000,
  look: ['ring', 'text', 'dim', 'glow', 'icons'], lookLabels: { ring: 'Accent color' },
  options: [
    { key: 'role', label: 'Role', type: 'tabs', choices: [['main', 'Main'], ['secondary', 'Secondary']], value: 'main' },
    { key: 'src_weather', label: 'Weather', type: 'switch', value: true },
    { key: 'src_alerts', label: 'Alerts', type: 'switch', value: true },
    { key: 'src_time', label: 'Day & time', type: 'switch', value: true },
    { key: 'src_lights', label: 'Lights', type: 'switch', value: true },
    { key: 'sec_heads', label: 'Heads-up cards (Secondary)', type: 'switch', value: true },
    { key: 'sec_ambient', label: 'Rotating cards (Secondary)', type: 'switch', value: true },
    { key: 'hold', label: 'A new card stays up', type: 'select', choices: [['6', '6 s'], ['8', '8 s'], ['12', '12 s']], value: '8' },
    { key: 'rotate', label: 'Rotate every', type: 'select', choices: [['30', '30 s'], ['60', '1 min'], ['120', '2 min']], value: '60' }
  ],
  css: `
    .w-dynamic .dy { position: absolute; inset: 0; display: flex; flex-direction: column; }
    .w-dynamic .dy-stage { position: relative; flex: 1 1 0; min-height: 0; }
    .w-dynamic .dy-card, .w-dynamic .dy-out { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: calc(var(--u) * 3); }
    .w-dynamic .dy-out { pointer-events: none; }
    .m-full .w-dynamic .dy-card.pop, .m-lite .w-dynamic .dy-card.pop { animation: dyPop .45s cubic-bezier(.2, .9, .3, 1.15) both; }
    .m-full .w-dynamic .dy-out, .m-lite .w-dynamic .dy-out { animation: dyOut .4s ease-in both; }
    .m-calm .w-dynamic .dy-card.pop { animation: dyFade .6s ease both; }
    .m-calm .w-dynamic .dy-out, .m-off .w-dynamic .dy-out { display: none; }
    .m-lite .w-dynamic .dy-card.pop, .m-lite .w-dynamic .dy-out { animation-timing-function: steps(6, end); }
    @keyframes dyPop { from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: none; } }
    @keyframes dyOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(18%) scale(.96); } }
    @keyframes dyFade { from { opacity: 0; } to { opacity: 1; } }
    .w-dynamic .dy-row, .w-dynamic .dy-now { display: flex; align-items: center; gap: calc(var(--u) * 6); min-width: 0; }
    .w-dynamic .dy-i { flex: none; width: calc(var(--u) * 30); height: calc(var(--u) * 30); }
    .w-dynamic .dy-i svg { width: 100%; height: 100%; fill: none; stroke: var(--ring); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round;
      filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 2) var(--ring)); }
    .w-dynamic .dy-tx { flex: 1 1 0; min-width: 0; }
    .w-dynamic .dy-t { font-weight: 800; color: var(--w-text); font-size: calc(var(--u) * 13 * var(--fit, 1)); }
    .w-dynamic .dy-big { font-weight: 800; color: var(--w-text); font-size: calc(var(--u) * 26 * var(--fit, 1)); line-height: 1;
      text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) var(--ring); }
    .w-dynamic .dy-d { color: var(--w-dim); font-size: calc(var(--u) * 7 * var(--fit, 1)); margin-top: calc(var(--u) * 1.5); }
    .w-dynamic .dy-nx { color: var(--w-text); font-size: calc(var(--u) * 8 * var(--fit, 1)); border-top: 2px solid var(--track); padding-top: calc(var(--u) * 3); }
    .w-dynamic .dy-clk { text-align: center; opacity: .55; }
    .w-dynamic .dy-tl { display: flex; justify-content: space-between; gap: calc(var(--u) * 4); text-align: center; }
    .w-dynamic .dy-tl > div { flex: 1 1 0; }
    .w-dynamic .dy-si { width: calc(var(--u) * 20); height: calc(var(--u) * 20); margin: calc(var(--u) * 2) auto; }
    .w-dynamic .dy-si svg { width: 100%; height: 100%; }
    .w-dynamic .dy-tt { font-weight: 800; color: var(--w-text); font-size: calc(var(--u) * 12); }
    .w-dynamic .dy-strip { flex: none; display: flex; gap: calc(var(--u) * 3); margin-top: calc(var(--u) * 3); min-width: 0; }
    .w-dynamic .dy-strip:empty { display: none; }
    .w-dynamic .dy-chip { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; gap: calc(var(--u) * 2); padding: calc(var(--u) * 1.5) calc(var(--u) * 3);
      border: 2px solid var(--track); border-radius: 99px; color: var(--w-dim); font-size: calc(var(--u) * 6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .w-dynamic .dy-chip.urgent { border-color: var(--ring); color: var(--w-text); }
    .w-dynamic .dy-chip svg { flex: none; width: calc(var(--u) * 8); height: calc(var(--u) * 8); fill: none; stroke: currentColor; stroke-width: 4; }
    .w-dynamic.rect .dy-strip { display: none; }
    .w-dynamic.rect .dy-big { font-size: calc(var(--u) * 40 * var(--fit, 1)); }
    .w-dynamic.rect .dy-t { font-size: calc(var(--u) * 24 * var(--fit, 1)); }
    .w-dynamic.rect .dy-d, .w-dynamic.rect .dy-nx { font-size: calc(var(--u) * 13 * var(--fit, 1)); }
    .w-dynamic.rect .dy-i { width: calc(var(--u) * 60); height: calc(var(--u) * 60); }
    .w-dynamic.rect .dy-now { gap: calc(var(--u) * 10); }
    .w-dynamic.rect .dy-card { flex-direction: row; align-items: center; gap: calc(var(--u) * 10); }
    .w-dynamic.rect .dy-nx { border: 0; padding: 0; }`,
  mount(el) {
    el.innerHTML = '<div class="dy"><div class="dy-stage"><div class="dy-card"></div></div><div class="dy-strip"></div></div>';
    el._d = { cur: null, sig: '', popAt: 0, seen: {}, last: {}, rotAt: Date.now(), primed: false };
  },
  update(el, ctx) {
    const d = el._d, o = ctx.opts, now = Date.now(), main = BearWall.isMainDynamic(ctx.id);
    const srcs = SRC.filter(s => o['src_' + s] !== false), hold = (+o.hold || 8) * 1000, rotate = (+o.rotate || 60) * 1000;
    const mainShows = new Set(Object.keys(showing).filter(id => id !== ctx.id && BearWall.isMainDynamic(id)).map(id => showing[id]));
    const all = BearWall.cards(), mine = all.filter(c => c.tier !== 'base' && (main ? srcs.indexOf(c.source) >= 0 || c.tier === 'urgent'
      : srcs.indexOf(c.source) >= 0 && (c.tier !== 'heads' || o.sec_heads !== false) && (c.tier !== 'ambient' || o.sec_ambient !== false) && !mainShows.has(c.id)));
    const baseId = s => 'base-' + (s === 'weather' ? 'now' : s), first = BASE_ORDER.find(s => srcs.indexOf(s) >= 0 && all.some(x => x.id === baseId(s)));
    const base = all.find(c => c.id === (first ? baseId(first) : 'base-time'))
      || { id: 'local-date', tier: 'base', icon: 'day', title: new Date().toDateString(), detail: '', key: 'd' };   // before the feed's first tick
    if (!d.primed) { mine.forEach(c => { if (c.tier === 'heads') d.seen[c.id] = c.key; }); d.primed = true; }   // no pop storm on start
    const alive = c => c && (c === BearWall.spot || all.some(x => x.id === c.id));
    const fresh = mine.filter(c => (c.tier === 'urgent' || c.tier === 'heads') && d.seen[c.id] !== c.key).sort((a, b) => RANK[b.tier] - RANK[a.tier] || b.at - a.at)[0];
    let next = null;
    if (main && BearWall.spot) next = BearWall.spot;   // the debrief
    else if (fresh && (!d.cur || !d.popped || RANK[fresh.tier] >= RANK[d.cur.tier] || now - d.popAt >= hold)) { next = fresh; d.seen[fresh.id] = fresh.key; d.popped = true; d.popAt = now; }
    else if (d.popped && alive(d.cur) && now - d.popAt < hold) next = all.find(c => c.id === d.cur.id) || d.cur;
    else {
      d.popped = false;
      const amb = mine.filter(c => c.tier === 'ambient');
      const onAmb = d.cur && d.cur.tier === 'ambient' && alive(d.cur);
      if (onAmb && now - d.rotAt < Math.max(hold, 15000)) next = all.find(c => c.id === d.cur.id);
      else if (!onAmb && amb.length && now - d.rotAt >= rotate) { next = amb.sort((a, b) => (d.last[a.id] || 0) - (d.last[b.id] || 0))[0]; d.rotAt = now; }
      else { next = base; if (onAmb) d.rotAt = now; }
    }
    next = next || base;
    showing[ctx.id] = next && next.id;
    d.last[next.id] = now;
    // draw: a different card pops in (the old one drops out); the same card just refreshes its text
    const stage = el.querySelector('.dy-stage'), cardEl = el.querySelector('.dy-card'), s = sig(next);
    if (!d.cur || d.cur.id !== next.id || d.cur.key !== next.key) {
      if (d.cur && ctx.motion !== 'off' && ctx.motion !== 'calm') {
        const out = cardEl.cloneNode(true); out.className = 'dy-out';
        stage.appendChild(out); setTimeout(() => out.remove(), 450);
      }
      cardEl.className = 'dy-card'; void cardEl.offsetWidth; cardEl.className = 'dy-card pop';
    }
    if (s !== d.sig) {
      cardEl.innerHTML = body(next);
      d.sig = s;
    }
    d.cur = next;
    // Main's strip: pinned urgent first, then heads-ups from the last 2 h
    const strip = el.querySelector('.dy-strip');
    const chips = main && ctx.mode === 'square' ? all.filter(c => c.tier === 'urgent' && c.id.indexOf('db-') !== 0)
      .concat(all.filter(c => c.tier === 'heads' && now - c.at < 2 * 3600e3).sort((a, b) => b.at - a.at)).slice(0, 3) : [];
    const sh = (main && BearWall.simulating ? '<div class="dy-chip urgent"><span>SIMULATING</span></div>' : '')   // never mistake a test for the real thing
      + chips.map(c => `<div class="dy-chip ${c.tier}">${iconOf(c)}<span>${U.esc(c.title)}</span></div>`).join('');
    if (strip._h !== sh) { strip.innerHTML = sh; strip._h = sh; }
    U.fit(el);
  }
});
})();
