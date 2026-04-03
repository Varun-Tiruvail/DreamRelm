/**
 * Pixel.Drift â€” 3D Racing Engine
 * Three.js r167 | No backend | DreamRealm Games
 */
"use strict";

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TRACK_HALF_WIDTH = 8;
const CAR_HALF_WIDTH   = 1.1;
// t-units per ms â€” tuned so max display = 360 km/h
const BASE_SPEED       = 0.000055;   // level-1 top speed (~90 km/h)
const SPEED_PER_LEVEL  = 0.0000022;
const MAX_SPEED        = 0.00026;    // absolute cap (~360 km/h display)
const KMH_SCALE        = 360;        // speedometer max label (km/h)
const STEER_TORQUE     = 18;         // lateral force (units/sÂ²)
const GRIP_NORMAL      = 0.88;       // lateral grip per frame (0â€“1)
const GRIP_DRIFT       = 0.12;       // handbrake grip â€” low = real sustained drift
const HP_MAX           = 100;
const HP_REGEN         = 3;          // HP regen per second
const LAPS_PER_LEVEL   = 3;
const WALL_BOUNCE      = 0.45;       // latVel reflection factor on wall hit
const WALL_DAMAGE      = 12;         // HP lost per wall collision

// â”€â”€â”€ Three.js Core â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('canvas-container').appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Lights (rebuilt per level for theming)
let sun, ambientLight;
function setupLights(theme) {
  if (sun) scene.remove(sun);
  if (ambientLight) scene.remove(ambientLight);
  const configs = {
    city:     { sun: 0xfff5e0, sunInt: 1.4, amb: 0x8090b0, ambInt: 0.6, pos: [150, 300, 100] },
    mountain: { sun: 0xe8f4ff, sunInt: 1.6, amb: 0x607090, ambInt: 0.5, pos: [-100, 400, 200] },
    river:    { sun: 0xffcc88, sunInt: 1.2, amb: 0x806040, ambInt: 0.7, pos: [200, 200, -100] },
  };
  const c = configs[theme] || configs.city;
  sun = new THREE.DirectionalLight(c.sun, c.sunInt);
  sun.position.set(...c.pos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far  = 1000;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -400;
  sun.shadow.camera.right = sun.shadow.camera.top  =  400;
  ambientLight = new THREE.AmbientLight(c.amb, c.ambInt);
  scene.add(sun, ambientLight);
}

// â”€â”€â”€ Game State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GAME = {
  state: 'MENU', // MENU | READY | PLAYING | PAUSED | LEVEL_COMPLETE | GAME_OVER
  mode: 'solo',
  level: 1,
  lap: 0,
  loopId: null,
  lastTime: 0,
  elapsed: 0,
  lapStartTime: 0,
  bestLap: Infinity,
};

// â”€â”€â”€ Player â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const player = {
  t: 0, latOffset: 0, speed: 0,
  latVel: 0,          // lateral velocity (units/ms) â€” drives real drift
  hp: HP_MAX, slowTimer: 0,
  worldPos: new THREE.Vector3(),
  tangent: new THREE.Vector3(0, 0, 1),
  mesh: null, wheels: [],
};

// â”€â”€â”€ AI Cars â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let aiCars = [];

// â”€â”€â”€ Track & World â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let curve, trackMesh, envGroup, obstacleList = [];
const trackGroup = new THREE.Group();
scene.add(trackGroup);

// â”€â”€â”€ Input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const keys = { forward: false, backward: false, left: false, right: false, handbrake: false };

document.addEventListener('keydown', e => {
  if (['ArrowUp','w','W'].includes(e.key))    { keys.forward   = true; tryStart(); }
  if (['ArrowDown','s','S'].includes(e.key))  { keys.backward  = true; }
  if (['ArrowLeft','a','A'].includes(e.key))  { keys.left      = true; tryStart(); }
  if (['ArrowRight','d','D'].includes(e.key)) { keys.right     = true; tryStart(); }
  if (e.key === ' ') { e.preventDefault(); keys.handbrake = true; } // Space = handbrake, no boost
  if (e.key === 'p' || e.key === 'P') togglePause();
});
document.addEventListener('keyup', e => {
  if (['ArrowUp','w','W'].includes(e.key))    keys.forward   = false;
  if (['ArrowDown','s','S'].includes(e.key))  keys.backward  = false;
  if (['ArrowLeft','a','A'].includes(e.key))  keys.left      = false;
  if (['ArrowRight','d','D'].includes(e.key)) keys.right     = false;
  if (e.key === ' ') keys.handbrake = false;
});

// Mobile d-pad
document.querySelectorAll('.dpad-btn').forEach(btn => {
  const act = btn.dataset.action;
  const press   = e => { e.preventDefault(); mobileInput(act, true);  tryStart(); };
  const release = e => { e.preventDefault(); mobileInput(act, false); };
  btn.addEventListener('touchstart', press,   { passive: false });
  btn.addEventListener('touchend',   release, { passive: false });
  btn.addEventListener('mousedown',  press);
  btn.addEventListener('mouseup',    release);
});

function mobileInput(act, on) {
  if (act === 'accel') keys.forward    = on;
  if (act === 'brake') keys.backward   = on;
  if (act === 'left')  keys.left       = on;
  if (act === 'right') keys.right      = on;
  if (act === 'boost') keys.handbrake  = on; // mobile BOOST button = handbrake drift
}

function tryStart() {
  if (GAME.state === 'READY') {
    GAME.state = 'PLAYING';
    GAME.lapStartTime = performance.now();
  }
}

// â”€â”€â”€ Track Generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function makeOval(rx, rz, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz));
  }
  return pts;
}

