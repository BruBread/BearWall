/* Remote pages on the Main Dynamic (section 1): ◀ ▶ swipe between  Timer · Home · Update , OK acts, BACK goes Home.
 * Home is the Dynamic as it is (OK there = the debrief). Idle 60 s -> Home.
 * Timer: "Start timer?" -> OK -> the other widgets fade, the widget grows to fill its section -> ◀ ▶ set H / M / S (OK = next field,
 *   BACK = previous) -> runs. Time comes from a fixed end time (never counts ticks), the comet is one CSS rotation the GPU runs
 *   on its own, and the digits + 60 tick marks change once a second with opacity only: no per-frame JavaScript.
 * Update: shows the update check; OK = 3-2-1 charge (BACK cancels) -> the wall's own update + shutdown animation. */
(function () {
const W = () => window.BearWall, $ = (el, s) => el.querySelector(s);
const PAGES = ['timer', 'home', 'update'];
const pad = n => String(n).padStart(2, '0');
const fmt = ms => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60); };
const snd = id => W().sound(id), say = (id, o) => W().say(id, o);

const st = {
  page: 'home', lastKey: Date.now(), reps: 0,
  // timer: idle | set | run | pause | done
  t: { mode: 'idle', field: 0, hms: [0, 5, 0], endAt: 0, left: 0, total: 0, tick: null },
  u: { mode: 'show', armT: null, checking: false }
};
try { const saved = JSON.parse(localStorage.getItem('bearwall.timer') || 'null'); if (Array.isArray(saved) && saved.length === 3) st.t.hms = saved; } catch (e) {}

/* ---------- the Main Dynamic's element ---------- */
function host() {
  const id = W().mainDynamic && W().mainDynamic();
  const el = id && document.querySelector(`.widget[data-wid="${id}"] .dy`);
  if (!el) return null;
  let pg = $(el, '.pg');
  if (!pg) {   // a stage rebuild makes a new widget: put the page layer back
    pg = document.createElement('div'); pg.className = 'pg';
    pg.innerHTML = '<div class="pg-body"></div><div class="pg-dots">' + PAGES.map(p => `<i data-p="${p}"></i>`).join('') + '</div>';
    el.appendChild(pg); pg._page = null;
  }
  return { id, dy: el, pg, box: el.closest('.widget') };
}

/* ---------- views ---------- */
const TICKS = Array.from({ length: 60 }, (_, i) => `<i style="transform: rotate(${i * 6}deg) translateY(calc(var(--u) * -40))"></i>`).join('');
function timerView() {
  const t = st.t;
  if (t.mode === 'idle') return `<div class="tm tm-idle"><div class="tm-ring"><div class="tm-ticks">${TICKS}</div></div>
    <div class="tm-mid"><b>Start timer?</b><small>OK</small></div></div>`;
  if (t.mode === 'set') return `<div class="tm tm-set"><div class="tm-ring"><div class="tm-ticks">${TICKS}</div></div><div class="tm-mid">
    <div class="tm-hms">${t.hms.map((v, i) => `<span class="${i === t.field ? 'on' : ''}">${pad(v)}<em>${'hms'[i]}</em></span>`).join('<span class="tm-c">:</span>')}</div>
    <small>◀ ▶ set · OK ${t.field < 2 ? 'next' : 'start'}</small></div></div>`;
  return `<div class="tm tm-run${t.mode === 'pause' ? ' paused' : ''}${t.mode === 'done' ? ' done' : ''}"><div class="tm-ring"><div class="tm-ticks">${TICKS}</div>
    <div class="tm-cmt"><i></i></div></div><div class="tm-mid"><b class="tm-left"></b><small class="tm-st"></small></div></div>`;
}
const ARROW = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 12v30M20 32l12 12 12-12M16 52h32"/></svg>';
const CHECK = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 33l9 9 19-20"/></svg>';
function updateView() {
  const u = W().update || {}, a = st.u, avail = u.state === 'available';
  const dots = Array.from({ length: 24 }, (_, i) => `<i style="transform: rotate(${i * 15}deg) translateY(calc(var(--u) * -30)); animation-delay: ${(i * 2 / 24).toFixed(3)}s"></i>`).join('');
  const title = a.mode === 'arm' ? 'Updating in…' : a.checking || u.state === 'checking' ? 'Checking…' : avail ? 'Update available' : u.state === 'current' ? 'Up to date' : u.state === 'busy' ? 'GitHub is busy' : 'Can’t check';
  const detail = a.mode === 'arm' ? 'BACK to cancel' : avail ? (u.msg || '') : u.state === 'current' ? (u.sha || '').slice(0, 7) : u.state === 'busy' ? `try again in ${u.retry} min` : '';
  const hint = a.mode === 'arm' ? '' : avail ? 'OK to update' : 'OK to check again';
  return `<div class="up up-${a.mode}${avail ? ' avail' : ''}${a.checking ? ' checking' : ''}"><div class="up-ring">${a.mode === 'arm' ? `<div class="up-dots">${dots}</div><b class="up-n">3</b>` : ''}
    <div class="up-i">${avail || a.mode === 'arm' ? ARROW : CHECK}</div></div>
    <div class="up-tx"><b class="fit">${title}</b><span class="fit">${detail.replace(/[<&]/g, '')}</span><small>${hint}</small></div></div>`;
}

