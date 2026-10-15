// 규격·물리 상수·판정 임계값. 프로젝트의 모든 수치는 이 파일에서만 정의한다.

// 게임 버전: "v단계.수정번호". 푸시할 때마다 올리고, 화면 왼쪽 아래에 표시한다 (CLAUDE.md 8장).
// 사용자는 배포 주소에서 이 글자를 보고 새 버전이 반영됐는지 확인한다.
export const VERSION = 'v5.1';
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
  PEAK_DT: 0.025,            // 창 안에서 최고 속도를 재는 짧은 구간 길이 (s)
  CURVE_WINDOW: 0.1,         // 곡률을 재는 시간 창 (s)
  BLOCK_SPEED: 0.25,         // 이보다 느리면 블록 (m/s)
  SPEED_FULL: 3.5,           // 세기 s = 1이 되는 드래그 속도 (m/s)
  SMASH_SPEED: 2.8,          // 아래로 이보다 빠르면 스매시 시도 (m/s)
  SMASH_MIN_HEIGHT: 0.20,    // 스매시 가능 높이: 공 중심이 네트 위 이만큼 이상 (m)
  DIR_SIN: 0.5,              // sinθ가 이보다 크면 위쪽, −이보다 작으면 아래쪽 드래그
  CURVE_MIN: 0.18,           // 곡률(현에서 벗어난 최대 거리 / 현 길이)이 이 이상이면 사이드스핀
  HIT_RADIUS: 0.18,          // 라켓 중심에서 좌우·높이 도달 범위 (m)
  SERVE_HIT_RADIUS: 0.24,    // 서브(토스한 공)를 칠 때의 도달 범위 (m). 랠리보다 넓게 해 헛스윙을 줄인다
  REACH_Y: 0.30,             // 라켓 평면에서 앞뒤 도달 범위 (m)
  PERFECT_WINDOW: 0.05,      // |타격 − 정점| 이내면 PERFECT (s)
  GOOD_WINDOW: 0.13,
  OK_WINDOW: 0.24,
  ACC_PERFECT: 1.0,          // 판정별 정확도
  ACC_GOOD: 0.75,
  ACC_OK: 0.5,
  ACC_BAD: 0.25,
  ERR_YAW: 7,                // 정확도 0일 때 좌우 방향 최대 무작위 오차 (°)
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
  DRIVE_V_MIN: 5, DRIVE_V_MAX: 8.5, DRIVE_SPIN_MIN: 30, DRIVE_SPIN_MAX: 80,
  DRIVE_DEPTH: 0.85, DRIVE_PITCH: -25, DRIVE_LAMBDA_TOP: 0.1, DRIVE_LAMBDA_BACK: 0.3,
  SMASH_V_MIN: 10, SMASH_V_MAX: 15, SMASH_SPIN_MIN: 5, SMASH_SPIN_MAX: 15,
  SMASH_DEPTH: 0.95, SMASH_PITCH: -15, SMASH_LAMBDA_TOP: 0.05, SMASH_LAMBDA_BACK: 0.3,
  CUT_V_MIN: 4.5, CUT_V_MAX: 6, CUT_SPIN_MIN: 15, CUT_SPIN_MAX: 40,     // 백스핀 (rps)
  CUT_DEPTH: 0.6, CUT_PITCH: 40, CUT_LAMBDA_TOP: 0.8, CUT_LAMBDA_BACK: 0.1,
  SIDE_V_MIN: 5, SIDE_V_MAX: 7.5, SIDE_SPIN_MIN: 30, SIDE_SPIN_MAX: 60, // 횡회전 (rps)
  SIDE_TOP_MIN: 10, SIDE_TOP_MAX: 20, SIDE_DEPTH: 0.8, SIDE_PITCH: -10, SIDE_LAMBDA_TOP: 0.2, SIDE_LAMBDA_BACK: 0.4,
  BLOCK_DEPTH: 0.75, BLOCK_LAMBDA_TOP: 0.1, BLOCK_LAMBDA_BACK: 1.0,
  // 서브: 속도는 세기로 보간, 회전은 판정된 구질(드라이브 = 탑, 커트 = 백, 사이드 = 횡)의 범위를 쓴다
  SERVE_V_MIN: 3.5, SERVE_V_MAX: 5.5, SERVE_DEPTH: 0.9, SERVE_SPIN_SCALE: 0.45,
  SERVE_ASSIST_V: 7.5,       // 서브 속도 보조 상한: 고른 속도로 들어가는 서브가 없으면 이 속도까지 올려 본다 (m/s)
  SERVE_ERR_SCALE: 0.3,      // 서브 방향·속도 오차 배율 (1 = 랠리와 같음). 작을수록 타이밍이 어긋나도 잘 들어간다
};

