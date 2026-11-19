// The 3D casino room. WebGL draws the room, the lamp and the padded table; the playing surface
// itself is the normal HTML felt, placed flat on the table with CSS 3D so every button still works.
// The felt sits behind the WebGL canvas, and a see-through "hole" in the WebGL picture shows it.
import * as THREE from '../lib/three.module.js';
import { OrbitControls } from '../lib/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from '../lib/CSS3DRenderer.js';

export function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

// Outline of the felt in table units (1 unit = 1 CSS pixel of the felt). The dealer's straight edge is at +y.
function tableShape(W, H, grow) {
  const s = new THREE.Shape();
  const top = H / 2 + grow, left = -W / 2 - grow, right = W / 2 + grow;
  const r = Math.max(4, 28 + grow);
  const cy = -H / 2 + 0.34 * H;
  const rx = W / 2 + grow, ry = 0.34 * H + grow;
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

// Casino carpet: deep red with a gold and teal pattern.
function carpet(g, w, h) {
  g.fillStyle = '#4a0d18'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) {
    const ox = (y / 64) % 2 ? 32 : 0;
    g.save(); g.translate(x + ox + 32, y + 32); g.rotate(Math.PI / 4);
    g.strokeStyle = 'rgba(232,180,80,.55)'; g.lineWidth = 3; g.strokeRect(-14, -14, 28, 28);
    g.fillStyle = 'rgba(20,90,90,.6)'; g.fillRect(-6, -6, 12, 12);
    g.restore();
    g.fillStyle = 'rgba(255,210,120,.35)'; g.beginPath(); g.arc(x + ox, y, 4, 0, Math.PI * 2); g.fill();
  }
}
// Walls: dark wood panels with a gold rail.
function panels(g, w, h) {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#1d0e08'); grd.addColorStop(1, '#3b1d10');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 128) {
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, 0, 4, h);
    g.strokeStyle = 'rgba(232,196,106,.18)'; g.lineWidth = 2; g.strokeRect(x + 20, h * 0.15, 88, h * 0.5);
  }
  g.fillStyle = 'rgba(232,196,106,.5)'; g.fillRect(0, h * 0.72, w, 5);
  g.fillStyle = '#140805'; g.fillRect(0, h * 0.74, w, h * 0.26);
}

