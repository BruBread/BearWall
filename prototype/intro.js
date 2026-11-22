/* BearWall startup (and wake) sequence:
 *   1. power trace: a pulse at the wall's centre sends a line of light out to each section's nearest corner
 *   2. lock-on: as the line arrives, corner brackets snap onto the section, its border draws, and "NAME · ONLINE" types out
 *   3. scan-print: that section's widgets are printed in top to bottom behind a bright scan line
 * BearWallIntro.play(stageEl, motion, { corners }) -> Promise (resolves when done or cancelled); BearWallIntro.cancel() cleans up.
 * corners(sectionEl) -> its 4 rendered corners [TL, TR, BL, BR] in stage px (wall.js knows the warp); without it the box is used.
 * Widgets are held hidden with a data attribute on the stage (wall.js rewrites the stage's className), and are looked up
 * only when they start printing, so a stage rebuild mid-intro still ends with everything visible.
 * The projector's GPU is weak and its CPU slow, so every effect is a plain element that only moves, scales or fades
 * (the compositor runs those without repainting): lines grow with scaleX/scaleY from their start, glows are a static
 * box-shadow, and a widget is "printed" by a black cover shrinking off it. No SVG strokes, clip-path or filters.
 * It also waits for fonts, two frames and an idle moment (at most 1.5 s) so it doesn't fight the wall's own start-up. */
