// ST-27 — Physical AI, future-vision demo. Pure visualization: no robotics engine, no ROS, no real physics.
// Everything is a deterministic function of elapsed time, so "replay" is just resetting the clock.

const COLORS = {
  bg: 0x0b1012,
  muted: 0x405259,
  mint: 0xa6efca,
  red: 0xffa28c,
  amber: 0xffd479,
  steel: 0x4a5a60,
};

const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const overlays = {
  task: document.getElementById('ov-task'),
  controller: document.getElementById('ov-controller'),
  verify: document.getElementById('ov-verify'),
  finality: document.getElementById('ov-finality'),
  next: document.getElementById('ov-next'),
};

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
scene.fog = new THREE.Fog(COLORS.bg, 10, 22);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(4, 7, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(COLORS.mint, 0.25);
rim.position.set(-6, 3, -4);
scene.add(rim);

// ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 10),
  new THREE.MeshStandardMaterial({ color: 0x11191c, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(16, 32, 0x1b2528, 0x151d20);
grid.position.y = 0.01;
scene.add(grid);

// zones
function zoneOutline(halfW, halfD, color) {
  const pts = [
    new THREE.Vector3(-halfW, 0, -halfD), new THREE.Vector3(halfW, 0, -halfD),
    new THREE.Vector3(halfW, 0, halfD), new THREE.Vector3(-halfW, 0, halfD),
    new THREE.Vector3(-halfW, 0, -halfD),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
}

const ZONE_A = { x: -3.2, z: 0.6, halfW: 1.1, halfD: 1.1 };
const ZONE_B = { x: 2.6, z: -0.4, halfW: 1.1, halfD: 1.1 };

const zoneAOutline = zoneOutline(ZONE_A.halfW, ZONE_A.halfD, COLORS.muted);
zoneAOutline.position.set(ZONE_A.x, 0.02, ZONE_A.z);
scene.add(zoneAOutline);

const zoneBOutline = zoneOutline(ZONE_B.halfW, ZONE_B.halfD, COLORS.mint);
zoneBOutline.position.set(ZONE_B.x, 0.02, ZONE_B.z);
scene.add(zoneBOutline);

const zoneBFill = new THREE.Mesh(
  new THREE.PlaneGeometry(ZONE_B.halfW * 2, ZONE_B.halfD * 2),
  new THREE.MeshBasicMaterial({ color: COLORS.mint, transparent: true, opacity: 0.05 })
);
zoneBFill.rotation.x = -Math.PI / 2;
zoneBFill.position.set(ZONE_B.x, 0.015, ZONE_B.z);
scene.add(zoneBFill);

// box (the task object)
const BOX_SIZE = 0.62;
const box = new THREE.Mesh(
  new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE),
  new THREE.MeshStandardMaterial({ color: COLORS.amber, roughness: 0.5, metalness: 0.05 })
);
box.position.set(ZONE_A.x, BOX_SIZE / 2, ZONE_A.z);
scene.add(box);

// gantry robot: rail + carriage + arm
const railY = 3.1;
const rail = new THREE.Mesh(
  new THREE.BoxGeometry(8, 0.14, 0.14),
  new THREE.MeshStandardMaterial({ color: COLORS.steel, roughness: 0.4, metalness: 0.5 })
);
rail.position.set(0, railY, ZONE_A.z);
scene.add(rail);

function support(x) {
  const s = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, railY, 12),
    new THREE.MeshStandardMaterial({ color: COLORS.steel, roughness: 0.5, metalness: 0.4 })
  );
  s.position.set(x, railY / 2, ZONE_A.z);
  return s;
}
scene.add(support(-3.9), support(3.9));

const carriage = new THREE.Mesh(
  new THREE.BoxGeometry(0.32, 0.28, 0.32),
  new THREE.MeshStandardMaterial({ color: 0xdbe6e2, roughness: 0.35, metalness: 0.5 })
);
scene.add(carriage);

const arm = new THREE.Mesh(
  new THREE.CylinderGeometry(0.045, 0.045, 1, 10),
  new THREE.MeshStandardMaterial({ color: 0x8fa0a6, roughness: 0.5, metalness: 0.3 })
);
scene.add(arm);

// verifier sensor above zone B
const sensor = new THREE.Group();
const sensorHead = new THREE.Mesh(
  new THREE.ConeGeometry(0.14, 0.28, 16),
  new THREE.MeshStandardMaterial({ color: 0xdbe6e2, emissive: 0x111111, roughness: 0.4 })
);
sensorHead.rotation.x = Math.PI;
sensor.add(sensorHead);
sensor.position.set(ZONE_B.x, 3.0, ZONE_B.z);
scene.add(sensor);

const scanRing = new THREE.Mesh(
  new THREE.RingGeometry(0.05, 0.09, 48),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide })
);
scanRing.rotation.x = -Math.PI / 2;
scanRing.position.set(ZONE_B.x, 0.03, ZONE_B.z);
scene.add(scanRing);

