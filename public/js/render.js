// render.js — Three.js 장면 구성과 그리기.
// 물리 좌표계(z가 위)와 Three.js 좌표계(y가 위)의 변환은 이 파일에서만 한다.
import * as THREE from 'three';
import { TABLE, NET, BALL, RENDER, DEBUG_ARROW } from '../shared/constants.js';

// 물리 (x, y, z) → Three.js (x, z, -y)
// 물리 y축(탁구대 길이)이 화면 안쪽으로 들어가도록 Three.js의 -z에 대응시킨다.
export function toThree(p) {
  return new THREE.Vector3(p.x, p.z, -p.y);
}

// 물리 좌표계 크기 (sx, sy, sz) → Three.js 박스 크기
function boxSize(sx, sy, sz) {
  return [sx, sz, sy];
}

function makeBox(sx, sy, sz, color, opts = {}) {
  const geo = new THREE.BoxGeometry(...boxSize(sx, sy, sz));
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 탁구대: 상판 + 흰 선 + 다리
function buildTable() {
  const group = new THREE.Group();
  const L = TABLE.LENGTH, W = TABLE.WIDTH, T = TABLE.THICKNESS;

  // 상판: 윗면이 물리 z = 0
  const top = makeBox(W, L, T, RENDER.COLOR_TABLE, { roughness: 0.5 });
  top.position.copy(toThree({ x: 0, y: 0, z: -T / 2 }));
  group.add(top);

  // 흰 선 (얇은 판을 상판 위에 살짝 띄움)
  const lineMat = new THREE.MeshStandardMaterial({ color: RENDER.COLOR_LINE, roughness: 0.4 });
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
  });
  mesh.castShadow = false;
  mesh.position.copy(toThree({ x: 0, y: 0, z: (H - band) / 2 }));
  group.add(mesh);

  const topBand = makeBox(span, NET.THICKNESS, band, RENDER.COLOR_NET_BAND);
  topBand.position.copy(toThree({ x: 0, y: 0, z: H - band / 2 }));
  group.add(topBand);

  for (const sx of [-1, 1]) {
    const geo = new THREE.CylinderGeometry(NET.POST_RADIUS, NET.POST_RADIUS, H, 16);
    const post = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: RENDER.COLOR_POST, metalness: 0.5, roughness: 0.4 }));
    post.position.copy(toThree({ x: sx * span / 2, y: 0, z: H / 2 }));
    post.castShadow = true;
    group.add(post);
  }
  return group;
}

function buildFloor() {
  const geo = new THREE.PlaneGeometry(RENDER.FLOOR_SIZE, RENDER.FLOOR_SIZE);
  const mat = new THREE.MeshStandardMaterial({ color: RENDER.COLOR_FLOOR, roughness: 0.9 });
  const floor = new THREE.Mesh(geo, mat);
  floor.rotation.x = -Math.PI / 2;               // Three.js에서 바닥(xz 평면)으로 눕힘
  floor.position.copy(toThree({ x: 0, y: 0, z: -TABLE.HEIGHT }));
  floor.receiveShadow = true;
  return floor;
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
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.45 }));
  mesh.castShadow = true;
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

// 장면을 만들고 그리기 함수들을 돌려준다.
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.MAX_PIXEL_RATIO));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(RENDER.COLOR_BACKGROUND);

  const camera = new THREE.PerspectiveCamera(RENDER.CAMERA_FOV, 1, RENDER.CAMERA_NEAR, RENDER.CAMERA_FAR);
  camera.position.copy(toThree(RENDER.CAMERA_POS));
  camera.lookAt(toThree(RENDER.CAMERA_TARGET));

  scene.add(new THREE.AmbientLight(0xffffff, RENDER.AMBIENT_INTENSITY));
  const key = new THREE.DirectionalLight(0xffffff, RENDER.KEY_LIGHT_INTENSITY);
  key.position.copy(toThree(RENDER.KEY_LIGHT_POS));
  key.castShadow = true;
  key.shadow.mapSize.set(RENDER.SHADOW_MAP_SIZE, RENDER.SHADOW_MAP_SIZE);
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

  function render() {
    renderer.render(scene, camera);
  }

  resize();
  return { renderer, scene, camera, resize, render };
}
