/* =====================================================================
   HELAO2: LOW POLY WILDS — single-file sci-fi adventure shooter
   ---------------------------------------------------------------------
   Systems: splash/menu/settings/credits • save & continue (localStorage)
   open world (roads, ravine, bridges, swaying grass, wildlife) •
   4 weapons • 4 enemy types w/ state-machine AI (patrol/investigate/
   chase/attack/retreat) • missions & journal • building (8 structures,
   destructible) • secrets & upgrades • procedural music + SFX
   ===================================================================== */
(function () {
'use strict';

/* =========================== CONFIG ================================ */
const WORLD_SIZE   = 280;
const PLAYER_SPEED = 7.5;
const SPRINT_MULT  = 1.6;
const JUMP_VEL     = 8.5;
const GRAVITY      = 22;
const CAMPER_POS   = new THREE.Vector3(58, 0, 46);    // yellow camper hub
const TOWER_POS    = new THREE.Vector3(-30, 0, -34);  // sci-fi tower
const SAVE_KEY     = 'helao2_wilds_save';
const SET_KEY      = 'helao2_wilds_settings';

// Palette lifted from the reference art
const PAL = {
  groundA: 0xc65a35, groundB: 0xd0764a, groundC: 0xb44a62, groundBed: 0x8a5a48,
  teal: 0x3fbfae, mint: 0x7adfc4, yellow: 0xe8b93c, mustard: 0xd9a53a,
  orange: 0xe07b39, pink: 0xe86a9e, magenta: 0xd94f8a, blue: 0x5a8fd9,
  techBlue: 0x3d6fa8, cyanGlow: 0x54e0e8, windowGlow: 0xffc84a,
  grayLight: 0x9aa3ad, grayMid: 0x6b7280, grayDark: 0x3a4048,
  rock: 0x8f8a94, rockPink: 0xbd8f97, sky: 0xc9a08c, fog: 0xcfa38f,
};

/* =========================== HELPERS =============================== */
// Deterministic RNG (mulberry32) — every client builds the identical
// world from the same seed, which keeps co-op sessions coherent.
let _seed = (0x5EED7 ^ 20260702) >>> 0;
function srand() {
  _seed = _seed + 0x6D2B79F5 | 0;
  let t = Math.imul(_seed ^ _seed >>> 15, 1 | _seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
const rand  = (a, b) => a + srand() * (b - a);
const randI = (a, b) => Math.floor(rand(a, b + 1));
const pick  = arr => arr[Math.floor(srand() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = id => document.getElementById(id);

/* ======================= SETTINGS (persisted) ====================== */
const settings = Object.assign({
  master: 70, sfx: 80, music: 55, sens: 100, invertY: false, quality: 1,
}, JSON.parse(localStorage.getItem(SET_KEY) || '{}'));
function saveSettings() { localStorage.setItem(SET_KEY, JSON.stringify(settings)); }
// per-quality tuning: [fogNear, fogFar, cameraFar, grassCount, shadowSize, pixelCap]
const QUALITY = [
  { fogN: 36, fogF: 130, camF: 380, grass: 1100, shadow: 1024, px: 1.0 },
  { fogN: 40, fogF: 195, camF: 500, grass: 2600, shadow: 2048, px: 1.5 },
  { fogN: 45, fogF: 245, camF: 620, grass: 4800, shadow: 2048, px: 2.0 },
];

/* ======================= AUDIO: SFX + MUSIC ======================== */
// Everything synthesized with Web Audio — no external files.
const SFX = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let musicTimer = null, windSrc = null;
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = srand() * 2 - 1;
    applyVolumes();
    startMusic();
  }
  function applyVolumes() {
    if (!ctx) return;
    master.gain.value = (settings.master / 100) * 0.55;
    sfxBus.gain.value = settings.sfx / 100;
    musicBus.gain.value = settings.music / 100;
  }
  function env(g, t0, a, peak, dur) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  function tone(type, f0, f1, dur, peak = 0.4, bus) {
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    env(g, t, 0.005, peak, dur);
    o.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, peak, filterFreq, q = 1, type = 'lowpass') {
    if (!ctx) return;
    const t = ctx.currentTime, s = ctx.createBufferSource(), g = ctx.createGain(),
          f = ctx.createBiquadFilter();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = filterFreq; f.Q.value = q;
    env(g, t, 0.003, peak, dur);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur + 0.05);
  }
  /* ---- generative ambient music: slow warm pads + wind bed ---- */
  const CHORDS = [[0, 7, 12, 16], [-4, 3, 12, 19], [-2, 5, 10, 14], [-7, 0, 7, 16]];
  let chordIdx = 0;
  function pad() {
    if (!ctx) return;
    const base = 164.8; // E3
    const notes = CHORDS[chordIdx % CHORDS.length]; chordIdx++;
    const t = ctx.currentTime;
    notes.forEach((semi, i) => {
      const f = base * Math.pow(2, semi / 12);
      for (const det of [-2.5, 2.5]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = i % 2 ? 'triangle' : 'sine';
        o.frequency.value = f; o.detune.value = det;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.028, t + 2.2);
        g.gain.linearRampToValueAtTime(0.018, t + 5.0);
        g.gain.linearRampToValueAtTime(0.0001, t + 7.6);
        o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 8);
      }
    });
    // occasional sparkle note
    if (srand() < 0.5) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = base * Math.pow(2, (pick(notes) + 24) / 12);
      const tt = t + rand(1, 4);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.02, tt + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 2.4);
      o.connect(g); g.connect(musicBus); o.start(tt); o.stop(tt + 2.6);
    }
  }
  function startMusic() {
    if (musicTimer) return;
    pad();
    musicTimer = setInterval(pad, 6800);
    // constant soft wind bed
    windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.035;
    windSrc.connect(f); f.connect(g); g.connect(musicBus); windSrc.start();
  }
  return {
    init, applyVolumes,
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    // ---- weapon fire sounds, distinct per weapon ----
    firePistol()  { tone('square', 950, 160, 0.08, 0.2); noise(0.06, 0.2, 3400); },
    fireRifle()   { tone('sawtooth', 700, 130, 0.07, 0.16); noise(0.05, 0.22, 2600); },
    fireShotgun() { noise(0.22, 0.5, 1400, 0.8); tone('square', 220, 60, 0.18, 0.3); },
    fireSniper()  { tone('sawtooth', 1400, 90, 0.3, 0.3); noise(0.25, 0.35, 5200, 2, 'highpass'); },
    turret()  { tone('square', 620, 120, 0.08, 0.13); },
    reload()  { tone('triangle', 220, 440, 0.12, 0.2); setTimeout(() => tone('triangle', 440, 880, 0.1, 0.2), 140); },
    hit()     { tone('sawtooth', 320, 90, 0.07, 0.18); },
    hurt()    { tone('sawtooth', 160, 60, 0.25, 0.35); },
    jump()    { tone('sine', 260, 520, 0.14, 0.15); },
    pickup()  { tone('sine', 620, 1240, 0.14, 0.22); },
    core()    { tone('sine', 520, 1560, 0.35, 0.25); setTimeout(() => tone('sine', 780, 1560, 0.3, 0.2), 130); },
    place()   { tone('triangle', 140, 70, 0.15, 0.3); noise(0.08, 0.15, 900); },
    alert()   { tone('square', 980, 980, 0.06, 0.11); setTimeout(() => tone('square', 780, 780, 0.06, 0.11), 90); },
    explode() { noise(0.5, 0.5, 700, 0.5); tone('sine', 120, 30, 0.4, 0.4); },
    crumble() { noise(0.4, 0.4, 500, 0.6); },
    deny()    { tone('square', 180, 140, 0.12, 0.14); },
    heal()    { tone('sine', 420, 840, 0.3, 0.2); setTimeout(() => tone('sine', 520, 1040, 0.3, 0.2), 160); },
    scan()    { tone('sine', 880, 1760, 0.25, 0.15); setTimeout(() => tone('sine', 1320, 1320, 0.12, 0.12), 240); },
    powerup() { tone('sawtooth', 110, 440, 0.6, 0.2); setTimeout(() => tone('sine', 660, 1320, 0.4, 0.18), 500); },
    click()   { tone('triangle', 700, 500, 0.05, 0.12); },
    hover()   { tone('triangle', 900, 800, 0.03, 0.05); },
    step()    { noise(0.07, 0.09, 480 + srand() * 160); },
    land()    { noise(0.12, 0.2, 350); tone('sine', 140, 70, 0.1, 0.12); },
    chirp() {
      const f = 800 + srand() * 900;
      tone('sine', f, f * 1.4, 0.09, 0.07);
      setTimeout(() => tone('sine', f * 1.2, f * 0.9, 0.07, 0.05), 110);
    },
    unlock()  { [0, 120, 240].forEach((d, i) => setTimeout(() => tone('sine', 520 * (1 + i * 0.25), 520 * (1 + i * 0.25), 0.18, 0.2), d)); },
  };
})();

/* ====================== RENDERER / SCENE =========================== */
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// NOTE: linear output on purpose — r128 sRGB output washes out authored hex colors.

const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.sky);
scene.fog = new THREE.Fog(PAL.fog, 40, 195);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

const hemi = new THREE.HemisphereLight(0xffe8d0, 0xa05248, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffeed2, 1.0);
sun.position.set(45, 70, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;   sun.shadow.camera.bottom = -80;
sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0008;
scene.add(sun); scene.add(sun.target);

function applyQuality() {
  const q = QUALITY[settings.quality];
  scene.fog.near = q.fogN; scene.fog.far = q.fogF;
  camera.far = q.camF; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.px));
  sun.shadow.mapSize.set(q.shadow, q.shadow);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  rebuildGrass();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ======================= SHARED MATERIALS ========================== */
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial(Object.assign(
    { color, flatShading: true, roughness: 0.9, metalness: 0.05 }, opts));
}
const MAT = {
  trunk: mat(0x7a4a3a),
  rock: mat(PAL.rock), rockPink: mat(PAL.rockPink),
  grayLight: mat(PAL.grayLight), grayMid: mat(PAL.grayMid), grayDark: mat(PAL.grayDark),
  yellow: mat(PAL.yellow), mustard: mat(PAL.mustard), orange: mat(PAL.orange),
  techBlue: mat(PAL.techBlue), blue: mat(PAL.blue),
  cyanGlow: mat(0x2a6f78, { emissive: PAL.cyanGlow, emissiveIntensity: 1.4 }),
  windowGlow: mat(0x6f5a20, { emissive: PAL.windowGlow, emissiveIntensity: 1.5 }),
  redGlow: mat(0x5a1414, { emissive: 0xff2a3c, emissiveIntensity: 2.0 }),
  crystal: mat(0x1f8f78, { emissive: 0x5ff2d0, emissiveIntensity: 1.6, roughness: 0.4 }),
  bioGlow: mat(0x7a2a4a, { emissive: 0xe86a9e, emissiveIntensity: 1.1 }),
  coreGlow: mat(0x7a5a14, { emissive: 0xffd166, emissiveIntensity: 1.8 }),
  darkGlass: mat(0x1e2a33, { roughness: 0.3, metalness: 0.4 }),
  wood: mat(0x6e4a38),
  treeCols: [PAL.teal, PAL.mint, PAL.yellow, PAL.orange, PAL.pink, PAL.blue, PAL.magenta].map(c => mat(c)),
};

/* ==================== COLLISION / PLATFORMS ======================== */
const boxColliders = [];      // {minX,maxX,minZ,maxZ,top,owner}
const circleColliders = [];   // {x,z,r}
const cameraBlockers = [];    // meshes camera raycasts against
const losBlockers = [];       // meshes blocking enemy LOS & bullets
const platforms = [];         // walkable {minX,maxX,minZ,maxZ,top}

function addBoxCollider(cx, cz, w, d, top = 10, owner = null) {
  const c = { minX: cx - w/2, maxX: cx + w/2, minZ: cz - d/2, maxZ: cz + d/2, top, owner };
  boxColliders.push(c);
  return c;
}
function removeCollider(c) {
  const i = boxColliders.indexOf(c);
  if (i >= 0) boxColliders.splice(i, 1);
}
function removeFromArr(arr, list) { for (const m of list) { const i = arr.indexOf(m); if (i >= 0) arr.splice(i, 1); } }
function addPlatform(cx, cz, w, d, top) {
  const p = { minX: cx - w/2, maxX: cx + w/2, minZ: cz - d/2, maxZ: cz + d/2, top };
  platforms.push(p);
  return p;
}
function circleVsColliders(x, z, r, y = 0) {
  let px = 0, pz = 0;
  for (const b of boxColliders) {
    if (y > b.top) continue;
    const nx = clamp(x, b.minX, b.maxX), nz = clamp(z, b.minZ, b.maxZ);
    const dx = x - nx, dz = z - nz, d2 = dx*dx + dz*dz;
    if (d2 < r*r) {
      if (d2 < 1e-6) { px += r; continue; }
      const d = Math.sqrt(d2), s = (r - d) / d;
      px += dx * s; pz += dz * s;
    }
  }
  for (const c of circleColliders) {
    const dx = x - c.x, dz = z - c.z, rr = r + c.r, d2 = dx*dx + dz*dz;
    if (d2 < rr*rr && d2 > 1e-6) {
      const d = Math.sqrt(d2), s = (rr - d) / d;
      px += dx * s; pz += dz * s;
    }
  }
  return { x: px, z: pz };
}
function pointInBoxColliders(x, y, z) {
  for (const b of boxColliders)
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.top) return b;
  return null;
}

/* ========================= TERRAIN ================================= */
// Ravine (dry riverbed) winds across the map along z ≈ 55 + 18·sin(x/50)
function ravineCenter(x) { return 55 + 18 * Math.sin(x * 0.02); }
function terrainHeight(x, z) {
  let h = Math.sin(x * 0.04) * Math.cos(z * 0.045) * 2.6
        + Math.sin(x * 0.10 + 3) * Math.sin(z * 0.085) * 1.0
        + Math.sin(x * 0.018 + 1) * Math.sin(z * 0.02) * 2.2;
  const d = Math.abs(z - ravineCenter(x));
  if (d < 10) h -= 4.2 * (Math.cos(d / 10 * Math.PI) + 1) / 2;
  const flatten = (cx, cz, r) => {
    const dd = Math.hypot(x - cx, z - cz);
    if (dd < r) h *= dd / r;
  };
  flatten(TOWER_POS.x, TOWER_POS.z, 34);
  flatten(CAMPER_POS.x, CAMPER_POS.z, 20);
  return h;
}
// Ground height including walkable platforms (bridges, tower steps…)
function groundYAt(x, z, py) {
  let g = terrainHeight(x, z);
  for (const p of platforms)
    if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ && py >= p.top - 0.65 && p.top > g)
      g = p.top;
  return g;
}
function inRavine(x, z) { return Math.abs(z - ravineCenter(x)) < 10.5; }

/* ========================= ROADS =================================== */
// Dirt roads connecting key locations; also used to keep them clear of
// trees/grass. Built as terrain-conforming triangle strips.
const roadSamples = [];   // sampled centre points for clearance checks
function buildRoad(waypoints, width = 3.6) {
  const pts = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.ceil(len / 2.5);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  pts.push(waypoints[waypoints.length - 1]);
  const verts = [], cols = [], idx = [];
  const c1 = new THREE.Color(0x9a6a4d), c2 = new THREE.Color(0x8a5c42);
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    roadSamples.push([x, z]);
    // perpendicular direction
    const n = pts[Math.min(i + 1, pts.length - 1)], pv = pts[Math.max(i - 1, 0)];
    let dx = n[0] - pv[0], dz = n[1] - pv[1];
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const ox = -dz * width / 2, oz = dx * width / 2;
    const y1 = groundYAt(x + ox, z + oz, 999) + 0.07, y2 = groundYAt(x - ox, z - oz, 999) + 0.07;
    verts.push(x + ox, y1, z + oz, x - ox, y2, z - oz);
    const c = srand() < 0.5 ? c1 : c2;
    cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 1 }));
  m.receiveShadow = true;
  scene.add(m);
}
function distToRoad(x, z) {
  let best = 1e9;
  for (let i = 0; i < roadSamples.length; i += 2) {
    const dx = x - roadSamples[i][0], dz = z - roadSamples[i][1];
    const d = dx*dx + dz*dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/* ========================= BRIDGES ================================= */
// Fixed bridge on the main road; a second broken crossing is a mission.
function buildBridgePrefab(x, zc, halfSpan = 11.5) {
  const g = new THREE.Group();
  const top = Math.max(terrainHeight(x, zc - halfSpan - 1), terrainHeight(x, zc + halfSpan + 1)) + 0.35;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.5, halfSpan * 2 + 3), MAT.wood);
  deck.position.set(x, top, zc); deck.castShadow = deck.receiveShadow = true; g.add(deck);
  // plank detail
  for (let i = -halfSpan; i <= halfSpan; i += 2.2) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 1.0), MAT.grayDark);
    p.position.set(x, top + 0.3, zc + i); g.add(p);
  }
  // rails
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, halfSpan * 2 + 3), MAT.wood);
    rail.position.set(x + s * 2.1, top + 1.05, zc); g.add(rail);
    for (let i = -halfSpan; i <= halfSpan; i += 3.6) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), MAT.wood);
      post.position.set(x + s * 2.1, top + 0.55, zc + i); g.add(post);
    }
  }
  // support legs down into the ravine
  for (const off of [-halfSpan * 0.55, 0, halfSpan * 0.55]) {
    const gy = terrainHeight(x, zc + off);
    const h = top - gy;
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), MAT.grayDark);
      leg.position.set(x + s * 1.6, gy + h / 2, zc + off); leg.castShadow = true; g.add(leg);
    }
  }
  scene.add(g);
  addPlatform(x, zc, 4.4, halfSpan * 2 + 3, top + 0.25);
  g.traverse(o => { if (o.isMesh) cameraBlockers.push(o); });
  return g;
}

/* ========================= GROUND ================================== */
(function buildGround() {
  const seg = 120;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const cA = new THREE.Color(PAL.groundA), cB = new THREE.Color(PAL.groundB),
        cC = new THREE.Color(PAL.groundC), cBed = new THREE.Color(PAL.groundBed),
        tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    const n = Math.sin(x * 0.08 + 11) * Math.cos(z * 0.07 + 5)
            + Math.sin(x * 0.021) * 1.4 + Math.sin(z * 0.017 + 2);
    tmp.copy(cA).lerp(cB, clamp(n * 0.4 + 0.5, 0, 1));
    if (Math.sin(x * 0.05 + 40) * Math.cos(z * 0.06 - 9) > 0.55) tmp.lerp(cC, 0.55);
    const rd = Math.abs(z - ravineCenter(x));
    if (rd < 11) tmp.lerp(cBed, clamp(1 - rd / 11, 0, 1) * 0.85);   // dusty riverbed
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
})();

/* ==================== MOUNTAINS RING =============================== */
(function () {
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + rand(-0.1, 0.1);
    const r = rand(185, 260);
    const h = rand(26, 72), w = rand(26, 62);
    const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, randI(4, 6)),
      mat(pick([0xa8848a, 0x9c7d88, 0xb08d8a])));
    m.position.set(Math.cos(a) * r, h * 0.32, Math.sin(a) * r);
    m.rotation.y = rand(0, Math.PI);
    scene.add(m);
  }
})();

