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

// One short "clack": filtered noise plus a tiny high ping, like two clay chips touching.
function clack(ac, when, level = 1) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2600 + Math.random() * 1600;
  bp.Q.value = 4;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.5 * level, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(when, Math.random() * 0.3, 0.06);

  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 3800 + Math.random() * 900;
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, when);
  og.gain.exponentialRampToValueAtTime(0.08 * level, when + 0.002);
  og.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  osc.connect(og).connect(ac.destination);
  osc.start(when);
  osc.stop(when + 0.04);
}

export function chipSound(count = 1) {
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
// A dealt card: a soft paper slide across the felt, then a crisp snap as it lands and flips.
export function cardSound() {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = Math.max(ac.currentTime + 0.01, lastCard + 0.11);
  lastCard = t;
  // Slide: noise swept from high to mid, rising then fading.
  const slide = ac.createBufferSource();
  slide.buffer = noise(ac);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(5200, t);
  bp.frequency.exponentialRampToValueAtTime(1700, t + 0.13);
  const sg = ac.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  slide.connect(bp).connect(sg).connect(ac.destination);
  slide.start(t, Math.random() * 0.3, 0.17);
  // Snap: a short bright click with a little body underneath.
  const at = t + 0.13;
  const snap = ac.createBufferSource();
  snap.buffer = noise(ac);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2400;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.0001, at);
  ng.gain.exponentialRampToValueAtTime(0.42, at + 0.002);
  ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
  snap.connect(hp).connect(ng).connect(ac.destination);
  snap.start(at, Math.random() * 0.3, 0.05);
  const body = ac.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(320, at);
  body.frequency.exponentialRampToValueAtTime(140, at + 0.05);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(0.0001, at);
  bg.gain.exponentialRampToValueAtTime(0.14, at + 0.003);
  bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
  body.connect(bg).connect(ac.destination);
  body.start(at);
  body.stop(at + 0.08);
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
  o.connect(g).connect(ac.destination);
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
  n.connect(lp).connect(ng).connect(ac.destination);
  n.start(when, Math.random() * 0.3, 0.06);
}

// Hit: two taps on the table, the way players ask for a card.
export function hitSound() {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  knock(ac, t, 1);
  knock(ac, t + 0.13, 0.8);
}

// Stand: a soft wave of the hand, an airy sweep with a low settle at the end.
export function standSound() {
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
  n.connect(bp).connect(g).connect(ac.destination);
  n.start(t, 0, 0.4);
  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(392, t + 0.18);
  o.frequency.exponentialRampToValueAtTime(294, t + 0.4);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, t + 0.18);
  og.gain.exponentialRampToValueAtTime(0.06, t + 0.2);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(og).connect(ac.destination);
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
  o.connect(f).connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + 0.1);
}

// Win: a bright rising chime (major arpeggio with a soft bell tone) and a shower of chips.
export function winSound(big = false) {
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
      o.connect(g).connect(ac.destination);
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
  o.connect(g).connect(ac.destination);
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
  n.connect(f).connect(g).connect(ac.destination);
  n.start(t, Math.random() * 0.2, dur + 0.02);
}

export function throwSound(item, stage) {
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
      o.connect(lp).connect(g).connect(ac.destination);
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