/* ---------- render ---------- */
function render(anim) {
  const h = host();
  if (!h) return;
  const { pg, dy, id } = h, page = st.page, body = $(pg, '.pg-body');
  dy.classList.toggle('paged', page !== 'home');
  pg.querySelectorAll('.pg-dots i').forEach(d => d.classList.toggle('on', d.dataset.p === page));
  pg.classList.toggle('dots-on', page !== 'home' || Date.now() - st.lastKey < 2500);
  const focus = page === 'timer' && st.t.mode !== 'idle';
  W().focus(focus, id);
  h.box.classList.toggle('bw-grow', focus);
  if (focus) grow(h.box); else h.box.style.removeProperty('--grow');
  const html = page === 'timer' ? timerView() : page === 'update' ? updateView() : '';
  if (body._html !== html) {
    body.innerHTML = html; body._html = html;
    if (anim) { body.classList.remove('in-l', 'in-r'); void body.offsetWidth; body.classList.add(anim); }
    if (page === 'timer' && (st.t.mode === 'run' || st.t.mode === 'pause' || st.t.mode === 'done')) startComet(body);
  }
  if (page === 'timer') runTick(body);
  if (page === 'update' && st.u.mode === 'arm') $(body, '.up-n') && ($(body, '.up-n').textContent = Math.max(1, 3 - Math.floor((Date.now() - st.u.armAt) / 1000)));
}
// the widget grows to fill its section (transform only), centered
function grow(box) {
  const sec = box.parentElement, k = Math.min(sec.offsetWidth / box.offsetWidth, sec.offsetHeight / box.offsetHeight) * .92;
  const tx = sec.offsetWidth / 2 - (box.offsetLeft + box.offsetWidth / 2), ty = sec.offsetHeight / 2 - (box.offsetTop + box.offsetHeight / 2);
  box.style.setProperty('--grow', `translate(${tx}px, ${ty}px) scale(${Math.max(1, k).toFixed(3)})`);
}