function generateTrackPoints(level) {
  if (level <= 5) {
    return makeOval(100, 55, 12);
  } else if (level <= 10) {
    const pts = makeOval(110, 60, 14);
    // Insert single chicane: offset 2 pts sideways
    pts[4] = pts[4].clone().add(new THREE.Vector3(22, 0, 0));
    pts[5] = pts[5].clone().add(new THREE.Vector3(-22, 0, 0));
    return pts;
  } else if (level <= 20) {
    // Two chicanes
    const pts = makeOval(120, 65, 16);
    pts[3] = pts[3].clone().add(new THREE.Vector3(28, 0, 0));
    pts[4] = pts[4].clone().add(new THREE.Vector3(-28, 0, 0));
    pts[10] = pts[10].clone().add(new THREE.Vector3(-28, 0, 0));
    pts[11] = pts[11].clone().add(new THREE.Vector3(28, 0, 0));
    return pts;
  } else if (level <= 30) {
    // Hairpin track
    return [
      new THREE.Vector3(0, 0, -70),
      new THREE.Vector3(50, 0, -90),
      new THREE.Vector3(110, 0, -70),
      new THREE.Vector3(140, 0, -20),
      new THREE.Vector3(140, 0, 40),  // hairpin
      new THREE.Vector3(110, 0, 70),
      new THREE.Vector3(40, 0, 85),
      new THREE.Vector3(-30, 0, 85),
      new THREE.Vector3(-90, 0, 60),
      new THREE.Vector3(-110, 0, 20), // chicane
      new THREE.Vector3(-130, 0, -20),
      new THREE.Vector3(-110, 0, -60),
      new THREE.Vector3(-60, 0, -85),
      new THREE.Vector3(-20, 0, -80),
    ];
  } else {
    // Full circuit with extra complexity
    return [
      new THREE.Vector3(0, 0, -80),
      new THREE.Vector3(60, 0, -100),
      new THREE.Vector3(120, 0, -80),
      new THREE.Vector3(155, 0, -30),
      new THREE.Vector3(155, 0, 30),
      new THREE.Vector3(120, 0, 70),
      new THREE.Vector3(50, 0, 90),
      new THREE.Vector3(20, 0, 60),   // inner chicane
      new THREE.Vector3(-20, 0, 50),
      new THREE.Vector3(-60, 0, 80),
      new THREE.Vector3(-110, 0, 70),
      new THREE.Vector3(-140, 0, 20),
      new THREE.Vector3(-140, 0, -30),
      new THREE.Vector3(-110, 0, -80),
      new THREE.Vector3(-50, 0, -95),
      new THREE.Vector3(-10, 0, -85),
    ];
  }
}

// â”€â”€â”€ Road Mesh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildRoadMesh(crv) {
  const N = 400;
  const verts = [], idx = [], uvs = [];
  const up = new THREE.Vector3(0, 1, 0);
  const edgePtsL = [], edgePtsR = [];

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const pt = crv.getPointAt(t);
    const tn = crv.getTangentAt(t).normalize();
    const rt = new THREE.Vector3().crossVectors(tn, up).normalize();
    const L = pt.clone().addScaledVector(rt, -TRACK_HALF_WIDTH);
    const R = pt.clone().addScaledVector(rt,  TRACK_HALF_WIDTH);
    verts.push(L.x, L.y, L.z, R.x, R.y, R.z);
    uvs.push(0, t * 8, 1, t * 8);
    if (i < N) {
      const b = i * 2;
      idx.push(b, b+2, b+1, b+1, b+2, b+3);
    }
    // Collect edge points for neon strip lights
    edgePtsL.push(L.x, L.y + 0.12, L.z);
    edgePtsR.push(R.x, R.y + 0.12, R.z);
  }
  // close loop
  const last = N * 2;
  idx.push(last, 0, last+1, last+1, 0, 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // Road material with canvas texture
  const tex = makeRoadTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  // Neon edge strip lights â€” teal/cyan glowing lines
  const neonMat = new THREE.LineBasicMaterial({ color: 0x06d6f0, linewidth: 2 });
  const geoL = new THREE.BufferGeometry();
  const geoR = new THREE.BufferGeometry();
  geoL.setAttribute('position', new THREE.Float32BufferAttribute(edgePtsL, 3));
  geoR.setAttribute('position', new THREE.Float32BufferAttribute(edgePtsR, 3));
  const lineL = new THREE.Line(geoL, neonMat);
  const lineR = new THREE.Line(geoR, neonMat);

  // Return a group so both road + neon go together
  const grp = new THREE.Group();
  grp.add(mesh, lineL, lineR);
  return grp;
}

function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const cx = c.getContext('2d');
  cx.fillStyle = '#1c1c1c';
  cx.fillRect(0, 0, 128, 512);
  // Center dashes
  cx.setLineDash([40, 40]);
  cx.strokeStyle = '#ffffff44';
  cx.lineWidth = 4;
  cx.beginPath(); cx.moveTo(64, 0); cx.lineTo(64, 512); cx.stroke();
  // Edge lines
  cx.setLineDash([]);
  cx.strokeStyle = '#ffffff99';
  cx.lineWidth = 6;
  cx.beginPath(); cx.moveTo(6, 0); cx.lineTo(6, 512); cx.stroke();
  cx.beginPath(); cx.moveTo(122, 0); cx.lineTo(122, 512); cx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buildGuardRails(crv) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6, roughness: 0.3 });
  const N = 120;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const t  = i / N;
    const t2 = (i + 1) / N;
    const p1 = crv.getPointAt(t);
    const p2 = crv.getPointAt(t2);
    const tn = crv.getTangentAt(t).normalize();
    const rt = new THREE.Vector3().crossVectors(tn, up).normalize();
    const segLen = p1.distanceTo(p2) + 0.1;
    [-1, 1].forEach(side => {
      const railPos = p1.clone().addScaledVector(rt, side * (TRACK_HALF_WIDTH + 0.5));
      const lookTarget = p2.clone().addScaledVector(rt, side * (TRACK_HALF_WIDTH + 0.5));
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, segLen + 0.2), mat);
      rail.position.copy(railPos);
      rail.position.y = 0.4;
      rail.lookAt(lookTarget.x, 0.4, lookTarget.z);
      rail.castShadow = true;
      group.add(rail);
    });
  }
  return group;
}

