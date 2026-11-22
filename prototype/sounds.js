// BearWall sound designs: window.BearWallSounds, the registry sound.js plays from.
// Each id keeps the one synth design the user picked on the sound board (its letter kept, so saved picks still match).
// The real-world sounds play the ElevenLabs take saved on the projector; their synth here is only the fallback.
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
const blinds = open => (ctx, out, t) => {   // pull cord: even ratchet ticks, then a clack (close) or a soft bump (open)
  for (let i = 0; i < 17; i++) tone(ctx, out, t + i * .07, { type: 'triangle', f: 2500 + (open ? i * 20 : -i * 20), d: .012, v: .06 });
  noise(ctx, out, t + 1.25, open ? { type: 'lowpass', f: 700, d: .08, v: .12 } : { f: 1300, q: 3, d: .07, v: .22 });
};

// ---------- registry ----------
const R = {};
// Loudness: each candidate's measured peak brought to -3 dBFS (ticks -9, they repeat; ambience -8), so they compare fairly
// and level 13 really is as loud as the projector goes. Re-measure (scratchpad measure.js) after changing a design.
const BOOST = {'intro-hum.a': 2.56, 'intro-zip.a': 7.03, 'intro-clunk.a': 2.74, 'intro-tick.a': 4.64, 'intro-chord.a': 3.44, 'power-down.c': 9.15, 'sleep.a': 7.1, 'wake.a': 7.01, 'flip.c': 7.58, 'light-on.c': 8.92, 'light-off.a': 7.73, 'light-tick.c': 5.63, 'light-scene.c': 10.54, 'volume-tick.c': 3.95, 'blinds-close.c': 11.88, 'blinds-open.c': 12, 'hour-bell.c': 7.45, 'alert-info.b': 7.8, 'alert-warn.b': 5.93, 'alert-critical.a': 5.77, 'net-down.c': 7.15, 'net-up.c': 7.03, 'update.b': 7.22, 'pasok.c': 9.79, 'storm.c': 6.98, 'amb-rain.a': 3.14, 'amb-thunder.a': 11.02, 'amb-birds.a': 11.1, 'amb-crickets.a': 11.54, 'amb-waves.a': 6.83, 'amb-city.a': 12};
const def = (id, type, label, len, v, extra) => {
  R[id] = Object.assign({ type, label, len, variants: {} }, extra);
  Object.keys(v).forEach(k => {
    const fn = v[k][1], boost = BOOST[id + '.' + k] || 1;
    R[id].variants[k] = { name: v[k][0], fn: (c, o, t, p) => { const g = c.createGain(); g.gain.value = boost; g.connect(o); return fn(c, g, t, p || {}); } };
  });
};
const PENT = [0, 2, 4, 7, 9, 12, 14, 16];   // light-scene pitch steps (major pentatonic)
const CHORD = [523.3, 659.3, 784, 987.8];   // Cmaj7: calm, a bit sci-fi