/* ================ REALTIME SWAYING GRASS =========================== */
// InstancedMesh blades with a vertex-shader wind sway (uTime uniform).
// Density scales with the graphics quality setting.
let grassMeshes = [];
const grassMats = [];
function makeGrassMaterial(color) {
  const m = new THREE.MeshStandardMaterial({ color, flatShading: true,
    side: THREE.DoubleSide, roughness: 1 });
  m.onBeforeCompile = shader => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float wPhase = instanceMatrix[3][0] * 0.35 + instanceMatrix[3][2] * 0.43;
        float sway = sin(uTime * 1.7 + wPhase) + 0.4 * sin(uTime * 3.3 + wPhase * 2.1);
        transformed.x += sway * 0.22 * pow(max(transformed.y, 0.0), 1.5);
      #endif`);
    m.userData.shader = shader;
  };
  grassMats.push(m);
  return m;
}
const GRASS_COLORS = [0xd0623c, 0xc9793f, 0xb8502e, 0x3fbfae];
function rebuildGrass() {
  for (const g of grassMeshes) { scene.remove(g); g.geometry.dispose(); }
  grassMeshes = [];
  const total = QUALITY[settings.quality].grass;
  // knee-high blades — anything taller reads as a wall when the camera is low
  const bladeGeo = new THREE.PlaneGeometry(0.22, 0.8, 1, 2);
  bladeGeo.translate(0, 0.4, 0);
  const dummy = new THREE.Object3D();
  // clustered patches of mostly warm grass with a few teal patches
  const patchCenters = [];
  for (let i = 0; i < 56; i++) {
    const x = rand(-WORLD_SIZE/2 + 10, WORLD_SIZE/2 - 10), z = rand(-WORLD_SIZE/2 + 10, WORLD_SIZE/2 - 10);
    if (Math.hypot(x - TOWER_POS.x, z - TOWER_POS.z) < 22) continue;
    if (Math.hypot(x - CAMPER_POS.x, z - CAMPER_POS.z) < 12) continue;
    patchCenters.push([x, z, srand() < 0.82 ? randI(0, 2) : 3]);
  }
  const perColor = [[], [], [], []];
  for (let i = 0; i < total; i++) {
    const [px, pz, ci] = pick(patchCenters);
    const x = px + rand(-7, 7), z = pz + rand(-7, 7);
    if (distToRoad(x, z) < 2.6) continue;
    if (inRavine(x, z) && srand() < 0.7) continue;
    perColor[ci].push([x, z]);
  }
  perColor.forEach((list, ci) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(bladeGeo, makeGrassMaterial(GRASS_COLORS[ci]), list.length);
    list.forEach(([x, z], i) => {
      dummy.position.set(x, terrainHeight(x, z), z);
      dummy.rotation.y = rand(0, Math.PI);
      dummy.scale.set(rand(0.6, 1.1), rand(0.5, 1.05), 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(inst);
    grassMeshes.push(inst);
  });
}

/* ================ CLUTTER: tufts, flowers, mushrooms =============== */
(function () {
  const dummy = new THREE.Object3D();
  const tuftInst = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 0.8, 4), mat(0xd4593c), 800);
  for (let i = 0; i < 800; i++) {
    const x = rand(-WORLD_SIZE/2 + 6, WORLD_SIZE/2 - 6), z = rand(-WORLD_SIZE/2 + 6, WORLD_SIZE/2 - 6);
    dummy.position.set(x, terrainHeight(x, z) + 0.3, z);
    dummy.rotation.y = rand(0, Math.PI); dummy.scale.setScalar(rand(0.6, 1.6));
    dummy.updateMatrix(); tuftInst.setMatrixAt(i, dummy.matrix);
  }
  scene.add(tuftInst);
  const fInst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 0),
    mat(0xf0f0ff, { emissive: 0x8888ff, emissiveIntensity: 0.25 }), 260);
  for (let i = 0; i < 260; i++) {
    const x = rand(-WORLD_SIZE/2 + 6, WORLD_SIZE/2 - 6), z = rand(-WORLD_SIZE/2 + 6, WORLD_SIZE/2 - 6);
    dummy.position.set(x, terrainHeight(x, z) + 0.15, z);
    dummy.scale.setScalar(rand(0.5, 1.1)); dummy.updateMatrix(); fInst.setMatrixAt(i, dummy.matrix);
  }
  scene.add(fInst);
})();
// glowing mushroom clusters in shaded spots (near rocks / ravine banks)
function makeMushrooms(x, z) {
  const g = new THREE.Group();
  const col = pick([MAT.cyanGlow, MAT.bioGlow]);
  for (let i = 0; i < randI(2, 4); i++) {
    const h = rand(0.25, 0.7);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, h, 4), MAT.grayLight);
    stem.position.set(rand(-0.5, 0.5), h/2, rand(-0.5, 0.5)); g.add(stem);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(rand(0.16, 0.3), rand(0.2, 0.35), 5), col);
    cap.position.set(stem.position.x, h + 0.1, stem.position.z); g.add(cap);
  }
  g.position.set(x, terrainHeight(x, z), z);
  scene.add(g);
}

/* ========================= TREES =================================== */
const treeCanopyGeos = [new THREE.IcosahedronGeometry(1, 0), new THREE.DodecahedronGeometry(1, 0)];
const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1, 5);
function makeTree(x, z, scale = 1) {
  const g = new THREE.Group();
  const h = rand(2.2, 4.4) * scale;
  const trunk = new THREE.Mesh(trunkGeo, MAT.trunk);
  trunk.scale.set(scale, h, scale); trunk.position.y = h / 2;
  trunk.castShadow = true; g.add(trunk);
  const cMat = pick(MAT.treeCols);
  const blobs = randI(1, 3);
  for (let i = 0; i < blobs; i++) {
    const r = rand(0.9, 1.7) * scale * (1 - i * 0.22);
    const b = new THREE.Mesh(pick(treeCanopyGeos), cMat);
    b.scale.set(r, r * rand(1.1, 1.8), r);
    b.position.set(rand(-0.25, 0.25) * scale, h + i * r * 1.1, rand(-0.25, 0.25) * scale);
    b.rotation.set(rand(0, 0.4), rand(0, Math.PI), rand(0, 0.4));
    b.castShadow = true; g.add(b);
  }
  g.position.set(x, terrainHeight(x, z), z);
  scene.add(g);
  circleColliders.push({ x, z, r: 0.45 * scale });
  return g;
}

/* ========================= ROCKS & ARCHES ========================== */
function makeRock(x, z, s) {
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), srand() < 0.4 ? MAT.rockPink : MAT.rock);
  r.position.set(x, terrainHeight(x, z) + s * 0.35, z);
  r.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
  r.scale.y = rand(0.6, 1);
  r.castShadow = r.receiveShadow = true;
  scene.add(r);
  if (s > 1.2) { circleColliders.push({ x, z, r: s * 0.8 }); cameraBlockers.push(r); losBlockers.push(r); }
  return r;
}
function makeArch(x, z, ry) {
  const g = new THREE.Group();
  const pil = () => new THREE.Mesh(new THREE.CylinderGeometry(rand(1.6, 2.2), rand(2.4, 3.2), 9, 6), MAT.rock);
  const a = pil(); a.position.set(-5, 4.5, 0); g.add(a);
  const b = pil(); b.position.set(5, 4.5, 0);  g.add(b);
  const top = new THREE.Mesh(new THREE.BoxGeometry(13.5, 2.6, 3.4), MAT.rock);
  top.position.y = 9.6; top.rotation.z = rand(-0.06, 0.06); g.add(top);
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.8, 1.6), 0), MAT.rockPink);
    d.position.set(rand(-6, 6), 10.4 + rand(0, 1), rand(-1, 1)); g.add(d);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; cameraBlockers.push(o); } });
  g.position.set(x, terrainHeight(x, z), z); g.rotation.y = ry;
  scene.add(g);
  const c = Math.cos(ry), s = Math.sin(ry);
  circleColliders.push({ x: x - 5*c, z: z + 5*s, r: 2.6 }, { x: x + 5*c, z: z - 5*s, r: 2.6 });
  return g;
}
// rocky cliff outcrop — stacked boulders forming a small climbable hill look
function makeOutcrop(x, z) {
  for (let i = 0; i < randI(4, 7); i++)
    makeRock(x + rand(-6, 6), z + rand(-6, 6), rand(1.6, 4.2));
}

/* ===================== SCI-FI BASE ================================= */
const pylons = [];   // power pylons for the "Power Restoration" mission
(function buildBase() {
  const bx = TOWER_POS.x, bz = TOWER_POS.z;
  // Tapered tower with cyan strips and glowing yellow windows
  const tower = new THREE.Group();
  const levels = [[9, 8, 7], [7.4, 8, 6.2], [6, 8, 5], [4.6, 7, 3.8], [3.2, 6, 2.6]];
  let y = 0;
  levels.forEach(([w, h, w2]) => {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(w2, w, h, 4, 1), MAT.grayLight);
    seg.rotation.y = Math.PI / 4; seg.position.y = y + h/2;
    seg.castShadow = seg.receiveShadow = true; tower.add(seg);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.7, h * 0.85, 0.3), MAT.cyanGlow);
    strip.position.set(0, y + h/2, (w + w2) / 2 * 0.72); tower.add(strip);
    for (const sideX of [-1, 1]) for (let wy = 0; wy < 3; wy++) for (let wx = 0; wx < 2; wx++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.1, 0.9), MAT.windowGlow);
      win.position.set(sideX * ((w + w2)/2 * 0.72), y + 1.6 + wy * (h/3.4), (wx - 0.5) * w * 0.5);
      tower.add(win);
    }
    y += h;
  });
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 7, 5), MAT.grayDark);
  ant.position.y = y + 3.5; tower.add(ant);
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), MAT.redGlow);
  beacon.position.y = y + 7.2; beacon.name = 'beacon'; tower.add(beacon);
  tower.position.set(bx, 0, bz);
  scene.add(tower);
  addBoxCollider(bx, bz, 13, 13, 40);
  tower.traverse(o => { if (o.isMesh) { cameraBlockers.push(o); losBlockers.push(o); } });

  // Elevated blue walkway with container modules
  const walkway = new THREE.Group();
  const WLEN = 52, WY = 5.2;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(WLEN, 1.1, 5.4), MAT.techBlue);
  deck.position.set(WLEN/2 + 7, WY, 0); deck.castShadow = deck.receiveShadow = true; walkway.add(deck);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(WLEN, 0.25, 0.25), MAT.cyanGlow);
  rail.position.set(WLEN/2 + 7, WY + 1.1, 2.6); walkway.add(rail);
  const rail2 = rail.clone(); rail2.position.z = -2.6; walkway.add(rail2);
  for (let i = 0; i < 5; i++) {
    const px = 10 + i * (WLEN / 4.6);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, WY, 1.6), MAT.grayMid);
    pillar.position.set(px, WY/2 - 0.5, 0); pillar.castShadow = true; walkway.add(pillar);
    const cont = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 2.4), i % 2 ? MAT.yellow : MAT.orange);
    cont.position.set(px, WY - 1.2, 3.9); cont.castShadow = true; walkway.add(cont);
    const contWin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.2), MAT.windowGlow);
    contWin.position.set(px, WY - 0.8, 5.15); walkway.add(contWin);
  }
  walkway.position.set(bx, 0, bz); walkway.rotation.y = -0.35;
  scene.add(walkway);
  walkway.updateMatrixWorld(true);
  walkway.traverse(o => { if (o.isMesh) cameraBlockers.push(o); });
  for (let i = 0; i < 5; i++) {
    const px = 10 + i * (WLEN / 4.6);
    const v = new THREE.Vector3(px, 0, 0).applyAxisAngle(new THREE.Vector3(0,1,0), -0.35).add(new THREE.Vector3(bx, 0, bz));
    addBoxCollider(v.x, v.z, 2, 2, WY);
    const vc = new THREE.Vector3(px, 0, 3.9).applyAxisAngle(new THREE.Vector3(0,1,0), -0.35).add(new THREE.Vector3(bx, 0, bz));
    addBoxCollider(vc.x, vc.z, 3.4, 3.4, WY);
  }

  // Stacked ground containers
  [[-12, 8], [-14, 12], [10, -12], [12, -8.5]].forEach(([ox, oz], i) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.8, 2.6), i % 2 ? MAT.mustard : MAT.orange);
    c.position.set(bx + ox, terrainHeight(bx + ox, bz + oz) + 1.4, bz + oz);
    c.rotation.y = rand(-0.4, 0.4); c.castShadow = c.receiveShadow = true;
    scene.add(c);
    addBoxCollider(bx + ox, bz + oz, 4.6, 3, 3);
    cameraBlockers.push(c); losBlockers.push(c);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.25, 0.4, 2.65), MAT.grayDark);
    stripe.position.copy(c.position); stripe.rotation.copy(c.rotation); stripe.position.y += 0.6;
    scene.add(stripe);
  });
})();

/* ---- Power pylons (mission: Power Restoration) ---- */
function makePylon(x, z) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.4, 0.8, 6), MAT.grayMid);
  base.position.y = 0.4; g.add(base);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 5.4, 5), MAT.grayLight);
  mast.position.y = 3.1; mast.castShadow = true; g.add(mast);
  const coilMat = MAT.redGlow.clone(); coilMat.emissiveIntensity = 0.5;
  const coil = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), coilMat);
  coil.position.y = 6.3; g.add(coil);
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.5), MAT.grayDark);
    fin.position.y = 4.6; fin.rotation.y = i * Math.PI * 2 / 3;
    fin.translateZ(0.55); g.add(fin);
  }
  g.position.set(x, terrainHeight(x, z), z);
  scene.add(g);
  circleColliders.push({ x, z, r: 1.2 });
  cameraBlockers.push(mast);
  pylons.push({ mesh: g, coil, coilMat, x, z, active: false });
}
makePylon(-70, -70); makePylon(50, -90); makePylon(-105, 30);

/* ---- YELLOW CAMPER HUB ---- */
(function buildCamper() {
  const g = new THREE.Group();
  const bodyY = 3.4;
  const body = new THREE.Mesh(new THREE.BoxGeometry(9.5, 3.4, 4.4), MAT.yellow);
  body.position.y = bodyY + 1.7; body.castShadow = body.receiveShadow = true; g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(9.9, 0.5, 4.8), MAT.mustard);
  roof.position.y = bodyY + 3.55; g.add(roof);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(9.7, 0.9, 4.6), MAT.grayDark);
  skirt.position.y = bodyY + 0.25; g.add(skirt);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.0, 3.6), MAT.darkGlass);
  shield.position.set(4.75, bodyY + 2.1, 0); shield.rotation.z = -0.18; g.add(shield);
  for (let i = 0; i < 3; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.25), MAT.darkGlass);
    w.position.set(-3 + i * 2.6, bodyY + 2.2, 2.25); g.add(w);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.28, 0.2), MAT.cyanGlow);
  bar.position.set(-2, bodyY + 0.8, 2.32); g.add(bar);
  for (const zz of [1.4, -1.4]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 1.0), MAT.windowGlow);
    head.position.set(4.9, bodyY + 0.9, zz); g.add(head);
  }
  for (const ax of [-3.4, -2.6]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.6, 4), MAT.grayDark);
    a.position.set(ax, bodyY + 4.9, -1.2); g.add(a);
  }
  const vent = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 1.4), MAT.grayMid);
  vent.position.set(1.5, bodyY + 3.9, 0.6); g.add(vent);
  const legGeo = new THREE.BoxGeometry(0.7, 4.6, 0.7);
  [[-3.6, 1.6], [-3.6, -1.6], [3.6, 1.6], [3.6, -1.6]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(legGeo, MAT.grayDark);
    leg.position.set(lx * 1.15, 2.0, lz * 1.25);
    leg.rotation.z = lx > 0 ? -0.22 : 0.22;
    leg.rotation.x = lz > 0 ? 0.18 : -0.18;
    leg.castShadow = true; g.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.4), MAT.grayDark);
    foot.position.set(lx * 1.35, 0.2, lz * 1.5); g.add(foot);
  });
  for (let i = 0; i < 5; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 0.7), MAT.grayMid);
    step.position.set(-1.2, 0.5 + i * 0.75, 3.0 + (4 - i) * 0.62);
    step.castShadow = true; g.add(step);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, 0.2), MAT.grayLight);
  door.position.set(-1.2, bodyY + 1.5, 2.3); g.add(door);
  g.position.set(CAMPER_POS.x, terrainHeight(CAMPER_POS.x, CAMPER_POS.z), CAMPER_POS.z);
  g.rotation.y = -0.5;
  scene.add(g);
  addBoxCollider(CAMPER_POS.x, CAMPER_POS.z, 9, 6, 8);
  g.traverse(o => { if (o.isMesh) { cameraBlockers.push(o); losBlockers.push(o); } });
})();

/* ---- Hidden cache (mission) — rock hollow in the far north ---- */
const CACHE_POS = new THREE.Vector3(30, 0, -120);
const cacheCrate = (function () {
  for (let i = 0; i < 8; i++) makeRock(CACHE_POS.x + rand(-9, 9), CACHE_POS.z + rand(-8, 8), rand(2, 4.5));
  const crate = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.2), MAT.mustard);
  box.position.y = 0.65; box.castShadow = true; crate.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 1.3), MAT.grayDark);
  lid.position.y = 1.35; crate.add(lid);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.12, 1.25), MAT.coreGlow);
  glow.position.y = 1.2; crate.add(glow);
  crate.position.set(CACHE_POS.x, terrainHeight(CACHE_POS.x, CACHE_POS.z), CACHE_POS.z);
  scene.add(crate);
  return crate;
})();

/* ---- Broken crossing marker (mission: Western Crossing) ---- */
const BRIDGE_SPOT = new THREE.Vector3(-60, 0, 26.5);
const bridgeMarker = (function () {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), MAT.wood);
  post.position.y = 1.3; g.add(post);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.12), MAT.mustard);
  sign.position.y = 2.2; g.add(sign);
  const holo = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), MAT.cyanGlow);
  holo.position.y = 3.4; holo.name = 'holo'; g.add(holo);
  // a couple of broken planks lying around
  for (let i = 0; i < 3; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.5), MAT.wood);
    plank.position.set(rand(-2.5, 2.5), 0.15, rand(-1.5, 1.5));
    plank.rotation.y = rand(0, Math.PI); g.add(plank);
  }
  g.position.set(BRIDGE_SPOT.x, terrainHeight(BRIDGE_SPOT.x, BRIDGE_SPOT.z), BRIDGE_SPOT.z);
  scene.add(g);
  return g;
})();

/* ================== SCATTERED WORLD CONTENT ======================== */
// crystals (energy), scrap piles (metal), bio pods (bio), ammo crates
const pickups = [];   // {mesh,x,z,kind,t}
const crystalGeo = new THREE.OctahedronGeometry(0.55, 0);
function spawnPickup(kind, x, z) {
  const g = new THREE.Group();
  if (kind === 'energy') {
    for (let i = 0; i < randI(1, 3); i++) {
      const c = new THREE.Mesh(crystalGeo, MAT.crystal);
      c.scale.set(rand(0.5, 1), rand(0.9, 1.8), rand(0.5, 1));
      c.position.set(rand(-0.4, 0.4), c.scale.y * 0.5, rand(-0.4, 0.4));
      c.rotation.y = rand(0, Math.PI); g.add(c);
    }
  } else if (kind === 'metal') {
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(rand(0.3, 0.7), rand(0.15, 0.4), rand(0.3, 0.6)), MAT.grayLight);
      s.position.set(rand(-0.5, 0.5), 0.2 + i * 0.14, rand(-0.5, 0.5));
      s.rotation.y = rand(0, Math.PI); g.add(s);
    }
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), MAT.cyanGlow);
    gl.position.y = 0.65; g.add(gl);
  } else if (kind === 'bio') {
    for (let i = 0; i < randI(2, 3); i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(rand(0.22, 0.4), 5, 4), MAT.bioGlow);
      p.position.set(rand(-0.4, 0.4), 0.3, rand(-0.4, 0.4));
      p.scale.y = 1.3; g.add(p);
    }
  } else { // ammo
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), MAT.grayDark);
    b.position.y = 0.3; g.add(b);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.18, 0.62), MAT.windowGlow);
    s.position.y = 0.32; g.add(s);
  }
  g.position.set(x, terrainHeight(x, z) + 0.15, z);
  scene.add(g);
  pickups.push({ mesh: g, x, z, kind, t: rand(0, 6) });
}
function scatterPickups() {
  const half = WORLD_SIZE / 2 - 10;
  const kinds = [['energy', 30], ['metal', 24], ['bio', 18], ['ammo', 14]];
  for (const [kind, n] of kinds)
    for (let i = 0; i < n; i++) {
      const x = rand(-half, half), z = rand(-half, half);
      if (Math.hypot(x - TOWER_POS.x, z - TOWER_POS.z) < 10) continue;
      spawnPickup(kind, x, z);
    }
}