function buildStartLine(crv) {
  const pos = crv.getPointAt(0);
  const tn  = crv.getTangentAt(0).normalize();
  const up  = new THREE.Vector3(0, 1, 0);
  const rt  = new THREE.Vector3().crossVectors(tn, up).normalize();

  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const cx = c.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 4; y++) {
    cx.fillStyle = (x + y) % 2 === 0 ? '#fff' : '#000';
    cx.fillRect(x * 16, y * 16, 16, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2, 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(pos);
  mesh.position.y = 0.02;
  // rotate to align with track tangent (y-axis rotation after x-axis flip)
  const angle = Math.atan2(tn.x, tn.z);
  mesh.rotation.y = angle;
  return mesh;
}

// â”€â”€â”€ Environment Builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function rng(min, max) { return min + Math.random() * (max - min); }

function buildGround(color) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshStandardMaterial({ color, roughness: 1 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function makeTree(x, z, round = false) {
  const g = new THREE.Group();
  const h = rng(7, 16);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.7, h * 0.38, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a3010 })
  );
  trunk.position.y = h * 0.19;
  trunk.castShadow = true;
  g.add(trunk);
  const top = round
    ? new THREE.SphereGeometry(h * 0.32, 7, 5)
    : new THREE.ConeGeometry(h * 0.22, h * 0.68, 6);
  const leaf = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ color: round ? 0x1a7a28 : 0x145c18 }));
  leaf.position.y = round ? h * 0.68 : h * 0.74;
  leaf.castShadow = true;
  g.add(leaf);
  g.position.set(x, 0, z);
  return g;
}

function buildCityEnv() {
  const g = new THREE.Group();
  g.add(buildGround(0x1e1e2a));
  scene.background = new THREE.Color(0x6699cc);
  scene.fog = new THREE.Fog(0x6699cc, 180, 600);
  const bColors = [0x2a2a50, 0x3a3050, 0x1a2040, 0x35304a, 0x202842];
  for (let i = 0; i < 45; i++) {
    const w = rng(12, 32), h = rng(25, 90), d = rng(12, 32);
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: bColors[i % bColors.length], roughness: 0.8 })
    );
    const a = rng(0, Math.PI * 2), dist = rng(90, 260);
    b.position.set(Math.cos(a) * dist, h / 2, Math.sin(a) * dist);
    b.castShadow = true; b.receiveShadow = true;
    // windows (emissive overlay)
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(w - 1, h - 1, d - 1),
      new THREE.MeshStandardMaterial({ color: 0x88aaff, emissive: 0x334466, emissiveIntensity: 0.6, transparent: true, opacity: 0.15 })
    );
    b.add(win);
    g.add(b);
  }
  return g;
}

function buildMountainEnv() {
  const g = new THREE.Group();
  g.add(buildGround(0x4a3820));
  scene.background = new THREE.Color(0xadd8e6);
  scene.fog = new THREE.Fog(0xadd8e6, 200, 700);
  const mMat = new THREE.MeshStandardMaterial({ color: 0x6b5040, roughness: 1 });
  const sMat = new THREE.MeshStandardMaterial({ color: 0xe8eeff, roughness: 0.9 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng(-0.2, 0.2);
    const dist = rng(180, 380);
    const h = rng(70, 160), r = rng(35, 65);
    const mt = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), mMat);
    mt.position.set(Math.cos(a) * dist, h / 2, Math.sin(a) * dist);
    mt.castShadow = true; g.add(mt);
    const sc = new THREE.Mesh(new THREE.ConeGeometry(r * 0.28, h * 0.28, 7), sMat);
    sc.position.set(Math.cos(a) * dist, h * 0.86 + h / 2, Math.sin(a) * dist);
    g.add(sc);
    for (let j = 0; j < 4; j++) g.add(makeTree(Math.cos(a) * dist + rng(-35, 35), Math.sin(a) * dist + rng(-35, 35)));
  }
  return g;
}

function buildRiverEnv() {
  const g = new THREE.Group();
  g.add(buildGround(0x2a5a20));
  scene.background = new THREE.Color(0xffa050);
  scene.fog = new THREE.Fog(0xff8030, 150, 550);
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 900),
    new THREE.MeshStandardMaterial({ color: 0x1a5080, roughness: 0.05, metalness: 0.4 })
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(280, 0.05, 0);
  g.add(river);
  for (let i = 0; i < 35; i++) {
    const a = rng(0, Math.PI * 2), dist = rng(85, 280);
    g.add(makeTree(Math.cos(a) * dist, Math.sin(a) * dist, true));
  }
  return g;
}

function getTheme(level) {
  const t = ((level - 1) % 3);
  return t === 0 ? 'city' : t === 1 ? 'mountain' : 'river';
}

function buildEnvironment(level) {
  const theme = getTheme(level);
  setupLights(theme);
  if (theme === 'city')     return buildCityEnv();
  if (theme === 'mountain') return buildMountainEnv();
  return buildRiverEnv();
}

// â”€â”€â”€ Car Model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildCar(bodyColor) {
  const g = new THREE.Group();
  const bm = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.55, roughness: 0.28 });
  const gm = new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.55, roughness: 0.1 });
  const tm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });
  const rm = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2 });
  const hlm = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 2 });
  const tlm = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 1.5 });

  const add = (geo, mat, px, py, pz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(2.1, 0.44, 4.2), bm, 0, 0.34, 0);          // body
  add(new THREE.BoxGeometry(1.62, 0.42, 2.0), bm, 0, 0.78, -0.18);     // cabin
  add(new THREE.BoxGeometry(1.58, 0.36, 0.07), gm, 0, 0.78, 0.82);     // windscreen
  add(new THREE.BoxGeometry(1.58, 0.33, 0.07), gm, 0, 0.78, -1.2);     // rear glass
  add(new THREE.BoxGeometry(1.88, 0.09, 1.18), bm, 0, 0.6, 1.48);      // hood
  add(new THREE.BoxGeometry(2.05, 0.24, 0.24), bm, 0, 0.22, 2.24);     // front bumper
  add(new THREE.BoxGeometry(2.05, 0.24, 0.24), bm, 0, 0.22, -2.24);    // rear bumper
  add(new THREE.BoxGeometry(2.05, 0.07, 0.48), bm, 0, 1.0, -1.98);     // spoiler wing
  add(new THREE.BoxGeometry(0.07, 0.3, 0.07), bm, -0.7, 0.88, -1.98); // spoiler L
  add(new THREE.BoxGeometry(0.07, 0.3, 0.07), bm, 0.7, 0.88, -1.98);  // spoiler R
  [-0.62, 0.62].forEach(x => add(new THREE.BoxGeometry(0.38, 0.14, 0.05), hlm, x, 0.42, 2.38));
  [-0.62, 0.62].forEach(x => add(new THREE.BoxGeometry(0.44, 0.14, 0.05), tlm, x, 0.42, -2.38));

  const wheels = [];
  [[-1.07, 1.4], [1.07, 1.4], [-1.07, -1.4], [1.07, -1.4]].forEach(([wx, wz]) => {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), tm);
    tire.rotation.z = Math.PI / 2;
    wg.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.32, 5), rm);
    rim.rotation.z = Math.PI / 2;
    wg.add(rim);
    wg.position.set(wx, 0.42, wz);
    g.add(wg);
    wheels.push(wg);
  });

  return { mesh: g, wheels };
}

