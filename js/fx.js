// Sounds and chip motion. Sounds are made in the browser (Web Audio), so there are no sound files.

let ctx = null;
let muted = false;
try { muted = localStorage.getItem('bj-mute') === '1'; } catch {}

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('bj-mute', v ? '1' : '0'); } catch {}
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// ---------- Volume ----------
// Every sound goes through one of three groups (game sounds, effects, horns) and then the main volume.
// Each player sets these on their own screen; the browser remembers them.
const VOL_KEY = 'bj-vol', VOL_DEF = { main: 100, game: 100, fx: 100, horn: 100 };
let vol = { ...VOL_DEF }, grp = 'game', buses = null;
try { const v = JSON.parse(localStorage.getItem(VOL_KEY) || '{}'); for (const k of Object.keys(VOL_DEF)) if (Number.isFinite(v[k])) vol[k] = Math.max(0, Math.min(100, v[k])); } catch { /* the defaults stay */ }
const gainOf = (v) => (v / 100) ** 2; // the square makes the slider feel even to the ear
function bus(ac) {
  if (!buses || buses.ac !== ac) {
    buses = { ac, main: ac.createGain() };
    buses.main.connect(ac.destination);
    for (const k of ['game', 'fx', 'horn']) { buses[k] = ac.createGain(); buses[k].connect(buses.main); }
    for (const k of Object.keys(VOL_DEF)) buses[k].gain.value = gainOf(vol[k]);
  }
  return buses[grp] || buses.game;
}
export function getVolume() { return { ...vol }; }
export function setVolume(key, value) {
  if (!(key in VOL_DEF)) return;
  vol[key] = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  if (buses) buses[key].gain.value = gainOf(vol[key]);
  try { localStorage.setItem(VOL_KEY, JSON.stringify(vol)); } catch { /* not saved, still set for now */ }
}
// The punch after a bad beat in poker: knocks, in the effects group.
export function punchSound() {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  grp = 'fx';
  const t = ac.currentTime + 0.01;
  knock(ac, t, 1); knock(ac, t + 0.09, 0.7);
}
// Browsers only allow sound after the first tap or click.
window.addEventListener('pointerdown', () => audio(), { once: true });

let noiseBuf = null;
function noise(ac) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// One clay chip landing on other chips: a hard click, two short ringing tones as a heavy clay chip makes,
// and a soft thud from the cloth under the pile.
function clack(ac, when, level = 1) {
  const out = bus(ac), k = 0.9 + Math.random() * 0.25;
  const src = ac.createBufferSource(); src.buffer = noise(ac);
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000 * k; bp.Q.value = 2.2;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.5 * level, when + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  src.connect(bp).connect(g).connect(out); src.start(when, Math.random() * 0.3, 0.04);
  for (const [f, lvl, dur] of [[2150 * k, 0.16, 0.075], [3380 * k, 0.09, 0.05], [5100 * k, 0.04, 0.03]]) {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, when); og.gain.exponentialRampToValueAtTime(lvl * level, when + 0.0015); og.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(og).connect(out); o.start(when); o.stop(when + dur + 0.01);
  }
  const th = ac.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(230, when); th.frequency.exponentialRampToValueAtTime(110, when + 0.04);
  const tg = ac.createGain(); tg.gain.setValueAtTime(0.0001, when); tg.gain.exponentialRampToValueAtTime(0.12 * level, when + 0.002); tg.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  th.connect(tg).connect(out); th.start(when); th.stop(when + 0.07);
}

export function chipSound(count = 1) {
  grp = 'game';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  clack(ac, t, 1);
  clack(ac, t + 0.035 + Math.random() * 0.02, 0.6);
  for (let i = 1; i < count; i++) {
    const w = t + i * (0.06 + Math.random() * 0.04);
    clack(ac, w, 0.8);
    clack(ac, w + 0.03, 0.5);
  }
}

