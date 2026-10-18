// ROLEAGUE — Phases 1-3: 3D foundation, core gameplay, jump/dodge/boost/air control, ball camera.
// Coordinate system: X = across arena, Y = up, Z = along arena.
// Blue goal at -Z, orange goal at +Z. Car forward (local) = +Z; heading h -> forward (sin h, 0, cos h).
import * as THREE from 'three';

const STORAGE_KEY = 'roleague.settings.v1';
const CFG = { arenaW: 70, arenaL: 100, wallH: 22, chamfer: 10, goalW: 20, goalH: 8, goalD: 10, ballR: 2 };
const COL = { blue: 0x2e8bff, orange: 0xff7a1a, navy: 0x070b1a };
const QUALITY = { low: { pr: 1, shadow: 0 }, medium: { pr: 1.5, shadow: 1024 }, high: { pr: 2, shadow: 2048 } };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const $ = (id) => document.getElementById(id);

const log = {
  info: (...a) => { if (settings.debug) console.info('[Roleague]', ...a); },
  warn: (...a) => console.warn('[Roleague]', ...a),
  error: (...a) => console.error('[Roleague]', ...a),
};

function loadSettings() {
  const s = { quality: 'high', camDist: 11, debug: false };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (raw && typeof raw === 'object') {
      if (QUALITY[raw.quality]) s.quality = raw.quality;
      if (Number.isFinite(raw.camDist)) s.camDist = clamp(raw.camDist, 7, 18);
      s.debug = raw.debug === true;
    }
  } catch (err) { log.warn('Ignoring unreadable saved settings:', err); }
  try { if (new URLSearchParams(location.search).get('debug') === '1') s.debug = true; } catch (err) { log.warn('URL parse failed', err); }
  return s;
}
const settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  catch (err) { log.warn('Could not save settings:', err); }
}

function fatal(msg, err) {
  log.error(msg, err);
  const el = $('fatal-error');
  if (el) { el.hidden = false; $('fatal-message').textContent = msg; }
  const l = $('loading'); if (l) l.hidden = true;
}

