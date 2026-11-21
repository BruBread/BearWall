// Clock: digital (time inside a ring that fills through the hour), split-flap, analog face, or a word clock.
// Options: seconds, a date line and a second time zone.
(function () {
const U = BearWall.util;
const pad = n => String(n).padStart(2, '0');

// Word clock: the classic 11 x 10 letter grid. Each word is [row, column, length].
const LETTERS = ['ITLISASTIME', 'ACQUARTERDC', 'TWENTYFIVEX', 'HALFBTENFTO', 'PASTERUNINE',
  'ONESIXTHREE', 'FOURFIVETWO', 'EIGHTELEVEN', 'SEVENTWELVE', 'TENSEOCLOCK'];
const WORDS = { IT: [0, 0, 2], IS: [0, 3, 2], A: [1, 0, 1], QUARTER: [1, 2, 7], TWENTY: [2, 0, 6], mFIVE: [2, 6, 4],
  HALF: [3, 0, 4], mTEN: [3, 5, 3], TO: [3, 9, 2], PAST: [4, 0, 4], NINE: [4, 7, 4], ONE: [5, 0, 3], SIX: [5, 3, 3],
  THREE: [5, 6, 5], FOUR: [6, 0, 4], FIVE: [6, 4, 4], TWO: [6, 8, 3], EIGHT: [7, 0, 5], ELEVEN: [7, 5, 6],
  SEVEN: [8, 0, 5], TWELVE: [8, 5, 6], TEN: [9, 0, 3], OCLOCK: [9, 5, 6] };
const HOURS = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN'];
const MINS = { 0: [], 5: ['mFIVE', 'PAST'], 10: ['mTEN', 'PAST'], 15: ['A', 'QUARTER', 'PAST'], 20: ['TWENTY', 'PAST'],
  25: ['TWENTY', 'mFIVE', 'PAST'], 30: ['HALF', 'PAST'], 35: ['TWENTY', 'mFIVE', 'TO'], 40: ['TWENTY', 'TO'],
  45: ['A', 'QUARTER', 'TO'], 50: ['mTEN', 'TO'], 55: ['mFIVE', 'TO'] };
function words(now) {   // rounded to the nearest 5 minutes
  let m5 = Math.round((now.getMinutes() + now.getSeconds() / 60) / 5) * 5, h = now.getHours();
  if (m5 === 60) { m5 = 0; h++; }
  if (m5 > 30) h++;
  return ['IT', 'IS', ...MINS[m5], HOURS[h % 12], ...(m5 ? [] : ['OCLOCK'])];
}
const phrase = ws => { const t = ws.map(w => w === 'OCLOCK' ? "o'clock" : w.replace(/^m/, '').toLowerCase()).join(' '); return t[0].toUpperCase() + t.slice(1); };

const at = (h, m) => { const d = new Date(2026, 0, 1, h, m); return phrase(words(d)); };
console.assert(at(10, 20) === 'It is twenty past ten' && at(10, 33) === 'It is twenty five to eleven'
  && at(10, 58) === "It is eleven o'clock" && at(23, 45) === 'It is a quarter to twelve' && at(0, 2) === "It is twelve o'clock", 'word clock phrases');

const TICKS = Array.from({ length: 12 }, (_, i) =>
  `<line class="tk${i % 3 ? '' : ' q'}" x1="50" y1="${i % 3 ? 7 : 5}" x2="50" y2="12" transform="rotate(${i * 30} 50 50)"/>`).join('');
const FACE = `<div class="face"><svg viewBox="0 0 100 100" aria-hidden="true">${TICKS}<line class="hand hr" x1="50" y1="54" x2="50" y2="27"/>`
  + `<line class="hand mn" x1="50" y1="56" x2="50" y2="14"/><line class="hand sc" x1="50" y1="58" x2="50" y2="10"/><circle class="hub" cx="50" cy="50" r="3"/></svg></div>`;
const LINES = '<div class="sm fit"></div><div class="dt fit"></div><div class="tz fit"></div>';
const TIME = `<div class="tx"><div class="big fit"><span class="hh"></span><span class="co">:</span><span class="mm"></span></div>${LINES}</div>`;
// Split-flap card: static top shows the new digit, static bottom the old one until the bottom flap lands on it.
const CARD = '<span class="cd"><span class="up"><b></b></span><span class="dn"><b></b></span><span class="fu"><b></b></span><span class="fd"><b></b></span></span>';
const FLIP = `<div class="fl"><div class="cards">${CARD}${CARD}<span class="cs co">:</span>${CARD}${CARD}<span class="ss"><span class="cs sx">:</span>${CARD}${CARD}</span></div><div class="ln">${LINES}</div></div>`;

function build(style, mode) {
  if (style === 'word') return mode === 'square'
    ? `<div class="lg">${LETTERS.join('').split('').map(c => `<span>${c}</span>`).join('')}</div><div class="wl"><div class="dt fit"></div></div>`
    : '<div class="tx"><div class="ph fit"></div></div>';
  if (style === 'flip') return FLIP;
  return (style === 'analog' ? FACE : U.ringHTML()) + TIME;
}

function setCard(cd, d, anim) {
  if (cd._d === d) return;
  const old = cd._d == null ? d : cd._d, [up, dn, fu, fd] = Array.from(cd.children, c => c.firstChild);
  cd._d = d;
  up.textContent = fd.textContent = d; fu.textContent = old;
  if (!anim || old === d) { dn.textContent = d; cd.classList.remove('go'); return; }
  dn.textContent = old;
  cd.classList.remove('go'); void cd.offsetWidth; cd.classList.add('go');   // restart the flip
}
function flip(el, digits, sec, motion) {
  const anim = motion === 'full' || motion === 'lite';
  el.querySelector('.fl').classList.toggle('sec', !!sec);
  el.querySelector('.ss').style.display = sec ? '' : 'none';
  el.querySelectorAll('.cd').forEach((cd, i) => { if (i < 4 || sec) setCard(cd, digits[i], anim); });
  el.querySelector('.cd').style.display = digits[0] === ' ' ? 'none' : '';   // 12-hour "7:05": no blank card
}

// Analog second hand: a 60 s CSS rotation in Full/Lite (always forward, so no backwards spin at :00),
// started in sync with ctx.now and re-synced only if it drifts over 1 s. Calm/Off or a frozen sample time tick instead.
function seconds(el, now, on, motion) {
  const sc = el.querySelector('.sc'), t = now.getSeconds() + now.getMilliseconds() / 1000;
  const live = el._last !== undefined && now.getTime() !== el._last;
  el._last = now.getTime();
  sc.style.display = on ? '' : 'none';
  if (on && live && (motion === 'full' || motion === 'lite')) {
    let d = el._t0 == null ? 99 : Math.abs((Date.now() / 1000 - el._t0) % 60 - t);
    d = Math.min(d, 60 - d);
    if (d > 1 || !sc.classList.contains('sw')) {
      el._t0 = Date.now() / 1000 - t;
      sc.style.transform = ''; sc.classList.remove('sw'); void sc.getBoundingClientRect();
      sc.style.animationDelay = -t + 's'; sc.classList.add('sw');
    }
  } else {
    sc.classList.remove('sw'); el._t0 = null;
    sc.style.transform = `rotate(${now.getSeconds() * 6}deg)`;
  }
}

const TZS = [['', 'Off'], ['Asia/Manila', 'Manila'], ['Asia/Tokyo', 'Tokyo'], ['Asia/Seoul', 'Seoul'], ['Asia/Singapore', 'Singapore'],
  ['Australia/Sydney', 'Sydney'], ['Europe/London', 'London'], ['Europe/Paris', 'Paris'], ['America/New_York', 'New York'],
  ['America/Los_Angeles', 'Los Angeles'], ['UTC', 'UTC']];
const TZ_NAME = Object.fromEntries(TZS), fmts = {};
const fmt = (k, o) => fmts[k] || (fmts[k] = new Intl.DateTimeFormat(o.locale, o));
const dateLine = now => fmt('date', { locale: 'en-GB', weekday: 'short', day: 'numeric', month: 'short' }).format(now);
function tzLine(now, tz, h24) {
  try {
    return TZ_NAME[tz] + ' ' + fmt(tz + h24, h24 ? { locale: 'en-US', timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : { locale: 'en-US', timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(now);
  } catch (e) { return ''; }
}
console.assert(dateLine(new Date(2026, 10, 21)) === 'Sat 21 Nov' && tzLine(new Date(Date.UTC(2026, 0, 1)), 'Asia/Tokyo', true) === 'Tokyo 09:00'
  && tzLine(new Date(Date.UTC(2026, 0, 1)), 'America/New_York', false) === 'New York 7:00 PM', 'date and time zone lines');

BearWall.register({
  look: ['ring', 'text', 'dim', 'thick', 'track', 'glow'],
  type: 'clock',
  name: 'Clock',
  size: { square: [264, 264], rect: [488, 104] },
  options: [
    { key: 'style', label: 'Style', type: 'tabs', choices: [['digital', 'Digital'], ['flip', 'Flip'], ['analog', 'Analog'], ['word', 'Words']], value: 'digital' },
    { key: 'h24', label: '24-hour time', type: 'switch', value: false },
    { key: 'seconds', label: 'Show seconds', type: 'switch', value: false },
    { key: 'date', label: 'Show date', type: 'switch', value: false },
    { key: 'tz', label: 'Second time zone', type: 'select', value: '', choices: TZS }
  ],
  every: 1000,
  css: `
    .w-clock .tx { min-width: 0; }
    .w-clock .big { font-weight: 800; letter-spacing: -.04em; line-height: 1.1; font-variant-numeric: tabular-nums; text-shadow: 0 0 calc(var(--glow) * var(--u) * 5) currentColor; }
    .w-clock .sm, .w-clock .dt, .w-clock .tz { color: var(--w-dim); font-weight: 600; font-variant-numeric: tabular-nums; }
    .w-clock .sm:empty, .w-clock .dt:empty, .w-clock .tz:empty { display: none; }
    .m-full .w-clock .co, .m-lite .w-clock .co { animation: blink 2s steps(1) infinite; }
    .w-clock .face svg { width: 100%; height: 100%; }
    .w-clock .tk { stroke: var(--w-dim); stroke-width: 2.5; stroke-linecap: round; }
    .w-clock .tk.q { stroke: var(--w-text); stroke-width: 3.5; }
    .w-clock .hand { stroke-linecap: round; transform-origin: 50px 50px; }
    .w-clock .hr { stroke: var(--w-text); stroke-width: 5; }
    .w-clock .mn { stroke: var(--ring); stroke-width: 3.5; filter: drop-shadow(0 0 calc(var(--glow) * 3px) var(--ring)); }
    .w-clock .sc { stroke: var(--w-dim); stroke-width: 2; }
    .w-clock .hub { fill: var(--ring); }
    .w-clock .lg { position: absolute; inset: 0; padding: 3%; display: grid; grid-template-columns: repeat(11, 1fr); grid-template-rows: repeat(10, 1fr);
      align-items: center; justify-items: center; font-size: calc(var(--u) * 7); font-weight: 700; }
    .w-clock .lg span { opacity: .22; transition: opacity .6s, text-shadow .6s; }
    .w-clock .lg span.on { opacity: 1; text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .m-off .w-clock .lg span { transition: none; }
    .w-clock .ph { font-weight: 600; text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }

    .w-clock.square .ring { position: absolute; left: 4%; top: 4%; width: 92%; }
    .w-clock.square .face { position: absolute; left: 2%; top: 2%; width: 96%; height: 96%; }
    .w-clock.square .tx { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 18%; text-align: center; }
    .w-clock.square .face + .tx { justify-content: flex-end; padding-bottom: 27%; }
    .w-clock.square .face + .tx .big, .w-clock.square .face + .tx .sm { display: none; }
    .w-clock.square .dt, .w-clock.square .tz { width: 100%; font-size: calc(var(--u) * 5 * var(--fit, 1)); margin-top: calc(var(--u) * .6); }
    .w-clock .lg.ex { bottom: 11%; }
    .w-clock .wl { position: absolute; left: 4%; right: 4%; bottom: 2%; text-align: center; }
    .w-clock .wl .dt { font-size: calc(var(--u) * 4.6 * var(--fit, 1)); }
    .w-clock.square .big { width: 100%; font-size: calc(var(--u) * 19 * var(--fit, 1)); }
    .w-clock.square .sm { width: 100%; font-size: calc(var(--u) * 6.5 * var(--fit, 1)); margin-top: calc(var(--u) * 1); }

    .w-clock.rect { display: flex; align-items: center; gap: calc(var(--u) * 12); }
    .w-clock.rect.right { flex-direction: row-reverse; }
    .w-clock.rect .ring, .w-clock.rect .face { height: 100%; aspect-ratio: 1; flex: none; }
    .w-clock.rect .tx { flex: 1 1 0; }
    .w-clock.rect.right .tx { text-align: right; }
    .w-clock.rect .big { font-size: calc(var(--u) * 44 * var(--fit, 1)); }
    .w-clock.rect .sm { font-size: calc(var(--u) * 14 * var(--fit, 1)); }
    .w-clock.rect .ph { font-size: calc(var(--u) * 26 * var(--fit, 1)); }

    /* flip: split-flap cards sized from --cw (card width in --u) */
    .w-clock .fl { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; --cw: 19; }
    .w-clock .fl.sec { --cw: 11; }
    /* seconds: same size cards as hours and minutes, dimmer, after a gap and a small colon */
    .w-clock .fl .ss { display: flex; align-items: center; gap: calc(var(--u) * 1.2); margin-left: calc(var(--u) * 1.6); }
    .w-clock .fl .ss .cd { opacity: .5; }
    .w-clock .fl .ss .sx { font-size: calc(var(--u) * var(--cw) * .7); opacity: .5; }
    .w-clock .cards { display: flex; align-items: center; gap: calc(var(--u) * 1.2); }
    .w-clock .cs { font-size: calc(var(--u) * var(--cw) * 1.1); font-weight: 800; text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-clock .cd { position: relative; flex: none; width: calc(var(--u) * var(--cw)); height: calc(var(--u) * var(--cw) * 1.5);
      perspective: calc(var(--u) * var(--cw) * 6); font-size: calc(var(--u) * var(--cw) * 1.25); font-weight: 800; }
    .w-clock .cd > span { position: absolute; left: 0; right: 0; height: 50%; overflow: hidden; background: #151515; backface-visibility: hidden; }
    .w-clock .up, .w-clock .fu { top: 0; border-radius: calc(var(--u) * var(--cw) * .12) calc(var(--u) * var(--cw) * .12) 0 0; }
    .w-clock .dn, .w-clock .fd { bottom: 0; border-radius: 0 0 calc(var(--u) * var(--cw) * .12) calc(var(--u) * var(--cw) * .12); }
    .w-clock .cd b { position: absolute; left: 0; right: 0; height: 200%; display: flex; align-items: center; justify-content: center;
      font-variant-numeric: tabular-nums; text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-clock .up b, .w-clock .fu b { top: 0; }
    .w-clock .dn b, .w-clock .fd b { bottom: 0; }
    .w-clock .cd::after { content: ''; position: absolute; z-index: 3; left: 0; right: 0; top: 50%; height: calc(var(--u) * var(--cw) * .03 + 1px); background: #000; transform: translateY(-50%); }
    .w-clock .fu, .w-clock .fd { visibility: hidden; z-index: 2; }
    .w-clock .fu { transform-origin: 50% 100%; }
    .w-clock .fd { transform-origin: 50% 0; transform: rotateX(90deg); }
    .m-full .w-clock .cd.go .fu, .m-lite .w-clock .cd.go .fu { visibility: visible; animation: bwFlipU .28s ease-in forwards; }
    .m-full .w-clock .cd.go .fd, .m-lite .w-clock .cd.go .fd { visibility: visible; animation: bwFlipD .28s .28s ease-out forwards; }
    .m-lite .w-clock .cd.go .fu, .m-lite .w-clock .cd.go .fd { animation-timing-function: steps(3); }
    @keyframes bwFlipU { from { transform: rotateX(0); } to { transform: rotateX(-90deg); } }
    @keyframes bwFlipD { from { transform: rotateX(90deg); } to { transform: rotateX(0); } }
    .w-clock .ln { width: 100%; text-align: center; margin-top: calc(var(--u) * 3); }
    .w-clock.square .ln .sm { font-size: calc(var(--u) * 6.5 * var(--fit, 1)); }
    .w-clock.rect .fl { flex-direction: row; justify-content: flex-start; gap: calc(var(--u) * 10); --cw: 52; }
    .w-clock.rect .fl.sec { --cw: 36; }
    .w-clock.rect.right .fl { flex-direction: row-reverse; }
    .w-clock.rect .ln { flex: 1 1 0; min-width: 0; margin: 0; text-align: left; }
    .w-clock.rect.right .ln { text-align: right; }
    .w-clock.rect .ln .sm { font-size: calc(var(--u) * 16 * var(--fit, 1)); }

    /* analog: the sweeping second hand (Full / Lite) */
    .m-full .w-clock .sc.sw, .m-lite .w-clock .sc.sw { animation: bwSweep 60s linear infinite; }
    .m-lite .w-clock .sc.sw { animation-timing-function: steps(480); }
    @keyframes bwSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`,
  mount() {},   // the DOM depends on the style option, so update() builds it
  update(el, ctx) {
    const { now, opts } = ctx, style = opts.style, key = style + ctx.mode;
    if (el._key !== key) {
      el._key = key; el._last = undefined; el._t0 = null; el._ph = null;
      el.innerHTML = build(style, ctx.mode);
      el.querySelectorAll('.cd').forEach(cd => cd.lastChild.addEventListener('animationend', () => {
        cd.classList.remove('go'); cd.children[1].firstChild.textContent = cd._d;   // the flap landed: bottom shows the new digit
      }));
    }
    const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    const date = opts.date ? dateLine(now) : '', tz = opts.tz ? tzLine(now, opts.tz, opts.h24) : '';
    const text = (sel, t) => { const e = el.querySelector(sel); if (e && e.textContent !== t) e.textContent = t; };

    if (style === 'word') {
      const ws = words(now), said = phrase(ws);
      if (ctx.mode === 'rect') U.typeOut(el.querySelector('.ph'), said, ctx.motion);
      else if (el._ph !== said) {
        el._ph = said;
        const lit = new Set();
        ws.forEach(w => { const [r, c, n] = WORDS[w]; for (let i = 0; i < n; i++) lit.add(r * 11 + c + i); });
        el.querySelectorAll('.lg span').forEach((sp, i) => sp.classList.toggle('on', lit.has(i)));
      }
      if (ctx.mode === 'square') {   // word clock: one extra line under the grid (no room in rect)
        const extra = [date, tz].filter(Boolean).join(' · ');
        el.querySelector('.lg').classList.toggle('ex', !!extra);
        text('.wl .dt', extra);
      }
    } else {
      const [hm, ap = ''] = U.fmtTime(now, opts.h24).split(' '), [hh, mm] = hm.split(':');
      if (style === 'flip') flip(el, hh.padStart(2, ' ') + mm + pad(s), opts.seconds, ctx.motion);
      else {
        if (style === 'digital') U.setRing(el.querySelector('.ring'), (m + s / 60) / 60 * 100);
        else {
          const rot = (sel, deg) => { el.querySelector(sel).style.transform = `rotate(${deg}deg)`; };
          rot('.hr', (h % 12 + m / 60) * 30); rot('.mn', (m + s / 60) * 6);
          seconds(el, now, opts.seconds, ctx.motion);
        }
        text('.hh', hh); text('.mm', mm);
      }
      const small = [opts.seconds && style !== 'flip' && ':' + pad(s), ap].filter(Boolean).join(' ');
      if (ctx.mode === 'rect') { text('.sm', [small, date, tz].filter(Boolean).join(' · ')); text('.dt', ''); text('.tz', ''); }
      else { text('.sm', small); text('.dt', date); text('.tz', tz); }
    }
    U.fit(el);
  }
});
})();
