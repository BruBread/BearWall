/* BearWall Draw: click and draw straight on the wall (control page). Pen, line, arrow, box, circle, text, select, eraser.
 * Each section has one Drawing layer: a hidden widget type ('drawing') that covers its section, so it warps with it,
 * stacks with the widgets in the Layers list, saves with the layout and shows on the projector live.
 * Items live in that widget's opts.items, in the section's own space (wall px):
 *   { t: 'pen', pts: [[x, y], ...] } | { t: 'line'|'arrow'|'rect'|'ellipse', x1, y1, x2, y2, fill } | { t: 'text', x, y, text, size }
 *   plus c (color) and wd (stroke width) on every item. Drawn as SVG: sharp through the warp, tiny to store. */
(function () {
const U = BearWall.util, esc = U.esc;
const R = n => Math.round(n * 10) / 10;

/* ---------- the drawing layer (what the wall shows) ---------- */
function arrowHead(x1, y1, x2, y2, wd) {
  const a = Math.atan2(y2 - y1, x2 - x1), l = 6 + wd * 3, s = .5;
  return `M${R(x2 - l * Math.cos(a - s))} ${R(y2 - l * Math.sin(a - s))}L${R(x2)} ${R(y2)}L${R(x2 - l * Math.cos(a + s))} ${R(y2 - l * Math.sin(a + s))}`;
}
function itemSVG(it, i) {
  const st = `style="color:${esc(it.c)}" stroke="${esc(it.c)}" stroke-width="${it.wd}"`, f = it.fill ? `fill="${esc(it.c)}" fill-opacity=".35"` : 'fill="none"';
  const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2), w = Math.abs(it.x2 - it.x1), h = Math.abs(it.y2 - it.y1);
  const d = `data-i="${i}"`;
  switch (it.t) {
    case 'pen': return `<path ${d} ${st} fill="none" d="M${it.pts.map(p => R(p[0]) + ' ' + R(p[1])).join('L')}"/>`;
    case 'line': return `<path ${d} ${st} fill="none" d="M${R(it.x1)} ${R(it.y1)}L${R(it.x2)} ${R(it.y2)}"/>`;
    case 'arrow': return `<path ${d} ${st} fill="none" d="M${R(it.x1)} ${R(it.y1)}L${R(it.x2)} ${R(it.y2)}${arrowHead(it.x1, it.y1, it.x2, it.y2, it.wd)}"/>`;
    case 'rect': return `<rect ${d} ${st} ${f} x="${R(x)}" y="${R(y)}" width="${R(w)}" height="${R(h)}" rx="${Math.min(8, w / 4, h / 4)}"/>`;
    case 'ellipse': return `<ellipse ${d} ${st} ${f} cx="${R(x + w / 2)}" cy="${R(y + h / 2)}" rx="${R(w / 2)}" ry="${R(h / 2)}"/>`;
    case 'text': return `<text ${d} style="color:${esc(it.c)}" fill="${esc(it.c)}" stroke="none" x="${R(it.x)}" y="${R(it.y)}" font-size="${it.size}">${esc(it.text)}</text>`;
  }
  return '';
}
BearWall.register({
  type: 'drawing', name: 'Drawing', styleName: 'Drawing', hidden: true,   // made by Draw mode, never from the gallery
  size: { square: [480, 320], rect: [480, 160] },
  look: ['glow'],
  options: [],
  css: `
    .w-drawing { overflow: visible; }
    .w-drawing svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; stroke-linecap: round; stroke-linejoin: round; }
    .w-drawing [data-i] { filter: drop-shadow(0 0 calc(var(--glow) * 3px) currentColor); }   /* each shape glows in its own color (Look: glow) */
    .w-drawing text { font-family: var(--mono, monospace); font-weight: 800; dominant-baseline: alphabetic; }
    .w-drawing .dsel { fill: none; stroke: #ff7ac6; stroke-width: 1.5; stroke-dasharray: 5 4; }`,
  mount(el) { el.innerHTML = '<svg aria-hidden="true"></svg>'; },
  update(el, ctx) {
    // the widget box is zoomed to a 264 px short side; the SVG still draws in section px through its viewBox
    const svg = el.firstChild, items = (ctx.opts.items || []), vb = `0 0 ${ctx.w} ${ctx.h}`;
    if (svg.getAttribute('viewBox') !== vb) svg.setAttribute('viewBox', vb);
    const sel = Draw.on && Draw.sel && Draw.sel.w.id === ctx.id ? Draw.sel.i : -1;
    const html = items.map(itemSVG).join('') + (sel >= 0 && items[sel] ? selBox(items[sel]) : '');
    if (svg._h !== html) { svg.innerHTML = html; svg._h = html; }
  }
});

/* ---------- geometry: bounds and hit tests (section px) ---------- */
function bounds(it) {
  if (it.t === 'pen') { const xs = it.pts.map(p => p[0]), ys = it.pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  if (it.t === 'text') { const w = it.text.length * it.size * .62; return [it.x, it.y - it.size * .85, it.x + w, it.y + it.size * .2]; }
  return [Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.max(it.x1, it.x2), Math.max(it.y1, it.y2)];
}
function selBox(it) { const [a, b, c, d] = bounds(it); return `<rect class="dsel" x="${R(a - 6)}" y="${R(b - 6)}" width="${R(c - a + 12)}" height="${R(d - b + 12)}"/>`; }
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, k = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
}
function hit(it, p) {
  const tol = it.wd / 2 + 6, [a, b, c, d] = bounds(it);
  if (it.t === 'text') return p[0] >= a - 4 && p[0] <= c + 4 && p[1] >= b - 4 && p[1] <= d + 4;
  if (it.t === 'pen') return it.pts.some((q, i) => i && segDist(p, it.pts[i - 1], q) <= tol) || (it.pts.length === 1 && Math.hypot(p[0] - it.pts[0][0], p[1] - it.pts[0][1]) <= tol);
  if (it.t === 'line' || it.t === 'arrow') return segDist(p, [it.x1, it.y1], [it.x2, it.y2]) <= tol;
  if (it.t === 'rect') {
    const inBox = p[0] >= a && p[0] <= c && p[1] >= b && p[1] <= d;
    return it.fill ? inBox : inBox && Math.min(p[0] - a, c - p[0], p[1] - b, d - p[1]) <= tol || (!inBox && p[0] >= a - tol && p[0] <= c + tol && p[1] >= b - tol && p[1] <= d + tol);
  }
  if (it.t === 'ellipse') {
    const cx = (a + c) / 2, cy = (b + d) / 2, rx = Math.max(1, (c - a) / 2), ry = Math.max(1, (d - b) / 2), r = Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry);
    return it.fill ? r <= 1 : Math.abs(r - 1) * Math.min(rx, ry) <= tol;
  }
  return false;
}
function moveItem(it, dx, dy) {
  if (it.t === 'pen') it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
  else if (it.t === 'text') { it.x += dx; it.y += dy; }
  else { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
}
// Shift: straight lines at 45° steps, squares, circles (like Canva)
function constrain(t, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  if (t === 'line' || t === 'arrow') { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(dx, dy); return [x1 + l * Math.cos(a), y1 + l * Math.sin(a)]; }
  const m = Math.max(Math.abs(dx), Math.abs(dy)); return [x1 + Math.sign(dx || 1) * m, y1 + Math.sign(dy || 1) * m];
}

/* ---------- Draw mode (the control page only) ---------- */
const Draw = { on: false, tool: 'pen', c: '#5ee6ff', wd: 4, fill: false, size: 28, sel: null, hist: [], redo: [] };
const TOOLS = [['select', 'Select'], ['pen', 'Pen'], ['line', 'Line'], ['arrow', 'Arrow'], ['rect', 'Box'], ['ellipse', 'Circle'], ['text', 'Text'], ['eraser', 'Eraser']];
const COLORS = ['#5ee6ff', '#ff7ac6', '#ffd84d', '#7dffa8', '#b18cff', '#ffa24d', '#ff5e5e', '#ffffff'];
const H = () => BearWall.drawHost, $ = s => document.querySelector(s);
const snapshot = w => ({ id: w.id, items: JSON.stringify(w.opts.items || []) });
function remember(w) { Draw.hist.push(snapshot(w)); if (Draw.hist.length > 100) Draw.hist.shift(); Draw.redo = []; }
function restore(from, to) {
  const s = from.pop(); if (!s) return;
  const w = H().layout.widgets.find(x => x.id === s.id); if (!w) return;
  to.push(snapshot(w)); w.opts.items = JSON.parse(s.items); Draw.sel = null; H().save(); H().redraw(w); renderBar();
}
const items = w => (w.opts.items = w.opts.items || []);

function setOn(on) {
  Draw.on = on; Draw.sel = null;
  document.body.classList.toggle('drawing', on);
  $('#drawBtn').classList.toggle('on', on); $('#drawBtn').textContent = on ? 'Drawing · Esc to stop' : 'Draw';
  $('#drawBar').hidden = !on;
  if (on) H().deselect();
  H().layout.widgets.filter(w => w.type === 'drawing').forEach(w => H().redraw(w));
  renderBar();
}
function renderBar() {
  const bar = $('#drawBar'); if (!bar) return;
  bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === Draw.tool));
  bar.querySelectorAll('[data-c]').forEach(b => b.classList.toggle('on', b.dataset.c === Draw.c));
  $('#dWd').value = Draw.wd; $('#dFill').checked = Draw.fill; $('#dSize').value = Draw.size; $('#dCol').value = Draw.c;
  $('#dTextRow').hidden = Draw.tool !== 'text' && !(Draw.sel && Draw.sel.it.t === 'text');
  $('#dUndo').disabled = !Draw.hist.length; $('#dRedo').disabled = !Draw.redo.length;
  $('#dHint').textContent = { select: 'Click a shape to move it. Delete removes it.', eraser: 'Click or drag over a shape to erase it.',
    text: 'Click the wall, then type. Click your text to edit it.', pen: 'Drag to draw.' }[Draw.tool] || 'Drag to draw. Hold Shift for straight lines, squares and circles.';
}
// a style change from the bar also changes the selected item
function styleSel(fn) {
  const s = Draw.sel; if (!s) return;
  remember(s.w); fn(s.it); H().save(); H().redraw(s.w);
}
function buildBar() {
  const btn = document.createElement('button');
  btn.className = 'btn quiet'; btn.id = 'drawBtn'; btn.textContent = 'Draw'; btn.title = 'Click and draw straight on the wall';
  $('#winBtn').before(btn);
  btn.onclick = () => setOn(!Draw.on);
  const bar = document.createElement('div');
  bar.id = 'drawBar'; bar.className = 'drawbar'; bar.hidden = true;
  bar.innerHTML = `<div class="tabs wrap">${TOOLS.map(([v, n]) => `<button data-tool="${v}">${n}</button>`).join('')}</div>
    <div class="drow">${COLORS.map(c => `<button class="sw" data-c="${c}" style="--s:${c}" aria-label="${c}"></button>`).join('')}<input type="color" id="dCol" aria-label="Any color">
      <label>Size <input type="range" id="dWd" min="1" max="20" step="1"></label><label class="dfill">Fill <input type="checkbox" class="switch" id="dFill"></label>
      <button class="btn quiet" id="dUndo" title="Ctrl+Z">Undo</button><button class="btn quiet" id="dRedo" title="Ctrl+Y">Redo</button><button class="btn quiet" id="dClear">Clear section</button></div>
    <div class="drow" id="dTextRow"><input class="field" id="dText" placeholder="Type here, it shows on the wall" maxlength="80"><label>Text size <input type="range" id="dSize" min="12" max="96" step="2"></label></div>
    <div class="note" id="dHint"></div>`;
  $('#wallWrap').before(bar);
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) { Draw.tool = b.dataset.tool; if (Draw.tool !== 'select') Draw.sel = null; }
    else if (b.dataset.c) { Draw.c = b.dataset.c; styleSel(it => { it.c = Draw.c; }); }
    else if (b.id === 'dUndo') return restore(Draw.hist, Draw.redo);
    else if (b.id === 'dRedo') return restore(Draw.redo, Draw.hist);
    else if (b.id === 'dClear') {
      const sec = H().inside ? H().layout.sections.find(s => s.id === H().inside) : null, ws = H().layout.widgets.filter(w => w.type === 'drawing' && (!sec || w.section === sec.id));
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = sec ? 'Sure? Clear it' : 'Sure? Clear every section'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Clear section'; }, 3000); return; }
      ws.forEach(w => { remember(w); w.opts.items = []; H().redraw(w); }); H().save(); Draw.sel = null;
      delete b.dataset.armed; b.textContent = 'Clear section';
    }
    redrawAll(); renderBar();
  });
  $('#dCol').oninput = e => { Draw.c = e.target.value; styleSel(it => { it.c = Draw.c; }); renderBar(); };
  $('#dWd').oninput = e => { Draw.wd = +e.target.value; styleSel(it => { if (it.t !== 'text') it.wd = Draw.wd; }); };
  $('#dFill').onchange = e => { Draw.fill = e.target.checked; styleSel(it => { if (it.t === 'rect' || it.t === 'ellipse') it.fill = Draw.fill; }); };
  $('#dSize').oninput = e => { Draw.size = +e.target.value; styleSel(it => { if (it.t === 'text') it.size = Draw.size; }); };
  $('#dText').oninput = e => {   // typing edits the text you just placed or picked
    const s = Draw.sel; if (!s || s.it.t !== 'text') return;
    s.it.text = e.target.value || ' '; H().save(); H().redraw(s.w);
  };
  renderBar();
}
const redrawAll = () => H().layout.widgets.filter(w => w.type === 'drawing').forEach(w => H().redraw(w));
// topmost item under p in this layer (last drawn is on top)
const itemAt = (w, p) => { const its = items(w); for (let i = its.length - 1; i >= 0; i--) if (hit(its[i], p)) return i; return -1; };