// â”€â”€â”€ Obstacles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildObstacleMesh(type) {
  if (type === 'ghost') {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.0, 0.18, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1.5, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = Math.PI / 2;
    return ring;
  }
  if (type === 'slow') {
    return new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0xcc8800, emissive: 0x996600, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 })
    );
  }
  // solid barrel
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 1.4, 10),
    new THREE.MeshStandardMaterial({ color: 0xff5500, roughness: 0.7 })
  );
  body.castShadow = true;
  g.add(body);
  [-0.35, 0.35].forEach(y => {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 }));
    band.position.y = y;
    g.add(band);
  });
  return g;
}

function spawnObstacles(crv, level) {
  const list = [];
  if (level <= 30) return list;
  const count = Math.min(3 + Math.floor((level - 30) * 0.4), 12);
  const types = ['ghost', 'ghost', 'ghost', 'slow', 'slow', 'solid'];
  for (let i = 0; i < count; i++) {
    const t = 0.1 + (i / count) * 0.88 + rng(-0.03, 0.03);
    const lat = rng(-TRACK_HALF_WIDTH * 0.6, TRACK_HALF_WIDTH * 0.6);
    const type = types[Math.floor(Math.random() * types.length)];
    const mesh = buildObstacleMesh(type);
    const up  = new THREE.Vector3(0, 1, 0);
    const pt  = crv.getPointAt(t);
    const tn  = crv.getTangentAt(t).normalize();
    const rt  = new THREE.Vector3().crossVectors(tn, up).normalize();
    mesh.position.copy(pt.clone().addScaledVector(rt, lat));
    mesh.position.y = type === 'ghost' ? 1.0 : type === 'slow' ? 0.04 : 0.7;
    trackGroup.add(mesh);
    list.push({ type, t, lat, mesh, cooldown: 0 });
  }
  return list;
}

// â”€â”€â”€ AI Cars â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const AI_COLORS = [0xff8800, 0x8800ff];
function buildAI(level, idx) {
  const carObj = buildCar(AI_COLORS[idx]);
  carObj.mesh.scale.setScalar(1.0);
  scene.add(carObj.mesh);
  return {
    mesh: carObj.mesh, wheels: carObj.wheels,
    t: -0.04 * (idx + 1), latOffset: (idx % 2 === 0 ? 2 : -2),
    speed: 0, targetLat: 0, targetLatTimer: 0,
    speedFactor: 0.88 + idx * 0.06,
    worldPos: new THREE.Vector3(),
  };
}

// â”€â”€â”€ Smooth Rotation State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _up         = new THREE.Vector3(0, 1, 0); // world-up vector
const _carQuat    = new THREE.Quaternion();
const _targetQuat = new THREE.Quaternion();
const _slerpBasis = new THREE.Matrix4();
let   _visualSlip = 0; // smoothed slip angle for body tilt (radians)

/**
 * alignMeshSmooth â€” car faces +Z which is the track tangent direction.
 * Body tilts visually based on lateral velocity (slip angle) for realism.
 */
function alignMeshSmooth(mesh, tangent, latVel, speed, dt) {
  // Car model faces +Z. Track tangent is +Z direction of travel.
  // right = tangent Ã— up, up2 = right Ã— tangent
  const rt  = new THREE.Vector3().crossVectors(tangent, _up).normalize();
  const up2 = new THREE.Vector3().crossVectors(rt, tangent).normalize();
  _slerpBasis.makeBasis(rt, up2, tangent); // +Z = tangent = forward âœ“
  _targetQuat.setFromRotationMatrix(_slerpBasis);

  // Slip angle: how much the car is sliding sideways relative to heading
  // Positive latVel = sliding right relative to track, tilt car body left
  const slipAngle = speed > 1e-6 ? Math.atan2(latVel, Math.abs(speed)) : 0;
  const slipTarget = Math.max(-0.28, Math.min(0.28, slipAngle * 1.4));
  _visualSlip += (slipTarget - _visualSlip) * Math.min(dt * 0.01, 0.3);

  // Apply slip as a yaw rotation around world-up
  if (Math.abs(_visualSlip) > 0.002) {
    const slipQuat = new THREE.Quaternion().setFromAxisAngle(_up, -_visualSlip);
    _targetQuat.multiply(slipQuat);
  }

  // Slerp toward target â€” fast enough to feel responsive, slow enough to be smooth
  const slerpSpeed = Math.min(1.0, dt * 0.016);
  _carQuat.slerp(_targetQuat, slerpSpeed);
  mesh.quaternion.copy(_carQuat);
}

// â”€â”€â”€ World Space Helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getWorldPos(t, lat, crv) {
  const ct = ((t % 1) + 1) % 1;
  const pt = crv.getPointAt(ct);
  const tn = crv.getTangentAt(ct).normalize();
  const rt = new THREE.Vector3().crossVectors(tn, _up).normalize();
  return pt.clone().addScaledVector(rt, lat);
}

