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
export function cardSound() {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;
  const t = Math.max(now + 0.01, lastCard + 0.09);
  lastCard = t;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  src.connect(hp).connect(g).connect(ac.destination);
  src.start(t, Math.random() * 0.3, 0.14);
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