// ---------- Procedural textures ----------
function makePitchTexture() {
  const W = 1024, H = Math.round(W * CFG.arenaL / CFG.arenaW), half = H / 2, ppu = W / CFG.arenaW;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let grad = g.createLinearGradient(0, 0, 0, half);
  grad.addColorStop(0, '#0b2a66'); grad.addColorStop(1, '#14409a');
  g.fillStyle = grad; g.fillRect(0, 0, W, half);
  grad = g.createLinearGradient(0, half, 0, H);
  grad.addColorStop(0, '#a04a10'); grad.addColorStop(1, '#6a2d08');
  g.fillStyle = grad; g.fillRect(0, half, W, half);
  g.fillStyle = 'rgba(255,255,255,0.04)';
  for (let i = 1; i < 20; i += 2) g.fillRect(0, i * H / 20, W, H / 20);
  g.fillStyle = 'rgba(46,139,255,0.20)'; g.fillRect((W - 36 * ppu) / 2, 6, 36 * ppu, 16 * ppu);
  g.fillStyle = 'rgba(255,122,26,0.20)'; g.fillRect((W - 36 * ppu) / 2, H - 6 - 16 * ppu, 36 * ppu, 16 * ppu);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5;
  g.strokeRect(6, 6, W - 12, H - 12);
  g.beginPath(); g.moveTo(0, half); g.lineTo(W, half); g.stroke();
  g.beginPath(); g.arc(W / 2, half, 10 * ppu, 0, Math.PI * 2); g.stroke();
  g.strokeRect((W - 36 * ppu) / 2, 6, 36 * ppu, 16 * ppu);
  g.strokeRect((W - 36 * ppu) / 2, H - 6 - 16 * ppu, 36 * ppu, 16 * ppu);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  const spot = (x, z) => { g.beginPath(); g.arc(W / 2 + x * ppu, (z + CFG.arenaL / 2) * ppu, 7, 0, Math.PI * 2); g.fill(); };
  spot(0, 0); spot(0, -28); spot(0, 28); spot(-14, -18); spot(14, -18); spot(-14, 18); spot(14, 18);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function makeCrowdTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#141a33'; g.fillRect(0, 0, 256, 128);
  const pal = ['#2e8bff', '#ff7a1a', '#e8eeff', '#8a97c0', '#4b5a9a', '#c9d4ff'];
  for (let i = 0; i < 700; i++) { g.fillStyle = pal[(Math.random() * pal.length) | 0]; g.fillRect(Math.random() * 256, Math.random() * 128, 3, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Arena ----------
function buildArena(scene) {
  const { arenaW: W, arenaL: L, chamfer: c, goalW, goalH, goalD, wallH } = CFG;
  const hw = W / 2, hl = L / 2;
  const root = new THREE.Group(); root.name = 'arena'; scene.add(root);
  const solids = [];
  const tag = (m) => { m.userData.solid = true; solids.push(m); return m; };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x05070f, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.1; root.add(ground);

  const P = [[-hw + c, -hl], [hw - c, -hl], [hw, -hl + c], [hw, hl - c], [hw - c, hl], [-hw + c, hl], [-hw, hl - c], [-hw, -hl + c]];
  const fg = new THREE.ShapeGeometry(new THREE.Shape(P.map(([x, z]) => new THREE.Vector2(x, -z))));
  const pos = fg.attributes.position, uv = fg.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + hw) / W, (pos.getY(i) + hl) / L);
  const floor = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: makePitchTexture(), roughness: 0.55, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; tag(floor); root.add(floor);

  const glass = new THREE.MeshStandardMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.16, roughness: 0.1, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const rail = (col) => new THREE.MeshStandardMaterial({ color: 0x0a1a3a, emissive: col, emissiveIntensity: 1.6 });
  const railB = rail(COL.blue), railO = rail(COL.orange), railN = rail(0x9fd8ff);
  const wallSeg = (x1, z1, x2, z2, y0, y1, mat, th = 0.6) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, th), mat);
    m.position.set((x1 + x2) / 2, (y0 + y1) / 2, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); root.add(m); return m;
  };
  const wallWithRails = (x1, z1, x2, z2, y0 = 0, railMat) => {
    tag(wallSeg(x1, z1, x2, z2, y0, wallH, glass));
    if (y0 === 0) tag(wallSeg(x1, z1, x2, z2, 0, 0.9, railMat, 0.9));
    wallSeg(x1, z1, x2, z2, wallH - 0.6, wallH, railMat, 0.9);
  };
  for (let i = 0; i < 8; i++) {
    if (i === 0 || i === 4) continue; // end walls (with goal openings) built below
    const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % 8], mz = (z1 + z2) / 2;
    wallWithRails(x1, z1, x2, z2, 0, mz < -8 ? railB : mz > 8 ? railO : railN);
  }
  const posts = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const net = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 });
  for (const s of [-1, 1]) {
    const col = s < 0 ? COL.blue : COL.orange, rm = s < 0 ? railB : railO, z = s * hl, zb = s * (hl + goalD), zm = s * (hl + goalD / 2);
    // end wall with an open goal mouth: two side pieces + lintel above the opening
    wallWithRails(-(hw - c), z, -goalW / 2, z, 0, rm);
    wallWithRails(goalW / 2, z, hw - c, z, 0, rm);
    tag(wallSeg(-goalW / 2, z, goalW / 2, z, goalH, wallH, glass));
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b1024, roughness: 0.8, emissive: col, emissiveIntensity: 0.15 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(goalW + 2, goalH + 1, 0.5), dark); back.position.set(0, (goalH + 1) / 2, zb); tag(back); root.add(back);
    for (const sx of [-1, 1]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(0.4, goalH, goalD), dark); sw.position.set(sx * (goalW / 2 + 0.2), goalH / 2, zm); tag(sw); root.add(sw); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(goalW + 0.8, 0.4, goalD), dark); roof.position.set(0, goalH + 0.2, zm); tag(roof); root.add(roof);
    const gf = new THREE.Mesh(new THREE.PlaneGeometry(goalW, goalD), new THREE.MeshStandardMaterial({ color: 0x0b1024, emissive: col, emissiveIntensity: 0.35, roughness: 0.6 }));
    gf.rotation.x = -Math.PI / 2; gf.position.set(0, 0.01, zm); gf.receiveShadow = true; tag(gf); root.add(gf);
    const pm = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.8 });
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, goalH, 12), pm); p.position.set(sx * goalW / 2, goalH / 2, z); p.castShadow = true; tag(p); root.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, goalW, 12), pm); bar.rotation.z = Math.PI / 2; bar.position.set(0, goalH, z); tag(bar); root.add(bar);
    // net-like geometry (back, sides, roof)
    const np = (w, h, x, y, zz, rx, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, Math.round(w / 1.2), Math.round(h / 1.2)), net); m.position.set(x, y, zz); m.rotation.set(rx, ry, 0); root.add(m); };
    np(goalW, goalH, 0, goalH / 2, zb - 0.3 * s, 0, 0);
    np(goalD, goalH, -goalW / 2 + 0.1, goalH / 2, zm, 0, Math.PI / 2); np(goalD, goalH, goalW / 2 - 0.1, goalH / 2, zm, 0, Math.PI / 2);
    np(goalW, goalD, 0, goalH - 0.1, zm, Math.PI / 2, 0);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(goalW, goalH), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    mouth.position.set(0, goalH / 2, z); root.add(mouth);
    const pl = new THREE.PointLight(col, 350, 45, 2); pl.position.set(0, goalH * 0.7, zm); root.add(pl);
  }
  return { root, solids };
}

