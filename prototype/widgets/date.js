// Date & progress: weekday, day number and month, with a ring showing how far through the day / waking hours / week / month / year we are.
(function () {
const U = BearWall.util;
const mins = t => { const [h, m] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const span = (now, a, b) => (now - a) / (b - a) * 100;

// percent 0-100 of the chosen period at `now`
function progress(kind, now, wake, sleep) {
  const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
  if (kind === 'awake') {
    const w = mins(wake), cur = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    let s = mins(sleep), c = cur;
    if (s <= w) s += 1440;                          // bedtime after midnight
    if (c < w && c + 1440 <= s) c += 1440;          // it's after midnight but before bedtime
    return U.clamp((c - w) / (s - w) * 100, 0, 100);
  }
  if (kind === 'week') { const back = (now.getDay() + 6) % 7; return span(now, new Date(y, mo, d - back), new Date(y, mo, d - back + 7)); }   // weeks start Monday
  if (kind === 'month') return span(now, new Date(y, mo, 1), new Date(y, mo + 1, 1));
  if (kind === 'year') return span(now, new Date(y, 0, 1), new Date(y + 1, 0, 1));
  return span(now, new Date(y, mo, d), new Date(y, mo, d + 1));
}

const fmt = (now, o) => now.toLocaleDateString('en-US', o);
const caption = (kind, now) => ({ day: 'of today', awake: 'of waking hours', week: 'of the week',
  month: 'of ' + fmt(now, { month: 'long' }), year: 'of ' + now.getFullYear() })[kind] || 'of today';

// self-check of the progress math (results in the browser console)
(function () {
  const ok = console.assert, at = (s) => new Date(s);
  ok(Math.round(progress('awake', at('2026-11-21T15:00'), '07:00', '23:00')) === 50, 'date: awake 15:00 in 07-23 is 50%');
  ok(Math.round(progress('awake', at('2026-11-22T00:30'), '07:00', '01:00')) === 97, 'date: awake past midnight before a 01:00 bedtime');
  ok(progress('awake', at('2026-11-21T03:00'), '07:00', '01:00') === 0, 'date: asleep at 03:00 is 0%');
  ok(progress('week', at('2026-11-23T00:00'), '', '') === 0, 'date: Monday 00:00 starts the week');
  ok(Math.round(progress('day', at('2026-11-21T18:00'), '', '')) === 75, 'date: 18:00 is 75% of the day');
  ok(progress('year', at('2026-01-01T00:00'), '', '') === 0, 'date: Jan 1 starts the year');
})();

BearWall.register({
  type: 'date',
  name: 'Date & progress',
  size: { square: [264, 264], rect: [488, 104] },
  options: [
    { key: 'progress', label: 'Progress through', type: 'tabs', value: 'day',
      choices: [['day', 'Day'], ['awake', 'Awake'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']] },
    { key: 'wake', label: 'Wake up (Awake only)', type: 'time', value: '07:00' },
    { key: 'sleep', label: 'Bedtime (Awake only)', type: 'time', value: '23:00' },
    { key: 'percent', label: 'Show percent', type: 'switch', value: true }
  ],
  every: 60000,
  css: `
    .w-date .tp { flex-direction: column; line-height: 1; }
    .w-date .n { font-weight: 800; letter-spacing: -.04em; text-shadow: 0 0 calc(var(--glow) * var(--u) * 5) currentColor; }
    .w-date .mo { color: var(--w-dim); font-weight: 600; text-transform: uppercase; letter-spacing: .08em; }
    .w-date .wd { font-weight: 600; text-shadow: 0 0 calc(var(--glow) * var(--u) * 3) currentColor; }
    .w-date .cap { color: var(--w-dim); font-weight: 400; }
    .w-date.square { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; justify-items: center; align-items: center; padding: 3% 0; }
    .w-date.square .tx, .w-date.rect > .wd { display: none; }
    .w-date.square .wd { width: 100%; text-align: center; font-size: calc(var(--u) * 9 * var(--fit, 1)); padding-bottom: 2%; }
    .w-date.square .ring { height: 100%; }
    .w-date.square .n { font-size: calc(var(--u) * 20); }
    .w-date.square .mo { font-size: calc(var(--u) * 5.5); margin-top: calc(var(--u) * 1.5); }
    .w-date.square .cap { width: 100%; text-align: center; font-size: calc(var(--u) * 6.4 * var(--fit, 1)); padding-top: 2%; }
    .w-date.square .dm { display: none; }
    .w-date.rect { display: flex; align-items: center; gap: calc(var(--u) * 14); }
    .w-date.rect.right { flex-direction: row-reverse; }
    .w-date.rect .ring { height: 100%; flex: none; }
    .w-date.rect .n { font-size: calc(var(--u) * 38); }
    .w-date.rect .mo { display: none; }
    .w-date.rect .tx { flex: 1 1 0; min-width: 0; }
    .w-date.rect.right .tx { text-align: right; }
    .w-date.rect .wd { font-size: calc(var(--u) * 24 * var(--fit, 1)); }
    .w-date.rect .dm { color: var(--w-dim); font-size: calc(var(--u) * 14 * var(--fit, 1)); margin-top: calc(var(--u) * 4); }
    .w-date.rect .cap { display: none; }`,
  mount(el) {
    el.innerHTML = `<div class="wd fit"></div>${U.ringHTML('<span class="n">0</span><span class="mo"></span>')}<div class="cap fit"></div>`
      + '<div class="tx"><div class="wd fit"></div><div class="dm fit"></div></div>';
  },
  update(el, ctx) {
    const now = ctx.now, o = ctx.opts, kind = o.progress || 'day';
    const pct = progress(kind, now, o.wake, o.sleep), cap = `${Math.round(pct)}% ${caption(kind, now)}`;
    const wd = fmt(now, { weekday: 'long' }), mon = fmt(now, { month: 'short' });
    el.querySelectorAll('.wd').forEach(x => { x.textContent = wd; });
    el.querySelector('.mo').textContent = mon;
    const c = el.querySelector('.cap');
    c.textContent = cap; c.hidden = !o.percent;
    el.querySelector('.dm').textContent = `${now.getDate()} ${mon}` + (o.percent ? ` · ${cap}` : '');
    U.setRing(el.querySelector('.ring'), pct);
    U.countTo(el.querySelector('.n'), now.getDate(), ctx.motion);
    U.fit(el);
  }
});
})();
