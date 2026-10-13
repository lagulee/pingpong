// 규격·물리 상수·판정 임계값. 프로젝트의 모든 수치는 이 파일에서만 정의한다.
// 좌표계(물리): x = 탁구대 너비, y = 길이(네트 기준 양쪽), z = 높이(위가 +). 단위 m·s·kg.
// 원점: 탁구대 윗면 중앙(네트 바로 아래).

// 탁구대 (ITTF 규격)
export const TABLE = Object.freeze({
  LENGTH: 2.74,              // y 방향 길이
  WIDTH: 1.525,              // x 방향 너비
  HEIGHT: 0.76,              // 바닥에서 윗면까지 높이
  THICKNESS: 0.03,           // 상판 두께 (렌더링용)
  EDGE_LINE_WIDTH: 0.02,     // 가장자리 흰 선 폭
  CENTER_LINE_WIDTH: 0.003,  // 복식용 중앙선 폭
  LEG_SIZE: 0.05,            // 다리 단면 한 변 (렌더링용)
  LEG_INSET: 0.15,           // 다리가 모서리에서 안쪽으로 들어간 거리 (렌더링용)
});

// 네트 (ITTF 규격)
export const NET = Object.freeze({
  HEIGHT: 0.1525,            // 탁구대 윗면에서 네트 위 끝까지
  OVERHANG: 0.1525,          // 옆줄 바깥으로 나간 길이(한쪽)
  THICKNESS: 0.004,          // 렌더링용 두께
  POST_RADIUS: 0.012,        // 지주 반지름 (렌더링용)
  TOP_BAND_HEIGHT: 0.015,    // 위쪽 흰 띠 높이 (렌더링용)
});

// 공 (ITTF 규격)
export const BALL = Object.freeze({
  MASS: 0.0027,
  RADIUS: 0.020,
  INERTIA_FACTOR: 2 / 3,     // 얇은 구 껍질: 관성모멘트 I = (2/3)·m·r²
});

// 라켓 (물리 판정용 원판 근사. 2단계에서 조작과 함께 다듬는다)
export const RACKET = Object.freeze({
  RADIUS: 0.08,              // 판정 원판 반지름
  THICKNESS: 0.01,           // 판정 두께 (고무 포함)
});

// 고정 물리 상수 (튜닝하지 않는 값)
export const PHYSICS = Object.freeze({
  G: 9.8,                    // 중력가속도 (m/s²)
  AIR_DENSITY: 1.2,          // 공기 밀도 ρ (kg/m³)
  DT: 1 / 240,               // 고정 시간 간격 (s)
  MAX_STEPS_PER_FRAME: 24,   // 한 화면 프레임에서 최대 스텝 수 (탭 전환 뒤 폭주 방지)
  REST_SPEED: 0.25,          // 이보다 느리게 닿으면 튀지 않고 면 위에 붙어 굴러감 (m/s, 낙하 높이 약 3 mm)
  EDGE_ZONE: 0.02,           // 탁구대 가장자리에서 이 거리 안쪽에 맞으면 모서리(edge) 판정 (m)
  MU_FLOOR: 0.4,             // 바닥 마찰계수
});

// 디버그 패널에서 바꿀 수 있는 값의 기본값
export const TUNABLE_DEFAULTS = Object.freeze({
  C_D: 0.5,                  // 항력계수
  K_M: 0.004,                // 마그누스 계수: 가속도 a = K_M·(ω × v)  (질량으로 나눈 값)
  SPIN_DECAY: 0.3,           // 회전 감쇠율 (1/s): 매 스텝 ω ← ω·(1 − SPIN_DECAY·dt)
  E_TABLE: 0.95,             // 테이블 표면 반발계수. 공기저항 포함 측정값 √(h₂/h₁) ≈ 0.905 (30.5 cm → 25 cm)
  MU_TABLE: 0.3,             // 테이블 마찰계수
  E_RACKET: 0.85,            // 라켓 반발계수
  MU_RACKET: 0.6,            // 라켓(고무) 마찰계수
  E_FLOOR: 0.75,             // 바닥 반발계수
  NET_KEEP: 0.15,            // 네트 그물에 걸렸을 때 남는 속도 비율
  NET_CORD_KEEP: 0.6,        // 네트 윗줄을 스치고 넘어갈 때 남는 진행 속도 비율
});

// 실제로 쓰는 튜닝 값 (디버그 패널이 이 객체를 직접 바꾼다)
export const TUNABLE = { ...TUNABLE_DEFAULTS };

// 디버그 슬라이더 범위
export const TUNABLE_RANGES = Object.freeze({
  C_D: { min: 0, max: 1.5, step: 0.01 },
  K_M: { min: 0, max: 0.015, step: 0.0001 },
  SPIN_DECAY: { min: 0, max: 3, step: 0.01 },
  E_TABLE: { min: 0.5, max: 1, step: 0.005 },
  MU_TABLE: { min: 0, max: 1, step: 0.01 },
  E_RACKET: { min: 0.3, max: 1, step: 0.01 },
  MU_RACKET: { min: 0, max: 1.5, step: 0.01 },
  E_FLOOR: { min: 0, max: 1, step: 0.01 },
  NET_KEEP: { min: 0, max: 1, step: 0.01 },
  NET_CORD_KEEP: { min: 0, max: 1, step: 0.01 },
});

