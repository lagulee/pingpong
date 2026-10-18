// render.js — Three.js 장면 구성과 그리기.
// 물리 좌표계(z가 위)와 Three.js 좌표계(y가 위)의 변환은 이 파일에서만 한다.
import * as THREE from 'three';
import { TABLE, NET, BALL, RACKET, RENDER, DEBUG_ARROW, FEEL, SERVE_GUIDE, PHYSICS } from '../shared/constants.js';

// 물리 (x, y, z) → Three.js (x, z, -y)
// 물리 y축(탁구대 길이)이 화면 안쪽으로 들어가도록 Three.js의 -z에 대응시킨다.
export function toThree(p) {
  return new THREE.Vector3(p.x, p.z, -p.y);
}

// Three.js (x, y, z) → 물리 (x, −z, y)
export function fromThree(v) {
  return { x: v.x, y: -v.z, z: v.y };
}

// 물리 좌표계 크기 (sx, sy, sz) → Three.js 박스 크기
function boxSize(sx, sy, sz) {
  return [sx, sz, sy];
}

// ── 카툰 화풍 (7단계 수정): 계단 명암(툰) 재질 + 뒷면을 키운 껍데기로 그린 외곽선 ──
let toonRamp = null;
function toonGradient() {
  if (toonRamp) return toonRamp;
  const steps = RENDER.TOON_STEPS;
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => { data.set([255 * v, 255 * v, 255 * v, 255], i * 4); });
  toonRamp = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter; // 단계 사이를 섞지 않아야 만화처럼 끊긴다
  toonRamp.needsUpdate = true;
  return toonRamp;
}
function toon(opts) {
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...opts });
}
// 외곽선: geo(원래보다 두께만큼 큰 모양)의 뒷면만 진한 색으로 그린다. 그림자는 내지 않는다.
function outline(geo, opts = {}) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: RENDER.COLOR_OUTLINE, side: THREE.BackSide, ...opts }));
  m.castShadow = false;
  return m;
}

function makeBox(sx, sy, sz, color, opts = {}, line = RENDER.OUTLINE_W) {
  const geo = new THREE.BoxGeometry(...boxSize(sx, sy, sz));
  const mat = toon({ color, ...opts });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (line > 0) mesh.add(outline(new THREE.BoxGeometry(...boxSize(sx + 2 * line, sy + 2 * line, sz + 2 * line))));
  return mesh;
}

// 탁구대: 상판 + 흰 선 + 다리
function buildTable() {
  const group = new THREE.Group();
  const L = TABLE.LENGTH, W = TABLE.WIDTH, T = TABLE.THICKNESS;

  // 상판: 윗면이 물리 z = 0
  const top = makeBox(W, L, T, RENDER.COLOR_TABLE);
  top.position.copy(toThree({ x: 0, y: 0, z: -T / 2 }));
  group.add(top);

  // 흰 선 (얇은 판을 상판 위에 살짝 띄움)
  const lineMat = toon({ color: RENDER.COLOR_LINE });
  const lift = RENDER.LINE_LIFT;
  const addLine = (cx, cy, sx, sy) => {
    const geo = new THREE.BoxGeometry(...boxSize(sx, sy, lift));
    const m = new THREE.Mesh(geo, lineMat);
    m.position.copy(toThree({ x: cx, y: cy, z: lift / 2 }));
    m.receiveShadow = true;
    group.add(m);
  };
  const ew = TABLE.EDGE_LINE_WIDTH;
  addLine(-(W - ew) / 2, 0, ew, L);   // 왼쪽 옆줄
  addLine((W - ew) / 2, 0, ew, L);    // 오른쪽 옆줄
  addLine(0, -(L - ew) / 2, W, ew);   // 가까운 엔드라인
  addLine(0, (L - ew) / 2, W, ew);    // 먼 엔드라인
  addLine(0, 0, TABLE.CENTER_LINE_WIDTH, L); // 중앙선

  // 다리 4개: 바닥(z = -HEIGHT)부터 상판 아래까지
  const legH = TABLE.HEIGHT - T;
  const lx = W / 2 - TABLE.LEG_INSET, ly = L / 2 - TABLE.LEG_INSET;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const leg = makeBox(TABLE.LEG_SIZE, TABLE.LEG_SIZE, legH, RENDER.COLOR_LEG);
      leg.position.copy(toThree({ x: sx * lx, y: sy * ly, z: -T - legH / 2 }));
      group.add(leg);
    }
  }
  return group;
}