/* ---------- the timer clock (no per-frame JS) ---------- */
const leftNow = () => st.t.mode === 'run' ? Math.max(0, st.t.endAt - Date.now()) : st.t.left;
function startComet(body) {   // one rotation from where we are now down to 0, over the time that's left: the GPU runs it alone
  const c = $(body, '.tm-cmt'); if (!c) return;
  const t = st.t, left = leftNow(), deg = t.total ? left / t.total * 360 : 0;
  if (c._a) c._a.cancel();
  c.style.transform = `rotate(${deg}deg)`;
  c._a = t.mode === 'run' && left > 0 ? c.animate([{ transform: `rotate(${deg}deg)` }, { transform: 'rotate(0deg)' }], { duration: left, easing: 'linear', fill: 'forwards' }) : null;
}
function runTick(body) {
  const t = st.t;
  if (!(t.mode === 'run' || t.mode === 'pause' || t.mode === 'done')) return;
  const left = leftNow(), on = t.total ? Math.ceil(left / t.total * 60) : 0;
  const lbl = $(body, '.tm-left'); if (lbl) lbl.textContent = t.mode === 'done' ? '0:00' : fmt(left);
  const s = $(body, '.tm-st'); if (s) s.textContent = t.mode === 'pause' ? 'Paused · OK to resume' : t.mode === 'done' ? 'Time’s up! · OK' : 'OK to pause';
  const ticks = body.querySelectorAll('.tm-ticks i');
  if (body._on !== on) { ticks.forEach((x, i) => x.classList.toggle('lit', i < on)); body._on = on; }
}
function schedule() {   // wake at the next whole second of the countdown, not on a fixed beat: it never drifts
  clearTimeout(st.t.tick);
  if (st.t.mode !== 'run') return;
  const left = st.t.endAt - Date.now();
  if (left <= 0) return finish();
  st.t.tick = setTimeout(() => { render(); W().card({ id: 'timer-run', source: 'time', tier: 'heads', icon: 'day', title: 'Timer ' + fmt(leftNow()), detail: 'running', key: 'run' }); schedule(); }, (left % 1000) + 15);
}
function finish() {
  const t = st.t; t.mode = 'done'; t.left = 0;
  W().uncard('timer-run');
  W().card({ id: 'timer-done', source: 'time', tier: 'urgent', icon: 'alert', title: 'Time’s up!', detail: 'Timer done', key: String(Date.now()), say: ['timer-done'] });
  snd('alert-warn'); say('timer-done', { force: true, delay: 600, anyTime: true });
  render();
}
function startTimer() {
  const t = st.t, ms = (t.hms[0] * 3600 + t.hms[1] * 60 + t.hms[2]) * 1000;
  if (!ms) return false;
  try { localStorage.setItem('bearwall.timer', JSON.stringify(t.hms)); } catch (e) {}
  Object.assign(t, { mode: 'run', total: ms, endAt: Date.now() + ms, left: ms });
  snd('wake'); schedule(); return true;
}
function stopTimer() { const t = st.t; clearTimeout(t.tick); t.mode = 'idle'; W().uncard('timer-run'); W().uncard('timer-done'); }