// intro pieces
def('intro-hum', 'ui', 'Intro: power hum', 1.2, {
  a: ['warm sine swell', (c, o, t) => { [196, 294.5].forEach(f => tone(c, o, t, { f, a: .9, d: .35, v: .14 })); }],
});
def('intro-zip', 'ui', 'Intro: trace zip', .25, {
  a: ['sine sweep up', (c, o, t) => tone(c, o, t, { f: 600, f2: 2400, a: .01, d: .22, v: .1 })],
});
def('intro-clunk', 'ui', 'Intro: bracket clunk', .15, {
  a: ['soft thud', (c, o, t) => { tone(c, o, t, { f: 260, f2: 140, d: .12, v: .25 }); noise(c, o, t, { type: 'lowpass', f: 800, d: .04, v: .12 }); }],
});
def('intro-tick', 'ui', 'Intro: print tick', .03, {
  a: ['tiny click', (c, o, t) => noise(c, o, t, { type: 'highpass', f: 4000, d: .015, v: .08 })],
});
def('intro-chord', 'ui', 'Intro: final chord', 1.5, {
  a: ['soft major-7 pad', (c, o, t) => CHORD.forEach((f, i) => tone(c, o, t + i * .03, { f, a: .06, d: 1.4, v: .07 }))],
});
def('power-down', 'ui', 'Power down', 1.8, {
  c: ['reverse arpeggio + hum fade', (c, o, t) => { seq(t, .12, [987.8, 784, 659.3, 523.3, 392], (f, tt) => tone(c, o, tt, { type: 'triangle', f, d: .5, v: .07 })); noise(c, o, t + .5, { f: 1500, f2: 300, q: 2, a: .2, d: 1.1, v: .1 }); }]
});
// sleep / wake / flip
def('sleep', 'ui', 'Sleep', .4, {
  a: ['two notes down', (c, o, t) => seq(t, .12, [880, 659.3], (f, tt) => tone(c, o, tt, { f, d: .2, v: .1 }))],
});
def('wake', 'ui', 'Wake', .4, {
  a: ['two notes up', (c, o, t) => seq(t, .12, [659.3, 880], (f, tt) => tone(c, o, tt, { f, d: .2, v: .1 }))],
});
def('flip', 'ui', 'Picture flip', .8, {
  c: ['doppler tone', (c, o, t) => { tone(c, o, t, { f: 500, f2: 900, a: .3, d: .05, v: .1, pan: -.5 }); tone(c, o, t + .35, { f: 900, f2: 500, a: .02, d: .4, v: .1, pan: .5 }); }]
});
// Light mode
def('light-on', 'ui', 'Light mode on', .3, {
  c: ['FM ping', (c, o, t) => fm(c, o, t, { f: 1046.5, ratio: 2.5, index: 1, d: .25, v: .08 })]
});
def('light-off', 'ui', 'Light mode off', .3, {
  a: ['falling pair', (c, o, t) => seq(t, .07, [1568, 1046.5], (f, tt) => tone(c, o, tt, { f, d: .15, v: .09 }))],
});
def('light-tick', 'ui', 'Light brightness tick', .04, {
  c: ['soft triangle', (c, o, t) => tone(c, o, t, { type: 'triangle', f: 1200, d: .025, v: .07 })]
});
def('light-scene', 'ui', 'Light scene click', .25, {
  c: ['pluck', (c, o, t, p) => tone(c, o, t, { type: 'sawtooth', f: 392 * Math.pow(2, PENT[(p.pitch | 0) % 8] / 12), d: .2, v: .07, lp: 1800 })]
});
def('volume-tick', 'ui', 'Volume tick', .05, {
  c: ['noise click', (c, o, t) => noise(c, o, t, { f: 2000, q: 4, d: .02, v: .5 })]
});
def('blinds-close', 'ui', 'Blinds closing', 1.6, {
  c: ['cord + clack', blinds(false)]
}, { eleven: { prompt: 'Indoor venetian window blinds being lowered and closed: plastic slats sliding down and rattling softly, ending with a light clack as they settle. Close microphone, quiet room, no music, no voices.', seconds: 2, loop: false } });
def('blinds-open', 'ui', 'Blinds opening', 1.6, {
  c: ['cord + clack', blinds(true)]
}, { eleven: { prompt: 'Indoor venetian window blinds being pulled up and opened: cord pulled, plastic slats lifting and rattling, gathering at the top. Close microphone, quiet room, no music, no voices.', seconds: 2, loop: false } });
def('hour-bell', 'ui', 'Hourly bell', 2.5, {
  c: ['two-note chime', (c, o, t) => seq(t, .45, [659.3, 523.3], (f, tt) => fm(c, o, tt, { f, ratio: 3.5, index: .8, d: 1.8, v: .08 }))]
});

