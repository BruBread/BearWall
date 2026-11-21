// Projector: the projector's own health, one stat per style so each can sit anywhere on the wall.
// Every style always shows its live value; past a limit you set it turns into an alert (amber, then red, flashing).
// Styles: Temperature, Storage, Memory, Uptime, Power. Values come from ctx.system (simulated in the prototype,
// read from the device by the Phase 1 projector app).
(function () {
const U = BearWall.util;
const GB = b => (b / 1e9).toFixed(1), MB = b => Math.round(b / 1e6);
const clock = d => U.fmtTime(new Date(d), false);
const PLUG = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M15 6v9M25 6v9M11 15h18v6a9 9 0 0 1-18 0zM20 30v5"/></svg>';
const BOLT = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M23 5L11 22h8l-3 13 13-18h-8z"/></svg>';
const lim = (o, k, d) => +o[k] || d;

// One stat style. read(system, opts, now) -> { pct?, value?, unit?, title, detail, level: 'ok'|'info'|'warning'|'critical', icon? }
const stat = (type, styleName, read, options = [], ring = true) => Object.assign({
  type, name: 'Projector', styleName, options,
  size: { square: [264, 264], rect: [488, 104] },
  every: 5000,
  look: ring ? ['ring', 'text', 'dim', 'thick', 'track', 'glow'] : ['ring', 'text', 'dim', 'glow'],
  lookLabels: ring ? {} : { ring: 'Accent color' },
  mount(el) {
    el.innerHTML = `<div class="ps">${ring ? U.ringHTML('<span class="v"></span><span class="un"></span>') : '<div class="pic"></div>'}`
      + '<div class="tx"><div class="t fit"></div><div class="d fit"></div></div></div>';
  },
  update(el, ctx) {
    const r = read(ctx.system, ctx.opts, ctx.now.getTime()), ps = el.querySelector('.ps');
    if (ps._lv !== r.level) { ps.className = 'ps'; void ps.offsetWidth; ps._lv = r.level; }   // a new level restarts its flash
    ps.className = 'ps lv-' + r.level;
    if (ring) {
      U.setRing(el.querySelector('.ring'), r.pct);
      el.querySelector('.v').textContent = r.value;
      el.querySelector('.un').textContent = r.unit || '';
    } else if (el.querySelector('.pic')._i !== r.icon) { el.querySelector('.pic').innerHTML = r.icon; el.querySelector('.pic')._i = r.icon; }
    el.querySelector('.t').textContent = r.title;
    el.querySelector('.d').textContent = r.detail;
    U.fit(el);
  }
}, type === 'projector' ? {} : { family: 'projector' });

const temp = stat('projector', 'Temperature', (s, o) => {
  const L = lim(o, 'limit', 75), t = s.temp;
  if (t == null) return { pct: 0, value: '—', unit: '', title: 'Projector chip', level: 'ok', detail: 'No temperature sensor found' };
  return { pct: t, value: t, unit: '°C', title: 'Projector chip',
    level: t >= L + 8 ? 'critical' : t >= L ? 'warning' : 'ok',
    detail: t >= L + 8 ? 'Too hot · let it cool down' : t >= L ? 'Running hot' : t >= L - 15 ? 'Warm, all fine' : 'Cool' };
}, [{ key: 'limit', label: 'Warn above', type: 'tabs', choices: [['65', '65°C'], ['70', '70°C'], ['75', '75°C'], ['80', '80°C']], value: '75' }]);

const storage = stat('projector-storage', 'Storage', (s, o) => {
  const L = lim(o, 'limit', 90), pct = s.storage.used / s.storage.total * 100;
  return { pct, value: Math.round(pct), unit: '%', title: `${GB(s.storage.total - s.storage.used)} GB free`,
    level: pct >= 97 ? 'critical' : pct >= L ? 'warning' : 'ok', detail: pct >= L ? 'Storage almost full' : 'Projector storage' };
}, [{ key: 'limit', label: 'Warn when fuller than', type: 'tabs', choices: [['80', '80%'], ['90', '90%'], ['95', '95%']], value: '90' }]);

const memory = stat('projector-memory', 'Memory', (s, o) => {
  const L = lim(o, 'limit', 90), pct = s.memory.used / s.memory.total * 100;
  return { pct, value: Math.round(pct), unit: '%', title: `${MB(s.memory.total - s.memory.used)} MB free`,
    level: pct >= 97 ? 'critical' : pct >= L ? 'warning' : 'ok', detail: pct >= L ? 'Memory almost full' : 'Projector memory' };
}, [{ key: 'limit', label: 'Warn when fuller than', type: 'tabs', choices: [['80', '80%'], ['90', '90%'], ['95', '95%']], value: '90' }]);

const uptime = stat('projector-uptime', 'Uptime', (s, o, now) => {
  const L = lim(o, 'days', 14), ms = now - s.bootAt, d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 3600e3);
  return { pct: Math.min(100, ms / (L * 864e5) * 100), value: d || h, unit: d ? 'd' : 'h', title: `Up ${d ? d + ' d ' : ''}${h} h`,
    level: d >= L ? 'info' : 'ok', detail: d >= L ? 'A restart would help' : 'Running smoothly' };
}, [{ key: 'days', label: 'Suggest a restart after', type: 'tabs', choices: [['7', '7 days'], ['14', '14 days'], ['30', '30 days']], value: '14' }]);

const power = stat('projector-power', 'Power', (s, o, now) => {
  const recent = s.powerCuts.filter(c => now - c.to < 7 * 864e5).slice(-1)[0];
  if (!recent) return { icon: PLUG, level: 'ok', title: 'No power cuts', detail: 'in the last 7 days' };
  const span = `${clock(recent.from)}–${clock(recent.to)}`;
  if (now - recent.to < 3600e3) return { icon: BOLT, level: 'warning', title: 'Power cut', detail: `${span} · back ${U.ago(recent.to)}` };
  return { icon: PLUG, level: 'ok', title: 'Last power cut', detail: `${new Date(recent.from).toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${span}` };
}, [], false);

temp.css = `
  [class*="w-projector"] .ps { --lc: var(--ring); position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: calc(var(--u) * 4); text-align: center; }
  [class*="w-projector"] .ps.lv-info { --lc: var(--ring); }
  [class*="w-projector"] .ps.lv-warning { --lc: #ffb84d; --ring: #ffb84d; }
  [class*="w-projector"] .ps.lv-critical { --lc: #ff5e5e; --ring: #ff5e5e; }
  [class*="w-projector"] .ring { width: 58%; }
  [class*="w-projector"] .tp { font-weight: 800; font-size: calc(var(--u) * 15); color: var(--w-text); text-shadow: 0 0 calc(var(--glow) * var(--u) * 4) var(--lc); }
  [class*="w-projector"] .un { font-weight: 400; font-size: .5em; opacity: .75; margin-left: .1em; }
  [class*="w-projector"] .pic { width: calc(var(--u) * 40); height: calc(var(--u) * 40); color: var(--lc); filter: drop-shadow(0 0 calc(var(--glow) * var(--u) * 4) var(--lc)); }
  [class*="w-projector"] .lv-ok .pic { opacity: .7; }
  [class*="w-projector"] .pic svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
  [class*="w-projector"] .tx { width: 100%; min-width: 0; }
  [class*="w-projector"] .t { font-weight: 700; color: var(--w-text); font-size: calc(var(--u) * 7.5 * var(--fit, 1)); }
  [class*="w-projector"] .d { color: var(--w-dim); font-size: calc(var(--u) * 5.5 * var(--fit, 1)); margin-top: calc(var(--u) * 1.2); }
  [class*="w-projector"] .lv-warning .d, [class*="w-projector"] .lv-critical .d { color: var(--lc); }
  [class*="w-projector"].rect .ps { flex-direction: row; justify-content: flex-start; text-align: left; gap: calc(var(--u) * 12); }
  [class*="w-projector"].rect.right .ps { flex-direction: row-reverse; text-align: right; }
  [class*="w-projector"].rect .ring { width: auto; height: 100%; flex: none; }
  [class*="w-projector"].rect .tp { font-size: calc(var(--u) * 26); }
  [class*="w-projector"].rect .pic { width: calc(var(--u) * 70); height: calc(var(--u) * 70); flex: none; }
  [class*="w-projector"].rect .tx { flex: 1 1 0; }
  [class*="w-projector"].rect .t { font-size: calc(var(--u) * 24 * var(--fit, 1)); }
  [class*="w-projector"].rect .d { font-size: calc(var(--u) * 14 * var(--fit, 1)); margin-top: calc(var(--u) * 3); }
  .m-full [class*="w-projector"] .lv-info .ring, .m-lite [class*="w-projector"] .lv-info .ring { animation: bwPsPulse 2.4s ease-in-out infinite alternate; }
  .m-full [class*="w-projector"] .lv-warning, .m-lite [class*="w-projector"] .lv-warning { animation: bwPsFlash .45s linear 3; }
  .m-full [class*="w-projector"] .lv-critical, .m-lite [class*="w-projector"] .lv-critical { animation: bwPsFlash 1.2s linear infinite; }
  .m-lite [class*="w-projector"] .ps, .m-lite [class*="w-projector"] .ring { animation-timing-function: steps(4) !important; }
  @keyframes bwPsPulse { from { opacity: .55; } to { opacity: 1; } }
  @keyframes bwPsFlash { 0%, 100% { opacity: 1; } 50% { opacity: .15; } }`;

[temp, storage, memory, uptime, power].forEach(m => BearWall.register(m));
})();