/* ---- Secrets: 8 hidden data shards ---- */
const SECRETS = [
  { x: -8,  z: 78,   lore: 'Shard 1 — "The arches predate the colony. Something carved them."' },
  { x: 0,   z: 52,   lore: 'Shard 2 — "The riverbed dried up in a single night. The water simply… left."' },
  { x: -92, z: 42,   lore: 'Shard 3 — "Drone factory ping detected under the western canyon."' },
  { x: 20,  z: 62,   lore: 'Shard 4 — "We hid supplies beneath the crossing. Trust no drone."' },
  { x: 122, z: 122,  lore: 'Shard 5 — "At the world\'s edge the fog sings. Listen."' },
  { x: 80,  z: 62,   lore: 'Shard 6 — "The camper\'s previous crew left in a hurry. Coffee still warm."' },
  { x: 40,  z: -114, lore: 'Shard 7 — "Northern rocks hum at dusk. The cache is close."' },
  { x: -122, z: 112, lore: 'Shard 8 — "HELAO2 protocol: when all else fails, build."' },
];
const secretMeshes = [];
function spawnSecrets(found) {
  SECRETS.forEach((s, i) => {
    if (found.includes(i)) { secretMeshes.push(null); return; }
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), MAT.coreGlow);
    m.position.set(s.x, terrainHeight(s.x, s.z) + 0.8, s.z);
    scene.add(m);
    secretMeshes.push(m);
  });
}

/* ---- Flying shuttle ---- */
const shuttle = (function () {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.4, 7, 5), MAT.grayLight);
  body.rotation.z = Math.PI / 2; g.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 6.5), MAT.grayMid);
  wing.position.x = -1; g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.25), MAT.grayMid);
  tail.position.set(-3, 0.9, 0); g.add(tail);
  const eng = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), MAT.cyanGlow);
  eng.position.set(-3.6, 0, 0); g.add(eng);
  scene.add(g);
  return g;
})();

/* ---- Ambient dust ---- */
const ambientPts = (function () {
  const n = 280, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i*3] = rand(-100, 100); pos[i*3+1] = rand(0.5, 15); pos[i*3+2] = rand(-100, 100);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe8c8, size: 0.18,
    transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false }));
  scene.add(p);
  return p;
})();

/* ============== WORLD POPULATION (order matters) =================== */
buildBridgePrefab(20, ravineCenter(20));      // main road bridge
buildRoad([[TOWER_POS.x, TOWER_POS.z], [10, 2], [40, 30], [CAMPER_POS.x, CAMPER_POS.z]]);
buildRoad([[CAMPER_POS.x, CAMPER_POS.z], [30, 50], [20, 52], [20, 74], [8, 96], [0, 112]]);
buildRoad([[TOWER_POS.x, TOWER_POS.z], [-55, -10], [-78, 16]]);
(function forest() {
  let placed = 0, guard = 0;
  const half = WORLD_SIZE / 2 - 8;
  while (placed < 150 && guard++ < 1200) {
    const x = rand(-half, half), z = rand(-half, half);
    if (Math.hypot(x - TOWER_POS.x, z - TOWER_POS.z) < 26) continue;
    if (Math.hypot(x - CAMPER_POS.x, z - CAMPER_POS.z) < 14) continue;
    if (inRavine(x, z)) continue;
    if (distToRoad(x, z) < 4) continue;
    makeTree(x, z, rand(0.8, 1.6)); placed++;
  }
})();
(function rocksAndMushrooms() {
  const half = WORLD_SIZE / 2 - 6;
  for (let i = 0; i < 55; i++) {
    const x = rand(-half, half), z = rand(-half, half);
    if (Math.hypot(x - TOWER_POS.x, z - TOWER_POS.z) < 24) continue;
    if (Math.hypot(x - CAMPER_POS.x, z - CAMPER_POS.z) < 12) continue;
    if (distToRoad(x, z) < 4) continue;
    makeRock(x, z, rand(0.5, 2.6));
  }
  for (let i = 0; i < 34; i++) {
    const x = rand(-half, half), z = rand(-half, half);
    if (distToRoad(x, z) < 3) continue;
    makeMushrooms(x, z);
  }
})();
makeArch(-8, 72, 0.5); makeArch(80, -30, -0.9); makeArch(-78, 20, 1.2);
makeOutcrop(100, -60); makeOutcrop(-110, -100); makeOutcrop(115, 80);
scatterPickups();

/* =====================================================================
   WORLD DENSITY PASS — instanced stalk-tree forests, coral ground
   cover, pebbles, flower drifts, extra roads, outposts & animated
   structures. Instancing keeps hundreds of props at ~1 draw call each.
   ===================================================================== */
const envAnims = [];   // {fn(dt,t)} animated environment bits
let envT = 0;
function updateEnvAnims(dt) {
  envT += dt;
  for (const a of envAnims) a(dt, envT);
}
function clearOfSites(x, z, roadMin = 3) {
  if (Math.hypot(x - TOWER_POS.x, z - TOWER_POS.z) < 24) return false;
  if (Math.hypot(x - CAMPER_POS.x, z - CAMPER_POS.z) < 13) return false;
  if (inRavine(x, z)) return false;
  if (distToRoad(x, z) < roadMin) return false;
  return true;
}

/* ---- tall stalk trees (splash-art style: blob canopy on thin trunk) */
(function stalkForest() {
  const N = 220;
  const trunkGeo2 = new THREE.CylinderGeometry(0.09, 0.14, 1, 4);
  const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunkInst = new THREE.InstancedMesh(trunkGeo2, MAT.trunk, N);
  const canopyInst = new THREE.InstancedMesh(canopyGeo,
    mat(0xffffff), N);            // white base — tinted per instance
  const cols = [PAL.teal, PAL.mint, PAL.yellow, PAL.orange, PAL.pink, PAL.blue, PAL.magenta, 0xd94f4f]
    .map(c => new THREE.Color(c));
  const dummy = new THREE.Object3D();
  let i = 0, guard = 0;
  const half = WORLD_SIZE / 2 - 8;
  while (i < N && guard++ < 3000) {
    const x = rand(-half, half), z = rand(-half, half);
    if (!clearOfSites(x, z)) continue;
    const gy = terrainHeight(x, z);
    const h = rand(3.5, 7.5), r = rand(0.8, 1.6);
    // trunk
    dummy.position.set(x, gy + h / 2, z);
    dummy.scale.set(1, h, 1);
    dummy.rotation.set(0, rand(0, Math.PI), rand(-0.05, 0.05));
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);
    // canopy
    dummy.position.set(x, gy + h + r * 0.9, z);
    dummy.scale.set(r, r * rand(1.4, 2.0), r);
    dummy.rotation.set(rand(-0.1, 0.1), rand(0, Math.PI), rand(-0.1, 0.1));
    dummy.updateMatrix();
    canopyInst.setMatrixAt(i, dummy.matrix);
    canopyInst.setColorAt(i, pick(cols));
    circleColliders.push({ x, z, r: 0.3 });
    i++;
  }
  trunkInst.count = i; canopyInst.count = i;
  if (canopyInst.instanceColor) canopyInst.instanceColor.needsUpdate = true;
  canopyInst.castShadow = true;
  scene.add(trunkInst); scene.add(canopyInst);
})();

/* ---- coral ground cover (the orange-red carpet from the refs) ---- */
(function coralCover() {
  const N = 600;
  const geo = new THREE.IcosahedronGeometry(0.3, 0);
  const inst = new THREE.InstancedMesh(geo, mat(0xffffff, { roughness: 1 }), N);
  const cols = [0xd4593c, 0xe06a4a, 0xc44a30, 0xe86a9e].map(c => new THREE.Color(c));
  const dummy = new THREE.Object3D();
  // grow in drifts around 40 cluster points
  const clusters = [];
  for (let c = 0; c < 40; c++) {
    const x = rand(-130, 130), z = rand(-130, 130);
    if (clearOfSites(x, z, 2.5)) clusters.push([x, z]);
  }
  let i = 0, guard = 0;
  while (i < N && guard++ < 4000 && clusters.length) {
    const [cx, cz] = pick(clusters);
    const x = cx + rand(-6, 6), z = cz + rand(-6, 6);
    if (!clearOfSites(x, z, 2.5)) continue;
    dummy.position.set(x, terrainHeight(x, z) + 0.1, z);
    dummy.scale.set(rand(0.6, 1.6), rand(0.4, 0.9), rand(0.6, 1.6));
    dummy.rotation.y = rand(0, Math.PI);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.setColorAt(i, pick(cols));
    i++;
  }
  inst.count = i;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);
})();

/* ---- pebbles & extra flower drifts ---- */
(function pebblesAndFlowers() {
  const dummy = new THREE.Object3D();
  const peb = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.22, 0), MAT.rock, 420);
  for (let i = 0; i < 420; i++) {
    const x = rand(-135, 135), z = rand(-135, 135);
    dummy.position.set(x, terrainHeight(x, z) + 0.08, z);
    dummy.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    dummy.scale.setScalar(rand(0.5, 1.8));
    dummy.updateMatrix(); peb.setMatrixAt(i, dummy.matrix);
  }
  peb.receiveShadow = true;
  scene.add(peb);
  // taller flowers on stems, 3 color groups
  for (const col of [0xffe08a, 0xe86a9e, 0x8ab8ff]) {
    const N = 220;
    const inst = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.14, 0),
      mat(col, { emissive: col, emissiveIntensity: 0.35 }), N);
    for (let i = 0; i < N; i++) {
      const x = rand(-130, 130), z = rand(-130, 130);
      dummy.position.set(x, terrainHeight(x, z) + rand(0.3, 0.7), z);
      dummy.scale.setScalar(rand(0.6, 1.3));
      dummy.rotation.y = rand(0, Math.PI);
      dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
    }
    scene.add(inst);
  }
})();

/* ---- more regular trees, rocks, arches, outcrops ---- */
(function moreNature() {
  const half = WORLD_SIZE / 2 - 8;
  let placed = 0, guard = 0;
  while (placed < 70 && guard++ < 900) {
    const x = rand(-half, half), z = rand(-half, half);
    if (!clearOfSites(x, z, 4)) continue;
    makeTree(x, z, rand(0.8, 1.7)); placed++;
  }
  for (let i = 0; i < 65; i++) {
    const x = rand(-half, half), z = rand(-half, half);
    if (!clearOfSites(x, z, 3)) continue;
    makeRock(x, z, rand(0.4, 2.2));
  }
  makeArch(48, 110, -0.4);
  makeArch(-125, -55, 0.2);
  makeOutcrop(-30, 120); makeOutcrop(130, 10);
  for (let i = 0; i < 26; i++) {
    const x = rand(-half, half), z = rand(-half, half);
    if (distToRoad(x, z) < 3) continue;
    makeMushrooms(x, z);
  }
})();

/* ---- extra roads: north arch loop & southeast trail ---- */
buildRoad([[TOWER_POS.x, TOWER_POS.z], [-20, -70], [10, -95], [30, -112]]);
buildRoad([[CAMPER_POS.x, CAMPER_POS.z], [85, 70], [110, 100]]);

/* =====================================================================
   NEW BUILDINGS — small outposts scattered through the wilds
   ===================================================================== */
function registerStructure(g, x, z, w, d, top) {
  g.position.set(x, terrainHeight(x, z), z);
  scene.add(g);
  addBoxCollider(x, z, w, d, top);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; cameraBlockers.push(o); losBlockers.push(o); } });
  return g;
}

/* ---- radar station: gray hut + slowly sweeping dish ---- */
(function radarStation() {
  const g = new THREE.Group();
  const hut = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, 3.4), MAT.grayLight);
  hut.position.y = 1.3; g.add(hut);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.4, 3.5), MAT.techBlue);
  stripe.position.y = 2.2; g.add(stripe);
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 0.2), MAT.windowGlow);
  win.position.set(0, 1.5, 1.75); g.add(win);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 2.4, 5), MAT.grayDark);
  mast.position.y = 3.8; g.add(mast);
  const dish = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.6, 8), MAT.grayLight);
  bowl.rotation.x = -Math.PI / 2.4; dish.add(bowl);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.0), MAT.redGlow);
  tip.rotation.x = -Math.PI / 2.4; tip.position.set(0, 0.25, 0.4); dish.add(tip);
  dish.position.y = 5.2; g.add(dish);
  envAnims.push(dt => { dish.rotation.y += dt * 0.7; });
  registerStructure(g, -95, -30, 5, 4, 4);
})();

/* ---- greenhouse dome: glowing alien plants under a frame dome ---- */
(function greenhouse() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.7, 8), MAT.grayMid);
  base.position.y = 0.35; g.add(base);
  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 1),
    mat(0x8fd8d0, { transparent: true, opacity: 0.24, roughness: 0.2 }));
  dome.scale.y = 0.75; dome.position.y = 0.7; g.add(dome);
  // frame ribs
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(3, 0.06, 4, 12, Math.PI), MAT.grayDark);
    rib.rotation.y = i * Math.PI / 5;
    rib.scale.y = 0.75; rib.position.y = 0.7;
    g.add(rib);
  }
  // glowing plants inside
  const plantMats = [MAT.crystal, MAT.bioGlow, MAT.cyanGlow];
  const plants = [];
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Mesh(new THREE.ConeGeometry(rand(0.2, 0.4), rand(0.6, 1.5), 5), pick(plantMats));
    p.position.set(rand(-2, 2), 0.7 + 0.4, rand(-2, 2));
    g.add(p); plants.push(p);
  }
  envAnims.push((dt, t) => {
    plants.forEach((p, i) => p.scale.y = 1 + Math.sin(t * 1.5 + i) * 0.08);
  });
  registerStructure(g, 85, 14, 7, 7, 4);
})();

/* ---- landing pad: hexagonal platform with blinking edge lights ---- */
(function landingPad() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.0, 0.6, 6), MAT.grayMid);
  pad.position.y = 0.3; g.add(pad);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.65, 6), MAT.grayDark);
  ring.position.y = 0.31; g.add(ring);
  const hMark = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.5), MAT.yellow);
  hMark.position.y = 0.64; g.add(hMark);
  const lights = [];
  for (let i = 0; i < 6; i++) {
    const l = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), MAT.cyanGlow.clone());
    const a = i * Math.PI / 3 + Math.PI / 6;
    l.position.set(Math.cos(a) * 4.3, 0.75, Math.sin(a) * 4.3);
    g.add(l); lights.push(l);
  }
  envAnims.push((dt, t) => {
    lights.forEach((l, i) => l.material.emissiveIntensity = 1 + Math.sin(t * 3 + i * 1.05) * 0.9);
  });
  const x = -40, z = 74;
  g.position.set(x, terrainHeight(x, z), z);
  scene.add(g);
  addPlatform(x, z, 8.4, 8.4, terrainHeight(x, z) + 0.62);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; cameraBlockers.push(o); } });
})();

/* ---- storage huts + a ruined shack ---- */
function storageHut(x, z, ry, colMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 2.6), colMat);
  body.position.y = 1.1; g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.35, 2.9), MAT.grayDark);
  roof.position.y = 2.35; g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.15), MAT.grayLight);
  door.position.set(0.6, 0.85, 1.34); g.add(door);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.14), MAT.windowGlow);
  lamp.position.set(-0.8, 1.9, 1.36); g.add(lamp);
  g.rotation.y = ry;
  registerStructure(g, x, z, 3.8, 3.2, 3);
}
storageHut(14, 20, 0.5, MAT.mustard);
storageHut(38, 36, -0.8, MAT.orange);
(function ruinedShack() {
  const g = new THREE.Group();
  const wall1 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.8, 0.3), MAT.wood);
  wall1.position.set(0, 0.9, -1.4); wall1.rotation.z = 0.06; g.add(wall1);
  const wall2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 2.8), MAT.wood);
  wall2.position.set(-1.7, 0.7, 0); wall2.rotation.x = -0.08; g.add(wall2);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 3.2), MAT.grayDark);
  roof.position.set(0.4, 1.9, 0); roof.rotation.z = -0.3; roof.rotation.x = 0.1; g.add(roof);
  for (let i = 0; i < 4; i++) {
    const deb = new THREE.Mesh(new THREE.BoxGeometry(rand(0.4, 1), 0.15, rand(0.3, 0.6)), MAT.wood);
    deb.position.set(rand(-2, 2.5), 0.1, rand(-1.5, 2));
    deb.rotation.y = rand(0, Math.PI); g.add(deb);
  }
  registerStructure(g, 110, -88, 4, 3.4, 2.4);
})();

/* ---- UI hover ticks (delegated so dynamic buttons count too) ---- */
document.addEventListener('mouseover', e => {
  if (e.target.closest && e.target.closest('.vbtn, .small-btn, .qbtn, .locbtn, .mbtn, .upg button'))
    SFX.hover();
});