let lastCard = 0;
// A dealt card: a very short paper slide, then a firm flat slap on the felt with a low thump under it.
// (Made in the browser. Free sound files could not be fetched from the build machine.)
export function cardSound() {
  grp = 'game';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = Math.max(ac.currentTime + 0.01, lastCard + 0.09);
  lastCard = t;
  const out = bus(ac), vary = 0.92 + Math.random() * 0.16; // each card sounds a touch different
  // Slide: a quick whisper of paper.
  const slide = ac.createBufferSource(); slide.buffer = noise(ac);
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(6500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.06);
  const sg = ac.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.07, t + 0.03); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  slide.connect(bp).connect(sg).connect(out); slide.start(t, Math.random() * 0.3, 0.08);
  // Slap: the flat of the card on the cloth. Mid noise, very fast attack, short tail.
  const at = t + 0.06;
  const slap = ac.createBufferSource(); slap.buffer = noise(ac);
  const lp = ac.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 1500 * vary; lp.Q.value = 0.7;
  const ng = ac.createGain(); ng.gain.setValueAtTime(0.0001, at); ng.gain.exponentialRampToValueAtTime(0.6, at + 0.0015); ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
  slap.connect(lp).connect(ng).connect(out); slap.start(at, Math.random() * 0.3, 0.06);
  // Tick: the crisp edge of the snap.
  const tick = ac.createBufferSource(); tick.buffer = noise(ac);
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
  const tg = ac.createGain(); tg.gain.setValueAtTime(0.0001, at); tg.gain.exponentialRampToValueAtTime(0.3, at + 0.001); tg.gain.exponentialRampToValueAtTime(0.0001, at + 0.014);
  tick.connect(hp).connect(tg).connect(out); tick.start(at, Math.random() * 0.3, 0.02);
  // Thump: the table under the cloth.
  const body = ac.createOscillator(); body.type = 'sine';
  body.frequency.setValueAtTime(190 * vary, at); body.frequency.exponentialRampToValueAtTime(85, at + 0.06);
  const bg = ac.createGain(); bg.gain.setValueAtTime(0.0001, at); bg.gain.exponentialRampToValueAtTime(0.3, at + 0.003); bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
  body.connect(bg).connect(out); body.start(at); body.stop(at + 0.1);
}

// Low knock on the felt.
function knock(ac, when, level) {
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(180, when);
  o.frequency.exponentialRampToValueAtTime(70, when + 0.08);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.5 * level, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
  o.connect(g).connect(bus(ac));
  o.start(when);
  o.stop(when + 0.13);
  const n = ac.createBufferSource();
  n.buffer = noise(ac);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.0001, when);
  ng.gain.exponentialRampToValueAtTime(0.35 * level, when + 0.003);
  ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  n.connect(lp).connect(ng).connect(bus(ac));
  n.start(when, Math.random() * 0.3, 0.06);
}

// Hit: two taps on the table, the way players ask for a card.
export function hitSound() {
  grp = 'game';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  knock(ac, t, 1);
  knock(ac, t + 0.13, 0.8);
}

// Stand: a soft wave of the hand, an airy sweep with a low settle at the end.
export function standSound() {
  grp = 'game';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  const n = ac.createBufferSource();
  n.buffer = noise(ac);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.16);
  bp.frequency.exponentialRampToValueAtTime(900, t + 0.34);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.14);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
  n.connect(bp).connect(g).connect(bus(ac));
  n.start(t, 0, 0.4);
  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(392, t + 0.18);
  o.frequency.exponentialRampToValueAtTime(294, t + 0.4);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, t + 0.18);
  og.gain.exponentialRampToValueAtTime(0.06, t + 0.2);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(og).connect(bus(ac));
  o.start(t + 0.18);
  o.stop(t + 0.5);
}

// ---------- Chips ----------
export const CHIP_VALUES = [500, 100, 25, 5, 1];

// Split an amount into chips, largest first, for drawing a stack.
export function chipsFor(amount, max = 10) {
  const out = [];
  let left = Math.floor(amount);
  for (const v of CHIP_VALUES) {
    while (left >= v && out.length < max) { out.push(v); left -= v; }
  }
  return out;
}

export function chipClass(v) {
  return 'cv' + (v >= 500 ? 500 : v >= 100 ? 100 : v >= 25 ? 25 : v >= 5 ? 5 : 1);
}

export function stackHTML(amount) {
  if (!amount) return '';
  const chips = chipsFor(amount).reverse(); // smallest at the bottom
  return `<div class="stack">${chips.map((v, i) => `<span class="chipv sm ${chipClass(v)}" style="--i:${i}"></span>`).join('')}</div>`;
}

