// BearWall sound designs: window.BearWallSounds, the registry sound.js plays from.
// Each id has 2-3 synth candidates (a, b, c) for the sound board; the losers get deleted after the user picks.
// fn(ctx, out, t0, opts) schedules Web Audio nodes into `out` from ctx time t0. Ambience loops until stop(t).
// Small projector speaker: energy kept in ~200 Hz-6 kHz, every gain ramps from 0 (no clicks), peaks well under -3 dBFS.
(function () {
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

// one 2 s white-noise buffer per AudioContext
function noiseBuf(ctx) {
  if (ctx._bwNoise) return ctx._bwNoise;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (ctx._bwNoise = b);
}
const panTo = (ctx, out, pan) => { if (!pan) return out; const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(out); return p; };
// gain envelope: 0 -> v over a, then exponential fade over d
function env(ctx, out, t, a, d, v) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(1e-4, t + a + d);
  g.connect(out);
  return g;
}
// oscillator note, optional glide to f2 and lowpass
function tone(ctx, out, t, { type = 'sine', f, f2 = f, a = .005, d = .2, v = .2, pan = 0, lp = 0 }) {
  const s = ctx.createOscillator();
  s.type = type; s.frequency.setValueAtTime(f, t);
  if (f2 !== f) s.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  let node = env(ctx, panTo(ctx, out, pan), t, a, d, v);
  if (lp) { const b = ctx.createBiquadFilter(); b.frequency.value = lp; b.connect(node); node = b; }
  s.connect(node); s.start(t); s.stop(t + a + d + .05);
  return s;
}
// filtered noise burst, optional filter sweep to f2
function noise(ctx, out, t, { type = 'bandpass', f = 1000, f2 = f, q = 1, a = .005, d = .1, v = .2, pan = 0 }) {
  const s = ctx.createBufferSource(), b = ctx.createBiquadFilter();
  s.buffer = noiseBuf(ctx); s.loop = true;
  b.type = type; b.Q.value = q; b.frequency.setValueAtTime(f, t);
  if (f2 !== f) b.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  s.connect(b); b.connect(env(ctx, panTo(ctx, out, pan), t, a, d, v));
  s.start(t, Math.random() * 1.5); s.stop(t + a + d + .05);
}
// two-operator FM note: bright at the start, mellowing as it decays
function fm(ctx, out, t, { f, f2 = f, ratio = 2, index = 2, a = .005, d = .5, v = .18 }) {
  const c = tone(ctx, out, t, { f, f2, a, d, v }), m = ctx.createOscillator(), mg = ctx.createGain();
  m.frequency.setValueAtTime(f * ratio, t);
  if (f2 !== f) m.frequency.exponentialRampToValueAtTime(f2 * ratio, t + a + d);
  mg.gain.setValueAtTime(f * index, t); mg.gain.exponentialRampToValueAtTime(f * index * .03, t + a + d);
  m.connect(mg); mg.connect(c.frequency); m.start(t); m.stop(t + a + d + .05);
}
const seq = (t, step, notes, fn) => notes.forEach((f, i) => fn(f, t + i * step));

// ---------- ambience: a looping bed plus random events on a JS timer; stop(t) fades out over 0.5 s ----------
function loopNoise(ctx, out, t, type, f, q, v) {
  const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf(ctx); s.loop = true; b.type = type; b.frequency.value = f; b.Q.value = q; g.gain.value = v;
  s.connect(b); b.connect(g); g.connect(out); s.start(t, Math.random() * 1.5);
  return { s, g };
}
function lfo(ctx, param, rate, depth, t) {   // slow wobble on an AudioParam; returns the oscillator to stop
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = rate; g.gain.value = depth; o.connect(g); g.connect(param); o.start(t);
  return o;
}
// bed(g, t) returns the looping sources to stop; events = [[fn(g, t), minGapS, maxGapS], ...]
function amb(ctx, out, t0, bed, events) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + .4); g.connect(out);
  const srcs = bed ? bed(g, t0) : [], timers = new Set();
  let live = true;
  (events || []).forEach(([fn, lo, hi]) => {
    const next = () => {
      const id = setTimeout(() => { timers.delete(id); if (!live) return; fn(g, Math.max(ctx.currentTime + .05, t0)); next(); }, rnd(lo, hi) * 1000);
      timers.add(id);
    };
    next();
  });
  return {
    stop(t = ctx.currentTime) {
      if (!live) return;
      live = false; timers.forEach(clearTimeout);
      const v = g.gain.value;
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(v, t); g.gain.linearRampToValueAtTime(0, t + .5);
      srcs.forEach(s => s.stop(t + .6));
      setTimeout(() => g.disconnect(), Math.max(0, t - ctx.currentTime + .8) * 1000);
    }
  };
}