function buildStands(scene) {
  const { arenaW: W, arenaL: L, goalD } = CFG, hw = W / 2, hl = L / 2;
  const crowd = makeCrowdTexture(), g = new THREE.Group(); g.name = 'stands';
  const mk = (sx, sy, sz, x, z) => {
    const t = crowd.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(Math.max(sx, sz) / 4)), Math.max(1, Math.round(sy / 3)));
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, color: 0xaab4d8 }));
    m.position.set(x, sy / 2, z); g.add(m);
  };
  for (let i = 0; i < 4; i++) {
    const h = 4 + i * 3.5, off = 8 + i * 4;
    for (const s of [-1, 1]) {
      mk(4, h, L + goalD * 2 + 16, s * (hw + off), 0);
      mk(2 * (hw + 4), h + 0.05, 4, 0, s * (hl + goalD + off));
    }
  }
  scene.add(g);
  const pm = new THREE.MeshStandardMaterial({ color: 0x1a2040, roughness: 0.8 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 2.5 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (hw + 26), z = sz * 38;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1, 38, 8), pm); pole.position.set(x, 19, z); g.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 3.5, 0.8), lamp); panel.position.set(x, 39, z); panel.lookAt(0, 10, 0); g.add(panel);
    const sp = new THREE.SpotLight(0xfff4e0, 6000, 140, 0.6, 0.6, 2); sp.position.set(x, 38, z); g.add(sp);
  }
  const n = 500, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.random() * 1.2 + 0.15;
    arr.set([Math.cos(th) * Math.sin(ph) * 420, Math.cos(ph) * 420, Math.sin(th) * Math.sin(ph) * 420], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.6, sizeAttenuation: false, fog: false })));
}

function buildLights(scene) {
  scene.add(new THREE.HemisphereLight(0x7f9bff, 0x101530, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(30, 80, 20);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 10, far: 220 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  scene.add(sun); return sun;
}

// ---------- Cars & ball ----------
function buildCar(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x10141f, metalness: 0.5, roughness: 0.5 });
  const glassM = new THREE.MeshStandardMaterial({ color: 0x0a1830, metalness: 0.9, roughness: 0.1 });
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffee, emissiveIntensity: 2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 2 });
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
  const B = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  add(B(2.2, 0.5, 4.4), paint, 0, 0.65, 0);
  add(B(2.1, 0.25, 4.3), dark, 0, 0.35, 0);
  add(B(2.0, 0.35, 1.6), paint, 0, 0.98, 1.3, 0.12);
  add(B(1.7, 0.5, 1.6), paint, 0, 1.2, -0.3);
  add(B(1.6, 0.45, 0.1), glassM, 0, 1.22, 0.55, -0.55);
  add(B(1.6, 0.4, 0.1), glassM, 0, 1.2, -1.15, 0.5);
  for (const sx of [-1, 1]) add(B(0.05, 0.35, 1.1), glassM, sx * 0.87, 1.22, -0.3);
  add(B(1.7, 0.1, 1.3), paint, 0, 1.5, -0.35);
  add(B(2.2, 0.3, 0.25), dark, 0, 0.5, 2.2);
  add(B(2.2, 0.3, 0.25), dark, 0, 0.5, -2.2);
  add(B(2.0, 0.1, 0.6), dark, 0, 1.5, -1.95);
  for (const sx of [-1, 1]) { add(B(0.1, 0.5, 0.2), dark, sx * 0.7, 1.2, -1.9); add(B(0.5, 0.2, 0.1), head, sx * 0.7, 0.78, 2.28); add(B(0.5, 0.15, 0.1), tail, sx * 0.7, 0.78, -2.28); }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 4.2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; g.add(glow);
  const wheels = [], tireGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 20), hubGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.44, 12), spokeGeo = B(0.46, 0.6, 0.1);
  const tire = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 }), hub = new THREE.MeshStandardMaterial({ color: 0xd0d8e8, metalness: 0.9, roughness: 0.3 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 1.15, 0.45, sz * 1.4);
    for (const [geo, mat] of [[tireGeo, tire], [hubGeo, hub]]) { const m = new THREE.Mesh(geo, mat); m.rotation.z = Math.PI / 2; m.castShadow = true; pivot.add(m); }
    const spoke = new THREE.Mesh(spokeGeo, dark); pivot.add(spoke);
    g.add(pivot); wheels.push(pivot);
  }
  const flame = new THREE.Group(); flame.position.set(0, 0.7, -2.2); flame.visible = false; g.add(flame);
  for (const [rad, len, col, op] of [[0.55, 3.2, 0xff7a1a, 0.55], [0.3, 2.0, 0xbfe9ff, 0.9]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, len, 12), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
    cone.rotation.x = -Math.PI / 2; cone.position.z = -len / 2; flame.add(cone); // base at car rear, tip pointing back
  }
  return { group: g, wheels, flame };
}

