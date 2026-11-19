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

const SKIN = ['#f6d7b8', '#eac39a', '#d6a373', '#b97f4f', '#8a5a36', '#5a3a24'];
const HAIR = ['#17120f', '#3b2416', '#7a4a22', '#c9a15a', '#9aa0a6'];
const CURVE = 0.34; // how much of the felt's height the rounded end takes

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
// Floor boards.
function boards(g, w, h) {
  woodGrain('#3a2314', '#1c0f08', '#5a3a22', 7)(g, w, h);
  const r = rng(11);
  for (let row = 0; row < 4; row++) {
    const y = (row * h) / 4;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, y, w, 2);
    const off = r() * w;
    for (let k = 0; k < 2; k++) { g.fillRect((off + k * w * 0.5) % w, y, 2, h / 4); }
    g.fillStyle = `rgba(${r() < 0.5 ? '255,220,170' : '0,0,0'},${0.04 + r() * 0.06})`; g.fillRect(0, y + 2, w, h / 4 - 2);
  }
}
// Round rug under the table: deep red with gold rings and a ring of diamonds.
function rugArt(g, w, h) {
  const c = w / 2;
  g.clearRect(0, 0, w, h);
  const ring = (rad, col) => { g.fillStyle = col; g.beginPath(); g.arc(c, c, rad, 0, Math.PI * 2); g.fill(); };
  ring(c - 2, '#c9a04a'); ring(c - 10, '#3d0c16'); ring(c - 44, '#c9a04a'); ring(c - 50, '#5a1220');
  ring(c * 0.52, '#c9a04a'); ring(c * 0.52 - 6, '#4a0e1a');
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2, rr = c - 27;
    g.save(); g.translate(c + Math.cos(a) * rr, c + Math.sin(a) * rr); g.rotate(a + Math.PI / 4);
    g.fillStyle = i % 2 ? '#1f6a62' : '#e2bd6a'; g.fillRect(-7, -7, 14, 14); g.restore();
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, rr = c * 0.72;
    g.save(); g.translate(c + Math.cos(a) * rr, c + Math.sin(a) * rr); g.rotate(a);
    g.strokeStyle = 'rgba(226,189,106,.7)'; g.lineWidth = 3; g.strokeRect(-16, -16, 32, 32);
    g.fillStyle = 'rgba(31,106,98,.8)'; g.fillRect(-6, -6, 12, 12); g.restore();
  }
}
// Walls: wood panels below a gold rail, dark green paper with a small diamond print above.
function wallArt(g, w, h) {
  g.fillStyle = '#12312a'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h * 0.62; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < w; x += 32) {
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = 'rgba(226,189,106,.13)'; g.fillRect(-4, -4, 8, 8); g.restore();
  }
  const top = g.createLinearGradient(0, 0, 0, h * 0.62);
  top.addColorStop(0, 'rgba(0,0,0,.6)'); top.addColorStop(0.5, 'rgba(0,0,0,.05)'); top.addColorStop(1, 'rgba(0,0,0,.2)');
  g.fillStyle = top; g.fillRect(0, 0, w, h * 0.62);
  g.fillStyle = '#c9a04a'; g.fillRect(0, h * 0.62, w, 6);
  g.fillStyle = '#3b1f10'; g.fillRect(0, h * 0.62 + 6, w, h);
  for (let x = 0; x < w; x += w / 4) {
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x, h * 0.62 + 6, 4, h);
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 3; g.strokeRect(x + 22, h * 0.68, w / 4 - 40, h * 0.25);
    g.strokeStyle = 'rgba(255,210,150,.12)'; g.lineWidth = 2; g.strokeRect(x + 25, h * 0.68 + 3, w / 4 - 40, h * 0.25);
  }
  g.fillStyle = '#1a0c06'; g.fillRect(0, h * 0.96, w, h * 0.04);
}
// Pictures for the frames: plain shapes in the table's colours.
function pictureArt(kind) {
  return (g, w, h) => {
    g.fillStyle = ['#e9dcc0', '#1d3b34', '#2a1a12', '#e9dcc0'][kind]; g.fillRect(0, 0, w, h);
    if (kind === 0) { // a red diamond and a black circle
      g.fillStyle = '#b3262b'; g.beginPath(); g.moveTo(w * 0.32, h * 0.2); g.lineTo(w * 0.5, h * 0.5); g.lineTo(w * 0.32, h * 0.8); g.lineTo(w * 0.14, h * 0.5); g.fill();
      g.fillStyle = '#1c1c1c'; g.beginPath(); g.arc(w * 0.7, h * 0.5, h * 0.24, 0, Math.PI * 2); g.fill();
    } else if (kind === 1) { // gold sun over hills
      g.fillStyle = '#e2bd6a'; g.beginPath(); g.arc(w * 0.68, h * 0.36, h * 0.18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0e241f'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.7); g.lineTo(w * 0.3, h * 0.48); g.lineTo(w * 0.55, h * 0.72); g.lineTo(w * 0.8, h * 0.55); g.lineTo(w, h * 0.7); g.lineTo(w, h); g.fill();
    } else if (kind === 2) { // stacked chips
      const cols = ['#b3262b', '#e9dcc0', '#1f6a62', '#e2bd6a'];
      for (let i = 0; i < 7; i++) { g.fillStyle = cols[i % 4]; g.fillRect(w * 0.2, h * 0.82 - i * h * 0.09, w * 0.24, h * 0.07); }
      for (let i = 0; i < 4; i++) { g.fillStyle = cols[(i + 2) % 4]; g.fillRect(w * 0.56, h * 0.82 - i * h * 0.09, w * 0.24, h * 0.07); }
    } else { // bold stripes
      const cols = ['#1d3b34', '#b3262b', '#e2bd6a', '#1c1c1c'];
      for (let i = 0; i < 4; i++) { g.fillStyle = cols[i]; g.fillRect(w * (0.14 + i * 0.19), h * 0.16, w * 0.13, h * 0.68); }
    }
  };
}
// Soft dark edge laid over the felt, as if the lamp lights the middle most.
function vignette(g, w, h) {
  const grd = g.createRadialGradient(w / 2, h * 0.5, h * 0.2, w / 2, h * 0.5, h * 0.72);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.7, 'rgba(0,0,0,.14)'); grd.addColorStop(1, 'rgba(0,0,0,.42)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}
function glowDot(g, w, h) {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,225,160,.9)'); grd.addColorStop(0.3, 'rgba(255,190,100,.35)'); grd.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}

function hashHue(id) { let h = 2166136261; for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 360; }

export function initRoom(container, feltEl, { phone, pixel = false, hud = null } = {}) {
  const W = phone ? 560 : 1100, H = phone ? 700 : 820;
  feltEl.classList.add('in3d');
  feltEl.style.width = W + 'px';
  feltEl.style.height = H + 'px';

  const FLOOR = -470, HALF = 2800, CEIL = 1900;
  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(42, 1, 10, 12000);

  const css = new CSS3DRenderer();
  css.domElement.className = 'room-css';
  const gl = new THREE.WebGLRenderer({ antialias: !pixel, alpha: true, powerPreference: 'high-performance' });
  gl.useLegacyLights = true;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.domElement.className = 'room-gl';
  container.append(css.domElement, gl.domElement);

  let dirty = 3; // frames still to draw; the room rests when nothing moves
  const touch = () => { dirty = Math.max(dirty, 2); };

  // The HTML felt, lying flat on the table.
  const feltObj = new CSS3DObject(feltEl);
  feltObj.rotation.x = -Math.PI / 2;
  feltObj.position.y = 1;
  scene.add(feltObj);

  const flat = (mesh, y) => { mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; return mesh; };
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const add = (mesh, x, y, z, cast, recv) => { mesh.position.set(x, y, z); mesh.castShadow = !!cast; mesh.receiveShadow = !!recv; scene.add(mesh); return mesh; };

  // See-through hole where the HTML felt shows.
  const feltGeo = new THREE.ShapeGeometry(tableShape(W, H, 0), 96);
  const hole = flat(new THREE.Mesh(feltGeo,
    new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending })), 1);
  scene.add(hole);
  // Shadows and a soft dark edge on top of the felt, so the lamp seems to light the HTML too.
  const shade = flat(new THREE.Mesh(feltGeo, new THREE.ShadowMaterial({ opacity: 0.38, depthWrite: false })), 1.3);
  shade.receiveShadow = true; shade.renderOrder = 2;
  scene.add(shade);
  const vigTex = canvasTexture(256, 256, vignette);
  vigTex.repeat.set(1 / W, 1 / H); vigTex.offset.set(0.5, 0.5);
  const vig = flat(new THREE.Mesh(feltGeo, new THREE.MeshBasicMaterial({ map: vigTex, transparent: true, depthWrite: false })), 1.6);
  vig.renderOrder = 3;
  scene.add(vig);

  // Padded leather rail around the felt.
  const railShape = tableShape(W, H, 62);
  railShape.holes.push(tableShape(W, H, -4));
  const leather = std({ color: 0x43200f, roughness: 0.34, metalness: 0.0 });
  const rail = flat(new THREE.Mesh(
    new THREE.ExtrudeGeometry(railShape, { depth: 6, bevelEnabled: true, bevelThickness: 14, bevelSize: 14, bevelSegments: 6, curveSegments: 72 }), leather), 0);
  rail.castShadow = true; rail.receiveShadow = true;
  scene.add(rail);
  // Thin brass line where the rail meets the wood.
  const brass = std({ color: 0xd2a850, roughness: 0.28, metalness: 0.85 });
  const trimShape = tableShape(W, H, 82);
  trimShape.holes.push(tableShape(W, H, 60));
  scene.add(flat(new THREE.Mesh(new THREE.ExtrudeGeometry(trimShape, { depth: 7, bevelEnabled: false, curveSegments: 72 }), brass), -7));
  // Wooden table body.
  const woodTex = canvasTexture(256, 256, woodGrain('#6a3518', '#2c1206', '#a05a2c', 3), [1 / 320, 1 / 320]);
  const wood = std({ map: woodTex, color: 0xffffff, roughness: 0.48, metalness: 0.05 });
  const body = flat(new THREE.Mesh(new THREE.ExtrudeGeometry(tableShape(W, H, 78), { depth: 84, bevelEnabled: true, bevelThickness: 6, bevelSize: 6, bevelSegments: 2, curveSegments: 72 }), wood), -97);
  body.castShadow = true; body.receiveShadow = true;
  scene.add(body);

  // Pedestal legs.
  const darkWood = std({ color: 0x2a1509, roughness: 0.5, metalness: 0.1 });
  for (const x of [-W * 0.27, W * 0.27]) {
    add(new THREE.Mesh(new THREE.CylinderGeometry(40, 58, -FLOOR - 97, 10), darkWood), x, (FLOOR - 97) / 2, -H * 0.04, true, false);
    add(new THREE.Mesh(new THREE.CylinderGeometry(120, 150, 22, 12), darkWood), x, FLOOR + 11, -H * 0.04, true, true);
    add(new THREE.Mesh(new THREE.TorusGeometry(47, 5, 6, 16), brass), x, FLOOR + 120, -H * 0.04).rotation.x = Math.PI / 2;
  }

  // Floor, rug, walls and ceiling.
  const floor = flat(new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), lam({ map: canvasTexture(256, 256, boards, [14, 14]) })), FLOOR);
  floor.receiveShadow = true;
  scene.add(floor);
  const rugR = Math.max(W, H) * 0.5 + 620;
  const rug = flat(new THREE.Mesh(new THREE.CircleGeometry(rugR, 48), lam({ map: canvasTexture(512, 512, rugArt), transparent: true })), FLOOR + 2);
  rug.receiveShadow = true;
  scene.add(rug);
  const wallMat = lam({ map: canvasTexture(512, 512, wallArt, [5, 1]) });
  const wallH = CEIL - FLOOR;
  for (let i = 0; i < 4; i++) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, wallH), wallMat);
    const a = (i * Math.PI) / 2;
    wall.position.set(-Math.sin(a) * HALF, FLOOR + wallH / 2, -Math.cos(a) * HALF);
    wall.rotation.y = a;
    scene.add(wall);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshBasicMaterial({ color: 0x0c0706 }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = CEIL;
  scene.add(ceiling);
  // Ceiling beams.
  for (const z of [-1800, -600, 600, 1800]) add(new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, 90, 130), lam({ color: 0x24120a })), 0, CEIL - 45, z);

  // Lamp over the table.
  const lampY = 1180;
  const lampShade = add(new THREE.Mesh(new THREE.CylinderGeometry(90, 330, 170, 12, 1, true),
    lam({ color: 0x0f4a30, side: THREE.DoubleSide, emissive: 0x06170f })), 0, lampY, 0);
  lampShade.castShadow = false;
  add(new THREE.Mesh(new THREE.TorusGeometry(330, 7, 6, 24), brass), 0, lampY - 85, 0).rotation.x = Math.PI / 2;
  add(new THREE.Mesh(new THREE.CircleGeometry(300, 24), new THREE.MeshBasicMaterial({ color: 0xfff0c4, side: THREE.DoubleSide })), 0, lampY - 30, 0).rotation.x = Math.PI / 2;
  add(new THREE.Mesh(new THREE.CylinderGeometry(92, 92, 16, 12), brass), 0, lampY + 90, 0);
  add(new THREE.Mesh(new THREE.CylinderGeometry(5, 5, CEIL - lampY - 90, 6), darkWood), 0, (CEIL + lampY + 90) / 2, 0);
  const glowTex = canvasTexture(128, 128, glowDot);
  const glowSprite = (x, y, z, s, op) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: op, blending: THREE.AdditiveBlending })); sp.position.set(x, y, z); sp.scale.set(s, s, 1); scene.add(sp); return sp; };
  glowSprite(0, lampY - 60, 0, 900, 0.5);

  const spot = new THREE.SpotLight(0xffe2ad, 2.5, 5200, 0.98, 0.85, 1);
  spot.position.set(0, lampY - 40, 0);
  spot.target.position.set(0, 0, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 300; spot.shadow.camera.far = 2400;
  spot.shadow.bias = -0.0012;
  spot.shadow.radius = 5;
  scene.add(spot, spot.target);
  scene.add(new THREE.HemisphereLight(0x8a6a52, 0x1c0d08, 0.62));

  // Bar along the wall behind the dealer: counter, lit shelves and bottles.
  {
    const z = -HALF + 150, barW = 2400;
    add(new THREE.Mesh(new THREE.BoxGeometry(barW, 400, 230), wood), 0, FLOOR + 200, z + 330, true, true);
    add(new THREE.Mesh(new THREE.BoxGeometry(barW + 60, 26, 290), darkWood), 0, FLOOR + 413, z + 330, true, true);
    add(new THREE.Mesh(new THREE.BoxGeometry(barW + 60, 10, 12), brass), 0, FLOOR + 395, z + 478);
    add(new THREE.Mesh(new THREE.BoxGeometry(barW, 1250, 60), darkWood), 0, FLOOR + 1125, z - 110);
    add(new THREE.Mesh(new THREE.PlaneGeometry(barW - 120, 1010), new THREE.MeshBasicMaterial({ color: 0xc98a3a })), 0, FLOOR + 1125, z - 78);
    const r = rng(42);
    const cols = [0x2f6b3a, 0x7a3b12, 0xc9a04a, 0x8c1d24, 0x1d4f6b, 0xd8d2c0, 0x4a2a5e];
    for (let row = 0; row < 3; row++) {
      const y = FLOOR + 720 + row * 320;
      add(new THREE.Mesh(new THREE.BoxGeometry(barW - 80, 22, 150), darkWood), 0, y, z - 20);
      for (let x = -barW / 2 + 120; x < barW / 2 - 100; x += 74 + r() * 40) {
        if (r() < 0.14) continue;
        const hgt = 110 + r() * 90, rad = 20 + r() * 9;
        const mat = lam({ color: cols[Math.floor(r() * cols.length)] });
        add(new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, hgt, 7), mat), x, y + 11 + hgt / 2, z - 20 + (r() - 0.5) * 40);
        add(new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.32, rad * 0.5, hgt * 0.4, 6), mat), x, y + 11 + hgt * 1.2, z - 20);
      }
    }
    for (const x of [-800, -270, 270, 800]) { // bar stools
      add(new THREE.Mesh(new THREE.CylinderGeometry(62, 56, 26, 10), leather), x, FLOOR + 330, z + 600, true);
      add(new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 320, 6), brass), x, FLOOR + 160, z + 600, true);
      add(new THREE.Mesh(new THREE.CylinderGeometry(58, 64, 12, 10), brass), x, FLOOR + 6, z + 600);
    }
    const l = new THREE.PointLight(0xffb060, 0.9, 3000, 1.6);
    l.position.set(0, FLOOR + 1100, z + 420);
    scene.add(l);
  }
  // Framed pictures and wall lights on the other walls.
  {
    const frameMat = std({ color: 0xb8923f, roughness: 0.35, metalness: 0.7 });
    const hang = (kind, w, h, a, along, y) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w + 50, h + 50, 24), frameMat));
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lam({ map: canvasTexture(256, 192, pictureArt(kind)) }));
      pic.position.z = 13; g.add(pic);
      g.position.set(-Math.sin(a) * (HALF - 14) + Math.cos(a) * along, y, -Math.cos(a) * (HALF - 14) - Math.sin(a) * along);
      g.rotation.y = a;
      scene.add(g);
    };
    hang(0, 560, 400, Math.PI / 2, -900, 780); hang(1, 420, 520, Math.PI / 2, 700, 800);
    hang(2, 420, 520, -Math.PI / 2, -700, 800); hang(3, 560, 400, -Math.PI / 2, 900, 780);
    hang(1, 640, 420, Math.PI, 1300, 780); hang(0, 640, 420, Math.PI, -1300, 780);
    // A door behind the player's side.
    add(new THREE.Mesh(new THREE.BoxGeometry(520, 1180, 20), darkWood), 0, FLOOR + 590, HALF - 10);
    add(new THREE.Mesh(new THREE.BoxGeometry(440, 1090, 26), wood), 0, FLOOR + 575, HALF - 12);
    add(new THREE.Mesh(new THREE.SphereGeometry(18, 8, 6), brass), 160, FLOOR + 520, HALF - 36);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    for (const [x, z] of [[-HALF + 40, 0], [HALF - 40, 0], [-1000, HALF - 40], [1000, HALF - 40], [-HALF + 40, -1800], [HALF - 40, -1800], [-HALF + 40, 1800], [HALF - 40, 1800]]) {
      add(new THREE.Mesh(new THREE.ConeGeometry(46, 90, 6, 1, true), bulbMat), x, 1080, z);
      add(new THREE.Mesh(new THREE.BoxGeometry(24, 120, 24), brass), x, 1000, z);
      glowSprite(x * 0.985, 1090, z * 0.985, 620, 0.55);
    }
    for (const [x, z] of [[-HALF + 500, 600], [HALF - 500, 600]]) { const l = new THREE.PointLight(0xffb673, 0.55, 3400, 1.5); l.position.set(x, 1000, z); scene.add(l); }
    // Plants in the corners by the door.
    const pot = lam({ color: 0x6b3a1e }), leaf = lam({ color: 0x2c6b3d, flatShading: true });
    for (const x of [-HALF + 330, HALF - 330]) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(120, 90, 220, 8), pot), x, FLOOR + 110, HALF - 330, true);
      for (let i = 0; i < 5; i++) {
        const c = add(new THREE.Mesh(new THREE.ConeGeometry(70 + i * 12, 520 - i * 50, 5), leaf), x + Math.sin(i * 2.4) * 60, FLOOR + 420 - i * 10, HALF - 330 + Math.cos(i * 2.4) * 60, true);
        c.rotation.set(Math.cos(i * 2.4) * 0.35, i, -Math.sin(i * 2.4) * 0.35);
      }
    }
  }

  // ---------- People ----------
  const U = phone ? 0.62 : 1; // people at the small phone table are drawn smaller
  const people = new THREE.Group();
  scene.add(people);
  const trousers = lam({ color: 0x1d1f26, flatShading: true });
  const stoolLeather = lam({ color: 0x5a1a1e, flatShading: true });
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
      g.font = '700 58px system-ui, "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      const tw = Math.min(w - 56, g.measureText(text).width);
      const bw = tw + 56, x0 = (w - bw) / 2;
      g.fillStyle = 'rgba(10,12,16,.82)'; g.strokeStyle = 'rgba(232,196,106,.85)'; g.lineWidth = 4;
      g.beginPath(); g.roundRect(x0, 18, bw, h - 36, 40); g.fill(); g.stroke();
      g.fillStyle = '#fff6dc'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 3, w - 56);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(250, 62.5, 1);
    sp.renderOrder = 5;
    return sp;
  }
  // One person. Everyone has the same friendly body; only skin, hair and shirt colour differ.
  // The figure's own space: table top at y = 0, the table straight ahead along +z.
  function makeFigure(p, standing) {
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
      const sh = [s * 92, 66 + up, 0], el = [s * 112, 4 + up * 0.4, 52], ha = [s * 52, 52, 128];
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
    g.userData = { arms, label, reach: 0 };
    return g;
  }
  function disposeTree(o) {
    o.traverse((c) => { if (c.isSprite) { c.material.map?.dispose(); c.material.dispose(); } else if (c.geometry?.type === 'TorusGeometry') c.geometry.dispose(); else if (c.material && c.material !== trousers && c.material !== stoolLeather && c.material !== brass) c.material.dispose?.(); });
  }

  let peopleKey = '', figs = new Map(), stoolGroup = null, myFig = null, myStool = null, sidePts = [];
  function setPeople(list = [], stools = null) {
    const n = list[0]?.seats || stools?.length || 0;
    const spotsOf = stools || Array.from({ length: n }, (_, i) => ({ seat: i }));
    const key = JSON.stringify([list.map((p) => [p.id, p.seat, p.look?.skin, p.look?.hair, p.look?.flag, p.name, !!p.isMe, !!p.isDealer, p.x, p.y]), spotsOf.map((s) => [s.seat, s.x, s.y])]);
    if (key !== peopleKey) {
      peopleKey = key;
      const oldBets = new Map([...figs].map(([id, f]) => [id, f.userData.bet]));
      disposeTree(people); people.clear(); figs = new Map(); myFig = null; myStool = null; sidePts = [];
      const place = (s) => (s.x !== undefined && s.y !== undefined ? edgeAt(s.x, s.y) : edgeForSeat(s.seat, n));
      const pts = spotsOf.map(place);
      // When the seats are close together everyone is drawn a little smaller.
      let gap = Infinity;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) gap = Math.min(gap, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
      const sc = U * Math.max(0.62, Math.min(1, gap / (235 * U)));
      const out = 62 + 92 * sc;
      const mine = list.find((p) => p.isMe && !p.isDealer);
      stoolGroup = new THREE.Group();
      spotsOf.forEach((s, i) => {
        const e = pts[i], st = makeStool(sc);
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
        const f = makeFigure(p, standing);
        const fs = standing ? U : sc;
        f.scale.setScalar(fs);
        const d = standing ? 62 + 100 * fs : out;
        f.position.set(e.x + e.nx * d, 0, e.z + e.nz * d);
        f.rotation.y = Math.atan2(-e.nx, -e.nz);
        f.userData.bet = oldBets.has(p.id) ? oldBets.get(p.id) : (p.bet || 0);
        people.add(f);
        figs.set(p.id, f);
        if (p.isMe) myFig = f;
      }
      touch();
    }
    // A short reach towards the betting circle when someone's bet changes.
    for (const p of list) {
      const f = figs.get(p.id);
      if (!f || p.bet === undefined) continue;
      if (f.userData.bet !== p.bet) { f.userData.bet = p.bet; f.userData.reach = 1; touch(); }
    }
  }

  // ---------- Camera ----------
  const CENTRE = new THREE.Vector3(0, -10, 0);
  const cur = { theta: 0, phi: 0.9, r: 1400, yaw: 0, pitch: 0, t: CENTRE.clone() };
  const goal = { theta: 0, phi: 0.9, r: 1400, yaw: 0, pitch: 0, t: CENTRE.clone() };
  let side = 'player', seated = true, rate = 14, homeFit = null, hudReserve = 0;
  const PHI_MAX = 1.36, YAW_MAX = 2.25;
  const outline = tableShape(W, H, 66).getPoints(10).map((p) => new THREE.Vector3(p.x, 24, -p.y));
  const probe = new THREE.PerspectiveCamera();
  const tmp = new THREE.Vector3();

  function posFor(s, out) {
    const sp = Math.sin(s.phi);
    return out.set(s.t.x + s.r * sp * Math.sin(s.theta), s.t.y + s.r * Math.cos(s.phi), s.t.z + s.r * sp * Math.cos(s.theta));
  }
  // The first-person seat view: as close as the screen allows with the whole table in sight, the dealer
  // at the top and your own cards just above the buttons at the bottom of the screen.
  function fitHome() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    const sgn = side === 'dealer' ? -1 : 1;
    const bottom = 1 - (2 * Math.min(hudReserve, h * 0.42) + 16) / h; // lowest the table may reach, in screen units (-1 bottom, 1 top)
    const topMax = 1 - 2 * Math.min(70, h * 0.1) / h, sideMax = 1 - 16 / w;
    probe.fov = camera.fov; probe.aspect = w / h; probe.near = 10; probe.far = 12000; probe.updateProjectionMatrix();
    const box = (phi, r, tz) => {
      probe.position.set(0, r * Math.cos(phi), sgn * (tz + r * Math.sin(phi)));
      probe.lookAt(0, 0, sgn * tz);
      probe.updateMatrixWorld();
      let lo = Infinity, hi = -Infinity, sd = 0;
      for (const p of outline) { tmp.copy(p).project(probe); lo = Math.min(lo, tmp.y); hi = Math.max(hi, tmp.y); sd = Math.max(sd, Math.abs(tmp.x)); }
      return { lo, hi, sd };
    };
    let best = null;
    // Start low, like sitting at the table, and look from higher only when the screen is tall and narrow.
    for (let phi = 0.96; phi >= 0.34; phi -= 0.07) {
      let rLo = 300, rHi = 9000, tzAt = 0;
      for (let i = 0; i < 16; i++) {
        const r = (rLo + rHi) / 2;
        let a = -H * 1.5, b = H * 1.5;
        for (let j = 0; j < 14; j++) { const m = (a + b) / 2; if (box(phi, r, m).lo < bottom) a = m; else b = m; }
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
  const rMax = () => Math.min(HALF - 250, Math.max(homeFit.r * 1.7, 2300));
  function clampGoal() {
    if (seated) {
      goal.r = Math.min(homeFit.r, Math.max(homeFit.r * 0.55, goal.r));
      goal.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, goal.yaw));
      goal.pitch = Math.max(-0.45, Math.min(0.85, goal.pitch));
    } else {
      goal.r = Math.min(rMax(), Math.max(rMin(), goal.r));
      // Stay below the ceiling and clear of the lamp, and never drop to the height of the table top.
      const phiMin = Math.max(0.5, Math.acos(Math.min(1, (CEIL - 220) / goal.r)));
      goal.phi = Math.max(phiMin, Math.min(PHI_MAX, goal.phi));
    }
  }
  function zoom(f) {
    rate = 12;
    if (seated && f > 1 && goal.r * f > homeFit.r * 1.01) standUp();
    goal.r *= f;
    clampGoal(); touch();
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
    let yaw = dir * 1.15, pitch = 0.12;
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
  let drag = null, pinch = 0;
  const interactive = 'button, a, input, select, textarea, label, [data-act], [data-throw-at], [data-vote]';
  container.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest(interactive)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; }
  });
  container.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) { zoom(Math.max(0.8, Math.min(1.25, pinch / d))); pinch = d; }
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
    if (seated) { goal.yaw += dx * k * 1.5; goal.pitch += dy * k; }
    else { goal.theta -= dx * k * 1.6; goal.phi -= dy * k; }
    clampGoal(); touch();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
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
      const hh = hud.offsetHeight || 0;
      if (Math.abs(hh - hudReserve) < 6) return;
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
    camera.position.y = Math.max(90, Math.min(CEIL - 120, camera.position.y));
    camera.position.x = Math.max(-HALF + 160, Math.min(HALF - 160, camera.position.x));
    camera.position.z = Math.max(-HALF + 160, Math.min(HALF - 160, camera.position.z));
    tmp.copy(cur.t).sub(camera.position);
    const yaw0 = Math.atan2(-tmp.x, -tmp.z), pitch0 = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z));
    camera.rotation.set(Math.max(-1.5, Math.min(0.6, pitch0 + cur.pitch)), yaw0 + cur.yaw, 0, 'YXZ');
    // Your own figure is only drawn once you have left your chair.
    if (myFig) myFig.visible = !seated;
    if (myStool) myStool.visible = !seated;
    gl.render(scene, camera);
    css.render(scene, camera);
  };
  requestAnimationFrame(loop);

  return {
    setSide(s) { if (s !== side) { side = s; home(true); } },
    home: () => home(true),
    zoomBy(d) { zoom(d > 0 ? 0.86 : 1.16); },
    look,
    setPeople,
    setPixel(on) { pixelOn = !!on; applyPixel(); },
    // For checks and tests: where the camera is and how fast the room is drawing.
    info: () => ({ fps, seated, side, pos: camera.position.toArray().map(Math.round), yaw: cur.yaw, r: Math.round(cur.r), home: homeFit && Math.round(homeFit.r), people: figs.size }),
    stop() { running = false; },
  };
}