// Instant-align for AI cars (background dressing, player uses smooth version)
function alignMesh(mesh, tangent) {
  const rt  = new THREE.Vector3().crossVectors(tangent, _up).normalize();
  const up2 = new THREE.Vector3().crossVectors(rt, tangent).normalize();
  const m4  = new THREE.Matrix4().makeBasis(rt, up2, tangent); // +Z = tangent = fwd
  mesh.quaternion.setFromRotationMatrix(m4);
}

// â”€â”€â”€ Tire Mark System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MARK_MAX  = 300; // max tire mark segments before recycling
const _markPool = [];  // { mesh, life }
let   _markPtr  = 0;
const _markMat  = new THREE.MeshBasicMaterial({
  color: 0x111111, transparent: true, opacity: 0.6, depthWrite: false,
});

function spawnTireMark(pos, tangent) {
  const rt   = new THREE.Vector3().crossVectors(tangent, _up).normalize();
  // two strips: left rear wheel, right rear wheel
  [-0.9, 0.9].forEach(side => {
    const center = pos.clone().addScaledVector(rt, side);
    center.y = 0.02;
    const geo = new THREE.PlaneGeometry(0.32, 0.55);
    geo.rotateX(-Math.PI / 2); // lay flat
    const mark = new THREE.Mesh(geo, _markMat.clone());
    mark.position.copy(center);
    // Align with tangent
    const m4 = new THREE.Matrix4().makeBasis(rt, _up, tangent);
    mark.setRotationFromMatrix(m4);
    mark.receiveShadow = false;
    scene.add(mark);
    const entry = { mesh: mark, life: 2800 }; // ms before fade
    if (_markPool.length < MARK_MAX) {
      _markPool.push(entry);
    } else {
      // Recycle oldest
      const old = _markPool[_markPtr];
      scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      _markPool[_markPtr] = entry;
      _markPtr = (_markPtr + 1) % MARK_MAX;
    }
  });
}

function updateTireMarks(dt) {
  for (let i = _markPool.length - 1; i >= 0; i--) {
    const m = _markPool[i];
    m.life -= dt;
    if (m.life <= 0) {
      scene.remove(m.mesh);
      m.mesh.geometry.dispose();
      _markPool.splice(i, 1);
    } else {
      m.mesh.material.opacity = Math.min(0.6, m.life / 1200) * 0.7;
    }
  }
}

let _lastMarkT = 0; // throttle mark spawning by track progress

// â”€â”€â”€ Physics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updatePlayer(dt) {
  const maxSpd = Math.min(BASE_SPEED + (GAME.level - 1) * SPEED_PER_LEVEL, MAX_SPEED);
  const slowFactor = player.slowTimer > 0 ? 0.55 : 1.0;

  // -- Longitudinal (speed along track) --
  // Uses lerp-to-target model with realistic feel:
  // - Quick throttle response, slower coast, fastest on braking
  // - Handbrake cuts forward traction by 40%
  const throttle = keys.forward ? 1 : 0;
  const braking  = keys.backward ? 1 : 0;
  const hb       = keys.handbrake;

  // Target speed for each input state
  const hbSpeedMult = hb ? 0.58 : 1.0;  // handbrake = 42% speed reduction
  const targetSpd = maxSpd * slowFactor * hbSpeedMult * (throttle ? 1 : (braking ? -0.3 : 0));

  // Lerp rate: fast throttle, medium coast, fast braking
  const lerpRate = throttle ? 0.05 : (braking ? 0.12 : 0.035);
  player.speed += (targetSpd - player.speed) * lerpRate;

  // Hard cap
  player.speed = Math.max(-maxSpd * 0.3, Math.min(player.speed, maxSpd * slowFactor));

  // Handbrake friction: scrub speed each frame (feels like screeching stop)
  if (hb) player.speed *= Math.pow(0.91, dt / 16.67);

  player.t += player.speed * dt;

  // â”€â”€ Lateral (Drift) Physics â”€â”€
  // Steering input applies lateral force proportional to speed (higher speed = more force)
  const steerInput  = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const speedRatio  = player.speed / maxSpd;                // 0â†’1

  // Steering force: moderate at low speed, strong at medium, reduces at very high speed
  const steerCurve  = speedRatio * (1 - speedRatio * 0.4);  // peaks around 60%
  const steerForce  = steerInput * STEER_TORQUE * steerCurve * (dt / 1000);

  // Apply lateral acceleration
  player.latVel += steerForce;

  // Grip / tire friction damps lateral velocity each frame
  // Handbrake = low grip = car keeps sliding sideways (REAL drift)
  const grip = hb ? GRIP_DRIFT : GRIP_NORMAL;
  const gripDecay = Math.pow(grip, dt / 16.67);             // frame-rate independent
  player.latVel *= gripDecay;

  // Integrate lateral velocity into position
  player.latOffset += player.latVel * dt;

  // â”€â”€ Wall Collision Handler â”€â”€
  // Instead of silently clamping, the wall bounces the car and deals damage
  const maxLat = TRACK_HALF_WIDTH - CAR_HALF_WIDTH;
  if (Math.abs(player.latOffset) > maxLat) {
    const wasOutside = player.latOffset;
    player.latOffset = Math.sign(player.latOffset) * maxLat;
    // Reflect lateral velocity (bounce)
    player.latVel = -player.latVel * WALL_BOUNCE;
    // Damage proportional to impact speed
    const impactSpeed = Math.abs(wasOutside - player.latOffset) * 80;
    if (impactSpeed > 0.5 && player.slowTimer <= 0) {
      player.hp -= WALL_DAMAGE * Math.min(impactSpeed / 4, 1.5);
      player.hp = Math.max(0, player.hp);
      shakeTimer = 300; shakeAmt = 0.22;
      showEffect('WALL HIT! âˆ’' + Math.round(WALL_DAMAGE) + ' HP', '#ff4400');
      if (player.hp <= 0) { updateHUD(); gameOver(); return; }
      updateHUD();
    }
  }

  // â”€â”€ World position â”€â”€
  player.worldPos = getWorldPos(player.t, player.latOffset, curve);
  player.worldPos.y = 0.56;

  const tn = curve.getTangentAt(((player.t % 1) + 1) % 1).normalize();
  player.tangent.copy(tn);
  player.mesh.position.copy(player.worldPos);

  // â”€â”€ Smooth car orientation with real slip angle â”€â”€
  alignMeshSmooth(player.mesh, tn, player.latVel, player.speed, dt);

  // â”€â”€ Wheel spin â”€â”€
  const wheelSpinRate = player.speed * dt * 70;
  player.wheels.forEach(w => { w.rotation.x += wheelSpinRate; });

  // â”€â”€ Tire marks during drift â”€â”€
  const isDrifting = hb && Math.abs(player.latVel) > 0.002;
  if (isDrifting) {
    const markStep = 0.0004; // spawn every ~400 track units
    if (player.t - _lastMarkT > markStep) {
      spawnTireMark(player.worldPos.clone(), tn);
      _lastMarkT = player.t;
    }
  }

  // Slow timer
  if (player.slowTimer > 0) player.slowTimer -= dt;

  // HP regen (only when not taking wall hits)
  if (player.hp < HP_MAX) player.hp = Math.min(HP_MAX, player.hp + HP_REGEN * dt / 1000);

  // Dynamic FOV: tunnel effect at speed
  camera.fov = 60 + speedRatio * 18;
  camera.updateProjectionMatrix();

  // Lap detection
  const prevLap = Math.floor(player.t - player.speed * dt);
  const currLap = Math.floor(player.t);
  if (currLap > prevLap && currLap > 0) {
    const now = performance.now();
    const lapTime = (now - GAME.lapStartTime) / 1000;
    GAME.lapStartTime = now;
    if (lapTime < GAME.bestLap) GAME.bestLap = lapTime;
    GAME.lap = currLap;
    if (GAME.lap >= LAPS_PER_LEVEL) { levelComplete(); return; }
    showEffect('âš¡ LAP ' + GAME.lap + ' / ' + LAPS_PER_LEVEL, '#06d6f0');
    updateHUD();
  }
}

