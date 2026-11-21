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

BearWall.register(Object.assign(BearWall.alertModule('network', 'alerts', 'Network', 'Alerts'), {
  css: `
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
