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
const TYPES = [['ambience', 'Ambience'], ['ui', 'UI sounds'], ['alert', 'Alerts'], ['voice', 'Voice']];
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
  types: { ambience: { on: true, level: 9 }, ui: { on: true, level: 11 }, alert: { on: true, level: 13 }, voice: { on: true, level: 13 } },
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

/* ---------- the voice: the robot's clips, through the robot chain tuned by ear in Voice Lab ----------
 * Clips live on the projector (/api/voice/<id>.mp3, uploaded from the Sound card; never in the repo).
 * say('boot') picks one of boot-1, boot-2, ... at random; say(['window-open', 'wx-rain']) speaks them in a row.
 * One line at a time (urgent lines jump the queue), the same line at most once per 5 min, never during quiet hours
 * unless opts.anyTime (the alarm and goodnight, later). Ambience dips while he talks. */
const VOICE = { pitch: 1.12, tin: .44, tinMs: 4.9, ring: .29, ringHz: 45, grit: .25, lowcut: 200, presence: 3, glitch: .5, level: 1.47 };
const MOODS = {
  alert: /^(net-down|net-slow|hot|storage-full|wifi-unknown|adb-unknown|security-found|storm|typhoon|bulb-lost|update-failed|build-fail|laptop-low|phone-unknown|wx-thunder-close)$/,
  happy: /^(home-welcome|home-phone|home-long-day|pasok|update-done|weekend|friday|christmas.*|new-year|birthday|focus-done|build-ok|net-up|bulb-back|game-on|alarm-rise|sem-first-day)$/,
  sleep: /^(sleep-\d|goodnight|home-away|light-mode-off|light-mode-leave)$/,
  wake: /^(boot-\d|wake-.*|home-away-end|light-mode-on)$/
};
const moodOf = id => Object.keys(MOODS).find(m => MOODS[m].test(id)) || 'neutral';
const COOLDOWN = 5 * 60e3, rnd = (a, b) => a + Math.random() * (b - a);
let voiceFiles = new Set(), voiceAt = 0, speaking = false, queue = [];
const lastSaid = {}, clipCache = new Map();   // decoded clips, a few at a time (~0.2 MB each decoded; all 141 would be ~30 MB)
function loadVoice() {
  if (!ON) return Promise.resolve();
  voiceAt = Date.now();
  return fetch('/api/voice', { cache: 'no-store' }).then(r => r.json()).then(a => { voiceFiles = new Set(a); renderCard(); }).catch(() => {});
}
// base id -> a clip name: the exact one, or one of its numbered alternates
function pickClip(id) {
  if (voiceFiles.has(id + '.mp3')) return id + '.mp3';
  const alts = [...voiceFiles].filter(n => n.indexOf(id + '-') === 0 && /^\d+\.mp3$/.test(n.slice(id.length + 1)));
  return alts.length ? alts[Math.random() * alts.length | 0] : null;
}
function clip(name) {
  if (!clipCache.has(name)) {
    clipCache.set(name, fetch('/api/voice/' + name).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => audio().decodeAudioData(b)).catch(e => { clipCache.delete(name); throw e; }));
    if (clipCache.size > 16) clipCache.delete(clipCache.keys().next().value);
  }
  return clipCache.get(name);
}
function say(ids, opts) {
  opts = opts || {};
  ids = [].concat(ids);
  if (SILENT || !S.on || !S.types.voice.on || (asleep && !opts.critical) || (quietNow() && !opts.anyTime)) return;   // force skips only the cooldown
  if (!opts.force && ids.every(id => Date.now() - (lastSaid[id] || 0) < COOLDOWN)) return;
  ids.forEach(id => { lastSaid[id] = Date.now(); });
  if (!ids.some(pickClip) && Date.now() - voiceAt > 30000) loadVoice();   // maybe just uploaded
  if (opts.urgent) queue.unshift(ids); else if (queue.length < 3) queue.push(ids);
  if (!speaking) setTimeout(speakNext, opts.delay == null ? 350 : opts.delay);   // the event's sound effect goes first
}
async function speakNext() {
  if (speaking || !queue.length) return;
  speaking = true;
  const ids = queue.shift();
  duck(true);
  for (const id of ids) {
    const name = pickClip(id);
    if (!name) continue;
    try { const b = await clip(name); await new Promise(r => setTimeout(r, voiceLine(b, name.replace(/\.mp3$/, '')) * 1000 + 120)); } catch (e) {}
  }
  duck(false);
  speaking = false;
  if (queue.length) setTimeout(speakNext, 250);
}
function duck(on) {   // ambience dips while he talks
  if (!ctx) return;
  buses.ambience.gain.setTargetAtTime(gainOf(levelOf('ambience')) * (on ? .35 : 1), ctx.currentTime, .15);
}
let gritCurve = null;
function curveFor(g) {   // stepped curve: fewer levels = rougher digital voice
  if (gritCurve) return gritCurve;
  const n = 1024, L = 4 + (1 - g) * 40;
  gritCurve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; gritCurve[i] = x * (1 - g) + Math.round(x * L) / L * g; }
  return gritCurve;
}
let vNoise = null;
function voiceNoise(c) {
  if (vNoise) return vNoise;
  vNoise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = vNoise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return vNoise;
}
// one clip through the robot: pitch, tin can (comb), ring mod, grit, little-speaker EQ, plus random glitches by mood.
// Returns how long it plays (s).
function voiceLine(buf, id) {
  const c = audio(), P = VOICE, mood = moodOf(id), rate = P.pitch, g = P.glitch * (mood === 'alert' ? 1.8 : mood === 'neutral' ? 1 : .7);
  const t0 = c.currentTime + .05, len = buf.duration / rate, nodes = [], mk = n => (nodes.push(n), n);
  const input = mk(c.createGain()), gate = mk(c.createGain());   // gate = dropouts
  input.connect(gate);
  const can = mk(c.createGain()), dl = mk(c.createDelay(.05)), fb = mk(c.createGain()), wet = mk(c.createGain());
  dl.delayTime.value = P.tinMs / 1000; fb.gain.value = .45 + P.tin * .4; wet.gain.value = P.tin;
  gate.connect(can); gate.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(can);
  const ring = mk(c.createGain()), mod = mk(c.createGain()), rwet = mk(c.createGain()), rdry = mk(c.createGain()), osc = mk(c.createOscillator());
  mod.gain.value = 0; osc.frequency.value = P.ringHz; osc.connect(mod.gain);
  rwet.gain.value = P.ring * 1.4; rdry.gain.value = 1 - P.ring * .6;
  can.connect(mod); mod.connect(rwet); rwet.connect(ring); can.connect(rdry); rdry.connect(ring);
  const sh = mk(c.createWaveShaper()); sh.curve = curveFor(P.grit);
  const hp = mk(c.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = P.lowcut; hp.Q.value = .7;
  const pk = mk(c.createBiquadFilter()); pk.type = 'peaking'; pk.frequency.value = 2600; pk.Q.value = 1; pk.gain.value = P.presence;
  const lim = mk(c.createDynamicsCompressor()); lim.threshold.value = -6; lim.ratio.value = 12; lim.attack.value = .003; lim.release.value = .1;
  const out = mk(c.createGain()); out.gain.value = P.level;
  ring.connect(sh); sh.connect(hp); hp.connect(pk); pk.connect(lim); lim.connect(out); out.connect(buses.voice);
  const src = (off, dur, at) => { const s = mk(c.createBufferSource()); s.buffer = buf; s.playbackRate.value = rate; s.connect(input); s.start(at, off, dur); return s; };
  let at = t0;
  if (Math.random() < g * .7) {   // stutter: the first syllable once or twice
    const seg = rnd(.09, .14), n = Math.random() < .5 ? 1 : 2;
    for (let i = 0; i < n; i++) { src(0, seg, at); at += seg / rate + .02; }
  }
  const r = src(0, undefined, at).playbackRate, end = at + len;
  if (mood === 'wake') { r.setValueAtTime(rate * .6, at); r.exponentialRampToValueAtTime(rate, at + .25); }
  if (mood === 'happy') { r.setValueAtTime(rate, end - .18); r.linearRampToValueAtTime(rate * 1.18, end - .02); }
  if (mood === 'sleep') { r.setValueAtTime(rate, end - .35); r.linearRampToValueAtTime(rate * .55, end + .1); }
  for (let i = 0; i < Math.round(g * 2.5); i++) { const t = rnd(at + .1, end - .15); r.setValueAtTime(rate * (Math.random() < .5 ? 1.3 : .78), t); r.setValueAtTime(rate, t + .05); }
  for (let i = 0; i < Math.round(g * 3); i++) {
    const t = rnd(at + .08, end - .1);
    gate.gain.setValueAtTime(1, t); gate.gain.linearRampToValueAtTime(0, t + .004); gate.gain.setValueAtTime(0, t + rnd(.02, .04)); gate.gain.linearRampToValueAtTime(1, t + .045);
  }
  for (let i = 0; i < Math.round(g * 2); i++) {   // buzz bursts
    const n = mk(c.createBufferSource()), bp = mk(c.createBiquadFilter()), v = mk(c.createGain()), t = rnd(at, end);
    n.buffer = voiceNoise(c); bp.type = 'bandpass'; bp.frequency.value = rnd(1800, 4200); bp.Q.value = 3; v.gain.value = .25;
    n.connect(bp); bp.connect(v); v.connect(out); n.start(t, rnd(0, .5), rnd(.03, .07));
  }
  const total = end - c.currentTime + .15;
  osc.start(t0); osc.stop(t0 + total + .3);
  hold(total + .5, () => nodes.forEach(n => { try { n.disconnect(); } catch (e) {} }));
  return total;
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
  if (k === 'up' && S.master === 13 && !muted) say('vol-max');
  if (k === 'mute' && muted) say('unmuted', { force: true, delay: 200 });
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
    if (p[2] === 'say') say(p[3], { force: true, anyTime: true });   // the Test button else play(p[2], { variant: p[3] || undefined, full: true });
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
let card = null;
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
    <div class="lbl"><span>Voice clips</span><span id="sndVoiceN"></span></div>
    <div class="actions"><button class="btn quiet" id="sndVoiceUp">Upload voice folder</button><input id="sndVoiceDir" type="file" webkitdirectory multiple hidden></div>
    <div class="note" id="sndVoiceMsg"></div>
    <div class="lbl"><span>ElevenLabs</span><span id="sndKeyState"></span></div>
    <input class="field" id="sndKey" type="password" autocomplete="off" spellcheck="false" placeholder="API key, stays on the projector">
    <div class="actions"><button class="btn" id="sndKeySave">Save key</button><button class="btn quiet" id="sndCredBtn">Credits</button></div>
    <div class="note" id="sndCredits"></div>
`;
  card.addEventListener('input', e => {
    const k = e.target.dataset.k;
    if (!k) return;
    setP(k, e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value);
    if (k === 'master') muted = false;
    applyLevels(); renderValues(); saveLater(300);
  });
  card.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.test === 'voice') ON ? api('POST', '/api/sound/play', { id: 'say', variant: 'boot' }) : say('boot', { force: true, anyTime: true });
    else if (b.dataset.test) { const id = reg()[TEST[b.dataset.test]] ? TEST[b.dataset.test] : Object.keys(reg()).find(i => reg()[i].type === b.dataset.test); if (id) playThere(id); }
    else if (b.id === 'sndVoiceUp') $('#sndVoiceDir').click();
    else if (b.id === 'sndKeySave') saveKey();
    else if (b.id === 'sndCredBtn') credits();
  });
  $('#sndVoiceDir').onchange = e => uploadVoice(e.target.files);
  renderCard();
  if (ON) credits();
}
// the voice folder from the laptop -> the projector, one clip at a time (only <id>.mp3 names)
async function uploadVoice(list) {
  const fs = [...list].filter(f => /^[a-z0-9-]{1,40}\.mp3$/.test(f.name)), msg = $('#sndVoiceMsg');
  if (!ON) { msg.textContent = 'Uploading works on the projector.'; return; }
  let n = 0, bad = 0;
  for (const f of fs) {
    msg.textContent = `Uploading ${n + bad + 1} of ${fs.length}…`;
    const r = await fetch('/api/voice/' + f.name, { method: 'PUT', body: await f.arrayBuffer() }).catch(() => null);
    if (r && r.ok) n++; else bad++;
  }
  msg.textContent = `${n} clips on the projector` + (bad ? `, ${bad} failed` : '') + '.';
  loadVoice();
}
function renderValues() {
  if (!card) return;
  card.querySelectorAll('[data-k]').forEach(i => { const v = getP(i.dataset.k); if (i.type === 'checkbox') i.checked = !!v; else if (document.activeElement !== i) i.value = v; });
  card.querySelectorAll('[data-v]').forEach(s => { s.textContent = getP(s.dataset.v); });
}
function renderCard() {
  if (!card) return;
  renderValues();
  $('#sndVoiceN').textContent = ON ? voiceFiles.size + ' on the projector' : 'projector only';
  $('#sndKeyState').textContent = !ON ? 'projector only' : hasKey ? 'Key saved' : 'No key';
  card.querySelectorAll('#sndKey, #sndKeySave, #sndCredBtn').forEach(x => { x.disabled = !ON; });
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
loadSettings().then(() => { applyLevels(); buildCard(); loadFiles(); loadVoice(); });

window.BearWallSound = {
  play, ambience, volKey, event, say,
  _voice(name, buf) { voiceFiles.add(name); clipCache.set(name, Promise.resolve(buf)); },   // headless tests
  sleep() { asleep = true; ambience([]); },
  wake() { asleep = false; },
  get settings() { return S; },
  get speaking() { return speaking || queue.length > 0; },
  get files() { return files; }
};
})();