let drag = null;
function down(e) {
  if (!Draw.on || e.button > 0) return;
  e.stopPropagation(); e.preventDefault();
  const at = H().at(e);
  if (!at) { Draw.sel = null; redrawAll(); return renderBar(); }
  const p = at.p, t = Draw.tool;
  let w = H().layer(at.s, t !== 'select' && t !== 'eraser');
  if (!w) return;
  const box = e.currentTarget; box.setPointerCapture(e.pointerId);
  if (t === 'select' || t === 'eraser' || t === 'text') {
    const i = itemAt(w, p);
    if (t === 'eraser') { drag = { kind: 'erase', s: at.s, w, done: false }; eraseAt(w, p); return; }
    if (i >= 0 && (t === 'select' || items(w)[i].t === 'text')) {
      Draw.sel = { w, i, it: items(w)[i] };
      if (Draw.sel.it.t === 'text') { $('#dText').value = Draw.sel.it.text; Draw.size = Draw.sel.it.size; }
      Draw.c = Draw.sel.it.c; if (Draw.sel.it.wd) Draw.wd = Draw.sel.it.wd;
      drag = { kind: 'move', s: at.s, w, last: p, moved: false };
      redrawAll(); renderBar(); return;
    }
    if (t === 'text') {   // a new text where you clicked, then type
      remember(w);
      const it = { t: 'text', x: p[0], y: p[1], text: $('#dText').value || 'Text', size: Draw.size, c: Draw.c };
      items(w).push(it); Draw.sel = { w, i: items(w).length - 1, it };
      H().save(); H().redraw(w); renderBar(); setTimeout(() => { $('#dText').focus({ preventScroll: true }); $('#dText').select(); }, 0);   // type right away; the wall stays put
      return;
    }
    Draw.sel = null; redrawAll(); renderBar(); return;
  }
  remember(w);
  const it = t === 'pen' ? { t, pts: [p.map(R)], c: Draw.c, wd: Draw.wd } : { t, x1: p[0], y1: p[1], x2: p[0], y2: p[1], c: Draw.c, wd: Draw.wd, fill: Draw.fill };
  items(w).push(it);
  drag = { kind: 'draw', s: at.s, w, it };
  H().redraw(w);
}
function eraseAt(w, p) {
  const i = itemAt(w, p); if (i < 0) return;
  if (!drag.done) drag.done = true; else Draw.hist.pop();   // one undo step per erase drag
  remember(w); items(w).splice(i, 1); Draw.sel = null; H().save(); H().redraw(w); renderBar();
}
function move(e) {
  if (!Draw.on || !drag) return;
  e.stopPropagation();
  const p = H().local(drag.s, e), it = drag.it;
  if (drag.kind === 'erase') return eraseAt(drag.w, p);
  if (drag.kind === 'move') {
    if (!drag.moved) { remember(drag.w); drag.moved = true; }
    moveItem(Draw.sel.it, p[0] - drag.last[0], p[1] - drag.last[1]); drag.last = p;
  } else if (it.t === 'pen') {
    const q = it.pts[it.pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 1.5) it.pts.push(p.map(R));   // skip tiny steps: smaller to store, smoother on the wall
  } else {
    const [x2, y2] = e.shiftKey ? constrain(it.t, it.x1, it.y1, p[0], p[1]) : p;
    it.x2 = x2; it.y2 = y2;
  }
  H().redraw(drag.w); H().save();   // the save is throttled; the projector follows live
}
function up(e) {
  if (!Draw.on || !drag) return;
  e.stopPropagation();
  const d = drag; drag = null;
  if (d.kind === 'draw' && d.it.t !== 'pen' && Math.hypot(d.it.x2 - d.it.x1, d.it.y2 - d.it.y1) < 3) { items(d.w).pop(); Draw.hist.pop(); }   // a click, not a shape
  H().save(); H().redraw(d.w); renderBar();
}
function key(e) {
  if (!Draw.on || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox') return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); if (Draw.sel) { Draw.sel = null; redrawAll(); renderBar(); } else setOn(false); return; }
  if (mod && (k === 'z' || k === 'y')) { e.preventDefault(); e.stopImmediatePropagation(); return k === 'y' || e.shiftKey ? restore(Draw.redo, Draw.hist) : restore(Draw.hist, Draw.redo); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && Draw.sel) {
    e.preventDefault(); e.stopImmediatePropagation();
    const s = Draw.sel; remember(s.w); items(s.w).splice(s.i, 1); Draw.sel = null; H().save(); H().redraw(s.w); renderBar();
  }
}

if (!/^\/wall/.test(location.pathname)) {   // the projector's own view has nothing to draw with
  const start = () => {
    const box = $('#stageBox'); if (!box || !$('#winBtn')) return setTimeout(start, 50);
    buildBar();
    box.addEventListener('pointerdown', down, true);   // capture: Draw mode gets the pointer before arranging does
    box.addEventListener('pointermove', move, true);
    box.addEventListener('pointerup', up, true);
    box.addEventListener('pointercancel', up, true);
    box.addEventListener('dblclick', e => { if (Draw.on) e.stopPropagation(); }, true);
    document.addEventListener('keydown', key, true);
  };
  start();
}
window.BearWallDraw = { get state() { return Draw; }, setOn, hit, bounds, constrain };
console.assert(hit({ t: 'line', x1: 0, y1: 0, x2: 100, y2: 0, wd: 4 }, [50, 3]) && !hit({ t: 'line', x1: 0, y1: 0, x2: 100, y2: 0, wd: 4 }, [50, 30])
  && hit({ t: 'ellipse', x1: 0, y1: 0, x2: 100, y2: 100, wd: 2, fill: true }, [50, 50]) && !hit({ t: 'ellipse', x1: 0, y1: 0, x2: 100, y2: 100, wd: 2 }, [50, 50])
  && constrain('rect', 0, 0, 30, 10).join() === '30,30', 'draw: hit tests and Shift constraints');
})();