// ---------- blinds fallbacks (the ElevenLabs takes replace these) ----------
const blinds = (open, kind) => (ctx, out, t) => {
  if (kind === 'rattle') {   // slats clicking past, a slide hiss under them, a clack when closed
    noise(ctx, out, t, { f: 700, f2: open ? 1400 : 500, q: 1.2, a: .3, d: 1.2, v: .05 });
    for (let i = 0; i < 26; i++) {
      const x = i / 26, tt = t + 1.5 * (open ? Math.pow(x, 1.3) : Math.pow(x, .8));
      noise(ctx, out, tt, { f: rnd(1800, 3500), q: 6, d: .02, v: rnd(.15, .3), pan: rnd(-.3, .3) });
    }
    if (!open) noise(ctx, out, t + 1.55, { type: 'lowpass', f: 1500, d: .08, v: .22 });
  } else if (kind === 'roller') {   // fabric roller: soft whoosh with the tube thumping as it turns
    noise(ctx, out, t, { type: 'lowpass', f: 900, f2: open ? 1800 : 500, a: .2, d: 1.4, v: .12 });
    for (let i = 0; i < 12; i++) noise(ctx, out, t + .1 + i * .11, { type: 'lowpass', f: 400, d: .05, v: .07 });
    noise(ctx, out, t + 1.45, { type: 'lowpass', f: open ? 900 : 600, d: .1, v: .16 });
  } else {   // pull cord: even ratchet ticks, then a clack (close) or a soft bump (open)
    for (let i = 0; i < 17; i++) tone(ctx, out, t + i * .07, { type: 'triangle', f: 2500 + (open ? i * 20 : -i * 20), d: .012, v: .06 });
    noise(ctx, out, t + 1.25, open ? { type: 'lowpass', f: 700, d: .08, v: .12 } : { f: 1300, q: 3, d: .07, v: .22 });
  }
};

// ---------- registry ----------
const R = {};
const def = (id, type, label, len, v, extra) => {
  R[id] = Object.assign({ type, label, len, variants: {} }, extra);
  Object.keys(v).forEach(k => { const fn = v[k][1]; R[id].variants[k] = { name: v[k][0], fn: (c, o, t, p) => fn(c, o, t, p || {}) }; });
};
const PENT = [0, 2, 4, 7, 9, 12, 14, 16];   // light-scene pitch steps (major pentatonic)
const CHORD = [523.3, 659.3, 784, 987.8];   // Cmaj7: calm, a bit sci-fi