// AI 로봇 난이도별 수치 (EASY 쉬움 / NORMAL 보통 / HARD 어려움)
// DELAY 반응 지연(s), MOVE 라켓 이동 최대 속도(m/s), TIMING 타이밍 오차 범위 ±(s),
// S_MIN·S_MAX 세기 범위, AIM_X 목표 x 범위 ±(m), JITTER 샘플 떨림(m), W_* 구질 선택 비율
const AI_TUNABLE = {
  AI_EASY_DELAY: 0.35, AI_EASY_MOVE: 1.5, AI_EASY_TIMING: 0.09, AI_EASY_S_MIN: 0.2, AI_EASY_S_MAX: 0.4,
  AI_EASY_AIM_X: 0.15, AI_EASY_JITTER: 0.003,
  AI_EASY_W_DRIVE: 70, AI_EASY_W_BLOCK: 30, AI_EASY_W_CUT: 0, AI_EASY_W_SIDE: 0, AI_EASY_W_SMASH: 0,
  AI_NORMAL_DELAY: 0.22, AI_NORMAL_MOVE: 2.5, AI_NORMAL_TIMING: 0.05, AI_NORMAL_S_MIN: 0.3, AI_NORMAL_S_MAX: 0.55,
  AI_NORMAL_AIM_X: 0.3, AI_NORMAL_JITTER: 0.002,
  AI_NORMAL_W_DRIVE: 60, AI_NORMAL_W_BLOCK: 15, AI_NORMAL_W_CUT: 15, AI_NORMAL_W_SIDE: 10, AI_NORMAL_W_SMASH: 0,
  AI_HARD_DELAY: 0.12, AI_HARD_MOVE: 4.0, AI_HARD_TIMING: 0.02, AI_HARD_S_MIN: 0.5, AI_HARD_S_MAX: 1.0,
  AI_HARD_AIM_X: 0.6, AI_HARD_JITTER: 0.001,
  AI_HARD_W_DRIVE: 40, AI_HARD_W_BLOCK: 10, AI_HARD_W_CUT: 15, AI_HARD_W_SIDE: 20, AI_HARD_W_SMASH: 15,
};

// 연출(4단계): FX_*·SND_* 이름의 켜기/끄기는 1 = 켬, 0 = 끔 (TUNABLE_TOGGLES)
// 히트스톱·슬로모션은 화면 표시 시각만 늦추고 물리 시각은 그대로 둔다 (effects.js createViewClock).
const FEEL_TUNABLE = {
  FX_HITSTOP: 1, HITSTOP_FRAMES: 4,          // 스매시 순간 화면 정지 (60 fps 기준 프레임 수)
  FX_SHAKE: 1, SHAKE_GAIN: 0.0018,           // 흔들림 진폭 = SHAKE_GAIN·타격 속도 (m per m/s)
  SHAKE_MAX: 0.05, SHAKE_DECAY: 0.15,        // 진폭 상한 (m), 감쇠 시간 (s)
  FX_TRAIL: 1, TRAIL_TIME: 0.22,             // 공 꼬리 길이 (화면 시간 s)
  TRAIL_SPIN_MIN: 8,                         // 이 회전(rps) 이상이어야 구질 색을 입힌다
  FX_POPUP: 1, POPUP_TIME: 0.9,              // PERFECT / SMASH! / EDGE! 팝업 표시 시간 (s)
  FX_SLOWMO: 1, SLOWMO_RATE: 0.3,            // 매치포인트 결정 순간 화면 재생 속도 배율
  SLOWMO_TIME: 0.9, CATCHUP_RATE: 2,         // 슬로모션 길이 (실제 s), 밀린 화면을 따라잡는 재생 배율
  SND_PITCH: 1, SND_DECAY: 1,                // 모든 타격음 음높이·감쇠 시간 배율
  SND_SPEED_REF: 10,                         // 소리 세기 g = 1 − e^(−속도/이 값) (m/s)
  SND_PITCH_RACKET: 1, SND_PITCH_TABLE: 1, SND_PITCH_NET: 1, SND_PITCH_EDGE: 1, SND_PITCH_FLOOR: 1,
  SND_CROWD: 1, CROWD_GAIN: 0.35,            // 관중 함성 최대 음량
  CROWD_RALLY_FULL: 8,                       // 함성 = 1 − e^(−랠리 수/이 값)
  SND_HEART: 1, HEART_BPM: 96, HEART_GAIN: 0.7, // 매치포인트 심장 박동
  SND_JINGLE: 1,                             // 득점·게임 종료 효과음
  FX_SERVE_GUIDE: 1,                         // 내 서브 가이드라인 (예상 궤적 점선·바운드 지점·타점 고리)
};

