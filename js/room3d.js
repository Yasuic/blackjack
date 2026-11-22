// The 3D card room. WebGL draws the room, the lamp, the padded table and the people; the playing
// surface itself is the normal HTML felt, placed flat on the table with CSS 3D so every button still works.
// The felt sits behind the WebGL canvas, and a see-through "hole" in the WebGL picture shows it.
//
// The camera has two ways of moving. Seated: you are in your own chair, dragging turns your head and the
// wheel leans you in. Scroll back past your chair and you stand up: now dragging walks you around the table.
// The camera can never go below the table top, so the underside of a card can never be seen.
import * as THREE from '../lib/three.module.js';
import { CSS3DRenderer, CSS3DObject } from '../lib/CSS3DRenderer.js';

export function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

// The same display font as the office model. It falls back to the system font until the page has loaded it.
const FONT = '"Space Grotesk", system-ui, sans-serif';
const SKIN = ['#f6d7b8', '#eac39a', '#d6a373', '#b97f4f', '#8a5a36', '#5a3a24'];
const HAIR = ['#17120f', '#3b2416', '#7a4a22', '#c9a15a', '#9aa0a6'];
let CURVE = 0.34; // how much of the felt's height the rounded end takes (read from the felt's own corner shape)

// Outline of the felt in table units (1 unit = 1 CSS pixel of the felt). The dealer's straight edge is at +y.
let OVAL = false; // a poker table: straight long sides with a half circle at each end, seats all the way round
function tableShape(W, H, grow) {
  const s = new THREE.Shape();
  if (OVAL) {
    const r = Math.min(W, H) / 2 + grow;
    if (W >= H) { const L = W / 2 - H / 2; s.moveTo(-L, -r); s.lineTo(L, -r); s.absarc(L, 0, r, -Math.PI / 2, Math.PI / 2, false); s.lineTo(-L, r); s.absarc(-L, 0, r, Math.PI / 2, Math.PI * 1.5, false); }
    else { const L = H / 2 - W / 2; s.moveTo(r, -L); s.lineTo(r, L); s.absarc(0, L, r, 0, Math.PI, false); s.lineTo(-r, -L); s.absarc(0, -L, r, Math.PI, Math.PI * 2, false); }
    return s;
  }
  const top = H / 2 + grow, left = -W / 2 - grow, right = W / 2 + grow;
  const r = Math.max(4, 28 + grow);
  const cy = -H / 2 + CURVE * H;
  const rx = W / 2 + grow, ry = CURVE * H + grow;
  s.moveTo(left + r, top);
  s.lineTo(right - r, top);
  s.quadraticCurveTo(right, top, right, top - r);
  s.lineTo(right, cy);
  s.absellipse(0, cy, rx, ry, 0, -Math.PI, true);
  s.lineTo(left, top - r);
  s.quadraticCurveTo(left, top, left + r, top);
  return s;
}

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 8;
  return t;
}
// A small repeatable random, so the room looks the same on every visit.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Wood grain: long soft streaks.
function woodGrain(base, dark, light, seed) {
  return (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const y = r() * h, t = 1 + r() * 3;
      g.strokeStyle = r() < 0.6 ? dark : light; g.globalAlpha = 0.08 + r() * 0.2; g.lineWidth = t;
      g.beginPath(); g.moveTo(0, y);
      const wob = (r() - 0.5) * 10;
      g.bezierCurveTo(w * 0.3, y + wob, w * 0.7, y - wob, w, y);
      g.stroke();
    }
    g.globalAlpha = 1;
  };
}
// The poker cloth in the 3D room: woven green with a lit middle, a faint suit pattern, a gold line and
// stitching along the rail, a betting line, and the club emblem on both sides of the board.
function pokerFelt(W, H) {
  const cw = 2048, ch = Math.max(256, Math.round(cw * H / W));
  return canvasTexture(cw, ch, (g, w, h) => {
    const k = w / W; // canvas pixels per table unit
    const grd = g.createRadialGradient(w / 2, h * 0.48, h * 0.05, w / 2, h * 0.5, w * 0.56);
    grd.addColorStop(0, '#1c8a62'); grd.addColorStop(0.55, '#12684a'); grd.addColorStop(1, '#0a4733');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // Cloth weave: fine crossed lines, lighter one way and darker the other.
    g.lineWidth = 1;
    for (const [dir, col] of [[1, 'rgba(255,255,255,.035)'], [-1, 'rgba(0,0,0,.07)']]) {
      g.strokeStyle = col; g.beginPath();
      for (let x = -h; x < w + h; x += 5) { g.moveTo(x, dir > 0 ? 0 : h); g.lineTo(x + h, dir > 0 ? h : 0); }
      g.stroke();
    }
    // Speckle, so the cloth is not flat colour.
    for (let n = 0; n < 9000; n++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    // Suits in a diamond grid.
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${Math.round(26 * k)}px serif`; g.fillStyle = 'rgba(255,255,255,.07)';
    const step = 74 * k, suits = ['♠', '♥', '♦', '♣'];
    for (let r = 0, y = step / 2; y < h; y += step, r++) for (let c = 0, x = (r % 2 ? step : step / 2); x < w; x += step, c++) g.fillText(suits[(r * 2 + c) % 4], x, y);
    // Lines that follow the table's outline: a stadium shape, a given distance in from the edge.
    const stadium = (inset) => { const r = h / 2 - inset, L = w / 2 - h / 2; g.beginPath(); g.moveTo(w / 2 - L, inset); g.lineTo(w / 2 + L, inset); g.arc(w / 2 + L, h / 2, r, -Math.PI / 2, Math.PI / 2); g.lineTo(w / 2 - L, h - inset); g.arc(w / 2 - L, h / 2, r, Math.PI / 2, Math.PI * 1.5); g.closePath(); };
    g.setLineDash([]); g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 14 * k; stadium(7 * k); g.stroke();           // shade under the rail
    g.strokeStyle = 'rgba(232,196,106,.75)'; g.lineWidth = 2.5 * k; stadium(18 * k); g.stroke();                       // gold line
    g.strokeStyle = 'rgba(255,244,214,.4)'; g.lineWidth = 1.6 * k; g.setLineDash([7 * k, 6 * k]); stadium(11 * k); g.stroke(); // stitching
    g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2 * k; stadium(h * 0.2); g.stroke();      // betting line
    g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 1 * k; stadium(h * 0.2 + 3 * k); g.stroke();
    // The club emblem: rings, a spade and the name on an arc.
    const emblem = (cx, cy, R) => {
      g.save(); g.translate(cx, cy);
      g.strokeStyle = 'rgba(241,213,138,.5)'; g.fillStyle = 'rgba(241,213,138,.46)';
      g.lineWidth = R * 0.022; g.beginPath(); g.arc(0, 0, R, 0, 7); g.stroke();
      g.lineWidth = R * 0.008; g.beginPath(); g.arc(0, 0, R * 0.94, 0, 7); g.stroke();
      g.setLineDash([R * 0.015, R * 0.04]); g.lineWidth = R * 0.02; g.beginPath(); g.arc(0, 0, R * 0.56, 0, 7); g.stroke(); g.setLineDash([]);
      const arcText = (text, rad, from, top) => { g.font = `700 ${Math.round(R * 0.17)}px Georgia, serif`; const each = (top ? 1 : -1) * 0.2; let a = from - each * (text.length - 1) / 2; for (const chr of text) { g.save(); g.rotate(a); g.translate(0, top ? -rad : rad); g.fillText(chr, 0, 0); g.restore(); a += each; } };
      arcText('ARC POKER ROOM', R * 0.75, 0, true);
      arcText('♠ ♥ ♦ ♣', R * 0.75, 0, false);
      const u = R * 0.0042; g.scale(u, u); g.translate(-200, -200);
      g.fill(new Path2D('M200 118c-34 44-70 62-70 98 0 24 18 40 38 40 12 0 22-5 28-14-2 20-10 32-24 42h56c-14-10-22-22-24-42 6 9 16 14 28 14 20 0 38-16 38-40 0-36-36-54-70-98z'));
      g.restore();
    };
    const R = h * 0.2;
    emblem(w * 0.17, h * 0.5, R); emblem(w * 0.83, h * 0.5, R);
    vignette(g, w, h);
  });
}
// Soft dark edge laid over the felt, as if the lamp lights the middle most.
function vignette(g, w, h) {
  const grd = g.createRadialGradient(w / 2, h * 0.5, h * 0.2, w / 2, h * 0.5, h * 0.72);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.7, 'rgba(0,0,0,.08)'); grd.addColorStop(1, 'rgba(0,0,0,.3)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}
// Chips: the top face with its value, and the striped edge.
const CHIP_COL = { 1: '#e4e4ea', 5: '#c8202b', 25: '#1f9a4a', 100: '#1d1d22', 500: '#6b3fc4' };
const DENOMS = [500, 100, 25, 5, 1];
const CHIP_UP = Math.PI / 2;
function chipTop(v) {
  return (g, w) => {
    const c = w / 2, light = v === 1;
    g.fillStyle = CHIP_COL[v]; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    g.fillStyle = light ? '#3a5fa8' : '#f4f1ea';
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.beginPath(); g.moveTo(c, c); g.arc(c, c, c, a - 0.17, a + 0.17); g.fill(); }
    g.fillStyle = CHIP_COL[v]; g.beginPath(); g.arc(c, c, c * 0.74, 0, Math.PI * 2); g.fill();
    g.strokeStyle = light ? 'rgba(40,60,110,.7)' : 'rgba(255,255,255,.75)'; g.lineWidth = w * 0.03; g.beginPath(); g.arc(c, c, c * 0.62, 0, Math.PI * 2); g.stroke();
    g.fillStyle = light ? '#1c2a4a' : '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${v >= 100 ? w * 0.36 : w * 0.46}px ${FONT}`;
    g.fillText(String(v), c, c + w * 0.02);
  };
}
function chipEdge(v, line) {
  return (g, w, h) => {
    g.fillStyle = CHIP_COL[v]; g.fillRect(0, 0, w, h);
    g.fillStyle = v === 1 ? '#3a5fa8' : '#f4f1ea';
    for (let i = 0; i < 8; i++) g.fillRect((i / 8) * w, 0, w / 22, h);
    if (line) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, w, Math.max(1, h * 0.14)); }
  };
}
// Break an amount into chips, biggest first. With too many chips the smallest are left out.
function chipsFor(amount, cap) {
  const out = [];
  let left = Math.max(0, Math.round(amount));
  for (const v of DENOMS) { const n = Math.floor(left / v); left -= n * v; for (let i = 0; i < n && out.length < cap; i++) out.push(v); }
  return out;
}

function hashHue(id) { let h = 2166136261; for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (((h >>> 7) ^ h) >>> 0) % 360; }

// ---------- The office ----------
// The room around the table is the owner's office, from their own measured 3D model: walls, glass,
// windows, doors, pillars, cabinets, sofas, desks, chairs and screens, all in metres. The block of
// eight desks in the middle of the open floor (marked mid) is moved a little toward the far glass wall,
// and the blackjack table stands at its near end: flat side to the desks, players' backs to the sofa.
// Plan x runs along the front wall and plan y from the front wall to the windows.
const OFFICE = {"sidePanes":[{"a":2.526,"b":2.7292},{"a":3.7274,"b":3.9306}],"cab2":{"x":6.5666,"y":6.7455,"width":1.9764,"depth":0.4572},"bump":{"x":-1.01,"y":0,"w":1.01,"d":5.067},"sofa":{"depth":0.433,"a":{"x":0,"y":5.067,"len":1.714},"b":{"x":0,"y":5.067,"len":2.959},"c":{"x":2.526,"y":1.497,"len":3.57}},"width":14.36,"depth":8.267,"divider":0.103,"pillars":[{"id":"p1","shape":"rect","x":0.182,"y":6.7808,"width":0.908,"depth":1.2002},{"id":"p2","shape":"square","x":7.593,"y":7.2027,"width":0.95,"depth":0.95},{"id":"p3","shape":"rect","x":13.398,"y":6.8218,"width":0.908,"depth":1.2002}],"cabinet":{"x":3.9306,"y":0,"width":3.4737,"depth":0.381},"walls":[{"id":"w6","type":"wall","x1":-1.01,"y1":0,"x2":1.4338,"y2":0},{"id":"g2","type":"glass","x1":2.399,"y1":0,"x2":11.419,"y2":0},{"id":"w7","type":"wall","x1":11.419,"y1":0,"x2":14.36,"y2":0},{"id":"n1","type":"window","x1":0,"y1":8.267,"x2":14.36,"y2":8.267,"thick":0.127},{"id":"n2","type":"window","x1":0,"y1":5.067,"x2":0,"y2":8.267},{"id":"n3","type":"window","x1":14.36,"y1":0,"x2":14.36,"y2":8.267},{"id":"g3","type":"glass","x1":2.399,"y1":0,"x2":2.399,"y2":5.067,"thick":0.127},{"id":"g4","type":"glass","x1":0,"y1":5.067,"x2":2.399,"y2":5.067},{"id":"g5","type":"glass","x1":11.419,"y1":0,"x2":11.419,"y2":3.272},{"id":"g7","type":"glass","x1":11.419,"y1":4.327,"x2":11.419,"y2":8.267},{"id":"w9","type":"wall","x1":11.419,"y1":4.224,"x2":14.36,"y2":4.224},{"id":"n2b","type":"window","x1":-1.01,"y1":0,"x2":-1.01,"y2":5.067,"thick":0.127},{"id":"w6b","type":"wall","x1":-1.01,"y1":5.067,"x2":0,"y2":5.067}],"doors":[{"id":"d1","x1":1.4338,"y1":0,"x2":2.399,"y2":0,"hinge":{"x":2.399,"y":0}},{"id":"d2","x1":2.7292,"y1":0,"x2":3.7274,"y2":0,"hinge":{"x":2.7292,"y":0}},{"id":"d3","x1":11.419,"y1":3.2906,"x2":11.419,"y2":4.224,"hinge":{"x":11.419,"y":4.224}},{"id":"d4","x1":11.419,"y1":4.327,"x2":11.419,"y2":5.2617,"hinge":{"x":11.419,"y":4.327}}],"rooms":[{"id":"bigBoard","x":-1.01,"y":0,"width":3.409,"depth":5.067},{"id":"eating","x":0,"y":5.067,"width":2.399,"depth":3.2},{"id":"openPlan","x":2.399,"y":0,"width":9.02,"depth":8.267},{"id":"printIT","x":6.168,"y":6.259,"width":2.294,"depth":2.008},{"id":"smallBoard","x":11.419,"y":0,"width":2.942,"depth":4.224},{"id":"securities","x":11.419,"y":4.327,"width":2.942,"depth":3.94}],"furniture":[{"id":"t1","room":"bigBoard","kind":"rrect","cx":0.737,"cy":2.234,"w":1.0,"d":2.243},{"id":"tv1","room":"bigBoard","kind":"tvh","cx":0.666,"cy":4.851,"w":0.639,"d":0.0},{"id":"et1","room":"eating","kind":"marble","cx":1.15,"cy":6.217,"w":0.65,"d":0.7},{"id":"et2","room":"eating","kind":"marble","cx":1.9,"cy":6.217,"w":0.65,"d":0.7},{"id":"dS","room":"openPlan","kind":"rect","cx":5.276,"cy":1.079,"w":0.6985,"d":1.397},{"id":"dT","room":"openPlan","kind":"rect","cx":5.974,"cy":1.079,"w":0.6985,"d":1.397},{"id":"dC","room":"openPlan","kind":"rect","cx":9.526,"cy":0.878,"w":0.8001,"d":1.6002,"top":"yellow"},{"id":"dF","room":"openPlan","kind":"rect","cx":10.326,"cy":0.878,"w":0.8001,"d":1.6002,"top":"yellow"},{"id":"dTh","room":"openPlan","kind":"rect","cx":3.845,"cy":7.392,"w":0.8001,"d":1.6002,"top":"yellow"},{"id":"dA","room":"openPlan","kind":"rect","cx":4.645,"cy":7.392,"w":0.8001,"d":1.6002,"top":"yellow"},{"id":"dG","room":"openPlan","kind":"rect","cx":9.343,"cy":7.146,"w":1.6002,"d":0.8001,"top":"yellow"},{"id":"sv","room":"printIT","kind":"rect","cx":7.08,"cy":7.514,"w":0.67,"d":0.562},{"id":"t2","room":"smallBoard","kind":"rrect","cx":12.957,"cy":2.061,"w":0.891,"d":2.196},{"id":"tv3","room":"smallBoard","kind":"tvh","cx":12.949,"cy":4.106,"w":0.639,"d":0.0},{"id":"t3","room":"securities","kind":"round","cx":13.235,"cy":5.642,"w":1.028,"d":1.028},{"id":"dN","room":"securities","kind":"rect","cx":11.849,"cy":7.417,"w":0.8001,"d":1.6002,"top":"yellow","hh":1.1},{"id":"tv4","room":"securities","kind":"tvh","cx":12.949,"cy":4.361,"w":0.639,"d":0.0},{"id":"c1","room":"openPlan","kind":"rect","cx":4.974,"cy":3.853,"w":1.397,"d":0.6985,"mid":true},{"id":"c2","room":"openPlan","kind":"rect","cx":6.371,"cy":3.853,"w":1.397,"d":0.6985,"mid":true},{"id":"c3","room":"openPlan","kind":"rect","cx":7.768,"cy":3.853,"w":1.397,"d":0.6985,"mid":true},{"id":"c4","room":"openPlan","kind":"rect","cx":9.165,"cy":3.853,"w":1.397,"d":0.6985,"mid":true},{"id":"c5","room":"openPlan","kind":"rect","cx":4.974,"cy":4.551,"w":1.397,"d":0.6985,"mid":true},{"id":"c6","room":"openPlan","kind":"rect","cx":6.371,"cy":4.551,"w":1.397,"d":0.6985,"mid":true},{"id":"c7","room":"openPlan","kind":"rect","cx":7.768,"cy":4.551,"w":1.397,"d":0.6985,"mid":true},{"id":"c8","room":"openPlan","kind":"rect","cx":9.165,"cy":4.551,"w":1.397,"d":0.6985,"mid":true}],"chairs":[{"room":"bigBoard","cx":-0.113,"cy":1.259},{"room":"bigBoard","cx":1.587,"cy":1.486},{"room":"bigBoard","cx":-0.113,"cy":1.909},{"room":"bigBoard","cx":1.587,"cy":2.234},{"room":"bigBoard","cx":-0.113,"cy":2.559},{"room":"bigBoard","cx":1.587,"cy":2.982},{"room":"bigBoard","cx":-0.113,"cy":3.209},{"room":"openPlan","cx":4.577,"cy":1.079},{"room":"openPlan","cx":6.673,"cy":1.079},{"room":"openPlan","cx":8.776,"cy":0.878},{"room":"openPlan","cx":11.076,"cy":0.878},{"room":"openPlan","cx":3.095,"cy":7.392},{"room":"openPlan","cx":5.395,"cy":7.392},{"room":"smallBoard","cx":12.162,"cy":1.329},{"room":"smallBoard","cx":13.753,"cy":1.512},{"room":"smallBoard","cx":12.162,"cy":2.061},{"room":"smallBoard","cx":13.753,"cy":2.61},{"room":"smallBoard","cx":12.162,"cy":2.793},{"room":"securities","cx":13.712,"cy":6.302},{"room":"securities","cx":12.758,"cy":6.301},{"room":"securities","cx":12.758,"cy":4.982},{"room":"securities","cx":13.711,"cy":4.982},{"room":"openPlan","cx":9.343,"cy":7.896},{"room":"eating","cx":1.29,"cy":6.847,"stool":true},{"room":"eating","cx":1.65,"cy":6.847,"stool":true},{"room":"eating","cx":2.01,"cy":6.847,"stool":true},{"room":"eating","cx":2.37,"cy":6.847,"stool":true},{"room":"securities","cx":12.599,"cy":7.417,"stand":true},{"room":"openPlan","cx":4.974,"cy":3.154,"mid":true},{"room":"openPlan","cx":6.371,"cy":3.154,"mid":true},{"room":"openPlan","cx":7.768,"cy":3.154,"mid":true},{"room":"openPlan","cx":9.165,"cy":3.154,"mid":true},{"room":"openPlan","cx":4.974,"cy":5.25,"mid":true},{"room":"openPlan","cx":6.371,"cy":5.25,"mid":true},{"room":"openPlan","cx":7.768,"cy":5.25,"mid":true},{"room":"openPlan","cx":9.165,"cy":5.25,"mid":true}]};
// Plan position of the middle of the blackjack table.
// Where each game's table stands in the office plan (metres), for drawing the tables that are not the live one.
const OTHER_TABLES = { blackjack: { x: 4.36, y: 4.2, r: 0.8 }, poker: { x: 0.737, y: 2.234, w: 1, d: 2.243 }, baccarat: { x: 12.957, y: 2.061, w: 0.99, d: 2.196 }, roulette: { x: 13.1, y: 5.75, w: 1, d: 2 } };
const TABLE_NAMES = { blackjack: '🃏 Blackjack', poker: '♠️ Poker', baccarat: '🎴 Baccarat', roulette: '🎡 Roulette' };
const OFFICE_AT = { x: 4.16, y: 4.2 }; // x is set again from the table's real depth when the room is built
// The one name plate in the room. Set it to '' to leave the plate out.
const OFFICE_SIGN = 'WELCOME TO ARC GROUP!';
const OFFICE_SIGN_LINES = ['Hours: 8AM to infinity AM', 'Compensation: negative infinity'];