// intro pieces
def('intro-hum', 'ui', 'Intro: power hum', 1.2, {
  a: ['warm sine swell', (c, o, t) => { [196, 294.5].forEach(f => tone(c, o, t, { f, a: .9, d: .35, v: .14 })); }],
  b: ['filtered saw rising', (c, o, t) => {
    const s = c.createOscillator(), b = c.createBiquadFilter(), g = env(c, o, t, .9, .35, .12);
    s.type = 'sawtooth'; s.frequency.value = 220; b.frequency.setValueAtTime(300, t); b.frequency.exponentialRampToValueAtTime(2200, t + 1.1);
    s.connect(b); b.connect(g); s.start(t); s.stop(t + 1.3);
  }],
  c: ['breath + faint tone', (c, o, t) => { noise(c, o, t, { f: 400, f2: 2500, q: 2, a: .9, d: .3, v: .14 }); tone(c, o, t, { f: 440, a: .9, d: .3, v: .05 }); }]
});
def('intro-zip', 'ui', 'Intro: trace zip', .25, {
  a: ['sine sweep up', (c, o, t) => tone(c, o, t, { f: 600, f2: 2400, a: .01, d: .22, v: .1 })],
  b: ['noise zip', (c, o, t) => noise(c, o, t, { f: 1000, f2: 6000, q: 8, a: .02, d: .2, v: .8 })],
  c: ['FM chirp', (c, o, t) => fm(c, o, t, { f: 800, f2: 2000, ratio: 2, index: 1.5, d: .22, v: .09 })]
});
def('intro-clunk', 'ui', 'Intro: bracket clunk', .15, {
  a: ['soft thud', (c, o, t) => { tone(c, o, t, { f: 260, f2: 140, d: .12, v: .25 }); noise(c, o, t, { type: 'lowpass', f: 800, d: .04, v: .12 }); }],
  b: ['metal latch', (c, o, t) => { tone(c, o, t, { type: 'triangle', f: 900, d: .08, v: .12 }); noise(c, o, t, { type: 'highpass', f: 3000, d: .04, v: .1 }); }],
  c: ['woody knock', (c, o, t) => noise(c, o, t, { f: 600, q: 5, d: .1, v: .9 })]
});
def('intro-tick', 'ui', 'Intro: print tick', .03, {
  a: ['tiny click', (c, o, t) => noise(c, o, t, { type: 'highpass', f: 4000, d: .015, v: .08 })],
  b: ['sine tick', (c, o, t) => tone(c, o, t, { f: 2400, d: .02, v: .05 })],
  c: ['typewriter tick', (c, o, t) => { noise(c, o, t, { f: 2500, q: 3, d: .025, v: .15 }); tone(c, o, t, { type: 'triangle', f: 1600, d: .01, v: .03 }); }]
});
def('intro-chord', 'ui', 'Intro: final chord', 1.5, {
  a: ['soft major-7 pad', (c, o, t) => CHORD.forEach((f, i) => tone(c, o, t + i * .03, { f, a: .06, d: 1.4, v: .07 }))],
  b: ['glassy FM bells', (c, o, t) => [659.3, 987.8, 1318.5].forEach((f, i) => fm(c, o, t + i * .05, { f, ratio: 3.5, index: 1.2, d: 1.4, v: .07 }))],
  c: ['rising arpeggio', (c, o, t) => seq(t, .08, [392, 523.3, 659.3, 784, 987.8], (f, tt) => tone(c, o, tt, { type: 'triangle', f, d: 1.1, v: .07 }))]
});
def('power-down', 'ui', 'Power down', 1.8, {
  a: ['chord falls away', (c, o, t) => { CHORD.slice().reverse().forEach((f, i) => tone(c, o, t + i * .05, { f, f2: f / 2, a: .02, d: 1.5, v: .06 })); tone(c, o, t + .2, { f: 600, f2: 150, a: .05, d: 1.5, v: .06 }); }],
  b: ['tape stop', (c, o, t) => {
    const s = c.createOscillator(), b = c.createBiquadFilter(), g = env(c, o, t, .03, 1.7, .12);
    s.type = 'sawtooth'; s.frequency.setValueAtTime(330, t); s.frequency.exponentialRampToValueAtTime(60, t + 1.6);
    b.frequency.setValueAtTime(3000, t); b.frequency.exponentialRampToValueAtTime(300, t + 1.6);
    s.connect(b); b.connect(g); s.start(t); s.stop(t + 1.8);
  }],
  c: ['reverse arpeggio + hum fade', (c, o, t) => { seq(t, .12, [987.8, 784, 659.3, 523.3, 392], (f, tt) => tone(c, o, tt, { type: 'triangle', f, d: .5, v: .07 })); noise(c, o, t + .5, { f: 1500, f2: 300, q: 2, a: .2, d: 1.1, v: .1 }); }]
});
// sleep / wake / flip
def('sleep', 'ui', 'Sleep', .4, {
  a: ['two notes down', (c, o, t) => seq(t, .12, [880, 659.3], (f, tt) => tone(c, o, tt, { f, d: .2, v: .1 }))],
  b: ['soft drop', (c, o, t) => tone(c, o, t, { f: 700, f2: 350, a: .01, d: .3, v: .12 })],
  c: ['muted FM blip', (c, o, t) => fm(c, o, t, { f: 523.3, f2: 392, ratio: 1.5, index: 1, d: .3, v: .1 })]
});
def('wake', 'ui', 'Wake', .4, {
  a: ['two notes up', (c, o, t) => seq(t, .12, [659.3, 880], (f, tt) => tone(c, o, tt, { f, d: .2, v: .1 }))],
  b: ['soft rise', (c, o, t) => tone(c, o, t, { f: 350, f2: 700, a: .01, d: .3, v: .12 })],
  c: ['bright FM blip', (c, o, t) => fm(c, o, t, { f: 392, f2: 523.3, ratio: 1.5, index: 1, d: .3, v: .1 })]
});
def('flip', 'ui', 'Picture flip', .8, {
  a: ['noise whoosh', (c, o, t) => { noise(c, o, t, { f: 300, f2: 3000, q: 2, a: .35, d: .05, v: .18, pan: -.5 }); noise(c, o, t + .35, { f: 3000, f2: 300, q: 2, a: .02, d: .4, v: .18, pan: .5 }); }],
  b: ['swish + ding', (c, o, t) => { noise(c, o, t, { type: 'highpass', f: 800, f2: 4000, a: .3, d: .2, v: .12 }); tone(c, o, t + .5, { f: 1318.5, d: .3, v: .08 }); }],
  c: ['doppler tone', (c, o, t) => { tone(c, o, t, { f: 500, f2: 900, a: .3, d: .05, v: .1, pan: -.5 }); tone(c, o, t + .35, { f: 900, f2: 500, a: .02, d: .4, v: .1, pan: .5 }); }]
});
// Light mode
def('light-on', 'ui', 'Light mode on', .3, {
  a: ['rising pair', (c, o, t) => seq(t, .07, [1046.5, 1568], (f, tt) => tone(c, o, tt, { f, d: .15, v: .09 }))],
  b: ['click + glow', (c, o, t) => { noise(c, o, t, { f: 2500, q: 4, d: .02, v: .12 }); tone(c, o, t + .02, { f: 784, a: .08, d: .2, v: .08 }); }],
  c: ['FM ping', (c, o, t) => fm(c, o, t, { f: 1046.5, ratio: 2.5, index: 1, d: .25, v: .08 })]
});
def('light-off', 'ui', 'Light mode off', .3, {
  a: ['falling pair', (c, o, t) => seq(t, .07, [1568, 1046.5], (f, tt) => tone(c, o, tt, { f, d: .15, v: .09 }))],
  b: ['click + fade', (c, o, t) => { noise(c, o, t, { f: 2000, q: 4, d: .02, v: .12 }); tone(c, o, t + .02, { f: 784, f2: 523.3, d: .2, v: .07 }); }],
  c: ['low FM ping', (c, o, t) => fm(c, o, t, { f: 659.3, ratio: 2.5, index: 1, d: .25, v: .08 })]
});
def('light-tick', 'ui', 'Light brightness tick', .04, {
  a: ['tiny sine', (c, o, t) => tone(c, o, t, { f: 1800, d: .03, v: .06 })],
  b: ['noise tick', (c, o, t) => noise(c, o, t, { f: 3000, q: 5, d: .02, v: .5 })],
  c: ['soft triangle', (c, o, t) => tone(c, o, t, { type: 'triangle', f: 1200, d: .025, v: .07 })]
});
def('light-scene', 'ui', 'Light scene click', .25, {
  a: ['pitched click', (c, o, t, p) => { const f = 523.3 * Math.pow(2, PENT[(p.pitch | 0) % 8] / 12); tone(c, o, t, { type: 'triangle', f, d: .08, v: .1 }); noise(c, o, t, { f: f * 4, q: 6, d: .01, v: .06 }); }],
  b: ['marimba', (c, o, t, p) => { const f = 523.3 * Math.pow(2, PENT[(p.pitch | 0) % 8] / 12); tone(c, o, t, { f, d: .25, v: .12 }); tone(c, o, t, { f: f * 4, d: .05, v: .03 }); }],
  c: ['pluck', (c, o, t, p) => tone(c, o, t, { type: 'sawtooth', f: 392 * Math.pow(2, PENT[(p.pitch | 0) % 8] / 12), d: .2, v: .07, lp: 1800 })]
});
def('volume-tick', 'ui', 'Volume tick', .05, {
  a: ['sine blip', (c, o, t) => tone(c, o, t, { f: 1200, d: .04, v: .1 })],
  b: ['triangle blip', (c, o, t) => tone(c, o, t, { type: 'triangle', f: 900, d: .05, v: .1 })],
  c: ['noise click', (c, o, t) => noise(c, o, t, { f: 2000, q: 4, d: .02, v: .5 })]
});
def('blinds-close', 'ui', 'Blinds closing', 1.6, {
  a: ['slat rattle', blinds(false, 'rattle')], b: ['roller slide', blinds(false, 'roller')], c: ['cord + clack', blinds(false, 'cord')]
}, { eleven: { prompt: 'Indoor venetian window blinds being lowered and closed: plastic slats sliding down and rattling softly, ending with a light clack as they settle. Close microphone, quiet room, no music, no voices.', seconds: 2, loop: false } });
def('blinds-open', 'ui', 'Blinds opening', 1.6, {
  a: ['slat rattle', blinds(true, 'rattle')], b: ['roller slide', blinds(true, 'roller')], c: ['cord + clack', blinds(true, 'cord')]
}, { eleven: { prompt: 'Indoor venetian window blinds being pulled up and opened: cord pulled, plastic slats lifting and rattling, gathering at the top. Close microphone, quiet room, no music, no voices.', seconds: 2, loop: false } });
def('hour-bell', 'ui', 'Hourly bell', 2.5, {
  a: ['soft chime', (c, o, t) => [[1, .1], [2.76, .03], [5.4, .015]].forEach(([k, v]) => tone(c, o, t, { f: 784 * k > 6000 ? 6000 : 784 * k, a: .004, d: 2.4 / k, v }))],
  b: ['FM bell', (c, o, t) => fm(c, o, t, { f: 659.3, ratio: 1.4, index: 2.5, d: 2.4, v: .1 })],
  c: ['two-note chime', (c, o, t) => seq(t, .45, [659.3, 523.3], (f, tt) => fm(c, o, tt, { f, ratio: 3.5, index: .8, d: 1.8, v: .08 }))]
});