function updateAI(ai, dt) {
  const maxSpd = Math.min(BASE_SPEED + (GAME.level - 1) * SPEED_PER_LEVEL, MAX_SPEED);
  // Rubber band: AI keeps up but cannot perfectly match player
  const gap = player.t - ai.t;
  const rb  = gap > 0.2 ? 1.08 : gap < -0.2 ? 0.90 : 1.0;
  const tgt = maxSpd * ai.speedFactor * rb;
  ai.speed += (tgt - ai.speed) * 0.035;
  ai.t += ai.speed * dt;

  // Steering toward random target (AI weaves naturally)
  ai.targetLatTimer -= dt;
  if (ai.targetLatTimer <= 0) {
    ai.targetLat = rng(-TRACK_HALF_WIDTH * 0.58, TRACK_HALF_WIDTH * 0.58);
    ai.targetLatTimer = rng(1200, 3500);
  }
  ai.latOffset += (ai.targetLat - ai.latOffset) * 0.012;

  ai.worldPos = getWorldPos(ai.t, ai.latOffset, curve);
  ai.worldPos.y = 0.56;
  ai.mesh.position.copy(ai.worldPos);
  const tn = curve.getTangentAt(((ai.t % 1) + 1) % 1).normalize();
  alignMesh(ai.mesh, tn);
  ai.wheels.forEach(w => { w.rotation.x += ai.speed * dt * 70; });
}

// â”€â”€â”€ Obstacle Collision â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let shakeTimer = 0, shakeAmt = 0;

function checkObstacles(dt) {
  obstacleList.forEach(obs => {
    if (obs.cooldown > 0) { obs.cooldown -= dt; return; }
    const op = obs.mesh.position;
    const dist = player.worldPos.distanceTo(op);
    if (dist > 3.2) return;
    obs.cooldown = 2000;

    if (obs.type === 'ghost') {
      showEffect('PHANTOM PASS!', '#00ffff');
      // Ghost ring spin animation
    } else if (obs.type === 'slow') {
      player.slowTimer = 2200;
      showEffect('OIL SLICK! â€” Slowing', '#ffaa00');
    } else {
      player.hp -= 25;
      shakeTimer = 400; shakeAmt = 0.28;
      showEffect('COLLISION! âˆ’25 HP', '#ff4400');
      if (player.hp <= 0) { player.hp = 0; updateHUD(); gameOver(); }
    }
    updateHUD();
  });
}

// â”€â”€â”€ Camera â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
function updateCamera(dt) {
  const tn      = player.tangent;
  const maxSpd  = Math.min(BASE_SPEED + (GAME.level - 1) * SPEED_PER_LEVEL, MAX_SPEED);
  const speedRat = player.speed / maxSpd;

  // Camera pulls back and rises at higher speed — tunnel-rush feel
  const camDist   = 11 + speedRat * 8;
  const camHeight = 4.2 + speedRat * 3;

  const tgt = player.worldPos.clone()
    .addScaledVector(tn, -camDist)
    .add(new THREE.Vector3(0, camHeight, 0));

  // Camera slides laterally with drift to emphasize the slide
  const rt = new THREE.Vector3().crossVectors(tn, _up).normalize();
  tgt.addScaledVector(rt, player.latVel * 700);

  const followFactor = 0.07 + speedRat * 0.05;
  camPos.lerp(tgt, followFactor);

  if (shakeTimer > 0) {
    shakeTimer -= dt;
    camPos.x += (Math.random() - 0.5) * shakeAmt;
    camPos.y += (Math.random() - 0.5) * shakeAmt * 0.5;
  }
  camera.position.copy(camPos);

  // Look further ahead at speed
  const lookAhead = player.worldPos.clone()
    .addScaledVector(tn, 4 + speedRat * 5)
    .add(new THREE.Vector3(0, 0.4, 0));
  camLook.lerp(lookAhead, 0.13);
  camera.lookAt(camLook);
}