function buildBall() {
  const geo = new THREE.IcosahedronGeometry(CFG.ballR, 1); // non-indexed: per-face colours
  const n = geo.attributes.position.count, cols = new Float32Array(n * 3);
  for (let f = 0; f < n / 3; f++) {
    const dark = f % 4 === 0, v = dark ? 0.1 : 0.92;
    for (let k = 0; k < 3; k++) cols.set([v, v, dark ? 0.16 : 0.96], (f * 3 + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35, metalness: 0.2, emissive: 0x223355, emissiveIntensity: 0.25 }));
  mesh.castShadow = true;
  const blob = new THREE.Mesh(new THREE.CircleGeometry(CFG.ballR * 1.2, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  const group = new THREE.Group(); group.add(mesh);
  return { group, mesh, blob };
}

// ---------- Phase 2: physics & simulation ----------
const PH = { dt: 1 / 120, g: 14, carR: 2.1, hw: 1.1, hl: 2.2, top: 1.5, maxFwd: 28, maxRev: 14, accel: 22, revAccel: 18, brake: 48, roll: 6, grip: 10, driftGrip: 1.2, ballMax: 60, ballE: 0.6, wallE: 0.65, carMass: 4, ballMass: 1, jumpV: 7, jumpHold: 22, dodgeV: 14, flipDur: 0.5, airPitch: 3, airYaw: 1.8, maxBoost: 45, boostAccel: 30, airBoost: 18, boostUse: 33.3, boostRegen: 6 };
const SQ2 = Math.SQRT2, DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], NEUTRAL = { throttle: 0, steer: 0, handbrake: false, jump: false, boost: false };
const SPIN_AXIS = new THREE.Vector3(), SPIN_Q = new THREE.Quaternion(), Q = { nx: 0, ny: 0, nz: 0, pen: 0 };

const newCar = () => ({ x: 0, z: -28, h: 0, vx: 0, vz: 0, y: 0, vy: 0, pitch: 0, air: false, boost: 100, boosting: false, jumpHeld: false, holdT: 0, canDodge: false, dodged: false, jumpT: 0, flipT: 0, flipAxis: 'x', flipDir: 1 });
function createSim() {
  return { car: newCar(), ball: { x: 0, y: CFG.ballR, z: 0, vx: 0, vy: 0, vz: 0 },
    input: { throttle: 0, steer: 0, handbrake: false, jump: false, boost: false }, fs: 0, acc: 0, phase: 'play', phaseT: 0, goalSide: null, lockOnGoal: true, impact: 0, scoreBlue: 0, scoreOrange: 0 };
}
function resetBall(s) { Object.assign(s.ball, { x: 0, y: CFG.ballR, z: 0, vx: 0, vy: 0, vz: 0 }); s.phase = 'play'; s.phaseT = 0; }
function resetCar(s) { Object.assign(s.car, newCar()); s.fs = 0; }
function resetKickoff(s) { resetCar(s); resetBall(s); s.acc = 0; }
function isSane(s) { const c = s.car, b = s.ball; return [c.x, c.z, c.h, c.vx, c.vz, c.y, c.vy, c.pitch, c.boost, b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite); }

// Arcade car. Grounded: forward speed + lateral slip, speed-dependent steering, boost.
// Airborne: gravity, limited pitch/yaw control, boost thrust, one dodge per jump. Returns forward speed.
function stepCar(car, inp, dt) {
  const boostOn = !!inp.boost && car.boost > 0, jumpEdge = !!inp.jump && !car.jumpHeld;
  car.jumpHeld = !!inp.jump; car.boosting = boostOn;
  car.boost = clamp(car.boost + (boostOn ? -PH.boostUse : inp.boost ? 0 : PH.boostRegen) * dt, 0, 100); // no regen while Boost is held
  let s = Math.sin(car.h), c = Math.cos(car.h), fs;
  if (!car.air) {
    fs = car.vx * s + car.vz * c; let lat = car.vx * c - car.vz * s;
    if (inp.throttle > 0) fs += (fs < -0.5 ? PH.brake : PH.accel * (1 - 0.7 * clamp(fs / PH.maxFwd, 0, 1))) * dt;
    else if (inp.throttle < 0) fs -= (fs > 0.5 ? PH.brake : PH.revAccel) * dt;
    else { const d = PH.roll * dt; fs = Math.abs(fs) <= d ? 0 : fs - Math.sign(fs) * d; }
    if (boostOn) fs += PH.boostAccel * dt;
    else if (fs > PH.maxFwd) fs = Math.max(PH.maxFwd, fs - 25 * dt);
    fs = clamp(fs, -PH.maxRev, boostOn ? PH.maxBoost : Math.max(PH.maxFwd, fs));
    if (inp.handbrake) fs *= Math.exp(-0.5 * dt);
    lat *= Math.exp(-(inp.handbrake ? PH.driftGrip : PH.grip) * dt);
    const auth = clamp(Math.abs(fs) / 5, 0, 1) * (1 - 0.5 * clamp(Math.abs(fs) / PH.maxFwd, 0, 1));
    car.h -= inp.steer * 2.7 * auth * (fs >= 0 ? 1 : -1) * (inp.handbrake ? 1.5 : 1) * dt;
    s = Math.sin(car.h); c = Math.cos(car.h);
    car.vx = fs * s + lat * c; car.vz = fs * c - lat * s;
    car.pitch += (0 - car.pitch) * (1 - Math.exp(-12 * dt));
    if (jumpEdge) { car.vy = PH.jumpV; car.air = true; car.holdT = 0.25; car.canDodge = true; car.dodged = false; car.jumpT = 0; car.flipT = 0; }
  } else {
    car.jumpT += dt;
    if (inp.jump && car.holdT > 0 && !car.dodged) { car.vy += PH.jumpHold * dt; car.holdT -= dt; } else car.holdT = 0;
    if (jumpEdge && car.canDodge && !car.dodged && car.jumpT < 1.5) {
      const f = inp.throttle, sd = inp.steer, len = Math.hypot(f, sd);
      if (len === 0) car.vy = PH.jumpV;
      else {
        const nf = f / len, ns = sd / len;
        car.vx += (nf * s - ns * c) * PH.dodgeV; car.vz += (nf * c + ns * s) * PH.dodgeV; car.vy = Math.max(car.vy * 0.4, 2);
        car.flipAxis = Math.abs(nf) >= Math.abs(ns) ? 'x' : 'z'; car.flipDir = car.flipAxis === 'x' ? Math.sign(nf) : -Math.sign(ns); car.flipT = 0.001;
      }
      car.dodged = true; car.canDodge = false; car.holdT = 0;
    }
    if (car.flipT > 0) { car.flipT += dt; if (car.flipT >= PH.flipDur) car.flipT = 0; }
    else {
      car.pitch = clamp(car.pitch - inp.throttle * PH.airPitch * dt, -1.2, 1.2);
      car.h -= inp.steer * PH.airYaw * dt; s = Math.sin(car.h); c = Math.cos(car.h);
    }
    if (boostOn) { const cp = Math.cos(car.pitch); car.vx += s * cp * PH.airBoost * dt; car.vz += c * cp * PH.airBoost * dt; car.vy += Math.sin(car.pitch) * PH.airBoost * dt; }
    const hs = Math.hypot(car.vx, car.vz); if (hs > PH.maxBoost) { car.vx *= PH.maxBoost / hs; car.vz *= PH.maxBoost / hs; }
    car.vy = clamp(car.vy - PH.g * dt, -40, 40);
    car.y += car.vy * dt;
    if (car.y <= 0 && car.vy <= 0) { car.y = 0; car.vy = 0; car.air = false; car.canDodge = false; car.flipT = 0; }
    fs = car.vx * s + car.vz * c;
  }
  if (car.y > CFG.wallH - PH.top) { car.y = CFG.wallH - PH.top; if (car.vy > 0) car.vy = 0; }
  car.x += car.vx * dt; car.z += car.vz * dt;
  return fs;
}

// Keeps a sphere/circle inside the chamfered arena; end walls have an open goal mouth.
function arenaCollide(o, r, e, isBall) {
  const hw = CFG.arenaW / 2, hl = CFG.arenaL / 2, gw = CFG.goalW / 2, ceil = isBall ? CFG.goalH - r : CFG.goalH - PH.top;
  const sg = Math.sign(o.z) || 1;
  const refl = (nx, nz) => { const vn = o.vx * nx + o.vz * nz; if (vn > 0) { o.vx -= (1 + e) * vn * nx; o.vz -= (1 + e) * vn * nz; } };
  if (Math.abs(o.z) <= hl) {
    if (o.x > hw - r) { o.x = hw - r; refl(1, 0); } else if (o.x < r - hw) { o.x = r - hw; refl(-1, 0); }
    const lim = (hw + hl - CFG.chamfer) / SQ2 - r;
    for (let i = 0; i < 4; i++) {
      const sx = DIAG[i][0], sz = DIAG[i][1], d = (sx * o.x + sz * o.z) / SQ2;
      if (d > lim) { const p = d - lim; o.x -= sx / SQ2 * p; o.z -= sz / SQ2 * p; refl(sx / SQ2, sz / SQ2); }
    }
  }
  const az = Math.abs(o.z);
  if (az > hl - r && az <= hl) {
    const open = Math.abs(o.x) <= gw - r && o.y <= ceil;
    if (!open) { o.z = sg * (hl - r); refl(0, sg); }
  }
  if (Math.abs(o.z) > hl) {
    const lx = gw - r;
    if (o.x > lx) { o.x = lx; refl(1, 0); } else if (o.x < -lx) { o.x = -lx; refl(-1, 0); }
    const back = hl + CFG.goalD - r;
    if (Math.abs(o.z) > back) { o.z = sg * back; refl(0, sg); }
    if (o.y > ceil) { o.y = ceil; if (o.vy > 0) o.vy *= isBall ? -e : 0; }
  }
}

function stepBall(b, dt) {
  const r = CFG.ballR, drag = Math.exp(-0.03 * dt);
  b.vy -= PH.g * dt; b.vx *= drag; b.vy *= drag; b.vz *= drag;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.y < r) { b.y = r; if (b.vy < 0) { b.vy = -b.vy * PH.ballE; if (b.vy < 1.2) b.vy = 0; } }
  if (b.y > CFG.wallH - r) { b.y = CFG.wallH - r; if (b.vy > 0) b.vy *= -PH.wallE; }
  if (b.y <= r + 0.02 && b.vy <= 0.01) {
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) { const k = Math.max(0, sp - (2 + 0.12 * sp) * dt) / sp; b.vx *= k; b.vz *= k; }
  }
  arenaCollide(b, r, PH.wallE, true);
}

