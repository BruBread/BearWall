// Alerts: things the system notices. Invisible until something is active, then it catches your attention.
// Levels: info = a quiet glow pulse, warning = flashes once then stays, critical = keeps flashing (Full / Lite only).
// Each style shows the most important active alert of its kind; the style files are one line each (alerts-*.js).
(function () {
const U = BearWall.util;
const RANK = { critical: 3, warning: 2, info: 1 };
const topOf = (alerts, kind) => (alerts || []).filter(a => a.kind === kind)
  .sort((a, b) => RANK[b.level] - RANK[a.level] || b.since - a.since)[0];
const MARK = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16"/><path d="M20 11v11M20 28.5v.5"/></svg>';

// One module per kind. `type` and `styleName` differ; the drawing is shared.
BearWall.alertModule = (kind, type, styleName, name) => Object.assign({
  type, name, styleName,
  size: { square: [264, 264], rect: [488, 104] },
  every: 30000,
  mount(el) {
    el.innerHTML = `<div class="al" hidden><div class="bd">${MARK}</div><div class="tx"><div class="t fit"></div><div class="d fit"></div></div></div>`;
  },
  update(el, ctx) {
    const a = topOf(ctx.alerts, kind), al = el.querySelector('.al');
    al.hidden = !a;
    if (!a) { al._k = ''; return; }
    const k = a.id + ':' + a.level;
    if (al._k !== k) { al.className = 'al'; void al.offsetWidth; al._k = k; }   // a new alert restarts its flash
    al.className = 'al lv-' + a.level;
    al.querySelector('.t').textContent = a.title;
    al.querySelector('.d').textContent = a.detail || '';
    U.fit(el);
  }
}, type === 'alerts' ? {} : { family: 'alerts' });

/* ---------- Network: speed test ----------
   Every 10 min: ping + jitter (5 tiny requests). Every 60 min: a quick ~3 MB download and ~1 MB upload.
   About 96 MB a day. Shown calmly when no network alert is active; a download under 30% of your usual
   becomes a warning. Results stay in this browser ('bearwall.speed'). */
const CF = 'https://speed.cloudflare.com';
const sp = (() => { try { return JSON.parse(localStorage.getItem('bearwall.speed')) || {}; } catch (e) { return {}; } })();
sp.downs = sp.downs || []; sp.ups = sp.ups || [];
const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const usual = k => median(sp[k]);
let spBusy = false, spTimer = null;
const netEls = new Set();   // mounted Network widgets, refreshed right after a test

async function runSpeed(full) {
  if (spBusy) return;   // never overlap tests
  spBusy = true;
  const ac = new AbortController(), stop = setTimeout(() => ac.abort(), 15000), opt = { cache: 'no-store', signal: ac.signal };
  try {
    const t = [];   // latency works even without CORS (opaque responses still time fine)
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); await fetch(`${CF}/__down?bytes=0&r=${Math.random()}`, Object.assign({ mode: 'no-cors' }, opt)); t.push(performance.now() - t0); }
    sp.ping = Math.round(median(t));
    sp.jitter = Math.round(t.slice(1).reduce((a, v, i) => a + Math.abs(v - t[i]), 0) / (t.length - 1));
    if (full || !sp.fullAt || Date.now() - sp.fullAt >= 3600e3) {
      sp.fullAt = Date.now();
      let t0 = performance.now();
      const buf = await (await fetch(`${CF}/__down?bytes=3000000&r=${Math.random()}`, opt)).arrayBuffer();
      sp.down = Math.round(buf.byteLength * 8 / ((performance.now() - t0) / 1000) / 1e6);
      t0 = performance.now();
      await fetch(`${CF}/__up`, Object.assign({ method: 'POST', mode: 'no-cors', body: new Uint8Array(1e6) }, opt));
      sp.up = Math.round(8 / ((performance.now() - t0) / 1000));   // 1 MB = 8 Mbit
      sp.downs = sp.downs.concat(sp.down).slice(-6); sp.ups = sp.ups.concat(sp.up).slice(-6);
    }
    sp.at = Date.now();
  } catch (e) {   // blocked or offline: keep the last results; never measured shows '—'
  } finally {
    clearTimeout(stop); spBusy = false;
    try { localStorage.setItem('bearwall.speed', JSON.stringify(sp)); } catch (e) {}
    netEls.forEach(el => el.isConnected ? net.update(el, el._ctx) : netEls.delete(el));
  }
}
BearWall.speedTest = () => runSpeed(true);

// download far under your usual → a warning (needs a few hourly runs to know "usual")
function speedAlert() {
  const u = usual('downs');
  if (!sp.down || sp.downs.length < 3 || sp.down >= u * .3) return null;
  return { id: 'speed-slow', kind: 'network', level: 'warning', title: `Slow internet · ${sp.down} Mbps`, detail: `usually ${Math.round(u)}`, since: new Date(sp.at) };
}
const v = x => x == null ? '—' : x;