// alerts: info soft, warn clearer, critical urgent but rounded (lowpassed, no harsh square)
def('alert-info', 'alert', 'Alert: info', .4, {
  a: ['soft two-note', (c, o, t) => seq(t, .12, [784, 1046.5], (f, tt) => tone(c, o, tt, { f, d: .25, v: .1 }))],
  b: ['glass ping', (c, o, t) => fm(c, o, t, { f: 1046.5, ratio: 3.5, index: 1, d: .4, v: .09 })],
  c: ['single blip', (c, o, t) => tone(c, o, t, { type: 'triangle', f: 880, d: .3, v: .12 })]
});
def('alert-warn', 'alert', 'Alert: warning', .7, {
  a: ['three blips', (c, o, t) => seq(t, .14, [880, 880, 1174.7], (f, tt) => tone(c, o, tt, { type: 'triangle', f, d: .12, v: .14 }))],
  b: ['double FM ping', (c, o, t) => seq(t, .2, [987.8, 987.8], (f, tt) => fm(c, o, tt, { f, ratio: 2, index: 1.5, d: .3, v: .12 }))],
  c: ['two beeps', (c, o, t) => seq(t, .25, [659.3, 659.3], (f, tt) => tone(c, o, tt, { type: 'square', f, a: .01, d: .15, v: .08, lp: 2000 }))]
});
def('alert-critical', 'alert', 'Alert: critical', 1.3, {
  a: ['two-tone pulse x3', (c, o, t) => { for (let i = 0; i < 3; i++) seq(t + i * .4, .16, [987.8, 740], (f, tt) => tone(c, o, tt, { type: 'square', f, a: .01, d: .13, v: .1, lp: 2500 })); }],
  b: ['rising sweeps x2', (c, o, t) => seq(t, .55, [600, 600], (f, tt) => tone(c, o, tt, { type: 'triangle', f, f2: 1200, a: .02, d: .45, v: .15 }))],
  c: ['rapid FM alarm', (c, o, t) => seq(t, .15, [1174.7, 1174.7, 1174.7, 880, 880, 880], (f, tt) => fm(c, o, tt, { f, ratio: 2, index: 2, d: .12, v: .1 }))]
}, { critical: true });
def('net-down', 'alert', 'Internet down', .8, {
  a: ['three notes falling', (c, o, t) => seq(t, .16, [784, 659.3, 523.3], (f, tt) => tone(c, o, tt, { f, d: .3, v: .12 }))],
  b: ['falling glide', (c, o, t) => tone(c, o, t, { type: 'triangle', f: 900, f2: 300, a: .02, d: .6, v: .14 })],
  c: ['descending FM blips', (c, o, t) => seq(t, .15, [1046.5, 880, 698.5, 523.3], (f, tt) => fm(c, o, tt, { f, ratio: 1.5, index: 1, d: .15, v: .1 }))]
});
def('net-up', 'alert', 'Internet back', .8, {
  a: ['three notes rising', (c, o, t) => seq(t, .16, [523.3, 659.3, 784], (f, tt) => tone(c, o, tt, { f, d: .3, v: .12 }))],
  b: ['rising glide', (c, o, t) => tone(c, o, t, { type: 'triangle', f: 300, f2: 900, a: .02, d: .6, v: .14 })],
  c: ['ascending FM blips', (c, o, t) => seq(t, .15, [523.3, 698.5, 880, 1046.5], (f, tt) => fm(c, o, tt, { f, ratio: 1.5, index: 1, d: .15, v: .1 }))]
});
def('update', 'alert', 'Update', .8, {
  a: ['quick sparkle', (c, o, t) => seq(t, .06, [1046.5, 1318.5, 1568, 2093], (f, tt) => tone(c, o, tt, { f, d: .35, v: .07 }))],
  b: ['two FM bells', (c, o, t) => seq(t, .2, [784, 1174.7], (f, tt) => fm(c, o, tt, { f, ratio: 3.5, index: 1, d: .6, v: .09 }))],
  c: ['soft chord', (c, o, t) => [659.3, 987.8].forEach(f => tone(c, o, t, { type: 'triangle', f, a: .05, d: .7, v: .08 }))]
});
def('pasok', 'alert', 'Classes suspended!', 1.2, {
  a: ['short-short-short-long', (c, o, t) => [[523.3, 0, .1], [659.3, .13, .1], [784, .26, .1], [1046.5, .39, .7]].forEach(([f, dt, d]) => {
    tone(c, o, t + dt, { type: 'triangle', f, d, v: .12 }); tone(c, o, t + dt, { type: 'square', f, d, v: .03, lp: 2500 });
  })],
  b: ['ta-da', (c, o, t) => { tone(c, o, t, { type: 'triangle', f: 784, d: .12, v: .12 }); [1046.5, 1318.5, 1568].forEach(f => tone(c, o, t + .18, { type: 'triangle', f, d: .9, v: .07 })); }],
  c: ['brassy rise', (c, o, t) => seq(t, .12, [392, 523.3, 659.3, 784], (f, tt) => tone(c, o, tt, { type: 'sawtooth', f, a: .02, d: f === 784 ? .7 : .14, v: .07, lp: 1800 }))]
});
def('storm', 'alert', 'Storm warning', 1.6, {
  a: ['rumble + two tones', (c, o, t) => { noise(c, o, t, { type: 'lowpass', f: 400, f2: 200, a: .2, d: 1.3, v: .2 }); seq(t + .2, .35, [740, 554.4, 740, 554.4], (f, tt) => tone(c, o, tt, { type: 'triangle', f, d: .3, v: .12 })); }],
  b: ['soft siren x2', (c, o, t) => seq(t, .75, [500, 500], (f, tt) => {
    const s = tone(c, o, tt, { type: 'sawtooth', f, a: .05, d: .65, v: .08, lp: 1500 });
    s.frequency.cancelScheduledValues(tt); s.frequency.setValueAtTime(f, tt); s.frequency.linearRampToValueAtTime(900, tt + .35); s.frequency.linearRampToValueAtTime(f, tt + .7);
  })],
  c: ['rumble + FM alarm', (c, o, t) => { noise(c, o, t, { type: 'lowpass', f: 350, a: .3, d: 1.2, v: .18 }); seq(t + .1, .15, [987.8, 987.8, 987.8, 740, 740, 740], (f, tt) => fm(c, o, tt, { f, ratio: 2, index: 1.5, d: .12, v: .09 })); }]
}, { critical: true });