/* ---------- keys ---------- */
function go(page, dir) {
  if (page === st.page) return;
  st.page = page; snd('volume-tick');
  if (page !== 'update') { clearTimeout(st.u.armT); st.u.mode = 'show'; }
  if (page === 'timer' && st.t.mode === 'set') st.t.mode = 'idle';
  render(dir > 0 ? 'in-r' : 'in-l');
}
function timerKey(k, repeat) {
  const t = st.t;
  if (t.mode === 'idle') {
    if (k === 'ok') { t.mode = 'set'; t.field = 0; snd('light-on'); render('in-r'); return true; }
    return false;
  }
  if (t.mode === 'set') {
    const max = [23, 59, 59][t.field];
    if (k === 'left' || k === 'right' || k === 'up' || k === 'down') {
      st.reps = repeat ? st.reps + 1 : 0;
      const step = (k === 'right' || k === 'up' ? 1 : -1) * (t.field && st.reps > 12 ? 5 : 1);   // hold = faster
      t.hms[t.field] = ((t.hms[t.field] + step) % (max + 1) + max + 1) % (max + 1);
      if (!repeat) snd('light-tick');
      render(); return true;
    }
    if (k === 'ok') { if (t.field < 2) { t.field++; snd('light-tick'); render(); } else if (startTimer()) render('in-r'); return true; }
    if (k === 'back') { if (t.field > 0) t.field--; else t.mode = 'idle'; render(); return true; }
    return true;
  }
  if (k === 'ok') {
    if (t.mode === 'run') { t.left = leftNow(); t.mode = 'pause'; clearTimeout(t.tick); }
    else if (t.mode === 'pause') { t.endAt = Date.now() + t.left; t.mode = 'run'; schedule(); }
    else if (t.mode === 'done') stopTimer();
    snd('light-tick'); const b = host() && $(host().pg, '.pg-body'); if (b) b._html = null; render(); return true;
  }
  if (k === 'back' && t.mode === 'done') { stopTimer(); render(); return true; }
  return false;   // left/right/back while running: leave the page, the timer keeps going
}
function updateKey(k) {
  const u = W().update || {}, a = st.u;
  if (a.mode === 'arm') {
    if (k === 'back') { clearTimeout(a.armT); a.mode = 'show'; snd('light-off'); render(); return true; }
    return true;   // hands off while it counts down
  }
  if (k !== 'ok') return false;
  if (u.state === 'available') {
    a.mode = 'arm'; a.armAt = Date.now(); snd('light-on');
    const tick = () => { if (a.mode !== 'arm') return; if (Date.now() - a.armAt >= 3000) { a.mode = 'go'; say('update-start', { force: true }); W().startUpdate().then(ok => { if (!ok) { a.mode = 'show'; render(); } }); render(); return; } render(); a.armT = setTimeout(tick, 1000 - (Date.now() - a.armAt) % 1000 + 10); };
    tick(); return true;
  }
  a.checking = true; render(); snd('light-tick');
  Promise.resolve(W().checkUpdate()).catch(() => {}).then(() => { a.checking = false; render(); });
  return true;
}
// -> true when a page used the key (wall.js falls back to the debrief for OK)
function key(k, repeat) {
  if (!host()) return false;
  st.lastKey = Date.now();
  const i = PAGES.indexOf(st.page);
  if (st.t.mode === 'done' && (k === 'ok' || k === 'back') && !repeat) { stopTimer(); snd('light-off'); render(); return true; }   // "Time's up!" goes away from any page
  if (st.page === 'timer' && timerKey(k, repeat)) return true;
  if (st.page === 'update' && updateKey(k)) return true;
  if (k === 'back') { if (st.page !== 'home') go('home', st.page === 'timer' ? 1 : -1); return true; }
  if (repeat) return true;
  if (k === 'left' && i > 0) { go(PAGES[i - 1], -1); return true; }
  if (k === 'right' && i < PAGES.length - 1) { go(PAGES[i + 1], 1); return true; }
  if (k === 'left' || k === 'right' || k === 'up' || k === 'down') { render(); return true; }
  return false;   // OK on Home: the debrief
}
// idle 60 s -> Home; also keeps the page layer alive across stage rebuilds and the update view fresh
setInterval(() => {
  if (st.page !== 'home' && Date.now() - st.lastKey > 60000 && !(st.page === 'update' && st.u.mode !== 'show')) {
    if (st.page === 'timer' && st.t.mode === 'set') st.t.mode = 'idle';
    go('home', -1);
  } else render();
}, 1000);