export const TUNABLE_DEFAULTS = Object.freeze({
  ...PHYSICS_TUNABLE, ...JUDGE_TUNABLE, ...SHOT_TUNABLE, ...AI_TUNABLE, ...FEEL_TUNABLE,
});

// 디버그 패널에서 슬라이더 대신 체크박스로 보이는 켜기/끄기 키
export const TUNABLE_TOGGLES = Object.freeze([
  'FX_HITSTOP', 'FX_SHAKE', 'FX_TRAIL', 'FX_POPUP', 'FX_SLOWMO', 'SND_CROWD', 'SND_HEART', 'SND_JINGLE', 'FX_SERVE_GUIDE',
]);

// 디버그 패널 묶음 이름 → 키 목록
export const TUNABLE_GROUPS = Object.freeze({
  '물리': Object.keys(PHYSICS_TUNABLE),
  '판정': Object.keys(JUDGE_TUNABLE),
  '구질': Object.keys(SHOT_TUNABLE),
  'AI': Object.keys(AI_TUNABLE),
  '연출': Object.keys(FEEL_TUNABLE),
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
  PEAK_DT: r(0.005, 0.08, 0.005),
  CURVE_WINDOW: r(0.04, 0.4, 0.005),
  BLOCK_SPEED: r(0, 1.5, 0.01),
  SPEED_FULL: r(0.5, 10, 0.05),
  SMASH_SPEED: r(0.5, 6, 0.05),
  SMASH_MIN_HEIGHT: r(0, 0.6, 0.01),
  DIR_SIN: r(0, 1, 0.01),
  CURVE_MIN: r(0, 0.5, 0.005),
  HIT_RADIUS: r(0.05, 0.4, 0.005),
  SERVE_HIT_RADIUS: r(0.05, 0.5, 0.005),
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
  SERVE_V_MIN: r(0, 15, 0.1),
  SERVE_V_MAX: r(0, 15, 0.1),
  SERVE_DEPTH: r(0.2, 1.37, 0.01),
  SERVE_SPIN_SCALE: r(0, 1.5, 0.01),
  SERVE_ASSIST_V: r(0, 15, 0.1),
  SERVE_ERR_SCALE: r(0, 1, 0.01),
  ...aiRanges('EASY'),
  ...aiRanges('NORMAL'),
  ...aiRanges('HARD'),
  ...Object.fromEntries(TUNABLE_TOGGLES.map((k) => [k, r(0, 1, 1)])),
  HITSTOP_FRAMES: r(0, 12, 1),
  SHAKE_GAIN: r(0, 0.01, 0.0001),
  SHAKE_MAX: r(0, 0.2, 0.005),
  SHAKE_DECAY: r(0.02, 0.6, 0.01),
  TRAIL_TIME: r(0.02, 0.6, 0.01),
  TRAIL_SPIN_MIN: r(0, 60, 1),
  POPUP_TIME: r(0.2, 3, 0.05),
  SLOWMO_RATE: r(0.05, 1, 0.05),
  SLOWMO_TIME: r(0, 3, 0.05),
  CATCHUP_RATE: r(1.1, 5, 0.1),
  SND_PITCH: r(0.25, 3, 0.01),
  SND_DECAY: r(0.25, 4, 0.01),
  SND_SPEED_REF: r(1, 40, 0.5),
  SND_PITCH_RACKET: r(0.25, 3, 0.01),
  SND_PITCH_TABLE: r(0.25, 3, 0.01),
  SND_PITCH_NET: r(0.25, 3, 0.01),
  SND_PITCH_EDGE: r(0.25, 3, 0.01),
  SND_PITCH_FLOOR: r(0.25, 3, 0.01),
  CROWD_GAIN: r(0, 1, 0.01),
  CROWD_RALLY_FULL: r(1, 40, 1),
  HEART_BPM: r(40, 180, 1),
  HEART_GAIN: r(0, 1.5, 0.01),
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
  SERVE_ASSIST_STEP: 0.5,    // 서브 속도 보조 간격 (m/s)
  AI_SIDE_CURVE: 0.3,        // 로봇 사이드스핀 스윙 곡률
  AI_RETURN_SPEED: 1.0,      // 로봇이 대기 위치로 돌아가는 속도 (m/s)
  AI_BLOCK_LEAD: 0.15,       // 블록할 때 미리 버튼을 누르는 시간 (s)
  AI_PLANE_BACK: 0.1,        // 로봇 라켓 평면을 스윙 타점보다 뒤에 두는 거리 (m)
  AI_DIR: Object.freeze({ drive: 75, smash: -80, cut: -70, side: 0, block: 0 }), // 로봇 드래그 각도 기본값 (°)
});