// 네트: 반투명 그물 + 위쪽 흰 띠 + 양쪽 지주
function buildNet() {
  const group = new THREE.Group();
  const span = TABLE.WIDTH + 2 * NET.OVERHANG;
  const H = NET.HEIGHT, band = NET.TOP_BAND_HEIGHT;

  const mesh = makeBox(span, NET.THICKNESS, H - band, RENDER.COLOR_NET, {
    transparent: true,
    opacity: RENDER.NET_OPACITY,
  }, 0);
  mesh.castShadow = false;
  mesh.position.copy(toThree({ x: 0, y: 0, z: (H - band) / 2 }));
  group.add(mesh);

  const topBand = makeBox(span, NET.THICKNESS, band, RENDER.COLOR_NET_BAND);
  topBand.position.copy(toThree({ x: 0, y: 0, z: H - band / 2 }));
  group.add(topBand);

  for (const sx of [-1, 1]) {
    const geo = new THREE.CylinderGeometry(NET.POST_RADIUS, NET.POST_RADIUS, H, 16);
    const post = new THREE.Mesh(geo, toon({ color: RENDER.COLOR_POST }));
    post.position.copy(toThree({ x: sx * span / 2, y: 0, z: H / 2 }));
    post.castShadow = true;
    const w = RENDER.OUTLINE_W / 2;
    post.add(outline(new THREE.CylinderGeometry(NET.POST_RADIUS + w, NET.POST_RADIUS + w, H + 2 * w, 16)));
    group.add(post);
  }
  return group;
}

function buildFloor() {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(RENDER.FLOOR_SIZE, RENDER.FLOOR_SIZE);
  const floor = new THREE.Mesh(geo, toon({ color: RENDER.COLOR_FLOOR }));
  floor.rotation.x = -Math.PI / 2;               // Three.js에서 바닥(xz 평면)으로 눕힘
  floor.position.copy(toThree({ x: 0, y: 0, z: -TABLE.HEIGHT }));
  floor.receiveShadow = true;
  group.add(floor);
  // 탁구대 아래 둥근 깔개: 바닥과 색이 달라 탁구대 높이·위치를 읽기 쉽다
  const mx = RENDER.MAT_SIZE.x / 2, my = RENDER.MAT_SIZE.y / 2, r = RENDER.MAT_RADIUS;
  const shape = new THREE.Shape();
  shape.moveTo(-mx + r, -my);
  shape.lineTo(mx - r, -my); shape.quadraticCurveTo(mx, -my, mx, -my + r);
  shape.lineTo(mx, my - r); shape.quadraticCurveTo(mx, my, mx - r, my);
  shape.lineTo(-mx + r, my); shape.quadraticCurveTo(-mx, my, -mx, my - r);
  shape.lineTo(-mx, -my + r); shape.quadraticCurveTo(-mx, -my, -mx + r, -my);
  const mat = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), toon({ color: RENDER.COLOR_MAT }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.copy(toThree({ x: 0, y: 0, z: -TABLE.HEIGHT + RENDER.LINE_LIFT }));
  mat.receiveShadow = true;
  group.add(mat);
  return group;
}