export function initRoom(container, feltEl, { phone }) {
  const W = phone ? 560 : 1100, H = phone ? 700 : 820;
  feltEl.classList.add('in3d');
  feltEl.style.width = W + 'px';
  feltEl.style.height = H + 'px';

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x120806, 3500, 9000);
  const camera = new THREE.PerspectiveCamera(42, 1, 10, 20000);

  const css = new CSS3DRenderer();
  css.domElement.className = 'room-css';
  const gl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  gl.useLegacyLights = true;
  gl.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.domElement.className = 'room-gl';
  container.append(css.domElement, gl.domElement);

  // The HTML felt, lying flat on the table.
  const feltObj = new CSS3DObject(feltEl);
  feltObj.rotation.x = -Math.PI / 2;
  feltObj.position.y = 1;
  scene.add(feltObj);

  const flat = (mesh, y) => { mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; return mesh; };

  // See-through hole where the HTML felt shows.
  const hole = flat(new THREE.Mesh(new THREE.ShapeGeometry(tableShape(W, H, 0), 96),
    new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending, side: THREE.DoubleSide })), 1);
  scene.add(hole);

  // Padded leather rail around the felt.
  const railShape = tableShape(W, H, 62);
  railShape.holes.push(tableShape(W, H, -14));
  const rail = flat(new THREE.Mesh(
    new THREE.ExtrudeGeometry(railShape, { depth: 16, bevelEnabled: true, bevelThickness: 16, bevelSize: 12, bevelSegments: 8, curveSegments: 96 }),
    new THREE.MeshStandardMaterial({ color: 0x2a140b, roughness: 0.45, metalness: 0.05 })), 0);
  rail.castShadow = true; rail.receiveShadow = true;
  scene.add(rail);
  // Thin brass line where the rail meets the wood.
  const trimShape = tableShape(W, H, 80);
  trimShape.holes.push(tableShape(W, H, 60));
  scene.add(flat(new THREE.Mesh(new THREE.ExtrudeGeometry(trimShape, { depth: 6, bevelEnabled: false, curveSegments: 96 }),
    new THREE.MeshStandardMaterial({ color: 0xc9a04a, roughness: 0.3, metalness: 0.8 })), -6));
  // Wooden table body.
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a2e14, roughness: 0.55, metalness: 0.1 });
  const body = flat(new THREE.Mesh(new THREE.ExtrudeGeometry(tableShape(W, H, 78), { depth: 80, bevelEnabled: true, bevelThickness: 6, bevelSize: 6, bevelSegments: 3, curveSegments: 96 }), wood), -92);
  body.castShadow = true; body.receiveShadow = true;
  scene.add(body);

  // Pedestal legs and the floor.
  const FLOOR = -470;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.4, metalness: 0.6 });
  for (const x of [-W * 0.28, W * 0.28]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(46, 60, -FLOOR - 92, 32), metal);
    leg.position.set(x, (FLOOR - 92) / 2, -H * 0.05);
    leg.castShadow = true;
    scene.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(150, 170, 20, 40), metal);
    foot.position.set(x, FLOOR + 10, -H * 0.05);
    foot.receiveShadow = foot.castShadow = true;
    scene.add(foot);
  }
  const floor = flat(new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshStandardMaterial({ map: canvasTexture(256, 256, carpet, [36, 36]), roughness: 0.95 })), FLOOR);
  floor.receiveShadow = true;
  scene.add(floor);

  // Walls and ceiling.
  const wallTex = canvasTexture(1024, 512, panels, [6, 1]);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, side: THREE.BackSide });
  const room = new THREE.Mesh(new THREE.BoxGeometry(8000, 2600, 8000), [wallMat, wallMat,
    new THREE.MeshStandardMaterial({ color: 0x0b0605, side: THREE.BackSide }),
    new THREE.MeshStandardMaterial({ color: 0x0b0605, side: THREE.BackSide, transparent: true, opacity: 0 }), wallMat, wallMat]);
  room.position.y = FLOOR + 1300;
  scene.add(room);

  // Lamp over the table.
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(70, 300, 150, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0f3b26, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }));
  shade.position.y = 1050;
  scene.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
  bulb.position.y = 990;
  scene.add(bulb);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 700, 8), metal);
  cord.position.y = 1470;
  scene.add(cord);
  const spot = new THREE.SpotLight(0xffe7b8, 2.2, 4000, 0.62, 0.55, 1);
  spot.position.set(0, 1000, 0);
  spot.target.position.set(0, 0, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = -0.0005;
  scene.add(spot, spot.target);
  scene.add(new THREE.HemisphereLight(0x6a4a3a, 0x1a0806, 0.55));

  // Wall lights and some far-off tables, so the room feels like a casino floor.
  const glow = new THREE.MeshBasicMaterial({ color: 0xffc977 });
  for (const [x, z] of [[-3990, -2000], [-3990, 0], [-3990, 2000], [3990, -2000], [3990, 0], [3990, 2000], [-2000, -3990], [0, -3990], [2000, -3990], [-2000, 3990], [2000, 3990]]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(34, 16, 12), glow);
    s.position.set(x, FLOOR + 1400, z);
    scene.add(s);
    const l = new THREE.PointLight(0xffb259, 0.6, 2400, 2);
    l.position.copy(s.position);
    scene.add(l);
  }
  const farFelt = new THREE.MeshStandardMaterial({ color: 0x0c5a33, roughness: 0.9 });
  for (const [x, z, ry] of [[-2600, -2200, 0.4], [2600, -2200, -0.4], [-2900, 1800, 2.6], [2900, 1800, -2.6]]) {
    const t = new THREE.Group();
    const top = flat(new THREE.Mesh(new THREE.ShapeGeometry(tableShape(900, 650, 0), 48), farFelt), 0);
    const edge = flat(new THREE.Mesh(new THREE.ExtrudeGeometry(tableShape(900, 650, 50), { depth: 70, bevelEnabled: false, curveSegments: 48 }), wood), -72);
    t.add(top, edge);
    const lamp = new THREE.PointLight(0xfff0c0, 0.8, 1600, 2);
    lamp.position.y = 700;
    t.add(lamp);
    t.position.set(x, -2, z);
    t.rotation.y = ry;
    scene.add(t);
  }

  // Camera you can turn around the table and zoom with the scroll wheel.
  const controls = new OrbitControls(camera, container);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 250;
  controls.maxDistance = 3200;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.32;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;

  // Buttons and bets on the felt keep working: a press on them does not start turning the camera.
  feltEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input, select, [data-act], [data-throw-at], [data-vote]')) e.stopPropagation();
  });

  let side = 'player';
  function home(animate) {
    // First-person view from your own chair: eye level a little above the rail, looking at the dealer.
    const aspect = camera.aspect || 1;
    const halfW = W / 2 + 60;
    const fitDist = halfW / (Math.tan((camera.fov * Math.PI) / 360) * Math.min(aspect, 1.8));
    const seatZ = H / 2 + 400;
    const pz = Math.max(seatZ, fitDist * 0.8);
    const py = 520 + (pz - seatZ) * 0.6;
    const s = side === 'dealer' ? -1 : 1;
    const pos = new THREE.Vector3(0, py, s * pz);
    const target = new THREE.Vector3(0, -60, s * 150);
    if (!animate) { camera.position.copy(pos); controls.target.copy(target); controls.update(); return; }
    const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / 700), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(p0, pos, e);
      controls.target.lerpVectors(t0, target, e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    css.setSize(w, h);
    gl.setSize(w, h);
  }
  new ResizeObserver(resize).observe(container);
  // Focusing a button on the felt must never scroll the view sideways.
  for (const el of [container, css.domElement]) el.addEventListener('scroll', () => { el.scrollTop = 0; el.scrollLeft = 0; });
  resize();
  home(false);
  container.addEventListener('dblclick', (e) => { if (!e.target.closest('button, [data-act]')) home(true); });

  let running = true;
  const loop = () => {
    if (!running) return;
    controls.update();
    gl.render(scene, camera);
    css.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();

  return {
    setSide(s) { if (s !== side) { side = s; home(true); } },
    home: () => home(true),
    zoomBy(d) {
      const off = camera.position.clone().sub(controls.target);
      const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * (d > 0 ? 0.88 : 1.14)));
      camera.position.copy(controls.target).add(off.setLength(len));
    },
    stop() { running = false; },
  };
}