const base = BearWall.alertModule('network', 'alerts', 'Network', 'Alerts');
const net = Object.assign({}, base, {
  mount(el, ctx) {
    base.mount(el, ctx);
    el.insertAdjacentHTML('beforeend', `<div class="sp" hidden><div class="rg">${U.ringHTML('<span class="n">—</span>')}<div class="lb">↓ Mbps</div></div>`
      + `<div class="rg">${U.ringHTML('<span class="n">—</span>')}<div class="lb">↑ Mbps</div></div><div class="ln fit"></div></div>`);
    netEls.add(el);
    if (!spTimer) { setTimeout(() => runSpeed(false), 5000); spTimer = setInterval(() => runSpeed(false), 600e3); }
  },
  update(el, ctx) {
    el._ctx = ctx;
    const extra = (ctx.alerts || []).some(a => a.kind === 'network') ? null : speedAlert();
    base.update(el, extra ? Object.assign({}, ctx, { alerts: (ctx.alerts || []).concat(extra) }) : ctx);
    const s = el.querySelector('.sp');
    s.hidden = !el.querySelector('.al').hidden;   // the readout only shows when no alert does
    if (s.hidden) return;
    const rg = s.querySelectorAll('.rg');
    [['down', 'downs'], ['up', 'ups']].forEach(([k, h], i) => {
      rg[i].querySelector('.n').textContent = v(sp[k]);
      U.setRing(rg[i].querySelector('.ring'), sp[k] ? Math.min(100, sp[k] / (usual(h) || sp[k]) * 100) : 0);
    });
    s.querySelector('.ln').textContent = ctx.mode === 'rect'
      ? `↓ ${v(sp.down)} Mbps · ↑ ${v(sp.up)} · ${v(sp.ping)} ms ± ${v(sp.jitter)}`
      : `${v(sp.ping)} ms ± ${v(sp.jitter)}`;
    U.fit(el);
  }
});

BearWall.register(Object.assign(net, {
  css: `
    .w-alerts .sp { position: absolute; inset: 0; display: flex; flex-wrap: wrap; align-content: center; justify-content: center;
      column-gap: calc(var(--u) * 8); row-gap: calc(var(--u) * 4); opacity: .75; }
    .w-alerts .rg { width: calc(var(--u) * 38); text-align: center; }
    .w-alerts .rg .tp { font-weight: 800; font-size: calc(var(--u) * 10); color: var(--w-text); }
    .w-alerts .lb, .w-alerts .sp .ln { color: var(--w-dim); font-size: calc(var(--u) * 5.5); margin-top: calc(var(--u) * 1.5); }
    .w-alerts .sp .ln { width: 100%; text-align: center; font-size: calc(var(--u) * 6.5 * var(--fit, 1)); }
    .w-alerts.rect .rg { display: none; }
    .w-alerts.rect .sp { justify-content: flex-start; }
    .w-alerts.rect.right .sp { justify-content: flex-end; }
    .w-alerts.rect .sp .ln { text-align: inherit; font-size: calc(var(--u) * 20 * var(--fit, 1)); margin: 0; }
    .w-alerts.rect.right .sp .ln { text-align: right; }
    .w-alerts.rect:not(.right) .sp .ln { text-align: left; }`
    + `
    [class*="w-alerts"] .al { --al: var(--ring); position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: calc(var(--u) * 5); text-align: center; }
    [class*="w-alerts"] .al.lv-warning { --al: #ffb84d; }
    [class*="w-alerts"] .al.lv-critical { --al: #ff5e5e; }
    [class*="w-alerts"] .bd { width: calc(var(--u) * 36); height: calc(var(--u) * 36); color: var(--al); flex: none;
      filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 4) var(--al)); }
    [class*="w-alerts"] .bd svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 3.4; stroke-linecap: round; }
    [class*="w-alerts"] .tx { width: 100%; min-width: 0; }
    [class*="w-alerts"] .t { font-weight: 800; color: var(--w-text); font-size: calc(var(--u) * 9 * var(--fit, 1));
      text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) var(--al); }
    [class*="w-alerts"] .d { color: var(--w-dim); font-size: calc(var(--u) * 5.5 * var(--fit, 1)); margin-top: calc(var(--u) * 1.5); }
    [class*="w-alerts"].rect .al { flex-direction: row; justify-content: flex-start; text-align: left; gap: calc(var(--u) * 12); }
    [class*="w-alerts"].rect.right .al { flex-direction: row-reverse; text-align: right; }
    [class*="w-alerts"].rect .bd { width: calc(var(--u) * 70); height: calc(var(--u) * 70); }
    [class*="w-alerts"].rect .tx { flex: 1 1 0; }
    [class*="w-alerts"].rect .t { font-size: calc(var(--u) * 26 * var(--fit, 1)); }
    [class*="w-alerts"].rect .d { font-size: calc(var(--u) * 15 * var(--fit, 1)); margin-top: calc(var(--u) * 3); }
    .m-full [class*="w-alerts"] .lv-info .bd, .m-lite [class*="w-alerts"] .lv-info .bd { animation: bwAlPulse 2.4s ease-in-out infinite alternate; }
    .m-full [class*="w-alerts"] .lv-warning, .m-lite [class*="w-alerts"] .lv-warning { animation: bwAlFlash .45s linear 3; }
    .m-full [class*="w-alerts"] .lv-critical, .m-lite [class*="w-alerts"] .lv-critical { animation: bwAlFlash 1.2s linear infinite; }
    .m-lite [class*="w-alerts"] .al, .m-lite [class*="w-alerts"] .bd { animation-timing-function: steps(4) !important; }
    @keyframes bwAlPulse { from { opacity: .55; } to { opacity: 1; } }
    @keyframes bwAlFlash { 0%, 100% { opacity: 1; } 50% { opacity: .15; } }`
}));
})();
