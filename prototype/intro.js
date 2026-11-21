/* BearWall startup (and wake) sequence:
 *   1. power trace: a pulse at the wall's centre sends a line of light out to each section's nearest corner
 *   2. lock-on: as the line arrives, corner brackets snap onto the section, its border draws, and "NAME · ONLINE" types out
 *   3. scan-print: that section's widgets are printed in top to bottom behind a bright scan line
 * BearWallIntro.play(stageEl, motion, { corners }) -> Promise (resolves when done or cancelled); BearWallIntro.cancel() cleans up.
 * corners(sectionEl) -> its 4 rendered corners [TL, TR, BL, BR] in stage px (wall.js knows the warp); without it the box is used.
 * Widgets are held hidden with a data attribute on the stage (wall.js rewrites the stage's className), and are looked up
 * only when they start printing, so a stage rebuild mid-intro still ends with everything visible.
 * Only transforms, opacity, clip-path and stroke dashes animate; glows are a wide faint stroke, never a filter (weak GPU). */
(function () {
  const CSS = `
[data-bw-intro="hold"] .widget { opacity: 0 !important; }
.bw-i { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; overflow: visible; }
.bw-i .glow { fill: none; stroke: rgba(120, 220, 255, .28); stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
.bw-i .core { fill: none; stroke: #bff4ff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.bw-i .flash { fill: rgba(191, 244, 255, .12); stroke: none; }
.bw-i text { fill: #bff4ff; font: 700 11px ui-monospace, Consolas, monospace; letter-spacing: .12em; }
.bw-i-scan { position: absolute; left: -2%; width: 104%; height: 2px; top: 0; background: #bff4ff; box-shadow: 0 0 8px 2px rgba(120, 220, 255, .55); pointer-events: none; z-index: 6; }`;
  // per motion level (ms): trace, gap between sections, lock-on, border, widget print, gap between widgets
  const T = {
    full: { trace: 480, sec: 110, lock: 340, border: 420, print: 460, wid: 70, scan: true },
    lite: { trace: 420, sec: 110, lock: 300, border: 360, print: 400, wid: 70, steps: 'steps(10, end)' },
    calm: { fade: 600, wid: 60 }
  };
  const NS = 'http://www.w3.org/2000/svg';
  let run = null;   // { stage, timers, anims, nodes, done }

  const later = (ms, fn) => run.timers.push(setTimeout(fn, ms));
  const anim = (el, frames, opts) => { const a = el.animate(frames, opts); run.anims.push(a); return a; };
  function svgIn(parent, w, h) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'bw-i');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    parent.appendChild(svg);
    run.nodes.push(svg);
    return svg;
  }
  // a path drawn twice: a wide faint glow under a thin bright core
  function line(svg, d) {
    const g = document.createElementNS(NS, 'g');
    g.innerHTML = `<path class="glow" d="${d}"/><path class="core" d="${d}"/>`;
    svg.appendChild(g);
    return g;
  }
  // draw a path on with stroke dashes
  function draw(g, len, ms, delay, easing) {
    g.querySelectorAll('path').forEach(p => {
      p.style.strokeDasharray = `${len} ${len}`;
      p.style.strokeDashoffset = len;
      anim(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: ms, delay, easing, fill: 'forwards' });
    });
  }
  // reading order: rows (an eighth of the parent tall), then left to right
  function order(els, h) {
    const row = h / 8 || 1;
    return els.map(el => ({ el, r: el.getBoundingClientRect() }))
      .sort((a, b) => Math.round(a.r.top / row) - Math.round(b.r.top / row) || a.r.left - b.r.left).map(o => o.el);
  }

  // phase 2 for one section: brackets snap on, border draws, flash, name types out
  function lockOn(sec, t) {
    const w = sec.offsetWidth, h = sec.offsetHeight;
    if (!w || !h) return;
    const svg = svgIn(sec, w, h), b = Math.max(10, Math.min(40, Math.min(w, h) * .14)), d = b * 1.4, ease = t.steps || 'cubic-bezier(.3, 1.5, .5, 1)';
    const flash = document.createElementNS(NS, 'rect');
    Object.entries({ class: 'flash', x: 0, y: 0, width: w, height: h }).forEach(([k, v]) => flash.setAttribute(k, v));
    svg.appendChild(flash);
    anim(flash, [{ opacity: 0 }, { opacity: 1, offset: .25 }, { opacity: 0 }], { duration: t.lock + t.border, fill: 'forwards' });
    const i = 1.5;   // keep the strokes inside the section
    [[`M${i} ${b} V${i} H${b}`, -d, -d], [`M${w - b} ${i} H${w - i} V${b}`, d, -d],
     [`M${i} ${h - b} V${h - i} H${b}`, -d, d], [`M${w - b} ${h - i} H${w - i} V${h - b}`, d, d]].forEach(([p, dx, dy]) => {
      anim(line(svg, p), [{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }, { transform: 'translate(0, 0)', opacity: 1 }],
        { duration: t.lock, easing: ease, fill: 'forwards' });
    });
    const P = 2 * (w + h);
    draw(line(svg, `M${i} ${i} H${w - i} V${h - i} H${i} Z`), P, t.border, t.lock * .6, t.steps || 'cubic-bezier(.5, 0, .3, 1)');
    const name = (sec.dataset.label || '').split(' · ')[0].toUpperCase();
    if (name && w > 90 && h > 40) {
      const text = document.createElementNS(NS, 'text'), full = name + ' · ONLINE';
      text.setAttribute('x', b + 6); text.setAttribute('y', i + 14);
      svg.appendChild(text);
      for (let k = 1; k <= full.length; k++) later(t.lock * .7 + k * 22, () => { text.textContent = full.slice(0, k); });
    }
    return svg;
  }

  // phase 3 for one widget: printed top to bottom behind a scan line
  function print(el, t, delay) {
    anim(el, [{ clipPath: 'inset(0 0 100% 0)', opacity: .35 }, { clipPath: 'inset(0 0 0% 0)', opacity: 1 }],
      { duration: t.print, delay, easing: t.steps || 'cubic-bezier(.4, 0, .4, 1)', fill: 'backwards' });
    if (!t.scan) return;
    const s = document.createElement('div');
    s.className = 'bw-i-scan';
    el.appendChild(s);
    run.nodes.push(s);
    anim(s, [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${el.offsetHeight}px)`, opacity: 1, offset: .92 }, { transform: `translateY(${el.offsetHeight}px)`, opacity: 0 }],
      { duration: t.print, delay, easing: 'cubic-bezier(.4, 0, .4, 1)', fill: 'both' });
    later(delay + t.print + 30, () => s.remove());
  }

  function cleanup() {
    if (!run) return;
    const r = run; run = null;
    r.timers.forEach(clearTimeout);
    r.anims.forEach(a => a.cancel());
    r.nodes.forEach(n => n.remove());
    if (r.stage.getAttribute('data-bw-intro') === 'hold') r.stage.removeAttribute('data-bw-intro');
    r.done();
  }

  function play(stage, motion, opts) {
    cleanup();
    const t = T[motion], sections = stage ? [...stage.querySelectorAll('.section')] : [];
    if (!t || !sections.length) return Promise.resolve();
    if (!document.getElementById('bw-intro-css')) {
      const s = document.createElement('style');
      s.id = 'bw-intro-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }
    return new Promise(done => {
      run = { stage, timers: [], anims: [], nodes: [], done };
      stage.setAttribute('data-bw-intro', 'hold');
      if (t.fade) {   // calm: a gentle fade, nothing else
        const widgets = order([...stage.querySelectorAll('.widget')], stage.clientHeight), gap = Math.min(t.wid, 900 / Math.max(1, widgets.length));
        widgets.forEach((el, i) => anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: t.fade, delay: i * gap, fill: 'backwards' }));
        stage.removeAttribute('data-bw-intro');
        later((widgets.length - 1) * gap + t.fade + 20, cleanup);
        return;
      }
      const W = stage.clientWidth, H = stage.clientHeight, C = [W / 2, H / 2];
      const sr = stage.getBoundingClientRect();
      const cornersOf = sec => (opts && opts.corners && opts.corners(sec)) || (r => [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]
        .map(([x, y]) => [x - sr.left, y - sr.top]))(sec.getBoundingClientRect());
      // each section's nearest corner to the centre; nearer sections light first
      const plan = sections.map(sec => {
        const near = cornersOf(sec).reduce((a, p) => Math.hypot(p[0] - C[0], p[1] - C[1]) < Math.hypot(a[0] - C[0], a[1] - C[1]) ? p : a);
        return { sec, near, dist: Math.hypot(near[0] - C[0], near[1] - C[1]) };
      }).sort((a, b) => a.dist - b.dist);
      const gap = Math.min(t.sec, 500 / Math.max(1, plan.length - 1));

      // phase 1: centre pulse and power traces (one stage-wide overlay)
      const wall = svgIn(stage, W, H);
      const dot = document.createElementNS(NS, 'circle');
      Object.entries({ cx: C[0], cy: C[1], r: 10, class: 'core' }).forEach(([k, v]) => dot.setAttribute(k, v));
      wall.appendChild(dot);
      anim(dot, [{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 520, easing: 'ease-out', fill: 'forwards' });
      dot.style.transformOrigin = `${C[0]}px ${C[1]}px`;
      plan.forEach((p, i) => {
        p.at = i * gap + t.trace;   // when the trace reaches the section
        const [x, y] = p.near, len = Math.abs(x - C[0]) + Math.abs(y - C[1]) || 1;
        draw(line(wall, `M${C[0]} ${C[1]} H${x} V${y}`), len, t.trace, i * gap, t.steps || 'cubic-bezier(.55, 0, .45, 1)');
        later(p.at, () => { p.svg = lockOn(p.sec, t); });
      });

      // phase 3: each section's widgets print once it has locked on
      const firstPrint = plan[0].at + t.lock * .8;
      later(firstPrint, () => {
        const start = {};
        plan.forEach(p => { start[p.sec.dataset.sid] = p.at + t.lock * .8 - firstPrint; });
        let end = 0;
        sections.forEach(sec => {
          const ws = order([...sec.querySelectorAll('.widget')], sec.offsetHeight), s0 = start[sec.dataset.sid] || 0;
          const wg = Math.min(t.wid, 600 / Math.max(1, ws.length));
          ws.forEach((el, k) => { print(el, t, s0 + k * wg); end = Math.max(end, s0 + k * wg + t.print); });
        });
        stage.removeAttribute('data-bw-intro');   // fill 'backwards' keeps each widget hidden until its turn
        end = Math.max(end, plan[plan.length - 1].at + t.lock + t.border - firstPrint);
        // fade the light work out, then leave the DOM exactly as it was
        later(end, () => run.nodes.filter(n => n.tagName === 'svg').forEach(n => anim(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 320, fill: 'forwards' })));
        later(end + 340, cleanup);
      });
    });
  }

  window.BearWallIntro = { play, cancel: cleanup };
})();
