/* BearWall startup animation: a streak of light runs once around each section's border, then the widgets load in.
 * BearWallIntro.play(stageEl, motion) -> Promise (resolves when done or cancelled); BearWallIntro.cancel() stops it and cleans up.
 * Widgets are held hidden with a data attribute on the stage (not a class: wall.js rewrites the stage's className),
 * and widgets are looked up only when they load in, so a stage rebuild mid-intro still ends with everything visible. */
(function () {
  const CSS = `
[data-bw-intro="hold"] .widget { opacity: 0 !important; }
.bw-intro-streak { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; overflow: visible; }
.bw-intro-streak rect { fill: none; stroke: #bff4ff; stroke-width: 3; stroke-linecap: round; }
.bw-intro-streak.glow { filter: drop-shadow(0 0 6px rgba(120, 220, 255, .6)); }`;
  // per motion level: streak (ms), gap between sections, widget fade (ms), gap between widgets, scale-up, stepped streak
  const T = {
    full: { streak: 1100, sec: 150, fade: 450, wid: 75, scale: true, glow: true },
    lite: { streak: 1000, sec: 150, fade: 350, wid: 75, scale: true, steps: 'steps(12, end)' },
    calm: { streak: 0, sec: 0, fade: 600, wid: 60 }
  };
  let run = null;   // { stage, timers, anims, nodes, done }

  // reading order: rows (an eighth of the stage tall), then left to right
  function order(els, stage) {
    const row = stage.getBoundingClientRect().height / 8 || 1;
    return els.map(el => ({ el, r: el.getBoundingClientRect() }))
      .sort((a, b) => Math.round(a.r.top / row) - Math.round(b.r.top / row) || a.r.left - b.r.left).map(o => o.el);
  }
  function later(ms, fn) { run.timers.push(setTimeout(fn, ms)); }

  function streak(sec, t) {
    const w = sec.offsetWidth, h = sec.offsetHeight;
    if (!w || !h) return;
    const P = 2 * (w + h - 4), seg = Math.min(P * .18, 260);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'bw-intro-streak' + (t.glow ? ' glow' : ''));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" stroke-dasharray="${seg} ${P}"/>`;
    sec.appendChild(svg);   // inside the section, so it bends with the section's warp
    run.nodes.push(svg);
    run.anims.push(svg.firstChild.animate([{ strokeDashoffset: seg }, { strokeDashoffset: seg - P }],
      { duration: t.streak, easing: t.steps || 'cubic-bezier(.45, 0, .3, 1)' }));
    run.anims.push(svg.animate([{ opacity: 0 }, { opacity: 1, offset: .08 }, { opacity: 1, offset: .8 }, { opacity: 0 }],
      { duration: t.streak, fill: 'forwards' }));
    later(t.streak, () => svg.remove());
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

  function play(stage, motion) {
    cleanup();
    const t = T[motion];
    const sections = stage ? order([...stage.querySelectorAll('.section')], stage) : [];
    if (!t || !sections.length) return Promise.resolve();
    if (!document.getElementById('bw-intro-css')) {
      const s = document.createElement('style');
      s.id = 'bw-intro-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }
    return new Promise(done => {
      run = { stage, timers: [], anims: [], nodes: [], done };
      stage.setAttribute('data-bw-intro', 'hold');
      // the whole streak phase stays under ~1.8 s however many sections there are
      const gap = t.streak ? Math.min(t.sec, 700 / Math.max(1, sections.length - 1)) : 0;
      if (t.streak) sections.forEach((sec, i) => later(i * gap, () => streak(sec, t)));
      const reveal = t.streak ? (sections.length - 1) * gap + t.streak - 150 : 0;   // widgets start as the last streak fades
      later(reveal, () => {
        const widgets = order([...stage.querySelectorAll('.widget')], stage);
        const wgap = Math.min(t.wid, 900 / Math.max(1, widgets.length));
        const from = t.scale ? { opacity: 0, transform: 'scale(.94)' } : { opacity: 0 };
        const to = t.scale ? { opacity: 1, transform: 'scale(1)' } : { opacity: 1 };
        // fill 'backwards' holds each widget hidden until its turn, so the stage-wide hold can go now
        widgets.forEach((el, i) => run.anims.push(el.animate([from, to], { duration: t.fade, delay: i * wgap, easing: 'cubic-bezier(.2, .7, .2, 1)', fill: 'backwards' })));
        stage.removeAttribute('data-bw-intro');
        later((widgets.length - 1) * wgap + t.fade + 20, cleanup);
      });
    });
  }

  window.BearWallIntro = { play, cancel: cleanup };
})();
