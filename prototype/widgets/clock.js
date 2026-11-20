// Clock: digital (time inside a ring that fills through the hour), analog face, or a word clock.
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
const TIME = '<div class="tx"><div class="big fit"><span class="hh"></span><span class="co">:</span><span class="mm"></span></div><div class="sm fit"></div></div>';

function build(style, mode) {
  if (style === 'word') return mode === 'square'
    ? `<div class="lg">${LETTERS.join('').split('').map(c => `<span>${c}</span>`).join('')}</div>`
    : '<div class="tx"><div class="ph fit"></div></div>';
  return (style === 'analog' ? FACE : U.ringHTML()) + TIME;
}

BearWall.register({
  type: 'clock',
  name: 'Clock',
  size: { square: [264, 264], rect: [488, 104] },
  options: [
    { key: 'style', label: 'Style', type: 'tabs', choices: [['digital', 'Digital'], ['analog', 'Analog'], ['word', 'Words']], value: 'digital' },
    { key: 'h24', label: '24-hour time', type: 'switch', value: false },
    { key: 'seconds', label: 'Show seconds', type: 'switch', value: false }
  ],
  every: 1000,
  css: `
    .w-clock .tx { min-width: 0; }
    .w-clock .big { font-weight: 800; letter-spacing: -.04em; line-height: 1.1; font-variant-numeric: tabular-nums; text-shadow: 0 0 calc(var(--glow) * var(--u) * 5) currentColor; }
    .w-clock .sm { color: var(--w-dim); font-weight: 600; font-variant-numeric: tabular-nums; }
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
    .w-clock.square .face + .tx { display: none; }
    .w-clock.square .big { width: 100%; font-size: calc(var(--u) * 19 * var(--fit, 1)); }
    .w-clock.square .sm { width: 100%; font-size: calc(var(--u) * 6.5 * var(--fit, 1)); margin-top: calc(var(--u) * 1); }

    .w-clock.rect { display: flex; align-items: center; gap: calc(var(--u) * 12); }
    .w-clock.rect.right { flex-direction: row-reverse; }
    .w-clock.rect .ring, .w-clock.rect .face { height: 100%; aspect-ratio: 1; flex: none; }
    .w-clock.rect .tx { flex: 1 1 0; }
    .w-clock.rect.right .tx { text-align: right; }
    .w-clock.rect .big { font-size: calc(var(--u) * 44 * var(--fit, 1)); }
    .w-clock.rect .sm { font-size: calc(var(--u) * 14 * var(--fit, 1)); }
    .w-clock.rect .ph { font-size: calc(var(--u) * 26 * var(--fit, 1)); }`,
  mount() {},   // the DOM depends on the style option, so update() builds it
  update(el, ctx) {
    const { now, opts } = ctx, style = opts.style, key = style + ctx.mode;
    if (el._key !== key) { el._key = key; el.innerHTML = build(style, ctx.mode); }
    const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();

    if (style === 'word') {
      const ws = words(now), text = phrase(ws);
      if (ctx.mode === 'rect') U.typeOut(el.querySelector('.ph'), text, ctx.motion);
      else if (el._ph !== text) {
        el._ph = text;
        const lit = new Set();
        ws.forEach(w => { const [r, c, n] = WORDS[w]; for (let i = 0; i < n; i++) lit.add(r * 11 + c + i); });
        el.querySelectorAll('.lg span').forEach((sp, i) => sp.classList.toggle('on', lit.has(i)));
      }
    } else {
      if (style === 'digital') U.setRing(el.querySelector('.ring'), (m + s / 60) / 60 * 100);
      else {
        const rot = (sel, deg) => { el.querySelector(sel).style.transform = `rotate(${deg}deg)`; };
        rot('.hr', (h % 12 + m / 60) * 30); rot('.mn', (m + s / 60) * 6); rot('.sc', s * 6);
        el.querySelector('.sc').style.display = opts.seconds ? '' : 'none';
      }
      const [hm, ap = ''] = U.fmtTime(now, opts.h24).split(' '), [hh, mm] = hm.split(':');
      el.querySelector('.hh').textContent = hh;
      el.querySelector('.mm').textContent = mm;
      el.querySelector('.sm').textContent = [opts.seconds && ':' + pad(s), ap].filter(Boolean).join(' ');
    }
    U.fit(el);
  }
});
})();
