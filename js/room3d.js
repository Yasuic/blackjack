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
function tableShape(W, H, grow) {
  const s = new THREE.Shape();
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
// windows, doors, pillars, cabinets, sofas, desks, chairs and screens, all in metres. The desks that
// stood in the middle of the open floor are left out: the blackjack table stands there instead.
// Plan x runs along the front wall and plan y from the front wall to the windows.
const OFFICE = {"sidePanes":[{"a":2.526,"b":2.7292},{"a":3.7274,"b":3.9306}],"cab2":{"x":6.5666,"y":6.7455,"width":1.9764,"depth":0.4572},"bump":{"x":-1.01,"y":0,"w":1.01,"d":5.067},"sofa":{"depth":0.433,"a":{"x":0,"y":5.067,"len":1.714},"b":{"x":0,"y":5.067,"len":2.959},"c":{"x":2.526,"y":1.497,"len":3.57}},"width":14.36,"depth":8.267,"divider":0.103,"pillars":[{"id":"p1","shape":"rect","x":0.182,"y":6.7808,"width":0.908,"depth":1.2002},{"id":"p2","shape":"square","x":7.593,"y":7.2027,"width":0.95,"depth":0.95},{"id":"p3","shape":"rect","x":13.398,"y":6.8218,"width":0.908,"depth":1.2002}],"cabinet":{"x":3.9306,"y":0,"width":3.4737,"depth":0.381},"walls":[{"id":"w6","type":"wall","x1":-1.01,"y1":0,"x2":1.4338,"y2":0},{"id":"g2","type":"glass","x1":2.399,"y1":0,"x2":11.419,"y2":0},{"id":"w7","type":"wall","x1":11.419,"y1":0,"x2":14.36,"y2":0},{"id":"n1","type":"window","x1":0,"y1":8.267,"x2":14.36,"y2":8.267,"thick":0.127},{"id":"n2","type":"window","x1":0,"y1":5.067,"x2":0,"y2":8.267},{"id":"n3","type":"window","x1":14.36,"y1":0,"x2":14.36,"y2":8.267},{"id":"g3","type":"glass","x1":2.399,"y1":0,"x2":2.399,"y2":5.067,"thick":0.127},{"id":"g4","type":"glass","x1":0,"y1":5.067,"x2":2.399,"y2":5.067},{"id":"g5","type":"glass","x1":11.419,"y1":0,"x2":11.419,"y2":3.272},{"id":"g7","type":"glass","x1":11.419,"y1":4.327,"x2":11.419,"y2":8.267},{"id":"w9","type":"wall","x1":11.419,"y1":4.224,"x2":14.36,"y2":4.224},{"id":"n2b","type":"window","x1":-1.01,"y1":0,"x2":-1.01,"y2":5.067,"thick":0.127},{"id":"w6b","type":"wall","x1":-1.01,"y1":5.067,"x2":0,"y2":5.067}],"doors":[{"id":"d1","x1":1.4338,"y1":0,"x2":2.399,"y2":0,"hinge":{"x":2.399,"y":0}},{"id":"d2","x1":2.7292,"y1":0,"x2":3.7274,"y2":0,"hinge":{"x":2.7292,"y":0}},{"id":"d3","x1":11.419,"y1":3.2906,"x2":11.419,"y2":4.224,"hinge":{"x":11.419,"y":4.224}},{"id":"d4","x1":11.419,"y1":4.327,"x2":11.419,"y2":5.2617,"hinge":{"x":11.419,"y":4.327}}],"rooms":[{"id":"bigBoard","x":-1.01,"y":0,"width":3.409,"depth":5.067},{"id":"eating","x":0,"y":5.067,"width":2.399,"depth":3.2},{"id":"openPlan","x":2.399,"y":0,"width":9.02,"depth":8.267},{"id":"printIT","x":6.168,"y":6.259,"width":2.294,"depth":2.008},{"id":"smallBoard","x":11.419,"y":0,"width":2.942,"depth":4.224},{"id":"securities","x":11.419,"y":4.327,"width":2.942,"depth":3.94}],"furniture":[{"id":"t1","room":"bigBoard","kind":"rrect","cx":0.737,"cy":2.234,"w":1.0,"d":2.243},{"id":"tv1","room":"bigBoard","kind":"tvh","cx":0.666,"cy":4.851,"w":0.639,"d":0.0},{"id":"et1","room":"eating","kind":"marble","cx":1.15,"cy":6.217,"w":0.65,"d":0.7},{"id":"et2","room":"eating","kind":"marble","cx":1.9,"cy":6.217,"w":0.65,"d":0.7},{"id":"dS","room":"openPlan","kind":"rect","cx":5.276,"cy":1.079,"w":0.6985,"d":1.397},{"id":"dT","room":"openPlan","kind":"rect","cx":5.974,"cy":1.079,"w":0.6985,"d":1.397},{"id":"dC","room":"openPlan","kind":"rect","cx":9.526,"cy":0.878,"w":0.8001,"d":1.6002,"top":"yellow"},{"id":"dF","room":"openPlan","kind":"rect","cx":10.326,"cy":0.878,"w":0.8001,"d":1.6002,"top":"yellow"},{"id":"dTh","room":"openPlan","kind":"rect","cx":3.845,"cy":7.392,"w":0.8001,"d":1.6002,"top":"yellow"},{"id":"dA","room":"openPlan","kind":"rect","cx":4.645,"cy":7.392,"w":0.8001,"d":1.6002,"top":"yellow"},{"id":"dG","room":"openPlan","kind":"rect","cx":9.343,"cy":7.146,"w":1.6002,"d":0.8001,"top":"yellow"},{"id":"sv","room":"printIT","kind":"rect","cx":7.08,"cy":7.514,"w":0.67,"d":0.562},{"id":"t2","room":"smallBoard","kind":"rrect","cx":12.957,"cy":2.061,"w":0.891,"d":2.196},{"id":"tv3","room":"smallBoard","kind":"tvh","cx":12.949,"cy":4.106,"w":0.639,"d":0.0},{"id":"t3","room":"securities","kind":"round","cx":13.235,"cy":5.642,"w":1.028,"d":1.028},{"id":"dN","room":"securities","kind":"rect","cx":11.849,"cy":7.417,"w":0.8001,"d":1.6002,"top":"yellow"},{"id":"tv4","room":"securities","kind":"tvh","cx":12.949,"cy":4.361,"w":0.639,"d":0.0}],"chairs":[{"room":"bigBoard","cx":-0.113,"cy":1.259},{"room":"bigBoard","cx":1.587,"cy":1.486},{"room":"bigBoard","cx":-0.113,"cy":1.909},{"room":"bigBoard","cx":1.587,"cy":2.234},{"room":"bigBoard","cx":-0.113,"cy":2.559},{"room":"bigBoard","cx":1.587,"cy":2.982},{"room":"bigBoard","cx":-0.113,"cy":3.209},{"room":"openPlan","cx":4.577,"cy":1.079},{"room":"openPlan","cx":6.673,"cy":1.079},{"room":"openPlan","cx":8.776,"cy":0.878},{"room":"openPlan","cx":11.076,"cy":0.878},{"room":"openPlan","cx":3.095,"cy":7.392},{"room":"openPlan","cx":5.395,"cy":7.392},{"room":"smallBoard","cx":12.162,"cy":1.329},{"room":"smallBoard","cx":13.753,"cy":1.512},{"room":"smallBoard","cx":12.162,"cy":2.061},{"room":"smallBoard","cx":13.753,"cy":2.61},{"room":"smallBoard","cx":12.162,"cy":2.793},{"room":"securities","cx":13.712,"cy":6.302},{"room":"securities","cx":12.758,"cy":6.301},{"room":"securities","cx":12.758,"cy":4.982},{"room":"securities","cx":13.711,"cy":4.982},{"room":"openPlan","cx":9.343,"cy":7.896},{"room":"eating","cx":1.29,"cy":6.847,"stool":true},{"room":"eating","cx":1.65,"cy":6.847,"stool":true},{"room":"eating","cx":2.01,"cy":6.847,"stool":true},{"room":"eating","cx":2.37,"cy":6.847,"stool":true},{"room":"securities","cx":12.599,"cy":7.417}]};
// Plan position of the middle of the blackjack table.
const OFFICE_AT = { x: 7.07, y: 4.2 };
// The one name plate in the room. Set it to '' to leave the plate out.
const OFFICE_SIGN = 'ARC Group Hong Kong office';

// Builds the whole office as a handful of merged meshes (one per material). Units are metres with the
// floor at y = 0; the caller scales and places the group. Scene X = -plan x, Z = -plan y.
function buildOffice(signText) {
  const D = OFFICE, Hh = { ceil: 2.7, door: 2.1, sill: 0.85, winTop: 2.55, cab: 2.7, desk: 0.749 };
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
    dark: mk({ color: '#30353c', roughness: 0.6 }),
  };
  const group = new THREE.Group();
  // Everything that does not move is gathered by material and merged, so the office costs few draw calls.
  const buckets = new Map();
  const put = (geo, mat, matrix, shadow = true) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
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
    if (signText) { // one plain name plate on the cupboard that faces the room
      const draw = (g, w, h) => {
        g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#2b2f35'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 76px ${FONT}`;
        g.fillText(signText, w / 2, h / 2 + 4, w - 60);
      };
      const tex = canvasTexture(1024, 160, draw);
      group.userData.redrawSign = () => { const cv = tex.image, g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); draw(g, cv.width, cv.height); tex.needsUpdate = true; };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.235), mk({ map: tex, roughness: 0.6 }));
      m.position.set(-(c.x + c.width / 2), 2.2, -c.y + 0.012);
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
    if (f.kind === 'tvh') { box(f.w, 0.42, 0.05, M.screen, X, 1.3, Z + (f.cy > 4 ? 0.03 : -0.03)); return; }
    if (f.id === 'sv') { box(f.w, 0.95, f.d, M.dark, X, 0.475, Z); return; }
    surfaces.push(f);
    if (f.kind === 'marble') { box(f.w, 0.035, f.d, M.marble, X, Hh.desk - 0.0175, Z); cyl(0.035, 0.035, Hh.desk - 0.035, 10, M.chrome, X, (Hh.desk - 0.035) / 2, Z); box(0.42, 0.02, 0.42, M.leg, X, 0.01, Z); return; }
    if (f.kind === 'round') { cyl(f.w / 2, f.w / 2, 0.035, 32, M.wood, X, Hh.desk - 0.0175, Z); cyl(0.04, 0.04, Hh.desk - 0.05, 10, M.leg, X, (Hh.desk - 0.05) / 2, Z); cyl(0.28, 0.3, 0.03, 20, M.leg, X, 0.015, Z, false); return; }
    if (f.kind === 'rrect') {
      const g = new THREE.ExtrudeGeometry(roundRect(f.w, f.d, Math.min(f.w, f.d) * 0.45), { depth: 0.04, bevelEnabled: false, curveSegments: 12 });
      g.rotateX(-Math.PI / 2);
      emit(g, M.wood, at(X, Hh.desk - 0.04, Z), true);
      [-1, 1].forEach((s) => box(0.1, Hh.desk - 0.04, 0.5, M.leg, X, (Hh.desk - 0.04) / 2, Z + s * f.d * 0.28));
      return;
    }
    // Desks and plain tables: a top and two panel legs on the short sides.
    box(f.w, 0.03, f.d, f.room === 'eating' ? M.wood : f.top === 'yellow' ? M.deskYellow : M.deskTop, X, Hh.desk - 0.015, Z);
    const long = f.w >= f.d;
    [-1, 1].forEach((s) => { if (long) box(0.04, Hh.desk - 0.03, f.d * 0.85, M.leg, X + s * (f.w / 2 - 0.05), (Hh.desk - 0.03) / 2, Z); else box(f.w * 0.85, Hh.desk - 0.03, 0.04, M.leg, X, (Hh.desk - 0.03) / 2, Z + s * (f.d / 2 - 0.05)); });
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
  D.chairs.filter((c) => !c.stool).forEach((c) => {
    let best = null, bd = 1e9;
    surfaces.filter((s) => s.room === c.room).forEach((s) => { const dx = Math.max(Math.abs(c.cx - s.cx) - s.w / 2, 0), dy = Math.max(Math.abs(c.cy - s.cy) - s.d / 2, 0); const dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = s; } });
    let ry = 0;
    if (best) { const tx = Math.min(Math.max(c.cx, best.cx - best.w / 2), best.cx + best.w / 2), ty = Math.min(Math.max(c.cy, best.cy - best.d / 2), best.cy + best.d / 2); ry = Math.atan2(tx - c.cx, ty - c.cy); }
    parent = at(-c.cx, 0, -c.cy, ry);
    officeChair();
    parent = null;
  });
  // Two screens on every desk, at the edge away from the nearest chair and facing it.
  desks.forEach((f) => {
    let best = null, bd = 1e9;
    D.chairs.filter((c) => c.room === f.room).forEach((c) => { const d = (c.cx - f.cx) ** 2 + (c.cy - f.cy) ** 2; if (d < bd) { bd = d; best = c; } });
    const dx = best ? best.cx - f.cx : 0, dy = best ? best.cy - f.cy : 1, alongX = Math.abs(dx) > Math.abs(dy);
    const sgn = alongX ? Math.sign(dx) : Math.sign(dy), half = alongX ? f.w / 2 : f.d / 2, sp = alongX ? f.d : f.w;
    const back = -sgn * (half - 0.15), gap = Math.min(0.29, sp / 2 - 0.27);
    [-1, 1].forEach((k) => {
      let px = f.cx, py = f.cy;
      if (alongX) { px += back; py += k * gap; } else { py += back; px += k * gap; }
      const fx = -(alongX ? sgn : 0), fz = -(alongX ? 0 : sgn);
      parent = at(-px, Hh.desk, -py, Math.atan2(fx, fz) + Math.PI + k * 0.12 * (alongX ? 1 : -1) * sgn);
      box(0.54, 0.33, 0.025, M.screen, 0, 0.33, 0); box(0.04, 0.2, 0.03, M.leg, 0, 0.1, 0.03); box(0.22, 0.012, 0.18, M.leg, 0, 0, 0.03, false);
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

export function initRoom(container, feltEl, { phone, pixel = false, hud = null, size = null } = {}) {
  // The felt keeps the size and shape its own style sheet gives it, so the 3D table always matches the
  // flat one: the height and the rounded end are read from the page, not fixed here. On a phone the felt
  // is small, close to its size in the flat view, so cards and text stay readable.
  const cssH = parseFloat(getComputedStyle(feltEl).height);
  const W = Math.round(size?.W || (phone ? 400 : 1240));
  const H = Math.round(size?.H || Math.max(W * 0.5, Math.min(W * 1.6, cssH > 50 ? cssH : W * 0.6)));
  feltEl.classList.add('in3d');
  {
    const r = getComputedStyle(feltEl).borderBottomLeftRadius.trim().split(/\s+/), v = r[r.length - 1];
    CURVE = v.endsWith('%') && parseFloat(v) > 5 ? Math.min(1, parseFloat(v) / 100) : 0.34;
  }
  // Real sizes: a seven-seat blackjack table is about 183 cm wide over its padded rail, the rail is about
  // 11 cm wide and the playing surface is about 91 cm off the floor. That fixes how many table units make a metre.
  const S = W / 1.61;
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
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
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
  const hole = flat(new THREE.Mesh(feltGeo,
    new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending })), 1);
  scene.add(hole);
  // Shadows and a soft dark edge on top of the felt, so the room's light seems to fall on the HTML too.
  const shade = flat(new THREE.Mesh(feltGeo, new THREE.ShadowMaterial({ opacity: 0.3, depthWrite: false })), 1.3);
  shade.receiveShadow = true; shade.renderOrder = 2;
  scene.add(shade);
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
  const office = buildOffice(OFFICE_SIGN);
  office.scale.setScalar(S);
  office.position.set(OFFICE_AT.x * S, FLOOR, OFFICE_AT.y * S);
  scene.add(office);
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
    const shirt = lam({ color: new THREE.Color().setHSL(hashHue(p.id) / 360, 0.5, 0.42), flatShading: true });
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

  let peopleRev = 0, flipped = false; // flipped: the felt is laid out for the dealer and turned to face them
  let peopleKey = '', figs = new Map(), stoolGroup = null, myFig = null, myStool = null, sidePts = [], seatEdge = new Map();
  let lastPeople = null, lastChips = null;
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
  let side = 'player', seated = true, rate = 14, homeFit = null, hudReserve = 0;
  const PHI_MAX = 1.36, YAW_MAX = 2.25;
  const EYE = 340 * U; // lowest the camera goes when walking around: standing eye height, above the table top
  // The open floor of the office, inside the glass walls, the cupboard and the cabinets. The camera stays in it.
  const BOUND = { x0: -(11.419 - OFFICE_AT.x - 0.35) * S, x1: (OFFICE_AT.x - 2.96 - 0.3) * S, z0: -(6.7455 - OFFICE_AT.y - 0.3) * S, z1: (OFFICE_AT.y - 0.381 - 0.3) * S };
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
    const topMax = 1 - 2 * (w < 600 ? 118 : Math.min(34, h * 0.05)) / h, sideMax = 1 - (w < 600 ? 10 : 16) / w;
    probe.fov = camera.fov; probe.aspect = w / h; probe.near = 10; probe.far = 12000; probe.updateProjectionMatrix();
    const box = (phi, r, tz) => {
      probe.position.set(0, r * Math.cos(phi), sgn * (tz + r * Math.sin(phi)));
      probe.lookAt(0, 0, sgn * tz);
      probe.updateMatrixWorld();
      let lo = Infinity, hi = -Infinity, sd = 0;
      for (const p of outline) { tmp.copy(p).project(probe); hi = Math.max(hi, tmp.y); sd = Math.max(sd, Math.abs(tmp.x)); }
      for (const p of nearEdge) { tmp.copy(p).project(probe); lo = Math.min(lo, tmp.y); }
      return { lo, hi, sd };
    };
    // How far towards the player the camera must aim so the near rail sits just above the buttons.
    const align = (phi, r) => {
      let a = -H * 1.5, b = H * 1.5;
      for (let j = 0; j < 14; j++) { const m = (a + b) / 2; if (box(phi, r, m).lo < bottom) a = m; else b = m; }
      return b;
    };
    if (leanR) return { phi: homeFit.phi, r: leanR, tz: align(homeFit.phi, leanR) };
    let best = null;
    // Start low, like sitting at the table, and look from higher only when the screen is tall and narrow.
    for (let phi = 0.64; phi >= 0.34; phi -= 0.06) {
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
  const rMin = () => homeFit.r * 0.45;
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

  // Drag to look or walk around, wheel or pinch to move in and out. Presses on buttons, chips and
  // betting circles go to the felt as normal.
  const pointers = new Map();
  const panR = new THREE.Vector3(), panF = new THREE.Vector3();
  container.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  let drag = null, pinch = 0, mid = null, twoFinger = false;
  const interactive = 'button, a, input, select, textarea, label, [data-act], [data-throw-at], [data-vote]';
  container.addEventListener('pointerdown', (e) => {
    if ((e.button > 0 && e.button !== 2) || e.target.closest(interactive)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Left button (or one finger) turns the view. Right button slides the view across the room.
    if (pointers.size === 1) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, pan: e.button === 2 };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; drag = null; container.classList.remove('dragging'); }
  });
  // The room follows the hand: drag right and the table moves right, drag down and it comes nearer.
  function slide(dx, dy) {
    rate = 16;
    const kp = cur.r * 0.9 / Math.max(320, container.clientHeight);
    panR.set(1, 0, 0).applyQuaternion(camera.quaternion); panR.y = 0; panR.normalize();
    panF.set(-panR.z, 0, panR.x).multiplyScalar(-1); // straight ahead along the floor
    goal.t.addScaledVector(panR, -dx * kp).addScaledVector(panF, dy * kp);
    const lim = homeFit.r * (seated ? 0.45 : 1);
    goal.t.x = Math.max(-lim, Math.min(lim, goal.t.x)); goal.t.z = Math.max(-lim, Math.min(lim, goal.t.z));
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
      drag = null; container.classList.remove('dragging');
    }
  };
  container.addEventListener('pointerup', endPointer);
  container.addEventListener('pointercancel', endPointer);
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    zoom(Math.exp(Math.max(-240, Math.min(240, d)) * 0.0011));
  }, { passive: false });
  container.addEventListener('dblclick', (e) => { if (!e.target.closest(interactive)) home(true); });
  // A drag that ends on the felt must not count as a click on whatever is under the finger.
  container.addEventListener('click', (e) => { if (container.classList.contains('was-drag')) { e.stopPropagation(); e.preventDefault(); } }, true);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 56 : 42;
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
    gl.setPixelRatio(pixelOn ? 1 / (Math.min(w, h) < 520 ? 3 : 4) : Math.min(2, devicePixelRatio || 1));
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
  camera.fov = camera.aspect < 0.8 ? 56 : 42;
  camera.updateProjectionMatrix();
  home(false);
  resize();

  let running = true, last = performance.now(), frames = 0, fpsAt = last, fps = 0;
  const near = (a, b, eps) => Math.abs(a - b) < eps;
  const loop = (now) => {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    frames++;
    if (now - fpsAt >= 1000) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now; }
    const k = 1 - Math.exp(-dt * rate);
    const settled = near(cur.theta, goal.theta, 2e-4) && near(cur.phi, goal.phi, 2e-4) && near(cur.r, goal.r, 0.05) && near(cur.yaw, goal.yaw, 2e-4) && near(cur.pitch, goal.pitch, 2e-4) && cur.t.distanceToSquared(goal.t) < 0.01;
    if (!settled) {
      for (const key of ['theta', 'phi', 'r', 'yaw', 'pitch']) cur[key] += (goal[key] - cur[key]) * k;
      cur.t.lerp(goal.t, k);
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
    }
    if (dirty <= 0) return;
    dirty--;
    posFor(cur, camera.position);
    // Never under the table top, the floor or outside the walls, whatever the numbers above say.
    camera.position.y = Math.max(seated ? 120 * U : EYE, Math.min(FLOOR + 7.5 * S, camera.position.y));
    camera.position.x = Math.max(BOUND.x0, Math.min(BOUND.x1, camera.position.x));
    camera.position.z = Math.max(BOUND.z0, Math.min(BOUND.z1, camera.position.z));
    tmp.copy(cur.t).sub(camera.position);
    const yaw0 = Math.atan2(-tmp.x, -tmp.z), pitch0 = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z));
    camera.rotation.set(Math.max(-1.5, Math.min(0.6, pitch0 + cur.pitch)), yaw0 + cur.yaw, 0, 'YXZ');
    // In your own chair you see your body, arms and stool when you look down, but no head in front of your eyes.
    if (myFig) for (const part of myFig.userData.headParts) part.visible = !seated;
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
    for (const f of others) { f.updateMatrixWorld(); f.visible = !seated || !(low(f, 0.35) || edge(f)); }
    for (const r of racks) r.visible = true;
    if (myRack) myRack.visible = true;
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
    zoomBy(d) { zoom(d > 0 ? 0.86 : 1.16); },
    look,
    setPeople,
    setChips,
    setPixel(on) { pixelOn = !!on; applyPixel(); },
    // For checks and tests: where the camera is and how fast the room is drawing.
    info: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, fps, seated, side, pos: camera.position.toArray().map(Math.round), yaw: cur.yaw, r: Math.round(cur.r), home: homeFit && Math.round(homeFit.r), people: figs.size }),
    // Jump straight to where the camera is heading (used by tests, which cannot wait for the glide).
    settle() { for (const key of ['theta', 'phi', 'r', 'yaw', 'pitch']) cur[key] = goal[key]; cur.t.copy(goal.t); touch(); },
    stop() { running = false; },
  };
}