/* ====================== PLAYER CHARACTER =========================== */
// Also used for remote co-op players (each gets a different suit color)
function buildPlayerMesh(suitColor = PAL.teal, trimColor = PAL.orange) {
  const suit = mat(suitColor), trim = mat(trimColor),
        dark = mat(0x3a3f4a), pack = mat(PAL.blue);
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.05, 0.5), suit);
  torso.position.y = 1.25; g.add(torso);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.02, 0.06), trim);
  stripe.position.set(0, 1.25, 0.26); g.add(stripe);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.55), dark);
  belt.position.y = 0.74; g.add(belt);
  const bp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.3), pack);
  bp.position.set(0, 1.35, -0.4); g.add(bp);
  const head = new THREE.Group();
  const helmet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), suit);
  helmet.scale.set(1, 0.95, 1); head.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.2), MAT.darkGlass);
  visor.position.set(0, -0.02, 0.32); head.add(visor);
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.7), trim);
  crest.position.y = 0.36; head.add(crest);
  head.position.y = 2.15; g.add(head);
  function arm(side) {
    const p = new THREE.Group();
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.5, 0.3), suit);
    up.position.y = -0.25; p.add(up);
    const lo = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.45, 0.26), trim);
    lo.position.y = -0.68; p.add(lo);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.28), suit);
    hand.position.y = -0.98; p.add(hand);
    p.position.set(side * 0.56, 1.72, 0); g.add(p);
    return p;
  }
  const armL = arm(-1), armR = arm(1);
  function leg(side) {
    const p = new THREE.Group();
    const th = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.34), suit);
    th.position.y = -0.25; p.add(th);
    const knee = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.36), trim);
    knee.position.y = -0.52; p.add(knee);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.35, 0.3), suit);
    sh.position.y = -0.78; p.add(sh);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.42), dark);
    boot.position.set(0, -1.02, 0.05); p.add(boot);
    p.position.set(side * 0.24, 0.72, 0); g.add(p);
    return p;
  }
  const legL = leg(-1), legR = leg(1);

  /* ---- four distinct weapon models, toggled by visibility ---- */
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true,
    opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const gunMats = { body: mat(0x2a7f74), dark, trim };
  function makeFlash(z) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), flashMat);
    f.position.set(0, 0.05, z); f.visible = false;
    return f;
  }
  function gunPistol() {
    const gg = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.6), gunMats.body); gg.add(b);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.14), gunMats.trim);
    grip.position.set(0, -0.2, -0.12); gg.add(grip);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.16), MAT.cyanGlow);
    cell.position.set(0, 0.13, 0); gg.add(cell);
    gg.userData.flashZ = 0.55;
    return gg;
  }
  function gunRifle() {
    const gg = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 1.05), gunMats.body); gg.add(b);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.5), gunMats.dark);
    barrel.position.set(0, 0.05, 0.72); gg.add(barrel);
    const magz = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.16), gunMats.dark);
    magz.position.set(0, -0.24, 0.1); gg.add(magz);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.2), MAT.cyanGlow);
    cell.position.set(0, 0.14, 0.05); gg.add(cell);
    gg.userData.flashZ = 1.0;
    return gg;
  }
  function gunShotgun() {
    const gg = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.9), mat(PAL.mustard)); gg.add(b);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.7), gunMats.dark);
    b2.position.set(0, -0.14, 0.15); gg.add(b2);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.3), gunMats.trim);
    pump.position.set(0, -0.13, 0.45); gg.add(pump);
    gg.userData.flashZ = 0.75;
    return gg;
  }
  function gunSniper() {
    const gg = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 1.5), mat(PAL.techBlue)); gg.add(b);
    const scopeM = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 6), gunMats.dark);
    scopeM.rotation.x = Math.PI / 2; scopeM.position.set(0, 0.17, 0.1); gg.add(scopeM);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.32), MAT.cyanGlow);
    cell.position.set(0, 0.07, -0.4); gg.add(cell);
    gg.userData.flashZ = 1.35;
    return gg;
  }
  const gunMeshes = [gunPistol(), gunRifle(), gunShotgun(), gunSniper()];
  const flashes = [];
  gunMeshes.forEach(gm => {
    const f1 = makeFlash(gm.userData.flashZ), f2 = makeFlash(gm.userData.flashZ);
    f2.rotation.z = Math.PI / 4;
    gm.add(f1); gm.add(f2);
    flashes.push([f1, f2]);
    gm.position.set(0, -1.0, 0.28);
    gm.rotation.x = Math.PI / 2;   // align barrel with the raised arm's forward axis
    gm.visible = false;
    armR.add(gm);
  });
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, armL, armR, legL, legR, head, gunMeshes, flashes };
}

/* ==================== WEAPONS DATA ================================= */
const WEAPONS = [
  { name: 'Pulse Pistol', dmg: 22, interval: 0.28, mag: 12, startReserve: 60,  auto: false, pellets: 1, spread: 0.006, tracer: 0xaff8e8, recoil: 0.8, range: 130, snd: 'firePistol' },
  { name: 'Assault Rifle', dmg: 12, interval: 0.095, mag: 30, startReserve: 150, auto: true,  pellets: 1, spread: 0.02,  tracer: 0xffe08a, recoil: 0.45, range: 140, snd: 'fireRifle' },
  { name: 'Scatter Gun',  dmg: 9,  interval: 0.85, mag: 6,  startReserve: 36,  auto: false, pellets: 7, spread: 0.065, tracer: 0xffb35c, recoil: 1.5, range: 45,  snd: 'fireShotgun' },
  { name: 'Lance Rifle',  dmg: 85, interval: 1.3,  mag: 5,  startReserve: 25,  auto: false, pellets: 1, spread: 0.0,   tracer: 0x8ab8ff, recoil: 1.7, range: 240, snd: 'fireSniper' },
];

/* ==================== PLAYER STATE ================================= */
const player = {
  mesh: buildPlayerMesh(),
  pos: new THREE.Vector3(-8, 0, 8),
  velY: 0, grounded: true,
  yaw: 2.4, pitch: -0.12,
  health: 100, maxHealth: 100,
  weapons: WEAPONS.map((w, i) => ({ unlocked: i === 0, mag: w.mag, reserve: w.startReserve })),
  cur: 0,
  reloading: false, reloadT: 0,
  res: { m: 12, e: 6, b: 0, cores: 0 },
  kills: 0, walkPhase: 0, moveAmount: 0, recoil: 0, hurtCd: 0, invuln: 0,
  upgrades: { vit: 0, dmg: 0, spd: 0, mag: 0, bld: 0 },
};
scene.add(player.mesh.group);
function curWeapon() { return WEAPONS[player.cur]; }
function curWState() { return player.weapons[player.cur]; }
function magSizeOf(i) { return Math.ceil(WEAPONS[i].mag * (player.upgrades.mag ? 1.5 : 1)); }
function dmgMult() { return player.upgrades.dmg ? 1.25 : 1; }
function speedMult() { return player.upgrades.spd ? 1.12 : 1; }
function costMult() { return player.upgrades.bld ? 0.75 : 1; }

function switchWeapon(i) {
  if (i === player.cur || !player.weapons[i] || !player.weapons[i].unlocked) return;
  player.cur = i; player.reloading = false;
  player.mesh.gunMeshes.forEach((gm, k) => gm.visible = k === i);
  SFX.click();
  updateAmmoUI(); updateWeaponSlotsUI();
}
function unlockWeapon(i) {
  if (player.weapons[i].unlocked) return;
  player.weapons[i].unlocked = true;
  SFX.unlock();
  showMessage('🔫 ' + WEAPONS[i].name + ' unlocked! (press ' + (i + 1) + ')');
  updateWeaponSlotsUI();
}

/* ========================= INPUT =================================== */
const keys = {};
let mouseDown = false, pointerLocked = false;
let dragLook = false, lastMX = 0, lastMY = 0;
let expectUnlock = false;   // set when we exit lock intentionally (journal etc.)

document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Tab') e.preventDefault();
  // explicit pause; the pointer-lock-exit path also pauses as a fallback
  if (e.code === 'Escape' && game.state === 'playing') {
    expectUnlock = true;
    if (document.exitPointerLock) document.exitPointerLock();
    pauseGame();
    return;
  }
  if (game.state === 'playing') {
    if (e.code === 'KeyR') startReload();
    if (e.code === 'KeyB') toggleBuildMode();
    if (e.code === 'KeyE') tryInteract();
    if (e.code === 'KeyQ') tryScan();
    if (e.code === 'Tab' || e.code === 'KeyJ') openJournal();
    if (buildMode) {
      for (let i = 0; i < 8; i++) if (e.code === 'Digit' + (i + 1)) selectBuild(i);
    } else {
      for (let i = 0; i < 4; i++) if (e.code === 'Digit' + (i + 1)) switchWeapon(i);
    }
  } else if (game.state === 'journal' && (e.code === 'Tab' || e.code === 'KeyJ' || e.code === 'Escape')) {
    closeJournal();
  }
});
document.addEventListener('keyup', e => keys[e.code] = false);

canvas.addEventListener('mousedown', e => {
  if (game.state !== 'playing') return;
  if (e.button === 0) {
    if (!pointerLocked) { requestLock(); dragLook = true; lastMX = e.clientX; lastMY = e.clientY; }
    mouseDown = true;
    if (buildMode) placeBuild();
  }
});
document.addEventListener('mouseup', () => { mouseDown = false; dragLook = false; });
document.addEventListener('mousemove', e => {
  if (game.state !== 'playing') return;
  let dx = 0, dy = 0;
  if (pointerLocked) { dx = e.movementX; dy = e.movementY; }
  else if (dragLook) { dx = e.clientX - lastMX; dy = e.clientY - lastMY; lastMX = e.clientX; lastMY = e.clientY; }
  else return;
  const s = 0.0024 * (settings.sens / 100);
  player.yaw -= dx * s;
  player.pitch += (settings.invertY ? dy : -dy) * s * 0.92;
  player.pitch = clamp(player.pitch, -0.9, 0.55);
});
document.addEventListener('wheel', e => {
  if (game.state !== 'playing') return;
  if (buildMode && ghost) { ghost.rotation.y += (e.deltaY > 0 ? 1 : -1) * Math.PI / 4; return; }
  // scroll cycles unlocked weapons
  const dir = e.deltaY > 0 ? 1 : -1;
  for (let k = 1; k <= 4; k++) {
    const i = (player.cur + dir * k + 8) % 4;
    if (player.weapons[i].unlocked) { switchWeapon(i); break; }
  }
});
function requestLock() { if (canvas.requestPointerLock) canvas.requestPointerLock(); }
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked && game.state === 'playing' && !expectUnlock) pauseGame();
  expectUnlock = false;
});

/* ==================== THIRD-PERSON CAMERA ========================== */
const camRay = new THREE.Raycaster();
function updateCamera(dt) {
  const target = player.pos.clone().add(new THREE.Vector3(0, 2.1, 0));
  const dist = 5.6;
  const off = new THREE.Vector3(
    Math.sin(player.yaw) * Math.cos(player.pitch),
    -Math.sin(player.pitch) + 0.25,
    Math.cos(player.yaw) * Math.cos(player.pitch)
  ).normalize().multiplyScalar(-dist);
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  let camPos = target.clone().add(off).add(right.clone().multiplyScalar(0.9));
  const dir = camPos.clone().sub(target);
  const len = dir.length(); dir.normalize();
  camRay.set(target, dir); camRay.far = len;
  const hits = camRay.intersectObjects(cameraBlockers, false);
  if (hits.length) camPos = target.clone().add(dir.multiplyScalar(Math.max(hits[0].distance - 0.35, 0.8)));
  camPos.y = Math.max(camPos.y, terrainHeight(camPos.x, camPos.z) + 0.5);
  camera.position.lerp(camPos, 1 - Math.pow(0.0001, dt));
  const look = target.clone().add(new THREE.Vector3(
    Math.sin(player.yaw) * Math.cos(player.pitch),
    -Math.sin(player.pitch),
    Math.cos(player.yaw) * Math.cos(player.pitch)).multiplyScalar(8));
  camera.lookAt(look);
}

/* ==================== PLAYER UPDATE ================================ */
function updatePlayer(dt) {
  const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(fwd);
  if (keys['KeyS']) move.sub(fwd);
  if (keys['KeyA']) move.sub(right);
  if (keys['KeyD']) move.add(right);
  const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
  let speed = PLAYER_SPEED * speedMult() * (sprint ? SPRINT_MULT : 1);
  if (move.lengthSq() > 0) move.normalize();
  player.moveAmount += ((move.lengthSq() > 0 ? (sprint ? 1.5 : 1) : 0) - player.moveAmount) * Math.min(dt * 10, 1);

  player.pos.x += move.x * speed * dt;
  player.pos.z += move.z * speed * dt;
  const push = circleVsColliders(player.pos.x, player.pos.z, 0.55, player.pos.y);
  player.pos.x += push.x; player.pos.z += push.z;
  const B = WORLD_SIZE/2 - 3;
  player.pos.x = clamp(player.pos.x, -B, B);
  player.pos.z = clamp(player.pos.z, -B, B);

  const groundY = groundYAt(player.pos.x, player.pos.z, player.pos.y);
  const fallSpeed = player.velY;
  player.velY -= GRAVITY * dt;
  player.pos.y += player.velY * dt;
  if (player.pos.y <= groundY) {
    if (!player.grounded && fallSpeed < -5) SFX.land();
    player.pos.y = groundY; player.velY = 0; player.grounded = true;
  } else player.grounded = false;
  if (keys['Space'] && player.grounded) { player.velY = JUMP_VEL; player.grounded = false; SFX.jump(); }

  const m = player.mesh;
  m.group.position.copy(player.pos);
  m.group.rotation.y = player.yaw;

  const prevStep = Math.floor(player.walkPhase / Math.PI);
  player.walkPhase += dt * speed * 1.35 * player.moveAmount;
  // footstep on each stride while grounded
  if (player.grounded && player.moveAmount > 0.3 &&
      Math.floor(player.walkPhase / Math.PI) !== prevStep) SFX.step();
  const s = Math.sin(player.walkPhase), amp = 0.55 * Math.min(player.moveAmount, 1.2);
  m.legL.rotation.x = s * amp;
  m.legR.rotation.x = -s * amp;
  m.armL.rotation.x = -s * amp * 0.8;
  m.group.position.y += Math.abs(Math.cos(player.walkPhase)) * 0.07 * player.moveAmount;
  player.recoil = Math.max(0, player.recoil - dt * 9);
  m.armR.rotation.x = -Math.PI / 2 + player.pitch * 0.8 - player.recoil * 0.55;
  m.head.rotation.x = -player.pitch * 0.45;
  if (player.reloading) m.armL.rotation.x = -1.2 + Math.sin(game.time * 14) * 0.25;

  if (mouseDown && !buildMode && (curWeapon().auto || !shotLatch)) tryShoot();
  if (!mouseDown) shotLatch = false;

  if (player.reloading) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) {
      const ws = curWState();
      const need = magSizeOf(player.cur) - ws.mag, take = Math.min(need, ws.reserve);
      ws.mag += take; ws.reserve -= take; player.reloading = false;
      updateAmmoUI();
    }
  }
  player.hurtCd = Math.max(0, player.hurtCd - dt);
  player.invuln = Math.max(0, player.invuln - dt);
}

/* ====================== SHOOTING =================================== */
let fireCd = 0, flashT = 0, shotLatch = false;
const shootRay = new THREE.Raycaster();
const noise = { x: 0, z: 0, t: -99 };   // last gunshot, for AI investigation

function startReload() {
  const ws = curWState();
  if (player.reloading || ws.mag === magSizeOf(player.cur) || ws.reserve <= 0) return;
  player.reloading = true; player.reloadT = 1.25;
  $('reload-hint').textContent = 'RELOADING…';
  SFX.reload();
}
function gunTipWorld() {
  const v = new THREE.Vector3();
  player.mesh.flashes[player.cur][0].getWorldPosition(v);
  return v;
}
function tryShoot() {
  if (fireCd > 0 || player.reloading) return;
  const w = curWeapon(), ws = curWState();
  shotLatch = true;
  if (ws.mag <= 0) {
    if (ws.reserve > 0) startReload(); else SFX.deny();
    fireCd = 0.3; return;
  }
  fireCd = w.interval;
  ws.mag--; updateAmmoUI();
  player.recoil = w.recoil; flashT = 0.05;
  player.mesh.flashes[player.cur].forEach(f => { f.visible = true; f.rotation.z = rand(0, Math.PI); });
  SFX[w.snd]();
  noise.x = player.pos.x; noise.z = player.pos.z; noise.t = game.time;

  const enemyMeshes = [];
  for (const e of enemies) if (e.alive) enemyMeshes.push(e.mesh);
  const tip = gunTipWorld();
  for (let p = 0; p < w.pellets; p++) {
    shootRay.setFromCamera({ x: 0, y: 0 }, camera);
    if (w.spread > 0) {
      shootRay.ray.direction.x += rand(-w.spread, w.spread);
      shootRay.ray.direction.y += rand(-w.spread, w.spread);
      shootRay.ray.direction.z += rand(-w.spread, w.spread);
      shootRay.ray.direction.normalize();
    }
    shootRay.far = w.range;
    const eHits = shootRay.intersectObjects(enemyMeshes, true);
    const wHits = shootRay.intersectObjects(losBlockers, false);
    let hitPoint = shootRay.ray.at(w.range * 0.6, new THREE.Vector3());
    let hitEnemy = null;
    const eDist = eHits.length ? eHits[0].distance : Infinity;
    const wDist = wHits.length ? wHits[0].distance : Infinity;
    if (eDist < wDist) {
      hitPoint = eHits[0].point;
      let o = eHits[0].object;
      while (o && !o.userData.enemy) o = o.parent;
      if (o) hitEnemy = o.userData.enemy;
    } else if (wHits.length) hitPoint = wHits[0].point;
    spawnTracer(tip, hitPoint, w.tracer);
    spawnImpact(hitPoint, hitEnemy ? 0xff8a5c : 0xd8c8b8);
    if (p === 0) netFire(tip, hitPoint, w.tracer);   // share the shot in co-op
    if (hitEnemy) {
      const dmg = Math.round(w.dmg * dmgMult());
      damageEnemy(hitEnemy, dmg);
      spawnDamageNumber(hitPoint, dmg);
      flashHitmarker();
    }
  }
}
function flashHitmarker() {
  const h = $('hitmarker');
  h.style.opacity = 1;
  clearTimeout(h._t);
  h._t = setTimeout(() => h.style.opacity = 0, 90);
}

/* ---- tracers ---- */
const tracers = [];
const tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
function spawnTracer(a, b, color) {
  const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
    color: color || 0xaff8e8, transparent: true, opacity: 0.9, depthWrite: false }));
  const len = a.distanceTo(b);
  m.position.copy(a).lerp(b, 0.5);
  m.lookAt(b); m.scale.z = len;
  scene.add(m);
  tracers.push({ mesh: m, life: 0.07 });
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.mesh.material.opacity = Math.max(t.life / 0.07, 0) * 0.9;
    if (t.life <= 0) { scene.remove(t.mesh); t.mesh.material.dispose(); tracers.splice(i, 1); }
  }
}

/* ================== PARTICLES (pooled) ============================= */
const particlePool = [];
(function () {
  const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  for (let i = 0; i < 150; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    m.visible = false; scene.add(m);
    particlePool.push({ mesh: m, vel: new THREE.Vector3(), life: 0, maxLife: 1, active: false, grav: 1 });
  }
})();
function emit(pos, color, count, speed, life, size = 1, grav = 1) {
  let n = 0;
  for (const p of particlePool) {
    if (p.active) continue;
    p.active = true; p.mesh.visible = true;
    p.mesh.position.copy(pos);
    p.mesh.material.color.setHex(color);
    p.mesh.material.opacity = 1;
    p.mesh.scale.setScalar(rand(0.5, 1.4) * size);
    p.vel.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
    p.life = p.maxLife = life * rand(0.6, 1.2);
    p.grav = grav;
    if (++n >= count) break;
  }
}
function updateParticles(dt) {
  for (const p of particlePool) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) { p.active = false; p.mesh.visible = false; continue; }
    p.vel.y -= 9 * p.grav * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.rotation.x += dt * 5; p.mesh.rotation.y += dt * 7;
    p.mesh.material.opacity = p.life / p.maxLife;
  }
}
function spawnImpact(pos, color) { emit(pos, color, 6, 4, 0.4, 0.7); }

/* ---- floating damage numbers (DOM, projected each frame) ---- */
const dmgNums = [];
(function () {
  const cont = $('dmg-container');
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.className = 'dmgnum';
    cont.appendChild(el);
    dmgNums.push({ el, wp: new THREE.Vector3(), life: 0, active: false });
  }
})();
function spawnDamageNumber(pos, dmg) {
  for (const d of dmgNums) {
    if (d.active) continue;
    d.active = true; d.life = 0.8;
    d.wp.copy(pos); d.wp.y += rand(0, 0.4);
    d.el.textContent = dmg;
    d.el.style.display = 'block';
    return;
  }
}
const projV = new THREE.Vector3();
function updateDamageNumbers(dt) {
  const w = window.innerWidth, h = window.innerHeight;
  for (const d of dmgNums) {
    if (!d.active) continue;
    d.life -= dt;
    d.wp.y += dt * 1.6;
    if (d.life <= 0) { d.active = false; d.el.style.display = 'none'; continue; }
    projV.copy(d.wp).project(camera);
    if (projV.z > 1) { d.el.style.display = 'none'; continue; }
    d.el.style.display = 'block';
    d.el.style.left = ((projV.x * 0.5 + 0.5) * w) + 'px';
    d.el.style.top = ((-projV.y * 0.5 + 0.5) * h) + 'px';
    d.el.style.opacity = Math.min(d.life / 0.3, 1);
  }
}