// â”€â”€â”€ HUD & Effects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let effectTimeout;
function showEffect(msg, color) {
  const el = document.getElementById('effect-msg');
  el.textContent = msg;
  el.style.color = color;
  el.style.borderColor = color + '44';
  el.classList.remove('hidden');
  clearTimeout(effectTimeout);
  effectTimeout = setTimeout(() => el.classList.add('hidden'), 2200);
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateHUD() {
  document.getElementById('hud-lap').textContent   = `${Math.min(GAME.lap + 1, LAPS_PER_LEVEL)} / ${LAPS_PER_LEVEL}`;
  document.getElementById('hud-level').textContent = GAME.level;

  // Speedometer: maps player.speed linearly to 0â€“360 km/h
  const maxSpd = Math.min(BASE_SPEED + (GAME.level - 1) * SPEED_PER_LEVEL, MAX_SPEED);
  const kmh = Math.round((player.speed / maxSpd) * KMH_SCALE);
  document.getElementById('hud-speed').innerHTML = `${kmh} <small>km/h</small>`;

  const pct = Math.round(player.hp);
  document.getElementById('hp-text').textContent = pct + '%';
  document.getElementById('health-bar').style.width = pct + '%';
  document.getElementById('health-bar').style.backgroundPosition = (100 - pct) + '% center';

  // Race position (AI mode)
  if (GAME.mode === 'ai' && aiCars.length) {
    const ahead = aiCars.filter(a => a.t > player.t).length;
    document.getElementById('race-pos-num').textContent = ahead + 1;
  }
}

// â”€â”€â”€ Game Flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildLevel(level) {
  // Clear old scene objects
  while (trackGroup.children.length) trackGroup.remove(trackGroup.children[0]);
  if (envGroup) scene.remove(envGroup);
  aiCars.forEach(a => scene.remove(a.mesh));
  if (player.mesh) scene.remove(player.mesh);

  // Track
  const pts = generateTrackPoints(level);
  curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  trackGroup.add(buildRoadMesh(curve));
  trackGroup.add(buildGuardRails(curve));
  trackGroup.add(buildStartLine(curve));

  // Obstacles
  obstacleList = spawnObstacles(curve, level);

  // Environment
  envGroup = buildEnvironment(level);
  scene.add(envGroup);

  // Player car
  const pc = buildCar(0x1ecbff);
  player.mesh = pc.mesh; player.wheels = pc.wheels;
  scene.add(player.mesh);

  // AI cars
  aiCars = [];
  if (GAME.mode === 'ai') {
    for (let i = 0; i < 2; i++) aiCars.push(buildAI(level, i));
  }
}

function startGame() {
  GAME.level = 1;
  GAME.lap   = 0;
  GAME.bestLap = Infinity;
  GAME.elapsed = 0;
  player.t = 0; player.latOffset = 0; player.speed = 0; player.latVel = 0; player.hp = HP_MAX; player.slowTimer = 0;

  // Remove the menu environment before building the race level
  if (typeof _menuEnv !== 'undefined') scene.remove(_menuEnv);

  buildLevel(GAME.level);
  camPos.set(0, 8, -15);
  GAME.lastTime = 0;
  GAME.lapStartTime = performance.now();

  hideAllMenus();
  document.getElementById('hud').classList.remove('hidden');
  showMobile();
  if (GAME.mode === 'ai') document.getElementById('race-pos').classList.remove('hidden');
  updateHUD();

  // Countdown 3â†’GO then start
  GAME.state = 'READY'; // hold still during countdown (READY = scene renders, no physics)
  showEffect('3', '#06d6f0');
  setTimeout(() => showEffect('2', '#06d6f0'), 1000);
  setTimeout(() => showEffect('1', '#06d6f0'), 2000);
  setTimeout(() => {
    showEffect('GO!', '#22ff88');
    GAME.state = 'PLAYING';
    GAME.lapStartTime = performance.now();
    if (!GAME.loopId) GAME.loopId = requestAnimationFrame(gameLoop);
  }, 3000);

  if (!GAME.loopId) GAME.loopId = requestAnimationFrame(gameLoop);
}

function levelComplete() {
  GAME.state = 'LEVEL_COMPLETE';
  const lc = document.getElementById('level-complete-menu');
  document.getElementById('lc-level').textContent   = GAME.level;
  document.getElementById('lc-bestlap').textContent = GAME.bestLap < Infinity ? fmt(GAME.bestLap) : '--';
  document.getElementById('lc-hp').textContent      = Math.round(player.hp) + '%';
  const stars = player.hp > 66 ? 'â˜…â˜…â˜…' : player.hp > 33 ? 'â˜…â˜…â˜†' : 'â˜…â˜†â˜†';
  document.getElementById('star-row').textContent = stars;
  lc.classList.remove('hidden');
}

function gameOver() {
  GAME.state = 'GAME_OVER';
  document.getElementById('go-level').textContent   = GAME.level;
  document.getElementById('go-laps').textContent    = GAME.lap;
  document.getElementById('go-bestlap').textContent = GAME.bestLap < Infinity ? fmt(GAME.bestLap) : '--';
  document.getElementById('game-over-menu').classList.remove('hidden');
}

function nextLevel() {
  GAME.level++;
  GAME.lap = 0;
  GAME.bestLap = Infinity;
  player.t = 0; player.latOffset = 0; player.speed = 0; player.latVel = 0;
  player.hp = Math.min(HP_MAX, player.hp + 25); // bonus HP
  player.slowTimer = 0;
  buildLevel(GAME.level);
  camPos.set(0, 8, -15);
  GAME.lastTime = 0;
  GAME.state = 'READY';
  GAME.lapStartTime = performance.now();
  hideAllMenus();
  document.getElementById('hud').classList.remove('hidden');
  showMobile();
  updateHUD();
}

function goToMenu() {
  GAME.state = 'MENU';
  GAME.loopId = null;
  hideAllMenus();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('mobile-controls').classList.add('hidden');
  document.getElementById('race-pos').classList.add('hidden');
  document.getElementById('main-menu').classList.remove('hidden');
  document.getElementById('main-menu').classList.add('menu-active');
}