// Fly one chip from one place on screen to another.
export function flyChip(from, to, value, delay = 0, sound = true) {
  if (!from || !to) return;
  const a = from.getBoundingClientRect ? from.getBoundingClientRect() : from;
  const b = to.getBoundingClientRect ? to.getBoundingClientRect() : to;
  if (!a.width && !b.width) return;
  const size = 30;
  const el = document.createElement('div');
  el.className = `chipv fly ${chipClass(value)}`;
  el.style.width = el.style.height = size + 'px';
  el.style.left = a.left + a.width / 2 - size / 2 + 'px';
  el.style.top = a.top + a.height / 2 - size / 2 + 'px';
  document.body.appendChild(el);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const lift = Math.min(80, Math.hypot(dx, dy) / 4);
  const anim = el.animate([
    { transform: 'translate(0,0) scale(1.15)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(1.05)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(.9)`, opacity: 1 },
  ], { duration: 420, delay, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
  anim.onfinish = () => {
    if (sound) chipSound();
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).onfinish = () => el.remove();
  };
}

// Short tick for the last seconds before your time runs out.
export function tickSound(last = false) {
  grp = 'game';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  const o = ac.createOscillator();
  o.type = 'square';
  o.frequency.value = last ? 1320 : 990;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 3000;
  o.connect(f).connect(g).connect(bus(ac));
  o.start(t);
  o.stop(t + 0.1);
}

// Your turn: two short soft notes, the second higher.
export function turnSound() {
  grp = 'game';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  [[660, 0], [880, 0.11]].forEach(([hz, at]) => {
    const t = ac.currentTime + 0.01 + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(bus(ac)); o.start(t); o.stop(t + 0.18);
  });
}

// Win: a bright rising chime (major arpeggio with a soft bell tone) and a shower of chips.
export function winSound(big = false) {
  grp = 'game';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + 0.02;
  const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [659.25, 830.61, 987.77, 1318.5];
  notes.forEach((f, i) => {
    const t = t0 + i * 0.075;
    for (const [mult, lvl] of [[1, 0.16], [2, 0.05], [3.01, 0.025]]) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(lvl, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(bus(ac));
      o.start(t);
      o.stop(t + 1);
    }
  });
  setTimeout(() => chipSound(big ? 8 : 5), 260);
}

// ---------- Funny sounds for things thrown at players ----------
function tone(ac, type, f0, f1, t, dur, level) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus(ac));
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}
function burst(ac, t, dur, level, type, freq, q = 1) {
  const n = ac.createBufferSource();
  n.buffer = noise(ac);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(g).connect(bus(ac));
  n.start(t, Math.random() * 0.2, dur + 0.02);
}

export function throwSound(item, stage) {
  grp = 'fx';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  if (stage === 'whoosh') {
    // Cartoon whistle while it flies.
    tone(ac, 'sine', 1400, 500, t, 0.7, 0.05);
    return;
  }
  switch (item) {
    case 'egg': // crack then a wet splat
      burst(ac, t, 0.04, 0.5, 'highpass', 3000);
      burst(ac, t + 0.05, 0.25, 0.4, 'lowpass', 900);
      tone(ac, 'sine', 600, 120, t + 0.05, 0.2, 0.12);
      break;
    case 'tomato': // big squelch
      burst(ac, t, 0.35, 0.5, 'lowpass', 700);
      tone(ac, 'sawtooth', 220, 60, t, 0.3, 0.08);
      break;
    case 'punch': // a hard slap of noise, a low body thud, then a short cartoon "oof" drop
      burst(ac, t, 0.05, 0.9, 'bandpass', 1800, 0.7);
      burst(ac, t, 0.12, 0.8, 'lowpass', 320);
      tone(ac, 'sine', 170, 45, t, 0.16, 0.5);
      tone(ac, 'square', 420, 140, t + 0.09, 0.16, 0.07);
      break;
    case 'poop': // wet plop and a low squish
      burst(ac, t, 0.3, 0.5, 'lowpass', 500);
      tone(ac, 'sine', 300, 70, t, 0.25, 0.2);
      tone(ac, 'sine', 160, 60, t + 0.18, 0.2, 0.12);
      break;
    case 'fart': { // a long wobbly raspberry
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.7);
      const lfo = ac.createOscillator();
      lfo.frequency.value = 28;
      const lg = ac.createGain();
      lg.gain.value = 30;
      lfo.connect(lg).connect(o.frequency);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.04);
      g.gain.setValueAtTime(0.3, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      o.connect(lp).connect(g).connect(bus(ac));
      o.start(t); lfo.start(t);
      o.stop(t + 0.8); lfo.stop(t + 0.8);
      tone(ac, 'sine', 800, 1600, t + 0.8, 0.15, 0.05);
      break;
    }
    case 'clap':
      for (let i = 0; i < 6; i++) burst(ac, t + i * 0.11 + Math.random() * 0.02, 0.06, 0.4, 'bandpass', 1500, 0.8);
      break;
    case 'beer': // glass clink
      tone(ac, 'sine', 2637, 2600, t, 0.5, 0.12);
      tone(ac, 'sine', 3951, 3900, t, 0.35, 0.06);
      break;
    case 'rose': // sweet chime
      [784, 988, 1175].forEach((f, i) => tone(ac, 'sine', f, f, t + i * 0.09, 0.6, 0.1));
      break;
    case 'fire':
      burst(ac, t, 0.6, 0.3, 'bandpass', 500, 0.6);
      tone(ac, 'triangle', 200, 900, t, 0.4, 0.06);
      break;
    case 'cry': // sad trombone
      [[392, 0], [370, 0.28], [349, 0.56], [330, 0.84]].forEach(([f, d], i) => tone(ac, 'sawtooth', f, i === 3 ? f * 0.94 : f, t + d, i === 3 ? 0.7 : 0.26, 0.06));
      break;
  }
}