/* ===================== ENEMY PROJECTILES =========================== */
const eProjPool = [];
(function () {
  const geo = new THREE.SphereGeometry(0.16, 6, 4);
  const m0 = new THREE.MeshBasicMaterial({ color: 0xff4a5c });
  for (let i = 0; i < 44; i++) {
    const m = new THREE.Mesh(geo, m0);
    m.visible = false; scene.add(m);
    eProjPool.push({ mesh: m, vel: new THREE.Vector3(), life: 0, active: false, damage: 8 });
  }
})();
function enemyShoot(from, to, speed = 26, damage = 9) {
  for (const p of eProjPool) {
    if (p.active) continue;
    p.active = true; p.mesh.visible = true;
    p.mesh.position.copy(from);
    p.vel.copy(to).sub(from).normalize();
    p.vel.x += rand(-0.05, 0.05); p.vel.y += rand(-0.03, 0.03); p.vel.z += rand(-0.05, 0.05);
    p.vel.normalize().multiplyScalar(speed);
    p.life = 3; p.damage = damage;
    return;
  }
}
function updateEnemyProjectiles(dt) {
  const pCenter = player.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
  for (const p of eProjPool) {
    if (!p.active) continue;
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    const mp = p.mesh.position;
    if (p.life <= 0 || mp.y < terrainHeight(mp.x, mp.z)) {
      spawnImpact(mp, 0xff4a5c); p.active = false; p.mesh.visible = false; continue;
    }
    const hitBox = pointInBoxColliders(mp.x, mp.y, mp.z);
    if (hitBox) {
      if (hitBox.owner) damageBuilding(hitBox.owner, p.damage);   // buildings take fire
      spawnImpact(mp, 0xff4a5c); p.active = false; p.mesh.visible = false; continue;
    }
    if (mp.distanceToSquared(pCenter) < 1.1) {
      p.active = false; p.mesh.visible = false;
      damagePlayer(p.damage);
      spawnImpact(mp, 0xff4a5c);
    }
  }
}
function damagePlayer(dmg) {
  if (game.state !== 'playing' || player.invuln > 0) return;
  player.health -= dmg;
  player.hurtCd = 0.4;
  SFX.hurt();
  const v = $('damage-vignette');
  v.style.opacity = 1;
  setTimeout(() => v.style.opacity = 0, 220);
  updateHealthUI();
  if (player.health <= 0) onDeath();
}

/* ========================= ENEMIES ================================= */
// 4 types: stalker (ranged walker), scout (fast melee), heavy (slow tank),
// wasp (flying shooter). States: patrol/investigate/chase/attack/retreat.
const enemies = [];
const losRay = new THREE.Raycaster();
const ETYPES = {
  stalker: { hp: 60,  speed: 3.6, detectR: 26, attackR: 19, dmg: 9,  fireA: 1.0, fireB: 1.7, ranged: true,  drop: [3, 2] },
  scout:   { hp: 30,  speed: 6.8, detectR: 30, attackR: 2.4, dmg: 8, ranged: false, drop: [2, 1] },
  heavy:   { hp: 170, speed: 2.4, detectR: 24, attackR: 22, dmg: 16, fireA: 1.8, fireB: 2.3, ranged: true, drop: [6, 4] },
  wasp:    { hp: 40,  speed: 6.0, detectR: 28, attackR: 16, dmg: 8,  fireA: 1.1, fireB: 1.6, ranged: true, fly: true, drop: [2, 3] },
};
function buildStalkerMesh(scale = 1, heavy = false) {
  const g = new THREE.Group();
  const bodyMat = mat(heavy ? 0x4a3f52 : PAL.grayMid);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.3), bodyMat);
  body.position.y = 1.0; body.castShadow = true; g.add(body);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 1.0), mat(heavy ? PAL.magenta : PAL.orange));
  plate.position.y = 1.5; g.add(plate);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.1), MAT.redGlow);
  eye.position.set(0, 1.1, 0.68); g.add(eye);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.4), mat(PAL.grayDark));
  legL.position.set(-0.38, 0.35, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.38; g.add(legR);
  const gunL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.8), mat(PAL.grayDark));
  gunL.position.set(-0.62, 1.05, 0.3); g.add(gunL);
  const gunR = gunL.clone(); gunR.position.x = 0.62; g.add(gunR);
  g.scale.setScalar(scale);
  return { group: g, bodyMat, legs: [legL, legR] };
}
function buildScoutMesh() {
  const g = new THREE.Group();
  const bodyMat = mat(PAL.orange);
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), bodyMat);
  body.position.y = 0.75; body.scale.set(1, 0.8, 1.4); body.castShadow = true; g.add(body);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 4), MAT.redGlow);
  eye.position.set(0, 0.8, 0.6); g.add(eye);
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 4), mat(PAL.grayDark));
  blade.rotation.x = Math.PI / 2; blade.position.set(0, 0.55, 0.7); g.add(blade);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.25), mat(PAL.grayDark));
  legL.position.set(-0.3, 0.28, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.3; g.add(legR);
  return { group: g, bodyMat, legs: [legL, legR] };
}
function buildWaspMesh() {
  const g = new THREE.Group();
  const bodyMat = mat(PAL.grayLight);
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), bodyMat);
  body.scale.set(1.2, 0.7, 1.2); body.castShadow = true; g.add(body);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), MAT.redGlow);
  eye.position.set(0, -0.1, 0.5); g.add(eye);
  const rotors = [];
  for (const [rx, rz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.08), mat(PAL.grayDark));
    arm.position.set(rx * 0.7, 0.15, rz * 0.7); g.add(arm);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.12), mat(PAL.teal));
    rotor.position.set(rx, 0.25, rz); g.add(rotor); rotors.push(rotor);
  }
  return { group: g, bodyMat, rotors };
}
function spawnEnemy(type, x, z) {
  const T = ETYPES[type];
  const built = type === 'wasp' ? buildWaspMesh()
    : type === 'scout' ? buildScoutMesh()
    : buildStalkerMesh(type === 'heavy' ? 1.45 : 1, type === 'heavy');
  const e = {
    type, T, alive: true, mesh: built.group, parts: built,
    hp: T.hp, maxHp: T.hp, speed: T.speed,
    state: 'patrol',
    home: new THREE.Vector3(x, 0, z),
    wp: new THREE.Vector3(x + rand(-10, 10), 0, z + rand(-10, 10)),
    fireCd: rand(0.5, 1.5),
    flyH: rand(3.5, 5.5),
    flash: 0, t: rand(0, 10),
    alerted: false, retreated: false, retreatT: 0,
    meleeCd: 0, invT: 0, buildingHitT: 0,
  };
  e.mesh.position.set(x, terrainHeight(x, z) + (T.fly ? e.flyH : 0), z);
  e.mesh.traverse(o => o.userData.enemy = e);
  e.mesh.userData.enemy = e;
  scene.add(e.mesh);
  enemies.push(e);
  return e;
}
function damageEnemy(e, dmg) {
  if (!e.alive) return;
  e.hp -= dmg;
  e.flash = 0.12;
  SFX.hit();
  if (e.state === 'patrol' || e.state === 'investigate') {
    e.state = 'chase';
    alertNearby(e);
    if (!e.alerted) { e.alerted = true; SFX.alert(); }
  }
  // wounded non-heavies fall back once
  if (e.hp > 0 && e.hp < e.maxHp * 0.25 && !e.retreated && e.type !== 'heavy') {
    e.retreated = true; e.state = 'retreat'; e.retreatT = 2.6;
  }
  if (e.hp <= 0) killEnemy(e);
}
function alertNearby(src) {
  for (const o of enemies) {
    if (!o.alive || o === src || o.state !== 'patrol') continue;
    if (o.mesh.position.distanceTo(src.mesh.position) < 16) {
      o.state = 'investigate'; o.invT = 6;
      o.wp.set(player.pos.x, 0, player.pos.z);
    }
  }
}
function killEnemy(e) {
  e.alive = false;
  scene.remove(e.mesh);
  SFX.explode();
  const p = e.mesh.position;
  emit(p, 0xff8a3c, 14, 7, 0.8, 1.4);
  emit(p, 0x3a4048, 10, 5, 1.1, 1.2);
  emit(p, 0xff2a3c, 6, 8, 0.5, 0.8);
  player.kills++;
  recKill();
  player.res.m += randI(e.T.drop[0] - 1, e.T.drop[0] + 2);
  player.res.e += randI(e.T.drop[1] - 1, e.T.drop[1] + 1);
  updateCountersUI();
  onEnemyKilled(e);
}
function updateEnemies(dt) {
  const pPos = player.pos;
  for (const e of enemies) {
    if (!e.alive) continue;
    e.t += dt;
    const m = e.mesh;
    const distToPlayer = m.position.distanceTo(pPos);

    if (e.flash > 0) {
      e.flash -= dt;
      e.parts.bodyMat.emissive = new THREE.Color(0xff2a3c);
      e.parts.bodyMat.emissiveIntensity = e.flash > 0 ? 1.2 : 0;
    } else e.parts.bodyMat.emissiveIntensity = 0;

    // perception
    let seesPlayer = false;
    if (distToPlayer < e.T.detectR) {
      const eye = m.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      const tgt = pPos.clone().add(new THREE.Vector3(0, 1.4, 0));
      const dir = tgt.clone().sub(eye), len = dir.length();
      losRay.set(eye, dir.normalize()); losRay.far = len;
      seesPlayer = losRay.intersectObjects(losBlockers, false).length === 0;
    }
    // hear gunfire
    if (e.state === 'patrol' && game.time - noise.t < 4 &&
        Math.hypot(m.position.x - noise.x, m.position.z - noise.z) < 34) {
      e.state = 'investigate'; e.invT = 7;
      e.wp.set(noise.x, 0, noise.z);
    }

    if (e.state === 'patrol') {
      if (seesPlayer) { e.state = 'chase'; alertNearby(e); if (!e.alerted) { e.alerted = true; SFX.alert(); } }
      else {
        moveEnemyToward(e, e.wp, e.speed * 0.5, dt);
        if (m.position.distanceTo(new THREE.Vector3(e.wp.x, m.position.y, e.wp.z)) < 1.5)
          e.wp.set(e.home.x + rand(-12, 12), 0, e.home.z + rand(-12, 12));
      }
    } else if (e.state === 'investigate') {
      e.invT -= dt;
      if (seesPlayer) { e.state = 'chase'; alertNearby(e); if (!e.alerted) { e.alerted = true; SFX.alert(); } }
      else {
        moveEnemyToward(e, e.wp, e.speed * 0.8, dt);
        if (e.invT <= 0 || m.position.distanceTo(new THREE.Vector3(e.wp.x, m.position.y, e.wp.z)) < 2)
          e.state = 'patrol';
      }
    } else if (e.state === 'retreat') {
      e.retreatT -= dt;
      const away = m.position.clone().sub(pPos); away.y = 0;
      const tgt = m.position.clone().add(away.normalize().multiplyScalar(8));
      moveEnemyToward(e, tgt, e.speed * 1.1, dt);
      if (e.retreatT <= 0) e.state = 'chase';
    } else if (e.state === 'chase') {
      if (distToPlayer < e.T.attackR && (seesPlayer || !e.T.ranged)) e.state = 'attack';
      else if (distToPlayer > e.T.detectR * 1.8) e.state = 'patrol';
      else moveEnemyToward(e, pPos, e.speed, dt);
    } else if (e.state === 'attack') {
      if (distToPlayer > e.T.attackR * 1.2 || (e.T.ranged && !seesPlayer)) e.state = 'chase';
      m.rotation.y = Math.atan2(pPos.x - m.position.x, pPos.z - m.position.z);
      if (e.T.ranged) {
        if (e.type === 'wasp') moveEnemyToward(e, pPos, e.speed * 0.3, dt, true);
        e.fireCd -= dt;
        if (e.fireCd <= 0 && seesPlayer) {
          e.fireCd = rand(e.T.fireA, e.T.fireB);
          const from = m.position.clone().add(new THREE.Vector3(0, e.T.fly ? -0.2 : 1.1, 0));
          enemyShoot(from, pPos.clone().add(new THREE.Vector3(0, 1.3, 0)), 26, e.T.dmg);
          SFX.turret();
        }
      } else {
        // scout: rush in, slash, dart away
        moveEnemyToward(e, pPos, e.speed, dt);
        e.meleeCd -= dt;
        if (distToPlayer < 1.9 && e.meleeCd <= 0) {
          e.meleeCd = 1.1;
          damagePlayer(e.T.dmg);
          emit(pPos.clone().add(new THREE.Vector3(0, 1, 0)), 0xff4a5c, 5, 4, 0.3);
        }
      }
    }

    // locomotion cosmetics
    if (e.T.fly) {
      const gh = terrainHeight(m.position.x, m.position.z);
      m.position.y = gh + e.flyH + Math.sin(e.t * 3) * 0.4;
      for (const r of e.parts.rotors) r.rotation.y += dt * 30;
    } else {
      m.position.y = terrainHeight(m.position.x, m.position.z);
      const walk = Math.sin(e.t * 8) * 0.3;
      if (e.parts.legs) { e.parts.legs[0].rotation.x = walk; e.parts.legs[1].rotation.x = -walk; }
      m.position.y += Math.abs(Math.sin(e.t * 8)) * 0.05;
    }
    if (distToPlayer < 1.5 && player.hurtCd <= 0 && e.type !== 'scout') damagePlayer(6);

    // gnaw at buildings they bump into
    e.buildingHitT -= dt;
    if (e.buildingHitT <= 0) {
      for (const b of buildings) {
        if (!b.alive) continue;
        const c = b.collider;
        if (m.position.x > c.minX - 0.9 && m.position.x < c.maxX + 0.9 &&
            m.position.z > c.minZ - 0.9 && m.position.z < c.maxZ + 0.9) {
          damageBuilding(b, 6);
          e.buildingHitT = 1.0;
          break;
        }
      }
    }
  }
}
function moveEnemyToward(e, target, speed, dt, strafe = false) {
  const m = e.mesh;
  const dir = new THREE.Vector3(target.x - m.position.x, 0, target.z - m.position.z);
  if (dir.lengthSq() < 0.01) return;
  dir.normalize();
  if (strafe) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(e.t * 0.7) > 0 ? 1.2 : -1.2);
  m.position.x += dir.x * speed * dt;
  m.position.z += dir.z * speed * dt;
  const push = circleVsColliders(m.position.x, m.position.z, 0.7, m.position.y);
  m.position.x += push.x; m.position.z += push.z;
  if (!strafe) m.rotation.y = Math.atan2(dir.x, dir.z);
}
// difficulty curve: gentle enemies near the hub, nastier ones far out
function spawnAmbientEnemy() {
  const alive = enemies.filter(e => e.alive).length;
  if (alive >= 13) return;
  const a = rand(0, Math.PI * 2), r = rand(48, 70);
  const x = clamp(player.pos.x + Math.cos(a) * r, -WORLD_SIZE/2 + 10, WORLD_SIZE/2 - 10);
  const z = clamp(player.pos.z + Math.sin(a) * r, -WORLD_SIZE/2 + 10, WORLD_SIZE/2 - 10);
  const hubDist = Math.hypot(x - CAMPER_POS.x, z - CAMPER_POS.z);
  const type = hubDist < 65
    ? pick(['stalker', 'stalker', 'wasp'])
    : pick(['stalker', 'scout', 'scout', 'wasp', 'heavy']);
  spawnEnemy(type, x, z);
}