// alerts: info soft, warn clearer, critical urgent but rounded (lowpassed, no harsh square)
def('alert-info', 'alert', 'Alert: info', .4, {
  b: ['glass ping', (c, o, t) => fm(c, o, t, { f: 1046.5, ratio: 3.5, index: 1, d: .4, v: .09 })],
});
def('alert-warn', 'alert', 'Alert: warning', .7, {
  b: ['double FM ping', (c, o, t) => seq(t, .2, [987.8, 987.8], (f, tt) => fm(c, o, tt, { f, ratio: 2, index: 1.5, d: .3, v: .12 }))],
});
def('alert-critical', 'alert', 'Alert: critical', 1.3, {
  a: ['two-tone pulse x3', (c, o, t) => { for (let i = 0; i < 3; i++) seq(t + i * .4, .16, [987.8, 740], (f, tt) => tone(c, o, tt, { type: 'square', f, a: .01, d: .13, v: .1, lp: 2500 })); }],
}, { critical: true });
def('net-down', 'alert', 'Internet down', .8, {
  c: ['descending FM blips', (c, o, t) => seq(t, .15, [1046.5, 880, 698.5, 523.3], (f, tt) => fm(c, o, tt, { f, ratio: 1.5, index: 1, d: .15, v: .1 }))]
});
def('net-up', 'alert', 'Internet back', .8, {
  c: ['ascending FM blips', (c, o, t) => seq(t, .15, [523.3, 698.5, 880, 1046.5], (f, tt) => fm(c, o, tt, { f, ratio: 1.5, index: 1, d: .15, v: .1 }))]
});
def('update', 'alert', 'Update', .8, {
  b: ['two FM bells', (c, o, t) => seq(t, .2, [784, 1174.7], (f, tt) => fm(c, o, tt, { f, ratio: 3.5, index: 1, d: .6, v: .09 }))],
});
def('pasok', 'alert', 'Classes suspended!', 1.2, {
  c: ['brassy rise', (c, o, t) => seq(t, .12, [392, 523.3, 659.3, 784], (f, tt) => tone(c, o, tt, { type: 'sawtooth', f, a: .02, d: f === 784 ? .7 : .14, v: .07, lp: 1800 }))]
});
def('storm', 'alert', 'Storm warning', 1.6, {
  c: ['rumble + FM alarm', (c, o, t) => { noise(c, o, t, { type: 'lowpass', f: 350, a: .3, d: 1.2, v: .18 }); seq(t + .1, .15, [987.8, 987.8, 987.8, 740, 740, 740], (f, tt) => fm(c, o, tt, { f, ratio: 2, index: 1.5, d: .12, v: .09 })); }]
}, { critical: true });

// ambience beds (len 0: they loop until stop)
const drop = (c, g, t) => tone(c, g, t, { f: rnd(2500, 5000), f2: 1800, a: .001, d: .02, v: rnd(.008, .02), pan: rnd(-.6, .6) });
def('amb-rain', 'ambience', 'Rain', 0, {
  a: ['steady rain', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'bandpass', 3000, .7, .12).s, loopNoise(c, g, t0, 'lowpass', 600, .7, .05).s],
    [[(g, tt) => { for (let i = 0; i < 8; i++) drop(c, g, tt + rnd(0, .5)); }, .4, .6]])],
}, { eleven: { prompt: 'Steady tropical rain falling on a tin roof at night, heard from inside a quiet room, even and continuous, seamless loop, no thunder, no music, no voices.', seconds: 18, loop: true } });
const rumble = (c, g, t, v) => { noise(c, g, t, { type: 'lowpass', f: 380, f2: 160, q: .7, a: .4, d: rnd(2.5, 4), v }); noise(c, g, t + rnd(.3, 1), { type: 'lowpass', f: 300, f2: 150, a: .5, d: rnd(2, 3.5), v: v * .7 }); };
def('amb-thunder', 'ambience', 'Thunder', 0, {
  a: ['distant rumble', (c, o, t) => amb(c, o, t, null, [[(g, tt) => rumble(c, g, tt, rnd(.12, .22)), 8, 25]])],
}, { eleven: { prompt: 'Distant rolling thunder over a tropical city during a rainstorm, low rumbles fading in and out, heard from indoors, seamless loop, no music, no voices.', seconds: 20, loop: true } });
const chirps = (c, g, t) => { let tt = t; const f = rnd(2200, 4000), n = 3 + (Math.random() * 4 | 0), pan = rnd(-.7, .7);
  for (let i = 0; i < n; i++) { tone(c, g, tt, { f, f2: f * rnd(.7, 1.35), a: .005, d: .06, v: .04, pan }); tt += rnd(.08, .13); } };