// ---------- Roulette: the ball on the wheel ----------
// A steady rolling hiss while the ball runs round the rim, clicks over the frets, and a last rattle into the pocket.
// roll(speed): speed is the ball's turning speed in radians a second; the sound gets lower and softer as it slows.
export function spinSound() {
  grp = 'game';
  const ac = muted ? null : audio();
  if (!ac) return { roll() {}, click() {}, drop() {}, stop() {} };
  const src = ac.createBufferSource();
  src.buffer = noise(ac); src.loop = true;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.4;
  const g = ac.createGain(); g.gain.value = 0.0001;
  // The ball passes the listener once a turn, so the hiss swells and fades with each lap.
  const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 1.5; lg.gain.value = 0;
  lfo.connect(lg).connect(g.gain);
  src.connect(bp).connect(g).connect(bus(ac));
  src.start(); lfo.start();
  let dead = false, lastClick = 0;
  const end = () => { if (dead) return; dead = true; try { g.gain.cancelScheduledValues(ac.currentTime); g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.05); src.stop(ac.currentTime + 0.3); lfo.stop(ac.currentTime + 0.3); } catch { /* already stopped */ } };
  return {
    roll(speed) {
      if (dead) return;
      const v = Math.min(1, Math.abs(speed) / 10), t = ac.currentTime;
      g.gain.setTargetAtTime(muted ? 0.0001 : 0.02 + 0.13 * v, t, 0.08);
      lg.gain.setTargetAtTime(muted ? 0 : 0.012 + 0.05 * v, t, 0.08);
      bp.frequency.setTargetAtTime(700 + 2600 * v, t, 0.08);
      lfo.frequency.setTargetAtTime(Math.max(0.3, Math.abs(speed) / (Math.PI * 2)), t, 0.08);
    },
    click(level = 1) { if (dead || muted || ac.currentTime - lastClick < 0.035) return; lastClick = ac.currentTime; clack(ac, ac.currentTime, 0.5 * level); tone(ac, 'triangle', 2100 + Math.random() * 500, 1500, ac.currentTime, 0.035, 0.05 * level); },
    drop() { if (dead) return; const t = ac.currentTime; g.gain.setTargetAtTime(0.0001, t, 0.04); lg.gain.setTargetAtTime(0, t, 0.04); if (muted) return; [0, 0.07, 0.125, 0.165].forEach((d, i) => { clack(ac, t + d, 0.7 / (i + 1)); tone(ac, 'sine', 520 - i * 40, 300, t + d, 0.06, 0.12 / (i + 1)); }); },
    stop: end,
  };
}

