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
});