// ambience beds (len 0: they loop until stop)
const drop = (c, g, t) => tone(c, g, t, { f: rnd(2500, 5000), f2: 1800, a: .001, d: .02, v: rnd(.008, .02), pan: rnd(-.6, .6) });
def('amb-rain', 'ambience', 'Rain', 0, {
  a: ['steady rain', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'bandpass', 3000, .7, .12).s, loopNoise(c, g, t0, 'lowpass', 600, .7, .05).s],
    [[(g, tt) => { for (let i = 0; i < 8; i++) drop(c, g, tt + rnd(0, .5)); }, .4, .6]])],
  b: ['rain on a tin roof', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'highpass', 1500, .7, .07).s],
    [[(g, tt) => { for (let i = 0; i < 10; i++) noise(c, g, tt + rnd(0, .5), { f: rnd(1500, 3500), q: 10, d: .03, v: rnd(.03, .07), pan: rnd(-.6, .6) }); }, .4, .6]])],
  c: ['soft rain', (c, o, t) => amb(c, o, t, (g, t0) => { const n = loopNoise(c, g, t0, 'lowpass', 1200, .5, .12); return [n.s, lfo(c, n.g.gain, .07, .04, t0)]; })]
}, { eleven: { prompt: 'Steady tropical rain falling on a tin roof at night, heard from inside a quiet room, even and continuous, seamless loop, no thunder, no music, no voices.', seconds: 18, loop: true } });
const rumble = (c, g, t, v) => { noise(c, g, t, { type: 'lowpass', f: 380, f2: 160, q: .7, a: .4, d: rnd(2.5, 4), v }); noise(c, g, t + rnd(.3, 1), { type: 'lowpass', f: 300, f2: 150, a: .5, d: rnd(2, 3.5), v: v * .7 }); };
def('amb-thunder', 'ambience', 'Thunder', 0, {
  a: ['distant rumble', (c, o, t) => amb(c, o, t, null, [[(g, tt) => rumble(c, g, tt, rnd(.12, .22)), 8, 25]])],
  b: ['rolling thunder', (c, o, t) => amb(c, o, t, null, [[(g, tt) => { for (let i = 0; i < 3; i++) rumble(c, g, tt + i * rnd(.8, 1.6), rnd(.08, .16)); }, 10, 25]])],
  c: ['crack + rumble', (c, o, t) => amb(c, o, t, null, [[(g, tt) => { noise(c, g, tt, { f: 1500, q: 1, a: .005, d: .25, v: .12 }); rumble(c, g, tt + .1, rnd(.14, .22)); }, 8, 25]])]
}, { eleven: { prompt: 'Distant rolling thunder over a tropical city during a rainstorm, low rumbles fading in and out, heard from indoors, seamless loop, no music, no voices.', seconds: 20, loop: true } });
const chirps = (c, g, t) => { let tt = t; const f = rnd(2200, 4000), n = 3 + (Math.random() * 4 | 0), pan = rnd(-.7, .7);
  for (let i = 0; i < n; i++) { tone(c, g, tt, { f, f2: f * rnd(.7, 1.35), a: .005, d: .06, v: .04, pan }); tt += rnd(.08, .13); } };