def('amb-birds', 'ambience', 'Birds', 0, {
  a: ['chirps', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'bandpass', 2500, .5, .012).s], [[(g, tt) => chirps(c, g, tt), 1.5, 5]])],
}, { eleven: { prompt: 'Early morning tropical birds singing outside a window in the Philippines, sparse chirps and calls with soft leaves rustling, calm, seamless loop, no music, no voices.', seconds: 18, loop: true } });
const cricket = (c, g, t, f, pan) => { for (let i = 0; i < 4; i++) tone(c, g, t + i * .045, { f, a: .003, d: .025, v: .035, pan }); };
def('amb-crickets', 'ambience', 'Crickets', 0, {
  a: ['field crickets', (c, o, t) => amb(c, o, t, null, [[(g, tt) => cricket(c, g, tt, 4400, -.5), .6, 1.2], [(g, tt) => cricket(c, g, tt, 4750, .5), .7, 1.4]])],
}, { eleven: { prompt: 'Warm tropical night outside a window: steady crickets chirping, an occasional distant gecko call, very calm, seamless loop, no music, no voices.', seconds: 18, loop: true } });
const swell = (c, g, t, v) => noise(c, g, t, { type: 'lowpass', f: 400, f2: 1300, a: 2.5, d: 4, v, pan: rnd(-.3, .3) });
def('amb-waves', 'ambience', 'Sea waves', 0, {
  a: ['gentle swells', (c, o, t) => amb(c, o, t, null, [[(g, tt) => swell(c, g, tt, .15), 5, 9]])],
}, { eleven: { prompt: 'Gentle sea waves rolling onto a sandy beach at a calm tropical shore, soft and slow, heard from a short distance, seamless loop, no music, no voices, no seagulls.', seconds: 20, loop: true } });
const car = (c, g, t) => noise(c, g, t, { f: 300, f2: 750, q: 1.5, a: 2.2, d: 2.5, v: .06, pan: rnd(-.6, .6) });
def('amb-city', 'ambience', 'City hum', 0, {
  a: ['low hum + cars', (c, o, t) => amb(c, o, t, (g, t0) => [loopNoise(c, g, t0, 'lowpass', 250, .5, .08).s, loopNoise(c, g, t0, 'bandpass', 900, .5, .02).s], [[(g, tt) => car(c, g, tt), 6, 15]])],
}, { eleven: { prompt: 'Distant city traffic hum heard through a closed window at night in a Philippine city, soft steady road noise with occasional far-away vehicles passing, seamless loop, no horns, no music, no voices.', seconds: 18, loop: true } });

window.BearWallSounds = R;

// self-check
const IDS = ('intro-hum intro-zip intro-clunk intro-tick intro-chord power-down sleep wake flip light-on light-off light-tick light-scene '
  + 'volume-tick blinds-close blinds-open hour-bell alert-info alert-warn alert-critical net-down net-up update pasok storm '
  + 'amb-rain amb-thunder amb-birds amb-crickets amb-waves amb-city').split(' ');
console.assert(IDS.every(id => R[id]) && Object.keys(R).length === IDS.length, 'sound ids match the contract');
console.assert(Object.values(R).every(s => Object.keys(s.variants).length === 1 && Object.values(s.variants).every(v => typeof v.fn === 'function' && v.name)), 'one variant per sound (the sound board winner) with a name and fn');
console.assert(Object.values(R).every(s => (s.type === 'ambience') === (s.len === 0)), 'ambience (and only ambience) has len 0');
console.assert(Object.values(R).every(s => !s.eleven || (s.eleven.seconds >= .5 && s.eleven.seconds <= 22 && s.eleven.prompt.length <= 450)), 'eleven prompts in range');
})();