// 탁구 규칙 (game-rules.md)
export const RULES = Object.freeze({
  POINTS_TO_WIN: 11,         // 이 점수를 먼저 내고
  WIN_BY: 2,                 // 이만큼 앞서야 게임이 끝난다 (듀스)
  SERVE_TURN: 2,             // 서브권이 몇 점마다 바뀌는지
  DEUCE_AT: 10,              // 둘 다 이 점수 이상이면 1점마다 서브 교대
  BEST_OF: 1,                // 기본 단판. 3이면 3게임 2선승제
});

// 득점 사유 코드 → 화면 문구
export const REASON_LABELS = Object.freeze({
  out: '아웃',
  net: '네트',
  twoBounce: '투 바운드',
  miss: '못 받음',
  volley: '발리',
  doubleHit: '연속 타격',
  ownCourt: '자기 코트',
  serveNoBounce: '서브 폴트 (자기 코트 바운드 없음)',
  serveFault: '서브 폴트',
  let: '렛',
  retoss: '토스 다시',
  tossMiss: '토스 실패',
});

// 서브 (토스 위치는 서버 기준 좌표: 자기 쪽 y < 0)
export const SERVE = Object.freeze({
  TOSS_Y: -1.55,             // 엔드라인(−1.37) 뒤에서 토스한다 (m)
  TOSS_Z: 0.10,              // 토스를 시작하는 손 높이 (탁구대 윗면 기준, m)
  TOSS_X_MAX: 0.6,           // 토스 좌우 위치 한계 (m)
  TOSS_SPEED: 3.0,           // 위로 띄우는 속도 (m/s) → 약 44 cm 올라가고, 토스 뒤 약 0.54 s에 타점 높이(HIT_Z)로 내려온다
  HIT_Z: 0.30,               // 떨어지는 공을 이 높이에서 치는 것을 기준(정점 대비 타이밍)으로 한다 (m). 늦게 쳐도 들어갈 여유를 두려고 높게
  PITCH_MIN: -55,            // 서브 발사각 탐색 범위 (°)
  PITCH_MAX: 20,
  PITCH_STEP: 1.5,           // 서브 발사각을 훑는 간격 (°)
  NEAR: 0.15,                // 목표 깊이에서 이만큼 안이면 가장 낮은 발사각을 고른다 (m)
  CLEAR_STEPS: Object.freeze([1, 0.5, 0]), // 네트 위 여유 = NET_CLEAR × 이 값으로 차례로 시도
});

// 서브 가이드라인 (v4.1): "보통 세기로 위로 휘두른 드라이브 서브를 정점(타점 고리)에서 쳤을 때"의 예상 궤적
export const SERVE_GUIDE = Object.freeze({
  STRENGTH: 0.5,             // 가이드 스윙 세기 (0~1)
  SWING_TIME: 0.1,           // 가이드 스윙(가상 드래그) 길이 (s)
  POINT_STEP: 3,             // 물리 스텝 몇 개마다 점선 점을 하나 찍는지
  MAX_T: 1.5,                // 궤적을 그리는 최대 시간 (s)
  QUANT_X: 0.05,             // 라켓 x를 이 간격으로 반올림해 계산 결과를 재사용한다 (m)
  DASH: 0.05,                // 점선 칠한 길이 (m)
  GAP: 0.035,                // 점선 빈 길이 (m)
  COLOR_PATH: 0xffe066,
  COLOR_OWN: 0x8fe39a,       // 내 코트 첫 바운드 표시
  COLOR_TARGET: 0xff9a3c,    // 상대 코트 착지 표시
  MARK_RADIUS: 0.06,         // 바운드 표시 고리 반지름 (m)
  OPACITY: 0.8,
});