function togglePause() {
  if (GAME.state === 'PLAYING') {
    GAME.state = 'PAUSED';
    document.getElementById('pause-menu').classList.remove('hidden');
    document.querySelector('.icon-pause').style.display = 'none';
    document.querySelector('.icon-play').style.display  = 'block';
  } else if (GAME.state === 'PAUSED') {
    GAME.state = 'PLAYING';
    GAME.lastTime = 0;
    document.getElementById('pause-menu').classList.add('hidden');
    document.querySelector('.icon-pause').style.display = 'block';
    document.querySelector('.icon-play').style.display  = 'none';
    if (!GAME.loopId) GAME.loopId = requestAnimationFrame(gameLoop);
  }
}

function hideAllMenus() {
  ['main-menu','level-complete-menu','game-over-menu','pause-menu'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.add('hidden');
    el.classList.remove('menu-active');
  });
}

function showMobile() {
  if (window.innerWidth < 768) document.getElementById('mobile-controls').classList.remove('hidden');
}

// â”€â”€â”€ Render & Game Loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function render() { renderer.render(scene, camera); }

function gameLoop(ts) {
  // Keep loop running during LEVEL_COMPLETE / GAME_OVER so scene stays visible
  if (GAME.state === 'MENU') {
    GAME.loopId = null; return;
  }
  GAME.loopId = requestAnimationFrame(gameLoop);

  const dt = GAME.lastTime ? Math.min(ts - GAME.lastTime, 100) : 0;
  GAME.lastTime = ts;

  if (GAME.state === 'PLAYING') {
    GAME.elapsed += dt;
    document.getElementById('hud-time').textContent = fmt(GAME.elapsed / 1000);
    updatePlayer(dt);
    aiCars.forEach(a => updateAI(a, dt));
    checkObstacles(dt);
    updateExhaust(dt);
    updateTireMarks(dt);
    updateHUD();
  }

  // Pulse ghost obstacles
  obstacleList.forEach(obs => {
    if (obs.type === 'ghost') {
      obs.mesh.rotation.z += 0.02;
      if (obs.mesh.material) obs.mesh.material.opacity = 0.4 + 0.35 * Math.sin(ts * 0.003);
    }
  });

  updateCamera(dt);
  render();
}

// â”€â”€â”€ Menu Event Listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    // Use currentTarget so the button itself (not a child span/text) gets the class
    e.currentTarget.classList.add('active');
    GAME.mode = e.currentTarget.dataset.mode;
  });
});
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('next-level-btn').addEventListener('click', () => { document.getElementById('level-complete-menu').classList.add('hidden'); nextLevel(); });
document.getElementById('restart-btn').addEventListener('click', startGame);
document.getElementById('menu-from-lc-btn').addEventListener('click', goToMenu);
document.getElementById('menu-from-go-btn').addEventListener('click', goToMenu);
document.getElementById('menu-from-pause-btn').addEventListener('click', goToMenu);
document.getElementById('pause-btn').addEventListener('click', togglePause);
document.getElementById('resume-btn').addEventListener('click', togglePause);

// â”€â”€â”€ Exhaust Particles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const EXHAUST_COUNT = 60;
const exhaustGeo = new THREE.BufferGeometry();
const exhaustPos = new Float32Array(EXHAUST_COUNT * 3);
exhaustGeo.setAttribute('position', new THREE.BufferAttribute(exhaustPos, 3));
const exhaustMat = new THREE.PointsMaterial({
  color: 0x88ddff, size: 0.22, transparent: true,
  opacity: 0.7, sizeAttenuation: true,
});
const exhaustPoints = new THREE.Points(exhaustGeo, exhaustMat);
scene.add(exhaustPoints);

const _exhaust = Array.from({ length: EXHAUST_COUNT }, () => ({
  life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
}));
let _eIdx = 0;

function spawnExhaustParticle() {
  if (!player.mesh || GAME.state !== 'PLAYING') return;
  const p = _exhaust[_eIdx % EXHAUST_COUNT];
  _eIdx++;
  // Spawn at rear of car
  p.pos.copy(player.worldPos)
    .addScaledVector(player.tangent, -2.5)
    .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3, 0));
  const spd = player.speed * 6000;
  p.vel.set(
    (Math.random() - 0.5) * 0.8,
    0.6 + Math.random() * 0.8,
    (Math.random() - 0.5) * 0.8,
  );
  p.life = 1.0;
}

let _exhaustTimer = 0;
function updateExhaust(dt) {
  _exhaustTimer += dt;
  if (_exhaustTimer > 35 && Math.abs(player.speed) > BASE_SPEED * 0.3) {
    spawnExhaustParticle();
    _exhaustTimer = 0;
  }
  const pos = exhaustGeo.attributes.position.array;
  _exhaust.forEach((p, i) => {
    if (p.life > 0) {
      p.life -= dt / 900;
      p.pos.addScaledVector(p.vel, dt * 0.004);
      p.vel.y -= 0.003 * dt;
    }
    pos[i * 3]     = p.life > 0 ? p.pos.x : 0;
    pos[i * 3 + 1] = p.life > 0 ? p.pos.y : -9999;
    pos[i * 3 + 2] = p.life > 0 ? p.pos.z : 0;
  });
  exhaustGeo.attributes.position.needsUpdate = true;
  exhaustMat.opacity = 0.5 + 0.3 * Math.abs(player.speed) / MAX_SPEED;
}

// â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Pre-render a nice menu backdrop â€” build a small city track for aesthetics
setupLights('city');
const _menuPts = makeOval(100, 55, 12);
const _menuCurve = new THREE.CatmullRomCurve3(_menuPts, true, 'catmullrom', 0.5);
trackGroup.add(buildRoadMesh(_menuCurve));
trackGroup.add(buildGuardRails(_menuCurve));
const _menuEnv = buildCityEnv();
scene.add(_menuEnv);
camera.position.set(0, 65, 130);
camera.lookAt(0, 0, 0);
let _menuAngle = 0;
(function menuLoop(ts) {
  if (GAME.state !== 'MENU') return;
  requestAnimationFrame(menuLoop);
  // Slowly orbit camera around origin for a dramatic menu backdrop
  _menuAngle += 0.0004;
  camera.position.x = Math.sin(_menuAngle) * 150;
  camera.position.z = Math.cos(_menuAngle) * 150;
  camera.position.y = 55 + Math.sin(_menuAngle * 0.5) * 10;
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
})(0);