// 하늘: 위에서 아래로 밝아지는 그러데이션 (화면에 고정된 배경)
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#' + RENDER.COLOR_SKY_TOP.toString(16).padStart(6, '0'));
  grad.addColorStop(1, '#' + RENDER.COLOR_BACKGROUND.toString(16).padStart(6, '0'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 공 무늬 텍스처: 적도 띠 + 점 하나. 실제 ω로 돌아가므로 회전 방향과 세기를 눈으로 읽을 수 있다.
function makeBallTexture() {
  const w = RENDER.BALL_TEXTURE_SIZE, h = w / 2;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#' + RENDER.COLOR_BALL.toString(16).padStart(6, '0');
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#' + RENDER.COLOR_BALL_MARK.toString(16).padStart(6, '0');
  g.fillRect(0, h * 0.44, w, h * 0.12);              // 적도 띠
  g.beginPath(); g.arc(w * 0.25, h * 0.2, h * 0.12, 0, Math.PI * 2); g.fill(); // 점
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeArrow(color) {
  const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, color,
    DEBUG_ARROW.HEAD_LENGTH, DEBUG_ARROW.HEAD_WIDTH);
  a.visible = false;
  return a;
}

// 물리 벡터 v(배율 k)를 화살표로 표시한다. 너무 짧으면 숨긴다.
function setArrow(arrow, origin, v, k, show) {
  const len = Math.hypot(v.x, v.y, v.z) * k;
  arrow.visible = show && len >= DEBUG_ARROW.MIN_LENGTH;
  if (!arrow.visible) return;
  arrow.position.copy(origin);
  arrow.setDirection(toThree(v).normalize());
  arrow.setLength(Math.max(len, DEBUG_ARROW.HEAD_LENGTH * 1.5), DEBUG_ARROW.HEAD_LENGTH, DEBUG_ARROW.HEAD_WIDTH);
}

// 공 + 속도(초록)·회전(분홍, 오른손 법칙 축) 디버그 화살표
export function createBallView(scene) {
  const geo = new THREE.SphereGeometry(BALL.RADIUS, RENDER.BALL_SEGMENTS, RENDER.BALL_SEGMENTS / 2);
  const mesh = new THREE.Mesh(geo, toon({ map: makeBallTexture() }));
  mesh.castShadow = true;
  mesh.add(outline(new THREE.SphereGeometry(BALL.RADIUS + RENDER.OUTLINE_BALL, RENDER.BALL_SEGMENTS, RENDER.BALL_SEGMENTS / 2)));
  scene.add(mesh);
  const velArrow = makeArrow(DEBUG_ARROW.COLOR_VEL);
  const spinArrow = makeArrow(DEBUG_ARROW.COLOR_SPIN);
  scene.add(velArrow, spinArrow);
  const q = new THREE.Quaternion();
  let showArrows = true;

  // pos: 화면에 그릴(보간된) 위치, frameDt: 화면 프레임 시간 → 공 무늬를 ω만큼 돌린다
  function update(pos, vel, spin, frameDt) {
    mesh.position.copy(toThree(pos));
    const w = Math.hypot(spin.x, spin.y, spin.z);
    if (w > 0) {
      // 좌표 변환 (x, y, z) → (x, z, −y)은 회전(행렬식 +1)이므로 각속도 벡터도 같은 식으로 바뀐다
      q.setFromAxisAngle(toThree(spin).normalize(), w * frameDt);
      mesh.quaternion.premultiply(q);
    }
    setArrow(velArrow, mesh.position, vel, DEBUG_ARROW.VEL_SCALE, showArrows);
    setArrow(spinArrow, mesh.position, spin, DEBUG_ARROW.SPIN_SCALE, showArrows);
  }

  return {
    mesh,
    update,
    setArrowsVisible(v) { showArrows = v; },
    get arrowsVisible() { return showArrows; },
  };
}

// 라켓: 원판(고무) + 손잡이. update(pos, normal)은 물리 좌표 위치·면 법선(공을 향하는 쪽)
export function createRacketView(scene, color, opacity = 1) {
  const group = new THREE.Group();
  const fade = { transparent: opacity < 1, opacity };
  const w = RENDER.OUTLINE_RACKET;
  const blade = new THREE.Mesh(
    new THREE.CylinderGeometry(RACKET.RADIUS, RACKET.RADIUS, RACKET.THICKNESS, RENDER.RACKET_SEGMENTS),
    toon({ color, ...fade }),
  );
  blade.castShadow = true;
  blade.add(outline(new THREE.CylinderGeometry(RACKET.RADIUS + w, RACKET.RADIUS + w, RACKET.THICKNESS + w, RENDER.RACKET_SEGMENTS), fade));
  group.add(blade); // 원판 축 = 그룹 로컬 y = 면 법선
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(RACKET.HANDLE_LENGTH, RACKET.HANDLE_WIDTH, RACKET.HANDLE_WIDTH),
    toon({ color: RENDER.COLOR_HANDLE, ...fade }),
  );
  handle.position.x = RACKET.RADIUS + RACKET.HANDLE_LENGTH / 2; // 손잡이 = 그룹 로컬 +x
  handle.castShadow = true;
  handle.add(outline(new THREE.BoxGeometry(RACKET.HANDLE_LENGTH + w, RACKET.HANDLE_WIDTH + 2 * w, RACKET.HANDLE_WIDTH + 2 * w), fade));
  group.add(handle);
  group.visible = false;
  scene.add(group);

  const m = new THREE.Matrix4();
  const down = new THREE.Vector3(0, -1, 0);
  function update(pos, normal) {
    if (!pos) { group.visible = false; return; }
    group.visible = true;
    group.position.copy(toThree(pos));
    const n = toThree(normal).normalize();
    // 손잡이는 면 안에서 아래쪽을 향하게
    const hx = down.clone().addScaledVector(n, -down.dot(n));
    if (hx.lengthSq() < 1e-6) hx.set(1, 0, 0);
    hx.normalize();
    const z = new THREE.Vector3().crossVectors(hx, n);
    m.makeBasis(hx, n, z);
    group.quaternion.setFromRotationMatrix(m);
  }
  return { update, group };
}

// 예측 정점 표시 고리 (반지름 r, 라켓 평면과 나란히)
export function createMarkerView(scene) {
  const geo = new THREE.RingGeometry(RENDER.MARKER_INNER, 1, 48);
  const mat = new THREE.MeshBasicMaterial({
    color: RENDER.COLOR_MARKER, transparent: true, opacity: RENDER.MARKER_OPACITY, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.visible = false;
  scene.add(ring);
  return {
    // smash: 스매시 가능한 높이면 빨간 고리
    update(pos, radius, smash = false) {
      ring.visible = !!pos;
      if (!pos) return;
      mat.color.setHex(smash ? RENDER.COLOR_MARKER_SMASH : RENDER.COLOR_MARKER);
      ring.position.copy(toThree(pos));
      ring.scale.setScalar(radius); // RingGeometry는 xy 평면 = 물리 xz 평면(y 방향을 바라봄)
    },
  };
}

// 서브 가이드라인: 예상 궤적 점선 + 탁구대 위 바운드 표시 고리 2개 (내 코트 첫 바운드, 상대 코트 착지)
// update(guide | null) — guide = { points: [물리 좌표], bounces: [물리 좌표 2개] }
export function createGuideView(scene) {
  const N = Math.ceil(SERVE_GUIDE.MAX_T / (SERVE_GUIDE.POINT_STEP * PHYSICS.DT)) + 4;
  const pos = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({
    color: SERVE_GUIDE.COLOR_PATH, dashSize: SERVE_GUIDE.DASH, gapSize: SERVE_GUIDE.GAP,
    transparent: true, opacity: SERVE_GUIDE.OPACITY, depthWrite: false,
  }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  const marks = [SERVE_GUIDE.COLOR_OWN, SERVE_GUIDE.COLOR_TARGET].map((color) => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: SERVE_GUIDE.OPACITY, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2; // xy 평면 고리 → 탁구대 윗면(Three.js xz 평면)에 눕힌다
    m.scale.setScalar(SERVE_GUIDE.MARK_RADIUS);
    m.visible = false;
    scene.add(m);
    return m;
  });
  let shown = null;
  return {
    update(guide) {
      const vis = !!guide;
      line.visible = vis;
      for (const m of marks) m.visible = vis;
      if (!vis || guide === shown) return; // 같은 가이드면 다시 올리지 않는다
      shown = guide;
      const n = Math.min(guide.points.length, N);
      for (let i = 0; i < n; i++) {
        const v = toThree(guide.points[i]);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      }
      geo.setDrawRange(0, n);
      geo.attributes.position.needsUpdate = true;
      geo.computeBoundingSphere();
      line.computeLineDistances(); // 점선 무늬
      guide.bounces.forEach((b, i) => marks[i].position.copy(toThree({ x: b.x, y: b.y, z: RENDER.LINE_LIFT * 2 })));
    },
  };
}

// 공 꼬리: 점(Points)을 그린다. 점 색 = 구질 색, 오래된 점일수록 투명하게.
// 화풍 정리: 밝은 하늘·크림 바닥에서는 가산 혼합이 하얗게 바래 보여, 점마다 알파(RGBA)를 둔 보통 혼합으로 바꿨다.
// update(points[{ pos, color }]) — pos는 물리 좌표, color는 0xRRGGBB, 오래된 것부터.
function makeDotTexture() {
  const n = FEEL.TRAIL_SPRITE_SIZE;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(c);
}

export function createTrailView(scene) {
  const N = FEEL.TRAIL_MAX_POINTS;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4)); // 4성분이면 점마다 알파를 쓴다
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({
    size: FEEL.TRAIL_POINT_SIZE, map: makeDotTexture(), vertexColors: true, transparent: true,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  const c = new THREE.Color();
  return {
    update(list) {
      const n = Math.min(list.length, N);
      for (let i = 0; i < n; i++) {
        const q = list[list.length - n + i];
        const v = toThree(q.pos);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        const fade = ((i + 1) / n) ** 1.5; // 새 점일수록 진하게
        c.setHex(q.color);
        col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b; col[i * 4 + 3] = fade;
      }
      geo.setDrawRange(0, n);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

// 장면을 만들고 그리기 함수들을 돌려준다.
// quality (6단계 모바일): { pixelRatio, shadowSize, antialias, softShadow }. 없으면 PC 기본값.
export function createRenderer(canvas, quality = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias ?? true });
  renderer.setPixelRatio(quality.pixelRatio ?? Math.min(window.devicePixelRatio, RENDER.MAX_PIXEL_RATIO));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = (quality.softShadow ?? true) ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(RENDER.COLOR_BACKGROUND, RENDER.FOG_NEAR, RENDER.FOG_FAR);

  const camera = new THREE.PerspectiveCamera(RENDER.CAMERA_CLASSIC.fov, 1, RENDER.CAMERA_NEAR, RENDER.CAMERA_FAR);

  scene.add(new THREE.AmbientLight(0xffffff, RENDER.AMBIENT_INTENSITY));
  const key = new THREE.DirectionalLight(0xffffff, RENDER.KEY_LIGHT_INTENSITY);
  key.position.copy(toThree(RENDER.KEY_LIGHT_POS));
  key.castShadow = true;
  key.shadow.mapSize.set(quality.shadowSize ?? RENDER.SHADOW_MAP_SIZE, quality.shadowSize ?? RENDER.SHADOW_MAP_SIZE);
  const sc = key.shadow.camera;
  sc.left = -TABLE.LENGTH; sc.right = TABLE.LENGTH; sc.top = TABLE.LENGTH; sc.bottom = -TABLE.LENGTH;
  scene.add(key);

  scene.add(buildFloor());
  scene.add(buildTable());
  scene.add(buildNet());

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // 화면 흔들림: 물리 좌표 이동량 { x, z }만큼 카메라를 옮긴다 (시선 방향은 그대로)
  let camBase = new THREE.Vector3();
  function setShake(off) {
    camera.position.copy(camBase).add(toThree({ x: off.x, y: 0, z: off.z }));
  }

  // 시점: cam = { pos, target, fov } (물리 좌표, 내 자리에 맞게 이미 돌린 값. input.js cameraFor).
  // 대전에서 side +1이면 z축으로 180° 돌아간 시점이라 자기 기준 같은(왼쪽 위) 시점이 된다.
  function setCamera(cam) {
    camBase = toThree(cam.pos);
    camera.position.copy(camBase);
    camera.lookAt(toThree(cam.target));
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  setCamera(RENDER.CAMERA_CLASSIC);

  function render() {
    renderer.render(scene, camera);
  }

  // 화면 좌표(clientX, clientY) → 카메라에서 나가는 광선 (물리 좌표 원점·방향)
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function screenRay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    // 흔들림이 마우스 → 라켓 위치에 섞이면 스윙 속도 판정이 흔들리므로, 흔들리지 않은 카메라로 계산한다
    const shaken = camera.position.clone();
    camera.position.copy(camBase);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    camera.position.copy(shaken);
    camera.updateMatrixWorld();
    return { origin: fromThree(raycaster.ray.origin), dir: fromThree(raycaster.ray.direction) };
  }

  // 물리 좌표 → 화면 좌표 (clientX, clientY). 디버그·자동 점검용
  function worldToScreen(p) {
    const v = toThree(p).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  // 화면 품질 바꾸기 (모바일 자동 품질·디버그 패널)
  function setPixelRatio(r) {
    if (Math.abs(renderer.getPixelRatio() - r) < 1e-6) return;
    renderer.setPixelRatio(r);
    resize();
  }
  function setShadowSize(n) {
    if (key.shadow.mapSize.x === n) return;
    key.shadow.mapSize.set(n, n);
    key.shadow.map?.dispose();
    key.shadow.map = null; // 다음 그리기에서 새 크기로 다시 만든다
  }

  resize();
  const aspect = () => camera.aspect;
  return {
    renderer, scene, camera, resize, render, screenRay, worldToScreen, setShake, setCamera, aspect, setPixelRatio, setShadowSize,
  };
}
