// The roulette wheel that pops up on every screen for each spin: a turning wheel and a ball that runs round the
// rim, slows, drops, bounces off the frets and settles in the pocket of the number the host's spin gave.
// The path is worked out backwards from that pocket, so the ball always ends on the real number, and it is a pure
// function of the time since the spin started, so every screen shows the same motion.
import { WHEEL, colorOf } from './roulette.js?v=20261122zx';
const fx = typeof window !== 'undefined' ? import('./fx.js?v=20261122zx') : null; // sounds need a browser; the tests load this file without one

const TAU = Math.PI * 2, STEP = TAU / 37;
const COLORS = { red: '#c62f2f', black: '#17191f', green: '#1f9a4d' };
// A small repeatable random number from the spin, so each spin looks different but is the same on every screen.
function seeded(seed) { let x = (seed * 2654435761) >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

// Where the wheel and the ball are at time t (seconds) of a spin that lasts T seconds and ends on number n.
// Angles are in radians, clockwise positive, 0 at the top. Radii are parts of the wheel's radius.
export function wheelState(n, seed, t, T) {
  const R = seeded(seed + n * 101 + 7);
  const w0 = R() * TAU, wSpeed = 0.75 + R() * 0.25;                 // the wheel turns clockwise and slows a little
  const hops = 6 + Math.floor(R() * 5), v0 = 8.5 + R() * 2;           // pockets the ball crosses while dropping; its first speed on the rim
  const T1 = T * 0.6, T2 = T * 0.86;                                  // T1: the ball leaves the rim. T2: it lies still in its pocket
  const tt = Math.max(0, Math.min(T, t));
  const W = (s) => w0 + wSpeed * s * (1 - 0.3 * s / T), dW = (s) => wSpeed * (1 - 0.6 * s / T);
  const pocket = WHEEL.indexOf(n) * STEP;
  const D = hops * STEP, span = T2 - T1;
  const wheel = W(tt);
  const RIM = 0.9, DEF = 0.72, POCKET = 0.565;
  let ball, r, lift = 0, phase;
  if (tt >= T2) { ball = wheel + pocket; r = POCKET; phase = 3; }
  else if (tt >= T1) {
    // Dropping: the ball still runs against the wheel, slower and slower, and hops over the frets on its way in.
    const u = (tt - T1) / span;
    ball = wheel + pocket + D * (1 - u) * (1 - u);
    const bounce = Math.abs(Math.sin(u * Math.PI * (2 + (hops % 3)))) * (1 - u) * (1 - u);
    r = POCKET + (DEF - POCKET) * (1 - u) * (1 - u) + bounce * 0.05;
    lift = bounce;
    phase = 2;
  } else {
    // On the rim, against the wheel's turn. Its speed at T1 joins the dropping part without a jump.
    const v1 = dW(T1) - 2 * D / span;            // speed at the end of the rim part (negative: against the wheel)
    const vStart = -v0, a = (v1 - vStart) / T1;  // it loses speed evenly
    const end = W(T1) + pocket + D;              // where it is at T1
    const back = T1 - tt;                        // time still to go on the rim
    ball = end - (v1 * back - 0.5 * a * back * back);
    const q = tt / T1;
    r = q < 0.78 ? RIM : RIM - (RIM - DEF) * ((q - 0.78) / 0.22) ** 2;
    phase = 1;
  }
  return { wheel, ball, r, lift, phase, T1, T2 };
}

// Paints the wheel with its ball. st: a wheelState, or { wheel } with ball null for a wheel with no ball on it.
export function drawWheel(g, size, st, n, done) {
  const c = size / 2, R = size * 0.47;
  g.clearRect(0, 0, size, size);
  g.save(); g.translate(c, c);
  // The wooden bowl and the ball track.
  let gr = g.createRadialGradient(0, 0, R * 0.7, 0, 0, R);
  gr.addColorStop(0, '#5a3418'); gr.addColorStop(0.75, '#8a5530'); gr.addColorStop(1, '#3a2010');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  g.lineWidth = R * 0.012; g.strokeStyle = '#d9b45a'; g.beginPath(); g.arc(0, 0, R * 0.985, 0, TAU); g.stroke();
  gr = g.createRadialGradient(0, 0, R * 0.74, 0, 0, R * 0.95);
  gr.addColorStop(0, '#2a1a10'); gr.addColorStop(0.5, '#4a2e1a'); gr.addColorStop(1, '#6d4526');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.95, 0, TAU); g.arc(0, 0, R * 0.74, 0, TAU, true); g.fill();
  // Eight small deflectors on the slope.
  g.fillStyle = '#d9b45a';
  for (let k = 0; k < 8; k++) { g.save(); g.rotate(k * TAU / 8 + 0.2); g.translate(0, -R * 0.8); g.rotate(k % 2 ? 0 : Math.PI / 2); g.beginPath(); g.ellipse(0, 0, R * 0.012, R * 0.035, 0, 0, TAU); g.fill(); g.restore(); }
  // The turning part: numbers, pockets, cone and hub.
  g.save(); g.rotate(st.wheel);
  for (let i = 0; i < 37; i++) {
    const a = i * STEP - Math.PI / 2, col = COLORS[colorOf(WHEEL[i])];
    g.fillStyle = col; g.beginPath(); g.arc(0, 0, R * 0.74, a - STEP / 2, a + STEP / 2); g.arc(0, 0, R * 0.5, a + STEP / 2, a - STEP / 2, true); g.closePath(); g.fill();
    if (done && WHEEL[i] === n) { g.fillStyle = 'rgba(255,224,138,.45)'; g.fill(); }
  }
  g.strokeStyle = '#e7cf8a'; g.lineWidth = Math.max(1, R * 0.008);
  for (let i = 0; i < 37; i++) { const a = i * STEP - Math.PI / 2 + STEP / 2; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5); g.lineTo(Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74); g.stroke(); }
  g.beginPath(); g.arc(0, 0, R * 0.74, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, R * 0.62, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, R * 0.5, 0, TAU); g.stroke();
  g.fillStyle = '#fff'; g.font = `700 ${Math.round(R * 0.062)}px "Space Grotesk", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 37; i++) { g.save(); g.rotate(i * STEP); g.fillText(String(WHEEL[i]), 0, -R * 0.68); g.restore(); }
  gr = g.createRadialGradient(-R * 0.1, -R * 0.1, R * 0.05, 0, 0, R * 0.5);
  gr.addColorStop(0, '#b98a4a'); gr.addColorStop(1, '#5a3418');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.5, 0, TAU); g.fill();
  g.strokeStyle = '#d9b45a'; g.lineWidth = R * 0.02;
  for (let k = 0; k < 4; k++) { g.save(); g.rotate(k * TAU / 4); g.beginPath(); g.moveTo(0, -R * 0.1); g.lineTo(0, -R * 0.36); g.stroke(); g.fillStyle = '#e7cf8a'; g.beginPath(); g.arc(0, -R * 0.38, R * 0.03, 0, TAU); g.fill(); g.restore(); }
  gr = g.createRadialGradient(-R * 0.03, -R * 0.03, R * 0.01, 0, 0, R * 0.12);
  gr.addColorStop(0, '#fff3c4'); gr.addColorStop(1, '#a8802f');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.11, 0, TAU); g.fill();
  g.restore();
  if (st.ball === null || st.ball === undefined) { g.restore(); return; }
  // The ball, with a shadow that moves away from it while it is in the air.
  const bx = Math.sin(st.ball) * R * st.r, by = -Math.cos(st.ball) * R * st.r, br = R * 0.03 * (1 + st.lift * 0.5);
  g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.ellipse(bx + R * 0.012 + st.lift * R * 0.03, by + R * 0.014 + st.lift * R * 0.03, br, br * 0.85, 0, 0, TAU); g.fill();
  gr = g.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.1, bx, by, br);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#c9ccd2');
  g.fillStyle = gr; g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill();
  g.restore();
}

// Shows the wheel over the page and plays one spin. elapsed: milliseconds since the spin began (for a late joiner).
// Returns a function that removes it at once.
export function showSpin({ n, seed, ms, elapsed = 0, hold = 2600 }) {
  document.querySelector('.ro-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'ro-pop';
  pop.innerHTML = '<div class="ro-pop-in"><canvas></canvas><div class="ro-pop-res" hidden></div></div>';
  document.body.append(pop);
  const cv = pop.querySelector('canvas'), res = pop.querySelector('.ro-pop-res');
  const size = Math.round(Math.min(innerWidth * 0.9, innerHeight * 0.62, 520)), dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = cv.height = size * dpr; cv.style.width = cv.style.height = size + 'px';
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const t0 = performance.now() - elapsed, T = ms / 1000;
  let raf = 0, dead = false, shown = false;
  // Sound that follows the ball: a rolling hiss on the rim, a click for each fret it crosses, a rattle into the pocket.
  let snd = null;
  if (elapsed < ms) fx?.then((m) => { if (!dead) snd = m.spinSound(); });
  let lastBall = null, lastT = 0, lastFret = null, dropped = false;
  const close = () => { if (dead) return; dead = true; snd?.stop(); cancelAnimationFrame(raf); pop.classList.add('out'); setTimeout(() => pop.remove(), 350); };
  const frame = (now) => {
    if (dead) return;
    const t = (now - t0) / 1000, st = wheelState(n, seed, t, T), done = t >= st.T2;
    drawWheel(g, size, st, n, done);
    if (snd && !dropped) {
      if (st.phase === 3) { dropped = true; snd.drop(); }
      else {
        if (lastBall !== null && t > lastT) snd.roll((st.ball - lastBall) / (t - lastT) * (st.phase === 2 ? 0.6 : 1));
        const fret = Math.floor((st.ball - st.wheel) / STEP);
        if (st.phase === 2 && lastFret !== null && fret !== lastFret) snd.click(0.6 + st.lift);
        lastBall = st.ball; lastT = t; lastFret = fret;
      }
    }
    if (t >= T && !shown) { shown = true; const col = colorOf(n); res.hidden = false; res.className = 'ro-pop-res ' + col; res.innerHTML = `<b>${n}</b><span>${col === 'green' ? 'Zero' : col[0].toUpperCase() + col.slice(1)}${n ? (n % 2 ? ' · odd' : ' · even') : ''}</span>`; }
    if (t * 1000 >= ms + hold) { close(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  requestAnimationFrame(() => pop.classList.add('in'));
  pop.addEventListener('click', close); // a tap puts the wheel away early
  return close;
}