// Poker: you won the pot. Two bright bell notes going up, then the chips being pulled in. Our own sound.
export function potSound() {
  grp = 'game';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + 0.02;
  [[880, 0], [1318.5, 0.11], [1760, 0.22]].forEach(([f, d]) => {
    for (const [mult, lvl, dur] of [[1, 0.2, 0.7], [2.0, 0.07, 0.4], [2.99, 0.035, 0.25], [4.2, 0.02, 0.15]]) {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(lvl, t0 + d + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + dur);
      o.connect(g).connect(bus(ac)); o.start(t0 + d); o.stop(t0 + d + dur + 0.05);
    }
  });
  for (let i = 0; i < 9; i++) clack(ac, t0 + 0.34 + i * 0.045 + Math.random() * 0.02, 0.55 - i * 0.03);
}

// ---------- Shout buttons: Bussss and Split it ----------
// Loud made up sounds, built from tones and noise in the browser. No recording and nobody's voice.
function horn(ac, out, t, dur, base, level) {
  // An air horn: three reedy notes at once, a touch out of tune, through a nasal filter.
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = base * 2.2; f.Q.value = 0.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.02);
  g.gain.setValueAtTime(level, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g).connect(out);
  for (const m of [1, 1.26, 1.5]) {
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * m * 0.94, t); o.frequency.exponentialRampToValueAtTime(base * m, t + 0.05);
    o.detune.value = (Math.random() - 0.5) * 24;
    o.connect(f); o.start(t); o.stop(t + dur + 0.02);
  }
}
function hiss(ac, out, t, dur, level, type, f0, f1, q = 1) {
  const n = ac.createBufferSource(); n.buffer = noise(ac); n.loop = true;
  const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + dur + 0.02);
}
export function shoutSound(kind) {
  grp = 'horn';
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  // Everything goes through one path that keeps the sound in the middle: nothing under about 200 Hz (no rumble),
  // nothing sharp above about 3 kHz, a limiter so many presses at once never crackle, and a low volume.
  const out = ac.createBiquadFilter(); out.type = 'highpass'; out.frequency.value = 200; out.Q.value = 0.5;
  const top = ac.createBiquadFilter(); top.type = 'lowpass'; top.frequency.value = 3000; top.Q.value = 0.5;
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -20; lim.ratio.value = 10; lim.attack.value = 0.003; lim.release.value = 0.12;
  const master = ac.createGain(); master.gain.value = 0.32;
  out.connect(top).connect(lim).connect(master).connect(bus(ac));
  if (kind !== 'bus' && kind !== 'split') { knock(ac, t, 1); knock(ac, t + 0.13, 0.8); return; }
  if (kind === 'bus') {
    // Two short horn toots and one longer one, with a soft whoop that climbs under the last.
    horn(ac, out, t, 0.09, 330, 0.3); horn(ac, out, t + 0.12, 0.09, 330, 0.3); horn(ac, out, t + 0.24, 0.34, 392, 0.34);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(330, t + 0.24); o.frequency.exponentialRampToValueAtTime(880, t + 0.56);
    g.gain.setValueAtTime(0.0001, t + 0.24); g.gain.exponentialRampToValueAtTime(0.16, t + 0.34); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(out); o.start(t + 0.24); o.stop(t + 0.62);
  } else if (kind === 'split') {
    // A short record scratch back and forth, then two soft knocks.
    const cuts = [[0, 0.08, 500, 1500], [0.09, 0.07, 1500, 450], [0.18, 0.1, 550, 1700]];
    for (const [d, len, a, b] of cuts) {
      hiss(ac, out, t + d, len, 1.2, 'bandpass', a, b, 3);
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle';
      o.frequency.setValueAtTime(a / 2, t + d); o.frequency.exponentialRampToValueAtTime(b / 2, t + d + len);
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.3, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d + len);
      o.connect(g).connect(out); o.start(t + d); o.stop(t + d + len + 0.02);
    }
    for (const [d, f] of [[0.32, 420], [0.44, 320]]) {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(f, t + d); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + d + 0.1);
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.5, t + d + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.13);
      o.connect(g).connect(out); o.start(t + d); o.stop(t + d + 0.15);
      hiss(ac, out, t + d, 0.05, 0.25, 'bandpass', 1200, 900, 1);
    }
  }
  setTimeout(() => master.disconnect(), 1500);
}