(function () {
  const CSS = `
[data-bw-intro="hold"] .widget { opacity: 0 !important; }
.bw-o { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; }
.bw-l { position: absolute; background: #bff4ff; box-shadow: 0 0 6px 1px rgba(120, 220, 255, .6); }
.bw-dot { position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; border: 2px solid #bff4ff; box-shadow: 0 0 8px rgba(120, 220, 255, .6); }
.bw-flash { position: absolute; left: 0; top: 0; width: 100%; height: 100%; background: rgba(191, 244, 255, .12); }
.bw-br { position: absolute; }
.bw-tag { position: absolute; top: 5px; color: #bff4ff; font: 700 11px ui-monospace, Consolas, monospace; letter-spacing: .12em; white-space: nowrap; }
.bw-cover { position: absolute; left: 0; top: 0; width: 100%; height: 100%; background: #000; z-index: 5; pointer-events: none; transform-origin: bottom; }
.bw-blinds { position: absolute; inset: 0; z-index: 9; pointer-events: none; display: flex; flex-direction: column; }
.bw-blinds i { flex: 1; background: linear-gradient(#000 0 80%, rgba(191, 244, 255, .16) 90%, #000); }
.bw-upd { position: absolute; inset: 0; z-index: 10; background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5em;
  color: #bff4ff; font-family: ui-monospace, Consolas, monospace; text-align: center; pointer-events: none; }
.bw-upd svg { width: 3.4em; height: 3.4em; margin-bottom: .4em; animation: bwSpin 1.1s linear infinite; }
.bw-upd circle { fill: none; stroke-width: 2.5; }
.bw-upd .tr { stroke: rgba(120, 220, 255, .18); }
.bw-upd .arc { stroke: #bff4ff; stroke-linecap: round; stroke-dasharray: 26 101; }
.bw-upd b { font-size: 1em; letter-spacing: .18em; }
.bw-upd .st { font-size: .8em; color: #e8fbff; }
.bw-upd small { font-size: .6em; opacity: .55; letter-spacing: .06em; }
@keyframes bwSpin { to { transform: rotate(360deg); } }
.bw-i-scan { position: absolute; left: -2%; width: 104%; height: 2px; top: 0; background: #bff4ff; box-shadow: 0 0 8px 2px rgba(120, 220, 255, .55); pointer-events: none; z-index: 6; }`;
  // per motion level (ms): trace, gap between sections, lock-on, border, widget print, gap between widgets
  const T = {
    full: { trace: 480, sec: 110, lock: 340, border: 420, print: 460, wid: 70, scan: true },
    lite: { trace: 420, sec: 110, lock: 300, border: 360, print: 400, wid: 70, steps: 'steps(10, end)' },
    calm: { fade: 600, wid: 60 }
  };
  let run = null;   // the intro: { stage, timers, anims, nodes, done }
  let cur = null;   // whichever run the helpers below record into (the intro or the update screen)

  const later = (ms, fn) => cur.timers.push(setTimeout(fn, ms));
  const snd = id => window.BearWallSound && BearWallSound.play(id);   // sound.js (Phase 2)
  const anim = (el, frames, opts) => { const a = el.animate(frames, opts); cur.anims.push(a); return a; };
  function div(parent, cls, css) {
    const d = document.createElement('div');
    d.className = cls;
    if (css) Object.assign(d.style, css);
    parent.appendChild(d);
    return d;
  }
  // an overlay box for lines (removed with the run)
  function overlay(parent) { const o = div(parent, 'bw-o'); cur.nodes.push(o); return o; }
  // a straight line from (x1,y1) to (x2,y2), horizontal or vertical, that can grow from its start
  function seg(parent, x1, y1, x2, y2) {
    const h = y1 === y2, w = 2;
    const l = div(parent, 'bw-l', h
      ? { left: Math.min(x1, x2) + 'px', top: y1 - w / 2 + 'px', width: Math.abs(x2 - x1) + 'px', height: w + 'px', transformOrigin: x2 >= x1 ? 'left' : 'right' }
      : { left: x1 - w / 2 + 'px', top: Math.min(y1, y2) + 'px', width: w + 'px', height: Math.abs(y2 - y1) + 'px', transformOrigin: y2 >= y1 ? 'top' : 'bottom' });
    l._s = h ? 'scaleX' : 'scaleY';
    return l;
  }
  const grow = (l, ms, delay, easing, back) => anim(l, back ? [{ transform: l._s + '(1)' }, { transform: l._s + '(0)' }] : [{ transform: l._s + '(0)' }, { transform: l._s + '(1)' }],
    { duration: Math.max(1, ms), delay, easing, fill: 'both' });
  // reading order: rows (an eighth of the parent tall), then left to right
  function order(els, h) {
    const row = h / 8 || 1;
    return els.map(el => ({ el, r: el.getBoundingClientRect() }))
      .sort((a, b) => Math.round(a.r.top / row) - Math.round(b.r.top / row) || a.r.left - b.r.left).map(o => o.el);
  }
  const nearest = (cs, C) => cs.reduce((a, p) => Math.hypot(p[0] - C[0], p[1] - C[1]) < Math.hypot(a[0] - C[0], a[1] - C[1]) ? p : a);
  function cornersFn(stage, opts) {
    const sr = stage.getBoundingClientRect();
    return sec => (opts && opts.corners && opts.corners(sec)) || (r => [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]
      .map(([x, y]) => [x - sr.left, y - sr.top]))(sec.getBoundingClientRect());
  }
  // centre -> corner as two lines (across, then up or down); returns [across, upDown, lengths]
  function trace(o, C, p) {
    const a = seg(o, C[0], C[1], p[0], C[1]), b = seg(o, p[0], C[1], p[0], p[1]);
    return [a, b, Math.abs(p[0] - C[0]), Math.abs(p[1] - C[1])];
  }
  function pulse(o, C, frames, opts) {
    const d = div(o, 'bw-dot', { left: C[0] + 'px', top: C[1] + 'px' });
    anim(d, frames, opts);
  }

  // phase 2 for one section: brackets snap on, border draws, flash, name types out
  function lockOn(sec, t) {
    const w = sec.offsetWidth, h = sec.offsetHeight;
    if (!w || !h) return;
    const o = overlay(sec), b = Math.max(10, Math.min(40, Math.min(w, h) * .14)), d = b * 1.4, ease = t.steps || 'cubic-bezier(.3, 1.5, .5, 1)';
    anim(div(o, 'bw-flash'), [{ opacity: 0 }, { opacity: 1, offset: .25 }, { opacity: 0 }], { duration: t.lock + t.border, fill: 'forwards' });
    const i = 1;   // keep the lines inside the section
    // each bracket: a box at its corner holding two short lines, sliding in from outside
    [[0, 0, -d, -d], [w - b, 0, d, -d], [0, h - b, -d, d], [w - b, h - b, d, d]].forEach(([x, y, dx, dy], k) => {
      const br = div(o, 'bw-br', { left: x + 'px', top: y + 'px', width: b + 'px', height: b + 'px' });
      const left = k % 2 === 0, top = k < 2;
      seg(br, 0, top ? i : b - i, b, top ? i : b - i);
      seg(br, left ? i : b - i, 0, left ? i : b - i, b);
      anim(br, [{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }, { transform: 'translate(0, 0)', opacity: 1 }], { duration: t.lock, easing: ease, fill: 'both' });
    });
    // the border draws once around, clockwise from the top-left corner
    const edges = [seg(o, 0, i, w, i), seg(o, w - i, 0, w - i, h), seg(o, w, h - i, 0, h - i), seg(o, i, h, i, 0)], lens = [w, h, w, h], P = 2 * (w + h);
    let at = t.lock * .6;
    edges.forEach((e, k) => { const ms = t.border * lens[k] / P; grow(e, ms, at, t.steps || 'linear'); at += ms; });
    const name = (sec.dataset.label || '').split(' · ')[0].toUpperCase();
    if (name && w > 90 && h > 40) {
      const tag = div(o, 'bw-tag', { left: b + 6 + 'px' }), full = name + ' · ONLINE';
      for (let k = 1; k <= full.length; k++) later(t.lock * .7 + k * 22, () => { tag.textContent = full.slice(0, k); if (k % 3 === 1) snd('intro-tick'); });
    }
  }

  // phase 3 for one widget: printed top to bottom: a black cover shrinks down off it, with the scan line on its edge
  function print(el, t, delay) {
    const h = el.offsetHeight, c = div(el, 'bw-cover');
    cur.nodes.push(c);
    anim(c, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], { duration: t.print, delay, easing: t.steps || 'cubic-bezier(.4, 0, .4, 1)', fill: 'both' });
    anim(el, [{ opacity: .35 }, { opacity: 1 }], { duration: t.print, delay, fill: 'backwards' });
    if (!t.scan) return;
    const s = div(el, 'bw-i-scan');
    cur.nodes.push(s);
    anim(s, [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${h}px)`, opacity: 1, offset: .92 }, { transform: `translateY(${h}px)`, opacity: 0 }],
      { duration: t.print, delay, easing: 'cubic-bezier(.4, 0, .4, 1)', fill: 'both' });
  }

  function cleanup() {
    if (!run) return;
    const r = run; run = null;
    if (cur === r) cur = null;
    r.timers.forEach(clearTimeout);
    r.anims.forEach(a => a.cancel());
    r.nodes.forEach(n => n.remove());
    if (r.stage.getAttribute('data-bw-intro') === 'hold') r.stage.removeAttribute('data-bw-intro');
    r.done();
  }

  // resolves once the wall has settled: fonts loaded, two frames drawn, and an idle moment (at most 1.5 s)
  function settled() {
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    const frames = new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Promise.all([fonts, frames]).then(() => new Promise(r => window.requestIdleCallback ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 50)));
  }

  function play(stage, motion, opts) {
    cleanup(); endPower();   // waking up after a power-down: the dark stage comes back
    const t = T[motion], sections = stage ? [...stage.querySelectorAll('.section:not(.win-off)')] : [];
    if (!t || !sections.length) return Promise.resolve();
    css();
    return new Promise(done => {
      const r = cur = run = { stage, timers: [], anims: [], nodes: [], done };
      stage.setAttribute('data-bw-intro', 'hold');   // hidden right away; the show starts once the wall has settled
      settled().then(() => { if (run === r) { cur = r; start(stage, t, opts); } });
    });
  }

  function start(stage, t, opts) {
    const sections = [...stage.querySelectorAll('.section:not(.win-off)')];
    if (t.fade) {   // calm: a gentle fade, nothing else
      const widgets = order([...stage.querySelectorAll('.widget')], stage.clientHeight), gap = Math.min(t.wid, 900 / Math.max(1, widgets.length));
      snd('intro-hum'); later(Math.max(0, widgets.length - 1) * gap + t.fade * .6, () => snd('intro-chord'));
      widgets.forEach((el, i) => anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: t.fade, delay: i * gap, fill: 'backwards' }));
      stage.removeAttribute('data-bw-intro');
      later((widgets.length - 1) * gap + t.fade + 20, cleanup);
      return;
    }
    if (!sections.length) return cleanup();
    const W = stage.clientWidth, H = stage.clientHeight, C = [W / 2, H / 2], cornersOf = cornersFn(stage, opts);
    // each section's nearest corner to the centre; nearer sections light first
    const plan = sections.map(sec => { const near = nearest(cornersOf(sec), C); return { sec, near, dist: Math.hypot(near[0] - C[0], near[1] - C[1]) }; })
      .sort((a, b) => a.dist - b.dist);
    const gap = Math.min(t.sec, 500 / Math.max(1, plan.length - 1));

    // phase 1: centre pulse and power traces (one stage-wide overlay of plain lines)
    const wall = overlay(stage);
    snd('intro-hum');
    pulse(wall, C, [{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 520, easing: 'ease-out', fill: 'forwards' });
    plan.forEach((p, i) => {
      p.at = i * gap + t.trace;   // when the trace reaches the section
      const [a, b, la, lb] = trace(wall, C, p.near), split = la + lb ? la / (la + lb) : .5;
      grow(a, t.trace * split, i * gap, t.steps || 'ease-in');
      grow(b, t.trace * (1 - split), i * gap + t.trace * split, t.steps || 'ease-out');
      later(i * gap, () => snd('intro-zip'));
      later(p.at, () => { snd('intro-clunk'); lockOn(p.sec, t); });
    });

    // phase 3: each section's widgets print once it has locked on
    const firstPrint = plan[0].at + t.lock * .8;
    later(firstPrint, () => {
      const begin = {};
      plan.forEach(p => { begin[p.sec.dataset.sid] = p.at + t.lock * .8 - firstPrint; });
      let end = 0;
      [...stage.querySelectorAll('.section')].forEach(sec => {
        const ws = order([...sec.querySelectorAll('.widget')], sec.offsetHeight), s0 = begin[sec.dataset.sid] || 0;
        const wg = Math.min(t.wid, 600 / Math.max(1, ws.length));
        ws.forEach((el, k) => { print(el, t, s0 + k * wg); later(s0 + k * wg, () => snd('intro-tick')); end = Math.max(end, s0 + k * wg + t.print); });
      });
      stage.removeAttribute('data-bw-intro');   // each widget's cover now hides it until its turn
      end = Math.max(end, plan[plan.length - 1].at + t.lock + t.border - firstPrint);
      // fade the light work out, then leave the DOM exactly as it was
      later(end - 200, () => snd('intro-chord'));
      later(end, () => run && run.nodes.filter(n => n.className === 'bw-o').forEach(n => anim(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 320, fill: 'forwards' })));
      later(end + 340, cleanup);
    });
  }

  /* ---------- Window mode: venetian blinds close over the sections, the scene swaps, the blinds open ---------- */
  const BL = { full: { n: 9, close: 300, open: 520, gap: 30 }, lite: { n: 7, close: 280, open: 440, gap: 30, steps: 'steps(6, end)' } };
  let blindsRun = null;   // { timers, anims, nodes, flip, flipped, done }
  function endBlinds() {
    if (!blindsRun) return;
    const b = blindsRun; blindsRun = null;
    b.timers.forEach(clearTimeout); b.anims.forEach(a => a.cancel()); b.nodes.forEach(n => n.remove());
    if (!b.flipped) b.flip();   // never leave the toggle half done
    b.done();
  }
  // Blinds close over the sections in sids, flip() swaps the scene, then they open over openSids (default: the same).
  // A closed section left out of openSids stays as flip() leaves it (Window mode switches it off).
  // flip() may rebuild the sections, so the slats are found again by section id after it.
  function blinds(stage, sids, flip, motion, openSids) {
    endBlinds();
    const t = BL[motion], reopen = openSids || sids;
    if (!t || !stage || !sids.length) { flip(); return Promise.resolve(); }
    css();
    return new Promise(done => {
      const b = blindsRun = { timers: [], anims: [], nodes: [], flip, flipped: false, done };
      const secs = ids => [...stage.querySelectorAll('.section')].filter(e => ids.indexOf(e.dataset.sid) >= 0);
      const put = closing => secs(closing ? sids : reopen).forEach(sec => {
        const box = document.createElement('div');
        box.className = 'bw-blinds';
        box.innerHTML = '<i></i>'.repeat(t.n);
        sec.appendChild(box);
        b.nodes.push(box);
        [...box.children].forEach((sl, k) => b.anims.push(sl.animate(
          closing ? [{ transform: 'scaleY(.04)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }] : [{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(.04)', opacity: 0 }],
          { duration: closing ? t.close : t.open, delay: k * t.gap, easing: t.steps || 'cubic-bezier(.5, 0, .3, 1)', fill: 'both' })));
      });
      put(true); snd('blinds-close');
      b.timers.push(setTimeout(() => {
        b.anims.forEach(a => a.cancel()); b.anims = [];
        b.nodes.forEach(n => n.remove()); b.nodes = [];
        b.flipped = true; flip();
        put(false); snd('blinds-open');
        b.timers.push(setTimeout(endBlinds, t.open + (t.n - 1) * t.gap + 30));
      }, t.close + (t.n - 1) * t.gap + 80));
    });
  }

  /* ---------- update: the intro in reverse, then an "Updating" screen on the first section ---------- */
  let up = null;   // { stage, timers, anims, nodes, text, screen }
  function endUpdate() {
    if (!up) return;
    const u = up; up = null;
    if (cur === u) cur = null;
    u.timers.forEach(clearTimeout); u.anims.forEach(a => a.cancel()); u.nodes.forEach(n => n.remove());
  }
  function screen(u, parent) {
    const w = parent.offsetWidth || 400, h = parent.offsetHeight || 300, k = Math.max(8, Math.min(26, Math.min(w, h) * .075));
    const el = document.createElement('div');
    el.className = 'bw-upd';
    el.style.fontSize = k + 'px';
    el.innerHTML = '<svg viewBox="0 0 40 40"><circle class="tr" cx="20" cy="20" r="16"/><circle class="arc" cx="20" cy="20" r="16"/></svg>'
      + '<b>UPDATING BEARWALL</b><span class="st"></span><small>Keep the projector plugged in</small>';
    el.querySelector('.st').textContent = u.text;
    parent.appendChild(el);
    u.nodes.push(el);
    u.screen = el;
    anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'backwards' });
  }
  // first call: shut the wall down and show the screen; later calls only change the stage text
  function updating(stage, text, motion, opts) {
    if (up) { up.text = text; if (up.screen) up.screen.querySelector('.st').textContent = text; return; }
    cleanup(); endBlinds();
    if (!stage) return;
    css();
    const u = cur = up = { stage, timers: [], anims: [], nodes: [], text, screen: null };
    snd('power-down');
    const first = stage.querySelector('.section');
    const t = T[motion] && !T[motion].fade ? T[motion] : null;
    if (!t) {   // calm / off: no show, just the screen
      const sections = [...stage.querySelectorAll('.section')], first = sections[0];
      sections.slice(1).forEach(sec => anim(sec, [{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: 'forwards' }));
      stage.querySelectorAll('.widget').forEach(w => anim(w, [{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: 'forwards' }));
      return screen(u, first || stage);
    }
    const t1 = reverse(stage, opts, true);
    // 4. the "Updating" screen on the first section (or the middle of the wall with no sections)
    later(t1 + 1000, () => screen(u, first || stage));
  }

  // The intro in reverse (update screen and POWER): widgets un-print bottom up, section borders flicker out and the sections
  // go dark (all but the first when keepFirst), the power traces pull back into the centre and wink out.
  // Records into `cur`; returns when the borders start (the traces take ~1 s after that).
  function reverse(stage, opts, keepFirst) {
    const sections = [...stage.querySelectorAll('.section')];
    // 1. widgets un-print, bottom up, last first: a black cover grows up over each
    const widgets = order([...stage.querySelectorAll('.widget')], stage.clientHeight).reverse();
    const wg = Math.min(45, 600 / Math.max(1, widgets.length));
    widgets.forEach((el, k) => {
      const c = div(el, 'bw-cover');
      cur.nodes.push(c);
      anim(c, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 380, delay: k * wg, easing: 'cubic-bezier(.6, 0, .6, 1)', fill: 'both' });
      anim(el, [{ opacity: 1 }, { opacity: .3 }], { duration: 380, delay: k * wg, fill: 'forwards' });
    });
    const t1 = widgets.length ? (widgets.length - 1) * wg + 380 : 0;
    // 2. borders flicker out; every section but the first goes dark
    later(t1, () => sections.forEach((sec, k) => {
      const w = sec.offsetWidth, h = sec.offsetHeight;
      if (!w || !h) return;
      const o = overlay(sec);
      seg(o, 0, 1, w, 1); seg(o, w - 1, 0, w - 1, h); seg(o, 0, h - 1, w, h - 1); seg(o, 1, 0, 1, h);
      anim(o, [{ opacity: 1 }, { opacity: .15, offset: .2 }, { opacity: .9, offset: .35 }, { opacity: .1, offset: .55 }, { opacity: .7, offset: .7 }, { opacity: 0 }],
        { duration: 520, fill: 'forwards' });
      if (k > 0 || !keepFirst) anim(sec, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 120, fill: 'forwards' });
    }));
    // 3. power traces pull back into the centre (each line shrinks toward its start, the far end first), which winks out
    later(t1 + 260, () => {
      const W = stage.clientWidth, H = stage.clientHeight, C = [W / 2, H / 2], cornersOf = cornersFn(stage, opts);
      const wall = overlay(stage);
      sections.forEach(sec => {
        const [a, b, la, lb] = trace(wall, C, nearest(cornersOf(sec), C)), split = la + lb ? lb / (la + lb) : .5;
        grow(b, 460 * split, 0, 'ease-in', true);
        grow(a, 460 * (1 - split), 460 * split, 'ease-out', true);
      });
      pulse(wall, C, [{ transform: 'scale(2.2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: .7 }, { transform: 'scale(.1)', opacity: 0 }], { duration: 520, delay: 360, fill: 'both' });
    });
    return t1;
  }

  /* ---------- POWER: the wall powers down (the projector app tells us ~2.5 s before the panel goes dark) ---------- */
  let pd = null;   // { stage, timers, anims, nodes }
  function endPower() {
    if (!pd) return;
    const p = pd; pd = null;
    if (cur === p) cur = null;
    p.timers.forEach(clearTimeout); p.anims.forEach(a => a.cancel()); p.nodes.forEach(n => n.remove());
  }
  // -> Promise that resolves when it's all dark (calm / off: a plain fade)
  function powerDown(stage, motion, opts) {
    cleanup(); endBlinds(); endUpdate(); endPower();
    if (!stage) return Promise.resolve();
    css();
    const p = cur = pd = { stage, timers: [], anims: [], nodes: [] };
    return new Promise(done => {
      const t = T[motion] && !T[motion].fade;
      if (!t) { anim(stage, [{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' }); later(620, done); return; }
      const t1 = reverse(stage, opts, false);
      later(t1 + 1300, () => { if (pd === p) anim(stage, [{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: 'forwards' }); done(); });   // dark until the wake intro
    });
  }

  function css() {
    if (document.getElementById('bw-intro-css')) return;
    const s = document.createElement('style');
    s.id = 'bw-intro-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  window.BearWallIntro = { play, cancel() { cleanup(); endUpdate(); endBlinds(); endPower(); }, blinds, updating, powerDown };
})();