const CSS = `
  .w-dynamic .dy { transition: none; }
  .w-dynamic .dy.paged .dy-stage, .w-dynamic .dy.paged .dy-strip { opacity: 0; }
  .w-dynamic .pg { position: absolute; inset: 0; pointer-events: none; }
  .w-dynamic .pg-body { position: absolute; inset: 0 0 calc(var(--u) * 7) 0; display: flex; align-items: center; justify-content: center; }
  .m-full .w-dynamic .pg-body.in-r, .m-lite .w-dynamic .pg-body.in-r { animation: pgInR .35s cubic-bezier(.2, .8, .3, 1) both; }
  .m-full .w-dynamic .pg-body.in-l, .m-lite .w-dynamic .pg-body.in-l { animation: pgInL .35s cubic-bezier(.2, .8, .3, 1) both; }
  @keyframes pgInR { from { opacity: 0; transform: translateX(14%); } to { opacity: 1; transform: none; } }
  @keyframes pgInL { from { opacity: 0; transform: translateX(-14%); } to { opacity: 1; transform: none; } }
  .w-dynamic .pg-dots { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; gap: calc(var(--u) * 3); opacity: 0; transition: opacity .4s; }
  .w-dynamic .pg.dots-on .pg-dots { opacity: 1; }
  .w-dynamic .pg-dots i { width: calc(var(--u) * 3); height: calc(var(--u) * 3); border-radius: 50%; background: var(--w-dim); opacity: .5; transition: transform .3s, opacity .3s; }
  .w-dynamic .pg-dots i.on { background: var(--ring); opacity: 1; transform: scale(1.5); }
  /* timer */
  .w-dynamic .tm { position: relative; width: calc(var(--u) * 90); height: calc(var(--u) * 90); display: flex; align-items: center; justify-content: center; }
  .w-dynamic .tm-ring, .w-dynamic .tm-ticks, .w-dynamic .tm-cmt { position: absolute; inset: 0; }
  .w-dynamic .tm-ticks i { position: absolute; left: 50%; top: 50%; width: 2px; height: calc(var(--u) * 5); margin: calc(var(--u) * -2.5) 0 0 -1px; border-radius: 2px; background: var(--ring); opacity: .14; transition: opacity .5s; }
  .w-dynamic .tm-ticks i.lit { opacity: .95; }
  .w-dynamic .tm-idle .tm-ticks i, .w-dynamic .tm-set .tm-ticks i { opacity: .45; }
  .m-full .w-dynamic .tm-idle .tm-ticks, .m-lite .w-dynamic .tm-idle .tm-ticks { animation: tmBreath 4s ease-in-out infinite; }
  @keyframes tmBreath { 50% { opacity: .45; transform: scale(.97); } }
  .m-full .w-dynamic .tm-set .tm-ring, .m-lite .w-dynamic .tm-set .tm-ring { animation: tmDraw .7s ease-out both; }
  @keyframes tmDraw { from { opacity: 0; transform: rotate(-90deg) scale(.6); } to { opacity: 1; transform: none; } }
    .w-dynamic .tm-cmt i { position: absolute; left: 50%; top: 50%; width: calc(var(--u) * 4); height: calc(var(--u) * 4); margin: calc(var(--u) * -2); border-radius: 50%; background: #fff;
    transform: translateY(calc(var(--u) * -40)); box-shadow: 0 0 calc(var(--u) * 3) var(--u) var(--ring); }
  .w-dynamic .tm-mid { position: relative; text-align: center; color: var(--w-text); }
  .w-dynamic .tm-mid b { display: block; font-weight: 800; font-size: calc(var(--u) * 10); line-height: 1.1; text-shadow: 0 0 calc(var(--glow) * var(--u) * 2) var(--ring); }
  .w-dynamic .tm-left { font-size: calc(var(--u) * 17) !important; font-variant-numeric: tabular-nums; }
  .w-dynamic .tm-mid small { display: block; margin-top: calc(var(--u) * 2); color: var(--w-dim); font-size: calc(var(--u) * 5); }
  .w-dynamic .tm-hms { display: flex; align-items: baseline; justify-content: center; font-weight: 800; font-size: calc(var(--u) * 12); font-variant-numeric: tabular-nums; }
  .w-dynamic .tm-hms span { position: relative; opacity: .45; transition: opacity .2s, transform .2s; }
  .w-dynamic .tm-hms span.on { opacity: 1; color: var(--ring); transform: scale(1.15); text-shadow: 0 0 calc(var(--u) * 2) var(--ring); }
  .w-dynamic .tm-hms em { position: absolute; left: 0; right: 0; top: 100%; font-style: normal; font-size: calc(var(--u) * 4); color: var(--w-dim); }
  .w-dynamic .tm-c { opacity: .45; padding: 0 var(--u); }
  .w-dynamic .tm-set small { margin-top: calc(var(--u) * 8); }   /* below the h / m / s labels */
  .m-full .w-dynamic .tm.paused .tm-left, .m-lite .w-dynamic .tm.paused .tm-left { animation: tmBlink 1.2s steps(1) infinite; }
  .m-full .w-dynamic .tm.done .tm-ring, .m-lite .w-dynamic .tm.done .tm-ring { animation: tmFlash .5s steps(1) infinite; }
  @keyframes tmBlink { 50% { opacity: .25; } }
  @keyframes tmFlash { 50% { opacity: .2; } }
  .w-dynamic .tm.done .tm-ticks i { opacity: .95; background: #ff7ac6; }
  /* update */
  .w-dynamic .up { display: flex; align-items: center; gap: calc(var(--u) * 6); width: 100%; height: 100%; padding: 0 calc(var(--u) * 4); box-sizing: border-box; }
  .w-dynamic .up-ring { position: relative; flex: none; width: calc(var(--u) * 66); height: calc(var(--u) * 66); border-radius: 50%; box-shadow: inset 0 0 0 2px var(--track); }
  .w-dynamic .up-i { position: absolute; inset: 22%; }
  .w-dynamic .up-i svg { width: 100%; height: 100%; fill: none; stroke: var(--ring); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 calc(var(--glow) * 4px) var(--ring)); }
  .m-full .w-dynamic .up.avail .up-i, .m-lite .w-dynamic .up.avail .up-i { animation: upBob 1.6s ease-in-out infinite; }
  @keyframes upBob { 50% { transform: translateY(8%); } }
  .m-full .w-dynamic .up.checking .up-ring, .m-lite .w-dynamic .up.checking .up-ring { animation: upSpin 1s linear infinite; }
  @keyframes upSpin { to { transform: rotate(360deg); } }
  .w-dynamic .up-dots i { position: absolute; left: 50%; top: 50%; width: calc(var(--u) * 4); height: calc(var(--u) * 4); margin: calc(var(--u) * -2); border-radius: 50%; background: var(--ring); opacity: .12;
    animation: upCharge 3s linear both; box-shadow: 0 0 calc(var(--u) * 2) var(--ring); }
  @keyframes upCharge { 0% { opacity: .12; } 1%, 100% { opacity: 1; } }
  .w-dynamic .up-n { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: calc(var(--u) * 24); font-weight: 800; color: var(--w-text); }
  .w-dynamic .up-arm .up-i { opacity: 0; }
  .m-full .w-dynamic .up-go .up-i, .m-lite .w-dynamic .up-go .up-i { animation: upDrop .8s cubic-bezier(.5, 0, .7, .4) both; }
  @keyframes upDrop { to { transform: translateY(70%) scale(.4); opacity: 0; } }
  .w-dynamic .up-tx { flex: 1 1 0; min-width: 0; color: var(--w-text); }
  .w-dynamic .up-tx b, .w-dynamic .up-tx span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .w-dynamic .up-tx b { display: block; font-weight: 800; font-size: calc(var(--u) * 12 * var(--fit, 1)); }
  .w-dynamic .up-tx span { display: block; color: var(--w-dim); font-size: calc(var(--u) * 7 * var(--fit, 1)); margin-top: calc(var(--u) * 2); }
  .w-dynamic .up-tx small { display: block; color: var(--ring); font-size: calc(var(--u) * 6); margin-top: calc(var(--u) * 4); }
  /* focus: everything else fades; the widget grows into its section */
  .stage.bw-focus .widget:not(.bw-keep) { opacity: 0; transition: opacity .6s; }   /* only while the Timer opens: never at startup (that flashed the widgets) */
  .widget.bw-grow { transform: var(--grow) !important; transition: transform .7s cubic-bezier(.2, .8, .3, 1); z-index: 5; }
  .widget.bw-keep:not(.bw-grow) { transition: transform .5s ease-in; }`;
const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

window.BearWallPages = { key, get page() { return st.page; }, get state() { return st; }, render };
})();
