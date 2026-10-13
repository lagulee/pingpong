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

// 라켓 (물리 판정용 원판 근사. 타격 도달 범위는 TUNABLE.HIT_RADIUS)
export const RACKET = Object.freeze({
  RADIUS: 0.08,              // 판정 원판 반지름 (렌더링 크기도 이 값)
  THICKNESS: 0.01,           // 판정 두께 (고무 포함)
  HANDLE_LENGTH: 0.1,        // 손잡이 길이 (렌더링용)
  HANDLE_WIDTH: 0.025,
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
// 묶음: 물리 / 판정(드래그·타이밍·조준) / 구질(구질별 결과) / AI(난이도별 로봇 수치)
const PHYSICS_TUNABLE = {
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
};

// 판정: 드래그 속도 u는 라켓 평면 위 m/s (현재 카메라에서 1 px ≈ 1.2 mm)
const JUDGE_TUNABLE = {
  SWING_WINDOW: 0.08,        // 드래그 속도를 재는 접촉 직전 시간 창 (s)
  CURVE_WINDOW: 0.1,         // 곡률을 재는 시간 창 (s)
  BLOCK_SPEED: 0.25,         // 이보다 느리면 블록 (m/s)
  SPEED_FULL: 2.2,           // 세기 s = 1이 되는 드래그 속도 (m/s)
  SMASH_SPEED: 1.4,          // 아래로 이보다 빠르면 스매시 시도 (m/s)
  SMASH_MIN_HEIGHT: 0.20,    // 스매시 가능 높이: 공 중심이 네트 위 이만큼 이상 (m)
  DIR_SIN: 0.5,              // sinθ가 이보다 크면 위쪽, −이보다 작으면 아래쪽 드래그
  CURVE_MIN: 0.18,           // 곡률(현에서 벗어난 최대 거리 / 현 길이)이 이 이상이면 사이드스핀
  HIT_RADIUS: 0.15,          // 라켓 중심에서 좌우·높이 도달 범위 (m)
  REACH_Y: 0.30,             // 라켓 평면에서 앞뒤 도달 범위 (m)
  PERFECT_WINDOW: 0.04,      // |타격 − 정점| 이내면 PERFECT (s)
  GOOD_WINDOW: 0.10,
  OK_WINDOW: 0.18,
  ACC_PERFECT: 1.0,          // 판정별 정확도
  ACC_GOOD: 0.75,
  ACC_OK: 0.5,
  ACC_BAD: 0.25,
  ERR_YAW: 10,               // 정확도 0일 때 좌우 방향 최대 무작위 오차 (°)
  ERR_BIAS: 3,               // 이르거나 늦을 때 한쪽으로 치우치는 오차 (°)
  ERR_PITCH: 3,              // 위아래 최대 오차 (°)
  ERR_SPEED: 0.08,           // 속도 최대 오차 비율
  AIM_X_POS: 0.5,            // 목표 x = AIM_X_POS·라켓 x + AIM_X_DRAG·(드래그 좌우 성분 비율)
  AIM_X_DRAG: 0.6,
  AIM_X_MAX: 0.66,           // 목표 x 한계 (m)
  DEPTH_GAIN: 0.25,          // 드라이브 목표 깊이 += DEPTH_GAIN·(sinθ − 0.7): 올려 칠수록 깊게
  NET_CLEAR: 0.06,           // 조준 시 네트 위 최소 여유 (m)
  BLOCK_PUSH: 1.5,           // 블록 때 라켓을 앞으로 미는 속도 (m/s)
  WEAK_PITCH: 0,             // 버튼 없이 맞은 약한 블록의 면 기울기 (°, + 위로 열림)
  MISHIT_SPEED: 18,          // 낮은 공 스매시(실타) 속도 (m/s)
  MISHIT_AIM_Z: 0.06,        // 실타가 향하는 네트 위치 높이 (m)
};

// 구질별 결과: 속도 V·회전은 세기 s로 최소→최대 보간. DEPTH는 네트에서 상대 쪽 목표 거리(m),
// PITCH는 상대 회전 효과를 계산할 때의 라켓 면 각도(°, − 닫힘).
// LAMBDA_TOP / LAMBDA_BACK: 들어온 공이 탑스핀 / 백스핀일 때 그 회전 효과가 남는 비율(0 = 완벽히 대응, 1 = 그대로).
//   예) 백스핀 공을 블록(BLOCK_LAMBDA_BACK = 1) → 아래로 떨어져 네트, 탑스핀 공을 커트(CUT_LAMBDA_TOP 큼) → 뜬다.
const SHOT_TUNABLE = {
  DRIVE_V_MIN: 6, DRIVE_V_MAX: 10, DRIVE_SPIN_MIN: 30, DRIVE_SPIN_MAX: 80,
  DRIVE_DEPTH: 0.85, DRIVE_PITCH: -25, DRIVE_LAMBDA_TOP: 0.1, DRIVE_LAMBDA_BACK: 0.3,
  SMASH_V_MIN: 12, SMASH_V_MAX: 18, SMASH_SPIN_MIN: 5, SMASH_SPIN_MAX: 15,
  SMASH_DEPTH: 0.95, SMASH_PITCH: -15, SMASH_LAMBDA_TOP: 0.05, SMASH_LAMBDA_BACK: 0.3,
  CUT_V_MIN: 5, CUT_V_MAX: 7, CUT_SPIN_MIN: 15, CUT_SPIN_MAX: 40,     // 백스핀 (rps)
  CUT_DEPTH: 0.6, CUT_PITCH: 40, CUT_LAMBDA_TOP: 0.8, CUT_LAMBDA_BACK: 0.1,
  SIDE_V_MIN: 6, SIDE_V_MAX: 9, SIDE_SPIN_MIN: 30, SIDE_SPIN_MAX: 60, // 횡회전 (rps)
  SIDE_TOP_MIN: 10, SIDE_TOP_MAX: 20, SIDE_DEPTH: 0.8, SIDE_PITCH: -10, SIDE_LAMBDA_TOP: 0.2, SIDE_LAMBDA_BACK: 0.4,
  BLOCK_DEPTH: 0.75, BLOCK_LAMBDA_TOP: 0.1, BLOCK_LAMBDA_BACK: 1.0,
};

// AI 로봇 난이도별 수치 (EASY 쉬움 / NORMAL 보통 / HARD 어려움)
// DELAY 반응 지연(s), MOVE 라켓 이동 최대 속도(m/s), TIMING 타이밍 오차 범위 ±(s),
// S_MIN·S_MAX 세기 범위, AIM_X 목표 x 범위 ±(m), JITTER 샘플 떨림(m), W_* 구질 선택 비율
const AI_TUNABLE = {
  AI_EASY_DELAY: 0.35, AI_EASY_MOVE: 1.5, AI_EASY_TIMING: 0.09, AI_EASY_S_MIN: 0.3, AI_EASY_S_MAX: 0.5,
  AI_EASY_AIM_X: 0.2, AI_EASY_JITTER: 0.003,
  AI_EASY_W_DRIVE: 70, AI_EASY_W_BLOCK: 30, AI_EASY_W_CUT: 0, AI_EASY_W_SIDE: 0, AI_EASY_W_SMASH: 0,
  AI_NORMAL_DELAY: 0.22, AI_NORMAL_MOVE: 2.5, AI_NORMAL_TIMING: 0.05, AI_NORMAL_S_MIN: 0.4, AI_NORMAL_S_MAX: 0.7,
  AI_NORMAL_AIM_X: 0.4, AI_NORMAL_JITTER: 0.002,
  AI_NORMAL_W_DRIVE: 50, AI_NORMAL_W_BLOCK: 15, AI_NORMAL_W_CUT: 20, AI_NORMAL_W_SIDE: 15, AI_NORMAL_W_SMASH: 0,
  AI_HARD_DELAY: 0.12, AI_HARD_MOVE: 4.0, AI_HARD_TIMING: 0.02, AI_HARD_S_MIN: 0.5, AI_HARD_S_MAX: 1.0,
  AI_HARD_AIM_X: 0.6, AI_HARD_JITTER: 0.001,
  AI_HARD_W_DRIVE: 40, AI_HARD_W_BLOCK: 10, AI_HARD_W_CUT: 15, AI_HARD_W_SIDE: 20, AI_HARD_W_SMASH: 15,
};

export const TUNABLE_DEFAULTS = Object.freeze({
  ...PHYSICS_TUNABLE, ...JUDGE_TUNABLE, ...SHOT_TUNABLE, ...AI_TUNABLE,
});

// 디버그 패널 묶음 이름 → 키 목록
export const TUNABLE_GROUPS = Object.freeze({
  '물리': Object.keys(PHYSICS_TUNABLE),
  '판정': Object.keys(JUDGE_TUNABLE),
  '구질': Object.keys(SHOT_TUNABLE),
  'AI': Object.keys(AI_TUNABLE),
});

// 실제로 쓰는 튜닝 값 (디버그 패널이 이 객체를 직접 바꾼다)
export const TUNABLE = { ...TUNABLE_DEFAULTS };

// 디버그 슬라이더 범위
const r = (min, max, step) => Object.freeze({ min, max, step });
const shotRanges = (P, vMax) => ({
  [`${P}_V_MIN`]: r(0, vMax, 0.1), [`${P}_V_MAX`]: r(0, vMax, 0.1),
  [`${P}_SPIN_MIN`]: r(0, 150, 1), [`${P}_SPIN_MAX`]: r(0, 150, 1),
  [`${P}_DEPTH`]: r(0.2, 1.37, 0.01), [`${P}_PITCH`]: r(-60, 60, 1),
  [`${P}_LAMBDA_TOP`]: r(0, 1, 0.01), [`${P}_LAMBDA_BACK`]: r(0, 1, 0.01),
});
const aiRanges = (D) => ({
  [`AI_${D}_DELAY`]: r(0, 1, 0.01), [`AI_${D}_MOVE`]: r(0.2, 8, 0.1), [`AI_${D}_TIMING`]: r(0, 0.3, 0.005),
  [`AI_${D}_S_MIN`]: r(0, 1, 0.01), [`AI_${D}_S_MAX`]: r(0, 1, 0.01), [`AI_${D}_AIM_X`]: r(0, 0.7, 0.01),
  [`AI_${D}_JITTER`]: r(0, 0.02, 0.0005),
  ...Object.fromEntries(['DRIVE', 'BLOCK', 'CUT', 'SIDE', 'SMASH'].map((s) => [`AI_${D}_W_${s}`, r(0, 100, 1)])),
});
export const TUNABLE_RANGES = Object.freeze({
  C_D: r(0, 1.5, 0.01),
  K_M: r(0, 0.015, 0.0001),
  SPIN_DECAY: r(0, 3, 0.01),
  E_TABLE: r(0.5, 1, 0.005),
  MU_TABLE: r(0, 1, 0.01),
  E_RACKET: r(0.3, 1, 0.01),
  MU_RACKET: r(0, 1.5, 0.01),
  E_FLOOR: r(0, 1, 0.01),
  NET_KEEP: r(0, 1, 0.01),
  NET_CORD_KEEP: r(0, 1, 0.01),
  SWING_WINDOW: r(0.02, 0.2, 0.005),
  CURVE_WINDOW: r(0.04, 0.4, 0.005),
  BLOCK_SPEED: r(0, 1.5, 0.01),
  SPEED_FULL: r(0.5, 8, 0.05),
  SMASH_SPEED: r(0.5, 6, 0.05),
  SMASH_MIN_HEIGHT: r(0, 0.6, 0.01),
  DIR_SIN: r(0, 1, 0.01),
  CURVE_MIN: r(0, 0.5, 0.005),
  HIT_RADIUS: r(0.05, 0.4, 0.005),
  REACH_Y: r(0.05, 0.8, 0.01),
  PERFECT_WINDOW: r(0, 0.2, 0.005),
  GOOD_WINDOW: r(0, 0.3, 0.005),
  OK_WINDOW: r(0, 0.5, 0.005),
  ACC_PERFECT: r(0, 1, 0.01),
  ACC_GOOD: r(0, 1, 0.01),
  ACC_OK: r(0, 1, 0.01),
  ACC_BAD: r(0, 1, 0.01),
  ERR_YAW: r(0, 30, 0.5),
  ERR_BIAS: r(0, 15, 0.5),
  ERR_PITCH: r(0, 15, 0.5),
  ERR_SPEED: r(0, 0.5, 0.01),
  AIM_X_POS: r(0, 1, 0.01),
  AIM_X_DRAG: r(0, 1, 0.01),
  AIM_X_MAX: r(0, 0.75, 0.01),
  DEPTH_GAIN: r(0, 1, 0.01),
  NET_CLEAR: r(0, 0.2, 0.005),
  BLOCK_PUSH: r(0, 5, 0.05),
  WEAK_PITCH: r(-45, 45, 1),
  MISHIT_SPEED: r(0, 30, 0.5),
  MISHIT_AIM_Z: r(0, 0.15, 0.005),
  ...shotRanges('DRIVE', 30),
  ...shotRanges('SMASH', 35),
  ...shotRanges('CUT', 20),
  ...shotRanges('SIDE', 30),
  SIDE_TOP_MIN: r(0, 150, 1),
  SIDE_TOP_MAX: r(0, 150, 1),
  BLOCK_DEPTH: r(0.2, 1.37, 0.01),
  BLOCK_LAMBDA_TOP: r(0, 1, 0.01),
  BLOCK_LAMBDA_BACK: r(0, 1, 0.01),
  ...aiRanges('EASY'),
  ...aiRanges('NORMAL'),
  ...aiRanges('HARD'),
});

// 구질 이름 (판정 결과 shotType) → 화면 표시
export const SHOT_TYPES = Object.freeze(['drive', 'smash', 'cut', 'side', 'block', 'mishit']);
export const SHOT_LABELS = Object.freeze({
  drive: 'DRIVE', smash: 'SMASH', cut: 'CUT', side: 'SIDESPIN', block: 'BLOCK', mishit: 'MISHIT',
});
export const DIFFICULTIES = Object.freeze(['EASY', 'NORMAL', 'HARD']);
export const DIFFICULTY_LABELS = Object.freeze({ EASY: '쉬움', NORMAL: '보통', HARD: '어려움' });

// 타격·조작 (튜닝하지 않는 값). 위치는 "자기 쪽이 y < 0, +y로 친다"는 각 플레이어 기준 좌표.
export const SWING = Object.freeze({
  HOME_Y: -1.6,              // 예측할 공이 없을 때 라켓 평면 y (m)
  Y_MIN: -TABLE.LENGTH / 2 - 0.6,  // 라켓 평면 y 자동 범위
  Y_MAX: -TABLE.LENGTH / 2 + 0.3,
  X_MAX: 1.2,                // 라켓 x 한계 (m)
  Z_MIN: -0.05,              // 라켓 높이 한계 (탁구대 윗면 기준, m)
  Z_MAX: 0.9,
  HOME: Object.freeze({ x: 0, z: 0.2 }),  // 로봇 대기 위치
  MAX_SAMPLE_AGE: 0.5,       // 이보다 오래된 마우스 샘플은 버린다 (s)
  AIM_ITER: 14,              // 조준 이분법 반복 횟수
  AIM_SCAN: 10,              // 조준 전에 각도 구간을 고르게 훑는 칸 수
  AIM_ROUNDS: 3,             // 방향각 보정 횟수
  AIM_MAX_T: 1.2,            // 조준 시뮬레이션 최대 시간 (s)
  AIM_PITCH_MIN: -30,        // 조준 발사각 탐색 범위 (°)
  AIM_PITCH_MAX: 40,
  BLOCK_PITCH_MIN: -45,      // 블록 면 기울기 탐색 범위 (°)
  BLOCK_PITCH_MAX: 60,
  PREDICT_T: 2.0,            // 궤적 예측 최대 시간 (s)
  PREDICT_AFTER: 0.3,        // 정점 뒤로 더 예측해 두는 시간 (s)
  REF_SIN: 0.7,              // 목표 깊이 보정 기준 sinθ
  AI_SWING_TIME: 0.12,       // 로봇 스윙(가상 드래그) 시간 (s)
  AI_FOLLOW_TIME: 0.1,       // 타격 뒤 팔로스루 (s)
  AI_SAMPLE_DT: 1 / 120,     // 로봇 가상 마우스 샘플 간격 (s)
  AI_SIDE_CURVE: 0.3,        // 로봇 사이드스핀 스윙 곡률
  AI_RETURN_SPEED: 1.0,      // 로봇이 대기 위치로 돌아가는 속도 (m/s)
  AI_BLOCK_LEAD: 0.15,
  AI_PLANE_BACK: 0.1,        // 로봇 라켓 평면을 스윙 타점보다 뒤에 두는 거리 (m)       // 블록할 때 미리 버튼을 누르는 시간 (s)
  AI_DIR: Object.freeze({ drive: 75, smash: -80, cut: -70, side: 0, block: 0 }), // 로봇 드래그 각도 기본값 (°)
});

// 연습 모드
export const PRACTICE = Object.freeze({
  FEED_DELAY: 1.0,           // 시작·랠리 종료 후 로봇이 공을 보내기까지 (s)
  END_DELAY: 1.5,            // 랠리 종료 표시 시간 (s)
  FEED_POS: Object.freeze({ x: 0, y: -1.5, z: 0.25 }), // 로봇 기준 공 보내는 위치
  FEED_SPEED: 7,
  FEED_TOPSPIN: 20,
  FEED_DEPTH: 0.85,          // 내 쪽 네트에서 떨어질 거리 (m)
  FEED_X_RANGE: 0.3,
  RALLY_TIMEOUT: 3,          // 마지막 타격 뒤 이 시간이 지나면 랠리 종료 (s)
  MAX_RALLY: 60,             // 자동 랠리 테스트에서 랠리 하나를 끊는 횟수
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
  COLOR_RACKET_ME: 0xd8342c, // 내 라켓 고무 (빨강)
  COLOR_RACKET_AI: 0x2a4fd0, // 로봇 라켓 고무 (파랑)
  COLOR_HANDLE: 0x9a6a3a,
  RACKET_SEGMENTS: 32,
  RACKET_OPACITY_ME: 0.8,    // 내 라켓은 살짝 비쳐서 공을 가리지 않게
  COLOR_MARKER: 0xffe066,    // 예측 정점 고리
  COLOR_MARKER_SMASH: 0xff4a3a, // 정점이 스매시 가능 높이일 때 고리 색
  MARKER_OPACITY: 0.55,
  MARKER_INNER: 0.9,         // 고리 안쪽 반지름 비율
  FACE_TILT: 25,             // 화면용 라켓 면 기울기: 드래그가 위로 향할수록 덮고(−) 아래로 향할수록 연다(°)
});