// 일시정지 (v4.1)
export const PAUSE = Object.freeze({
  AUTO_ON_HIDE: true,        // 탭을 옮기거나 창을 최소화하면 자동으로 일시정지
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
  RALLY_TIMEOUT: 3,          // 마지막 타격(토스) 뒤 이 시간이 지나면 시간 초과로 판정 (s)
  SERVE_DELAY: 1.2,          // 로봇이 서브 차례가 된 뒤 토스하기까지 (s)
  POINT_DELAY: 1.8,          // 득점 사유를 보여 주는 시간. 그 뒤 다음 서브 (s)
  SCENARIO_DELAY: 2.0,       // 디버그 규칙 시험: 버튼을 누른 뒤 공을 보내기까지 (마우스를 화면으로 옮길 시간, s)
  MAX_RALLY: 60,             // 자동 랠리 테스트에서 랠리 하나를 끊는 횟수
});

// 디버그 규칙 시험 공 (렛·투 바운드·발리를 일부러 만든다). 위치·속도는 보내는 쪽 기준 좌표
export const SCENARIO = Object.freeze({
  LET_SPEEDS: Object.freeze([4, 4.5, 5, 3.5, 5.5]), // 네트 인 서브를 찾을 속도 후보 (m/s)
  LET_PITCH_STEP: 0.1,       // 발사각 훑는 간격 (°)
  LET_TOPSPIN: 10,           // rps
  LET_MARGIN: 0.1,           // 엔드라인에서 이만큼 안쪽에 떨어져야 함 (m)
  SHORT_SPEED: 4,            // 투 바운드용 짧은 백스핀 공: 네트 가까이(0.24 m) → 0.76 m에 두 번째 바운드
  SHORT_TOPSPIN: -25,
  SHORT_TARGET: Object.freeze({ x: 0, y: 0.3 }),
  LONG_SPEED: 9,             // 발리용 긴 공
  LONG_Z: 0.25,              // 내 라켓 평면을 지나는 높이 (m)
  LONG_PITCH_MIN: -10,
  LONG_PITCH_MAX: 25,
  LONG_PITCH_STEP: 0.25,
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

// ── 4단계: 타격감 연출 (튜닝하지 않는 값. 세기·켜기/끄기는 TUNABLE의 '연출' 묶음) ──
export const FEEL = Object.freeze({
  FRAME_RATE: 60,            // 히트스톱 프레임 수를 초로 바꿀 때 기준 (모니터 주사율과 무관하게 같은 길이)
  VIEW_LAG_MAX: 0.8,         // 화면 표시가 물리보다 늦을 수 있는 최대 시간 (s)
  HISTORY_TIME: 1.5,         // 화면 보간용으로 기억하는 공 상태 길이 (s, VIEW_LAG_MAX + 꼬리 길이보다 길게)
  TELEPORT: 0.5,             // 두 스텝 사이 공이 이보다 많이 움직이면 순간 이동으로 보고 보간·꼬리를 끊는다 (m)
  SHAKE_FREQ_X: 31,          // 흔들림 진동수 (Hz). 두 축을 다르게 해 같은 모양이 반복되지 않게
  SHAKE_FREQ_Z: 23,
  TRAIL_MAX_POINTS: 96,      // 꼬리 점 최대 개수
  TRAIL_POINT_SIZE: 0.04,    // 꼬리 점 크기 (m)
  TRAIL_SPRITE_SIZE: 64,     // 꼬리 점 텍스처 픽셀
  COLOR_TRAIL_TOP: 0xff3b30, // 탑스핀 빨강
  COLOR_TRAIL_BACK: 0x3a8bff, // 백스핀 파랑
  COLOR_TRAIL_SIDE: 0xb04dff, // 횡회전 보라
  COLOR_TRAIL_NONE: 0xe8e8e8, // 회전 약함
  POPUP_RISE: 70,            // 팝업이 떠오르는 거리 (px)
  POPUP_STACK: 34,           // 같은 순간 팝업이 여러 개면 위로 쌓는 간격 (px)
  POPUP_OFFSET_Y: -40,       // 공 화면 위치에서 위로 띄우는 거리 (px)
  POPUPS: Object.freeze({
    perfect: Object.freeze({ text: 'PERFECT', color: '#ffd84d', size: 34 }),
    smash: Object.freeze({ text: 'SMASH!', color: '#ff5a3c', size: 46 }),
    edge: Object.freeze({ text: 'EDGE!', color: '#7fe8ff', size: 40 }),
  }),
});

// 소리 합성 레시피. 각 층(layer)은 사인파(tone) 또는 필터 거친 노이즈(noise)다.
//  g = 1 − e^(−속도/SND_SPEED_REF) (0~1, 속도에 대해 단조 증가)
//  음높이 = freq·배율·(1 + fGain·g), 감쇠 = decay·배율·(1 + dGain·g), 음량 = gain·(GAIN_FLOOR + (1 − GAIN_FLOOR)·g)
//  sweep: 감쇠하는 동안 음높이(필터 주파수)가 freq·sweep까지 미끄러진다 (감기는 소리·묵직하게 떨어지는 소리)
//  delay: 첫 층보다 늦게 시작 (s). 커트의 "사각"은 짧은 노이즈 알갱이 두 개.
const tone = (freq, decay, gain, o = {}) => Object.freeze({ kind: 'tone', freq, decay, gain, sweep: 1, delay: 0, ...o });
const noise = (filter, freq, decay, gain, o = {}) => Object.freeze({ kind: 'noise', filter, freq, decay, gain, q: 1, sweep: 1, delay: 0, ...o });
export const SOUND = Object.freeze({
  GAIN_FLOOR: 0.15,
  FREQ_GAIN: 0.3,            // 층마다 지정하지 않으면 쓰는 fGain·dGain
  DECAY_GAIN: 0.5,
  ATTACK: 0.002,             // 소리 시작 경사 (s)
  MASTER: 0.8,               // 기본 음량
  NOISE_SECONDS: 1,          // 미리 만들어 두는 노이즈 길이 (s)
  // 충돌 종류(물리 이벤트 type)별 기본 소리. racket은 구질별(RACKET_SHOTS)로 바뀐다.
  IMPACT: Object.freeze({
    bounce: Object.freeze([   // 테이블: 속 빈 "똑" + 상판 울림
      tone(950, 0.07, 0.7), tone(210, 0.09, 0.35, { fGain: 0.15 }), noise('bandpass', 3000, 0.012, 0.3, { q: 1.5 }),
    ]),
    edge: Object.freeze([     // 모서리: 높고 갈라지는 "딱" (서로 어울리지 않는 두 음)
      tone(1300, 0.05, 0.6), tone(1870, 0.04, 0.4), noise('highpass', 3500, 0.02, 0.6), tone(260, 0.06, 0.3, { fGain: 0.15 }),
    ]),
    net: Object.freeze([      // 네트: 먹먹하게 "툭" + 그물 스침
      noise('lowpass', 700, 0.09, 0.5), tone(300, 0.04, 0.2, { sweep: 0.8 }), noise('bandpass', 2200, 0.05, 0.15, { q: 0.7, delay: 0.01 }),
    ]),
    floor: Object.freeze([    // 바닥: 낮고 둔하게
      tone(520, 0.11, 0.5), tone(120, 0.15, 0.4, { fGain: 0.1 }), noise('lowpass', 1500, 0.03, 0.3),
    ]),
  }),
  RACKET_SHOTS: Object.freeze({
    drive: Object.freeze([    // "착" 감기는 소리: 위로 미끄러지는 노이즈 + 짧은 고음 마찰
      noise('bandpass', 1800, 0.075, 0.6, { q: 2, sweep: 2.2 }), tone(950, 0.06, 0.45), noise('highpass', 3500, 0.03, 0.35, { delay: 0.006 }),
    ]),
    smash: Object.freeze([    // 묵직하고 날카롭게: 떨어지는 저음 + 아주 짧은 고음 파열
      tone(160, 0.12, 0.9, { sweep: 0.45, fGain: 0.2 }), noise('highpass', 4500, 0.025, 1.0), tone(1400, 0.04, 0.4),
    ]),
    cut: Object.freeze([      // 짧고 사각거리게: 높은 노이즈 알갱이 두 개
      noise('highpass', 5500, 0.03, 0.5), noise('highpass', 6500, 0.022, 0.35, { delay: 0.018 }), tone(1700, 0.02, 0.25),
    ]),
    side: Object.freeze([     // 옆으로 쓸어내리는 마찰 (드라이브의 반대 방향 미끄러짐)
      noise('bandpass', 2600, 0.065, 0.55, { q: 2, sweep: 0.6 }), tone(1000, 0.05, 0.4),
    ]),
    block: Object.freeze([    // 받아 대기만: 작고 단단하게
      tone(800, 0.035, 0.5), noise('bandpass', 1500, 0.015, 0.3, { q: 1.2 }),
    ]),
    mishit: Object.freeze([   // 빗맞음: 둔한 "퍽"
      tone(420, 0.05, 0.6, { sweep: 0.8 }), noise('lowpass', 900, 0.04, 0.4),
    ]),
  }),
  // 관중: 걸러진 노이즈를 느리게 출렁이게
  CROWD_FILTERS: Object.freeze([Object.freeze({ freq: 450, q: 0.8 }), Object.freeze({ freq: 1100, q: 0.9 })]),
  CROWD_BASE: 0.05,          // 랠리가 없을 때 웅성거림 (CROWD_GAIN에 곱함)
  CROWD_LFO_HZ: 0.35,        // 출렁임 빠르기
  CROWD_LFO_DEPTH: 0.3,
  CROWD_SMOOTH: 0.4,         // 음량 변화 시간 상수 (s)
  CHEER_GAIN: 1.6,           // 득점 순간 함성 = 현재 함성 × 이 값 + 랠리 보너스
  CHEER_TIME: 1.2,           // 득점 함성이 가라앉는 시간 (s)
  // 심장 박동: "쿵-쿵" 두 번
  HEART_FREQ: 58, HEART_SWEEP: 0.65, HEART_DECAY: 0.16, HEART_SECOND: 0.28, HEART_SECOND_GAIN: 0.7,
  SCHEDULE_AHEAD: 0.1,       // 박동을 미리 예약하는 시간 (s)
  // 득점·게임 종료 효과음 (Hz, 음 하나 길이 s)
  JINGLE_NOTE: 0.11,
  JINGLE_GAIN: 0.25,
  POINT_WIN: Object.freeze([660, 990]),
  POINT_LOSE: Object.freeze([440, 330]),
  GAME_WIN: Object.freeze([523, 659, 784, 1047, 1319]),
  GAME_LOSE: Object.freeze([392, 349, 311, 262]),
  GAME_NOTE: 0.16,
});

// 사운드 테스트 페이지(?sound=1)의 약·중·강 속도 (m/s)
export const SOUND_TEST = Object.freeze({
  LEVELS: Object.freeze(['약', '중', '강']),
  SPEEDS: Object.freeze({
    drive: Object.freeze([6, 8, 10]),
    smash: Object.freeze([12, 15, 18]),
    cut: Object.freeze([5, 6, 7]),
    side: Object.freeze([6, 7.5, 9]),
    block: Object.freeze([3, 5, 7]),
    mishit: Object.freeze([8, 13, 18]),
    bounce: Object.freeze([3, 7, 14]),
    edge: Object.freeze([3, 7, 14]),
    net: Object.freeze([2, 5, 10]),
    floor: Object.freeze([2, 4, 7]),
  }),
  CROWD_RALLIES: Object.freeze([0, 5, 15]),
});

// 대전 (5단계, .claude/rules/network.md). 탁구 네트 규격 NET과 헷갈리지 않게 ONLINE으로 둔다.
// 대전 중에는 TUNABLE을 바꿀 수 없다(서버는 기본값으로 판정하므로 값이 다르면 판정이 어긋난다).
export const ONLINE = Object.freeze({
  CODE_CHARS: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // 방 코드 문자: 0/O, 1/I 제외
  CODE_LEN: 4,
  NICK_MAX: 12,              // 닉네임 최대 글자 수
  START_DELAY: 3,            // 둘 다 준비되면 이만큼 뒤에 시작 (카운트다운, s)
  SYNC_SAMPLES: 8,           // 시작 전 시계 측정 횟수 (왕복 시간이 가장 짧은 표본을 쓴다)
  SYNC_INTERVAL: 5,          // 게임 중 시계 다시 재는 간격 (s)
  // 서버 hit 검증 (실측: AI 경기 60판 87,590타 최대 15.15 m/s(스매시)·79.2 rps(드라이브).
  // 사람만 낼 수 있는 실타 MISHIT_SPEED 18 m/s × 1.2 = 21.6 → 22, 회전 79.2 × 1.5 ≈ 120)
  MAX_V: 22,                 // 타구 최대 속도 (m/s)
  MAX_SPIN: 120,             // 타구 최대 회전 (rps)
  RACKET_TOL: 0.04,          // 라켓-공 거리 여유: x·z 각각 HIT_RADIUS(서브 SERVE_HIT_RADIUS) + 이 값 (m)
  BALL_TOL: 0.05,            // 보낸 공 위치와 서버가 계산한 공 위치 차이 한도 (m)
  T_PAST: 0.6,               // 서버 시각보다 이만큼 과거인 타격까지 받는다 (s, v5.1: 0.3 → 0.6 지연 흔들림 대비)
  T_FUTURE: 0.05,            // 서버 시각보다 이만큼 미래인 타격까지 받는다 (시계 오차, s)
  GRACE: 0.6,                // 아무도 치지 않을 때 예정 결말 시각 + 이만큼 기다린 뒤 득점 판정 (s, = T_PAST)
  CORRECT_MAX: 2,            // 타격 검증 직후 미리 보내는 바운드 보정(correct) 개수
  CORRECT_EPS: 0.001,        // 내 공과 보정 위치 차이가 이보다 크면 보정을 적용한다 (m)
  // 화면 지연 (클라이언트, v5.1): 공을 "상대 쪽에서는 예상 지연만큼 늦게, 내 쪽에서는 제때" 보여 준다.
  // 지연 = 예상 지연 × s(공 위치), s는 내 코트 LAG_NEAR(기준 y)에서 0 → 상대 엔드 쪽 LAG_FAR에서 1.
  // 그래서 상대 타격이 늦게 도착해도 공이 멈칫하거나 튀지 않고, 내 쪽으로 오며 조금 빨라졌다가 내 코트에서는 지연 0.
  LAG_NEAR: -0.4,            // 이보다 내 쪽(기준 y)에서는 지연 0 (타격 판정과 화면이 일치)
  LAG_FAR: 1.2,              // 이보다 상대 쪽에서는 지연 = 예상 지연
  LAG_MAX: 0.35,             // 예상 지연 상한 (s)
  LAG_RATE_UP: 0.5,          // 지연이 늘어나는 최대 속도 (화면 공 ≥ 0.5배속)
  LAG_RATE_DOWN: 3,          // 지연이 줄어드는 최대 속도 (화면 공 ≤ 4배속: 빠른 스매시도 내 코트 전에 지연 0)
  LAG_EMA: 0.2,              // 상대 타격이 실제로 늦게 도착한 시간의 지수 평균 계수
  LAG_DEV_K: 2,              // 예상 지연 = 평균 + 이 값 × 평균 편차 (흔들림 여유)
  SNAP_TIME: 1.2,            // 되감기용으로 기억하는 경기 상태 길이 (s, T_PAST보다 길게)
  MAX_CATCHUP_STEPS: 2400,   // 한 프레임에 따라잡는 최대 물리 스텝 (탭이 가려졌다 돌아왔을 때, 10 s)
  RACKET_HZ: 15,             // 상대 화면에 내 라켓을 보여 주는 전송 빈도 (Hz)
  // 연결
  RECONNECT_WAIT: 10,        // 끊긴 상대를 기다리는 시간. 넘으면 상대 승리 (s)
  RECONNECT_RETRY: 1,        // 내가 끊겼을 때 다시 접속을 시도하는 간격 (s)
  LOBBY_IDLE: 600,           // 대기실에서 이 시간 동안 시작하지 않으면 방을 닫는다 (s)
  PING_GOOD: 60,             // 핑 표시 색: 이 값 미만 초록 (ms)
  PING_OK: 120,              //            이 값 미만 노랑, 이상 빨강 (ms)
});

// 대전 오류 코드 → 화면 문구
export const ONLINE_ERRORS = Object.freeze({
  full: '방이 가득 찼습니다.',
  noRoom: '없는 방 코드입니다.',
  inUse: '이미 쓰고 있는 방 코드입니다.',
  version: '새 버전이 있습니다. 새로고침(Ctrl+F5)해 주세요.',
  limit: '사용자가 많아요. 잠시 후 다시 시도해 주세요.',
  lost: '서버와 연결이 끊겼습니다.',
});

// 서버가 hit을 거부한 사유 → 화면 문구
export const REJECT_LABELS = Object.freeze({
  time: '시각 오류',
  turn: '차례 아님',
  speed: '속도 초과',
  spin: '회전 초과',
  far: '라켓이 멂',
  pos: '공 위치 불일치',
  away: '상대 대기 중',
  bad: '잘못된 메시지',
});