// Sphere vs car box. Fills Q (world normal pointing car -> ball, penetration depth).
function sphereBox(car, b, r) {
  const s = Math.sin(car.h), c = Math.cos(car.h), dx = b.x - car.x, dz = b.z - car.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c, ly = b.y - car.y;
  const ex = lx - clamp(lx, -PH.hw, PH.hw), ey = ly - clamp(ly, 0.1, PH.top), ez = lz - clamp(lz, -PH.hl, PH.hl);
  const d2 = ex * ex + ey * ey + ez * ez;
  if (d2 >= r * r) return false;
  let d = Math.sqrt(d2), nx = ex, ny = ey, nz = ez;
  if (d < 1e-6) { nx = 0; ny = 0; nz = lz >= 0 ? 1 : -1; d = 0; } else { nx /= d; ny /= d; nz /= d; }
  Q.nx = nx * c + nz * s; Q.nz = -nx * s + nz * c; Q.ny = ny; Q.pen = r - d;
  return true;
}
function ballCar(car, b) {
  if (!sphereBox(car, b, CFG.ballR)) return 0;
  b.x += Q.nx * Q.pen; b.y += Q.ny * Q.pen; b.z += Q.nz * Q.pen; // resolve overlap first
  const rel = (b.vx - car.vx) * Q.nx + b.vy * Q.ny + (b.vz - car.vz) * Q.nz;
  if (rel >= 0) return 0;
  const dv = -(1 + PH.ballE) * rel * PH.carMass / (PH.carMass + PH.ballMass) * 1.12 * (car.flipT > 0 ? 1.3 : 1);
  b.vx += Q.nx * dv; b.vz += Q.nz * dv; b.vy += Q.ny * dv + 0.15 * dv * (1 - Math.abs(Q.ny));
  const k = 0.5 * PH.ballMass / PH.carMass * dv; car.vx -= Q.nx * k; car.vz -= Q.nz * k;
  return -rel;
}
function physicsStep(s, dt) {
  s.acc += dt; let n = 0; const hl = CFG.arenaL / 2, r = CFG.ballR;
  while (s.acc >= PH.dt && n < 8) {
    s.acc -= PH.dt; n++;
    const inp = s.phase === 'goal' && s.lockOnGoal ? NEUTRAL : s.input;
    s.fs = stepCar(s.car, inp, PH.dt); arenaCollide(s.car, PH.carR, 0.2, false);
    stepBall(s.ball, PH.dt);
    const imp = ballCar(s.car, s.ball); if (imp > s.impact) s.impact = imp;
    const b = s.ball, sp = Math.hypot(b.vx, b.vy, b.vz);
    if (sp > PH.ballMax) { const k = PH.ballMax / sp; b.vx *= k; b.vy *= k; b.vz *= k; }
    arenaCollide(b, r, PH.wallE, true);
    if (sphereBox(s.car, b, r) && Q.pen > 0.05) { s.car.x -= Q.nx * Q.pen; s.car.z -= Q.nz * Q.pen; s.car.y = Math.max(0, s.car.y - Q.ny * Q.pen); if (Q.ny < -0.3) { s.car.vy = Math.max(s.car.vy, 0); s.car.air = s.car.y > 0; } arenaCollide(s.car, PH.carR, 0.2, false); }
    if (s.phase === 'play' && Math.abs(b.z) > hl + r) { s.goalSide = b.z > 0 ? 'blue' : 'orange'; s.phase = 'goal'; s.phaseT = 0; }
    if (!isSane(s)) { log.error('Non-finite physics state; resetting kickoff'); resetKickoff(s); }
  }
  if (n === 8) s.acc = 0;
}

