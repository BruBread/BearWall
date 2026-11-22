// Alerts · Walang Pasok: a red banner when a news headline says classes are suspended for a school or city you watch.
// Your keywords are saved only in your browser (this repo is public, so none are written here).
// Real headlines need the Phase 1 projector server: news RSS feeds can't be read from a web page (no CORS).
(function () {
const SUSPEND = ['walang pasok', 'class suspension', 'suspend classes', 'classes suspended', 'suspension of classes', 'no classes'];
const FEEDS = ['https://newsinfo.inquirer.net/feed', 'https://www.rappler.com/feed/'];
const keywordsOf = s => String(s || '').split(',').map(k => k.trim()).filter(Boolean);

// first headline that mentions a suspension AND one of the keywords -> { headline, keyword }, else null
function match(headlines, keywords) {
  for (const h of headlines || []) {
    const l = String(h).toLowerCase();
    if (!SUSPEND.some(p => l.includes(p))) continue;
    const k = keywords.find(k => l.includes(k.toLowerCase()));
    if (k) return { headline: h, keyword: k };
  }
  return null;
}
console.assert(
  match(['Classes suspended in Springfield due to rain'], ['Springfield'])?.keyword === 'Springfield'
  && match(['Springfield wins the fair'], ['Springfield']) === null
  && match(['WALANG PASOK: all levels in springfield'], ['Springfield'])?.keyword === 'Springfield'
  && match(['Class suspension in another town'], ['Springfield']) === null
  && match(['no classes today'], []) === null, 'walang pasok matching');

// headlines from the news, once the projector server can fetch feeds for us (BearWall.proxy, Phase 1)
let headlines = [];
const heard = new Set();   // headlines already sounded, however many widgets show them
async function poll() {
  if (!BearWall.proxy) return;
  const all = [];
  for (const url of FEEDS) {
    try {
      const doc = new DOMParser().parseFromString(await BearWall.proxy(url), 'text/xml');
      all.push(...Array.from(doc.querySelectorAll('item > title'), t => t.textContent));
    } catch (e) {}
  }
  headlines = all;
}
poll(); setInterval(poll, 15 * 60e3);

const base = BearWall.alertModule('pasok', 'alerts-pasok', 'Walang Pasok', 'Walang Pasok', {
  icon: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 15l15-7 15 7-15 7zM11 18v8c4 4 14 4 18 0v-8"/></svg>',
  idle: ctx => { const k = keywordsOf(ctx.opts.keywords); return { title: 'Classes on', detail: k.length ? `No suspension news · watching ${k.join(', ')}` : 'Add a school or city to watch' }; }
});
BearWall.register(Object.assign({}, base, {
  options: [
    { key: 'keywords', label: 'School or city to watch (commas)', type: 'text', value: '' },
    { key: 'sample', label: 'Show a sample headline', type: 'switch', value: false }
  ],
  every: 60000,
  css: `.w-alerts-pasok .lv-ok .u { display: none; }
    .w-alerts-pasok .u { color: var(--w-dim); font-size: calc(var(--u) * 4.5 * var(--fit, 1)); margin-top: calc(var(--u) * 1.5); opacity: .8; }
    .w-alerts-pasok.rect .u { font-size: calc(var(--u) * 11 * var(--fit, 1)); margin-top: calc(var(--u) * 2); }`,
  mount(el, ctx) {
    base.mount(el, ctx);
    el.querySelector('.tx').insertAdjacentHTML('beforeend', '<div class="u fit">unofficial · from news</div>');
  },
  update(el, ctx) {
    let keywords = keywordsOf(ctx.opts.keywords);
    if (ctx.opts.sample && !keywords.length) keywords = ['your school'];
    const m = match(ctx.opts.sample ? [`Classes suspended in ${keywords[0]} due to heavy rain`] : headlines, keywords);
    if (m && !heard.has(m.headline)) { heard.add(m.headline); BearWall.sound('pasok'); BearWall.say('pasok'); }
    const alerts = m ? [{ id: 'pasok', kind: 'pasok', level: 'critical', title: `Walang pasok · ${m.keyword}`, detail: m.headline, since: new Date() }] : [];
    base.update(el, Object.assign({}, ctx, { alerts }));
  }
}));
})();