// ---------- layout / resize ----------
function resize() {
  const rect = stage.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(rect.height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// ---------- timeline ----------
// Final resting spot for the box: deliberately offset so it straddles the Zone B edge (not fully inside).
const FINAL_X = ZONE_B.x - ZONE_B.halfW * 0.92;
const FINAL_Z = ZONE_B.z + ZONE_B.halfD * 0.55;

const T = {
  taskIn: 200, taskOut: 1500,
  descend1: 1500, grabbed: 1950,
  travel: 1950, travelEnd: 3350,
  descend2: 3350, released: 3750,
  controllerIn: 3850, controllerOut: 5000,
  scanIn: 5100, scanOut: 6300,
  verifyIn: 5500, verifyOut: 6900,
  finalityIn: 7000, finalityOut: 8300,
  nextIn: 8400, nextOut: 9900,
  loop: 11500,
};

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function seg(t, a, b) { return clamp01((t - a) / (b - a)); }
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function lerp(a, b, t) { return a + (b - a) * t; }
function setOverlay(el, on) { el.classList.toggle('show', on); }

let startTime = performance.now();
let verdictApplied = false;

function updateVerdictColors(active) {
  const c = active ? new THREE.Color(COLORS.red) : new THREE.Color(COLORS.mint);
  zoneBOutline.material.color.copy(c);
  zoneBFill.material.color.copy(c);
  box.material.emissive = new THREE.Color(active ? COLORS.red : 0x000000);
  box.material.emissiveIntensity = active ? 0.35 : 0;
}

function tick(now) {
  const t = now - startTime;

  // ---- box + robot motion ----
  let boxX = ZONE_A.x, boxZ = ZONE_A.z, boxY = BOX_SIZE / 2;
  let carX = ZONE_A.x, carY = railY;

  if (t >= T.descend1 && t < T.grabbed) {
    const p = ease(seg(t, T.descend1, T.grabbed));
    carY = lerp(railY, BOX_SIZE + 0.35, p);
  } else if (t >= T.grabbed && t < T.travel + (T.travelEnd - T.travel)) {
    carY = BOX_SIZE + 0.35;
  }

  if (t >= T.grabbed && t < T.travelEnd) {
    const p = ease(seg(t, T.travel, T.travelEnd));
    boxX = lerp(ZONE_A.x, FINAL_X, p);
    boxZ = lerp(ZONE_A.z, FINAL_Z, p);
    boxY = lerp(BOX_SIZE / 2, BOX_SIZE / 2 + 0.55, Math.sin(p * Math.PI)) ;
    carX = boxX; carY = boxY + 0.35;
  } else if (t >= T.travelEnd) {
    boxX = FINAL_X; boxZ = FINAL_Z; carX = FINAL_X;
  }

  if (t >= T.descend2 && t < T.released) {
    const p = ease(seg(t, T.descend2, T.released));
    boxY = lerp(BOX_SIZE / 2 + 0.55, BOX_SIZE / 2, p);
    carY = boxY + 0.35;
  } else if (t >= T.released) {
    boxY = BOX_SIZE / 2;
    const p = ease(seg(t, T.released, T.released + 500));
    carY = lerp(BOX_SIZE / 2 + 0.35, railY, p);
  }

  box.position.set(boxX, boxY, boxZ);
  carriage.position.set(carX, carY, boxZ);

  // arm connects carriage to box top when carrying, otherwise hangs a short stub
  const armTop = carriage.position.clone();
  const armBottom = (t >= T.descend1 && t < T.released)
    ? new THREE.Vector3(boxX, boxY + BOX_SIZE / 2, boxZ)
    : new THREE.Vector3(carX, carY - 0.5, boxZ);
  const mid = armTop.clone().add(armBottom).multiplyScalar(0.5);
  const dist = Math.max(armTop.distanceTo(armBottom), 0.05);
  arm.position.copy(mid);
  arm.scale.set(1, dist, 1);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armTop.clone().sub(armBottom).normalize());

  // ---- verifier scan ring ----
  if (t >= T.scanIn && t < T.scanOut) {
    const p = seg(t, T.scanIn, T.scanOut);
    const cyclePos = (p * 2.4) % 1;
    const r = lerp(0.1, ZONE_B.halfW * 1.4, cyclePos);
    scanRing.geometry.dispose();
    scanRing.geometry = new THREE.RingGeometry(r, r + 0.03, 48);
    scanRing.material.opacity = (1 - cyclePos) * 0.7;
    sensorHead.material.emissive.set(0xffffff);
    sensorHead.material.emissiveIntensity = 0.4 + Math.sin(t * 0.02) * 0.2;
  } else {
    scanRing.material.opacity = 0;
    sensorHead.material.emissiveIntensity = 0.05;
  }

  // ---- verdict color switch ----
  if (t >= T.verifyIn && !verdictApplied) { updateVerdictColors(true); verdictApplied = true; }
  if (t < T.taskIn && verdictApplied) { updateVerdictColors(false); verdictApplied = false; }

  // ---- overlays ----
  setOverlay(overlays.task, t >= T.taskIn && t < T.taskOut);
  setOverlay(overlays.controller, t >= T.controllerIn && t < T.controllerOut);
  setOverlay(overlays.verify, t >= T.verifyIn && t < T.verifyOut);
  setOverlay(overlays.finality, t >= T.finalityIn && t < T.finalityOut);
  setOverlay(overlays.next, t >= T.nextIn && t < T.nextOut);

  if (t >= T.nextOut) {
    statusEl.textContent = 'Sequência concluída. Clique em "Rever simulação" para reiniciar.';
  } else {
    statusEl.textContent = 'Reproduzindo automaticamente…';
  }

  // ---- slow orbiting camera + dolly toward Zone B during verification ----
  const angle = 0.55 + t * 0.00006;
  const radius = lerp(9.5, 7.6, seg(t, T.scanIn, T.verifyOut));
  const focusX = lerp(0, ZONE_B.x * 0.5, seg(t, T.scanIn, T.verifyOut));
  const focusZ = lerp(0.2, ZONE_B.z * 0.5, seg(t, T.scanIn, T.verifyOut));
  camera.position.set(focusX + Math.sin(angle) * radius, 5.4, focusZ + Math.cos(angle) * radius);
  camera.lookAt(focusX, 0.6, focusZ);

  renderer.render(scene, camera);
  if (t < T.loop) requestAnimationFrame(tick);
}

function play() {
  startTime = performance.now();
  verdictApplied = false;
  updateVerdictColors(false);
  requestAnimationFrame(tick);
}

document.getElementById('replay').addEventListener('click', play);
play();