// 공 발사기 (디버그 패널). 회전은 rps(초당 회전수)로 입력받는다.
export const LAUNCHER = Object.freeze({
  START_Y: -TABLE.LENGTH / 2 - 0.2,  // 가까운 엔드라인 뒤 20 cm에서 발사
  DEFAULTS: Object.freeze({ speed: 7, elevation: 12, azimuth: 0, topspin: 0, sidespin: 0, height: 0.25, x: 0 }),
  RANGES: Object.freeze({
    speed: { min: 0, max: 30, step: 0.1 },        // m/s
    elevation: { min: -30, max: 60, step: 0.5 },  // 발사각(°), 위가 +
    azimuth: { min: -30, max: 30, step: 0.5 },    // 방향각(°), 오른쪽(+x)이 +
    topspin: { min: -150, max: 150, step: 1 },    // rps, + 탑스핀 / − 백스핀
    sidespin: { min: -150, max: 150, step: 1 },   // rps, + 위에서 봐서 반시계(왼쪽으로 휨)
    height: { min: 0.02, max: 1, step: 0.01 },    // 탁구대 윗면 기준 공 중심 높이(m)
    x: { min: -0.7, max: 0.7, step: 0.01 },       // 좌우 위치(m)
  }),
  // 프리셋 버튼: 모두 건너편 코트에 한 번 떨어지도록 맞춘 값
  PRESETS: Object.freeze({
    none: Object.freeze({ speed: 7, elevation: 12, azimuth: 0, topspin: 0, sidespin: 0, height: 0.25, x: 0 }),
    topspin: Object.freeze({ speed: 8, elevation: 17, azimuth: 0, topspin: 60, sidespin: 0, height: 0.25, x: 0 }),
    backspin: Object.freeze({ speed: 5.5, elevation: 8, azimuth: 0, topspin: -40, sidespin: 0, height: 0.25, x: 0 }),
    sideLeft: Object.freeze({ speed: 7, elevation: 12, azimuth: 0, topspin: 0, sidespin: 40, height: 0.25, x: 0.3 }),
    sideRight: Object.freeze({ speed: 7, elevation: 12, azimuth: 0, topspin: 0, sidespin: -40, height: 0.25, x: -0.3 }),
  }),
});

// 1단계 시연: 공을 떨어뜨리고, 일정 시간이 지나면 다시 떨어뜨린다.
export const DEMO = Object.freeze({
  DROP_POS: Object.freeze({ x: 0, y: -0.6, z: 0.5 }),  // 공 중심 시작 위치
  RESET_AFTER: 5,            // 마지막 발사 후 이 시간(s)이 지나면 다시 시작
});

// 디버그 화살표
export const DEBUG_ARROW = Object.freeze({
  VEL_SCALE: 0.05,           // 속도 1 m/s당 화살표 길이(m)
  SPIN_SCALE: 0.0006,        // 회전 1 rad/s당 화살표 길이(m)
  MIN_LENGTH: 0.01,          // 이보다 짧으면 숨김
  HEAD_LENGTH: 0.04,
  HEAD_WIDTH: 0.025,
  COLOR_VEL: 0x40e070,
  COLOR_SPIN: 0xff4fd8,
});

// 렌더링 설정 (물리 좌표계 기준 위치)
export const RENDER = Object.freeze({
  CAMERA_FOV: 50,                                   // 세로 시야각(도)
  CAMERA_NEAR: 0.05,
  CAMERA_FAR: 100,
  CAMERA_POS: Object.freeze({ x: 0, y: -2.9, z: 0.85 }),    // 자기 엔드 뒤 약간 위
  CAMERA_TARGET: Object.freeze({ x: 0, y: 0.35, z: -0.1 }), // 탁구대 중앙보다 약간 먼 쪽
  MAX_PIXEL_RATIO: 2,
  FLOOR_SIZE: 30,
  COLOR_BACKGROUND: 0x10141c,
  COLOR_FLOOR: 0x3a2f2a,
  COLOR_TABLE: 0x1d4f91,
  COLOR_LINE: 0xffffff,
  COLOR_LEG: 0x222222,
  COLOR_NET: 0x111111,
  COLOR_NET_BAND: 0xf2f2f2,
  COLOR_POST: 0x555555,
  AMBIENT_INTENSITY: 0.45,
  KEY_LIGHT_INTENSITY: 2.2,
  KEY_LIGHT_POS: Object.freeze({ x: 1.5, y: -1.0, z: 3.5 }),
  SHADOW_MAP_SIZE: 2048,
  LINE_LIFT: 0.001,          // 흰 선이 상판과 겹쳐 깜빡이지 않도록 띄우는 높이
  NET_OPACITY: 0.85,
  COLOR_BALL: 0xff8c1a,
  COLOR_BALL_MARK: 0xffffff,
  BALL_SEGMENTS: 24,
  BALL_TEXTURE_SIZE: 128,    // 공 무늬 텍스처 가로 픽셀 (세로는 절반)
});
