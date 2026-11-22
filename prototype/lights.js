/* BearWall Lights: the room's Tuya bulb, run by the projector app (Lights.java), replacing the laptop's TuyaLightsControl.
 *  - control page: a second page (Wall | Lights tabs) with power, white / colour, 4 scenes, sunrise, warm-down,
 *    follow-laptop and the one-time bulb setup (the local key goes to the projector and is never shown again)
 *  - wall: Light mode for the remote (the app calls BearWall.lightMode / lightKey) with a small overlay
 *  - widgets read BearWallLights.state
 * Outside the projector (the plain prototype) a simulated bulb answers instead.
 * Light fields: on, mode white|colour, h 0-360, s 0-1000, bright 10-1000, temp 0-1000 (0 = warm). */
(function () {
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = BearWall.util.esc;

/* ---------- the bulb: the projector's API, or a simulation in the prototype ---------- */
const L = (on, mode, h, s, bright, temp) => ({ on, mode, h, s, bright, temp });
const SIM = {
  light: L(true, 'white', 0, 0, 1000, 1000),
  settings: { scenes: [
    { name: 'Focus', icon: '💡', light: L(true, 'white', 0, 0, 1000, 1000) }, { name: 'Chill', icon: '🧸', light: L(true, 'white', 0, 0, 350, 150) },
    { name: 'Movie', icon: '🍿', light: L(true, 'colour', 230, 900, 250, 0) }, { name: 'Night', icon: '🌙', light: L(true, 'colour', 10, 1000, 30, 0) }],
    sunrise: { on: false, time: '06:30', minutes: 25 }, warm: { on: false, time: '21:00', minutes: 60, bright: 300 }, follow: { on: false } },
  bulb: { found: true, ip: 'simulated', setup: true }, active: []
};
const copy = o => JSON.parse(JSON.stringify(o));
const api = BearWall.onProjector ? {
  get: () => fetch('/api/lights', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  post: (p, body) => fetch('/api/lights/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
} : {
  get: () => Promise.resolve(copy(SIM)),
  post(p, b) {
    if (p === 'light') Object.assign(SIM.light, b);
    else if (p === 'scene') Object.assign(SIM.light, SIM.settings.scenes[b.i].light);
    else if (p === 'scene/save') SIM.settings.scenes[b.i].light = copy(SIM.light);
    else if (p === 'settings') for (const k in b) Object.assign(SIM.settings[k], b[k]);
    else if (p === 'setup') SIM.bulb.setup = true;
    return Promise.resolve(copy(SIM));
  }
};

let state = null, scene = -1;
const set = st => { state = st; render(); };
const refresh = () => api.get().then(set).catch(() => {});
// changes go through one queue, newest wins, so a dragged slider never floods the bulb (the app spaces commands too)
let pending = null, busy = false;
function send(p, body) {
  if (state && p === 'light') Object.assign(state.light, body), render();   // show it right away
  if (busy) { pending = [p, body]; return; }
  busy = true;
  api.post(p, body).then(set).catch(() => {}).then(() => { busy = false; if (pending) { const n = pending; pending = null; send(n[0], n[1]); } });
}

// what the bulb looks like, as a CSS color (white: warm amber .. cool white)
function swatch(l) {
  if (!l || !l.on) return '#222';
  if (l.mode === 'colour') return `hsl(${l.h}, ${l.s / 10}%, ${45 + l.bright / 40}%)`;
  const t = l.temp / 1000, mix = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${mix(255, 214)}, ${mix(176, 228)}, ${mix(96, 255)})`;
}
const sceneOf = st => st.settings.scenes.findIndex(s => ['on', 'mode', 'bright'].concat(s.light.mode === 'white' ? ['temp'] : ['h', 's']).every(k => s.light[k] === st.light[k]));

/* ---------- control page: the Lights tab ---------- */
const PAGE = `
<div class="lights-grid">
  <section class="glass">
    <h2>Light</h2>
    <div class="sub" id="lBulb">Looking for the bulb…</div>
    <div class="lswatch" id="lSwatch"></div>
    <label class="row">On<input type="checkbox" class="switch" id="lOn"></label>
    <div class="lbl"><span>Mode</span></div>
    <div class="tabs" id="lMode"><button data-v="white">White</button><button data-v="colour">Colour</button></div>
    <div class="lbl"><span>Brightness</span><span id="lBrightV"></span></div>
    <input type="range" id="lBright" min="10" max="1000" step="10" aria-label="Brightness">
    <div id="lWhite"><div class="lbl"><span>Warmth</span><span>warm · cool</span></div>
      <input type="range" id="lTemp" min="0" max="1000" step="10" aria-label="Warmth"></div>
    <div id="lColour"><div class="lbl"><span>Hue</span></div><input type="range" id="lHue" class="hue" min="0" max="360" step="1" aria-label="Hue">
      <div class="lbl"><span>Saturation</span></div><input type="range" id="lSat" min="0" max="1000" step="10" aria-label="Saturation"></div>
  </section>
  <section class="glass">
    <h2>Scenes</h2>
    <div class="sub">Tap to switch. "Save" stores the light as it is now in that scene. On the remote, Light mode steps through them with ◀ ▶.</div>
    <div class="lscenes" id="lScenes"></div>
  </section>
  <section class="glass">
    <h2>Schedules</h2>
    <div class="sub">They run on the projector, so they work with the laptop off. Touching the light stops one until its next day.</div>
    <label class="row">Sunrise<input type="checkbox" class="switch" id="srOn"></label>
    <div class="ltime"><span>Fades up to full by</span><input type="time" class="field" id="srTime"><span>over</span><input type="number" class="field" id="srMin" min="1" max="240"><span>min</span></div>
    <label class="row">Evening warm-down<input type="checkbox" class="switch" id="wmOn"></label>
    <div class="ltime"><span>From</span><input type="time" class="field" id="wmTime"><span>over</span><input type="number" class="field" id="wmMin" min="1" max="240"><span>min, down to</span><input type="number" class="field" id="wmBright" min="1" max="100"><span>%</span></div>
    <label class="row">Follow the laptop<input type="checkbox" class="switch" id="foOn"></label>
    <div class="note">Dark while the laptop is locked. The projector only knows while BearWall Control is open.</div>
  </section>
  <section class="glass">
    <h2>Bulb</h2>
    <div class="sub" id="lSetupNote"></div>
    <div class="lbl"><span>Device ID</span></div>
    <input class="field" id="lId" autocomplete="off" spellcheck="false" placeholder="From TuyaLightsControl's devices.json">
    <div class="lbl"><span>Local key</span></div>
    <input class="field" id="lKey" type="password" autocomplete="off" placeholder="16 characters, stays on the projector">
    <div class="actions"><button class="btn" id="lSave">Save bulb</button><span class="note" id="lSetupMsg"></span></div>
  </section>
</div>`;

function bindPage() {
  const page = $('#lightsPage');
  if (!page) return;
  page.innerHTML = PAGE;
  const onTab = (box, fn) => { box.onclick = e => { const b = e.target.closest('button'); if (b) fn(b.dataset.v); }; };
  onTab($('#pageTabs'), v => { showPage(v); try { localStorage.setItem('bearwall.page', v); } catch (e) {} });
  let saved = 'wall';
  try { saved = localStorage.getItem('bearwall.page') || 'wall'; } catch (e) {}
  showPage(saved);
  $('#lOn').onchange = e => send('light', { on: e.target.checked });
  onTab($('#lMode'), v => send('light', v === 'white' ? { on: true, mode: 'white' } : { on: true, mode: 'colour', s: state.light.s || 1000 }));
  $('#lBright').oninput = e => send('light', { on: true, bright: +e.target.value });
  $('#lTemp').oninput = e => send('light', { on: true, mode: 'white', temp: +e.target.value });
  $('#lHue').oninput = e => send('light', { on: true, mode: 'colour', h: +e.target.value });
  $('#lSat').oninput = e => send('light', { on: true, mode: 'colour', s: +e.target.value });
  $('#lScenes').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.save != null) send('scene/save', { i: +b.dataset.save });
    else { scene = +b.dataset.i; send('scene', { i: scene }); }
  };
  const sched = () => send('settings', {
    sunrise: { on: $('#srOn').checked, time: $('#srTime').value, minutes: +$('#srMin').value },
    warm: { on: $('#wmOn').checked, time: $('#wmTime').value, minutes: +$('#wmMin').value, bright: +$('#wmBright').value * 10 },
    follow: { on: $('#foOn').checked } });
  ['srOn', 'srTime', 'srMin', 'wmOn', 'wmTime', 'wmMin', 'wmBright', 'foOn'].forEach(id => { $('#' + id).onchange = sched; });
  $('#lSave').onclick = () => {
    const id = $('#lId').value.trim(), key = $('#lKey').value;
    if (!/^[A-Za-z0-9]{10,32}$/.test(id) || !/^[\x21-\x7e]{16}$/.test(key)) { $('#lSetupMsg').textContent = 'Check the ID (letters and digits) and the 16-character key.'; return; }
    api.post('setup', { id, key }).then(st => { $('#lKey').value = ''; $('#lSetupMsg').textContent = 'Saved. Looking for the bulb…'; set(st); })
      .catch(() => { $('#lSetupMsg').textContent = 'The projector refused it.'; });
  };
}
function showPage(v) {
  document.querySelectorAll('#pageTabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('main > .top').hidden = v === 'lights';
  $('#lightsPage').hidden = v !== 'lights';
}

const focused = el => document.activeElement === el;   // never yank a slider or field out from under the user
function renderPage() {
  if (!$('#lOn') || !state) return;
  const l = state.light, st = state.settings, b = state.bulb;
  $('#lBulb').textContent = !b.setup ? 'No bulb set up yet: fill in "Bulb" below.' : b.found ? `Bulb connected${b.ip && b.ip !== 'simulated' ? ' · ' + b.ip : ' (simulated)'}`
    : 'Looking for the bulb on the Wi-Fi… (switched off at the wall?)';
  $('#lSwatch').style.background = swatch(l);
  $('#lOn').checked = l.on;
  document.querySelectorAll('#lMode button').forEach(x => x.classList.toggle('on', x.dataset.v === l.mode));
  $('#lWhite').hidden = l.mode !== 'white'; $('#lColour').hidden = l.mode !== 'colour';
  for (const [id, v] of [['lBright', l.bright], ['lTemp', l.temp], ['lHue', l.h], ['lSat', l.s]]) if (!focused($('#' + id))) $('#' + id).value = v;
  $('#lBrightV').textContent = Math.round(l.bright / 10) + '%';
  const cur = sceneOf(state);
  $('#lScenes').innerHTML = st.scenes.map((s, i) => `<div class="lscene${i === cur ? ' on' : ''}"><button data-i="${i}" style="--sw:${swatch(s.light)}"><i></i>${esc(s.icon)} ${esc(s.name)}</button>`
    + `<button class="btn quiet" data-save="${i}" title="Save the light as it is now in ${esc(s.name)}">Save</button></div>`).join('');
  const put = (id, v, prop = 'value') => { if (!focused($('#' + id))) $('#' + id)[prop] = v; };
  put('srOn', st.sunrise.on, 'checked'); put('srTime', st.sunrise.time); put('srMin', st.sunrise.minutes);
  put('wmOn', st.warm.on, 'checked'); put('wmTime', st.warm.time); put('wmMin', st.warm.minutes); put('wmBright', Math.round(st.warm.bright / 10));
  put('foOn', st.follow.on, 'checked');
  $('#lSetupNote').textContent = b.setup ? 'A bulb is set up. Enter it again only to replace it; the key is never shown back.'
    : 'Paste the "id" and "key" of your bulb from TuyaLightsControl\'s devices.json. The key stays on the projector.';
}

/* ---------- the wall: Light mode for the remote ---------- */
let hud = null, mode = false;
function hudEl() {
  if (hud) return hud;
  hud = document.createElement('div');
  hud.className = 'lhud';
  hud.innerHTML = '<b>LIGHT MODE</b><div class="lrow"><i class="ldot"></i><span class="lname"></span><span class="lpct"></span></div>'
    + '<div class="lbar"><i></i></div><small>◀ ▶ scene · VOL brightness · ▲ ▼ warmth · OK on/off</small>';
  document.body.appendChild(hud);
  return hud;
}
function renderHud() {
  if (!hud || !state) return;
  if (mode) BearWall.hud(hud);   // section 1
  const l = state.light, i = sceneOf(state);
  hud.querySelector('.ldot').style.background = swatch(l);
  hud.querySelector('.lname').textContent = !state.bulb.setup ? 'No bulb set up' : !l.on ? 'Off' : i >= 0 ? state.settings.scenes[i].name : l.mode === 'white' ? 'White' : 'Colour';
  hud.querySelector('.lpct').textContent = l.on ? Math.round(l.bright / 10) + '%' : '';
  hud.querySelector('.lbar i').style.transform = `scaleX(${l.on ? l.bright / 1000 : 0})`;
  hud.querySelector('small').textContent = l.mode === 'colour' ? '◀ ▶ scene · VOL brightness · ▲ ▼ colour · OK on/off' : '◀ ▶ scene · VOL brightness · ▲ ▼ warmth · OK on/off';
}
function lightMode(on) {
  if (!!on !== mode) { BearWall.sound(on ? 'light-on' : 'light-off'); BearWall.say(on ? 'light-mode-on' : 'light-mode-off', { force: true }); }   // the app re-sends "on" with each press to restart its timer
  mode = !!on;
  if (mode) BearWall.hud(hudEl());
  hudEl().classList.toggle('on', mode);
  if (mode) refresh();
  renderHud();
}
// one remote key while Light mode is on: left/right, volup/voldown, up/down, ok
function lightKey(k) {
  if (!state) return refresh();
  const l = state.light, n = state.settings.scenes.length;
  if (k === 'left' || k === 'right') {
    const cur = sceneOf(state);
    scene = ((cur >= 0 ? cur : scene < 0 ? (k === 'right' ? -1 : 0) : scene) + (k === 'right' ? 1 : -1) + n) % n;
    Object.assign(state.light, state.settings.scenes[scene].light);
    BearWall.sound('light-scene', { pitch: scene % 8 });
    render();
    send('scene', { i: scene });
  } else if (k === 'volup' || k === 'voldown') { BearWall.sound('light-tick'); send('light', { on: true, bright: clamp(l.bright + (k === 'volup' ? 100 : -100), 10, 1000) }); }
  else if (k === 'up' || k === 'down') {
    const d = k === 'up' ? 1 : -1;   // up = warmer white / hue forward
    BearWall.sound('light-tick');
    send('light', l.mode === 'colour' ? { on: true, h: (l.h + 20 * d + 360) % 360 } : { on: true, temp: clamp(l.temp - 100 * d, 0, 1000) });
  } else if (k === 'ok') { BearWall.sound(l.on ? 'light-off' : 'light-on'); BearWall.say(l.on ? 'lights-off' : 'lights-on', { force: true }); send('light', { on: !l.on }); }
}

function render() { renderPage(); renderHud(); }

window.BearWallLights = { get state() { return state; }, refresh, mode: lightMode, key: lightKey, swatch,
  scene: () => { const i = state ? sceneOf(state) : -1; return i >= 0 ? state.settings.scenes[i].name : null; } };
bindPage();
refresh();
})();