/* ========================= WILDLIFE ================================ */
// turtles, slugs, blobs (ground wanderers) + butterflies & birds (air)
const wildlife = [];
const eyeGeo = new THREE.SphereGeometry(0.09, 6, 4);
const eyeMat = mat(0x101418);
const LORE = {
  turtle: 'Shellback Grazer — its shell mineralizes the pink dust into armor.',
  slug: 'Dune Slug — leaves a faintly luminescent trail at night.',
  blob: 'Pufflet — communicates by bouncing. Nobody knows what it says.',
  butterfly: 'Glasswing Flit — drawn to gunfire vibrations, oddly enough.',
  bird: 'Sky Skimmer — nests on the old tower. Unbothered by drones.',
  strider: 'Dune Strider — a gentle stilt-legged grazer. Hums when calm.',
};
function makeStrider() {
  const g = new THREE.Group();
  const col = mat(pick([PAL.blue, PAL.teal, PAL.mustard]));
  const dark = mat(PAL.grayDark);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 1.5), col);
  body.position.y = 1.7; body.castShadow = true; g.add(body);
  const legs = [];
  for (const [lx, lz] of [[-0.3, 0.55], [0.3, 0.55], [-0.3, -0.55], [0.3, -0.55]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), dark);
    leg.position.set(lx, 0.75, lz); g.add(leg); legs.push(leg);
  }
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), col);
  neck.position.set(0, 2.35, 0.7); neck.rotation.x = 0.4; g.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.55), col);
  head.position.set(0, 2.75, 0.95); g.add(head);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat); e.scale.setScalar(0.7);
    e.position.set(s * 0.14, 2.8, 1.2); g.add(e);
  }
  return { g, species: 'strider', speed: 1.1, legs };
}
function makeTurtle(x, z) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 4), mat(pick([PAL.teal, PAL.blue])));
  shell.scale.set(1.15, 0.62, 1.3); shell.position.y = 0.42; shell.castShadow = true; g.add(shell);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.34), mat(PAL.mint));
  head.position.set(0, 0.3, 0.75); g.add(head);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat); e.scale.setScalar(0.7);
    e.position.set(s * 0.1, 0.36, 0.9); g.add(e);
  }
  return { g, species: 'turtle', speed: 0.7 };
}
function makeSlug(x, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4), mat(pick([PAL.pink, PAL.magenta])));
  body.scale.set(0.8, 0.62, 1.7); body.position.y = 0.25; g.add(body);
  for (const s of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 4), mat(PAL.pink));
    stalk.position.set(s * 0.14, 0.6, 0.5); stalk.rotation.z = -s * 0.3; g.add(stalk);
    const e = new THREE.Mesh(eyeGeo, eyeMat); e.scale.setScalar(0.65);
    e.position.set(s * 0.2, 0.78, 0.52); g.add(e);
  }
  return { g, species: 'slug', speed: 0.35 };
}
function makeBlob(x, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), mat(pick([PAL.teal, PAL.mint, PAL.pink, PAL.yellow])));
  body.scale.y = 0.85; body.position.y = 0.4; body.castShadow = true; g.add(body);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(s * 0.16, 0.5, 0.38); g.add(e);
  }
  return { g, species: 'blob', speed: 2, hops: true };
}
function makeButterfly() {
  const g = new THREE.Group();
  const wMat = mat(pick([PAL.cyanGlow && 0x54e0e8, PAL.pink, PAL.yellow, PAL.mint]),
    { emissive: 0x333344, side: THREE.DoubleSide });
  const wingGeo = new THREE.PlaneGeometry(0.34, 0.26);
  const w1 = new THREE.Mesh(wingGeo, wMat); w1.position.x = -0.17; g.add(w1);
  const w2 = new THREE.Mesh(wingGeo, wMat); w2.position.x = 0.17; g.add(w2);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), eyeMat); g.add(body);
  return { g, species: 'butterfly', speed: 1.6, fly: true, wings: [w1, w2] };
}
function makeBird() {
  const g = new THREE.Group();
  const bMat = mat(pick([PAL.blue, PAL.teal, 0xf0f0f0]));
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 4), bMat);
  body.rotation.x = Math.PI / 2; g.add(body);
  const wingGeo = new THREE.PlaneGeometry(0.7, 0.24);
  const w1 = new THREE.Mesh(wingGeo, bMat); w1.position.x = -0.36; g.add(w1);
  const w2 = new THREE.Mesh(wingGeo, bMat); w2.position.x = 0.36; g.add(w2);
  return { g, species: 'bird', speed: 6, fly: true, wings: [w1, w2] };
}
function spawnWildlife() {
  const makers = [[makeTurtle, 8], [makeSlug, 8], [makeBlob, 10], [makeStrider, 6]];
  for (const [mk, n] of makers)
    for (let i = 0; i < n; i++) {
      const x = rand(-100, 100), z = rand(-100, 100);
      const c = mk(x, z);
      c.g.position.set(x, terrainHeight(x, z), z);
      scene.add(c.g);
      wildlife.push({ mesh: c.g, species: c.species, speed: c.speed, hops: !!c.hops,
        legs: c.legs || null,
        fly: false, dir: rand(0, Math.PI * 2), t: rand(0, 4), hop: 0, scanned: false, wings: null });
    }
  for (let i = 0; i < 14; i++) {
    const c = makeButterfly();
    const x = rand(-90, 90), z = rand(-90, 90);
    c.g.position.set(x, terrainHeight(x, z) + rand(1, 2.5), z);
    scene.add(c.g);
    wildlife.push({ mesh: c.g, species: 'butterfly', speed: c.speed, fly: true, wings: c.wings,
      dir: rand(0, Math.PI * 2), t: rand(0, 4), baseY: rand(1.2, 2.6), scanned: false });
  }
  for (let i = 0; i < 10; i++) {
    const c = makeBird();
    const cx = pick([-40, 30]), cz = pick([-60, 40]);
    scene.add(c.g);
    wildlife.push({ mesh: c.g, species: 'bird', speed: c.speed, fly: true, bird: true, wings: c.wings,
      cx, cz, rad: rand(18, 34), ang: rand(0, Math.PI * 2), h: rand(12, 22), scanned: false, t: 0 });
  }
}
let chirpT = 3;
function updateWildlife(dt) {
  // ambient chirps from creatures near the player
  chirpT -= dt;
  if (chirpT <= 0) {
    chirpT = rand(2.5, 7);
    for (const c of wildlife) {
      if (!c.fly && c.mesh.position.distanceTo(player.pos) < 15) { SFX.chirp(); break; }
    }
  }
  for (const c of wildlife) {
    const m = c.mesh;
    c.t += dt;
    if (c.bird) {
      c.ang += dt * c.speed / c.rad;
      m.position.set(c.cx + Math.cos(c.ang) * c.rad, c.h + Math.sin(c.t * 0.7) * 2, c.cz + Math.sin(c.ang) * c.rad);
      m.rotation.y = -c.ang;
      const f = Math.sin(c.t * 9) * 0.7;
      c.wings[0].rotation.z = f; c.wings[1].rotation.z = -f;
    } else if (c.fly) {
      // butterflies flutter, and curious ones drift toward the player
      if (c.t > 2.5) { c.t = 0; c.dir += rand(-1.4, 1.4); }
      const toP = player.pos.distanceTo(m.position);
      if (toP < 10 && toP > 2.5) c.dir = Math.atan2(player.pos.x - m.position.x, player.pos.z - m.position.z);
      m.position.x += Math.sin(c.dir) * dt * c.speed;
      m.position.z += Math.cos(c.dir) * dt * c.speed;
      m.position.x = clamp(m.position.x, -110, 110); m.position.z = clamp(m.position.z, -110, 110);
      m.position.y = terrainHeight(m.position.x, m.position.z) + c.baseY + Math.sin(c.t * 5) * 0.3;
      m.rotation.y = c.dir;
      const f = Math.sin(c.t * 16) * 1.0;
      c.wings[0].rotation.y = f; c.wings[1].rotation.y = -f;
    } else {
      // ground creatures wander; flee when the player gets close
      const toP = player.pos.distanceTo(m.position);
      if (toP < 4.5) { c.dir = Math.atan2(m.position.x - player.pos.x, m.position.z - player.pos.z); c.hop = 1; }
      else if (c.t > 3.2) { c.t = 0; c.dir = rand(0, Math.PI * 2); c.hop = 1; }
      if (c.hop > 0 || !c.hops) {
        c.hop -= dt * 1.3;
        const sp = c.hops ? c.speed : c.speed * (toP < 4.5 ? 2.2 : 1);
        m.position.x += Math.sin(c.dir) * dt * sp;
        m.position.z += Math.cos(c.dir) * dt * sp;
        m.position.x = clamp(m.position.x, -110, 110); m.position.z = clamp(m.position.z, -110, 110);
        m.rotation.y = c.dir;
      }
      m.position.y = terrainHeight(m.position.x, m.position.z) +
        (c.hops ? Math.sin(Math.max(c.hop, 0) * Math.PI) * 0.5 : 0);
      // stilt-legged striders swing their legs while moving
      if (c.legs) {
        const sw = Math.sin(c.t * 5) * 0.35;
        c.legs[0].rotation.x = sw; c.legs[3].rotation.x = sw;
        c.legs[1].rotation.x = -sw; c.legs[2].rotation.x = -sw;
      }
    }
  }
}
/* ---- scanning (mission: Wildlife Survey) ---- */
function nearestScannable() {
  let best = null, bd = 9;
  for (const c of wildlife) {
    if (c.scanned) continue;
    const d = c.mesh.position.distanceTo(player.pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function tryScan() {
  const c = nearestScannable();
  if (!c) return;
  c.scanned = true;
  SFX.scan();
  emit(c.mesh.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 0x5ff2d0, 10, 2.5, 0.7, 0.7, 0.1);
  addLore(LORE[c.species]);
  showToast('🔎 Scanned: ' + LORE[c.species].split(' — ')[0]);
  missionProgress('survey', 1);
}

/* ================== BUILDING SYSTEM ================================ */
// 8 structures. All placed buildings are destructible (hp) and register
// real colliders; bridges & watchtowers register walkable platforms.
const BUILDS = [
  { name: 'Wall',        cost: { m: 8 },        size: [4, 2.6, 0.8],  hp: 220 },
  { name: 'Barrier',     cost: { m: 5 },        size: [2.4, 1.2, 0.8], hp: 130 },
  { name: 'Turret',      cost: { m: 14, e: 10 }, size: [1.4, 2.4, 1.4], hp: 110 },
  { name: 'Watchtower',  cost: { m: 20 },       size: [3, 4.6, 3],    hp: 260 },
  { name: 'Collector',   cost: { m: 12, e: 4 },  size: [2, 2.2, 2],    hp: 110 },
  { name: 'Med Station', cost: { m: 8, b: 12 },  size: [2, 2, 2],      hp: 110 },
  { name: 'Lamp',        cost: { m: 3, e: 2 },   size: [0.7, 2.6, 0.7], hp: 60 },
  { name: 'Bridge Deck', cost: { m: 12 },       size: [4.4, 0.6, 7],  hp: 300 },
];
let buildMode = false, buildSel = 0, ghost = null, ghostValid = false;
const buildings = [];   // {type,mesh,hp,maxHp,collider,platforms:[],turret,alive,light}
let lampLights = 0;

function fWall(preview) {
  const g = new THREE.Group();
  const w = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 0.7), preview ? null : MAT.grayLight);
  w.position.y = 1.2; g.add(w);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.3, 0.8), preview ? null : MAT.techBlue);
  trim.position.y = 2.5; g.add(trim);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 0.08), preview ? null : MAT.cyanGlow);
  glow.position.set(0, 1.2, 0.38); g.add(glow);
  return g;
}
function fBarrier(preview) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.7), preview ? null : MAT.mustard);
  b.position.y = 0.5; g.add(b);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.22, 0.75), preview ? null : MAT.grayDark);
  stripe.position.y = 1.0; g.add(stripe);
  return g;
}
function fTurret(preview) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.6, 6), preview ? null : MAT.grayMid);
  base.position.y = 0.3; g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.0, 5), preview ? null : MAT.grayDark);
  pole.position.y = 1.0; g.add(pole);
  const head = new THREE.Group();
  const hd = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), preview ? null : MAT.techBlue);
  head.add(hd);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.2), preview ? null : MAT.grayDark);
  barrel.position.set(0, 0.05, 0.8); head.add(barrel);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.1), preview ? null : MAT.cyanGlow);
  lamp.position.set(0, 0.25, 0.46); head.add(lamp);
  head.position.y = 1.75; g.add(head);
  g.userData.head = head; g.userData.barrel = barrel;
  return g;
}
function fWatchtower(preview) {
  const g = new THREE.Group();
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.6, 0.35), preview ? null : MAT.grayDark);
    leg.position.set(sx * 1.2, 1.8, sz * 1.2); g.add(leg);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.35, 3), preview ? null : MAT.techBlue);
  deck.position.y = 3.65; g.add(deck);
  for (const [sx, sz, w, d] of [[0, 1.45, 3, 0.15], [0, -1.45, 3, 0.15], [1.45, 0, 0.15, 3], [-1.45, 0, 0.15, 3]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), preview ? null : MAT.grayLight);
    rail.position.set(sx, 4.2, sz); g.add(rail);
  }
  const gl = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.1, 0.1), preview ? null : MAT.cyanGlow);
  gl.position.set(0, 3.85, 1.5); g.add(gl);
  // stair blocks up the front (+Z)
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 1.1), preview ? null : MAT.grayMid);
    step.position.set(0, 0.95 + i * 0.95, 2.1 + (2 - i) * 1.0);
    g.add(step);
  }
  return g;
}
function fCollector(preview) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 1.8), preview ? null : MAT.grayMid);
  base.position.y = 0.6; g.add(base);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.5, 6), preview ? null : MAT.mustard);
  dish.position.y = 1.7; dish.rotation.x = Math.PI; g.add(dish);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), preview ? null : MAT.crystal);
  core.position.y = 1.85; g.add(core);
  g.userData.spinner = dish;
  return g;
}
function fMed(preview) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.7, 1.6), preview ? null : MAT.grayLight);
  base.position.y = 0.85; g.add(base);
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 0.1), preview ? null : MAT.bioGlow);
  c1.position.set(0, 1.1, 0.83); g.add(c1);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.9, 0.1), preview ? null : MAT.bioGlow);
  c2.position.set(0, 1.1, 0.83); g.add(c2);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.5, 6), preview ? null : MAT.grayDark);
  top.position.y = 1.95; g.add(top);
  return g;
}
function fLamp(preview) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.3, 5), preview ? null : MAT.grayDark);
  pole.position.y = 1.15; g.add(pole);
  const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), preview ? null : MAT.windowGlow);
  head.position.y = 2.5; g.add(head);
  return g;
}
function fBridge(preview) {
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.4, 7), preview ? null : MAT.wood);
  deck.position.y = 0.2; g.add(deck);
  for (let i = -2.8; i <= 2.8; i += 1.4) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.1, 0.6), preview ? null : MAT.grayDark);
    p.position.set(0, 0.42, i); g.add(p);
  }
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 7), preview ? null : MAT.wood);
    rail.position.set(s * 2.1, 0.95, 0); g.add(rail);
  }
  return g;
}
const buildFactories = [fWall, fBarrier, fTurret, fWatchtower, fCollector, fMed, fLamp, fBridge];

const ghostMatOk  = new THREE.MeshBasicMaterial({ color: 0x5ff2d0, transparent: true, opacity: 0.4, depthWrite: false });
const ghostMatBad = new THREE.MeshBasicMaterial({ color: 0xff4a5c, transparent: true, opacity: 0.4, depthWrite: false });

function buildCostOf(i) {
  const c = BUILDS[i].cost, out = {};
  for (const k in c) out[k] = Math.ceil(c[k] * costMult());
  return out;
}
function canAfford(cost) {
  return (cost.m || 0) <= player.res.m && (cost.e || 0) <= player.res.e && (cost.b || 0) <= player.res.b;
}
function costText(cost) {
  const parts = [];
  if (cost.m) parts.push(cost.m + ' metal');
  if (cost.e) parts.push(cost.e + ' energy');
  if (cost.b) parts.push(cost.b + ' bio');
  return parts.join('<br>');
}
function refreshBuildCosts() {
  for (let i = 0; i < 8; i++) $('bcost-' + i).innerHTML = costText(buildCostOf(i));
}
function toggleBuildMode() {
  buildMode = !buildMode;
  $('build-menu').style.display = buildMode ? 'flex' : 'none';
  $('build-hint').style.display = buildMode ? 'block' : 'none';
  if (buildMode) { refreshBuildCosts(); selectBuild(buildSel); }
  else if (ghost) { scene.remove(ghost); ghost = null; }
}
function selectBuild(i) {
  buildSel = i;
  for (let k = 0; k < 8; k++) $('build-' + k).classList.toggle('sel', k === i);
  if (ghost) scene.remove(ghost);
  ghost = buildFactories[i](true);
  ghost.traverse(o => { if (o.isMesh) o.material = ghostMatOk; });
  scene.add(ghost);
}
const groundRay = new THREE.Raycaster();
function updateBuildGhost() {
  if (!buildMode || !ghost) return;
  groundRay.setFromCamera({ x: 0, y: 0 }, camera);
  const dir = groundRay.ray.direction, org = groundRay.ray.origin;
  let pt = null;
  for (let t = 1; t < 30; t += 0.75) {
    const p = org.clone().addScaledVector(dir, t);
    if (p.y <= terrainHeight(p.x, p.z)) { pt = p; break; }
  }
  if (!pt) {
    const f = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    pt = player.pos.clone().addScaledVector(f, 7);
  }
  pt.y = terrainHeight(pt.x, pt.z);
  pt.x = Math.round(pt.x * 2) / 2; pt.z = Math.round(pt.z * 2) / 2;
  ghost.position.copy(pt);
  const b = BUILDS[buildSel];
  const near = pt.distanceTo(player.pos);
  const overlaps = circleVsColliders(pt.x, pt.z, Math.max(b.size[0], b.size[2]) / 2 * 0.8, 0);
  ghostValid = near > 2 && near < 15 && canAfford(buildCostOf(buildSel))
    && Math.abs(overlaps.x) < 0.01 && Math.abs(overlaps.z) < 0.01;
  const gm = ghostValid ? ghostMatOk : ghostMatBad;
  ghost.traverse(o => { if (o.isMesh) o.material = gm; });
}
// Places a building in the world; `paid` false when restoring from a save
function placeBuildAt(type, x, z, rotY, hp) {
  const b = BUILDS[type];
  const built = buildFactories[type](false);
  // watchtower & bridge need axis-aligned platforms — snap to 90°
  if (type === 3 || type === 7) rotY = Math.round(rotY / (Math.PI / 2)) * (Math.PI / 2);
  built.position.set(x, terrainHeight(x, z), z);
  built.rotation.y = rotY;
  built.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(built);
  const rot = Math.abs(Math.sin(rotY)) > 0.5;
  const w = rot ? b.size[2] : b.size[0], d = rot ? b.size[0] : b.size[2];
  const entry = {
    type, mesh: built, hp: hp || b.hp, maxHp: b.hp, alive: true,
    platforms: [], turret: null, light: null, timer: 0,
    collider: null, blockers: [],
  };
  if (type === 7) {
    // bridge: walkable deck at bank height, no wall collider
    const fx = Math.sin(rotY), fz = Math.cos(rotY);
    const top = Math.max(
      terrainHeight(x + fx * 3.6, z + fz * 3.6),
      terrainHeight(x - fx * 3.6, z - fz * 3.6),
      terrainHeight(x, z)) + 0.35;
    built.position.y = top - 0.2;
    entry.platforms.push(addPlatform(x, z, w, d, top + 0.25));
    entry.collider = addBoxCollider(x, z, 0.01, 0.01, -99, entry);   // dummy (nothing blocks)
  } else {
    entry.collider = addBoxCollider(x, z, w, d, built.position.y + b.size[1], entry);
    built.traverse(o => {
      if (o.isMesh) {
        cameraBlockers.push(o); entry.blockers.push(o);
        if (type !== 2) { losBlockers.push(o); }
      }
    });
  }
  if (type === 2) entry.turret = { head: built.userData.head, barrel: built.userData.barrel, cd: 0, range: 24 };
  if (type === 3) {
    const gy = built.position.y;
    // stair platforms up the rotated front + the deck
    const fx = Math.sin(rotY), fz = Math.cos(rotY);
    for (let i = 0; i < 3; i++) {
      const ox = fx * (2.1 + (2 - i) * 1.0), oz = fz * (2.1 + (2 - i) * 1.0);
      entry.platforms.push(addPlatform(x + ox, z + oz, 1.6, 1.6, gy + 1.1 + i * 0.95));
    }
    entry.platforms.push(addPlatform(x, z, 3, 3, gy + 3.85));
  }
  if (type === 6) {
    if (lampLights < 8) {
      const pl = new THREE.PointLight(0xffd28a, 0.9, 13);
      pl.position.set(0, 2.5, 0); built.add(pl);
      entry.light = pl; lampLights++;
    }
  }
  buildings.push(entry);
  return entry;
}
function placeBuild() {
  if (!ghost) return;
  const cost = buildCostOf(buildSel);
  if (!ghostValid) {
    SFX.deny();
    showToast(canAfford(cost) ? 'Invalid placement' : 'Not enough resources');
    return;
  }
  player.res.m -= cost.m || 0; player.res.e -= cost.e || 0; player.res.b -= cost.b || 0;
  updateCountersUI();
  placeBuildAt(buildSel, ghost.position.x, ghost.position.z, ghost.rotation.y);
  recBuild();
  SFX.place();
  emit(ghost.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0x5ff2d0, 8, 3, 0.5);
}
function damageBuilding(b, dmg) {
  if (!b.alive) return;
  b.hp -= dmg;
  emit(b.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xffd166, 3, 3, 0.3, 0.6);
  if (b.hp <= 0) {
    b.alive = false;
    SFX.crumble();
    emit(b.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), 0x9aa3ad, 14, 5, 0.9, 1.2);
    scene.remove(b.mesh);
    removeCollider(b.collider);
    for (const p of b.platforms) { const i = platforms.indexOf(p); if (i >= 0) platforms.splice(i, 1); }
    removeFromArr(cameraBlockers, b.blockers);
    removeFromArr(losBlockers, b.blockers);
    if (b.light) lampLights--;
    showToast('⚠ A structure was destroyed!');
  }
}
function updateBuildings(dt) {
  for (const b of buildings) {
    if (!b.alive) continue;
    if (b.turret) {
      const t = b.turret;
      t.cd -= dt;
      let best = null, bestD = t.range;
      const tp = b.mesh.position;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = e.mesh.position.distanceTo(tp);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best) { t.head.rotation.y += dt * 0.6; continue; }
      const ep = best.mesh.position;
      const targetYaw = Math.atan2(ep.x - tp.x, ep.z - tp.z) - b.mesh.rotation.y;
      let dy = targetYaw - t.head.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      t.head.rotation.y += clamp(dy, -dt * 5, dt * 5);
      if (Math.abs(dy) < 0.15 && t.cd <= 0) {
        t.cd = 0.5;
        const muzzle = new THREE.Vector3();
        t.barrel.getWorldPosition(muzzle);
        const aim = ep.clone().add(new THREE.Vector3(0, best.T.fly ? 0 : 1, 0));
        spawnTracer(muzzle, aim, 0x8ab8ff);
        spawnImpact(aim, 0x8ab8ff);
        damageEnemy(best, 12);
        SFX.turret();
      }
    }
    if (b.type === 4) {   // collector generates resources
      b.timer += dt;
      if (b.mesh.userData.spinner) b.mesh.userData.spinner.rotation.y += dt * 1.5;
      if (b.timer > 12) {
        b.timer = 0;
        player.res.m++; player.res.e++;
        updateCountersUI();
        emit(b.mesh.position.clone().add(new THREE.Vector3(0, 2, 0)), 0x5ff2d0, 4, 2, 0.5, 0.6, 0.1);
      }
    }
    if (b.type === 5) {   // med station pulses healing
      b.timer += dt;
      if (b.timer > 2 && player.pos.distanceTo(b.mesh.position) < 6 && player.health < player.maxHealth) {
        b.timer = 0;
        player.health = Math.min(player.maxHealth, player.health + 6);
        updateHealthUI();
        emit(player.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xe86a9e, 5, 2, 0.6, 0.6, 0.1);
      }
    }
  }
}