// ---------- Game bootstrap ----------
const state = { mode: 'loading', kind: null, panel: null, ballCam: false };
let initialised = false, rafId = 0;

function init() {
  if (initialised) return; initialised = true;
  const canvas = $('game-canvas');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (err) { fatal('WebGL is unavailable or disabled in this browser, so the 3D arena cannot be drawn.', err); return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.navy); scene.fog = new THREE.Fog(COL.navy, 140, 420);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 700);

  let arena, sun, blue, orange, ball;
  try {
    sun = buildLights(scene); arena = buildArena(scene); buildStands(scene);
    blue = buildCar(COL.blue); orange = buildCar(COL.orange); ball = buildBall();
    scene.add(blue.group, orange.group, ball.group, ball.blob);
  } catch (err) { fatal('Failed to build the 3D scene: ' + (err && err.message), err); return; }

  const view = { pos: new THREE.Vector3(), look: new THREE.Vector3(), wantPos: new THREE.Vector3(), wantLook: new THREE.Vector3(), orbit: 0.6, yaw: 0, fwd: new THREE.Vector3() };

  function applyQuality() {
    const q = QUALITY[settings.quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    renderer.shadowMap.enabled = q.shadow > 0;
    if (q.shadow > 0) {
      if (sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    }
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    resize();
  }
  function resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  const sim = createSim(), keys = new Set(), GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  function placeCar(car, x, z, heading) { car.group.position.set(x, 0, z); car.group.rotation.set(0, heading, 0); }
  function layout() { placeCar(blue, -8, -6, 0.5); placeCar(orange, 9, 10, Math.PI + 0.4); ball.group.position.set(0, CFG.ballR, 0); ball.mesh.quaternion.identity(); }
  function updateScore() { $('score-blue').textContent = String(sim.scoreBlue); $('score-orange').textContent = String(sim.scoreOrange); }
  function banner(text, side) { const b = $('goal-banner'); b.hidden = !text; b.textContent = text || ''; b.className = side || ''; }
  let flameT = 0, hudB = -1, hudS = -1;
  function setCamLabel() { $('cam-mode').textContent = 'Camera: ' + (state.ballCam ? 'Ball' : 'Car') + ' (C)'; }
  function updateHud() {
    const b = Math.round(sim.car.boost), sp = Math.round(Math.hypot(sim.car.vx, sim.car.vy, sim.car.vz) * 3.6);
    if (b !== hudB) { hudB = b; $('boost-text').textContent = String(b); $('boost-fill').style.width = b + '%'; }
    if (sp !== hudS) { hudS = sp; $('speed').textContent = sp + ' km/h'; }
  }
  function syncVisuals(dt) {
    const c = sim.car, b = sim.ball;
    blue.group.position.set(c.x, c.y, c.z); blue.group.rotation.order = 'YXZ';
    let rx = -c.pitch, rz = 0;
    if (c.flipT > 0) { const a = Math.min(1, c.flipT / PH.flipDur) * Math.PI * 2 * c.flipDir; if (c.flipAxis === 'x') rx += a; else rz += a; }
    blue.group.rotation.set(rx, c.h, rz);
    blue.flame.visible = c.boosting;
    if (c.boosting) { flameT += dt * 40; blue.flame.scale.set(1, 1, 0.8 + 0.25 * Math.sin(flameT) + Math.min(1, Math.hypot(c.vx, c.vz) / PH.maxBoost) * 0.5); }
    const spin = sim.fs * dt / 0.45; for (const w of blue.wheels) w.rotation.x += spin;
    ball.group.position.set(b.x, b.y, b.z);
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.01 && dt > 0) { SPIN_AXIS.set(b.vz, 0, -b.vx).normalize(); SPIN_Q.setFromAxisAngle(SPIN_AXIS, sp * dt / CFG.ballR); ball.mesh.quaternion.premultiply(SPIN_Q); }
    ball.blob.material.opacity = 0.4 / (1 + Math.max(0, b.y - CFG.ballR) * 0.2);
  }
  function kickoff(full) { if (full) resetKickoff(sim); else resetBall(sim); banner(''); syncVisuals(0); }
  function setMode(mode, kind) {
    state.mode = mode; state.kind = kind || null; state.panel = null; keys.clear();
    document.body.dataset.state = mode;
    ['panel-controls', 'panel-settings'].forEach((id) => { const p = $(id); if (p) p.hidden = true; });
    sim.scoreBlue = 0; sim.scoreOrange = 0; sim.input.throttle = 0; sim.input.steer = 0; sim.input.handbrake = false; updateScore(); banner('');
    if (mode === 'game') {
      const play = kind === 'play'; sim.lockOnGoal = play;
      orange.group.visible = false; view.yaw = 0; state.ballCam = false; setCamLabel(); hudB = -1; hudS = -1; resetKickoff(sim); syncVisuals(0);
      $('scoreboard').hidden = !play; $('train-hint').hidden = play;
      $('preview-text').textContent = play ? 'Match — score in the orange goal (far end). No timer or opponent yet.' : 'Training — drive freely and hit the ball.';
    } else { orange.group.visible = true; blue.flame.visible = false; layout(); blue.wheels.forEach((w) => { w.rotation.x = 0; }); }
    log.info('Mode ->', mode, kind || '');
  }
  function openPanel(id) {
    closePanel(); const p = $(id); if (!p) return; p.hidden = false; state.panel = id;
    if (id === 'panel-settings') syncSettingsUI();
    const first = p.querySelector('button, select, input'); if (first && first.focus) first.focus();
  }
  function closePanel() { if (state.panel) { const p = $(state.panel); if (p) p.hidden = true; } state.panel = null; }
  function syncSettingsUI() {
    $('set-quality').value = settings.quality; $('set-camdist').value = String(settings.camDist);
    $('out-camdist').textContent = settings.camDist.toFixed(1); $('set-debug').checked = settings.debug;
  }
  function updateDebugVisibility() { $('debug').hidden = !settings.debug; }

  const actions = {
    play: () => setMode('game', 'play'), training: () => setMode('game', 'training'),
    controls: () => openPanel('panel-controls'), settings: () => openPanel('panel-settings'), 'close-panel': closePanel,
  };
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('[data-action]');
    const fn = btn && actions[btn.dataset.action]; if (fn) fn();
  });
  document.addEventListener('input', (e) => {
    const id = e.target && e.target.id;
    if (id === 'set-quality') { settings.quality = QUALITY[e.target.value] ? e.target.value : 'high'; applyQuality(); }
    else if (id === 'set-camdist') { settings.camDist = clamp(parseFloat(e.target.value) || 11, 7, 18); $('out-camdist').textContent = settings.camDist.toFixed(1); }
    else if (id === 'set-debug') { settings.debug = !!e.target.checked; updateDebugVisibility(); }
    else return;
    saveSettings();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { if (state.panel) closePanel(); else if (state.mode === 'game') setMode('menu'); return; }
    if (state.mode !== 'game') return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'KeyC' && !e.repeat) { state.ballCam = !state.ballCam; setCamLabel(); }
    if (state.kind === 'training' && !e.repeat) {
      if (e.code === 'KeyR') { resetBall(sim); syncVisuals(0); }
      else if (e.code === 'KeyT') { resetCar(sim); syncVisuals(0); }
    }
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); });
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
  window.addEventListener('resize', resize);

  function updateInput() {
    const k = (a, b) => keys.has(a) || keys.has(b), i = sim.input;
    i.throttle = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0);
    i.steer = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
    i.handbrake = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyX');
    i.jump = keys.has('Space'); i.boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  }
  function updateGame(dt) {
    if (sim.goalSide) {
      const side = sim.goalSide; sim.goalSide = null;
      if (state.kind === 'play') { if (side === 'blue') sim.scoreBlue++; else sim.scoreOrange++; updateScore(); banner('GOAL! ' + side.toUpperCase(), side); }
      log.info('Goal scored by', side, sim.scoreBlue + '-' + sim.scoreOrange);
    }
    if (sim.phase === 'goal') { sim.phaseT += dt; if (sim.phaseT >= (state.kind === 'play' ? 2.5 : 1.0)) kickoff(state.kind === 'play'); }
  }
  function updateCamera(dt, t) {
    let k = 1 - Math.exp(-4 * dt), fovT = 60;
    if (state.mode === 'game') {
      const c = sim.car, bl = sim.ball, d = ((c.h - view.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      view.yaw += d * (1 - Math.exp(-5 * dt));
      view.fwd.set(Math.sin(view.yaw), 0, Math.cos(view.yaw));
      if (state.ballCam) {
        let bx = c.x - bl.x, bz = c.z - bl.z; const len = Math.hypot(bx, bz);
        if (len < 2) { bx = -view.fwd.x; bz = -view.fwd.z; } else { bx /= len; bz /= len; }
        view.wantPos.set(c.x + bx * settings.camDist, settings.camDist * 0.45 + 1 + c.y * 0.6 + clamp(bl.y * 0.3, 0, 6), c.z + bz * settings.camDist);
        view.wantLook.set(c.x + (bl.x - c.x) * 0.65, 2 + bl.y * 0.6, c.z + (bl.z - c.z) * 0.65);
      } else {
        view.wantPos.set(c.x, 0, c.z).addScaledVector(view.fwd, -settings.camDist).setY(settings.camDist * 0.45 + 1 + c.y * 0.6);
        view.wantLook.set(c.x, 0, c.z).addScaledVector(view.fwd, 18).setY(2 + c.y * 0.5);
      }
      view.wantPos.x = clamp(view.wantPos.x, -CFG.arenaW / 2 - 3, CFG.arenaW / 2 + 3);
      view.wantPos.z = clamp(view.wantPos.z, -CFG.arenaL / 2 - CFG.goalD - 4, CFG.arenaL / 2 + CFG.goalD + 4);
      k = 1 - Math.exp(-8 * dt); fovT = 60 + (c.boosting ? 8 : 0) + clamp(Math.hypot(c.vx, c.vz) / PH.maxBoost, 0, 1) * 6;
    } else {
      view.orbit += dt * 0.07;
      view.wantPos.set(Math.sin(view.orbit) * 46, 26 + Math.sin(t * 0.2) * 3, Math.cos(view.orbit) * 70);
      view.wantLook.set(0, 4, 0);
    }
    view.pos.lerp(view.wantPos, k); view.look.lerp(view.wantLook, k);
    if (Math.abs(camera.fov - fovT) > 0.02) { camera.fov += (fovT - camera.fov) * (1 - Math.exp(-4 * dt)); camera.updateProjectionMatrix(); }
    camera.position.copy(view.pos); camera.lookAt(view.look);
  }

  settings.debug = settings.debug === true; updateDebugVisibility();
  applyQuality(); layout();
  updateCamera(1, 0); view.pos.copy(view.wantPos); view.look.copy(view.wantLook);

  let last = 0, fpsT = 0, fpsN = 0;
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016; last = now;
    const t = now / 1000;
    if (state.mode === 'game') { updateInput(); physicsStep(sim, dt); updateGame(dt); syncVisuals(dt); updateHud(); }
    else ball.mesh.rotation.y += dt * 0.5;
    ball.blob.position.set(ball.group.position.x, 0.04, ball.group.position.z);
    updateCamera(dt, t);
    renderer.render(scene, camera);
    if (settings.debug) {
      fpsT += dt; fpsN++;
      if (fpsT >= 0.5) {
        const r = renderer.info.render;
        $('debug').textContent = `${Math.round(fpsN / fpsT)} fps | calls ${r.calls} | tris ${r.triangles} | mode ${state.mode} | speed ${Math.abs(sim.fs).toFixed(1)}`;
        fpsT = 0; fpsN = 0;
      }
    }
  }
  if (!rafId) rafId = requestAnimationFrame(frame);

  window.Roleague = { THREE, scene, camera, renderer, arena, cars: { blue, orange }, ball, state, settings, CFG, PH, sim, physicsStep, resetKickoff, setMode };
  window.__roleagueReady = true;
  const l = $('loading'); if (l) l.hidden = true;
  setMode('menu');
  log.info('Game initialised');
}

try { init(); } catch (err) { fatal('Unexpected startup error: ' + (err && err.message), err); }
