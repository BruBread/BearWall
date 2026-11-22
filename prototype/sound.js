/* BearWall sound: the engine (BearWallSound) and the control page's Sound card.
 *  - One AudioContext, made on the first sound and suspended 3 s after the last one (an open context keeps the
 *    projector's audio out of standby). Chain: type buses (ambience, ui, alert) -> master -> limiter -> speaker.
 *  - Levels are steps 0-13 like Android's media volume (the projector's own volume stays at 13, the ceiling).
 *  - Sounds come from BearWallSounds (sounds.js): synth variants, plus ElevenLabs takes saved on the projector
 *    (<id>.g1.mp3 ...). A take that isn't there falls back to the synth.
 *  - Settings live in kv "sound" on the projector (localStorage in the plain prototype).
 * The wall page plays; the control page shows the card and asks the wall to play (POST /api/sound/play). */
(function () {
const ON = BearWall.onProjector, WALL = /^\/wall/.test(location.pathname);
const SILENT = ON && !WALL;   // the projector's control page (your laptop) never plays; it asks the wall to
const TYPES = [['ambience', 'Ambience'], ['ui', 'UI sounds'], ['alert', 'Alerts']];
const TEST = { ambience: 'amb-rain', ui: 'light-on', alert: 'alert-info' };   // what the Test row plays
const DB_PER_STEP = 3;   // calibration knob: each step below 13 is this many dB quieter
const gainOf = step => step <= 0 ? 0 : Math.pow(10, -(13 - step) * DB_PER_STEP / 20);
const mins = t => { const [h, m] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
// is `now` inside from-to? The window can cross midnight (23:30-07:00)
const inWindow = (now, from, to) => {
  const n = now.getHours() * 60 + now.getMinutes(), a = mins(from), b = mins(to);
  return a <= b ? n >= a && n < b : n >= a || n < b;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = BearWall.util.esc;
const $ = s => document.querySelector(s);
const reg = () => window.BearWallSounds || {};
const CLIENT = Math.random().toString(36).slice(2, 10);

/* ---------- settings ---------- */
const DEFAULTS = { on: true, master: 13, bell: true,
  types: { ambience: { on: true, level: 9 }, ui: { on: true, level: 11 }, alert: { on: true, level: 13 } },
  quiet: { on: true, from: '23:30', to: '07:00', ambience: 9, other: 6 },
  pick: {} };
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const k0 = o => Object.keys(o).length;
function merge(d, s) {   // saved values over the defaults, object by object
  const out = {};
  for (const k in d) out[k] = isObj(d[k]) ? merge(d[k], isObj(s && s[k]) ? s[k] : {}) : s && s[k] != null ? s[k] : d[k];
  if (k0(d) === 0 && isObj(s)) Object.assign(out, s);   // pick: free keys
  return out;
}
let S = merge(DEFAULTS, null);
function loadSettings() {
  if (!ON) { try { S = merge(DEFAULTS, JSON.parse(localStorage.getItem('bearwall.sound'))); } catch (e) {} return Promise.resolve(); }
  return fetch('/api/kv/sound', { cache: 'no-store' }).then(r => r.json()).then(v => { S = merge(DEFAULTS, v); }).catch(() => {});
}
let saveT = null;
function saveLater(ms) {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    if (!ON) { try { localStorage.setItem('bearwall.sound', JSON.stringify(S)); } catch (e) {} return; }
    fetch('/api/kv/sound', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Client': CLIENT }, body: JSON.stringify(S) }).catch(() => {});
  }, ms);
}

// saved ElevenLabs takes on the projector
let files = new Set(), hasKey = false;
function loadFiles() {
  if (!ON) return Promise.resolve();
  return fetch('/api/sound', { cache: 'no-store' }).then(r => r.json()).then(j => { files = new Set(j.files || []); hasKey = !!j.hasKey; renderCard(); }).catch(() => {});
}

/* ---------- levels ---------- */
let muted = false, asleep = false;
const quietNow = (now = new Date()) => S.quiet.on && inWindow(now, S.quiet.from, S.quiet.to);
function levelOf(t) {
  const ty = S.types[t];
  if (!S.on || !ty.on) return 0;
  if (!quietNow()) return ty.level;
  return t === 'ambience' ? S.quiet.ambience : Math.min(ty.level, S.quiet.other);
}

/* ---------- audio graph ---------- */
let ctx = null, master = null, idleT = null, voices = 0;
const buses = {};
function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const lim = ctx.createDynamicsCompressor();   // a limiter: nothing past -3 dBFS whatever stacks up
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.1;
    master = ctx.createGain();
    master.connect(lim); lim.connect(ctx.destination);
    TYPES.forEach(([t]) => { buses[t] = ctx.createGain(); buses[t].connect(master); });
    applyLevels();
  }
  clearTimeout(idleT);
  if (ctx.state !== 'running') { ctx.resume(); applyLevels(); }   // quiet hours may have started while it slept
  return ctx;
}
function applyLevels() {
  if (!ctx) return;
  const now = ctx.currentTime;
  TYPES.forEach(([t]) => buses[t].gain.setTargetAtTime(gainOf(levelOf(t)), now, 0.05));
  master.gain.setTargetAtTime(muted ? 0 : gainOf(S.master), now, 0.05);
}
function idleCheck() {
  clearTimeout(idleT);
  if (ctx && !voices && !k0(amb)) idleT = setTimeout(() => ctx.suspend(), 3000);
}
// keeps the context awake for a sound's length, then tidies up
function hold(sec, done) {
  voices++;
  setTimeout(() => { voices--; if (done) done(); idleCheck(); }, sec * 1000);
}

// ElevenLabs files: decoded once; ambience ones are dropped 60 s after their layer stops
const buffers = {};
function buffer(name) {
  if (!buffers[name]) buffers[name] = fetch('/api/sounds/' + name).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(b => ctx.decodeAudioData(b)).catch(e => { delete buffers[name]; throw e; });
  return buffers[name];
}
// which source a sound uses: a saved take ({file}) or a synth variant ({fn})
function sourceOf(id, e, v) {
  v = v || S.pick[id] || 'a';
  if (/^g[1-3]$/.test(v)) {
    const name = id + '.' + v + '.mp3';
    if (files.has(name)) return { file: name };
    v = null;
  }
  const keys = Object.keys(e.variants || {});
  const key = v && e.variants[v] ? v : S.pick[id] && e.variants[S.pick[id]] ? S.pick[id] : keys.includes('a') ? 'a' : keys[0];
  return key ? { fn: e.variants[key].fn } : null;
}

/* ---------- play ---------- */
const PREVIEW = 8;   // an ambience played as a one-shot (sound board, Test) runs this long
function play(id, opts) {
  opts = opts || {};
  const e = reg()[id];
  // opts.full = a sound board / Test press: plays even with its type switched off, at full level (only Volume applies)
  if (SILENT || !e || !S.types[e.type] || (asleep && !e.critical) || (!opts.full && (!S.on || !S.types[e.type].on))) return;
  if (id === 'hour-bell' && !S.bell) return;
  const src = sourceOf(id, e, opts.variant);
  if (!src) return;
  const c = audio(), out = c.createGain(), loop = e.type === 'ambience';
  out.gain.value = opts.gain == null ? 1 : opts.gain;
  out.connect(opts.full ? master : buses[e.type]);
  const len = loop ? PREVIEW : (e.len || 2);
  if (src.file) {
    hold(len + 0.5);   // stays awake while the file loads
    buffer(src.file).then(b => {
      const s = c.createBufferSource();
      s.buffer = b; s.loop = loop; s.connect(out); s.start();
      if (loop) s.stop(c.currentTime + PREVIEW);
      hold((loop ? PREVIEW : b.duration) + 0.3, () => out.disconnect());
    }).catch(() => { const f = sourceOf(id, e, 'a'); if (f && f.fn) synth(c, out, f.fn, opts, loop, len); });
  } else synth(c, out, src.fn, opts, loop, len);
}
function synth(c, out, fn, opts, loop, len) {
  const t0 = c.currentTime + 0.03, h = fn(c, out, t0, opts);
  if (loop && h && h.stop) h.stop(t0 + PREVIEW);
  hold(len + 0.8, () => out.disconnect());
}

/* ---------- ambience: layers that crossfade ---------- */
const FADE = 2;
const amb = {};   // id -> { g, stop(), dying }
function ambience(layers) {
  const want = {};
  if (SILENT) return;
  if (!asleep) (layers || []).forEach(l => { if (reg()[l.id] && reg()[l.id].type === 'ambience') want[l.id] = l.gain == null ? 1 : l.gain; });
  if (!ctx && !k0(want)) return;
  const c = audio(), now = c.currentTime;
  const ramp = (g, to) => { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(to, now + FADE); };
  for (const id in amb) {
    const a = amb[id];
    if (id in want) { if (a.dying) { clearTimeout(a.dying); a.dying = null; } continue; }
    if (a.dying) continue;
    ramp(a.g, 0);
    a.dying = setTimeout(() => { a.stop(); delete amb[id]; idleCheck(); }, FADE * 1000 + 100);
  }
  for (const id in want) {
    if (!amb[id]) amb[id] = startLayer(c, id, reg()[id]);
    ramp(amb[id].g, want[id]);
  }
  idleCheck();
}
function startLayer(c, id, e) {
  const g = c.createGain(), src = sourceOf(id, e);
  g.gain.value = 0;
  g.connect(buses.ambience);
  const layer = { g, dying: null, file: src && src.file, stop: () => g.disconnect() };
  if (!src) return layer;
  let dead = false, h = null, s = null;
  const runSynth = fn => { h = fn(c, g, c.currentTime + 0.03, {}); };
  layer.stop = () => {
    dead = true;
    if (s) s.stop();
    if (h && h.stop) h.stop(c.currentTime);
    setTimeout(() => g.disconnect(), 800);
    if (src.file) setTimeout(() => { if (!Object.keys(amb).some(k => amb[k].file === src.file)) delete buffers[src.file]; }, 60000);
  };
  if (src.file) buffer(src.file).then(b => {
    if (dead) return;
    s = c.createBufferSource(); s.buffer = b; s.loop = true; s.connect(g); s.start();
  }).catch(() => { const f = sourceOf(id, e, 'a'); if (!dead && f && f.fn) runSynth(f.fn); });
  else runSynth(src.fn);
  return layer;
}

/* ---------- volume keys + the bar on the wall (section 1) ---------- */
let bar = null, barT = null;
function showBar() {
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'svol';
    bar.innerHTML = '<b>VOLUME</b><span class="svn"></span><div class="svbar"><i></i></div>';
  }
  BearWall.hud(bar);
  bar.querySelector('.svn').textContent = muted ? 'MUTED' : S.master + ' / 13';
  bar.querySelector('.svbar i').style.transform = `scaleX(${muted ? 0 : S.master / 13})`;
  bar.classList.add('on');
  clearTimeout(barT);
  barT = setTimeout(() => bar.classList.remove('on'), 2000);
}
function volKey(k) {
  if (k === 'mute') muted = !muted;
  else { muted = false; S.master = clamp(S.master + (k === 'up' ? 1 : -1), 0, 13); saveLater(1000); }
  applyLevels();
  showBar();
  if (!muted) play('volume-tick');
  renderCard();
}