/* ==================== MISSIONS ===================================== */
const MISSIONS = [
  { id: 'secure', title: 'Secure the Outpost', desc: 'Destroy 6 drones prowling the wilds near the research tower.', target: 6 },
  { id: 'defend', title: 'Distress Call', desc: 'Resupply at the yellow camper (E) — then repel the assault wave it attracts.', target: 8, locked: true },
  { id: 'power',  title: 'Power Restoration', desc: 'Find and activate the 3 power pylons scattered in the wilds (E).', target: 3 },
  { id: 'survey', title: 'Wildlife Survey', desc: 'Scan 6 wild creatures with Q. Approach slowly — most of them flee.', target: 6 },
  { id: 'bridge', title: 'Western Crossing', desc: 'Bring 12 metal to the broken crossing on the western ravine and rebuild it (E at the marker).', target: 1 },
  { id: 'cache',  title: 'Hidden Cache', desc: 'Old logs mention a supply cache hidden in the far northern rocks.', target: 1 },
];
const missionState = {};
MISSIONS.forEach(m => missionState[m.id] = { progress: 0, done: false, locked: !!m.locked });
let defendWaveStarted = false;

function missionProgress(id, amt) {
  const ms = missionState[id];
  if (!ms || ms.done || ms.locked) return;
  ms.progress += amt;
  const def = MISSIONS.find(m => m.id === id);
  if (ms.progress >= def.target) completeMission(id);
  updateMissionTracker();
}
function completeMission(id) {
  const ms = missionState[id];
  if (ms.done) return;
  ms.done = true;
  recMission();
  SFX.unlock();
  const def = MISSIONS.find(m => m.id === id);
  showMessage('✔ MISSION COMPLETE — ' + def.title);
  if (id === 'secure') {
    unlockWeapon(1); player.res.cores += 1; player.res.m += 10;
    missionState.defend.locked = false;
    setTimeout(() => showToast('New mission: Distress Call — head to the yellow camper'), 2800);
  } else if (id === 'defend') { player.res.cores += 2; player.res.e += 10; }
  else if (id === 'power')  { unlockWeapon(3); player.res.cores += 2; }
  else if (id === 'survey') { player.res.cores += 2; player.res.b += 10; }
  else if (id === 'bridge') { player.res.cores += 2; player.res.m += 15; }
  else if (id === 'cache')  { unlockWeapon(2); player.res.cores += 2; }
  updateCountersUI(); updateMissionTracker();
  saveGame(true);
}
function onEnemyKilled(e) {
  missionProgress('secure', 1);
  if (e.wave) missionProgress('defend', 1);
}
function activeMission() {
  for (const m of MISSIONS) {
    const ms = missionState[m.id];
    if (!ms.done && !ms.locked) return m;
  }
  return null;
}
function updateMissionTracker() {
  const m = activeMission();
  if (!m) {
    $('mission-tag').textContent = 'All missions complete';
    $('mission-text').innerHTML = 'The Wilds are yours. Keep exploring, keep building. <b>◆</b>';
    return;
  }
  const ms = missionState[m.id];
  $('mission-tag').textContent = 'Mission — ' + m.title;
  $('mission-text').innerHTML = m.desc + (m.target > 1 ? ' <b>(' + Math.min(ms.progress, m.target) + '/' + m.target + ')</b>' : '');
}

/* ==================== SECRETS & LORE =============================== */
let secretsFound = [];
const loreEntries = [];
function addLore(txt) {
  if (loreEntries.includes(txt)) return;
  loreEntries.push(txt);
}
function updateSecrets(dt) {
  secretMeshes.forEach((m, i) => {
    if (!m) return;
    m.rotation.y += dt * 1.6;
    m.position.y = terrainHeight(SECRETS[i].x, SECRETS[i].z) + 0.8 + Math.sin(game.time * 2 + i) * 0.15;
    if (player.pos.distanceTo(m.position) < 2.2) {
      scene.remove(m);
      secretMeshes[i] = null;
      secretsFound.push(i);
      recShard();
      player.res.cores++;
      addLore(SECRETS[i].lore);
      SFX.core();
      showMessage('◆ DATA SHARD FOUND (' + secretsFound.length + '/8) — +1 data core');
      emit(m.position, 0xffd166, 12, 3, 0.8, 0.8, 0.15);
      updateCountersUI();
    }
  });
}

/* ==================== UPGRADES ===================================== */
const UPGRADES = [
  { id: 'vit', name: 'Reinforced Hull', desc: '+25 max health', cost: 2 },
  { id: 'dmg', name: 'Overcharged Cells', desc: '+25% weapon damage', cost: 2 },
  { id: 'spd', name: 'Servo Legs', desc: '+12% move speed', cost: 1 },
  { id: 'mag', name: 'Extended Mags', desc: '+50% magazine size', cost: 1 },
  { id: 'bld', name: 'Efficient Builder', desc: '−25% build costs', cost: 1 },
];
function buyUpgrade(id) {
  const u = UPGRADES.find(u => u.id === id);
  if (player.upgrades[id] || player.res.cores < u.cost) { SFX.deny(); return; }
  player.res.cores -= u.cost;
  player.upgrades[id] = 1;
  if (id === 'vit') { player.maxHealth += 25; player.health += 25; updateHealthUI(); }
  SFX.powerup();
  showToast('Upgrade installed: ' + u.name);
  updateCountersUI(); renderJournal(); updateAmmoUI();
  saveGame(true);
}

/* ==================== PICKUPS ====================================== */
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const c = pickups[i];
    c.t += dt;
    c.mesh.rotation.y += dt * 0.8;
    c.mesh.position.y = terrainHeight(c.x, c.z) + 0.15 + Math.sin(c.t * 2) * 0.1;
    if (player.pos.distanceTo(c.mesh.position) < 1.9) {
      scene.remove(c.mesh);
      pickups.splice(i, 1);
      if (c.kind === 'energy') { player.res.e += 3; showToast('+3 energy'); }
      else if (c.kind === 'metal') { player.res.m += 4; showToast('+4 metal'); }
      else if (c.kind === 'bio') { player.res.b += 3; showToast('+3 bio-matter'); }
      else {
        for (let k = 0; k < 4; k++)
          if (player.weapons[k].unlocked) player.weapons[k].reserve += magSizeOf(k);
        showToast('Ammo restocked for all weapons');
        updateAmmoUI();
      }
      SFX.pickup();
      updateCountersUI();
      emit(c.mesh.position, c.kind === 'bio' ? 0xe86a9e : 0x5ff2d0, 7, 3, 0.5, 0.7, 0.2);
      const kind = c.kind;
      setTimeout(() => {
        const half = WORLD_SIZE / 2 - 10;
        spawnPickup(kind, rand(-half, half), rand(-half, half));
      }, 32000);
    }
  }
}

/* ==================== INTERACTION (E) ============================== */
let cacheFound = false, bridgeBuilt = false;
function interactTarget() {
  if (player.pos.distanceTo(new THREE.Vector3(CAMPER_POS.x, player.pos.y, CAMPER_POS.z)) < 9)
    return { kind: 'camper', label: 'Press <b>E</b> to resupply at the outpost camper' };
  for (const p of pylons)
    if (!p.active && Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < 5)
      return { kind: 'pylon', p, label: 'Press <b>E</b> to activate the power pylon' };
  if (!bridgeBuilt && !missionState.bridge.done &&
      player.pos.distanceTo(new THREE.Vector3(BRIDGE_SPOT.x, player.pos.y, BRIDGE_SPOT.z)) < 8)
    return { kind: 'bridge', label: 'Press <b>E</b> to rebuild the crossing (needs 12 metal)' };
  if (!cacheFound && player.pos.distanceTo(new THREE.Vector3(CACHE_POS.x, player.pos.y, CACHE_POS.z)) < 6)
    return { kind: 'cache', label: 'Press <b>E</b> to open the hidden cache' };
  return null;
}
function updateInteract() {
  const t = interactTarget();
  const el = $('interact-prompt');
  if (t && game.state === 'playing') { el.innerHTML = t.label; el.style.display = 'block'; }
  else el.style.display = 'none';
  $('scan-prompt').style.display = (game.state === 'playing' && nearestScannable()) ? 'block' : 'none';
}
function tryInteract() {
  const t = interactTarget();
  if (!t) return;
  if (t.kind === 'camper') {
    player.health = player.maxHealth;
    for (let k = 0; k < 4; k++)
      if (player.weapons[k].unlocked)
        player.weapons[k].reserve = Math.max(player.weapons[k].reserve, WEAPONS[k].startReserve);
    updateHealthUI(); updateAmmoUI();
    SFX.heal();
    showMessage('Systems restored — health & ammo replenished');
    emit(player.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 0x5ff2d0, 12, 3, 0.8, 1, 0.1);
    if (!missionState.defend.locked && !missionState.defend.done && !defendWaveStarted) {
      defendWaveStarted = true;
      showMessage('⚠ DISTRESS BEACON TRIGGERED — DEFEND THE OUTPOST ⚠');
      setTimeout(() => {
        if (game.state !== 'playing') return;
        for (let i = 0; i < 8; i++) {
          const a = rand(0, Math.PI * 2), r = rand(30, 45);
          const e = spawnEnemy(i % 3 === 0 ? 'wasp' : i % 3 === 1 ? 'scout' : 'stalker',
            clamp(player.pos.x + Math.cos(a) * r, -130, 130),
            clamp(player.pos.z + Math.sin(a) * r, -130, 130));
          e.state = 'chase'; e.alerted = true; e.wave = true;
        }
        SFX.alert();
      }, 2500);
    }
  } else if (t.kind === 'pylon') {
    t.p.active = true;
    t.p.coilMat.color.setHex(0x2a6f78);
    t.p.coilMat.emissive.setHex(PAL.cyanGlow);
    t.p.coilMat.emissiveIntensity = 1.8;
    SFX.powerup();
    emit(t.p.mesh.position.clone().add(new THREE.Vector3(0, 6, 0)), 0x54e0e8, 14, 4, 0.9, 1, 0.1);
    missionProgress('power', 1);
    const left = pylons.filter(p => !p.active).length;
    if (left > 0) showMessage('⚡ Pylon online — ' + left + ' remaining');
  } else if (t.kind === 'bridge') {
    if (player.res.m < 12) { SFX.deny(); showToast('You need 12 metal to rebuild the crossing'); return; }
    player.res.m -= 12;
    bridgeBuilt = true;
    buildBridgePrefab(BRIDGE_SPOT.x, ravineCenter(BRIDGE_SPOT.x));
    const holo = bridgeMarker.getObjectByName('holo');
    if (holo) bridgeMarker.remove(holo);
    SFX.place(); SFX.unlock();
    missionProgress('bridge', 1);
    updateCountersUI();
  } else if (t.kind === 'cache') {
    cacheFound = true;
    SFX.core();
    player.res.m += 20; player.res.e += 15; player.res.b += 10;
    emit(cacheCrate.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xffd166, 16, 4, 1, 1, 0.2);
    addLore('Cache manifest — "Scatter Gun, ammunition, rations. For whoever makes it out here. — K."');
    missionProgress('cache', 1);
    updateCountersUI();
  }
}

/* ==================== SAVE / LOAD ================================== */
function saveGame(silent) {
  if (game.state === 'menu' || game.state === 'splash') return;
  const data = {
    v: 1,
    pos: [player.pos.x, player.pos.y, player.pos.z], yaw: player.yaw,
    health: player.health, res: player.res, kills: player.kills,
    weapons: player.weapons, cur: player.cur, upgrades: player.upgrades,
    missions: missionState, defendWaveStarted,
    buildings: buildings.filter(b => b.alive).map(b =>
      [b.type, +b.mesh.position.x.toFixed(2), +b.mesh.position.z.toFixed(2), +b.mesh.rotation.y.toFixed(3), Math.round(b.hp)]),
    secretsFound, lore: loreEntries,
    pylons: pylons.map(p => p.active),
    bridgeBuilt, cacheFound,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  if (!silent) showToast('💾 Game saved');
}
function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
function loadGame() {
  let d;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
  if (!d) return false;
  player.pos.set(d.pos[0], d.pos[1], d.pos[2]);
  player.yaw = d.yaw;
  Object.assign(player.res, d.res);
  player.kills = d.kills || 0;
  player.upgrades = Object.assign({ vit: 0, dmg: 0, spd: 0, mag: 0, bld: 0 }, d.upgrades);
  player.maxHealth = 100 + (player.upgrades.vit ? 25 : 0);
  player.health = clamp(d.health, 1, player.maxHealth);
  d.weapons.forEach((w, i) => Object.assign(player.weapons[i], w));
  player.cur = 0; switchWeapon(d.cur || 0);
  player.mesh.gunMeshes.forEach((gm, k) => gm.visible = k === player.cur);
  for (const id in d.missions) Object.assign(missionState[id], d.missions[id]);
  defendWaveStarted = !!d.defendWaveStarted;
  (d.buildings || []).forEach(([t, x, z, r, hp]) => placeBuildAt(t, x, z, r, hp));
  secretsFound = d.secretsFound || [];
  (d.lore || []).forEach(addLore);
  (d.pylons || []).forEach((a, i) => {
    if (a && pylons[i]) {
      pylons[i].active = true;
      pylons[i].coilMat.color.setHex(0x2a6f78);
      pylons[i].coilMat.emissive.setHex(PAL.cyanGlow);
      pylons[i].coilMat.emissiveIntensity = 1.8;
    }
  });
  bridgeBuilt = !!d.bridgeBuilt;
  if (bridgeBuilt) {
    buildBridgePrefab(BRIDGE_SPOT.x, ravineCenter(BRIDGE_SPOT.x));
    const holo = bridgeMarker.getObjectByName('holo');
    if (holo) bridgeMarker.remove(holo);
  }
  cacheFound = !!d.cacheFound;
  return true;
}

/* ==================== UI helpers =================================== */
function updateHealthUI() {
  $('health-bar').style.width = Math.max(player.health / player.maxHealth * 100, 0) + '%';
}
function updateAmmoUI() {
  const ws = curWState();
  $('weapon-name').textContent = curWeapon().name;
  $('ammo-count').innerHTML = ws.mag + '<small> / ' + ws.reserve + '</small>';
  $('reload-hint').textContent = player.reloading ? 'RELOADING…' : (ws.mag === 0 ? 'PRESS R TO RELOAD' : '');
}
function updateWeaponSlotsUI() {
  for (let i = 0; i < 4; i++) {
    const el = $('wslot-' + i);
    el.classList.toggle('unlocked', player.weapons[i].unlocked);
    el.classList.toggle('active', i === player.cur);
  }
}
function updateCountersUI() {
  $('res-metal').textContent = player.res.m;
  $('res-energy').textContent = player.res.e;
  $('res-bio').textContent = player.res.b;
  $('res-cores').textContent = player.res.cores;
  $('kill-count').textContent = player.kills;
}
let msgTimer = null, toastTimer = null;
function showMessage(txt) {
  const el = $('message');
  el.innerHTML = txt; el.style.opacity = 1;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => el.style.opacity = 0, 2800);
}
function showToast(txt) {
  const el = $('toast');
  el.innerHTML = txt; el.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.style.opacity = 0, 2000);
}

/* ==================== JOURNAL ====================================== */
function renderJournal() {
  const jm = $('journal-missions');
  jm.innerHTML = '';
  for (const m of MISSIONS) {
    const ms = missionState[m.id];
    if (ms.locked) continue;
    const row = document.createElement('div');
    row.className = 'mission-row ' + (ms.done ? 'done' : 'active');
    row.innerHTML = '<span class="mprog">' + (ms.done ? '✔ COMPLETE' :
      (m.target > 1 ? Math.min(ms.progress, m.target) + ' / ' + m.target : 'IN PROGRESS')) +
      '</span><div class="mtitle">' + m.title + '</div><div class="mdesc">' + m.desc + '</div>';
    jm.appendChild(row);
  }
  $('journal-cores').textContent = player.res.cores;
  const ju = $('journal-upgrades');
  ju.innerHTML = '';
  for (const u of UPGRADES) {
    const owned = !!player.upgrades[u.id];
    const div = document.createElement('div');
    div.className = 'upg' + (owned ? ' owned' : '');
    div.innerHTML = '<b>' + u.name + '</b>' + u.desc +
      '<div class="ucost">' + (owned ? 'INSTALLED' : u.cost + ' ◆ data core' + (u.cost > 1 ? 's' : '')) + '</div>';
    if (!owned) {
      const btn = document.createElement('button');
      btn.textContent = 'INSTALL';
      btn.disabled = player.res.cores < u.cost;
      btn.addEventListener('click', () => buyUpgrade(u.id));
      div.appendChild(btn);
    }
    ju.appendChild(div);
  }
  const jl = $('journal-lore');
  if (loreEntries.length) {
    jl.innerHTML = '';
    for (const l of loreEntries) {
      const div = document.createElement('div');
      div.className = 'lore-row';
      div.textContent = l;
      jl.appendChild(div);
    }
  }
}
function openJournal() {
  if (game.state !== 'playing') return;
  game.state = 'journal';
  renderJournal();
  $('journal').style.display = 'block';
  expectUnlock = true;
  if (document.exitPointerLock) document.exitPointerLock();
}
function closeJournal() {
  $('journal').style.display = 'none';
  game.state = 'playing';
  requestLock();
}

/* ==================== GAME FLOW ==================================== */
const game = { state: 'splash', time: 0 };
let wallT = 0, autosaveT = 0, ambientSpawnT = 0;

function showScreen(id) {
  for (const s of ['menu-screen', 'settings-screen', 'credits-screen', 'pause-screen', 'death-screen',
                   'missions-screen', 'location-screen', 'perks-screen', 'leaderboard-screen', 'multiplayer-screen'])
    $(s).style.display = s === id ? 'flex' : 'none';
}
function enterMenu() {
  game.state = 'menu';
  $('splash-screen').style.display = 'none';
  showScreen('menu-screen');
  $('btn-continue').disabled = !hasSave();
}
/* splash → menu */
setTimeout(() => { if (game.state === 'splash') enterMenu(); }, 4900);
$('splash-screen').addEventListener('click', () => { SFX.init(); SFX.resume(); enterMenu(); });