def('amb-birds', 'ambience', 'Birds', 0, {
  a: ['chirps', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'bandpass', 2500, .5, .012).s], [[(g, tt) => chirps(c, g, tt), 1.5, 5]])],
  b: ['warbler trills', (c, o, t) => amb(c, o, t, null, [[(g, tt) => { const f = rnd(2500, 3800); for (let i = 0; i < 8; i++) fm(c, g, tt + i * .06, { f: f + (i % 2) * 300, ratio: .5, index: .3, d: .05, v: .035 }); }, 2, 6], [(g, tt) => chirps(c, g, tt), 3, 8]])],
  c: ['doves + chirps', (c, o, t) => amb(c, o, t, null, [[(g, tt) => seq(tt, .5, [520, 470, 470], (f, t2) => tone(c, g, t2, { f, f2: f * .92, a: .08, d: .3, v: .05 })), 6, 14], [(g, tt) => chirps(c, g, tt), 2, 6]])]
}, { eleven: { prompt: 'Early morning tropical birds singing outside a window in the Philippines, sparse chirps and calls with soft leaves rustling, calm, seamless loop, no music, no voices.', seconds: 18, loop: true } });
const cricket = (c, g, t, f, pan) => { for (let i = 0; i < 4; i++) tone(c, g, t + i * .045, { f, a: .003, d: .025, v: .035, pan }); };
def('amb-crickets', 'ambience', 'Crickets', 0, {
  a: ['field crickets', (c, o, t) => amb(c, o, t, null, [[(g, tt) => cricket(c, g, tt, 4400, -.5), .6, 1.2], [(g, tt) => cricket(c, g, tt, 4750, .5), .7, 1.4]])],
  b: ['gecko + crickets', (c, o, t) => amb(c, o, t, null, [[(g, tt) => cricket(c, g, tt, 4500, 0), .6, 1.2],
    [(g, tt) => { for (let i = 0; i < 5; i++) { tone(c, g, tt + i * .7, { type: 'square', f: 700, a: .01, d: .1, v: .04, lp: 1200 }); tone(c, g, tt + i * .7 + .25, { type: 'square', f: 480, a: .01, d: .15, v: .04, lp: 1200 }); } }, 20, 40]])],
  c: ['soft night', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'lowpass', 700, .5, .03).s], [[(g, tt) => cricket(c, g, tt, 4300, rnd(-.5, .5)), 1.5, 3.5]])]
}, { eleven: { prompt: 'Warm tropical night outside a window: steady crickets chirping, an occasional distant gecko call, very calm, seamless loop, no music, no voices.', seconds: 18, loop: true } });
const swell = (c, g, t, v) => noise(c, g, t, { type: 'lowpass', f: 400, f2: 1300, a: 2.5, d: 4, v, pan: rnd(-.3, .3) });
def('amb-waves', 'ambience', 'Sea waves', 0, {
  a: ['gentle swells', (c, o, t) => amb(c, o, t, null, [[(g, tt) => swell(c, g, tt, .15), 5, 9]])],
  b: ['shore wash', (c, o, t) => amb(c, o, t, null, [[(g, tt) => { swell(c, g, tt, .13); noise(c, g, tt + 2.3, { type: 'highpass', f: 2500, a: 1, d: 2.5, v: .04 }); }, 6, 10]])],
  c: ['distant surf', (c, o, t) => amb(c, o, t, (g, t0) => { const n = loopNoise(c, g, t0, 'lowpass', 700, .5, .1); return [n.s, lfo(c, n.g.gain, .1, .06, t0)]; })]
}, { eleven: { prompt: 'Gentle sea waves rolling onto a sandy beach at a calm tropical shore, soft and slow, heard from a short distance, seamless loop, no music, no voices, no seagulls.', seconds: 20, loop: true } });
const car = (c, g, t) => noise(c, g, t, { f: 300, f2: 750, q: 1.5, a: 2.2, d: 2.5, v: .06, pan: rnd(-.6, .6) });
def('amb-city', 'ambience', 'City hum', 0, {
  a: ['low hum + cars', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'lowpass', 250, .5, .08).s, loopNoise(c, g, t0, 'bandpass', 900, .5, .02).s], [[(g, tt) => car(c, g, tt), 6, 15]])],
  b: ['busy distant traffic', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'lowpass', 350, .5, .09).s], [[(g, tt) => car(c, g, tt), 3, 8],
    [(g, tt) => seq(tt, .35, [440, 440], (f, t2) => tone(c, g, t2, { type: 'square', f, a: .02, d: .25, v: .012, lp: 1500 })), 30, 70]])],
  c: ['night city', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'lowpass', 250, .5, .06).s],
    [[(g, tt) => tone(c, g, tt, { type: 'sawtooth', f: 85, f2: 140, a: 1.5, d: 2, v: .04, lp: 600, pan: rnd(-.6, .6) }), 12, 30]])]
}, { eleven: { prompt: 'Distant city traffic hum heard through a closed window at night in a Philippine city, soft steady road noise with occasional far-away vehicles passing, seamless loop, no horns, no music, no voices.', seconds: 18, loop: true } });

window.BearWallSounds = R;

// self-check
const IDS = ('intro-hum intro-zip intro-clunk intro-tick intro-chord power-down sleep wake flip light-on light-off light-tick light-scene '
  + 'volume-tick blinds-close blinds-open hour-bell alert-info alert-warn alert-critical net-down net-up update pasok storm '
  + 'amb-rain amb-thunder amb-birds amb-crickets amb-waves amb-city').split(' ');
console.assert(IDS.every(id => R[id]) && Object.keys(R).length === IDS.length, 'sound ids match the contract');
console.assert(Object.values(R).every(s => Object.keys(s.variants).length >= 2 && Object.values(s.variants).every(v => typeof v.fn === 'function' && v.name)), 'every variant has a name and fn');
console.assert(Object.values(R).every(s => (s.type === 'ambience') === (s.len === 0)), 'ambience (and only ambience) has len 0');
console.assert(Object.values(R).every(s => !s.eleven || (s.eleven.seconds >= .5 && s.eleven.seconds <= 22 && s.eleven.prompt.length <= 450)), 'eleven prompts in range');
})();