/* ---------- messages from the app (wall.js forwards them) ---------- */
function event(d) {
  if (d.indexOf('sound:play:') === 0) {
    if (!WALL) return;   // only the wall page plays
    const p = d.split(':');
    play(p[2], { variant: p[3] || undefined, full: true });
  } else if (d === 'sound:files') loadFiles();
  else if (d.indexOf('kv:sound:') === 0 && d.slice(9) !== CLIENT) loadSettings().then(() => { applyLevels(); renderCard(); });
}

/* ---------- the Sound card (control page) ---------- */
const api = (method, path, body) => fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(r => r.json().catch(() => ({})).then(j => { if (!r.ok && !j.error) j.error = 'HTTP ' + r.status; return j; }));
// plays on the projector speaker; in the plain prototype, here
const playThere = (id, variant) => ON ? api('POST', '/api/sound/play', { id, variant }) : play(id, { variant, full: true });
const getP = p => p.split('.').reduce((o, k) => o[k], S);
const setP = (p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; };
const range = (k, label) => `<div class="lbl"><span>${label}</span><span data-v="${k}"></span></div><input type="range" min="0" max="13" step="1" data-k="${k}" aria-label="${label}">`;
let card = null, busy = false;
function buildCard() {
  card = $('#soundCard');
  if (!card || WALL) { card = null; return; }
  card.innerHTML = `<h2>Sound</h2>
    <div class="sub">Plays on the projector's speaker. 13 is the loudest it goes.</div>
    <label class="row">Sound<input type="checkbox" class="switch" data-k="on"></label>
    ${range('master', 'Volume')}
    ${TYPES.map(([t, name]) => `<label class="row">${name}<input type="checkbox" class="switch" data-k="types.${t}.on"></label>${range(`types.${t}.level`, name + ' level')}`).join('')}
    <label class="row">Hourly bell<input type="checkbox" class="switch" data-k="bell"></label>
    <label class="row">Quiet hours<input type="checkbox" class="switch" data-k="quiet.on"></label>
    <div class="ltime"><input type="time" class="field" data-k="quiet.from" aria-label="Quiet from"><span>to</span><input type="time" class="field" data-k="quiet.to" aria-label="Quiet until"></div>
    ${range('quiet.ambience', 'Quiet ambience')}${range('quiet.other', 'Quiet UI + alerts')}
    <div class="lbl"><span>Test</span></div>
    <div class="actions">${TYPES.map(([t, name]) => `<button class="btn quiet" data-test="${t}">${name.split(' ')[0]}</button>`).join('')}</div>
    <div class="lbl"><span>ElevenLabs</span><span id="sndKeyState"></span></div>
    <input class="field" id="sndKey" type="password" autocomplete="off" spellcheck="false" placeholder="API key, stays on the projector">
    <div class="actions"><button class="btn" id="sndKeySave">Save key</button><button class="btn quiet" id="sndCredBtn">Credits</button></div>
    <div class="note" id="sndCredits"></div>
    <div class="lbl"><span>Sound board</span></div>
    <div class="sub">▶ plays a candidate on the projector. Pick the winner. G1-G3 are ElevenLabs takes: generating one uses credits.</div>
    <div class="note" id="sndMsg"></div>
    <div id="sndBoard"></div>`;
  card.addEventListener('input', e => {
    const k = e.target.dataset.k;
    if (!k) return;
    setP(k, e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value);
    if (k === 'master') muted = false;
    applyLevels(); renderValues(); saveLater(300);
  });
  card.addEventListener('change', e => {
    if (e.target.dataset.pick == null) return;
    S.pick[e.target.dataset.pick] = e.target.value; saveLater(0);
  });
  card.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.test) { const id = reg()[TEST[b.dataset.test]] ? TEST[b.dataset.test] : Object.keys(reg()).find(i => reg()[i].type === b.dataset.test); if (id) playThere(id); }
    else if (b.dataset.play) playThere(b.dataset.id, b.dataset.play);
    else if (b.dataset.gen) generate(b.dataset.id, b.dataset.gen);
    else if (b.dataset.del) { if (b.dataset.sure) api('DELETE', '/api/sound/file/' + b.dataset.del).then(loadFiles); else { b.dataset.sure = '1'; b.textContent = 'sure?'; } }
    else if (b.id === 'sndKeySave') saveKey();
    else if (b.id === 'sndCredBtn') credits();
  });
  renderCard();
  if (ON) credits();
}
function renderValues() {
  if (!card) return;
  card.querySelectorAll('[data-k]').forEach(i => { const v = getP(i.dataset.k); if (i.type === 'checkbox') i.checked = !!v; else if (document.activeElement !== i) i.value = v; });
  card.querySelectorAll('[data-v]').forEach(s => { s.textContent = getP(s.dataset.v); });
}
function renderCard() {
  if (!card) return;
  renderValues();
  $('#sndKeyState').textContent = !ON ? 'projector only' : hasKey ? 'Key saved' : 'No key';
  card.querySelectorAll('#sndKey, #sndKeySave, #sndCredBtn').forEach(x => { x.disabled = !ON; });
  const r = reg(), ids = Object.keys(r);
  $('#sndBoard').innerHTML = !ids.length ? '<div class="note">No sounds yet</div>' : TYPES.map(([t, name]) => {
    const mine = ids.filter(id => r[id].type === t);
    return !mine.length ? '' : `<div class="lbl"><span>${name}</span></div>` + mine.map(id => {
      const e = r[id], pick = S.pick[id] || 'a';
      const chip = (v, label, extra) => `<span class="sbc"><button data-id="${id}" data-play="${v}" title="Play ${esc(label)}">▶ ${v.toUpperCase()}</button>`
        + `<input type="radio" name="pick-${id}" value="${v}" data-pick="${id}" aria-label="Pick ${v.toUpperCase()}"${pick === v ? ' checked' : ''}>${extra || ''}</span>`;
      const synth = Object.keys(e.variants || {}).map(v => chip(v, e.variants[v].name || v));
      const takes = !e.eleven ? [] : ['g1', 'g2', 'g3'].map(g => files.has(`${id}.${g}.mp3`)
        ? chip(g, 'ElevenLabs take', `<button class="sbx" data-del="${id}.${g}.mp3" title="Delete this take">✕</button>`)
        : `<span class="sbc"><button data-id="${id}" data-gen="${g}" ${!ON || !hasKey || busy ? 'disabled' : ''} title="Generate with ElevenLabs (uses credits)">+ ${g.toUpperCase()}</button></span>`);
      return `<div class="sbrow"><div class="sbname">${esc(e.label || id)}</div><div class="sbchips">${synth.concat(takes).join('')}</div></div>`;
    }).join('');
  }).join('');
}
function saveKey() {
  const i = $('#sndKey'), key = i.value.trim();
  i.value = '';   // never kept or shown again
  api('PUT', '/api/sound/key', { key }).then(j => { hasKey = !!j.hasKey; renderCard(); if (hasKey) credits(); else $('#sndCredits').textContent = ''; });
}
function credits() {
  if (!ON || !hasKey) { $('#sndCredits').textContent = ON ? 'Save a key to see your credits.' : 'Credits show on the projector.'; return Promise.resolve(); }
  $('#sndCredits').textContent = 'Checking credits…';
  return api('GET', '/api/sound/credits').then(j => {
    $('#sndCredits').textContent = j.error ? 'Credits: ' + j.error
      : `${j.left.toLocaleString()} credits left of ${j.limit.toLocaleString()}` + (j.resets ? ` · resets ${new Date(j.resets * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : '');
  });
}
function generate(id, take) {
  const e = reg()[id];
  if (busy || !e || !e.eleven) return;
  busy = true; renderCard();
  $('#sndMsg').textContent = `Generating ${e.label || id} ${take.toUpperCase()}… (up to a minute)`;
  api('POST', '/api/sound/generate', { id, take, prompt: e.eleven.prompt, seconds: e.eleven.seconds, loop: !!e.eleven.loop }).then(j => {
    $('#sndMsg').textContent = j.ok ? `Saved ${e.label || id} ${take.toUpperCase()}. Press ▶ to hear it.` : 'Generate failed: ' + (j.error || 'unknown');
  }).catch(() => { $('#sndMsg').textContent = 'Generate failed: no answer from the projector'; })
    .then(() => { busy = false; return loadFiles(); }).then(credits);
}

/* ---------- start ---------- */
(function selfTest() {
  const at = (h, m) => new Date(2026, 0, 1, h, m);
  console.assert(gainOf(13) === 1 && gainOf(0) === 0 && Math.abs(gainOf(12) - 0.7079) < 1e-3, 'sound: level steps');
  console.assert(inWindow(at(2, 0), '23:30', '07:00') && inWindow(at(23, 30), '23:30', '07:00') && !inWindow(at(12, 0), '23:30', '07:00')
    && !inWindow(at(7, 0), '23:30', '07:00') && inWindow(at(13, 0), '12:00', '14:00'), 'sound: quiet hours window');
  const m = merge(DEFAULTS, { master: 5, types: { ui: { level: 3 } }, pick: { flip: 'b' } });
  console.assert(m.master === 5 && m.types.ui.level === 3 && m.types.ui.on === true && m.types.alert.level === 13 && m.pick.flip === 'b', 'sound: settings merge');
})();
setInterval(applyLevels, 60000);   // quiet hours start and end
loadSettings().then(() => { applyLevels(); buildCard(); loadFiles(); });

window.BearWallSound = {
  play, ambience, volKey, event,
  sleep() { asleep = true; ambience([]); },
  wake() { asleep = false; },
  get settings() { return S; },
  get files() { return files; }
};
})();