const TIPS = [
  'TIP: Scan wildlife with <b>Q</b> — most creatures flee, approach slowly.',
  'TIP: Auto-turrets and walls can be destroyed. Repair by rebuilding.',
  'TIP: The camper refills health and ammo — but noise attracts attention.',
  'TIP: Data shards glow amber. Eight are hidden across the Wilds.',
  'TIP: Enemies investigate gunfire. Sometimes silence is a weapon.',
  'TIP: Resource collectors generate metal and energy over time.',
  'TIP: Far from the outpost the drones get faster, tougher, meaner.',
];
let tipIdx = 0;
setInterval(() => {
  tipIdx = (tipIdx + 1) % TIPS.length;
  const el = $('menu-tip');
  if (el) el.innerHTML = TIPS[tipIdx];
}, 6000);
$('menu-tip').innerHTML = TIPS[0];

let enemiesSpawned = false;
function startGame(fromSave) {
  SFX.init(); SFX.resume();
  if (!fromSave) {
    localStorage.removeItem(SAVE_KEY);
    spawnSecrets([]);
    // deploy at the location picked in SELECT LOCATION
    const L = LOCATIONS[settings.spawn || 0];
    player.pos.set(L.x + rand(-2, 2), 0, L.z + rand(-2, 2));
    player.pos.y = terrainHeight(player.pos.x, player.pos.z);
    player.yaw = L.yaw;
  } else {
    const ok = loadGame();
    if (!ok) { spawnSecrets([]); }
    else spawnSecrets(secretsFound);
  }
  if (!enemiesSpawned) {
    enemiesSpawned = true;
    // initial patrols around the tower (mission: Secure the Outpost)
    [[-48, -20, 'stalker'], [-12, -55, 'stalker'], [-52, -48, 'stalker'],
     [4, -30, 'wasp'], [-40, 2, 'wasp'], [-16, -14, 'stalker']].forEach(([x, z, t]) => spawnEnemy(t, x, z));
    // wilder spawns farther out
    [[90, -40, 'scout'], [-100, -60, 'scout'], [100, 90, 'heavy'],
     [-90, 90, 'stalker'], [60, -110, 'wasp'], [0, 120, 'scout']].forEach(([x, z, t]) => spawnEnemy(t, x, z));
  }
  showScreen('');
  $('hud').style.display = 'block';
  game.state = 'playing';
  player.mesh.gunMeshes.forEach((gm, k) => gm.visible = k === player.cur);
  updateHealthUI(); updateAmmoUI(); updateWeaponSlotsUI(); updateCountersUI(); updateMissionTracker();
  requestLock();
  showMessage(fromSave && hasSave() ? 'Welcome back to the Wilds.' : 'Hostile drones detected near the tower!');
}
function pauseGame() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  showScreen('pause-screen');
}
function resumeGame() {
  showScreen('');
  game.state = 'playing';
  SFX.resume();
  requestLock();
}
function onDeath() {
  game.state = 'dead';
  recDeath();
  $('death-kills').textContent = player.kills;
  $('death-missions').textContent = MISSIONS.filter(m => missionState[m.id].done).length;
  $('death-cores').textContent = player.res.cores;
  showScreen('death-screen');
  expectUnlock = true;
  if (document.exitPointerLock) document.exitPointerLock();
}
function respawn() {
  player.health = player.maxHealth;
  player.pos.set(CAMPER_POS.x - 6, terrainHeight(CAMPER_POS.x - 6, CAMPER_POS.z + 4) + 0.1, CAMPER_POS.z + 4);
  player.invuln = 3;
  for (const e of enemies) if (e.alive && e.state !== 'patrol') e.state = 'patrol';
  updateHealthUI();
  showScreen('');
  game.state = 'playing';
  requestLock();
  showToast('Systems rebooted at the outpost.');
}

/* ---- menu / settings wiring ---- */
let settingsReturn = 'menu-screen';
function openSettings(from) {
  settingsReturn = from;
  showScreen('settings-screen');
  $('set-master').value = settings.master;
  $('set-sfx').value = settings.sfx;
  $('set-music').value = settings.music;
  $('set-sens').value = settings.sens;
  $('set-inverty').checked = settings.invertY;
  for (let i = 0; i < 3; i++) $('q-' + i).classList.toggle('sel', settings.quality === i);
}
$('btn-continue').addEventListener('click', () => { SFX.init(); startGame(true); });
$('btn-new').addEventListener('click', () => { SFX.init(); startGame(false); });
$('btn-settings').addEventListener('click', () => { SFX.init(); openSettings('menu-screen'); });
$('btn-credits').addEventListener('click', () => showScreen('credits-screen'));
$('btn-credits-back').addEventListener('click', () => showScreen('menu-screen'));
$('btn-settings-back').addEventListener('click', () => {
  saveSettings();
  if (settingsReturn === 'pause-screen') showScreen('pause-screen');
  else showScreen('menu-screen');
});
for (const [id, key] of [['set-master', 'master'], ['set-sfx', 'sfx'], ['set-music', 'music'], ['set-sens', 'sens']])
  $(id).addEventListener('input', e => { settings[key] = +e.target.value; SFX.applyVolumes(); saveSettings(); });
$('set-inverty').addEventListener('change', e => { settings.invertY = e.target.checked; saveSettings(); });
for (let i = 0; i < 3; i++)
  $('q-' + i).addEventListener('click', () => {
    settings.quality = i; saveSettings(); applyQuality();
    for (let k = 0; k < 3; k++) $('q-' + k).classList.toggle('sel', k === i);
  });
$('btn-fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
});
$('btn-resume').addEventListener('click', resumeGame);
$('btn-save').addEventListener('click', () => saveGame(false));
$('btn-pause-settings').addEventListener('click', () => openSettings('pause-screen'));
$('btn-quit').addEventListener('click', () => { saveGame(true); location.reload(); });
$('btn-respawn').addEventListener('click', respawn);
$('btn-death-quit').addEventListener('click', () => location.reload());

/* ---- world life spawned at load so the menu backdrop feels alive ---- */
spawnWildlife();
applyQuality();

/* ======================== MAIN LOOP ================================ */
const clock = new THREE.Clock();
let shuttleAngle = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  wallT += dt;

  // grass wind runs on wall time so it never freezes
  for (const m of grassMats)
    if (m.userData.shader) m.userData.shader.uniforms.uTime.value = wallT;

  // ambient world motion (all states)
  shuttleAngle += dt * 0.05;
  shuttle.position.set(Math.cos(shuttleAngle) * 95, 44 + Math.sin(shuttleAngle * 3) * 3, Math.sin(shuttleAngle) * 95);
  shuttle.rotation.y = -shuttleAngle;
  const beacon = scene.getObjectByName('beacon');
  if (beacon) beacon.rotation.y += dt * 2;
  const holo = bridgeMarker.getObjectByName('holo');
  if (holo) { holo.rotation.y += dt * 2; holo.position.y = 3.4 + Math.sin(wallT * 2) * 0.2; }
  ambientPts.rotation.y += dt * 0.004;
  updateEnvAnims(dt);   // radar dish, pad lights, greenhouse plants…

  if (game.state === 'playing') {
    game.time += dt;
    fireCd = Math.max(0, fireCd - dt);
    flashT -= dt;
    if (flashT <= 0) player.mesh.flashes[player.cur].forEach(f => f.visible = false);

    updatePlayer(dt);
    updateEnemies(dt);
    updateEnemyProjectiles(dt);
    updateBuildings(dt);
    updateTracers(dt);
    updateParticles(dt);
    updateDamageNumbers(dt);
    updatePickups(dt);
    updateSecrets(dt);
    updateWildlife(dt);
    updateBuildGhost();
    updateInteract();
    updateCamera(dt);
    updateRemotePlayers(dt);
    netTick(dt);

    sun.position.set(player.pos.x + 45, 70, player.pos.z + 25);
    sun.target.position.set(player.pos.x, 0, player.pos.z);

    ambientSpawnT += dt;
    if (ambientSpawnT > 18) { ambientSpawnT = 0; spawnAmbientEnemy(); }
    autosaveT += dt;
    if (autosaveT > 45) { autosaveT = 0; saveGame(true); showToast('💾 Auto-saved'); }
  } else if (game.state === 'menu' || game.state === 'splash') {
    // cinematic orbit around the base for the menu backdrop
    const a = wallT * 0.07;
    camera.position.set(TOWER_POS.x + Math.cos(a) * 48, 15 + Math.sin(a * 0.7) * 4, TOWER_POS.z + Math.sin(a) * 48);
    camera.lookAt(TOWER_POS.x, 12, TOWER_POS.z);
    updateParticles(dt);
    updateWildlife(dt);
  } else {
    // paused / journal / dead / settings — keep rendering the frozen world
    updateParticles(dt);
    updateDamageNumbers(dt);
  }
  renderer.render(scene, camera);
}
animate();

/* ==================== DEPLOY LOCATIONS ============================= */
const LOCATIONS = [
  { name: 'Research Tower', desc: 'The sci-fi base. Safest start — drones patrol nearby.', x: -8,  z: 8,    yaw: 2.4 },
  { name: 'Outpost Camper', desc: 'The yellow hub on stilts. Supplies close at hand.',     x: 50,  z: 52,   yaw: -2.2 },
  { name: 'Northern Wilds', desc: 'Rough country near the hidden cache. Dangerous.',       x: 30,  z: -100, yaw: 0.4 },
  { name: 'Western Crossing', desc: 'The broken ravine bridge. Scouts roam here.',         x: -60, z: 20,   yaw: 1.2 },
];
function renderLocations() {
  const list = $('location-list');
  list.innerHTML = '';
  LOCATIONS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'locbtn' + ((settings.spawn || 0) === i ? ' sel' : '');
    b.innerHTML = '<b>' + L.name + '</b><small>' + L.desc + '</small>';
    b.addEventListener('click', () => {
      settings.spawn = i; saveSettings(); renderLocations(); SFX.click();
    });
    list.appendChild(b);
  });
}

/* ==================== LOCAL RECORDS (leaderboard) ================== */
const REC_KEY = 'helao2_wilds_records';
const records = Object.assign({
  totalKills: 0, bestLife: 0, missions: 0, shards: 0, deaths: 0, builds: 0,
}, JSON.parse(localStorage.getItem(REC_KEY) || '{}'));
let lifeKills = 0;
function saveRecords() { try { localStorage.setItem(REC_KEY, JSON.stringify(records)); } catch (e) {} }
function recKill()    { records.totalKills++; lifeKills++; if (lifeKills > records.bestLife) records.bestLife = lifeKills; saveRecords(); }
function recDeath()   { records.deaths++; lifeKills = 0; saveRecords(); }
function recMission() { records.missions++; saveRecords(); }
function recShard()   { records.shards++; saveRecords(); }
function recBuild()   { records.builds++; saveRecords(); }
function renderLeaderboard() {
  const rows = [
    ['Total drones destroyed', records.totalKills],
    ['Best killstreak (one life)', records.bestLife],
    ['Missions completed', records.missions],
    ['Data shards recovered', records.shards + ' / 8'],
    ['Structures built', records.builds],
    ['Signals lost (deaths)', records.deaths],
  ];
  const list = $('lb-list');
  list.innerHTML = '';
  for (const [k, v] of rows) {
    const div = document.createElement('div');
    div.className = 'lb-row';
    div.innerHTML = '<span>' + k + '</span><b>' + v + '</b>';
    list.appendChild(div);
  }
}

/* ==================== MENU PANELS (missions / perks) =============== */
function readSaveData() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; }
}
function renderMenuMissions() {
  const list = $('menu-missions-list');
  list.innerHTML = '';
  const sd = readSaveData();
  for (const m of MISSIONS) {
    const ms = sd && sd.missions && sd.missions[m.id] ? sd.missions[m.id] : missionState[m.id];
    if (ms.locked && !ms.done) continue;
    const row = document.createElement('div');
    row.className = 'mission-row ' + (ms.done ? 'done' : 'active');
    row.innerHTML = '<span class="mprog">' + (ms.done ? '✔ COMPLETE' :
      (m.target > 1 ? Math.min(ms.progress, m.target) + ' / ' + m.target : 'IN PROGRESS')) +
      '</span><div class="mtitle">' + m.title + '</div><div class="mdesc">' + m.desc + '</div>';
    list.appendChild(row);
  }
  if (!list.children.length)
    list.innerHTML = '<div class="mission-row active"><div class="mtitle">No expedition data yet</div>' +
      '<div class="mdesc">Start an expedition — missions appear here and in the in-game journal (TAB).</div></div>';
}
function renderMenuPerks() {
  const list = $('menu-perks-list');
  list.innerHTML = '';
  const sd = readSaveData();
  const owned = (sd && sd.upgrades) || player.upgrades;
  const cores = sd && sd.res ? sd.res.cores : player.res.cores;
  for (const u of UPGRADES) {
    const has = !!owned[u.id];
    const div = document.createElement('div');
    div.className = 'upg' + (has ? ' owned' : '');
    div.innerHTML = '<b>' + u.name + '</b>' + u.desc +
      '<div class="ucost">' + (has ? '✔ INSTALLED' : u.cost + ' ◆ core' + (u.cost > 1 ? 's' : '')) + '</div>';
    list.appendChild(div);
  }
  const note = document.createElement('div');
  note.className = 'sub2';
  note.style.marginTop = '10px'; note.style.flexBasis = '100%';
  note.innerHTML = 'Available data cores in save: <b>' + cores + ' ◆</b>';
  list.appendChild(note);
}

/* ---- menu wiring for the new screens ---- */
$('btn-missions').addEventListener('click', () => { renderMenuMissions(); showScreen('missions-screen'); });
$('btn-location').addEventListener('click', () => { renderLocations(); showScreen('location-screen'); });
$('btn-perks').addEventListener('click', () => { renderMenuPerks(); showScreen('perks-screen'); });
$('btn-leaderboard').addEventListener('click', () => { renderLeaderboard(); showScreen('leaderboard-screen'); });
$('btn-multiplayer').addEventListener('click', () => {
  $('mp-status').textContent = ''; $('mp-status').className = '';
  showScreen('multiplayer-screen');
});
document.querySelectorAll('.back-to-menu').forEach(b =>
  b.addEventListener('click', () => showScreen('menu-screen')));

/* =====================================================================
   MULTIPLAYER (co-op presence via WebSocket — see js/net.js, server.js)
   Each client simulates its own enemies/missions; players share the
   deterministic world and see each other move and shoot in realtime.
   ===================================================================== */
const remotePlayers = new Map();   // id → {mesh, tp, tyaw, mv, wp, phase, name}
let netSendT = 0;

function makeNameSprite(name) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const cx = cv.getContext('2d');
  cx.font = 'bold 34px Segoe UI, Arial';
  cx.textAlign = 'center';
  cx.fillStyle = 'rgba(10,12,10,0.55)';
  const w = cx.measureText(name).width + 30;
  cx.fillRect(128 - w/2, 8, w, 46);
  cx.fillStyle = '#c8f05a';
  cx.fillText(name, 128, 42);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(2.6, 0.65, 1);
  sp.position.y = 3.1;
  return sp;
}
function addRemotePlayer(id, name, color) {
  if (remotePlayers.has(id)) return;
  const m = buildPlayerMesh(color, PAL.mustard);
  m.gunMeshes.forEach((g, k) => g.visible = k === 0);
  m.group.add(makeNameSprite(name || 'Explorer'));
  scene.add(m.group);
  remotePlayers.set(id, {
    mesh: m, name: name || 'Explorer',
    tp: new THREE.Vector3(CAMPER_POS.x, 0, CAMPER_POS.z), tyaw: 0, mv: 0, wp: 0, phase: 0,
  });
}
function removeRemotePlayer(id) {
  const r = remotePlayers.get(id);
  if (!r) return;
  scene.remove(r.mesh.group);
  remotePlayers.delete(id);
}
function updateRemotePlayers(dt) {
  for (const r of remotePlayers.values()) {
    const g = r.mesh.group;
    g.position.lerp(r.tp, Math.min(dt * 10, 1));
    let dy = r.tyaw - g.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * Math.min(dt * 10, 1);
    // procedural walk from reported move amount
    r.phase += dt * 9 * r.mv;
    const s = Math.sin(r.phase), amp = 0.5 * r.mv;
    r.mesh.legL.rotation.x = s * amp;
    r.mesh.legR.rotation.x = -s * amp;
    r.mesh.armL.rotation.x = -s * amp * 0.8;
    r.mesh.armR.rotation.x = -Math.PI / 2.4;
    r.mesh.gunMeshes.forEach((gm, k) => gm.visible = k === (r.wp || 0));
  }
}
function updateOnlineIndicator() {
  const el = $('online-ind');
  if (Net.connected) {
    el.textContent = '◉ ' + (remotePlayers.size + 1) + ' ONLINE';
    el.classList.add('live');
  } else {
    el.textContent = '◉ SOLO';
    el.classList.remove('live');
  }
}
function netTick(dt) {
  if (!Net.connected) return;
  netSendT += dt;
  if (netSendT < 0.1) return;
  netSendT = 0;
  Net.send({
    t: 's',
    p: [+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2)],
    y: +player.yaw.toFixed(3),
    mv: +player.moveAmount.toFixed(2),
    wp: player.cur,
  });
}
function netFire(a, b, color) {
  if (!Net.connected) return;
  Net.send({ t: 'fire',
    a: [+a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2)],
    b: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)], c: color });
}

Net.on('welcome', msg => {
  for (const p of msg.players) {
    addRemotePlayer(p.id, p.name, p.color);
    if (p.state) {
      const r = remotePlayers.get(p.id);
      r.tp.set(p.state.p[0], p.state.p[1], p.state.p[2]);
      r.mesh.group.position.copy(r.tp);
    }
  }
  updateOnlineIndicator();
});
Net.on('join', msg => {
  addRemotePlayer(msg.id, msg.name, msg.color);
  showToast('⇄ ' + (msg.name || 'An explorer') + ' joined the Wilds');
  updateOnlineIndicator();
});
Net.on('leave', msg => {
  const r = remotePlayers.get(msg.id);
  showToast('⇄ ' + (r ? r.name : 'An explorer') + ' left');
  removeRemotePlayer(msg.id);
  updateOnlineIndicator();
});
Net.on('s', msg => {
  const r = remotePlayers.get(msg.id);
  if (!r) return;
  r.tp.set(msg.p[0], msg.p[1], msg.p[2]);
  r.tyaw = msg.y; r.mv = msg.mv; r.wp = msg.wp;
});
Net.on('fire', msg => {
  spawnTracer(new THREE.Vector3(msg.a[0], msg.a[1], msg.a[2]),
              new THREE.Vector3(msg.b[0], msg.b[1], msg.b[2]), msg.c);
});
Net.on('_close', () => {
  for (const id of [...remotePlayers.keys()]) removeRemotePlayer(id);
  updateOnlineIndicator();
  if (game.state === 'playing' || game.state === 'paused')
    showToast('⇄ Connection lost — continuing solo');
});

$('mp-connect').addEventListener('click', () => {
  SFX.init(); SFX.resume();
  const st = $('mp-status');
  if (location.protocol === 'file:') {
    st.textContent = 'Multiplayer needs the server: run "npm install && node server.js", then open http://localhost:3000';
    st.className = 'err';
    return;
  }
  const name = ($('mp-name').value || 'Explorer').trim().slice(0, 14);
  st.textContent = 'Connecting…'; st.className = '';
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  Net.connect(url,
    () => {
      Net.send({ t: 'hello', name });
      st.textContent = 'Connected! Deploying…'; st.className = 'ok';
      setTimeout(() => { startGame(hasSave()); updateOnlineIndicator(); }, 400);
    },
    () => {
      st.textContent = 'Could not reach the server. Is "node server.js" running?';
      st.className = 'err';
    });
});

})();