// Builds the whole office as a handful of merged meshes (one per material). Units are metres with the
// floor at y = 0; the caller scales and places the group. Scene X = -plan x, Z = -plan y.
function buildOffice(signText, midShift = 0, midScale = 1, skipRoom = null, live = 'blackjack') {
  // The middle desks and their chairs move along x by midShift. Where the room is too short for them (a deep phone table), the block is squeezed along x so that all eight desks stay.
  const D0 = OFFICE, mx = (x) => 4.276 + midShift + (x - 4.276) * midScale;
  // skipRoom: the meeting room whose own table and chairs are left out, because the live game table stands there.
  const D = { ...D0, furniture: D0.furniture.filter((f) => !(skipRoom && f.room === skipRoom && (f.kind === 'rrect' || f.kind === 'round'))).map((f) => (f.mid ? { ...f, cx: mx(f.cx), w: f.w * midScale } : f)), chairs: D0.chairs.filter((c) => !(skipRoom && c.room === skipRoom) && !(c.room === 'securities' && !c.stand) && c.room !== 'smallBoard').map((c) => (c.mid ? { ...c, cx: mx(c.cx) } : c)) };
  const Hh = { ceil: 2.7, door: 2.1, sill: 0.85, winTop: 2.55, cab: 2.7, desk: 0.749 };
  const TILE = { L: 1.2176, S: 0.6064 };
  const mk = (o) => new THREE.MeshStandardMaterial(o);
  const rnd = rng(5);
  const M = {
    wall: mk({ color: '#e7e3dc', roughness: 0.9 }),
    frame: mk({ color: '#9aa3ab', roughness: 0.35, metalness: 0.6 }),
    glass: mk({ color: '#bfe0ea', roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    doorGlass: mk({ color: '#a9d3e0', roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    pillar: mk({ color: '#d9d5ce', roughness: 0.85 }),
    deskYellow: mk({ color: '#ffd800', roughness: 0.45, emissive: '#3a2e00' }),
    deskTop: mk({ color: '#f2f0ec', roughness: 0.6 }),
    marble: mk({ roughness: 0.25, map: canvasTexture(256, 256, (g) => {
      g.fillStyle = '#f1efec'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(120,124,130,${0.15 + rnd() * 0.25})`; g.lineWidth = 0.6 + rnd() * 1.6; g.beginPath(); let x = rnd() * 256, y = 0; g.moveTo(x, y); while (y < 256) { x += (rnd() - 0.5) * 30; y += 12 + rnd() * 20; g.lineTo(x, y); } g.stroke(); }
    }) }),
    sofa: mk({ color: '#5f6b73', roughness: 0.95 }),
    wood: mk({ color: '#9b7653', roughness: 0.55 }),
    leg: mk({ color: '#2b2f35', roughness: 0.4, metalness: 0.5 }),
    chairSeat: mk({ color: '#262a30', roughness: 0.8 }),
    chairMesh: mk({ color: '#3a4048', roughness: 0.9 }),
    chrome: mk({ color: '#b9bec4', roughness: 0.25, metalness: 0.9 }),
    screen: mk({ color: '#0d0f12', roughness: 0.25, metalness: 0.2 }),
    // What the office screens show: the ARC Group logo, from the photo of it, lit like a screen that is on.
    logo: (() => { const t = new THREE.TextureLoader().load('img/arc-screen.png?v=20261122e'); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return new THREE.MeshBasicMaterial({ map: t }); })(),
    dark: mk({ color: '#30353c', roughness: 0.6 }),
  };
  const group = new THREE.Group();
  // Everything that does not move is gathered by material and merged, so the office costs few draw calls.
  let sink = null; // while set, pieces are collected here (one person's body) and kept out of the room's merged geometry
  const buckets = new Map();
  const put = (geo, mat, matrix, shadow = true) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    if (sink) { sink.push([g, mat.color]); return; }
    const key = mat.uuid + (shadow ? 's' : 'n');
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, shadow, pos: [], nor: [], uv: [], n: 0 }));
    b.pos.push(g.attributes.position.array); b.nor.push(g.attributes.normal.array); b.uv.push(g.attributes.uv.array); b.n += g.attributes.position.count;
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const Q0 = new THREE.Quaternion(), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const at = (x, y, z, ry = 0, rx = 0) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), V(1, 1, 1));
  let parent = null; // while set, pieces are placed inside this frame (a chair, a door leaf, a screen)
  const emit = (geo, mat, local, shadow) => put(geo, mat, parent ? parent.clone().multiply(local) : local, shadow);
  const box = (w, h, d, mat, x, y, z, shadow = true, ry = 0, rx = 0) => emit(unitBox, mat, new THREE.Matrix4().compose(V(x, y, z), ry || rx ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')) : Q0, V(w, h, d)), shadow);
  const geoCache = {};
  const cyl = (rt, rb, h, seg, mat, x, y, z, shadow = true) => emit((geoCache[`${rt},${rb},${h},${seg}`] ||= new THREE.CylinderGeometry(rt, rb, h, seg)), mat, at(x, y, z), shadow);

  // Floor with the tile grid, the room tints and the ground outside.
  const W = D.width, Dp = D.depth;
  const plane = (w, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; group.add(m); return m; };
  {
    const t = canvasTexture(512, 256, (g) => {
      g.fillStyle = '#8d949b'; g.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? 255 : 0},${rnd() < 0.5 ? 255 : 0},${rnd() < 0.5 ? 255 : 0},0.025)`; g.fillRect(rnd() * 512, rnd() * 256, 2, 2); }
      g.strokeStyle = 'rgba(40,44,50,0.35)'; g.lineWidth = 3; g.strokeRect(0, 0, 512, 256);
    }, [W / TILE.S, Dp / TILE.L]);
    t.rotation = Math.PI / 2;
    plane(W, Dp, mk({ map: t, roughness: 0.95 }), -W / 2, 0, -Dp / 2);
  }
  { const b = D.bump; plane(b.w, b.d, mk({ color: '#8d949b', roughness: 0.95 }), -(b.x + b.w / 2), 0.001, -(b.y + b.d / 2)); }
  const tint = { bigBoard: '#7d6f62', smallBoard: '#7d6f62', securities: '#6f7a78', eating: '#a8a196', printIT: '#5d636b' };
  D.rooms.forEach((r) => { if (tint[r.id]) plane(r.width, r.depth, mk({ color: tint[r.id], roughness: 0.95, transparent: true, opacity: 0.55 }), -(r.x + r.width / 2), 0.003, -(r.y + r.depth / 2)); });
  plane(80, 80, mk({ color: '#aeb5bc', roughness: 1 }), -W / 2, -0.01, -Dp / 2);

  // Straight runs of wall, glass and window between two plan points.
  const run = (x1, y1, x2, y2, fn) => { const hz = Math.abs(y2 - y1) < 1e-6; const a = hz ? Math.min(x1, x2) : Math.min(y1, y2), b = hz ? Math.max(x1, x2) : Math.max(y1, y2); fn({ hz, a, b, at: hz ? y1 : x1, len: b - a, mid: (a + b) / 2 }); };
  const slab = (r, thick, y0, y1, mat, shadow = true) => { const h = y1 - y0; if (h <= 0 || r.len <= 0) return; if (r.hz) box(r.len, h, thick, mat, -r.mid, y0 + h / 2, -r.at, shadow); else box(thick, h, r.len, mat, -r.at, y0 + h / 2, -r.mid, shadow); };
  const post = (r, c, thick, y0, y1, mat) => slab({ ...r, a: c - 0.025, b: c + 0.025, len: 0.05, mid: c }, thick, y0, y1, mat);
  const glassRun = (r, y0, y1, pane, mat = M.glass) => {
    slab(r, 0.012, y0, y1, mat, false);
    slab(r, 0.05, y0, y0 + 0.05, M.frame); slab(r, 0.05, y1 - 0.05, y1, M.frame);
    const n = Math.max(1, Math.round(r.len / pane));
    for (let i = 0; i <= n; i++) post(r, r.a + (r.len * i) / n, 0.05, y0, y1, M.frame);
  };
  const dh = (d) => Math.abs(d.y2 - d.y1) < 1e-6;
  const doorsOn = (r) => D.doors.filter((d) => dh(d) === r.hz && Math.abs((dh(d) ? d.y1 : d.x1) - r.at) < 0.02).map((d) => ({ ...d, a: dh(d) ? Math.min(d.x1, d.x2) : Math.min(d.y1, d.y2), b: dh(d) ? Math.max(d.x1, d.x2) : Math.max(d.y1, d.y2) }));
  const pieces = (r, cuts) => { const out = []; let s = r.a; cuts.sort((p, q) => p.a - q.a).forEach((c) => { if (c.a > s) out.push({ ...r, a: s, b: c.a }); s = Math.max(s, c.b); }); if (s < r.b) out.push({ ...r, a: s, b: r.b }); return out.map((p) => ({ ...p, len: p.b - p.a, mid: (p.a + p.b) / 2 })); };
  const span = (r, c) => ({ ...r, a: c.a, b: c.b, len: c.b - c.a, mid: (c.a + c.b) / 2 });

  D.walls.forEach((w) => run(w.x1, w.y1, w.x2, w.y2, (r) => {
    const cuts = doorsOn(r);
    if (w.id === 'g2') { // the front: wooden slats, with glass panes beside the main door
      const slats = (p) => { slab(p, 0.05, 0, 0.05, M.wood); slab(p, 0.05, Hh.ceil - 0.05, Hh.ceil, M.wood); const n = Math.max(1, Math.floor(p.len / 0.14)); for (let i = 0; i <= n; i++) post(p, p.a + (i * p.len) / n, 0.07, 0, Hh.ceil, M.wood); };
      const panes = D.sidePanes || [];
      panes.forEach((c) => glassRun(span(r, c), 0, Hh.ceil, 9));
      pieces(r, cuts.concat(panes.map((c) => ({ ...c })))).forEach((p) => { if (p.len >= 0.01) slats(p); });
      cuts.forEach((c) => glassRun(span(r, c), Hh.door, Hh.ceil, 9));
      return;
    }
    if (w.id === 'w9') { const t = D.divider; slab({ ...r, at: r.at + t / 2 }, t, 0, Hh.ceil, M.frame); return; }
    pieces(r, cuts).forEach((p) => {
      if (w.type === 'wall') slab(p, 0.12, 0, Hh.ceil, M.wall);
      else if (w.type === 'window' && w.thick) {
        const T = w.thick, q = { ...p, at: p.at + (p.at > 1 ? T / 2 : -T / 2) };
        slab(q, T, 0, Hh.sill, M.wall); slab(q, T, Hh.sill, Hh.winTop, M.glass, false); slab(q, T, Hh.sill, Hh.sill + 0.05, M.frame); slab(q, T, Hh.winTop - 0.05, Hh.winTop, M.frame);
        const n = Math.max(1, Math.round(q.len / 1.5));
        for (let i = 0; i <= n; i++) post(q, q.a + (q.len * i) / n, T, Hh.sill, Hh.winTop, M.frame);
        slab(q, T, Hh.winTop, Hh.ceil, M.wall);
      } else if (w.type === 'window') {
        const q = { ...p, at: p.at + (p.at > 1 ? 0.06 : -0.06) };
        slab(q, 0.2, 0, Hh.sill, M.wall); glassRun(q, Hh.sill, Hh.winTop, 1.5); slab(q, 0.2, Hh.winTop, Hh.ceil, M.wall);
      } else if (w.thick) {
        const T = w.thick, q = { ...p, at: p.at + T / 2 };
        slab(q, 0.012, 0, Hh.ceil, M.glass, false); slab(q, T, 0, 0.05, M.frame); slab(q, T, Hh.ceil - 0.05, Hh.ceil, M.frame);
        const n = Math.max(1, Math.round(q.len / 1.0));
        for (let i = 0; i <= n; i++) post(q, q.a + (q.len * i) / n, T, 0, Hh.ceil, M.frame);
      } else glassRun(p, 0, Hh.ceil, 1.0);
    });
    // Over each door: glass in a glass wall, wall in a solid one.
    cuts.forEach((c) => { const q = span(r, c); if (w.type === 'wall') slab(q, 0.12, Hh.door, Hh.ceil, M.wall); else glassRun(q, Hh.door, Hh.ceil, 9); });
  }));
  // Doors: a framed glass leaf, standing a little open on its hinge.
  D.doors.forEach((d) => {
    const len = dh(d) ? Math.abs(d.x2 - d.x1) : Math.abs(d.y2 - d.y1);
    const first = d.hinge.x === d.x1 && d.hinge.y === d.y1;
    const hx = -d.hinge.x, hz = -d.hinge.y, ox = -(first ? d.x2 : d.x1), oz = -(first ? d.y2 : d.y1);
    const ang = Math.atan2(-(oz - hz), ox - hx);
    parent = at(hx, 0, hz, ang).multiply(at(0, 0, 0, d.id === 'd4' || d.id === 'd1' ? 0.45 : -0.45));
    box(len - 0.06, Hh.door - 0.08, 0.012, M.doorGlass, len / 2, Hh.door / 2, 0, false);
    [[len / 2, 0.03, len, 0.06], [len / 2, Hh.door - 0.03, len, 0.06], [0.03, Hh.door / 2, 0.06, Hh.door], [len - 0.03, Hh.door / 2, 0.06, Hh.door]].forEach(([x, y, w, h]) => box(w, h, 0.045, M.frame, x, y, 0));
    cyl(0.014, 0.014, 0.9, 8, M.chrome, len - 0.12, 1.05, 0.05, false);
    parent = null;
  });
  // Pillars, the cupboard beside the middle pillar and the cabinets along the front.
  D.pillars.forEach((p) => box(p.width, Hh.ceil, p.depth, M.pillar, -(p.x + p.width / 2), Hh.ceil / 2, -(p.y + p.depth / 2)));
  {
    const c = D.cab2;
    box(c.width, Hh.cab, c.depth, M.wood, -(c.x + c.width / 2), Hh.cab / 2, -(c.y + c.depth / 2));
    const n = Math.max(1, Math.round(c.width / 0.45));
    for (let i = 1; i < n; i++) box(0.006, Hh.cab - 0.12, 0.004, M.frame, -(c.x + (c.width * i) / n), Hh.cab / 2, -c.y + 0.001, false);
    box(c.width, 0.006, 0.004, M.frame, -(c.x + c.width / 2), 0.9, -c.y + 0.001, false);
    // Its doors, seen from the table: gray on the far left, then oak, then gray, then oak.
    const doorMat = [mk({ color: '#9a9fa4', roughness: 0.6, emissive: '#9a9fa4', emissiveIntensity: 0.3 }), mk({ color: '#c8a06c', roughness: 0.55, emissive: '#c8a06c', emissiveIntensity: 0.3 })]; // this face is turned away from the sun, so it glows a little
    for (let i = 0; i < n; i++) box(c.width / n - 0.008, Hh.cab - 0.02, 0.008, doorMat[(n - 1 - i) % 2], -(c.x + (c.width * (i + 0.5)) / n), Hh.cab / 2, -c.y + 0.004);
    box(c.width, 0.006, 0.004, M.frame, -(c.x + c.width / 2), 0.9, -c.y + 0.009, false);
    { // A very small egg shaped camera on the top left corner, looking at the table.
      const X = -(c.x + c.width - 0.13), Z = -c.y - 0.1, top = Hh.cab;
      cyl(0.03, 0.034, 0.012, 14, M.dark, X, top + 0.006, Z, false);
      const egg = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), mk({ color: '#f4f4f1', roughness: 0.35 }));
      egg.scale.set(0.036, 0.05, 0.036); egg.position.set(X, top + 0.06, Z); group.add(egg);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), mk({ color: '#0b0c0f', roughness: 0.15, metalness: 0.4 }));
      lens.position.set(X, top + 0.066, Z + 0.027); group.add(lens);
    }
    if (signText) { // one plain name plate on the cupboard that faces the room
      const draw = (g, w, h) => {
        g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#2b2f35'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 76px ${FONT}`;
        g.fillText(signText, w / 2, 84, w - 60);
        g.fillStyle = '#c9c5bd'; g.fillRect(60, 158, w - 120, 3);
        g.fillStyle = '#2b2f35'; g.font = `500 54px ${FONT}`;
        OFFICE_SIGN_LINES.forEach((t, k) => g.fillText(t, w / 2, 218 + k * 78, w - 60));
      };
      const tex = canvasTexture(1024, 344, draw);
      group.userData.redrawSign = () => { const cv = tex.image, g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); draw(g, cv.width, cv.height); tex.needsUpdate = true; };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.504), mk({ map: tex, roughness: 0.6 }));
      m.position.set(-(c.x + c.width / 2), 2.066, -c.y + 0.012); // same top edge as the old one line plate
      group.add(m);
    }
  }
  {
    const c = D.cabinet;
    box(c.width, Hh.cab - 0.03, c.depth, M.wood, -(c.x + c.width / 2), (Hh.cab - 0.03) / 2, -(c.y + c.depth / 2));
    box(c.width + 0.02, 0.03, c.depth + 0.02, M.wood, -(c.x + c.width / 2), Hh.cab - 0.015, -(c.y + c.depth / 2));
    const n = Math.round(c.width / 0.6);
    for (let i = 1; i < n; i++) box(0.006, Hh.cab - 0.12, 0.004, M.frame, -(c.x + (c.width * i) / n), (Hh.cab - 0.03) / 2, -(c.y + c.depth) - 0.001, false);
    box(c.width, 0.006, 0.004, M.frame, -(c.x + c.width / 2), 0.9, -(c.y + c.depth) - 0.001, false);
  }

  // Furniture.
  const roundRect = (w, d, r) => { const s = new THREE.Shape(); const x = -w / 2, y = -d / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d); s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; };
  const surfaces = [], desks = [];
  D.furniture.forEach((f) => {
    const X = -f.cx, Z = -f.cy;
    if (f.kind === 'tvh') { // a wall screen: wide, with the logo on the side that faces its room
      const face = f.id === 'tv4' ? -1 : 1, zc = Z + 0.03 * face;
      box(1.3, 0.76, 0.05, M.screen, X, 1.45, zc); box(1.24, 0.7, 0.003, f.id === 'tv4' ? (M.news ||= new THREE.MeshBasicMaterial({ map: canvasTexture(640, 360, (g, cw, ch) => { // a business news channel, always on
        g.fillStyle = '#05070a'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#111'; g.fillRect(0, 0, cw, 46); g.fillStyle = '#ff9b1a'; g.textBaseline = 'middle'; g.font = `700 30px ${FONT}`; g.fillText('BLOOMBERG', 14, 24); g.fillStyle = '#fff'; g.font = `700 18px ${FONT}`; g.fillText('MARKETS LIVE', cw - 160, 24);
        g.strokeStyle = '#2bd66b'; g.lineWidth = 4; g.beginPath(); let y = 220; for (let x = 20; x < 400; x += 12) { y += Math.sin(x * 0.7) * 14 - 2.2; g.lineTo(x, y); } g.stroke();
        [['HSI', '+1.2%', 1], ['SPX', '-0.4%', 0], ['NKY', '+0.8%', 1], ['USDHKD', '7.78', 1], ['GOLD', '-0.3%', 0]].forEach(([n2, v, upq], q) => { g.fillStyle = '#fff'; g.font = `700 22px ${FONT}`; g.fillText(n2, 430, 80 + q * 44); g.fillStyle = upq ? '#2bd66b' : '#ff4d4d'; g.fillText(v, 540, 80 + q * 44); });
        g.fillStyle = '#ff9b1a'; g.fillRect(0, ch - 46, cw, 46); g.fillStyle = '#111'; g.font = `700 22px ${FONT}`; g.fillText('BREAKING: ANALYSTS STILL IN THE OFFICE AT 3AM', 14, ch - 22);
      }) })) : f.id === 'tv1' ? (M.pokerTv ||= new THREE.MeshBasicMaterial({ map: canvasTexture(640, 360, (g, cw, ch) => { // the poker room's tournament screen
        g.fillStyle = '#07130d'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#0f6b3f'; g.fillRect(0, 0, cw, 64); g.textBaseline = 'middle'; g.textAlign = 'center';
        g.fillStyle = '#f1c76a'; g.font = `700 36px ${FONT}`; g.fillText('ARC POKER ROOM', cw / 2, 34);
        g.fillStyle = '#fff'; g.font = `700 26px ${FONT}`; g.fillText("NO LIMIT HOLD'EM", cw / 2, 104);
        g.fillStyle = '#f1c76a'; g.font = `700 64px ${FONT}`; g.fillText('12:34', cw / 2, 178);
        g.fillStyle = '#9fb3a7'; g.font = `700 20px ${FONT}`; g.fillText('NEXT LEVEL', cw / 2, 226);
        g.fillStyle = '#fff'; g.font = `700 28px ${FONT}`; g.fillText('BLINDS 100 / 200', cw / 2, 270);
        g.fillStyle = '#9fb3a7'; g.font = `700 20px ${FONT}`; g.fillText('7 PLAYERS  ·  AVG STACK 14,300', cw / 2, 320);
      }) })) : M.logo, X, 1.45, zc + 0.026 * face, false); return;
    }
    if (f.id === 'sv') { box(f.w, 0.95, f.d, M.dark, X, 0.475, Z); return; }
    surfaces.push(f);
    if (f.kind === 'marble') { box(f.w, 0.035, f.d, M.marble, X, Hh.desk - 0.0175, Z); cyl(0.035, 0.035, Hh.desk - 0.035, 10, M.chrome, X, (Hh.desk - 0.035) / 2, Z); box(0.42, 0.02, 0.42, M.leg, X, 0.01, Z); return; }
    // The games that are not being played on this screen still stand in the office: a baccarat table in the small
    // meeting room, a roulette table in Nigel's room. (The poker table is drawn below, the blackjack table after the loop.)
    if (f.id === 't2' || f.id === 't3') {
      const G = (M.games ||= { rail: mk({ color: '#3a2114', roughness: 0.7 }), felt: mk({ color: '#0f6b3f', roughness: 0.95 }), line: mk({ color: '#d9c27a', roughness: 0.6 }), dark: mk({ color: '#15171c', roughness: 0.5 }), red: mk({ color: '#c62f2f', roughness: 0.5 }), card: mk({ color: '#fbfaf6', roughness: 0.5 }) });
      const rou = f.id === 't3', cx = rou ? -OTHER_TABLES.roulette.x : X, cz = rou ? -OTHER_TABLES.roulette.y : Z, w = rou ? 1.0 : f.w + 0.1, d = rou ? 2.0 : f.d, top = Hh.desk, rad = rou ? 0.16 : 0.3;
      const ring = roundRect(w + 0.16, d + 0.16, rad + 0.08); ring.holes.push(roundRect(w - 0.04, d - 0.04, rad - 0.02));
      const rg = new THREE.ExtrudeGeometry(ring, { depth: 0.07, bevelEnabled: false, curveSegments: 10 }); rg.rotateX(-Math.PI / 2); emit(rg, G.rail, at(cx, top - 0.045, cz), true);
      const fg = new THREE.ExtrudeGeometry(roundRect(w, d, rad), { depth: 0.04, bevelEnabled: false, curveSegments: 10 }); fg.rotateX(-Math.PI / 2); emit(fg, G.felt, at(cx, top - 0.04, cz), true);
      [-1, 1].forEach((sg) => { cyl(0.08, 0.11, top - 0.04, 12, G.rail, cx, (top - 0.04) / 2, cz + sg * d * 0.27); cyl(0.26, 0.28, 0.03, 16, M.leg, cx, 0.015, cz + sg * d * 0.27, false); });
      if (rou) { // the number layout as a striped strip, and the wheel at one end
        for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) box(0.085, 0.002, 0.085, (i + j) % 2 ? G.red : G.dark, cx - 0.1 + j * 0.1, top + 0.001, cz - 0.75 + i * 0.1, false);
        cyl(0.3, 0.32, 0.07, 28, G.rail, cx, top + 0.035, cz + 0.62); cyl(0.25, 0.25, 0.012, 28, G.dark, cx, top + 0.074, cz + 0.62, false); cyl(0.17, 0.17, 0.014, 28, G.red, cx, top + 0.076, cz + 0.62, false); cyl(0.05, 0.03, 0.06, 12, G.line, cx, top + 0.1, cz + 0.62, false);
      } else { // two hands of cards in the middle and the betting line
        box(0.012, 0.002, d - 0.5, G.line, cx + 0.2, top + 0.001, cz, false);
        for (let k = 0; k < 2; k++) for (let i = 0; i < 2; i++) box(0.089, 0.002, 0.064, G.card, cx - 0.12, top + 0.0015, cz + (k ? 0.22 : -0.22) + (i - 0.5) * 0.08, false);
        box(0.1, 0.05, 0.14, G.dark, cx - 0.3, top + 0.025, cz + 0.6, false); // the shoe
      }
      return;
    }
    if (f.kind === 'round') { cyl(f.w / 2, f.w / 2, 0.035, 32, M.wood, X, Hh.desk - 0.0175, Z); cyl(0.04, 0.04, Hh.desk - 0.05, 10, M.leg, X, (Hh.desk - 0.05) / 2, Z); cyl(0.28, 0.3, 0.03, 20, M.leg, X, 0.015, Z, false); return; }
    if (f.id === 't1') { // the big meeting room is a poker room: a padded oval table with a green cloth, chips and cards
      const P = (M.poker ||= { rail: mk({ color: '#2a1810', roughness: 0.75 }), felt: mk({ color: '#0f6b3f', roughness: 0.95 }), line: mk({ color: '#d9c27a', roughness: 0.6 }), back: mk({ color: '#b3202a', roughness: 0.5 }), card: mk({ color: '#fbfaf6', roughness: 0.5 }),
        chips: ['#f4f4f0', '#c62828', '#1f8a4c', '#16181c', '#6a3fc4'].map((c) => mk({ color: c, roughness: 0.5 })) });
      const top = Hh.desk, rad = Math.min(f.w, f.d) * 0.5;
      const ring = roundRect(f.w + 0.2, f.d + 0.2, rad + 0.1); ring.holes.push(roundRect(f.w - 0.04, f.d - 0.04, rad - 0.02));
      const rg = new THREE.ExtrudeGeometry(ring, { depth: 0.07, bevelEnabled: false, curveSegments: 14 }); rg.rotateX(-Math.PI / 2); emit(rg, P.rail, at(X, top - 0.045, Z), true);
      const fg = new THREE.ExtrudeGeometry(roundRect(f.w, f.d, rad), { depth: 0.04, bevelEnabled: false, curveSegments: 14 }); fg.rotateX(-Math.PI / 2); emit(fg, P.felt, at(X, top - 0.04, Z), true);
      [-1, 1].forEach((s) => { cyl(0.09, 0.12, top - 0.04, 14, P.rail, X, (top - 0.04) / 2, Z + s * f.d * 0.27); cyl(0.3, 0.32, 0.03, 18, M.leg, X, 0.015, Z + s * f.d * 0.27, false); });
      // Five shared cards face up in the middle, the deck and the dealer button beside them.
      const cw = 0.064, chh = 0.089, y = top + 0.0015;
      for (let i = 0; i < 5; i++) box(chh, 0.002, cw, P.card, X, y, Z + (i - 2) * (cw + 0.012), false);
      for (let i = 0; i < 5; i++) box(chh * 0.5, 0.0005, cw * 0.5, i % 2 ? P.back : P.rail, X + 0.012, y + 0.0013, Z + (i - 2) * (cw + 0.012), false); // the pips, as a small mark
      box(chh, 0.012, cw, P.back, X - 0.2, top + 0.006, Z - 0.02, false, 0.3);
      cyl(0.026, 0.026, 0.008, 16, P.card, X + 0.22, top + 0.004, Z + 0.3, false);
      // A pot of chips in the middle and a stack row with two face down cards at every chair.
      const stack = (x, z, n, m) => cyl(0.02, 0.02, 0.0034 * n, 12, P.chips[m % 5], x, top + 0.0017 * n, z, false);
      [[0.16, 0.2, 9, 1], [0.2, 0.25, 6, 2], [0.13, 0.26, 4, 0], [0.18, 0.31, 7, 3], [0.23, 0.2, 3, 4]].forEach(([dx, dz, n, m]) => stack(X - dx, Z - dz, n, m));
      D.chairs.filter((c) => c.room === 'bigBoard').forEach((c, k) => {
        const side = Math.sign(-c.cx - X) || 1, ex = X + side * (f.w / 2 - 0.16), cz = -c.cy;
        for (let j = 0; j < 4; j++) stack(ex, cz - 0.09 + j * 0.045, 4 + ((k * 3 + j * 5) % 9), k + j);
        box(chh, 0.002, cw, P.back, ex - side * 0.11, y, cz + 0.02, false, 0.18); box(chh, 0.002, cw, P.back, ex - side * 0.11, y + 0.002, cz + 0.06, false, -0.12);
      });
      return;
    }
    if (f.kind === 'rrect') {
      const g = new THREE.ExtrudeGeometry(roundRect(f.w, f.d, Math.min(f.w, f.d) * 0.45), { depth: 0.04, bevelEnabled: false, curveSegments: 12 });
      g.rotateX(-Math.PI / 2);
      emit(g, M.wood, at(X, Hh.desk - 0.04, Z), true);
      [-1, 1].forEach((s) => box(0.1, Hh.desk - 0.04, 0.5, M.leg, X, (Hh.desk - 0.04) / 2, Z + s * f.d * 0.28));
      return;
    }
    // Desks and plain tables: a top and two panel legs on the short sides. A standing desk is higher.
    const dkh = f.hh || Hh.desk;
    box(f.w, 0.03, f.d, f.room === 'eating' ? M.wood : f.top === 'yellow' ? M.deskYellow : M.deskTop, X, dkh - 0.015, Z);
    const long = f.w >= f.d;
    [-1, 1].forEach((s) => { if (long) box(0.04, dkh - 0.03, f.d * 0.85, M.leg, X + s * (f.w / 2 - 0.05), (dkh - 0.03) / 2, Z); else box(f.w * 0.85, dkh - 0.03, 0.04, M.leg, X, (dkh - 0.03) / 2, Z + s * (f.d / 2 - 0.05)); });
    if (f.room === 'openPlan' || f.room === 'securities') desks.push(f);
  });
  // Office chairs, each turned to face the nearest desk or table in its room.
  const officeChair = () => {
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; box(0.32, 0.03, 0.04, M.chrome, Math.cos(a) * 0.16, 0.07, Math.sin(a) * 0.16, true, -a); box(0.05, 0.05, 0.05, M.leg, Math.cos(a) * 0.31, 0.03, Math.sin(a) * 0.31, false); }
    cyl(0.025, 0.03, 0.36, 8, M.chrome, 0, 0.25, 0);
    box(0.48, 0.08, 0.46, M.chairSeat, 0, 0.47, 0);
    box(0.46, 0.5, 0.05, M.chairMesh, 0, 0.82, 0.24, true, 0, -0.12);
    box(0.05, 0.3, 0.03, M.leg, 0, 0.6, 0.25);
    [-1, 1].forEach((s) => { box(0.05, 0.03, 0.26, M.leg, s * 0.26, 0.68, 0.02); box(0.03, 0.2, 0.03, M.leg, s * 0.26, 0.57, 0.08); });
  };
  D.chairs.filter((c) => c.stool).forEach((c) => { cyl(0.18, 0.17, 0.06, 16, M.sofa, -c.cx, 0.48, -c.cy); cyl(0.025, 0.025, 0.45, 8, M.chrome, -c.cx, 0.225, -c.cy); cyl(0.17, 0.19, 0.02, 16, M.chrome, -c.cx, 0.01, -c.cy, false); });
  { // The L-shaped sofas.
    const So = D.sofa, dpt = So.depth, seatH = 0.42, backH = 0.85;
    const seat = (x, y, lenX, lenY) => box(lenX, seatH, lenY, M.sofa, -(x + lenX / 2), seatH / 2, -(y + lenY / 2));
    seat(0, So.a.y, dpt, So.a.len); box(0.18, backH, So.a.len, M.sofa, -0.09, backH / 2, -(So.a.y + So.a.len / 2));
    seat(0, So.b.y, So.b.len, dpt); box(So.b.len, backH, 0.18, M.sofa, -(So.b.len / 2), backH / 2, -(So.b.y + 0.09));
    const C = So.c;
    seat(C.x, C.y, dpt, C.len); box(0.18, backH, C.len, M.sofa, -(C.x + 0.09), backH / 2, -(C.y + C.len / 2)); box(dpt, 0.6, 0.18, M.sofa, -(C.x + dpt / 2), 0.3, -(C.y + 0.09)); box(dpt, 0.6, 0.18, M.sofa, -(dpt / 2), 0.3, -(So.a.y + So.a.len - 0.09));
  }
  // People at the desks. Each one is a few boxes in the chair's own frame (the chair faces -z), with
  // the two hands as separate small pieces that tap up and down on the keyboard.
  const typing = [];
  const tone = {};
  const col = (c, r = 0.85) => (tone[c + r] ||= mk({ color: c, roughness: r }));
  const handGeo = new THREE.BoxGeometry(0.085, 0.035, 0.11);
  const limb = (a, b, t, mat) => { // a box from point a to point b
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    box(t, L, t, mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, true, Math.atan2(dx, dz), Math.atan2(Math.hypot(dx, dz), dy));
  };
  const LOOKS = [
    { skin: '#e8b98f', hair: '#2a1d14', top: '#3b6ea5', legs: '#2b2f38' },
    { skin: '#c98f62', hair: '#15110e', top: '#e9e6df', legs: '#3a3f47' },
    { skin: '#f0c9a4', hair: '#6b4a2b', top: '#4f7d5c', legs: '#22262d' },
    { skin: '#a8703f', hair: '#0f0d0c', top: '#8a4b4b', legs: '#2f3340' },
    { skin: '#e2ad82', hair: '#3a2a1c', top: '#c9a23b', legs: '#262a30' },
  ];
  // Three people the office asked for by place: the woman at the yellow desk by the wooden slats who
  // faces the small meeting room, the person across from her, and the man at the desk behind her.
  const SPECIAL = {
    9: { name: 'Charlene', skin: '#f0c9a4', hair: '#3a2416', top: '#111214', legs: '#111214', longHair: true, dress: true, lush: true, lines: ['yooo look at my new keyboard'], rare: 0.1 },
    10: { name: 'Felix', skin: '#e2ad82', hair: '#1d1712', top: '#e9e6df', legs: '#2b2f38', vest: '#131416', zip: true, lines: ['im going to the gym'] },
    8: { name: 'Tony', skin: '#e8b98f', hair: '#2a1d14', top: '#4a6fa0', legs: '#2b2f38', wide: 0.8, spiky: true, recede: true, cup: 'DETOUR COFFEE', lines: ['WHY IS SERGIO CALLING ME AGAIN'] },
    27: { name: 'Nigel', skin: '#e8b98f', hair: '#1d1712', top: '#f6f5f1', legs: '#3a3f47', tattoo: true, golf: true, buttons: true },
    // The middle block, seen from above with the sign cupboard at the top. Bottom row, left to right: 31, 30, 29, 28. Top row: 35, 34, 33, 32.
    31: { name: 'Henry', skin: '#e2ad82', hair: '#0f0d0c', top: '#5b6470', legs: '#2b2f38', postits: true, pinkKeys: true },
    34: { name: 'David', skin: '#e8b98f', hair: '#2a1d14', top: '#2f3640', legs: '#22262d', glowKeys: true, goose: true, sideHair: true, lines: ['BRUCE DA GOOSE'] },
    32: { name: 'Jeff', skin: '#e2ad82', hair: '#15110e', top: '#141518', legs: '#e9dfc8', shoes: '#f7f6f2', collar: true, glasses: true, nap: true, whiteKeys: true, cars: true, flask: true, burns: true, tea: true, lines: ['*sigh* fuck this shit', 'fuck im so tired', 'fuckkkkkkkkkk', 'MANIKAAAAAAA'] },
    30: { name: 'Victor', skin: '#e8b98f', hair: '#1d1712', top: '#dfe8f2', legs: '#30343c', buttons: true, lines: ['ALL IN', "Let's get 龙邦?"] },
    29: { name: 'Allie', skin: '#f0c9a4', hair: '#2a1d14', top: '#c0262d', legs: '#c0262d', longHair: true, dress: true, wide: 1.5, mess: true, cans: true, cough: true, lines: ['TRANSAKCIONNN'] },
    22: { name: 'Gordon', skin: '#e2ad82', hair: '#e3b23c', top: '#5c6b7a', legs: '#2b2f38', wide: 1.95, eat: true, noTag: true },
    12: { name: 'Alan', skin: '#e8b98f', hair: '#1d1712', top: '#f6f5f1', legs: '#3a3f47', wide: 0.82, buttons: true, truck: true },
    11: { name: 'Thibaud', skin: '#f6dccb', hair: '#f2f2ee', top: '#a9cdea', legs: '#f1efea', shoes: '#f7f6f2', spiky: true, polo: true, cards: true },
    7: { name: 'Yuya', skin: '#f0c9a4', hair: '#0f0d0c', top: '#d9cfbd', legs: '#3a3f47', bowl: true, word: 'MUJI', wordMany: true, mint: true, lines: ['Arigatoooo'] },
  };
  const bodyMat = mk({ vertexColors: true, roughness: 0.85 });
  // Joins captured pieces into one geometry; each piece keeps the colour of the material it was drawn with.
  const joinColored = (items) => {
    const n = items.reduce((q, [g]) => q + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), colr = new Float32Array(n * 3);
    let o = 0;
    for (const [g, c] of items) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); for (let q = 0; q < g.attributes.position.count; q++) { colr[(o + q) * 3] = c.r; colr[(o + q) * 3 + 1] = c.g; colr[(o + q) * 3 + 2] = c.b; } o += g.attributes.position.count; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    return out;
  };
  // The coffee run: from the chair to the nearest aisle, along the aisles to the main door, and out to the street side.
  const walkers = [];
  const A1 = 2.35, A2 = 6.05, XR = Math.min(11.2, mx(9.8635) + 0.32);
  const toAisle = (c) => { // from a chair to the aisle on the door side
    const pts = [[c.cx, c.cy]];
    if (c.room === 'securities') pts.push([12.25, c.cy], [12.25, 4.8], [XR, 4.8], [XR, A1]);
    else if (c.cy < 4.2) pts.push([c.cx, A1]);
    else { if (c.cy > 7.6 && c.cx > 8) pts.push([10.5, c.cy], [10.5, A2]); else pts.push([c.cx, A2]); pts.push([XR, A2], [XR, A1]); }
    return pts;
  };
  const toV = (pts) => pts.map(([x, y]) => V(-x, 0, -y));
  const routeFor = (c) => toV([...toAisle(c), [3.23, A1], [3.23, 0.2], [3.23, -1.8]]);
  // A small comic speech bubble; it always turns to the viewer.
  const bubble = (text) => {
    const t = canvasTexture(384, 160, (g, cw, ch) => {
      g.clearRect(0, 0, cw, ch); g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 6;
      g.beginPath(); g.roundRect(8, 8, cw - 16, ch - 56, 34); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(96, ch - 51); g.lineTo(78, ch - 8); g.lineTo(150, ch - 51); g.fill(); g.stroke(); g.fillRect(92, ch - 58, 62, 10);
      g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'italic 700 44px "Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive';
      const words = text.split(' '), half = text.length > 18 ? Math.ceil(words.length / 2) : words.length, lines = [words.slice(0, half).join(' '), words.slice(half).join(' ')].filter(Boolean);
      if (lines.length > 1) g.font = g.font.replace('44px', '34px');
      lines.forEach((ln, n) => g.fillText(ln, cw / 2, (ch - 48) / 2 + 6 + (n - (lines.length - 1) / 2) * 38, cw - 44));
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    sp.scale.set(0.62, 0.26, 1);
    return sp;
  };
  // Visits: who walks over to whom, what they say, and where they stand (plan x and y from the other person's chair).
  const VISITS = { Nigel: { to: 'Allie', say: 'Allie, clean your f***ing table up!', off: [0.62, -0.62] }, Gordon: { to: 'Yuya', say: 'bla bla bla...', off: [-0.1, 0.95] }, Henry: { to: 'Felix', say: 'so anyway...', off: [-0.15, 1.1] } };
  const tags = [], talkers = [], coughs = [], glitch = [], snow = [];
  const tagSprite = (text, ink = '#f3e3b0') => {
    const t = canvasTexture(256, 72, (g, cw, ch) => { g.clearRect(0, 0, cw, ch); g.fillStyle = 'rgba(12,14,18,0.78)'; g.beginPath(); g.roundRect(4, 6, cw - 8, ch - 12, 28); g.fill(); g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 34px ${FONT}`; g.fillText(text, cw / 2, ch / 2 + 3, cw - 30); });
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  };
  const EMPTY = new Set([28, 33, 35]); // desks nobody is at
  const worker = (idx, gap, ry, deskH, stand, deskDepth, chair) => {
    if (EMPTY.has(idx)) return;
    const L = SPECIAL[idx] || LOOKS[idx % LOOKS.length], w = L.wide || 1;
    const skin = col(L.skin), hair = col(L.hair, 0.95), top = col(L.top), legs = col(L.legs), shoe = col(L.shoes || '#15161a', 0.6);
    const reach = gap + 0.15, dy = deskH, up = stand ? 0.29 : 0;
    // The body is drawn in the chair's own frame and joined into one piece, so a person is a single
    // object that can be hidden while they are away. pose 'desk' is at the desk; 'walkA' and 'walkB' are two steps of a walk.
    const body = (pose) => {
      const walk = pose !== 'desk', lie = pose === 'lie', up2 = walk ? 0.29 : up, st = lie ? 0 : walk ? (pose === 'walkA' ? 1 : -1) : 0;
      if (walk) [-1, 1].forEach((k) => { const fz = 0.05 - k * st * 0.2; limb([k * 0.1, 0.93, 0.05], [k * 0.1, 0.07, fz], 0.13, L.dress ? skin : legs); box(0.11, 0.07, 0.24, shoe, k * 0.1, 0.035, fz - 0.05); if (L.dress) box(0.34, 0.3, 0.2, top, 0, 0.8, 0.05); })
      else if (stand) [-1, 1].forEach((k) => { box(0.13, 0.86, 0.14, legs, k * 0.1, 0.5, 0.05); box(0.11, 0.07, 0.24, shoe, k * 0.1, 0.035, 0.0); });
      else [-1, 1].forEach((k) => {
        const x = k * 0.1 * w;
        if (!L.dress) box(0.14 * w, 0.12, 0.42, legs, x, 0.57, -0.14);
        box(0.105, 0.45, 0.105, L.dress ? skin : legs, x, 0.29, -0.33);
        box(0.105, 0.07, 0.22, shoe, x, 0.035, -0.38);
      });
      if (L.dress && !walk) box(0.38, 0.14, 0.46, top, 0, 0.575, -0.13);
      // Body, neck and head.
      box(0.36 * w, 0.5, 0.2 * (w > 1 ? 1.55 : 1), top, 0, 0.86 + up2, w > 1 ? 0.01 : 0.06);
      if (w > 1) box(0.4 * w, 0.26, 0.36, top, 0, 0.76 + up2, -0.04); // belly
      if (L.vest) { [-1, 1].forEach((k) => box(0.125, 0.44, 0.215, col(L.vest), k * 0.118, 0.87 + up2, 0.06)); box(0.36, 0.44, 0.03, col(L.vest), 0, 0.87 + up2, 0.155); }
      box(0.1, 0.07, 0.1, skin, 0, 1.14 + up2, 0.05);
      if (L.collar) { box(0.17, 0.1, 0.03, top, 0, 1.16 + up2, 0.125); [-1, 1].forEach((k) => box(0.03, 0.1, 0.13, top, k * 0.075, 1.16 + up2, 0.06)); box(0.012, 0.3, 0.012, col('#3a3d44', 0.5), 0, 0.96 + up2, -0.042); } // collar turned up, and a zip
      const hw = w > 1 ? 1.12 : 1;
      box(0.2 * hw, 0.22, 0.21, skin, 0, 1.28 + up2, 0.03);
      if (L.glasses && !lie) { const blk = col('#0c0d0f', 0.4); box(0.21 * hw, 0.012, 0.012, blk, 0, 1.31 + up2, -0.08); [-1, 1].forEach((k) => { box(0.075, 0.05, 0.012, blk, k * 0.05, 1.3 + up2, -0.08); box(0.01, 0.012, 0.12, blk, k * 0.103 * hw, 1.31 + up2, -0.02); }); }
      if (L.recede) box(0.215 * hw, 0.07, 0.13, hair, 0, 1.4 + up2, 0.085); else box(0.215 * hw, 0.07, 0.225, hair, 0, 1.4 + up2, 0.035);
      if (L.sideHair) [-1, 1].forEach((k) => box(0.03, 0.12, 0.17, hair, k * 0.108 * hw, 1.33 + up2, 0.05));
      if (L.burns) [-1, 1].forEach((k) => box(0.022, 0.1, 0.045, hair, k * 0.104 * hw, 1.29 + up2, -0.015));
      if (L.lush) { box(0.3, 0.62, 0.11, hair, 0, 1.1 + up2, 0.18); [-1, 1].forEach((k) => { box(0.07, 0.5, 0.2, hair, k * 0.135, 1.14 + up2, 0.08); box(0.06, 0.12, 0.1, hair, k * 0.1, 1.42 + up2, 0.04); }); box(0.24, 0.05, 0.23, hair, 0, 1.445 + up2, 0.04); }
      if (L.zip) { box(0.37, 0.44, 0.03, col(L.vest), 0, 0.87 + up2, -0.045); box(0.012, 0.44, 0.008, col('#8a8d90', 0.4), 0, 0.87 + up2, -0.062); }
      if (L.polo) { const pc = col('#8fb9dd'); box(0.19, 0.03, 0.15, pc, 0, 1.115 + up2, 0.05); [-1, 1].forEach((k) => box(0.07, 0.05, 0.02, pc, k * 0.045, 1.09 + up2, -0.045, true, 0, 0.3)); box(0.012, 0.1, 0.006, col('#f4f3ef'), 0, 1.03 + up2, -0.042); }
      if (L.buttons) for (let n = 0; n < 5; n++) box(0.016, 0.016, 0.008, col('#aab0b6', 0.4), 0, 0.68 + n * 0.085 + up2, -0.042);
      box(0.215 * hw, 0.16, 0.05, hair, 0, 1.33 + up2, 0.14);
      if (L.spiky) for (let q = 0; q < 9; q++) { const x = ((q % 3) - 1) * 0.07, z = (Math.floor(q / 3) - 1) * 0.07 + 0.035; box(0.035, 0.09, 0.035, hair, x, 1.46 + up2, z, true, q * 0.7, ((q % 3) - 1) * 0.25); }
      if (L.bowl) { box(0.235, 0.1, 0.245, hair, 0, 1.385 + up2, 0.03); box(0.235, 0.05, 0.03, hair, 0, 1.345 + up2, -0.085); [-1, 1].forEach((k) => box(0.025, 0.11, 0.2, hair, k * 0.108, 1.33 + up2, 0.045)); box(0.235, 0.12, 0.03, hair, 0, 1.32 + up2, 0.15); }
      if (L.longHair) { box(0.25, 0.52, 0.06, hair, 0, 1.12 + up2, 0.165); [-1, 1].forEach((k) => box(0.04, 0.34, 0.16, hair, k * 0.115, 1.2 + up2, 0.07)); }
      // Arms. At the desk both reach the keyboard. On a walk one hangs and swings, the other holds a coffee.
      const sleeve = L.dress ? skin : top, fore = L.dress || L.vest || L.tattoo ? skin : top;
      const ink = (el, hd) => { if (L.tattoo) [[0.12, 0.3], [0.38, 0.52], [0.62, 0.86]].forEach(([f0, f1], n) => { const pt = (f) => el.map((v, q) => v + (hd[q] - v) * f); limb(pt(f0), pt(f1), 0.079, col(n === 1 ? '#27445a' : '#1c2a33', 0.9)); }); };
      [-1, 1].forEach((k) => {
        const sh = [k * 0.215 * w, 1.05 + up2, 0.05];
        if (!walk) { const el = [k * 0.235 * w, 0.82 + up2, -0.07], hd = [k * 0.11, dy + 0.045, -reach + 0.05]; limb(sh, el, 0.09, sleeve); limb(el, hd, 0.075, fore); ink(el, hd); return; }
        if (k < 0 || lie || L.nap) { const el = [k * 0.25 * w, 1.07, 0.05 + st * 0.06], hd = [k * 0.25 * w, 0.84, 0.05 + st * 0.14]; limb(sh, el, 0.09, sleeve); limb(el, hd, 0.075, fore); ink(el, hd); box(0.08, 0.09, 0.08, skin, hd[0], hd[1] - 0.04, hd[2]); return; }
        const el = [k * 0.25 * w, 1.1, 0.0], hd = [0.2 * w, 1.18, -0.26];
        limb(sh, el, 0.09, sleeve); limb(el, hd, 0.075, fore); ink(el, hd); box(0.085, 0.08, 0.085, skin, hd[0], hd[1], hd[2] - 0.03);
        cyl(0.04, 0.03, 0.12, 10, col('#f4f2ee', 0.6), hd[0], hd[1] + 0.06, hd[2] - 0.08); cyl(0.041, 0.035, 0.045, 10, col('#8a5a2b', 0.8), hd[0], hd[1] + 0.06, hd[2] - 0.08); cyl(0.043, 0.043, 0.012, 10, col('#ffffff', 0.4), hd[0], hd[1] + 0.126, hd[2] - 0.08);
      });
    };
    const frame = parent;
    const joined = (pose) => { parent = null; sink = []; body(pose); const items = sink; sink = null; parent = frame; const m = new THREE.Mesh(joinColored(items), bodyMat); m.castShadow = true; m.receiveShadow = true; return m; };
    const seatMesh = joined('desk');
    seatMesh.applyMatrix4(frame);
    group.add(seatMesh);
    if (L.word) { // the word on the back and the chest of the shirt
      const t = canvasTexture(256, 96, (g, cw, ch) => { g.fillStyle = L.top; g.fillRect(0, 0, cw, ch); g.fillStyle = '#7a1f1f'; g.textAlign = 'center'; g.textBaseline = 'middle'; if (L.wordMany) { g.font = `700 26px ${FONT}`; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.fillText(L.word, 44 + c * 84, 18 + r * 31); } else { g.font = `700 64px ${FONT}`; g.fillText(L.word, cw / 2, ch / 2 + 4); } });
      const wm = mk({ map: t, roughness: 0.85 });
      [[0.1615, 0], [-0.0415, Math.PI]].forEach(([z, r]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(L.wordMany ? 0.32 : 0.24, L.wordMany ? 0.26 : 0.09), wm); m.applyMatrix4(at(0, 0.95 + up, z, r)); seatMesh.add(m); });
    }
    [-1, 1].forEach((k) => { // the hands tap on the keys
      const m = new THREE.Mesh(handGeo, skin);
      m.position.set(k * 0.11, dy + 0.035, -reach); m.castShadow = false;
      seatMesh.add(m);
      typing.push({ m, y: m.position.y + (L.eat ? 0.07 : 0), sp: L.eat ? 0.004 : 0.016 + ((idx * 7 + (k > 0 ? 3 : 0)) % 5) * 0.003, ph: idx * 1.7 + (k > 0 ? 2.1 : 0), amp: L.eat ? 0.09 : 0.014 });
    });
    // The same person on their feet, in two steps of a walk, for the coffee run.
    const wa = joined('walkA'), wb = joined('walkB'), wg = new THREE.Group();
    wg.add(wa, wb); wg.visible = false; group.add(wg);
    const me = { seat: seatMesh, wg, wa, wb, route: routeFor(chair), state: 'sit', name: L.name, chair };
    walkers.push(me);
    if (L.nap) { // sometimes he leaves his glasses on the kitchen table and sleeps on the sofa beside it
      const lying = joined('lie'); lying.rotation.order = 'YXZ'; lying.rotation.set(Math.PI / 2, Math.PI / 2, 0); lying.position.set(-2.38, 0.6, -5.39); lying.visible = false; group.add(lying);
      const zz = bubble('zzz...'); zz.position.set(0.3, 1.5, -0.5); lying.add(zz);
      const gl = new THREE.Group(), blk = col('#0c0d0f', 0.4), bit = (bw, bh, bd, x, y, z) => { const m = new THREE.Mesh(unitBox, blk); m.scale.set(bw, bh, bd); m.position.set(x, y, z); gl.add(m); };
      bit(0.21, 0.012, 0.012, 0, 0.03, 0); [-1, 1].forEach((k) => { bit(0.075, 0.05, 0.012, k * 0.05, 0.027, 0); bit(0.01, 0.012, 0.12, k * 0.103, 0.006, 0.06); });
      gl.position.set(-2.08, Hh.desk, -6.12); gl.rotation.y = 0.5; gl.visible = false; group.add(gl);
      me.nap = { lying, gl, path: toV([[chair.cx, chair.cy], [chair.cx, A2], [2.5, A2], [2.5, 6.12]]) };
    }
    if (L.golf) { // a golf bag with clubs, standing behind him
      const bag = col('#1f3b2c', 0.8), steel = M.chrome, bx = 0, bz = 0.6;
      cyl(0.12, 0.1, 0.86, 14, bag, bx, 0.43, bz); cyl(0.125, 0.125, 0.04, 14, col('#111316', 0.6), bx, 0.88, bz); box(0.05, 0.3, 0.1, col('#111316', 0.6), bx, 0.5, bz - 0.12);
      [[-0.05, -0.04, 0.34, 0], [0.05, -0.03, 0.42, 1], [0, 0.05, 0.38, 2], [-0.04, 0.04, 0.3, 3], [0.06, 0.05, 0.26, 4]].forEach(([dx, dz, h, n]) => {
        cyl(0.008, 0.008, h, 6, steel, bx + dx, 0.88 + h / 2, bz + dz);
        box(n < 2 ? 0.09 : 0.06, n < 2 ? 0.045 : 0.035, n < 2 ? 0.06 : 0.02, n < 2 ? col('#22252b', 0.4) : steel, bx + dx + 0.02, 0.88 + h + 0.015, bz + dz, true, n * 1.1);
      });
    }
    if (L.eat) {
      // Lunch at the desk: a glass container heaped over the brim, and takeaway coffee cups everywhere.
      const z0 = -reach - 0.02;
      box(0.26, 0.09, 0.18, M.glass, 0, dy + 0.045, z0, false);
      box(0.24, 0.075, 0.16, col('#d8a24a'), 0, dy + 0.045, z0, false);
      [[0, 0.11, 0, 0.2, 0.05, 0.13, '#c9772e'], [-0.05, 0.14, 0.01, 0.1, 0.04, 0.08, '#6f9a3c'], [0.06, 0.135, -0.02, 0.09, 0.04, 0.07, '#b5432f'], [0, 0.165, 0, 0.07, 0.03, 0.06, '#e8d9a8']].forEach(([x, y, z, bw, bh, bd, c]) => box(bw, bh, bd, col(c), x, dy + y, z0 + z, false));
      const cup = col('#f4f2ee', 0.6), band = col('#1f6b45', 0.7), lid = col('#ffffff', 0.4), r2 = rng(22);
      const spots = [];
      for (let n = 0; n < 400 && spots.length < 26; n++) {
        const x = (r2() - 0.5) * 1.44, z = -gap - 0.07 - r2() * 0.52;
        if (Math.abs(x) < 0.3 && z > z0 - 0.2) continue; // keep the lunch and his hands clear
        if (spots.some((q) => Math.hypot(q[0] - x, q[1] - z) < 0.088)) continue;
        spots.push([x, z]);
      }
      spots.forEach(([x, z], n) => {
        const h = n % 3 ? 0.13 : 0.16;
        cyl(0.04, 0.03, h, 12, cup, x, dy + h / 2, z, false);
        cyl(0.039, 0.034, 0.05, 12, band, x, dy + h * 0.5, z, false);
        cyl(0.043, 0.043, 0.012, 12, lid, x, dy + h + 0.006, z, false);
      });
      for (let n = 0; n < 16; n++) { const a = r2() * 6.3, d = 0.45 + r2() * 0.75, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.8 + 0.25; cyl(0.04, 0.03, 0.13, 12, cup, x, 0.065, z, false); cyl(0.039, 0.034, 0.05, 12, band, x, 0.065, z, false); cyl(0.043, 0.043, 0.012, 12, lid, x, 0.136, z, false); } // and more cups on the floor round him
      return;
    }
    const far = -(gap + deskDepth - 0.15); // where the screens stand
    if (false && L.postits) { // moved: the post-its are now on the front of the wide screen (see WIDE below)
      const hold = new THREE.Group(); hold.applyMatrix4(frame); group.add(hold);
      [0.47, 0.39].forEach((x, n) => { const m = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: '#4aa3e8' })); m.scale.set(0.07, 0.07, 0.004); m.position.set(x, dy + 0.215 + n * 0.012, far + 0.03 + n * 0.004); hold.add(m); glitch.push({ m, x, y: m.position.y }); });
    }
    if (L.goose) { // a goose on the desk
      const white = col('#f7f6f2', 0.7), orange = col('#f08a1c', 0.6);
      [[-0.45, 0.3], [-0.6, 0.1], [0.5, 0.3]].forEach(([gx, gb]) => { const gz = -gap - gb;
      box(0.13, 0.12, 0.22, white, gx, dy + 0.13, gz); box(0.1, 0.07, 0.08, white, gx, dy + 0.17, gz + 0.13, true, 0, 0.5);
      limb([gx, dy + 0.16, gz - 0.09], [gx, dy + 0.33, gz - 0.13], 0.045, white); box(0.06, 0.055, 0.075, white, gx, dy + 0.35, gz - 0.15);
      box(0.035, 0.022, 0.06, orange, gx, dy + 0.34, gz - 0.21); box(0.012, 0.012, 0.012, col('#111316'), gx + 0.031, dy + 0.362, gz - 0.165, false); box(0.012, 0.012, 0.012, col('#111316'), gx - 0.031, dy + 0.362, gz - 0.165, false);
      [-1, 1].forEach((k) => { box(0.015, 0.07, 0.015, orange, gx + k * 0.035, dy + 0.035, gz); box(0.04, 0.008, 0.06, orange, gx + k * 0.035, dy + 0.004, gz - 0.015, false); });
    });
    }
    if (L.mess) { // food, crumpled tissues, pill boxes and an apple around the keyboard
      const r3 = rng(29), white = col('#f7f6f2', 0.95), zN = -gap - 0.06;
      [[-0.52, 0.2, 0.16, 0.06, 0.12, '#e9dcc0'], [-0.5, 0.42, 0.12, 0.1, 0.12, '#d84a3a'], [0.52, 0.36, 0.14, 0.05, 0.14, '#f2c14e'], [-0.3, 0.5, 0.1, 0.12, 0.07, '#7b4a2a'], [0.56, 0.12, 0.11, 0.035, 0.11, '#e8e2d6']].forEach(([x, z, bw, bh, bd, c2]) => box(bw, bh, bd, col(c2), x, dy + bh / 2, zN - z, true, r3() * 1.5));
      cyl(0.07, 0.05, 0.05, 12, col('#e8e2d6'), 0.56, dy + 0.06, zN - 0.12, false); cyl(0.06, 0.06, 0.012, 12, col('#c9772e'), 0.56, dy + 0.09, zN - 0.12, false);
      for (let n = 0; n < 16; n++) { const x = (r3() - 0.5) * 1.3, z = zN - r3() * 0.5; if (Math.abs(x) < 0.26 && z > zN - 0.26) continue; const q = 0.035 + r3() * 0.03; box(q, q * 0.7, q, white, x, dy + q * 0.35, z, false, r3() * 3, r3() * 0.6); }
      [[0.34, 0.3, '#2f7fd1'], [0.4, 0.4, '#d13b3b'], [-0.36, 0.3, '#2aa66a'], [0.3, 0.46, '#e0a11b']].forEach(([x, z, c2], n) => { box(0.09, 0.03, 0.05, white, x, dy + 0.015, zN - z, false, n * 0.8); box(0.03, 0.031, 0.051, col(c2), x, dy + 0.0155, zN - z, false, n * 0.8); });
      cyl(0.036, 0.03, 0.06, 12, col('#c8202a', 0.4), -0.34, dy + 0.03, zN - 0.12, false); box(0.006, 0.02, 0.006, col('#4b3621'), -0.34, dy + 0.068, zN - 0.12, false);
    }
    if (L.cars) { // tiny toy cars, parked in two tidy rows either side of the keyboard
      const tyre = col('#15171a', 0.9), glass = col('#cfe3ee', 0.3);
      ['#d6312b', '#f2c21a', '#2f6fd0', '#2aa66a', '#f07f1c', '#f4f3ef', '#7a3fb8', '#1b1d21'].forEach((c2, n) => {
        const x = (n < 4 ? -1 : 1) * 0.5, z = -gap - 0.12 - (n % 4) * 0.075, m = col(c2, 0.4);
        box(0.085, 0.016, 0.036, m, x, dy + 0.02, z, false); box(0.042, 0.014, 0.032, n % 2 ? m : glass, x - 0.004, dy + 0.035, z, false);
        [-1, 1].forEach((a) => [-1, 1].forEach((b) => box(0.018, 0.018, 0.008, tyre, x + a * 0.026, dy + 0.009, z + b * 0.018, false)));
      });
    }
    if (L.flask) { // a thin metal water flask, narrower at the top, with a steel lid
      const fx = 0.34, fz = -gap - 0.36, steel = mk({ color: '#c9ced3', roughness: 0.25, metalness: 0.85 }), blue = mk({ color: '#3d9fd0', roughness: 0.3, metalness: 0.6 });
      cyl(0.03, 0.034, 0.15, 16, blue, fx, dy + 0.075, fz); cyl(0.017, 0.03, 0.06, 16, blue, fx, dy + 0.18, fz, false); cyl(0.019, 0.019, 0.032, 16, steel, fx, dy + 0.226, fz, false);
    }
    if (L.lines) talkers.push({ name: L.name, k: 0, holder: seatMesh, lines: L.lines, rare: L.rare || 1, cache: {}, on: null, until: 0 });
    if (L.cough) { const sp = tagSprite('*cough cough*', '#ffffff'); sp.position.set(-0.3, 1.42, -0.12); sp.scale.set(0.3, 0.085, 1); seatMesh.add(sp); coughs.push(sp); }
    const plate = (text, w, h, x, y, z, ry, rx, bg, fg) => { // a small flat label
      const t = canvasTexture(256, Math.max(24, Math.round(256 * h / w)), (g, cw, ch) => { g.fillStyle = bg; g.fillRect(0, 0, cw, ch); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${Math.round(ch * 0.5)}px ${FONT}`; g.fillText(text, cw / 2, ch / 2 + 2, cw - 14); });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mk({ map: t, roughness: 0.8 })); m.applyMatrix4(at(x, y, z, ry, rx)); m.applyMatrix4(frame); group.add(m);
    };
    if (L.cup) { const x = 0.42, z = -gap - 0.16; cyl(0.04, 0.032, 0.11, 14, col('#f7f6f2', 0.6), x, dy + 0.055, z); cyl(0.043, 0.043, 0.014, 14, col('#111316', 0.5), x, dy + 0.117, z, false); plate(L.cup, 0.07, 0.03, x, dy + 0.06, z + 0.041, 0, 0, '#f7f6f2', '#111316'); }
    if (L.mint) { const x = -0.4, z = -gap - 0.1; box(0.06, 0.012, 0.036, col('#d3202a', 0.4), x, dy + 0.006, z, false); plate('MINTIA', 0.05, 0.02, x, dy + 0.0125, z, 0, -Math.PI / 2, '#d3202a', '#ffffff'); }
    if (L.tea) { // a cup of tea, and two used teabags lying beside it
      const x = -0.3, z = -gap - 0.3; cyl(0.042, 0.034, 0.08, 14, col('#f7f6f2', 0.5), x, dy + 0.04, z); cyl(0.037, 0.037, 0.004, 14, col('#8a4b1c', 0.3), x, dy + 0.079, z, false); box(0.012, 0.045, 0.03, col('#f7f6f2', 0.5), x + 0.05, dy + 0.04, z, false);
      [[0.1, 0.02, 0.4], [0.16, -0.05, -0.5]].forEach(([ox, oz, r]) => { box(0.045, 0.01, 0.055, col('#b08a5a', 0.95), x + ox, dy + 0.005, z + oz, false, r); box(0.003, 0.003, 0.07, col('#f1efea'), x + ox + 0.02, dy + 0.004, z + oz + 0.05, false, r + 0.5); box(0.02, 0.003, 0.02, col('#e8c531'), x + ox + 0.04, dy + 0.003, z + oz + 0.085, false, r); });
    }
    if (L.cans) { const can = col('#141416', 0.35), red = col('#d3202a', 0.4), r5 = rng(51); for (let n = 0; n < 10; n++) { const x = (r5() - 0.5) * 1.2, z = -gap - 0.08 - r5() * 0.45; if (Math.abs(x) < 0.27 && z > -gap - 0.24) continue; cyl(0.022, 0.022, 0.075, 10, can, x, dy + 0.0375, z, false); cyl(0.0225, 0.0225, 0.02, 10, red, x, dy + 0.04, z, false); } } // small cans of zero sugar cola
    if (L.truck) { // a colourful toy truck in a small clear box
      const x = 0.42, z = -gap - 0.3, y = dy;
      box(0.2, 0.008, 0.09, col('#1b1d21', 0.6), x, y + 0.004, z, false); box(0.06, 0.05, 0.05, col('#d6312b', 0.4), x - 0.05, y + 0.045, z); box(0.1, 0.035, 0.052, col('#2f6fd0', 0.4), x + 0.035, y + 0.04, z); box(0.1, 0.012, 0.054, col('#f2c21a', 0.4), x + 0.035, y + 0.064, z, false); box(0.03, 0.02, 0.046, col('#cfe3ee', 0.3), x - 0.062, y + 0.055, z, false);
      [-0.055, 0.01, 0.06].forEach((ox) => [-1, 1].forEach((k) => box(0.022, 0.022, 0.01, col('#2aa66a', 0.6), x + ox, y + 0.019, z + k * 0.028, false)));
      box(0.21, 0.1, 0.1, (M.clearBox ||= mk({ color: '#eaf4fa', transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false })), x, y + 0.058, z, false);
    }
    if (L.cards) { // name cards all over the desk and the floor, and cartons of them
      const r6 = rng(61), white = col('#fbfaf6', 0.9), carton = col('#b88a55', 0.95);
      for (let n = 0; n < 46; n++) { const x = (r6() - 0.5) * 1.3, z = -gap - 0.04 - r6() * 0.5; if (Math.abs(x) < 0.27 && z > -gap - 0.22) continue; box(0.05, 0.002, 0.03, white, x, dy + 0.002 + (n % 3) * 0.002, z, false, r6() * 3); }
      for (let n = 0; n < 70; n++) { const a = r6() * 6.3, d = 0.35 + r6() * 1.0; box(0.05, 0.002, 0.03, white, Math.cos(a) * d, 0.003, Math.sin(a) * d * 0.8 + 0.3, false, r6() * 3); }
      box(0.2, 0.12, 0.15, carton, -0.5, dy + 0.06, -gap - 0.36, true, 0.3); box(0.17, 0.01, 0.12, white, -0.5, dy + 0.122, -gap - 0.36, false, 0.3);
    }
    if (L.name && !L.noTag) { // a small name tag over the head, also while walking
      const t = canvasTexture(256, 72, (g, cw, ch) => {
        g.clearRect(0, 0, cw, ch); g.fillStyle = 'rgba(12,14,18,0.78)'; g.beginPath(); g.roundRect(4, 6, cw - 8, ch - 12, 28); g.fill();
        g.fillStyle = '#f3e3b0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 40px ${FONT}`; g.fillText(L.name, cw / 2, ch / 2 + 3, cw - 30);
      });
      const nm = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
      [[seatMesh, 1.62 + up], [wg, 1.92]].forEach(([holder, y]) => { const sp = new THREE.Sprite(nm); sp.position.set(0, y, 0.03); sp.scale.set(0.36, 0.1, 1); holder.add(sp); tags.push({ sp, y, ph: idx }); });
    }
    // Keyboard and mouse on the desk in front of them.
    if (L.glowKeys) { // a keyboard that glows in bands of colour
      box(0.46, 0.022, 0.16, col('#0c0d10', 0.4), 0, dy + 0.011, -reach - 0.01, false);
      ['#ff2bd6', '#7a5cff', '#19d3ff', '#2bff9a', '#ffe14a'].forEach((c2, n) => box(0.084, 0.006, 0.14, (tone['glow' + c2] ||= mk({ color: c2, emissive: c2, emissiveIntensity: 0.7, roughness: 0.4 })), -0.176 + n * 0.088, dy + 0.025, -reach - 0.01, false));
      typing.push({ glow: Object.keys(tone).filter((q) => q.startsWith('glow')).map((q) => tone[q]) });
      box(0.06, 0.025, 0.1, M.leg, 0.31, dy + 0.0125, -reach, false);
      return;
    }
    box(0.42, 0.018, 0.14, L.whiteKeys ? col('#f4f3ef', 0.5) : L.pinkKeys ? col('#f29ac0', 0.5) : M.leg, 0, dy + 0.009, -reach - 0.01, false);
    box(0.06, 0.025, 0.1, M.leg, 0.31, dy + 0.0125, -reach, false);
  };
  D.chairs.filter((c) => !c.stool).forEach((c) => {
    let best = null, bd = 1e9;
    surfaces.filter((s) => s.room === c.room).forEach((s) => { const dx = Math.max(Math.abs(c.cx - s.cx) - s.w / 2, 0), dy = Math.max(Math.abs(c.cy - s.cy) - s.d / 2, 0); const dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = s; } });
    let ry = 0;
    if (best) { const tx = Math.min(Math.max(c.cx, best.cx - best.w / 2), best.cx + best.w / 2), ty = Math.min(Math.max(c.cy, best.cy - best.d / 2), best.cy + best.d / 2); ry = Math.atan2(tx - c.cx, ty - c.cy); }
    parent = at(-c.cx, 0, -c.cy, ry);
    if (!c.stand) officeChair();
    // Desk chairs (yellow and white desks) have someone working at the keyboard. Meeting and boardroom chairs stay empty.
    if (best && desks.includes(best)) worker(D0.chairs.findIndex((q) => q.cy === c.cy && (q.cx === c.cx || (q.mid && c.mid && Math.abs(mx(q.cx) - c.cx) < 1e-6))), Math.sqrt(bd), ry, best.hh || Hh.desk, c.stand, Math.abs(Math.sin(ry)) > 0.7 ? best.w : best.d, c);
    parent = null;
  });
  let nextTrip = 0, dbgTrip = null, nextTalk = 0, snowAt = 0;
  group.userData.trip = (who, kind) => { dbgTrip = [who, kind]; };
  // Test mode: everybody at a desk says a line at once, the next line of their list on each press.
  group.userData.talk = () => {
    const now = performance.now(); let n = 0;
    for (const t of talkers) {
      if (!t.holder.visible) continue;
      if (t.on) t.on.visible = false;
      const text = t.lines[t.k++ % t.lines.length];
      const sp = (t.cache[text] ||= (() => { const q = bubble(text); q.position.set(0.22, 1.9, 0); t.holder.add(q); return q; })());
      sp.visible = true; t.on = sp; t.until = now + 4500; n++;
    }
    nextTalk = now + 5000;
    return n;
  };
  const startVisit = (q, v, o) => {
    const spot = [o.chair.cx + v.off[0], o.chair.cy + v.off[1]], lane = Math.abs(spot[1] - A1) < Math.abs(spot[1] - A2) ? A1 : A2;
    q.path = toV([...toAisle(q.chair), ...(lane === A2 ? [[XR, A2]] : []), [spot[0], lane], spot]);
    q.talk = { at: V(-o.chair.cx, 0, -o.chair.cy) };
    if (!q.say) { q.say = bubble(v.say); q.say.position.set(0.25, 2.2, 0); q.wg.add(q.say); }
    q.say.visible = false;
  };
  group.userData.tick = (now) => {
    for (const h of typing) { if (h.glow) { h.glow.forEach((m, n) => { m.emissiveIntensity = 0.55 + 0.35 * Math.sin(now * 0.004 + n * 1.2); }); continue; } h.m.position.y = h.y + Math.max(0, Math.sin(now * h.sp + h.ph)) * h.amp; }
    for (const t of tags) t.sp.position.y = t.y + Math.sin(now * 0.002 + t.ph) * 0.02; // name tags hover
    // Somebody says a line every few seconds; it shows for a moment and goes.
    if (!nextTalk) nextTalk = now + 3000;
    if (now > nextTalk) {
      const c = talkers.filter((t) => t.holder.visible && !t.on), t = c[Math.floor(Math.random() * c.length)];
      if (t && Math.random() < t.rare) { const text = t.lines[Math.floor(Math.random() * t.lines.length)]; const sp = (t.cache[text] ||= (() => { const q = bubble(text); q.position.set(0.22, 1.9, 0); t.holder.add(q); return q; })()); sp.visible = true; t.on = sp; t.until = now + 3400; }
      nextTalk = now + 2200 + Math.random() * 3200;
    }
    for (const t of talkers) if (t.on && now > t.until) { t.on.visible = false; t.on = null; }
    for (const sp of coughs) sp.visible = now % 2600 < 900;
    for (const q of glitch) { const on = Math.random() < 0.3; q.m.position.x = q.x + (on ? (Math.random() - 0.5) * 0.03 : 0); q.m.position.y = q.y + (on ? (Math.random() - 0.5) * 0.02 : 0); q.m.visible = Math.random() > 0.06; q.m.material.color.set(on ? (Math.random() < 0.5 ? '#ff3df2' : '#3dfff2') : '#4aa3e8'); }
    { const dt = Math.min(0.2, (now - (snowAt || now)) / 1000); snowAt = now; for (const f of snow) { const a = f.pts.geometry.attributes.position; for (let i = 0; i < a.count; i++) { let y = a.getY(i) - (0.22 + (i % 5) * 0.05) * dt; if (y < 0) y = 2.6; a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(now * 0.001 + i) * 0.03 * dt); } a.needsUpdate = true; } }
    // Now and then somebody gets up, walks out of the main door with a coffee, and comes back to their desk.
    if (dbgTrip) { const [who, kind] = dbgTrip; dbgTrip = null; const free = walkers.filter((w) => w.state === 'sit' && w.name !== 'Jeff' && w.route), q = who === 'any' ? free[Math.floor(Math.random() * free.length)] : walkers.find((w) => w.name === who && w.state === 'sit'); if (q) { const v = VISITS[who], o = v && walkers.find((w) => w.name === v.to); q.sleep = kind === 'nap'; if (q.sleep) { q.path = q.nap.path; q.talk = null; } else if (kind === 'visit' && o) startVisit(q, v, o); else { q.path = q.route; q.talk = null; } q.state = 'go'; q.i = 0; q.d = 0; q.last = now; q.seat.visible = false; q.wg.visible = true; } }
    if (!nextTrip) nextTrip = now + 6000 + Math.random() * 8000;
    if (now > nextTrip && walkers.filter((q) => q.state !== 'sit').length < 2) {
      const free = walkers.filter((q) => q.state === 'sit');
      // Half of the trips are a visit to a colleague's desk; the rest are coffee runs out of the door.
      const callers = free.filter((q) => VISITS[q.name] && walkers.some((o) => o.name === VISITS[q.name].to && o.state === 'sit'));
      const q = callers.length && Math.random() < 0.5 ? callers[Math.floor(Math.random() * callers.length)] : (() => { const cf = free.filter((w) => !w.nap); return cf[Math.floor(Math.random() * cf.length)]; })();
      const jeff = free.find((w) => w.nap);
      if (jeff && Math.random() < 0.18) { jeff.path = jeff.nap.path; jeff.talk = null; jeff.sleep = true; jeff.state = 'go'; jeff.i = 0; jeff.d = 0; jeff.last = now; jeff.seat.visible = false; jeff.wg.visible = true; }
      else if (q) {
        q.sleep = false;
        const v = callers.includes(q) && VISITS[q.name], o = v && walkers.find((w) => w.name === v.to);
        if (v) startVisit(q, v, o);
        else { q.path = q.route; q.talk = null; if (q.say) q.say.visible = false; }
        q.state = 'go'; q.i = 0; q.d = 0; q.last = now; q.seat.visible = false; q.wg.visible = true;
      }
      nextTrip = now + 12000 + Math.random() * 16000;
    }
    for (const q of walkers) {
      if (q.state === 'sit') continue;
      const dt = Math.min(0.1, (now - q.last) / 1000); q.last = now;
      if (q.state === 'away') { if (now > q.until) { if (q.sleep) { q.nap.lying.visible = false; q.nap.gl.visible = false; } q.state = 'back'; q.i = q.path.length - 1; q.d = 0; q.wg.visible = true; if (q.say) q.say.visible = false; } continue; }
      const dir = q.state === 'go' ? 1 : -1, from = q.path[q.i], to = q.path[q.i + dir];
      if (!to) {
        if (q.state === 'go' && q.sleep) { q.state = 'away'; q.until = now + 14000 + Math.random() * 10000; q.wg.visible = false; q.nap.lying.visible = true; q.nap.gl.visible = true; }
        else if (q.state === 'go' && q.talk) { // stands by the desk, turned to the colleague, and talks for a while
          q.state = 'away'; q.until = now + 7000 + Math.random() * 5000; q.wg.position.set(from.x, 0, from.z);
          q.wg.rotation.y = Math.atan2(-(q.talk.at.x - from.x), -(q.talk.at.z - from.z)); q.wa.visible = true; q.wb.visible = false; q.say.visible = true;
        } else if (q.state === 'go') { q.state = 'away'; q.until = now + 5000 + Math.random() * 6000; q.wg.visible = false; }
        else { q.state = 'sit'; q.wg.visible = false; q.seat.visible = true; }
        continue;
      }
      const len = from.distanceTo(to); q.d += dt * 1.3;
      if (q.d >= len) { q.i += dir; q.d = 0; continue; }
      const f = q.d / len;
      q.wg.position.set(from.x + (to.x - from.x) * f, Math.abs(Math.sin(now * 0.011)) * 0.025, from.z + (to.z - from.z) * f);
      q.wg.rotation.y = Math.atan2(-(to.x - from.x), -(to.z - from.z));
      const stepA = Math.floor(now / 300) % 2 === 0; q.wa.visible = stepA; q.wb.visible = !stepA;
    }
    return walkers.some((q) => q.state === 'go' || q.state === 'back');
  };
  if (live !== 'blackjack') { // the blackjack table in the open office, round side to the sofa, flat side to the desks
    const G = (M.games ||= { rail: mk({ color: '#3a2114', roughness: 0.7 }), felt: mk({ color: '#0f6b3f', roughness: 0.95 }), line: mk({ color: '#d9c27a', roughness: 0.6 }), dark: mk({ color: '#15171c', roughness: 0.5 }), red: mk({ color: '#c62f2f', roughness: 0.5 }), card: mk({ color: '#fbfaf6', roughness: 0.5 }) });
    const B = OTHER_TABLES.blackjack, R = B.r, top = Hh.desk;
    const half = (r) => { const sh = new THREE.Shape(); sh.moveTo(0, -r); sh.absarc(0, 0, r, -Math.PI / 2, Math.PI / 2, false); sh.lineTo(-0.12, r); sh.lineTo(-0.12, -r); sh.closePath(); return sh; };
    const rg = new THREE.ExtrudeGeometry(half(R + 0.09), { depth: 0.07, bevelEnabled: false, curveSegments: 20 }); rg.rotateX(-Math.PI / 2); emit(rg, G.rail, at(-B.x, top - 0.05, -B.y), true);
    const fg = new THREE.ExtrudeGeometry(half(R), { depth: 0.04, bevelEnabled: false, curveSegments: 20 }); fg.rotateX(-Math.PI / 2); emit(fg, G.felt, at(-B.x, top - 0.015, -B.y), true);
    [-1, 1].forEach((sg) => { cyl(0.07, 0.1, top - 0.05, 12, G.rail, -B.x + 0.3, (top - 0.05) / 2, -B.y + sg * R * 0.5); cyl(0.2, 0.22, 0.03, 14, M.leg, -B.x + 0.3, 0.015, -B.y + sg * R * 0.5, false); });
    box(0.1, 0.05, 0.14, G.dark, -B.x - 0.02, top + 0.05, -B.y - R * 0.6, false); // the shoe by the dealer
    for (let i = 0; i < 2; i++) box(0.089, 0.002, 0.064, G.card, -B.x + 0.1, top + 0.027, -B.y + (i - 0.5) * 0.08, false);
  }
  { // A dark bottle of hand sanitizer with a pump, on the round table.
    const t = D.furniture.find((f) => f.id === 't3');
    if (t) { const x = -(t.cx - 0.12), z = -(t.cy + 0.08), y = Hh.desk; cyl(0.032, 0.034, 0.13, 14, col('#2a1a12', 0.35), x, y + 0.065, z); cyl(0.014, 0.02, 0.025, 10, col('#111316', 0.5), x, y + 0.1425, z, false); cyl(0.005, 0.005, 0.04, 6, col('#111316', 0.5), x, y + 0.175, z, false); box(0.045, 0.012, 0.016, col('#111316', 0.5), x + 0.015, y + 0.198, z, false); box(0.04, 0.05, 0.002, col('#e9e6df', 0.8), x, y + 0.06, z + 0.034, false); }
  }
  [].forEach((id) => { // snow removed at the person's request (2026-11-21)
    const r = D.rooms.find((q) => q.id === id); if (!r) return;
    const n = 260, pos = new Float32Array(n * 3), r7 = rng(id.length);
    for (let i = 0; i < n; i++) { pos[i * 3] = -(r.x + 0.1 + r7() * (r.width - 0.2)); pos[i * 3 + 1] = r7() * 2.6; pos[i * 3 + 2] = -(r.y + 0.1 + r7() * (r.depth - 0.2)); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, (M.snow ||= new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false })));
    pts.frustumCulled = false; group.add(pts); snow.push({ pts });
    for (let i = 0; i < 26; i++) box(0.25 + r7() * 0.3, 0.012, 0.25 + r7() * 0.3, col('#f4f7fa', 1), -(r.x + 0.3 + r7() * (r.width - 0.6)), 0.006, -(r.y + 0.3 + r7() * (r.depth - 0.6)), false, r7() * 3); // a little snow on the floor
  });
  group.userData.snowMat = () => M.snow;
  { // The empty PITCHBOOK desk: envelopes and two staplers. The empty desk beside David: a long mouse pad.
    const c1 = D.furniture.find((f) => f.id === 'c1'), c6 = D.furniture.find((f) => f.id === 'c6'), r8 = rng(88), y = Hh.desk;
    if (c1) {
      for (let n = 0; n < 22; n++) box(0.22, 0.004, 0.11, col(n % 3 ? '#f4f1e8' : '#e3d3ad', 0.9), -(c1.cx + (r8() - 0.5) * 1.05), y + 0.003 + (n % 6) * 0.004, -(c1.cy - 0.04 - r8() * 0.24), false, r8() * 3);
      [[0.35, '#111316'], [-0.2, '#c0262d']].forEach(([ox, c2]) => { box(0.15, 0.03, 0.04, col(c2, 0.5), -(c1.cx + ox), y + 0.04, -(c1.cy - 0.3), true, 0.4); box(0.16, 0.014, 0.045, col('#8a8d90', 0.4), -(c1.cx + ox), y + 0.014, -(c1.cy - 0.3), false, 0.4); });
    }
    if (c6) box(0.85, 0.005, 0.32, col('#17181b', 0.9), -c6.cx, y + 0.003, -(c6.cy + 0.14), false);
  }
  { // A roll of kitchen paper, standing upright on the eating table.
    const t = D.furniture.find((f) => f.id === 'et1');
    if (t) { const x = -(t.cx - 0.12), z = -(t.cy - 0.12), y = Hh.desk; cyl(0.07, 0.07, 0.012, 14, col('#8a8d90', 0.4), x, y + 0.006, z, false); cyl(0.057, 0.057, 0.23, 18, col('#f6f5f1', 0.95), x, y + 0.127, z); cyl(0.012, 0.012, 0.27, 8, col('#8a8d90', 0.4), x, y + 0.135, z, false); }
  }
  { // A huge dying plant, grey and withering, in the empty corner between the yellow desk and the dining area.
    const px = -2.5, pz = -7.78, grey = col('#8d8f8c', 0.95), pale = col('#b3b4ae', 0.95), dark = col('#5f615e', 0.95), r4 = rng(77);
    cyl(0.3, 0.22, 0.46, 16, col('#6f7170', 0.8), px, 0.23, pz); cyl(0.27, 0.27, 0.02, 16, col('#3b3a37', 1), px, 0.462, pz, false);
    const tip = [px + 0.1, 1.72, pz + 0.06];
    limb([px, 0.46, pz], [px - 0.05, 1.05, pz - 0.03], 0.07, dark); limb([px - 0.05, 1.05, pz - 0.03], tip, 0.055, dark);
    for (let n = 0; n < 11; n++) { // long leaves that leave the trunk, then hang down
      const a = n * 2.4 + r4(), h = 0.85 + (n / 11) * 0.85, out = 0.32 + r4() * 0.3, dx = Math.cos(a), dz = Math.sin(a) * 0.55;
      const b0 = [px + (h - 0.46) * 0.04, h, pz], b1 = [b0[0] + dx * out * 0.6, h + 0.12, b0[2] + dz * out * 0.6], b2 = [b0[0] + dx * out, h - 0.28 - r4() * 0.3, b0[2] + dz * out];
      limb(b0, b1, 0.022, dark); limb(b1, b2, 0.09, n % 3 ? grey : pale); limb(b2, [b2[0] + dx * 0.04, b2[1] - 0.2, b2[2] + dz * 0.04], 0.04, n % 2 ? grey : dark);
    }
    { const sp = tagSprite('Very Dead Plant', '#d8d8d2'); sp.position.set(px, 0.62, pz + 0.36); sp.scale.set(0.5, 0.14, 1); group.add(sp); }
    for (let n = 0; n < 9; n++) box(0.1, 0.006, 0.05, n % 2 ? grey : pale, px + (r4() - 0.5) * 1.1, 0.004, pz + (r4() - 0.3) * 0.7, false, r4() * 3); // fallen leaves
  }
  // One desk has card games on its two screens: poker on one, blackjack on the other.
  const gameScreen = (k) => (M['game' + k] ||= new THREE.MeshBasicMaterial({ map: canvasTexture(512, 300, (g, cw, ch) => {
    if (k > 0) g.fillStyle = '#e9e6e1'; else g.fillStyle = '#0f5a3c';
    g.fillRect(0, 0, cw, ch);
    if (k < 0) { g.fillStyle = '#0b4630'; g.beginPath(); g.ellipse(cw / 2, ch / 2 + 16, 220, 104, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#d9b45a'; g.lineWidth = 5; g.stroke(); }
    const card = (x, y, t, red) => { g.fillStyle = '#fff'; g.beginPath(); g.roundRect(x, y, 46, 64, 6); g.fill(); g.fillStyle = red ? '#c8202a' : '#111'; g.font = `700 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x + 23, y + 34); };
    const chip = (x, y, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]); };
    g.fillStyle = '#f2e3b0'; g.font = `700 30px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; if (k < 0) g.fillText('POKER', cw / 2, 30);
    if (k < 0) { ['A♠', 'A♥', 'A♦', 'A♣', 'K♠'].forEach((t, n) => card(126 + n * 54, 118, t, /[♥♦]/.test(t))); card(196, 216, '7♥', true); card(250, 216, '2♠', false); g.fillStyle = '#ffd24a'; g.font = `700 30px ${FONT}`; g.fillText('ALL IN', 400, 250); [[90, 150, '#c8202a'], [420, 160, '#2f7fd1'], [402, 190, '#111']].forEach(([x, y, c]) => chip(x, y, c)); }
    else { // a slide deck being edited
      g.fillStyle = '#b7472a'; g.fillRect(0, 0, cw, 34); g.fillStyle = '#fff'; g.font = `700 18px ${FONT}`; g.textAlign = 'left'; g.fillText('Deck_v37_FINAL_final2.pptx', 12, 18);
      g.fillStyle = '#e9e6e1'; g.fillRect(0, 34, cw, ch - 34); g.fillStyle = '#d6d2cb'; g.fillRect(0, 34, 92, ch - 34);
      for (let n = 0; n < 4; n++) { g.fillStyle = '#fff'; g.fillRect(12, 46 + n * 62, 68, 44); g.fillStyle = '#b7472a'; g.fillRect(16, 50 + n * 62, 30, 5); }
      g.fillStyle = '#fff'; g.fillRect(112, 52, 380, 226); g.fillStyle = '#222'; g.font = `700 24px ${FONT}`; g.fillText('Investment highlights', 130, 82);
      g.fillStyle = '#b7472a'; g.fillRect(130, 98, 340, 3); [0, 1, 2].forEach((n) => { g.fillStyle = '#555'; g.fillRect(140, 122 + n * 30, 150 - n * 20, 8); }); [60, 95, 75, 120].forEach((h2, n) => { g.fillStyle = n === 3 ? '#b7472a' : '#9aa3ad'; g.fillRect(330 + n * 36, 250 - h2, 26, h2); });
    }
  }) }));
  const pic = (key, w, h, draw) => (M['pic' + key] ||= new THREE.MeshBasicMaterial({ map: canvasTexture(w, h, draw) }));
  const T = (g, text, x, y, size, c = '#fff', al = 'left') => { g.fillStyle = c; g.textAlign = al; g.textBaseline = 'middle'; g.font = `700 ${size}px ${FONT}`; g.fillText(text, x, y); };
  const person = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y - r * 0.5, r * 0.55, 0, 7); g.fill(); g.beginPath(); g.ellipse(x, y + r * 0.9, r, r * 0.8, 0, Math.PI, 0); g.fill(); };
  const gooseDraw = (g, x, y, k) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, y, 34 * k, 22 * k, 0, 0, 7); g.fill(); g.fillRect(x + 18 * k, y - 52 * k, 12 * k, 44 * k); g.beginPath(); g.arc(x + 26 * k, y - 56 * k, 12 * k, 0, 7); g.fill(); g.fillStyle = '#f08a1c'; g.fillRect(x + 34 * k, y - 60 * k, 16 * k, 7 * k); g.fillRect(x - 6 * k, y + 20 * k, 5 * k, 14 * k); g.fillRect(x + 8 * k, y + 20 * k, 5 * k, 14 * k); g.fillStyle = '#111'; g.fillRect(x + 27 * k, y - 62 * k, 4 * k, 4 * k); };
  const SCREENS = {
    dC: (k) => k < 0 ? pic('call', 512, 300, (g, cw, ch) => { // a video call that never ends
      g.fillStyle = '#17191d'; g.fillRect(0, 0, cw, ch); [['#3b4a5c', '#f0c9a4'], ['#4c3b52', '#e2ad82'], ['#3d5245', '#e8b98f'], ['#52463b', '#d9a377']].forEach(([bg, sk], n) => { const x = 8 + (n % 2) * 252, y = 8 + Math.floor(n / 2) * 126; g.fillStyle = bg; g.fillRect(x, y, 244, 118); person(g, x + 122, y + 62, 34, sk); });
      g.fillStyle = '#d3202a'; g.beginPath(); g.roundRect(216, 264, 80, 28, 14); g.fill(); T(g, 'END', 256, 279, 16, '#fff', 'center'); T(g, '● REC 07:42:13', 12, 280, 14, '#ff5a5a');
    }) : pic('cal', 512, 300, (g, cw, ch) => { // her calendar: full, red, packed
      g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); T(g, 'Calendar: this week', 10, 14, 16, '#222'); const r9 = rng(9);
      for (let d = 0; d < 5; d++) { T(g, ['MON', 'TUE', 'WED', 'THU', 'FRI'][d], 12 + d * 100 + 44, 38, 13, '#555', 'center'); let y = 50; while (y < ch - 4) { const h2 = 14 + Math.floor(r9() * 30); g.fillStyle = ['#d3202a', '#b3141d', '#e5484f', '#8f0f16'][Math.floor(r9() * 4)]; g.fillRect(10 + d * 100, y, 94, Math.min(h2, ch - 4 - y)); g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(14 + d * 100, y + 4, 40 + r9() * 40, 3); y += h2 + 2; } }
    }),
    dS: (k) => k < 0 ? pic('shop', 512, 300, (g, cw, ch) => { // a MUJI shopping page
      g.fillStyle = '#f6f3ee'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#7f0019'; g.fillRect(0, 0, cw, 44); T(g, 'MUJI  online store', 14, 23, 24, '#fff'); T(g, 'Cart (37)', cw - 14, 23, 16, '#fff', 'right');
      for (let n = 0; n < 8; n++) { const x = 14 + (n % 4) * 124, y = 56 + Math.floor(n / 4) * 120; g.fillStyle = '#fff'; g.fillRect(x, y, 112, 108); g.fillStyle = ['#d9cfbd', '#c9c2b4', '#e6ddcc', '#b9b0a0'][n % 4]; g.fillRect(x + 16, y + 10, 80, 54); T(g, 'MUJI', x + 56, y + 78, 14, '#7f0019', 'center'); T(g, '¥' + (490 + n * 300), x + 56, y + 96, 13, '#333', 'center'); }
    }) : pic('flag', 512, 300, (g, cw, ch) => { g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#bc002d'; g.beginPath(); g.arc(cw / 2, ch / 2, 90, 0, 7); g.fill(); }),
    c6: () => M.screen, c8: () => M.screen,
  };
  const weibo = (g, cw, ch) => { // a Weibo style feed
    g.fillStyle = '#f2f2f5'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#ff8200'; g.fillRect(0, 0, cw, 40); T(g, '微博 Weibo', 14, 21, 24, '#fff'); T(g, '热搜', cw - 14, 21, 18, '#fff', 'right');
    for (let n = 0; n < 6; n++) { const x = 14 + (n % 3) * (cw / 3), y = 52 + Math.floor(n / 3) * 124, w = cw / 3 - 26; g.fillStyle = '#fff'; g.fillRect(x, y, w, 112); g.fillStyle = '#ffb35c'; g.beginPath(); g.arc(x + 22, y + 22, 13, 0, 7); g.fill(); g.fillStyle = '#333'; g.fillRect(x + 44, y + 14, w * 0.4, 7); g.fillStyle = '#999'; [0, 1, 2].forEach((q) => g.fillRect(x + 12, y + 48 + q * 16, w - 24 - q * 30, 6)); T(g, '♡ ' + (n * 317 + 88), x + 12, y + 100, 13, '#ff8200'); }
  };
  const geese = (g, cw, ch) => { g.fillStyle = '#8fc7e8'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#6fae5a'; g.fillRect(0, ch * 0.66, cw, ch * 0.34); const n = Math.max(2, Math.round(cw / 260)); for (let q = 0; q < n; q++) gooseDraw(g, (q + 0.45) * (cw / n), ch * 0.62, ch / 300 * (1.3 + (q % 2) * 0.4)); T(g, 'BRUCE', cw / 2, 30, 26, '#fff', 'center'); };
  const WIDE = { c4: weibo, c7: geese }; // a wide curved screen in the middle, and an upright screen to its left
  // Two screens on every desk, at the edge away from the nearest chair and facing it.
  desks.forEach((f) => {
    let best = null, bd = 1e9;
    D.chairs.filter((c) => c.room === f.room).forEach((c) => { const d = (c.cx - f.cx) ** 2 + (c.cy - f.cy) ** 2; if (d < bd) { bd = d; best = c; } });
    const dx = best ? best.cx - f.cx : 0, dy = best ? best.cy - f.cy : 1, alongX = Math.abs(dx) > Math.abs(dy);
    const sgn = alongX ? Math.sign(dx) : Math.sign(dy), half = alongX ? f.w / 2 : f.d / 2, sp = alongX ? f.d : f.w;
    const back = -sgn * (half - 0.15), gap = Math.min(0.29, sp / 2 - 0.27);
    if (WIDE[f.id]) {
      const draw = WIDE[f.id], fx = -(alongX ? sgn : 0), fz = -(alongX ? 0 : sgn);
      parent = at(-(f.cx + (alongX ? back : 0)), f.hh || Hh.desk, -(f.cy + (alongX ? 0 : back)), Math.atan2(fx, fz) + Math.PI);
      [-1, 0, 1].forEach((q) => { // three panels make the curve
        const m = pic(f.id + 'w' + q, 384, 420, (g, cw, ch) => { g.save(); g.translate(-(q + 1) * cw, 0); draw(g, cw * 3, ch); g.restore(); });
        const x = -0.1 - q * 0.272, z = q ? -0.03 : 0, ry = -q * 0.22;
        box(0.285, 0.36, 0.025, M.screen, x, 0.36, z, true, ry); box(0.272, 0.34, 0.003, m, x - 0.0145 * Math.sin(ry), 0.36, z - 0.0145 * Math.cos(ry), false, ry); // the picture lies just in front of the panel, along the way the panel faces
      });
      box(0.05, 0.2, 0.03, M.leg, -0.1, 0.1, 0.03); box(0.3, 0.012, 0.2, M.leg, -0.1, 0, 0.03, false);
      const up = pic(f.id + 'v', 300, 512, (g, cw, ch) => { if (draw === geese) { geese(g, cw, ch); gooseDraw(g, cw / 2, ch * 0.4, 1.6); } else { g.fillStyle = '#16181c'; g.fillRect(0, 0, cw, ch); for (let n = 0; n < 9; n++) { g.fillStyle = n % 2 ? '#2b3038' : '#23272e'; g.fillRect(10, 12 + n * 55, cw - 20, 47); g.fillStyle = '#ffb35c'; g.beginPath(); g.arc(34, 35 + n * 55, 14, 0, 7); g.fill(); g.fillStyle = '#c9ced3'; g.fillRect(60, 24 + n * 55, 120 + (n * 37) % 90, 7); g.fillStyle = '#7d848c'; g.fillRect(60, 40 + n * 55, 180 - (n * 23) % 80, 5); } } });
      const ury = 0.55; // the upright screen is turned in towards the chair, like the curved one beside it
      box(0.36, 0.62, 0.025, M.screen, 0.55, 0.42, -0.1, true, ury); box(0.34, 0.6, 0.003, up, 0.55 - 0.0145 * Math.sin(ury), 0.42, -0.1 - 0.0145 * Math.cos(ury), false, ury);
      if (f.id === 'c4') { // Henry: two blue post-its on the front of the wide screen; they glitch
        const hold = new THREE.Group(); hold.applyMatrix4(parent); group.add(hold);
        [-0.19, -0.105].forEach((x, n) => { const m = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: '#4aa3e8' })); m.scale.set(0.075, 0.075, 0.004); m.position.set(x, 0.47 - n * 0.02, -0.02); hold.add(m); glitch.push({ m, x, y: m.position.y }); });
      }
      const _skip = 0; box(0.04, 0.2, 0.03, M.leg, 0.55, 0.1, -0.07); box(0.2, 0.012, 0.16, M.leg, 0.55, 0, -0.07, false);
      parent = null;
      return;
    }
    [-1, 1].forEach((k) => {
      let px = f.cx, py = f.cy;
      if (alongX) { px += back; py += k * gap; } else { py += back; px += k * gap; }
      const fx = -(alongX ? sgn : 0), fz = -(alongX ? 0 : sgn);
      parent = at(-px, f.hh || Hh.desk, -py, Math.atan2(fx, fz) + Math.PI + k * 0.12 * (alongX ? 1 : -1) * sgn);
      box(0.54, 0.33, 0.025, M.screen, 0, 0.33, 0); box(0.51, 0.3, 0.003, SCREENS[f.id] ? SCREENS[f.id](k) : f.id === 'c3' ? gameScreen(k) : f.id === 'c1' ? (M.pitch ||= new THREE.MeshBasicMaterial({ map: canvasTexture(512, 300, (g, cw, ch) => { g.fillStyle = '#0d0f12'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 78px ${FONT}`; g.fillText('PITCHBOOK', cw / 2, ch / 2 + 4, cw - 40); }) })) : M.logo, 0, 0.33, -0.0125, false); box(0.04, 0.2, 0.03, M.leg, 0, 0.1, 0.03); box(0.22, 0.012, 0.18, M.leg, 0, 0, 0.03, false);
      parent = null;
    });
  });

  for (const b of buckets.values()) {
    const join = (parts, size) => { const out = new Float32Array(b.n * size); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return new THREE.BufferAttribute(out, size); };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', join(b.pos, 3)); g.setAttribute('normal', join(b.nor, 3)); g.setAttribute('uv', join(b.uv, 2));
    const m = new THREE.Mesh(g, b.mat);
    m.castShadow = b.shadow && !b.mat.transparent; m.receiveShadow = !b.mat.transparent;
    if (b.mat.transparent) m.renderOrder = 1;
    group.add(m);
  }
  return group;
}

// ---------- The shop across the lane ----------
// A Hong Kong siu mei shop outside the windows that the seated players face: a white signboard with
// red brush lettering, a striped awning, and roast meats hanging behind the glass. Same units and
// axes as the office. It is scenery only: nobody walks there and it casts no shadow.
function buildStorefront() {
  const group = new THREE.Group();
  const lam = (color, glow = 0.35) => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: glow });
  const lit = (color) => new THREE.MeshBasicMaterial({ color });
  const tex = (file) => { const t = new THREE.TextureLoader().load(file); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const M = {
    wall: lam('#c9c1b0'), wall2: lam('#b3ab9b'), pier: lam('#e9e4d8', 0.5), dark: lam('#3b3f45', 0.2), pane: lam('#5d7586', 0.3),
    back: lit('#f6e3b4'), tile: lit('#e9efe6'), steel: lam('#c9ced3', 0.45), kerb: lam('#9aa0a6', 0.3),
    siu: lam('#a3261a', 0.55), siuDark: lam('#6e160f', 0.45), goose: lam('#a8521a', 0.55), chicken: lam('#e0aa45', 0.55), crackle: lam('#d98a2b', 0.55), pork: lam('#e8c9a6', 0.5),
    lamp: lam('#c8161d', 0.6), bulb: lit('#ffe9a8'), red: lit('#c8161d'), gold: lit('#f4c542'), wood: lam('#7a5234', 0.35),
    glass: new THREE.MeshBasicMaterial({ color: '#dff3f7', transparent: true, opacity: 0.13, depthWrite: false }),
    awning: new THREE.MeshBasicMaterial({ map: canvasTexture(512, 64, (g, w, h) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#fff6e6' : '#f08a1c'; g.fillRect((i * w) / 16, 0, w / 16 + 1, h); } }), side: THREE.DoubleSide }),
    sign: new THREE.MeshBasicMaterial({ map: tex('img/siumei-sign.png?v=20261122e') }),
    menu: new THREE.MeshBasicMaterial({ map: canvasTexture(256, 384, (g, w, h) => {
      g.fillStyle = '#c8161d'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4c542'; g.fillRect(14, 14, w - 28, 44);
      const r = rng(11); g.fillStyle = '#fff3d6';
      for (let i = 0; i < 9; i++) { g.fillRect(22, 84 + i * 32, 90 + r() * 70, 12); g.fillRect(w - 62, 84 + i * 32, 40, 12); }
    }) }),
  };
  const buckets = new Map();
  const unit = new THREE.BoxGeometry(1, 1, 1), ball = new THREE.SphereGeometry(1, 14, 10), cone = new THREE.CylinderGeometry(0.03, 0.13, 0.12, 14), rod = new THREE.CylinderGeometry(1, 1, 1, 8);
  const Q = (rx, ry, rz) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  const put = (geo, mat, x, y, z, sx, sy, sz, q = Q(0, 0, 0)) => {
    const g = geo.toNonIndexed(); g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)));
    let b = buckets.get(mat); if (!b) buckets.set(mat, (b = []));
    b.push(g);
  };
  const box = (w, h, d, mat, x, y, z, q) => put(unit, mat, x, y, z, w, h, d, q);

  const Y0 = 11.3, F = -Y0;            // plan y of the shop front; the lane is about 3 m wide
  const CX = -7.3, WID = 7.0, TOP = 2.3; // middle of the shop, its width, and the height of its opening
  const L = CX - WID / 2, R = CX + WID / 2;
  // The building: the shop's back wall, the floors above, the piers at both ends, the pavement.
  box(WID + 1.4, 7.2, 2.6, M.wall2, CX, 3.6, F - 2.9);
  box(WID + 1.4, 7.2 - TOP, 1.6, M.wall, CX, TOP + (7.2 - TOP) / 2, F - 0.8);
  [L - 0.35, R + 0.35].forEach((x) => box(0.7, TOP, 1.6, M.pier, x, TOP / 2, F - 0.8));
  box(WID, TOP, 0.02, M.back, CX, TOP / 2, F - 1.58);
  box(WID, 0.02, 1.6, M.tile, CX, 0.13, F - 0.8);
  box(WID + 3, 0.12, 1.5, M.kerb, CX, 0.06, F + 0.7);
  for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
    const x = L + 0.9 + i * ((WID - 1.8) / 3), y = 4.35 + row * 1.55;
    box(1.25, 1.05, 0.05, M.pane, x, y, F + 0.02); box(1.35, 0.06, 0.09, M.pier, x, y - 0.55, F + 0.03); box(0.04, 1.05, 0.07, M.pier, x, y, F + 0.03);
    if (row && i % 2) box(0.55, 0.36, 0.32, M.steel, x + 0.3, y - 0.78, F + 0.17);
  }
  // The signboard over the awning, then the awning.
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.03), M.sign); m.position.set(CX, 3.07, F + 0.09); group.add(m); }
  box(6.8, 1.15, 0.08, M.pier, CX, 3.07, F + 0.04);
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(WID + 0.2, 0.95), M.awning); m.position.set(CX, 2.33, F + 0.42); m.rotation.x = -1.22; group.add(m); }
  // Left of the door: the roast meat counter. A steel base, glass above it, a rail with hooks.
  const A = R - 4.1, B = R - 0.15, mid = (A + B) / 2, len = B - A, zc = F - 0.3;
  box(len, 0.95, 0.6, M.steel, mid, 0.6, zc); box(len, 0.05, 0.66, M.pier, mid, 1.1, zc);
  box(len, 0.1, 0.12, M.red, mid, 0.5, zc + 0.31);
  box(len, TOP - 1.12, 0.02, M.glass, mid, 1.12 + (TOP - 1.12) / 2, F - 0.02);
  [A, mid, B].forEach((x) => box(0.05, TOP - 1.12, 0.05, M.steel, x, 1.12 + (TOP - 1.12) / 2, F - 0.02));
  put(rod, M.steel, mid, 2.08, zc, 0.014, len, 0.014, Q(0, 0, Math.PI / 2));
  const hook = (x, drop) => put(rod, M.steel, x, 2.08 - drop / 2, zc, 0.005, drop, 0.005);
  const r = rng(23);
  // Char siu: bunches of long dark red strips, each on its own hook.
  [A + 0.3, A + 0.75, A + 1.2, A + 2.55].forEach((x0, k) => { for (let i = 0; i < 3; i++) { const x = x0 + (i - 1) * 0.105, h = 0.38 + r() * 0.12; hook(x, 0.1); put(ball, (i + k) % 3 ? M.siu : M.siuDark, x, 1.98 - h / 2, zc + (r() - 0.5) * 0.04, 0.045, h / 2, 0.035, Q(0, 0, (r() - 0.5) * 0.12)); } });
  // Roast geese and soy chickens: a body, a neck up to the hook, two legs.
  const bird = (x, mat, big) => { const h = big ? 0.27 : 0.21; hook(x, 0.08); put(rod, mat, x, 1.93, zc, 0.018, 0.16, 0.018); put(ball, mat, x, 1.86 - h, zc, big ? 0.15 : 0.125, h, 0.11); [-1, 1].forEach((sgn) => put(ball, mat, x + sgn * 0.09, 1.86 - h * 1.75, zc, 0.03, 0.07, 0.03)); };
  [A + 1.62, A + 1.98, A + 2.2 + 0.72].forEach((x) => bird(x, M.goose, true));
  [A + 3.3, A + 3.62].forEach((x) => bird(x, M.chicken, false));
  // Crispy pork: a pale slab with a golden top edge, and one more on the counter with cut pieces.
  hook(B - 0.16, 0.1); box(0.2, 0.5, 0.07, M.pork, B - 0.16, 1.73, zc); box(0.21, 0.5, 0.02, M.crackle, B - 0.16, 1.73, zc + 0.045);
  box(0.9, 0.03, 0.4, M.steel, A + 0.75, 1.14, zc); box(0.45, 0.08, 0.2, M.pork, A + 0.6, 1.2, zc); box(0.45, 0.02, 0.2, M.crackle, A + 0.6, 1.25, zc);
  for (let i = 0; i < 5; i++) put(ball, M.siu, A + 0.95 + i * 0.05, 1.19, zc + 0.02, 0.022, 0.03, 0.12);
  put(rod, M.wood, B - 0.75, 1.21, zc, 0.2, 0.16, 0.2);
  // Red heat lamps over the meat, price cards on the glass.
  for (let i = 0; i < 4; i++) { const x = A + 0.55 + i * ((len - 1.1) / 3); put(rod, M.dark, x, 2.24, zc + 0.12, 0.006, 0.12, 0.006); put(cone, M.lamp, x, 2.14, zc + 0.12, 1, 1, 1); put(ball, M.bulb, x, 2.09, zc + 0.12, 0.045, 0.03, 0.045); }
  for (let i = 0; i < 6; i++) box(0.2, 0.13, 0.004, i % 2 ? M.gold : M.red, A + 0.45 + i * 0.62, 1.24, F - 0.005);
  // Right of the counter: the open door, a menu board on the pier, a table and stools inside.
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.75), M.menu); m.position.set(L - 0.35, 1.45, F + 0.012); group.add(m); }
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.75), M.menu); m.position.set(R + 0.35, 1.45, F + 0.012); group.add(m); }
  [[L + 0.9, F - 1.0], [L + 2.1, F - 0.75]].forEach(([x, z]) => {
    put(rod, M.wood, x, 0.86, z, 0.36, 0.03, 0.36); put(rod, M.steel, x, 0.5, z, 0.03, 0.72, 0.03);
    [[-0.5, 0.1], [0.5, -0.1], [0, 0.5]].forEach(([dx, dz]) => { put(rod, M.red, x + dx, 0.58, z + dz, 0.14, 0.04, 0.14); put(rod, M.steel, x + dx, 0.35, z + dz, 0.02, 0.44, 0.02); });
  });
  box(1.5, 0.5, 0.02, M.red, L + 1.5, 1.95, F - 1.56); box(1.3, 0.06, 0.022, M.gold, L + 1.5, 2.02, F - 1.56); box(1.0, 0.05, 0.022, M.gold, L + 1.5, 1.88, F - 1.56);

  for (const [mat, list] of buckets) {
    let n = 0; list.forEach((g) => { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0; list.forEach((g) => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, mat); if (mat === M.glass) m.renderOrder = 2; group.add(m);
  }
  return group;
}

// game: 'poker' puts an oval table in the big meeting room, 'baccarat' puts the table in the small meeting room,
// 'roulette' puts it in Nigel's room.
// metres: how wide the felt is in the room (a blackjack felt is 1.61 m).
// onGo(game): called when the player taps another game's table in the room.
export function initRoom(container, feltEl, { phone, pixel = false, hud = null, size = null, game = 'blackjack', metres = 1.61, onGo = null } = {}) {
  OVAL = game === 'poker';
  // The felt keeps the size and shape its own style sheet gives it, so the 3D table always matches the
  // flat one: the height and the rounded end are read from the page, not fixed here. On a phone the felt
  // is small, close to its size in the flat view, so cards and text stay readable.
  const cssH = parseFloat(getComputedStyle(feltEl).height);
  const W = Math.round(size?.W || (phone ? 400 : 1240));
  const H = Math.round(size?.H || Math.max(W * 0.5, Math.min(W * 1.6, cssH > 50 ? cssH : W * 0.6)));
  feltEl.classList.add('in3d');
  {
    const r = getComputedStyle(feltEl).borderBottomLeftRadius.trim().split(/\s+/), v = r[r.length - 1];
    CURVE = OVAL ? 0.5 : v.endsWith('%') && parseFloat(v) > 5 ? Math.min(1, parseFloat(v) / 100) : 0.34;
  }
  // Real sizes: a seven-seat blackjack table is about 183 cm wide over its padded rail, the rail is about
  // 11 cm wide and the playing surface is about 91 cm off the floor. That fixes how many table units make a metre.
  const S = W / metres;
  const RAIL = 0.11 * S; // how far the padded rail reaches out from the felt
  const U = S / 500; // people, stools and chips were modelled at 500 units to the metre
  const FLOOR = -0.91 * S;
  feltEl.style.width = W + 'px';
  feltEl.style.height = H + 'px';

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(42, 1, 10, 30000);

  const css = new CSS3DRenderer();
  css.domElement.className = 'room-css';
  const gl = new THREE.WebGLRenderer({ antialias: !pixel, alpha: true, powerPreference: 'high-performance' });
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.05;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = phone ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; // the plainer shadow is cheaper on a phone
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.domElement.className = 'room-gl';
  container.append(css.domElement, gl.domElement);

  let dirty = 3; // frames still to draw; the room rests when nothing moves
  const touch = () => { dirty = Math.max(dirty, 2); };

  const bbQ = new THREE.Quaternion(), bbM = new THREE.Matrix4(); let bbLast = '';
  // The HTML felt, lying flat on the table.
  const feltObj = new CSS3DObject(feltEl);
  feltObj.rotation.x = -Math.PI / 2;
  feltObj.position.y = 1;
  scene.add(feltObj);

  const flat = (mesh, y) => { mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; return mesh; };
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const lam = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const add = (mesh, x, y, z, cast, recv) => { mesh.position.set(x, y, z); mesh.castShadow = !!cast; mesh.receiveShadow = !!recv; scene.add(mesh); return mesh; };

  // See-through hole where the HTML felt shows.
  const feltGeo = new THREE.ShapeGeometry(tableShape(W, H, 0), 96);
  // Poker: the cloth is a real green surface in the 3D picture, and the HTML layer (cards, names, pot) is drawn
  // on top of the whole 3D picture, so text and cards float above the rail, the shadows and the chips.
  const TOP = OVAL;
  container.classList.toggle('html-top', TOP);
  let clothMap = null;
  if (TOP) { clothMap = pokerFelt(W, H); clothMap.repeat.set(1 / W, 1 / H); clothMap.offset.set(0.5, 0.5); }
  const hole = flat(new THREE.Mesh(feltGeo, TOP ? new THREE.MeshStandardMaterial({ color: '#ffffff', map: clothMap, roughness: 0.95 })
    : new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending })), 1);
  hole.receiveShadow = TOP;
  scene.add(hole);
  // Shadows and a soft dark edge on top of the felt, so the room's light seems to fall on the HTML too.
  const shade = flat(new THREE.Mesh(feltGeo, new THREE.ShadowMaterial({ opacity: 0.3, depthWrite: false })), 1.3);
  shade.receiveShadow = true; shade.renderOrder = 2;
  if (!TOP) scene.add(shade); // the green cloth takes its own shadows
  const vigTex = canvasTexture(256, 256, vignette);
  vigTex.repeat.set(1 / W, 1 / H); vigTex.offset.set(0.5, 0.5);
  const vig = flat(new THREE.Mesh(feltGeo, new THREE.MeshBasicMaterial({ map: vigTex, transparent: true, depthWrite: false })), 1.6);
  vig.renderOrder = 3;
  scene.add(vig);

  // Padded leather rail around the felt.
  const railShape = tableShape(W, H, RAIL);
  railShape.holes.push(tableShape(W, H, -4));
  const leather = std({ color: 0x3a2116, roughness: 0.42, metalness: 0.0 });
  const rail = flat(new THREE.Mesh(
    new THREE.ExtrudeGeometry(railShape, { depth: 6, bevelEnabled: true, bevelThickness: 14, bevelSize: 14, bevelSegments: 6, curveSegments: 72 }), leather), 0);
  rail.castShadow = true; rail.receiveShadow = true;
  scene.add(rail);
  // Thin brass line where the rail meets the wood.
  const brass = std({ color: 0xd2a850, roughness: 0.28, metalness: 0.85 });
  const trimShape = tableShape(W, H, RAIL + 20);
  trimShape.holes.push(tableShape(W, H, RAIL - 2));
  scene.add(flat(new THREE.Mesh(new THREE.ExtrudeGeometry(trimShape, { depth: 7, bevelEnabled: false, curveSegments: 72 }), brass), -7));
  // Wooden table body.
  const woodTex = canvasTexture(256, 256, woodGrain('#8a5530', '#5a3015', '#b47a48', 3), [1 / 320, 1 / 320]);
  const wood = std({ map: woodTex, color: 0xffffff, roughness: 0.48, metalness: 0.05 });
  const body = flat(new THREE.Mesh(new THREE.ExtrudeGeometry(tableShape(W, H, RAIL + 16), { depth: 84, bevelEnabled: true, bevelThickness: 6, bevelSize: 6, bevelSegments: 2, curveSegments: 72 }), wood), -97);
  body.castShadow = true; body.receiveShadow = true;
  scene.add(body);

  // Pedestal legs.
  const darkWood = std({ color: 0x4a2c18, roughness: 0.55, metalness: 0.05 });
  for (const x of [-W * 0.27, W * 0.27]) {
    add(new THREE.Mesh(new THREE.CylinderGeometry(40 * U, 58 * U, -FLOOR - 97, 10), darkWood), x, (FLOOR - 97) / 2, -H * 0.04, true, false);
    add(new THREE.Mesh(new THREE.CylinderGeometry(120 * U, 150 * U, 22, 12), darkWood), x, FLOOR + 11, -H * 0.04, true, true);
    add(new THREE.Mesh(new THREE.TorusGeometry(47 * U, 5, 6, 16), brass), x, FLOOR + 120 * U, -H * 0.04).rotation.x = Math.PI / 2;
  }

  // The office around the table, with its own light: a bright sky light, one sun that casts the
  // soft shadows, and a cool fill from the other side.
  // Where the table stands in the office plan. The players' stools stay just clear of the sofa behind
  // them; a deeper table (a phone's tall felt) reaches further toward the desks, which move away from it.
  const halfDepth = (H / 2 + RAIL) / S;
  const inRoom = game === 'poker' ? 'bigBoard' : game === 'baccarat' ? 'smallBoard' : game === 'roulette' ? 'securities' : null;
  if (game === 'poker') { OFFICE_AT.x = 0.69; OFFICE_AT.y = 2.45; }
  else if (game === 'baccarat') { OFFICE_AT.x = 12.95; OFFICE_AT.y = 2.06; }
  else if (game === 'roulette') { OFFICE_AT.x = 13.1; OFFICE_AT.y = 5.75; } // Nigel's room, where its round table stood
  else { OFFICE_AT.x = 3.11 + 0.45 + halfDepth; OFFICE_AT.y = 4.2; }
  const dealerEnd = OFFICE_AT.x + halfDepth + 0.42;
  // In the other games the blackjack table still stands in the open office, so the middle desks leave room for it.
  const midShift = inRoom ? 0.6 : Math.max(0, dealerEnd - 4.276), midScale = inRoom ? 1 : Math.min(1, (11.05 - 4.276 - midShift) / 5.5875);
  const office = buildOffice(OFFICE_SIGN, midShift, midScale, inRoom, game);
  office.scale.setScalar(S);
  { const sm = office.userData.snowMat?.(); if (sm) sm.size = 0.026 * S; }
  // Turned a quarter: plan x runs away from the players (toward the dealer and the desks), plan y to their right.
  office.rotation.y = -Math.PI / 2;
  office.position.set(-OFFICE_AT.y * S, FLOOR, OFFICE_AT.x * S);
  scene.add(office);
  const shop = buildStorefront(); // added on its own, so the walking limits stay those of the office
  shop.scale.copy(office.scale); shop.position.copy(office.position); shop.rotation.copy(office.rotation);
  scene.add(shop);
  scene.background = new THREE.Color(0xd5dade);
  scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x3a4048, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3.2 * S, FLOOR + 14 * S, -11.9 * S);
  sun.target.position.set(0, FLOOR, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  { const c = sun.shadow.camera; c.left = -9.5 * S; c.right = 9.5 * S; c.top = 7 * S; c.bottom = -7 * S; c.near = 4 * S; c.far = 32 * S; }
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.012 * S;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xcfe3ff, 0.35);
  fill.position.set(-2.8 * S, FLOOR + 8 * S, 14.1 * S);
  scene.add(fill);

  // ---------- People ----------
  const people = new THREE.Group();
  scene.add(people);
  const trousers = lam({ color: 0x30353c, flatShading: true });
  const stoolLeather = lam({ color: 0x8c1d24, flatShading: true });
  const geoCache = {};
  const cyl = (rt, rb, seg) => (geoCache[`c${rt},${rb},${seg}`] ||= new THREE.CylinderGeometry(rt, rb, 1, seg));
  // A straight limb from a to b.
  const limb = (a, b, rt, rb, mat) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const m = new THREE.Mesh(cyl(rt, rb, 6), mat);
    m.scale.y = va.distanceTo(vb);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    m.castShadow = true;
    return m;
  };
  const headGeo = new THREE.IcosahedronGeometry(56, 1);
  const hairGeo = new THREE.SphereGeometry(61, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const handGeo = new THREE.IcosahedronGeometry(21, 0);
  const torsoGeo = new THREE.CylinderGeometry(84, 66, 230, 8);
  const shoulderGeo = new THREE.IcosahedronGeometry(30, 0);

  // Where a seat is, from its place on the felt (percent from the left and from the dealer's end):
  // the nearest point on the table edge and the direction pointing away from the table there.
  function edgeAt(xPct, yPct) {
    const px = (xPct / 100 - 0.5) * W, pz = (yPct / 100 - 0.5) * H;
    if (OVAL) { // the nearest point of the oval's edge
      const r = Math.min(W, H) / 2, wide = W >= H, L = Math.abs(W - H) / 2;
      const a = wide ? px : pz, b = wide ? pz : px; // a runs along the table, b across it
      let ea, eb, na, nb;
      if (Math.abs(a) <= L) { ea = a; eb = (b < 0 ? -1 : 1) * r; na = 0; nb = b < 0 ? -1 : 1; }
      else { const c = (a < 0 ? -1 : 1) * L, d = Math.hypot(a - c, b) || 1; na = (a - c) / d; nb = b / d; ea = c + na * r; eb = nb * r; }
      return wide ? { x: ea, z: eb, nx: na, nz: nb } : { x: eb, z: ea, nx: nb, nz: na };
    }
    const cz = H / 2 - CURVE * H, rx = W / 2, ry = CURVE * H;
    if (pz <= cz) { const s = px < 0 ? -1 : 1; return { x: s * rx, z: pz, nx: s, nz: 0 }; }
    const k = 1 / Math.max(0.001, Math.hypot(px / rx, (pz - cz) / ry));
    const bx = px * k, bz = cz + (pz - cz) * k;
    const nx = bx / (rx * rx), nz = (bz - cz) / (ry * ry), nl = Math.hypot(nx, nz) || 1;
    return { x: bx, z: bz, nx: nx / nl, nz: nz / nl };
  }
  // With no place given, seats are spread evenly along the curved edge.
  function edgeForSeat(i, n) {
    const a = (((n - 1 - i) + 0.5) / n - 0.5) * 2.5;
    return edgeAt(50 + Math.sin(a) * 50, (0.5 + (0.5 - CURVE) + CURVE * Math.cos(a)) * 100 - 0.01);
  }
  function makeStool(scale) {
    const g = new THREE.Group();
    const top = -168 * scale, hgt = top - FLOOR;
    const seat = new THREE.Mesh(cyl(1, 0.9, 10), stoolLeather); seat.scale.set(74 * scale, 24, 74 * scale); seat.position.y = top - 12; seat.castShadow = true;
    const post = new THREE.Mesh(cyl(1, 1, 6), brass); post.scale.set(9, hgt - 24, 9); post.position.y = top - 24 - (hgt - 24) / 2; post.castShadow = true;
    const base = new THREE.Mesh(cyl(0.85, 1, 10), brass); base.scale.set(66 * scale, 12, 66 * scale); base.position.y = FLOOR + 6;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(48 * scale, 5, 5, 12), brass); ring.rotation.x = Math.PI / 2; ring.position.y = FLOOR + hgt * 0.42;
    g.add(seat, post, base, ring);
    return g;
  }
  function makeLabel(text) {
    const tex = canvasTexture(512, 128, (g, w, h) => {
      g.font = `600 58px ${FONT}, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`;
      const tw = Math.min(w - 56, g.measureText(text).width);
      const bw = tw + 56, x0 = (w - bw) / 2;
      g.fillStyle = 'rgba(10,12,16,.82)'; g.strokeStyle = 'rgba(232,196,106,.85)'; g.lineWidth = 4;
      g.beginPath(); g.roundRect(x0, 18, bw, h - 36, 40); g.fill(); g.stroke();
      g.fillStyle = '#fff6dc'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 3, w - 56);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(190 / U, 47.5 / U, 1); // the same modest size at any table scale
    sp.renderOrder = 5;
    return sp;
  }
  // One person. Everyone has the same friendly body; only skin, hair and shirt colour differ.
  // The figure's own space: table top at y = 0, the table straight ahead along +z.
  function makeFigure(p, standing, reach = 128) {
    const look = p.look || {};
    const skin = lam({ color: SKIN[look.skin ?? 2] || SKIN[2], flatShading: true });
    const hair = lam({ color: HAIR[look.hair ?? 0] || HAIR[0], flatShading: true });
    const shirt = lam({ color: new THREE.Color().setHSL(hashHue(String(p.id).split('#')[0]) / 360, 0.5, 0.42), flatShading: true });
    const g = new THREE.Group();
    const up = standing ? 34 : 0; // a standing person is a little taller than a seated one
    const torso = new THREE.Mesh(torsoGeo, shirt); torso.scale.z = 0.58; torso.position.y = -22 + up; torso.castShadow = true;
    const neck = limb([0, 88 + up, 0], [0, 124 + up, 0], 24, 26, skin);
    const head = new THREE.Mesh(headGeo, skin); head.position.set(0, 168 + up, 4); head.scale.set(0.95, 1.06, 1); head.castShadow = true;
    const cap = new THREE.Mesh(hairGeo, hair); cap.position.set(0, 174 + up, -4); cap.rotation.x = -0.42; cap.scale.set(0.97, 1.02, 1.04);
    g.add(torso, neck, head, cap);
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = [s * 92, 66 + up, 0], el = [s * 112, 4 + up * 0.4, 52], ha = [s * 82, 44, reach];
      const arm = new THREE.Group();
      arm.position.set(...sh);
      const rel = (v) => [v[0] - sh[0], v[1] - sh[1], v[2] - sh[2]];
      const ball = new THREE.Mesh(shoulderGeo, shirt); ball.castShadow = true;
      const hand = new THREE.Mesh(handGeo, skin); hand.position.set(...rel(ha)); hand.scale.set(1, 0.7, 1.2); hand.castShadow = true;
      arm.add(ball, limb([0, 0, 0], rel(el), 27, 23, shirt), limb(rel(el), rel(ha), 21, 17, skin), hand);
      g.add(arm);
      arms.push(arm);
    }
    if (standing) {
      for (const s of [-1, 1]) {
        g.add(limb([s * 36, -120 + up, 0], [s * 40, (FLOOR + 30) / U, 0], 34, 26, trousers));
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(56, 30, 110), trousers); shoe.position.set(s * 40, (FLOOR + 15) / U, 18); g.add(shoe);
      }
    } else {
      for (const s of [-1, 1]) {
        g.add(limb([s * 38, -140, 0], [s * 44, -146, 118], 36, 30, trousers));
        g.add(limb([s * 44, -146, 118], [s * 44, -330, 96], 28, 22, trousers));
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(50, 28, 96), trousers); shoe.position.set(s * 44, -342, 118); g.add(shoe);
      }
    }
    const label = makeLabel(((look.flag ? look.flag + ' ' : '') + (p.name || 'Player')).slice(0, 22));
    label.position.y = 290 + up;
    g.add(label);
    g.userData = { arms, label, reach: 0, headParts: [head, cap, label] };
    return g;
  }
  function disposeTree(o) {
    o.traverse((c) => { if (c.isSprite) { c.material.map?.dispose(); c.material.dispose(); } else if (c.geometry?.type === 'TorusGeometry') c.geometry.dispose(); else if (c.material && c.material !== trousers && c.material !== stoolLeather && c.material !== brass) c.material.dispose?.(); });
  }

  // People playing at the other tables of the office: map of game -> [{ id, name, look, seat, seats }].
  const otherGroup = new THREE.Group(); scene.add(otherGroup);
  let otherKey = '';
  function setOthers(map = {}) {
    const key = JSON.stringify(map);
    if (key === otherKey) return;
    otherKey = key;
    disposeTree(otherGroup); otherGroup.clear();
    const yTop = FLOOR + 0.749 * S; // those tables are office height, a little lower than the live one
    const w = (ox, oy) => office.localToWorld(new THREE.Vector3(-ox, 0, -oy));
    for (const [g, list] of Object.entries(map)) {
      const T = OTHER_TABLES[g];
      if (g === game || !T || !Array.isArray(list)) continue;
      for (const p of list) {
        const n = p.seats || 9;
        let ox, oy;
        if (g === 'blackjack') { const t = ((p.seat + 0.5) / n - 0.5) * 2.7; ox = T.x - (T.r + 0.34) * Math.cos(t); oy = T.y + (T.r + 0.34) * Math.sin(t); }
        else { const a = ((p.seat + 0.5) / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), k = 1 / Math.max(Math.abs(c) / (T.w / 2 + 0.36), Math.abs(sn) / (T.d / 2 + 0.36)); ox = T.x + c * k; oy = T.y + sn * k; } // on the rim of the table's rectangle
        const c = w(T.x, T.y), s = w(ox, oy), nx = s.x - c.x, nz = s.z - c.z;
        const f = makeFigure(p, false, 96);
        f.scale.setScalar(U * 0.86); f.position.set(s.x, yTop, s.z); f.rotation.y = Math.atan2(-nx, -nz);
        otherGroup.add(f);
      }
    }
    // A name tag over each of the other tables, with how many people play there. A tap on it takes you to that table.
    for (const g of Object.keys(OTHER_TABLES)) {
      if (g === game) continue;
      const T = OTHER_TABLES[g], n = Array.isArray(map[g]) ? map[g].length : 0, c = w(T.x - (g === 'blackjack' ? 0.3 : 0), T.y);
      const sp = makeLabel(`${TABLE_NAMES[g]}${n ? ' · ' + n + ' playing' : ''}`);
      sp.material.sizeAttenuation = false; sp.scale.set(0.2, 0.05, 1); // the same size on the screen however far the table is
      sp.position.set(c.x, yTop + 0.95 * S, c.z);
      sp.userData.go = g;
      otherGroup.add(sp);
    }
    touch();
  }
  setTimeout(() => setOthers({ boot: 1 }), 0); // the name tags show even before anyone is found at those tables
  // A tap on another table (or its name tag) goes there. Taps on the live felt and on buttons never count.
  container.addEventListener('click', (e) => {
    if (!onGo || container.classList.contains('was-drag') || feltEl.contains(e.target) || e.target.closest('button, a, input, select, textarea, label, [data-act]')) return;
    const r = container.getBoundingClientRect(), yTop = FLOOR + 0.749 * S;
    let best = null, bd = 1e9;
    for (const sp of otherGroup.children) {
      if (!sp.userData.go) continue;
      for (const dy of [0, -0.95 * S]) { // the tag itself and the table under it
        tmp.set(sp.position.x, sp.position.y + dy, sp.position.z).project(camera);
        if (tmp.z > 1 || tmp.z < -1) continue;
        const d = Math.hypot((tmp.x * 0.5 + 0.5) * r.width - (e.clientX - r.left), (-tmp.y * 0.5 + 0.5) * r.height - (e.clientY - r.top));
        if (d < bd) { bd = d; best = sp.userData.go; }
      }
    }
    if (best && bd < Math.max(46, r.height * 0.07)) onGo(best);
  });

  let peopleRev = 0, flipped = false; // flipped: the felt is laid out for the dealer and turned to face them
  let peopleKey = '', figs = new Map(), stoolGroup = null, myFig = null, myStool = null, sidePts = [], seatEdge = new Map();
  let lastPeople = null, lastChips = null;
  let brawl = null; // { from, to, t0, ms, ... }: see punch()
  let others = [];
  function setPeople(list = [], stools = null) {
    lastPeople = [list, stools];
    const n = list[0]?.seats || stools?.length || 0;
    const spotsOf = stools || Array.from({ length: n }, (_, i) => ({ seat: i }));
    const key = JSON.stringify([flipped, list.map((p) => [p.id, p.seat, p.look?.skin, p.look?.hair, p.look?.flag, p.name, !!p.isMe, !!p.isDealer, p.x, p.y]), spotsOf.map((s) => [s.seat, s.x, s.y])]);
    if (key !== peopleKey) {
      peopleKey = key; peopleRev++;
      const oldBets = new Map([...figs].map(([id, f]) => [id, f.userData.bet]));
      disposeTree(people); people.clear(); figs = new Map(); myFig = null; myStool = null; sidePts = []; seatEdge = new Map();
      // For the dealer the felt is turned half way round, so places on it are mirrored both ways.
      const place = (s) => (s.x !== undefined && s.y !== undefined ? (flipped ? edgeAt(100 - s.x, 100 - s.y) : edgeAt(s.x, s.y)) : edgeForSeat(s.seat, n));
      const pts = spotsOf.map(place);
      // When the seats are close together everyone is drawn a little smaller.
      let gap = Infinity;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) gap = Math.min(gap, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
      const sc = U * Math.max(0.78, Math.min(1, gap / (190 * U)));
      const out = RAIL + 92 * sc;
      const mine = list.find((p) => p.isMe && !p.isDealer);
      stoolGroup = new THREE.Group();
      spotsOf.forEach((s, i) => {
        const e = pts[i], st = makeStool(sc);
        seatEdge.set(s.seat, { e, sc });
        st.position.set(e.x + e.nx * out, 0, e.z + e.nz * out);
        stoolGroup.add(st);
        if (mine && mine.seat === s.seat) myStool = st;
        sidePts.push({ x: st.position.x, z: st.position.z, seat: s.seat, taken: list.some((p) => p.seat === s.seat && !p.isDealer) });
      });
      people.add(stoolGroup);
      for (const p of list) {
        let e, standing = false;
        if (p.isDealer) { e = { x: 0, z: -H / 2, nx: 0, nz: -1 }; standing = true; }
        else if (p.seat === null || p.seat === undefined) continue;
        else { const i = spotsOf.findIndex((s) => s.seat === p.seat); if (i < 0) continue; e = pts[i]; }
        const fs = standing ? U : sc;
        const f = makeFigure(p, standing, Math.min(150, (92 * fs + RAIL * 0.55) / fs + (standing ? 8 : 0)));
        f.scale.setScalar(fs);
        const d = standing ? RAIL + 100 * fs : out;
        f.position.set(e.x + e.nx * d, 0, e.z + e.nz * d);
        f.rotation.y = Math.atan2(-e.nx, -e.nz);
        f.userData.bet = oldBets.has(p.id) ? oldBets.get(p.id) : (p.bet || 0);
        people.add(f);
        figs.set(p.id, f);
        f.userData.isDealer = !!p.isDealer;
        f.userData.armY = f.userData.arms[1].position.y;
        if (p.isMe) myFig = f;
      }
      // Everyone but you. From your own chair the nearest of them fill the bottom corners of the screen,
      // so each one is hidden while it would be drawn down there (see the loop below).
      others = myFig ? [...figs.values()].filter((f) => f !== myFig) : [];
      touch();
    }
    // A short reach towards the betting circle when someone's bet changes.
    for (const p of list) {
      const f = figs.get(p.id);
      if (!f || p.bet === undefined) continue;
      if (f.userData.bet !== p.bet) { f.userData.bet = p.bet; f.userData.reach = 1; touch(); }
    }
  }

  // ---------- Chips ----------
  const chipGroup = new THREE.Group();
  scene.add(chipGroup);
  const chipGeo = new THREE.CylinderGeometry(1, 1, 1, 18);
  let chipMat = {}, rackMat = {}, myRack = null, racks = [];
  const rackGeo = {};
  const matsFor = (v) => (chipMat[v] ||= (() => {
    const top = std({ map: canvasTexture(128, 128, chipTop(v)), roughness: 0.55 });
    return [std({ map: canvasTexture(128, 16, chipEdge(v, false)), roughness: 0.55 }), top, top];
  })());
  // A whole pile in the rack is one tall cylinder whose edge picture repeats once per chip.
  const rackMatsFor = (v) => (rackMat[v] ||= [std({ map: canvasTexture(128, 16, chipEdge(v, true), [1, 1]), roughness: 0.55 }), matsFor(v)[1], matsFor(v)[1]]);
  const rackGeoFor = (n) => (rackGeo[n] ||= (() => {
    const g = chipGeo.clone(), uv = g.attributes.uv;
    for (let i = 0; i < 19 * 2; i++) uv.setY(i, uv.getY(i) * n); // the side comes first in a cylinder
    return g;
  })());
  // Where things on the felt are, in table units: measured from the page with the 3D turned off for a moment.
  function feltPoints(els) {
    const camEl = feltEl.parentElement && feltEl.parentElement !== container ? feltEl.parentElement : null;
    const t1 = camEl ? camEl.style.transform : '', t2 = feltEl.style.transform;
    if (camEl) camEl.style.transform = 'none';
    feltEl.style.transform = 'none';
    const f = feltEl.getBoundingClientRect();
    const out = els.map((el) => { if (!el) return null; const b = el.getBoundingClientRect(); const k = flipped ? -1 : 1; return { x: k * (b.left + b.width / 2 - f.left - W / 2), z: k * (b.top + b.height / 2 - f.top - H / 2), w: b.width }; });
    if (camEl) camEl.style.transform = t1;
    feltEl.style.transform = t2;
    return out;
  }
  let chipKey = '';
  // Turn a chip so the number on it reads the right way up from where you are.
  const faceYaw = () => CHIP_UP + (flipped ? Math.PI : 0);
  // list: one entry per taken seat: { seat, main (the bet), balance (chips not bet) }.
  function setChips(list = []) {
    lastChips = list;
    const key = peopleRev + '|' + JSON.stringify(list.map((c) => [c.seat, c.main, c.balance, c.sides, c.mine])) + '|' + feltEl.clientWidth;
    if (key === chipKey) return;
    chipKey = key;
    chipGroup.clear();
    myRack = new THREE.Group();
    racks = [];
    chipGroup.add(myRack);
    const spots = feltPoints(list.map((c) => (c.main ? feltEl.querySelector('#spot-' + c.seat) : null)));
    // Side bets and bets between players: a small pile on the outer edge of each one's place on the felt.
    const sideList = list.flatMap((c, idx) => (c.main && c.sides ? c.sides.map(([sel, amt]) => ({ idx, sel, amt })) : []));
    const sideAt = feltPoints(sideList.map((x) => feltEl.querySelector(x.sel)));
    sideList.forEach((x, n) => {
      const at = sideAt[n], main = spots[x.idx];
      if (!at || !main || !x.amt) return;
      const R = Math.max(3.5, Math.min(11, main.w * 0.125)), T = R * 0.19;
      let dx = at.x - main.x, dz = at.z - main.z;
      const d = Math.hypot(dx, dz) || 1;
      const push = d < main.w * 1.2 ? main.w * 0.2 : 0; // a slice of the ring: out towards its rim, clear of the amount written on it
      const px = at.x + (dx / d) * push, pz = at.z + (dz / d) * push;
      chipsFor(x.amt, 5).forEach((v, i) => {
        const m = new THREE.Mesh(chipGeo, matsFor(v));
        m.scale.set(R, T, R);
        m.position.set(px, 1.6 + T / 2 + i * T, pz);
        m.rotation.y = faceYaw() + (i % 3 - 1) * 0.12;
        m.castShadow = true;
        chipGroup.add(m);
      });
    });
    list.forEach((c, idx) => {
      const at = spots[idx];
      if (at && c.main) {
        const R = Math.max(5, Math.min(26, at.w * 0.29)), T = R * 0.19; // chips sized to their betting circle
        const rnd = rng(c.seat * 977 + 13);
        const chips = chipsFor(c.main, 24), per = 8, cols = Math.ceil(chips.length / per);
        const colAt = cols === 1 ? [[0, 0]] : cols === 2 ? [[-R * 1.02, 0], [R * 1.02, 0]] : [[-R * 1.02, R * 0.6], [R * 1.02, R * 0.6], [0, -R * 1.17]];
        chips.forEach((v, i) => {
          const col = Math.floor(i / per), lvl = i % per;
          const m = new THREE.Mesh(chipGeo, matsFor(v));
          m.scale.set(R, T, R);
          m.position.set(at.x + colAt[col][0] + (rnd() - 0.5) * 2.4, 1.6 + T / 2 + lvl * T, at.z + colAt[col][1] + (rnd() - 0.5) * 2.4);
          m.rotation.y = faceYaw() + (rnd() - 0.5) * 0.3;
          m.castShadow = true; m.receiveShadow = true;
          chipGroup.add(m);
        });
      }
      // The rack: one pile for each kind of chip, on the rail in front of the player.
      const se = seatEdge.get(c.seat);
      if (se && c.balance > 0) {
        const { e, sc } = se, r = 13 * sc, t = 4.6 * sc;
        // A real player's stack: most of the money in the big chips, the rest broken into smaller chips,
        // so the piles grow with the balance. A pile taller than 20 chips starts a second pile behind it.
        const piles = DENOMS.map((v) => [v, 0]);
        let left = Math.round(c.balance);
        piles.forEach((pile, k) => { const last = k === piles.length - 1; pile[1] = Math.floor((last ? left : left * 0.7) / pile[0]); left -= pile[1] * pile[0]; });
        const shown = piles.filter((x) => x[1] > 0).flatMap(([v, n]) => { const out = []; for (let row = 0; n > 0 && row < 3; row++, n -= 20) out.push([v, Math.min(20, n), row]); return out; });
        const kinds = [...new Set(shown.map((x) => x[0]))];
        const pile = new THREE.Group();
        if (!c.mine) { racks.push(pile); chipGroup.add(pile); }
        shown.forEach(([v, n, row], i) => {
          const cnt = n, along = (kinds.indexOf(v) - (kinds.length - 1) / 2) * r * 2.12, back = RAIL * 0.5 + row * r * 2.1;
          const m = new THREE.Mesh(rackGeoFor(cnt), rackMatsFor(v));
          m.scale.set(r, t * cnt, r);
          // Along the rail: the direction at right angles to "away from the table".
          m.position.set(e.x + e.nx * back - e.nz * along, 20.5 + (t * cnt) / 2, e.z + e.nz * back + e.nx * along);
          m.rotation.y = faceYaw();
          m.castShadow = true;
          (c.mine ? myRack : pile).add(m);
        });
      }
    });
    touch();
  }

  // ---------- Camera ----------
  const CENTRE = new THREE.Vector3(0, -10, 0);
  const cur = { theta: 0, phi: 0.9, r: 1400, yaw: 0, pitch: 0, t: CENTRE.clone() };
  const goal = { theta: 0, phi: 0.9, r: 1400, yaw: 0, pitch: 0, t: CENTRE.clone() };
  let firstPerson = false; try { firstPerson = OVAL && localStorage.getItem('pk-pov') === '1'; } catch { /* no storage */ }
  let side = 'player', seated = true, rate = 14, homeFit = null, hudReserve = 0;
  const PHI_MAX = 1.36, YAW_MAX = 2.25;
  const EYE = 340 * U; // lowest the camera goes when walking around: standing eye height, above the table top
  // The open floor of the office, inside the glass walls, the cupboard and the cabinets. The camera stays in it.
  const BOUND = { x0: (0.381 + 0.3 - OFFICE_AT.y) * S, x1: (6.7455 - 0.3 - OFFICE_AT.y) * S, z0: (OFFICE_AT.x - 11.419 + 0.35) * S, z1: (OFFICE_AT.x - 2.526 - 0.12) * S };
  // Walking around: the whole office, every room, straight through the glass walls and doors.
  // The limits are the outer walls of the office: nobody walks out to the street.
  const ALL = (() => { const m = 0.35; return { x0: (m - OFFICE_AT.y) * S, x1: (OFFICE.depth - m - OFFICE_AT.y) * S, z0: (OFFICE_AT.x - OFFICE.width + m) * S, z1: (OFFICE_AT.x - OFFICE.bump.x - m) * S }; })();
  let walking = false;
  // The tour on joining: one fast walk round the whole office that ends in your own chair.
  let tour = null, tourW = 1;
  const OFFC = new THREE.Vector3((ALL.x0 + ALL.x1) / 2, 150 * U, (ALL.z0 + ALL.z1) / 2);
  const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  // The office is not a plain rectangle: beside the big board room, past the wall, is outdoors. Keep out of that corner too.
  const CORNER = { x: (OFFICE.bump.d - 0.35 - OFFICE_AT.y) * S, z: (OFFICE_AT.x - 0.35) * S };
  const keepIn = (p) => {
    p.x = Math.max(ALL.x0, Math.min(ALL.x1, p.x)); p.z = Math.max(ALL.z0, Math.min(ALL.z1, p.z));
    if (p.x > CORNER.x && p.z > CORNER.z) { if (p.x - CORNER.x < p.z - CORNER.z) p.x = CORNER.x; else p.z = CORNER.z; }
  };
  const outline = tableShape(W, H, RAIL + 26).getPoints(10).map((p) => new THREE.Vector3(p.x, 24, -p.y));
  // Your own cards must clear the buttons at the bottom; the padded rail in front of them may slip behind.
  const nearEdge = tableShape(W, H, RAIL * 0.42).getPoints(10).map((p) => new THREE.Vector3(p.x, 1, -p.y));
  const probe = new THREE.PerspectiveCamera();
  const tmp = new THREE.Vector3();

  function posFor(s, out) {
    const sp = Math.sin(s.phi);
    return out.set(s.t.x + s.r * sp * Math.sin(s.theta), s.t.y + s.r * Math.cos(s.phi), s.t.z + s.r * sp * Math.cos(s.theta));
  }
  // The first-person seat view: as close as the screen allows with the whole table in sight, the dealer
  // at the top and your own cards just above the buttons at the bottom of the screen.
  function fitHome(leanR) {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    const sgn = side === 'dealer' ? -1 : 1;
    const bottom = -1 + (2 * Math.min(hudReserve, h * 0.42) + 8) / h; // lowest the table may reach, in screen units (-1 bottom, 1 top)
    // An upright phone: the table is as wide as the screen. Its padded rail may run off both sides, the felt may not.
    const tall = w < 600 && h > w * 1.2;
    const topMax = 1 - 2 * (w < 600 ? (tall ? 86 : 118) : Math.min(34, h * 0.05)) / h, sideMax = tall ? 1.15 : 1 - (w < 600 ? 10 : 16) / w;
    probe.fov = camera.fov; probe.aspect = w / h; probe.near = 10; probe.far = 12000; probe.updateProjectionMatrix();
    const box = (phi, r, tz) => {
      probe.position.set(0, r * Math.cos(phi), sgn * (tz + r * Math.sin(phi)));
      probe.lookAt(0, 0, sgn * tz);
      probe.updateMatrixWorld();
      let lo = Infinity, hi = -Infinity, sd = 0;
      for (const p of outline) { if (tmp.copy(p).applyMatrix4(probe.matrixWorldInverse).z > -20) { sd = Infinity; continue; } tmp.copy(p).project(probe); hi = Math.max(hi, tmp.y); sd = Math.max(sd, Math.abs(tmp.x)); } // a point behind the eye is out of sight
      for (const p of nearEdge) { if (tmp.copy(p).applyMatrix4(probe.matrixWorldInverse).z > -20) { lo = -Infinity; continue; } tmp.copy(p).project(probe); lo = Math.min(lo, tmp.y); }
      return { lo, hi, sd };
    };
    // How far towards the player the camera must aim so the near rail sits just above the buttons.
    const align = (phi, r) => {
      let a = -H * 1.5, b = H * 1.5;
      for (let j = 0; j < 14; j++) { const m = (a + b) / 2; if (box(phi, r, m).lo < bottom) a = m; else b = m; }
      return b;
    };
    // Poker: the view of a player in the chair, low over the near rail and looking across the table, not from above.
    // The far side and both ends of the table must be in sight; the rail right under your chin may be out of it.
    const pov = OVAL && !tall; // an upright phone keeps the higher view, so the far seats stay readable
    if (pov && firstPerson) {
      // True first person: the eye is where your head is in the chair, a little above the table, looking across it.
      const eyeY = 0.5 * S, eyeZ = H / 2 + 0.34 * S, tz = -H * 0.05, dz = eyeZ - tz;
      return { phi: Math.atan2(dz, eyeY), r: Math.hypot(dz, eyeY), tz };
    }
    if (pov) {
      const tz = H * (tall ? 0.1 : 0.16);
      if (leanR) return { phi: homeFit.phi, r: leanR, tz };
      const farPts = outline.filter((p) => sgn * p.z < H * (tall ? 0.36 : 0.22));
      const fits = (phi, r) => {
        probe.position.set(0, r * Math.cos(phi), sgn * (tz + r * Math.sin(phi))); probe.lookAt(0, 0, sgn * tz); probe.updateMatrixWorld();
        for (const p of farPts) {
          if (tmp.copy(p).applyMatrix4(probe.matrixWorldInverse).z > -20) return false;
          tmp.copy(p).project(probe);
          if (Math.abs(tmp.x) > sideMax || tmp.y > topMax) return false;
        }
        return true;
      };
      // The lowest view from which the table fits with the eye still inside the room: the wall is close behind the chair.
      const wall = (sgn > 0 ? ALL.z1 : -ALL.z0) - 30;
      let best = null;
      for (let phi = tall ? 0.8 : 1.02; phi >= 0.4; phi -= 0.04) {
        let rLo = 200, rHi = 9000;
        for (let i = 0; i < 18; i++) { const r = (rLo + rHi) / 2; if (fits(phi, r)) rHi = r; else rLo = r; }
        best = { phi, r: rHi, tz };
        if (tz + rHi * Math.sin(phi) <= wall) break;
      }
      return best;
    }
    if (leanR) return { phi: homeFit.phi, r: leanR, tz: align(homeFit.phi, leanR) };
    let best = null;
    // Start low, like sitting at the table, and look from higher only when the screen is tall and narrow.
    // An upright phone looks from higher up, so the far seats stay large enough to read.
    // The dealer on an upright phone looks almost straight down: the wide dealer edge is nearest, so a slanted
    // view would shrink the players' seats at the far end to nothing.
    const over = tall && side === 'dealer';
    for (let phi = over ? 0.12 : tall ? 0.5 : 0.64; phi >= (over ? 0.1 : tall ? 0.26 : 0.34); phi -= 0.06) {
      let rLo = 300, rHi = 9000, tzAt = 0;
      for (let i = 0; i < 16; i++) {
        const r = (rLo + rHi) / 2;
        const b = align(phi, r);
        const bx = box(phi, r, b);
        if (bx.hi <= topMax && bx.sd <= sideMax) { rHi = r; tzAt = b; } else rLo = r;
      }
      const bx = box(phi, rHi, tzAt);
      best = { phi, r: rHi, tz: tzAt };
      if ((bx.hi - bx.lo) >= (topMax - bottom) * 0.8) break; // the table fills the height well enough
    }
    return best;
  }
  function seatGoal(animate) {
    homeFit = fitHome();
    const base = side === 'dealer' ? Math.PI : 0;
    goal.theta = base + Math.PI * 2 * Math.round((cur.theta - base) / (Math.PI * 2));
    goal.phi = homeFit.phi; goal.r = homeFit.r;
    goal.t.set(0, 0, (side === 'dealer' ? -1 : 1) * homeFit.tz);
    // A phone held sideways is too short to show the whole table with cards you can read, so you
    // lean in over your own cards and the dealer's. The look buttons and a pinch show the rest.
    if (container.clientHeight < 440 && container.clientWidth > container.clientHeight) {
      goal.r = homeFit.r * 0.74;
      goal.t.z = (side === 'dealer' ? -1 : 1) * fitHome(goal.r).tz;
    }
    if (!animate) { cur.theta = goal.theta; cur.phi = goal.phi; cur.r = goal.r; cur.yaw = goal.yaw; cur.pitch = goal.pitch; cur.t.copy(goal.t); }
    touch();
  }
  function home(animate) {
    walking = false; container.classList.remove('walking');
    seated = true; goal.yaw = 0; goal.pitch = 0; rate = 4.5;
    seatGoal(animate);
    container.classList.add('seated');
  }
  function standUp() {
    if (!seated) return;
    seated = false; goal.yaw = 0; goal.pitch = 0; goal.t.copy(CENTRE);
    goal.r = Math.max(goal.r, homeFit.r * 1.12);
    container.classList.remove('seated');
  }
  const rMin = () => homeFit.r * (walking ? 0.3 : 0.45);
  const rMax = () => Math.max(homeFit.r * 1.6, 5.4 * S);
  function clampGoal() {
    if (seated) {
      goal.r = Math.min(homeFit.r, Math.max(homeFit.r * 0.55, goal.r));
      goal.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, goal.yaw));
      goal.pitch = Math.max(-0.62, Math.min(0.85, goal.pitch));
    } else {
      goal.r = Math.min(rMax(), Math.max(rMin(), goal.r));
      // Walking around, your eyes stay at standing height or above: never down at the table top, and clear of people's heads.
      goal.phi = Math.max(0.2, Math.min(PHI_MAX, Math.acos(Math.min(1, EYE / goal.r)), goal.phi));
    }
  }
  function zoom(f) {
    rate = 12;
    if (seated && f > 1 && goal.r * f > homeFit.r * 1.01) standUp();
    goal.r *= f;
    clampGoal();
    // Leaning in keeps your own cards in sight, just above the buttons.
    if (seated) goal.t.z = (side === 'dealer' ? -1 : 1) * fitHome(goal.r).tz;
    touch();
  }
  // Turn the head towards the neighbours on one side: dir +1 is left, -1 is right.
  function look(dir) {
    if (!seated) home(true);
    rate = 4.5;
    const s = side === 'dealer' ? -1 : 1;
    const eye = posFor(goal, new THREE.Vector3());
    const baseDir = tmp.copy(goal.t).sub(eye);
    const baseYaw = Math.atan2(-baseDir.x, -baseDir.z), basePitch = Math.atan2(baseDir.y, Math.hypot(baseDir.x, baseDir.z));
    // People on that side, nearest first. With nobody there, look along the rail.
    const cands = sidePts.filter((p) => p.taken && (myStool ? Math.hypot(p.x - myStool.position.x, p.z - myStool.position.z) > 40 : true) && -s * p.x * dir > 30)
      .sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
    let yaw = dir * 0.85, pitch = 0.1;
    if (cands.length) {
      const c = cands[0];
      let d = Math.atan2(-(c.x - eye.x), -(c.z - eye.z)) - baseYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw = d + dir * 0.12;
      pitch = Math.atan2(60 - eye.y, Math.hypot(c.x - eye.x, c.z - eye.z)) - basePitch;
    }
    // Already looking that way: turn further round.
    if (Math.abs(goal.yaw - yaw) < 0.08 || (goal.yaw - yaw) * dir > 0) yaw = goal.yaw + dir * 0.55;
    goal.yaw = yaw; goal.pitch = pitch;
    clampGoal(); touch();
  }

  // Seat lock, on by default: nothing you tap, drag, scroll or type moves you out of your chair. The button at the
  // top unlocks it for looking and walking around; Reset view at the bottom always brings you back to the chair.
  let locked = true;
  try { locked = localStorage.getItem('bj-seat-lock') !== '0'; } catch { /* no storage: stay locked */ }
  document.querySelectorAll('.room-lock, .room-reset').forEach((b) => b.remove());
  const lockBtn = document.createElement('button'), resetBtn = document.createElement('button');
  // Poker on a computer: a second view, from your own eyes in the chair. The seat view stays the default.
  const povBtn = document.createElement('button'); povBtn.className = 'room-pov';
  const drawPov = () => { povBtn.textContent = firstPerson ? '👁 First person' : '👁 Seat view'; povBtn.title = firstPerson ? 'You see the table from your own eyes. Tap for the higher seat view.' : 'Tap to see the table from your own eyes.'; povBtn.classList.toggle('on', firstPerson); document.body.classList.toggle('room-fp', firstPerson); };
  povBtn.addEventListener('click', (e) => { e.stopPropagation(); firstPerson = !firstPerson; try { localStorage.setItem('pk-pov', firstPerson ? '1' : '0'); } catch { /* fine */ } drawPov(); resize(); home(true); });
  if (OVAL) { document.body.append(povBtn); drawPov(); }
  lockBtn.className = 'room-lock'; resetBtn.className = 'room-reset'; resetBtn.textContent = '🪑 Reset view'; resetBtn.title = 'Back to your chair';
  const drawLock = () => { lockBtn.textContent = locked ? '🔒 Seat locked' : '🔓 Free view'; lockBtn.title = locked ? 'You stay in your chair. Drag to look around. Tap to unlock and walk around.' : 'Tap to lock yourself in your chair again.'; lockBtn.classList.toggle('on', locked); container.classList.toggle('seat-locked', locked); };
  const setLock = (v) => { locked = !!v; try { localStorage.setItem('bj-seat-lock', locked ? '1' : '0'); } catch { /* fine */ } if (locked) { moveKeys.clear(); home(true); } drawLock(); };
  lockBtn.addEventListener('click', (e) => { e.stopPropagation(); setLock(!locked); });
  resetBtn.addEventListener('click', (e) => { e.stopPropagation(); home(true); });
  document.body.append(lockBtn, resetBtn);
  drawLock();

  // Drag to look or walk around, wheel or pinch to move in and out. Presses on buttons, chips and
  // betting circles go to the felt as normal.
  const pointers = new Map();
  const panR = new THREE.Vector3(), panF = new THREE.Vector3();
  container.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  let drag = null, pinch = 0, mid = null, twoFinger = false;
  const interactive = 'button, a, input, select, textarea, label, [data-act], [data-throw-at], [data-vote]';
  for (const ev of ['pointerdown', 'wheel']) container.addEventListener(ev, () => { tour = null; tourW = 1; }, { capture: true, passive: true });
  container.addEventListener('pointerdown', (e) => {
    if ((e.button > 0 && e.button !== 2) || e.target.closest(interactive)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Mouse: the left button drags you across the room, the right button turns the view. One finger turns the view.
    if (pointers.size === 1) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, pan: locked ? false : e.pointerType === 'mouse' ? e.button !== 2 : (e.button === 2) !== walking, mouse: !locked && e.pointerType === 'mouse' && e.button === 0, // seat lock: a drag only turns your head, it never moves you
      onUi: false }; // walking: a plain drag moves you, the right button turns
    else if (pointers.size === 2 && locked) { drag = null; container.classList.remove('dragging'); }
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; drag = null; container.classList.remove('dragging'); }
  });
  // The room follows the hand: drag right and the table moves right, drag down and it comes nearer.
  function slide(dx, dy) {
    rate = 16;
    const kp = cur.r * 0.9 / Math.max(320, container.clientHeight);
    panR.set(1, 0, 0).applyQuaternion(camera.quaternion); panR.y = 0; panR.normalize();
    panF.set(-panR.z, 0, panR.x).multiplyScalar(-1); // straight ahead along the floor
    goal.t.addScaledVector(panR, -dx * kp).addScaledVector(panF, dy * kp);
    if (walking) { keepIn(goal.t); touch(); return; }
    keepIn(goal.t); // the view may slide anywhere inside the outer walls, through furniture and inner walls
    touch();
  }
  container.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      // Two fingers: spread or pinch them to move in and out, move them together to slide the view.
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (d > 0 && Math.abs(d - pinch) > 1) { zoom(Math.max(0.8, Math.min(1.25, pinch / d))); pinch = d; }
      if (mid) slide(mx - mid.x, my - mid.y);
      mid = { x: mx, y: my };
      twoFinger = true;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      try { container.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      container.classList.add('dragging');
    }
    drag.x = e.clientX; drag.y = e.clientY;
    rate = 16;
    const k = 2.4 / Math.max(320, container.clientHeight);
    if (drag.pan) { slide(dx, dy); return; }
    if (seated) { goal.yaw += dx * k * 1.5; goal.pitch += dy * k; }
    else { goal.theta -= dx * k * 1.6; goal.phi -= dy * k; }
    clampGoal(); touch();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) { pinch = 0; mid = null; }
    // The tap that ends a two finger move must not press whatever is under the last finger.
    if (twoFinger && !pointers.size) { twoFinger = false; container.classList.add('was-drag'); setTimeout(() => container.classList.remove('was-drag'), 60); }
    if (drag && drag.id === e.pointerId) {
      if (drag.moved) { container.classList.add('was-drag'); setTimeout(() => container.classList.remove('was-drag'), 60); }
      else if (walking && drag.mouse && e.type === 'pointerup') { // a plain click while walking: a step forward, like a street view
        rate = 6; panR.set(1, 0, 0).applyQuaternion(camera.quaternion); panR.y = 0; panR.normalize(); panF.set(-panR.z, 0, panR.x).multiplyScalar(-1);
        goal.t.addScaledVector(panF, 1.4 * S); keepIn(goal.t); touch();
      }
      drag = null; container.classList.remove('dragging');
    }
  };
  container.addEventListener('pointerup', endPointer);
  // Free camera on a keyboard: W A S D or the arrow keys move you through the office, Escape takes you back to your seat.
  const moveKeys = new Set(), KEYMAP = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r' };
  const typingNow = (e) => e.target?.matches?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]');
  const onKeyDown = (e) => {
    if (!running || locked || typingNow(e)) return;
    const k = KEYMAP[e.key.toLowerCase()];
    if (k) { moveKeys.add(k); tour = null; tourW = 1; if (e.key.startsWith('Arrow')) e.preventDefault(); touch(); }
    else if (e.key === 'Escape' && walking) home(true);
  };
  const onKeyUp = (e) => { const k = KEYMAP[e.key.toLowerCase()]; if (k) moveKeys.delete(k); };
  const onBlur = () => moveKeys.clear();
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);
  container.addEventListener('pointercancel', endPointer);
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (locked) return;
    const d = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    zoom(Math.exp(Math.max(-240, Math.min(240, d)) * 0.0011));
  }, { passive: false });
  // A double click does nothing: quick taps on chips must never move the view. The Reset view button does that.
  // A drag that ends on the felt must not count as a click on whatever is under the finger.
  container.addEventListener('click', (e) => { if (container.classList.contains('was-drag')) { e.stopPropagation(); e.preventDefault(); } }, true);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 56 : OVAL ? (firstPerson ? 76 : 58) : 42; // poker looks across the table from the chair, so it sees wider
    camera.updateProjectionMatrix();
    css.setSize(w, h);
    applyPixel();
    if (seated) seatGoal(!!homeFit); else homeFit = fitHome();
    touch();
  }
  let pixelOn = !!pixel;
  function applyPixel() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    // Pixel look: draw the room small and let the browser blow it up without smoothing.
    // A phone draws at one and a half times its screen points at most: sharp enough, and far fewer pixels to fill each frame.
    gl.setPixelRatio(pixelOn ? 1 / (Math.min(w, h) < 520 ? 3 : 4) : Math.min(Math.min(w, h) < 520 ? 1.5 : 2, devicePixelRatio || 1));
    gl.setSize(w, h);
    gl.domElement.classList.toggle('pixel', pixelOn);
    touch();
  }
  new ResizeObserver(resize).observe(container);
  // The buttons at the bottom of the screen: keep your own cards above them.
  if (hud) {
    new ResizeObserver(() => {
      // The buttons are tallest while betting. The view is fitted to that once and then stays put,
      // so the table is the same size in every phase of a round.
      const hh = hud.offsetHeight || 0;
      if (hh < hudReserve + 24) return;
      hudReserve = hh;
      if (seated) { rate = 4.5; seatGoal(!!homeFit); } else homeFit = fitHome();
    }).observe(hud);
    hudReserve = hud.offsetHeight || 0;
  }
  // Focusing a button on the felt must never scroll the view sideways.
  for (const el of [container, css.domElement]) el.addEventListener('scroll', () => { el.scrollTop = 0; el.scrollLeft = 0; });
  camera.aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
  camera.fov = camera.aspect < 0.8 ? 56 : OVAL ? 58 : 42;
  camera.updateProjectionMatrix();
  home(false);
  resize();

  let running = true, last = performance.now(), frames = 0, fpsAt = last, fps = 0;
  const near = (a, b, eps) => Math.abs(a - b) < eps;
  let dbgCam = null, ambAt = 0;
  const loop = (now) => {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    frames++;
    // The office is alive: redraw every frame while somebody walks, and about 12 times a second otherwise.
    if (office.userData.tick?.(now) || now - ambAt > 80) { ambAt = now; dirty = Math.max(dirty, 1); }
    if (now - fpsAt >= 1000) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now; }
    if (moveKeys.size) {
      if (!walking) { standUp(); walking = true; container.classList.add('walking'); goal.r = homeFit.r * 0.7; goal.phi = 1.05; clampGoal(); }
      const f = (moveKeys.has('f') ? 1 : 0) - (moveKeys.has('b') ? 1 : 0), r = (moveKeys.has('r') ? 1 : 0) - (moveKeys.has('l') ? 1 : 0);
      panR.set(1, 0, 0).applyQuaternion(camera.quaternion); panR.y = 0; panR.normalize(); panF.set(-panR.z, 0, panR.x).multiplyScalar(-1);
      goal.t.addScaledVector(panF, f * 2.4 * S * dt).addScaledVector(panR, r * 2.4 * S * dt); keepIn(goal.t); rate = 12; dirty = Math.max(dirty, 2);
    }
    const k = 1 - Math.exp(-dt * rate);
    const settled = near(cur.theta, goal.theta, 2e-4) && near(cur.phi, goal.phi, 2e-4) && near(cur.r, goal.r, 0.05) && near(cur.yaw, goal.yaw, 2e-4) && near(cur.pitch, goal.pitch, 2e-4) && cur.t.distanceToSquared(goal.t) < 0.01;
    if (tour) {
      // Once round the office, looking in at its middle, then down into the chair for the last part.
      const q = Math.min(1, (now - tour.t0) / tour.ms), wv = ease((q - 0.5) / 0.5), mix = (a, b) => a + (b - a) * wv;
      tourW = wv;
      // Coming from another table: a straight walk from that table to this chair, with no turn round the office.
      cur.theta = goal.theta + (tour.from ? 0.7 : Math.PI * 2) * (1 - ease(q));
      cur.phi = mix(1.2, goal.phi); cur.r = mix(tour.r, goal.r); cur.yaw = goal.yaw * wv; cur.pitch = goal.pitch * wv;
      cur.t.lerpVectors(tour.from || OFFC, goal.t, tour.from ? ease(q) : wv);
      dirty = Math.max(dirty, 2);
      if (q >= 1) { tour = null; tourW = 1; }
    } else if (!settled) {
      for (const key of ['theta', 'phi', 'r', 'yaw', 'pitch']) cur[key] += (goal[key] - cur[key]) * k;
      cur.t.lerp(goal.t, k);
      dirty = Math.max(dirty, 2);
    }
    // A punch after a bad beat: one figure gets up, goes round the table to another, punches, and goes back.
    if (brawl) {
      const B = brawl, a = figs.get(B.from), b = figs.get(B.to), q = (now - B.t0) / B.ms;
      if (!a || !b || q >= 1 || a !== B.a || b !== B.b) {
        if (B.a.parent) { B.a.position.copy(B.p0); B.a.rotation.set(0, B.r0, 0); for (const arm of B.a.userData.arms) { arm.rotation.x = 0; arm.position.z = 0; } B.a.visible = true; B.a.userData.label.visible = true; }
        if (B.b.parent) { B.b.position.copy(B.bp0); B.b.rotation.set(0, B.br0, 0); }
        brawl = null;
      } else {
        const ease = (x) => x * x * (3 - 2 * x), go = q < 0.24 ? ease(q / 0.24) : q > 0.84 ? ease((1 - q) / 0.16) : 1;
        // Round the table, not through it: the angle and the distance from the middle are both blended.
        const ang = B.a0 + B.da * go, rad = (B.rA + (B.rT - B.rA) * go) * (1 + 0.3 * Math.sin(go * Math.PI));
        a.position.set(Math.sin(ang) * rad, B.p0.y + B.lift * Math.sin(Math.min(1, go * 3) * Math.PI / 2) + (go < 1 ? Math.abs(Math.sin(now / 90)) * 5 * B.sc : 0), Math.cos(ang) * rad);
        const hitting = go >= 1;
        a.rotation.y = hitting || q <= 0.84 ? Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z) : B.r0 + (a.rotation.y - B.r0) * 0.8;
        a.visible = true; a.userData.label.visible = false; // up close the name over the head would fill the screen
        const w = now / 55;
        a.userData.arms.forEach((arm, k) => { const p = hitting ? Math.max(0, Math.sin(w + k * Math.PI)) : 0; arm.rotation.x = -1.25 * p; arm.position.z = 70 * p; });
        if (hitting) { a.rotation.x = 0.12 + 0.06 * Math.sin(w); b.position.set(B.bp0.x + Math.sin(now / 23) * 5 * B.sc, B.bp0.y, B.bp0.z + Math.cos(now / 19) * 5 * B.sc); b.rotation.set(0.1 * Math.sin(now / 37), B.br0, 0.2 * Math.sin(now / 31)); }
        else { a.rotation.x = 0; b.position.copy(B.bp0); b.rotation.set(0, B.br0, 0); }
      }
      dirty = Math.max(dirty, 2);
    }
    // Arm reach.
    for (const f of figs.values()) {
      const u = f.userData;
      if (u.reach > 0) {
        u.reach = Math.max(0, u.reach - dt / 0.7);
        const a = Math.sin((1 - u.reach) * Math.PI);
        u.arms[1].rotation.x = -0.5 * a; u.arms[1].position.z = 34 * a;
        dirty = Math.max(dirty, 2);
      }
      // The dealer's left hand goes to the shoe and brings the card out over the table, once for each card.
      if (u.deal > 0) {
        u.deal = Math.max(0, u.deal - dt / 0.34);
        // First half: the hand swings out to the shoe on the dealer's left. Second half: it comes back over the felt with the card.
        const q = 1 - u.deal, a = Math.sin(q * Math.PI), out = Math.sin(Math.min(1, q * 2) * Math.PI), arm = u.arms[1];
        arm.rotation.y = 0.95 * out; arm.rotation.x = -0.75 * a; arm.position.z = 46 * a; arm.position.y = u.armY + 10 * a;
        dirty = Math.max(dirty, 2);
      }
    }
    if (dirty <= 0) return;
    dirty--;
    posFor(cur, camera.position);
    // Never under the table top, the floor or outside the walls, whatever the numbers above say.
    camera.position.y = Math.max(tour ? EYE + (120 * U - EYE) * tourW : seated ? 120 * U : EYE, Math.min(FLOOR + 7.5 * S, camera.position.y));
    const lim = ALL, ix = camera.position.x, iz = camera.position.z; // where the camera would be without the walls
    if (tour) { keepIn(tmp.copy(camera.position)); camera.position.x += (tmp.x - camera.position.x) * (1 - tourW); camera.position.z += (tmp.z - camera.position.z) * (1 - tourW); }
    else if (walking) keepIn(camera.position);
    else { camera.position.x = Math.max(lim.x0, Math.min(lim.x1, camera.position.x)); camera.position.z = Math.max(lim.z0, Math.min(lim.z1, camera.position.z)); }
    tmp.copy(cur.t).sub(camera.position);
    // At the table, a wall only stops the camera; the view keeps the direction it would have had, so it never swings round when the camera is held right over the point it looks at.
    if (!tour && !walking) { tmp.x = cur.t.x - ix; tmp.z = cur.t.z - iz; }
    const yaw0 = Math.atan2(-tmp.x, -tmp.z), pitch0 = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z));
    camera.rotation.set(Math.max(-1.5, Math.min(0.6, pitch0 + cur.pitch)), yaw0 + cur.yaw, 0, 'YXZ');
    // In your own chair you see your body, arms and stool when you look down, but no head in front of your eyes.
    // Your own head is never drawn while the camera is at it (within a metre across the floor): it would block the table.
    if (myFig) { tmp.setFromMatrixPosition(myFig.matrixWorld); const close = Math.hypot(tmp.x - camera.position.x, tmp.z - camera.position.z) < 1.0 * S; for (const part of myFig.userData.headParts) part.visible = (!seated || !!tour) && !close; }
    // On an upright phone your own body would cover your cards and your name, so it is left out.
    if (myFig) myFig.visible = !(seated && container.clientWidth < 600 && container.clientHeight > container.clientWidth * 1.2);
    // From your chair, anything that would be drawn in the bottom quarter of the screen is in your way:
    // a neighbour's arms, their chips, or your own rack under the buttons. It comes back as soon as you
    // turn your head or stand up.
    // Anything drawn low down or far out to the side is beside your own chair, not across the table.
    const low = (o, pad = 0) => { tmp.setFromMatrixPosition(o.matrixWorld).project(camera); return tmp.y < -0.95 + pad; };
    camera.updateMatrixWorld();
    // A seated figure stands on the floor: its base is well below the screen when it is next to you.
    // A neighbour whose chest would be drawn at the far left or right edge shows only as arms cut off by
    // the screen, so it is left out as well until you turn your head towards it.
    const edge = (o) => { tmp.setFromMatrixPosition(o.matrixWorld); tmp.y += 110 * U; tmp.project(camera); return Math.abs(tmp.x) > 0.72 || tmp.y < -0.6; };
    // That rule is only for the resting view from your chair. Once you turn your head, lean in or look up or down,
    // everybody is drawn, so nobody vanishes while you look at them from close by.
    const turned = Math.abs(cur.yaw) > 0.05 || Math.abs(cur.pitch) > 0.05 || cur.r < homeFit.r * 0.97;
    for (const f of others) { f.updateMatrixWorld(); f.visible = !seated || !!tour || turned || side === 'dealer' || (brawl && (f === brawl.a || f === brawl.b)) || !(low(f, 0.35) || edge(f)); }
    for (const r of racks) r.visible = true;
    if (myRack) myRack.visible = true;
    if (dbgCam) { camera.position.copy(office.localToWorld(dbgCam.p.clone())); camera.lookAt(office.localToWorld(dbgCam.t.clone())); }
    gl.render(scene, camera);
    // Names, totals and amounts stand up off the felt and face you, so text at the far side of the
    // table reads as easily as text near you. The felt gets the turn that undoes its own tilt.
    bbQ.copy(feltObj.quaternion).invert().multiply(camera.quaternion);
    bbM.makeRotationFromQuaternion(bbQ);
    const m = bbM.elements, f = (i, flip) => { const v = Math.round((flip ? -m[i] : m[i]) * 1e5) / 1e5; return v === 0 ? 0 : v; };
    const bb = `matrix3d(${f(0)},${f(1, 1)},${f(2)},0,${f(4, 1)},${f(5)},${f(6, 1)},0,${f(8)},${f(9, 1)},${f(10)},0,0,0,0,1)`;
    if (bb !== bbLast) { bbLast = bb; feltEl.style.setProperty('--bb', bb); }
    css.render(scene, camera);
  };
  requestAnimationFrame(loop);

  // Text drawn before the font arrives uses the fallback, so draw it again once the font is there.
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load(`600 58px ${FONT}`), document.fonts.load(`700 58px ${FONT}`)]).then((got) => {
      if (!running || !got.some((l) => l.length)) return;
      office.userData.redrawSign?.();
      chipMat = {}; rackMat = {}; peopleKey = ''; chipKey = '';
      if (lastPeople) setPeople(...lastPeople);
      if (lastChips) setChips(lastChips);
      touch();
    }).catch(() => {});
  }

  return {
    // The dealer stands on the far side. The page lays the felt out for them (dealer's cards nearest,
    // players across the top) and here it is turned half way round so it reads the right way up from there.
    setSide(s) {
      if (s === side) return;
      side = s; flipped = s === 'dealer';
      feltObj.rotation.z = flipped ? Math.PI : 0;
      home(true);
    },
    home: () => home(true),
    // Back to your chair for your turn: an eased glide that is quick at first and settles softly (about half a second).
    turnHome: () => { home(true); rate = 6.5; },
    // Played once when you join a table. A tap, a drag or the wheel ends it early.
    tour(ms = 2000, fromGame = null) {
      if (!homeFit || walking || matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      const F = fromGame && fromGame !== game && OTHER_TABLES[fromGame];
      tour = { t0: performance.now(), ms, r: F ? 2.6 * S : Math.max(ALL.x1 - ALL.x0, ALL.z1 - ALL.z0) * 0.45, from: F ? office.localToWorld(new THREE.Vector3(-F.x, 0, -F.y)).setY(0) : null };
      touch();
      return true;
    },
    touring: () => !!tour,
    // For tests: where the other tables' name tags are on the screen.
    tagsOnScreen() { const r = container.getBoundingClientRect(); camera.updateMatrixWorld(); return otherGroup.children.filter((sp) => sp.userData.go).map((sp) => { tmp.copy(sp.position).project(camera); return { go: sp.userData.go, x: Math.round(r.left + (tmp.x * 0.5 + 0.5) * r.width), y: Math.round(r.top + (-tmp.y * 0.5 + 0.5) * r.height), z: tmp.z }; }); },
    // For tests: put the camera at a point of the office plan (x, height, y in metres) looking at another.
    debugTrip(who, kind) { office.userData.trip?.(who, kind); touch(); },
    debugTalk() { const n = office.userData.talk?.(); touch(); return n; },
    debugLook(a, b) { dbgCam = a ? { p: new THREE.Vector3(-a[0], a[1], -a[2]), t: new THREE.Vector3(-b[0], b[1], -b[2]) } : null; touch(); },
    zoomBy(d) { zoom(d > 0 ? 0.86 : 1.16); },
    look,
    setPeople,
    setOthers,
    setChips,
    // One card leaves the shoe: the dealer's hand moves with it.
    // Walk mode: leave the chair and move through the whole office. A drag moves you, two fingers or the
    // right button turn and zoom. Reset view takes you back to your seat.
    walk(on) {
      if (on && locked) setLock(false); // Walk around in the menu unlocks the seat
      if (!on) { home(true); return false; }
      standUp(); walking = true; container.classList.add('walking');
      goal.r = homeFit.r * 0.7; goal.phi = 1.05; rate = 4.5;
      clampGoal(); touch();
      return true;
    },
    walking: () => walking,
    // One player's figure gets up, goes round the table to another player's figure, punches for a while and goes back.
    punch(fromId, toId, ms = 5000) {
      const a = figs.get(fromId), b = figs.get(toId);
      if (!a || !b || a === b || brawl) return false;
      const sc = a.scale.x, rA = Math.hypot(a.position.x, a.position.z), rB = Math.hypot(b.position.x, b.position.z) || 1;
      const a0 = Math.atan2(a.position.x, a.position.z), b0 = Math.atan2(b.position.x, b.position.z);
      const wrap = (x) => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
      // The place to punch from: behind the other chair and a step to the side the walk comes from, so the
      // puncher stands on the floor outside the ring of chairs, never in the table.
      const sg = -Math.sign(wrap(b0 - a0) || 1), nx = b.position.x / rB, nz = b.position.z / rB;
      const tx = b.position.x + nx * 85 * sc + nz * sg * 75 * sc, tz = b.position.z + nz * 85 * sc - nx * sg * 75 * sc;
      brawl = { from: fromId, to: toId, a, b, t0: performance.now(), ms, sc, p0: a.position.clone(), r0: a.rotation.y, bp0: b.position.clone(), br0: b.rotation.y, a0, da: wrap(Math.atan2(tx, tz) - a0), rA, rT: Math.hypot(tx, tz), lift: 34 * sc };
      touch();
      return true;
    },
    brawling: () => !!brawl,
    dealCard() { for (const f of figs.values()) if (f.userData.isDealer) { f.userData.deal = 1; touch(); } },
    // For tests only: the drawing parts, so a test can look at one spot of the room.
    dbg: () => ({ gl, scene, camera, figs }),
    setPixel(on) { pixelOn = !!on; applyPixel(); },
    // For checks and tests: where the camera is and how fast the room is drawing.
    info: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, fps, seated, side, pos: camera.position.toArray().map(Math.round), yaw: cur.yaw, r: Math.round(cur.r), home: homeFit && Math.round(homeFit.r), phi: homeFit && homeFit.phi, people: figs.size, others: otherGroup.children.length }),
    // Jump straight to where the camera is heading (used by tests, which cannot wait for the glide).
    settle() { for (const key of ['theta', 'phi', 'r', 'yaw', 'pitch']) cur[key] = goal[key]; cur.t.copy(goal.t); touch(); },
    stop() { running = false; },
  };
}
