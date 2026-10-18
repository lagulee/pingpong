// 규격·물리 상수·판정 임계값. 프로젝트의 모든 수치는 이 파일에서만 정의한다.

// 게임 버전: "v단계.수정번호". 푸시할 때마다 올리고, 화면 왼쪽 아래에 표시한다 (CLAUDE.md 8장).
// 사용자는 배포 주소에서 이 글자를 보고 새 버전이 반영됐는지 확인한다.
export const VERSION = 'v7.8';
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
  // 게임용 중력 (v6.0). 실제 중력 PHYSICS.G(9.8)의 0.6배: 같은 거리를 √0.6 ≈ 0.77배 속도로, 1/√0.6 ≈ 1.29배 오래 난다.
  // 회전(마그누스)의 효과는 중력에 비해 1/√0.6 ≈ 1.29배로 커 보인다. 엔진 검증 테스트는 PHYSICS.G로 따로 돌린다.
  G_GAME: 5.88,
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
  // 스매시 버튼(R): 스윙 최고 속도가 이 이상이어야 스매시 (방향 무관, m/s). 느리면 일반 스윙. v7.0: 2.8(아래로) → 2.0.
  // v7.3: 2.0 → 0 (사용자 요청: 빨간 고리 스매시 성공률↑). 휘두르기만 하면(BLOCK_SPEED 이상) 스매시, 느리면 약한 스매시(SMASH_V_MIN)
  SMASH_SPEED: 0,
  // 기본 조작 모드(v7.4, 설정 ⚙): v6.3처럼 드래그 방향·곡률·속도로 구질을 정한다 (버튼 없음).
  // 위·옆 = 드라이브, 아래 = 커트, 아래로 BASIC_SMASH_SPEED 이상 + 빨간 고리 = 스매시, 휘어지게 = 사이드. 값은 v6.3 그대로
  BASIC_SMASH_SPEED: 2.8,    // 기본 모드: 아래로 이보다 빠르면 스매시 시도 (m/s, 마우스). 낮은 공(노란 고리)이면 센 커트
  DIR_SIN: 0.5,              // 기본 모드: sinθ가 −이보다 작으면 아래쪽 드래그(커트·스매시)
  CURVE_MIN: 0.18,           // 기본 모드: 곡률(현에서 벗어난 최대 거리 / 현 길이)이 이 이상이면 사이드스핀
  SMASH_MIN_HEIGHT: 0.50,    // 스매시 가능 높이: 공 중심이 네트 위 이만큼 이상 (m). v6.0: 0.20 → 0.50 (공이 높게 날아 바운드도 높아짐)
  // 빨간 고리(예측 정점이 스매시 높이 이상)일 때 실제로 맞은 높이의 하한: 네트 위 이만큼 이상이면 스매시 (m, v7.2).
  // 사용자 피드백: 빨간 고리에서 스매시가 네트에 걸림 → 정점보다 일찍·늦게 쳐 맞은 높이가 기준 아래면 실타였다.
  // 측정: 빨간 고리 스매시는 맞은 높이 0.4 m 이상이면 144타 중 143~144개 상대 코트, 0.3 m는 32%, 0.2 m 이하는 0%
  // v7.3: 0.25 → 0.05 (탁구대 위 0.20 m). 스매시 속도 보조(SMASH_ASSIST_V)로 낮은 타점도 들어간다: 0.2 m 99.8%, 0.16 m 97%
  SMASH_RING_FLOOR: 0.05,
  BUTTON_WINDOW: 0.08,       // 구질 버튼(Q·W·E·R): 접촉 직전 이 시간 안에 눌려 있던 버튼을 인정 (s, v7.0)
  // 판정용 회전(v7.0): 받는 쪽은 상대가 쳐 보낸 회전에 공기 중 감쇠만 곱한 값 × SPIN_CARRY를 "들어온 회전"으로 읽는다.
  // 물리 바운드 마찰이 백스핀을 거의 지우기 때문(커트 28.5 → 2.9 rps). 공의 비행·바운드는 물리 회전 그대로.
  SPIN_CARRY: 1.0,
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
  NET_CLEAR: 0.06,           // 조준 시 네트 위 최소 여유 (m)
  BLOCK_PUSH: 0.8,           // 블록 때 라켓을 앞으로 미는 속도 (m/s). v6.0: 1.5 → 0.8 (게임 중력에서 반사 공이 덜 떨어져 길게 나감)
  WEAK_PITCH: 0,             // 버튼 없이 맞은 약한 블록의 면 기울기 (°, + 위로 열림)
  MISHIT_SPEED: 18,          // 낮은 공 스매시(실타) 속도 (m/s)
  MISHIT_AIM_Z: 0.06,        // 실타가 향하는 네트 위치 높이 (m)
};

// 구질별 결과: 속도 V·회전은 세기 s로 최소→최대 보간. DEPTH는 네트에서 상대 쪽 목표 거리(m),
// PITCH는 상대 회전 효과를 계산할 때의 라켓 면 각도(°, − 닫힘).
// LAMBDA_TOP / LAMBDA_BACK: 들어온 공이 탑스핀 / 백스핀일 때 그 회전 효과가 남는 비율(0 = 완벽히 대응, 1 = 그대로).
// LAMBDA_SIDE(v7.0): 들어온 횡회전 효과가 남는 비율. 탑/백 성분과 횡 성분에 따로 곱한다.
//   예) 백스핀 공을 블록(BLOCK_LAMBDA_BACK = 1) → 아래로 떨어져 네트, 백스핀 공을 일반 스윙(NORMAL λ = 1) → 네트.
// v7.0 구질 버튼: 일반(버튼 없음) = 무회전, Q 드라이브 · W 커트 · E 사이드 · R 스매시.
// 회전 누적: 나가는 회전 = min(SPIN_CAP, 기본 회전(세기) + STACK × 들어온 같은 종류 회전)
const SHOT_TUNABLE = {
  NORMAL_V_MIN: 2.5, NORMAL_V_MAX: 5.8, NORMAL_APEX_WEAK: 1.15, NORMAL_APEX_STRONG: 0.75,
  NORMAL_DEPTH: 0.75, NORMAL_PITCH: -10, NORMAL_LAMBDA_TOP: 1.0, NORMAL_LAMBDA_BACK: 1.0, NORMAL_LAMBDA_SIDE: 1.0,
  // v6.0 높은 포물선 조준: 드라이브·커트·사이드는 세기로 목표 정점 높이(APEX_WEAK → APEX_STRONG, 탁구대 윗면 기준 m)를 정하고,
  // 착지점과 정점이 맞도록 속도·발사각을 함께 푼다(physics.js solveArc). V_MIN~V_MAX는 그 속도의 한계다.
  // DRIVE_SPIN_MIN은 30 유지 (7단계 계획의 40은 탁구대 높이(5 cm)의 낮은 공 드라이브가 네트에 걸려 사람 대역 98%를 못 지킴)
  DRIVE_V_MIN: 2.5, DRIVE_V_MAX: 5.8, DRIVE_SPIN_MIN: 30, DRIVE_SPIN_MAX: 80,
  DRIVE_APEX_WEAK: 1.15, DRIVE_APEX_STRONG: 0.75,
  DRIVE_DEPTH: 0.7, DRIVE_PITCH: -25, DRIVE_LAMBDA_TOP: 0.1, DRIVE_LAMBDA_BACK: 0.2 /* v7.0: 0.3 → 0.2 */, DRIVE_LAMBDA_SIDE: 0.4,
  DRIVE_SPIN_CAP: 100, DRIVE_STACK: 0.5,
  SMASH_V_MIN: 10, SMASH_V_MAX: 15, SMASH_SPIN_MIN: 5, SMASH_SPIN_MAX: 15, // 스매시는 v6.0에서도 그대로(가장 낮은 각 조준): 느려진 다른 공과 대비
  // 스매시 속도 보조 하한 (m/s, v7.3): 낮은 타점에서 고른 속도로는 상대 코트에 넣을 각이 없으면 0.5 m/s씩 이 속도까지 늦춘다
  SMASH_ASSIST_V: 6,
  // v7.0: 높은 공 스매시는 들어온 회전과 상관없이 넘어간다 (λ 0)
  SMASH_DEPTH: 0.95, SMASH_PITCH: -15, SMASH_LAMBDA_TOP: 0, SMASH_LAMBDA_BACK: 0, SMASH_LAMBDA_SIDE: 0,
  CUT_V_MIN: 2.3, CUT_V_MAX: 4.1, CUT_SPIN_MIN: 25, CUT_SPIN_MAX: 55,   // 백스핀 (rps). v7.0: 15–40 → 25–55
  CUT_APEX_WEAK: 0.9, CUT_APEX_STRONG: 0.7,
  // v7.0 CUT_LAMBDA_TOP 0.8 → 0.3: 탑스핀 공을 커트로 백스핀으로 바꿀 수 있게
  CUT_DEPTH: 0.9 /* v6.0: 0.6 → 0.9 (높게 뜬 짧은 커트는 네트 앞에서 수직으로 튀어 받을 수 없음) */, CUT_PITCH: 40, CUT_LAMBDA_TOP: 0.3, CUT_LAMBDA_BACK: 0.1, CUT_LAMBDA_SIDE: 0.4,
  // 커트 상한이 낮은 이유: 백스핀 100 rps면 마그누스 상승 가속도(≈ 7.5 m/s²)가 게임 중력(5.88)보다 커서 공이 떠오른다
  CUT_SPIN_CAP: 70, CUT_STACK: 0.7,
  SIDE_V_MIN: 2.5, SIDE_V_MAX: 5.0, SIDE_SPIN_MIN: 35, SIDE_SPIN_MAX: 65, // 횡회전 (rps). v7.0: 30–60 → 35–65
  SIDE_APEX_WEAK: 1.1, SIDE_APEX_STRONG: 0.8,
  // v7.0 사이드는 센 탑·백 공에 약하다 (λ 0.2/0.4 → 0.4/0.45), 횡 공에는 강하다.
  // 상한 70: 90이면 쌓인 횡회전으로 공이 옆으로 크게 휘어 맞는 버튼(사이드 → 사이드)도 27%가 아웃됐다(사람 대역 측정)
  SIDE_TOP_MIN: 10, SIDE_TOP_MAX: 20, SIDE_DEPTH: 0.8, SIDE_PITCH: -10, SIDE_LAMBDA_TOP: 0.4, SIDE_LAMBDA_BACK: 0.45, SIDE_LAMBDA_SIDE: 0.15,
  SIDE_SPIN_CAP: 70, SIDE_STACK: 0.6,
  BLOCK_DEPTH: 0.75, BLOCK_LAMBDA_TOP: 0.1, BLOCK_LAMBDA_BACK: 1.0, BLOCK_LAMBDA_SIDE: 0.5,
  // 조합 구질 (v7.3, W+E 사이드 커트 · Q+E 사이드 드라이브): 속도·정점·깊이·면은 바탕 구질(커트·드라이브),
  // 회전 = COMBO_MIX × (바탕 회전, 사이드 회전) — 두 성분 각각 같은 종류로 쌓인다. λ는 바탕 구질과 사이드의 평균.
  // 0.75면 회전 크기는 단일 구질의 약 1.06배 (√(0.75² + 0.75²))
  COMBO_MIX: 0.75,
  // 서브: 속도는 세기로 보간, 회전은 버튼 구질(없음 = 무회전, Q 탑, W 백, E 횡. R 스매시 서브는 막아 일반 서브)의 범위를 쓴다
  SERVE_V_MIN: 2.7, SERVE_V_MAX: 4.3, SERVE_DEPTH: 0.9, SERVE_SPIN_SCALE: 0.45, // v6.0: 3.5–5.5의 √0.6배 (게임 중력)
  SERVE_ASSIST_V: 5.8,       // 서브 속도 보조 상한 (v6.0: 7.5 → 5.8): 고른 속도로 들어가는 서브가 없으면 이 속도까지 올려 본다 (m/s)
  SERVE_ERR_SCALE: 0.3,      // 서브 방향·속도 오차 배율 (1 = 랠리와 같음). 작을수록 타이밍이 어긋나도 잘 들어간다
  // 퍼펙트 콤보 (v7.6, 사용자 요청): PERFECT 타이밍 공격 스윙(일반·드라이브·커트·사이드·스매시·조합)을 이어 치면 콤보가 쌓이고,
  // 단계 L = min(콤보 − 1, COMBO_MAX)만큼 공의 위력이 오른다(첫 PERFECT는 그대로, 둘째 연속부터). PERFECT가 아닌 타격·블록·실타, 또는 실점하면 0으로 돌아간다(서브는 그대로).
  //   회전 × (1 + COMBO_SPIN·L) — 회전 누적 상한도 같은 배율로 오른다
  //   속도: 목표 정점 × (1 − COMBO_APEX·L)로 낮고 빠르게, 속도 한계(V_MAX)와 스매시 속도 × (1 + COMBO_SPEED·L)
  // 사람 전용(로봇은 쌓지 않음). 결과 공은 서버 한도(ONLINE.MAX_V·MAX_SPIN) 안이다.
  COMBO_MAX: 5,
  COMBO_SPEED: 0.06,
  COMBO_SPIN: 0.05,
  COMBO_APEX: 0.05,
};

// AI 로봇 난이도별 수치 (EASY 쉬움 / NORMAL 보통 / HARD 어려움)
// DELAY 반응 지연(s), MOVE 라켓 이동 최대 속도(m/s), TIMING 타이밍 오차 범위 ±(s),
// S_MIN·S_MAX 세기 범위, AIM_X 목표 x 범위 ±(m), JITTER 샘플 떨림(m), W_* 구질 선택 비율(맞는 버튼 안에서),
// READ 들어온 회전을 바르게 읽는 정도 (v7.0): 틀릴 확률 = (1 − READ)·(0.5 + 0.5·회전/상한)
const AI_TUNABLE = {
  AI_EASY_DELAY: 0.35, AI_EASY_MOVE: 1.5, AI_EASY_TIMING: 0.09, AI_EASY_S_MIN: 0.2, AI_EASY_S_MAX: 0.4,
  AI_EASY_AIM_X: 0.15, AI_EASY_JITTER: 0.003,
  AI_EASY_W_DRIVE: 70, AI_EASY_W_BLOCK: 30, AI_EASY_W_CUT: 0, AI_EASY_W_SIDE: 0, AI_EASY_W_SMASH: 0, AI_EASY_W_NORMAL: 20,
  AI_EASY_READ: 0.6,
  AI_NORMAL_DELAY: 0.22, AI_NORMAL_MOVE: 2.5, AI_NORMAL_TIMING: 0.05, AI_NORMAL_S_MIN: 0.3, AI_NORMAL_S_MAX: 0.55,
  AI_NORMAL_AIM_X: 0.3, AI_NORMAL_JITTER: 0.002,
  AI_NORMAL_W_DRIVE: 60, AI_NORMAL_W_BLOCK: 15, AI_NORMAL_W_CUT: 15, AI_NORMAL_W_SIDE: 10, AI_NORMAL_W_SMASH: 20, // v6.0 스매시 0 → 20 (높은 공일 때만)
  AI_NORMAL_W_NORMAL: 10, AI_NORMAL_READ: 0.9,
  AI_HARD_DELAY: 0.12, AI_HARD_MOVE: 4.0, AI_HARD_TIMING: 0.02, AI_HARD_S_MIN: 0.5, AI_HARD_S_MAX: 1.0,
  AI_HARD_AIM_X: 0.6, AI_HARD_JITTER: 0.001,
  AI_HARD_W_DRIVE: 40, AI_HARD_W_BLOCK: 10, AI_HARD_W_CUT: 15, AI_HARD_W_SIDE: 20, AI_HARD_W_SMASH: 60, // v6.0 스매시 15 → 60 (높은 공이 드물어짐)
  AI_HARD_W_NORMAL: 0, AI_HARD_READ: 0.97,
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
  SND_SPEED_REF: 7.7,                        // (v6.0: 10 → 7.7, 느려진 공의 소리 크기 유지) 소리 세기 g = 1 − e^(−속도/이 값) (m/s)
  SND_PITCH_RACKET: 1, SND_PITCH_TABLE: 1, SND_PITCH_NET: 1, SND_PITCH_EDGE: 1, SND_PITCH_FLOOR: 1,
  SND_CROWD: 1, CROWD_GAIN: 0.35,            // 관중 함성 최대 음량
  CROWD_RALLY_FULL: 8,                       // 함성 = 1 − e^(−랠리 수/이 값)
  SND_HEART: 1, HEART_BPM: 96, HEART_GAIN: 0.7, // 매치포인트 심장 박동
  SND_JINGLE: 1,                             // 득점·게임 종료 효과음
  FX_SERVE_GUIDE: 1,                         // 내 서브 가이드라인 (예상 궤적 점선·바운드 지점·타점 고리)
  // 모바일 (v6.2). 켜기/끄기라 이 묶음에 둔다. 모바일 모드(mobile.js detectMobile)에서만 작동한다.
  FX_VIBRATE: 1,                             // 내 타격·내 코트 바운드 때 진동 (지원하지 않는 기기는 조용히 생략)
  SND_SILENT_SWITCH: 1,                      // iOS 무음 스위치를 켜도 소리 (audioSession 'playback'. 다른 앱 음악이 멈출 수 있음)
  FX_AUTO_QUALITY: 1,                        // 프레임이 떨어지면 픽셀 비율을 자동으로 낮춘다
};

// 모바일·터치 (v6.2). 화면·입력 기기 값이라 대전 중에도 바꿀 수 있다(TUNABLE_ONLINE_FREE).
// 터치 감도는 마우스 DPI처럼 각자 맞추는 값이다. 결과 공 속도·회전은 서버 한도(MAX_V·MAX_SPIN) 안으로 같다.
const MOBILE_TUNABLE = {
  // 라켓을 손가락보다 위로 띄우는 거리 (CSS px). 손가락이 닿는 면(지름 약 10~14 mm) 위쪽 가장자리를 넘어
  // 들어오는 공이 보이게 한다. 크면 타점 아래에 위로 쓸어 올릴 자리가 줄어든다 (가로 휴대폰 높이 360~390 px).
  TOUCH_OFFSET_PX: 50,
  // 터치 드래그 속도 배율 = TOUCH_SPEED_GAIN × (화면 높이 px ÷ MOBILE.TOUCH_REF_H).
  // 판정 속도는 "화면 높이의 몇 %를 움직였나"에 비례하므로, 작은 화면에서 같은 손놀림이 훨씬 빠르게 재진다.
  // 화면 높이로 나눠 CSS px 기준(손가락·마우스가 비슷한 px/s)으로 맞추고, 남는 차이는 이 값으로 맞춘다.
  // 0.7 (추정): 1 px/ms 쓸기 ≈ 1.3 m/s(커트), 스매시 2.8 m/s ≈ 2.2 px/ms(손가락 약 0.35 m/s) 이상.
  // 1.0이면 보통 튕기는 손놀림(2~4 px/ms)이 거의 다 스매시 시도가 되어 낮은 공에서 실타가 잦을 것으로 봤다.
  TOUCH_SPEED_GAIN: 0.7,
  TOUCH_LIFT_HOLD: 0.08,     // 손가락을 뗀 뒤에도 "누름"으로 보는 시간 (s). 튕기듯 쓸면 공에 닿기 전에 손이 떨어지므로 (= SWING_WINDOW)
  // 터치 스매시 기준 스윙 속도 (m/s, v7.1). 마우스 기준 SMASH_SPEED 2.0은 휴대폰에서 약 2 px/ms(화면 높이를 0.2 s에 쓸기)라
  // 사용자 피드백(모바일 스매시가 계속 NORMAL)을 받아 터치만 1.0(약 1 px/ms, 보통 빠르기 쓸기)으로 낮췄다
  // v7.3: 1.0 → 0 (마우스 SMASH_SPEED와 함께 속도 조건을 없앰)
  TOUCH_SMASH_SPEED: 0,
  // 기본 조작 모드의 터치 스매시 기준 (m/s, v7.4). 마우스 2.8 × (v7.1 터치 1.0 ÷ 마우스 2.0) = 1.4 ≈ 1.4 px/ms 쓸기
  BASIC_TOUCH_SMASH_SPEED: 1.4,
  // 모바일 시점: PC 시점(CAM_*)에서 시야각과 바라보는 점 높이만 바꾼다. PC 구도 그대로면 가로 휴대폰에서 타점이
  // 화면 아래 65~80%에 있어, 라켓을 손가락 위로 띄우면 타점 아래에 위로 쓸 자리가 40~50 px밖에 없었다(브라우저 점검).
  // 아래를 더 내려다보고(−0.15 → −0.45) 조금 넓게(50 → 54°) 보면 서브 타점이 화면 62%, 낮은 공(0.2 m)이 70%로 올라온다.
  // 대신 네트 위 약 1.4 m보다 높은 공은 화면 위로 잘린다 (탁구대 길이는 화면에서 약 8% 작아짐).
  MOB_CAM_FOV: 54,           // 모바일 시야각 (°, 세로)
  MOB_CAM_TZ: -0.45,         // 모바일 카메라가 바라보는 점 높이 (m, PC CAM_TZ −0.15)
  MOB_PIXEL_RATIO: 1.5,      // 픽셀 비율 상한 (PC는 RENDER.MAX_PIXEL_RATIO 2)
  MOB_SHADOW_SIZE: 1024,     // 그림자 지도 크기 (PC 2048). 공 그림자는 높이 판단에 필요해 끄지 않는다
  MOB_TRAIL_SCALE: 0.5,      // 공 꼬리 점 개수 배율
  MOB_FPS_MIN: 50,           // 자동 품질: 평균 FPS가 이보다 낮으면 픽셀 비율을 낮춘다
  VIB_HIT_MIN: 12, VIB_HIT_MAX: 35, // 내 타격 진동 길이 (ms): 약한 공 → 센 공
  VIB_BOUNCE: 6,             // 내 코트 바운드 진동 길이 (ms)
  // 구질 버튼 (v7.0): 왼손 엄지로 누르는 2×2 버튼 (위: 드라이브·스매시, 아래: 커트·사이드)
  MOB_BTN_SIZE: 64,          // 버튼 한 변 (CSS px)
  MOB_BTN_LEFT: 1,           // 1 = 버튼을 왼쪽에(오른손 스와이프), 0 = 오른쪽에(왼손잡이)
};

// 카메라 (v6.0): 내 엔드 왼쪽 위에서 내려다보는 시점 (물리 좌표, side −1 기준. side +1은 180° 돌린다 → 자기 기준 왼쪽 위).
// 비스듬히 보면 공의 깊이(y)가 화면 가로 이동으로 보여 높이와 헷갈리지 않고, 높은 포물선(정점 약 1.2 m)도 화면에 들어온다.
// Space 키(7단계, 이전 C)로 기존 시점(RENDER.CAMERA_CLASSIC)과 바꾼다. 화면 전용 값이라 대전 중에도 바꿀 수 있다.
const CAMERA_TUNABLE = {
  CAM_X: -0.7, CAM_Y: -3.0, CAM_Z: 1.45,
  CAM_TX: 0.12, CAM_TY: 0.3, CAM_TZ: -0.15,
  CAM_FOV: 50,
  // 시점 거리 배율 (v7.5, 사용자 요청: 더 멀리서 보기). 카메라를 바라보는 점에서 이 배만큼 멀리 둔다(방향·시야각 그대로).
  // 모든 시점(새·정면·모바일)에 적용. 설정 ⚙ 슬라이더·마우스 휠로 바꾸고 이 브라우저에 기억한다. 드래그 판정은 dragScaleFor가 보정
  CAM_DIST: 1,
};

export const TUNABLE_DEFAULTS = Object.freeze({
  ...PHYSICS_TUNABLE, ...JUDGE_TUNABLE, ...SHOT_TUNABLE, ...AI_TUNABLE, ...FEEL_TUNABLE, ...CAMERA_TUNABLE, ...MOBILE_TUNABLE,
});

// 디버그 패널에서 슬라이더 대신 체크박스로 보이는 켜기/끄기 키
export const TUNABLE_TOGGLES = Object.freeze([
  'FX_HITSTOP', 'FX_SHAKE', 'FX_TRAIL', 'FX_POPUP', 'FX_SLOWMO', 'SND_CROWD', 'SND_HEART', 'SND_JINGLE', 'FX_SERVE_GUIDE',
  'FX_VIBRATE', 'SND_SILENT_SWITCH', 'FX_AUTO_QUALITY',
]);

// 대전 중에도 바꿀 수 있는 키 (판정에 영향 없는 화면·소리 값). 나머지는 서버와 같은 기본값으로 고정한다.
export const TUNABLE_ONLINE_FREE = Object.freeze([...TUNABLE_TOGGLES, ...Object.keys(CAMERA_TUNABLE), ...Object.keys(MOBILE_TUNABLE)]);

// 디버그 패널 묶음 이름 → 키 목록
export const TUNABLE_GROUPS = Object.freeze({
  '물리': Object.keys(PHYSICS_TUNABLE),
  '판정': Object.keys(JUDGE_TUNABLE),
  '구질': Object.keys(SHOT_TUNABLE),
  'AI': Object.keys(AI_TUNABLE),
  '연출': Object.keys(FEEL_TUNABLE),
  '카메라': Object.keys(CAMERA_TUNABLE),
  '모바일': Object.keys(MOBILE_TUNABLE),
});

// 실제로 쓰는 튜닝 값 (디버그 패널이 이 객체를 직접 바꾼다)
export const TUNABLE = { ...TUNABLE_DEFAULTS };

// 디버그 슬라이더 범위
const r = (min, max, step) => Object.freeze({ min, max, step });
const shotRanges = (P, vMax) => ({
  [`${P}_V_MIN`]: r(0, vMax, 0.1), [`${P}_V_MAX`]: r(0, vMax, 0.1),
  [`${P}_SPIN_MIN`]: r(0, 150, 1), [`${P}_SPIN_MAX`]: r(0, 150, 1),
  [`${P}_DEPTH`]: r(0.2, 1.37, 0.01), [`${P}_PITCH`]: r(-60, 60, 1),
  [`${P}_LAMBDA_TOP`]: r(0, 1, 0.01), [`${P}_LAMBDA_BACK`]: r(0, 1, 0.01), [`${P}_LAMBDA_SIDE`]: r(0, 1, 0.01),
});
const stackRanges = (P) => ({ [`${P}_SPIN_CAP`]: r(0, 150, 1), [`${P}_STACK`]: r(0, 1.5, 0.01) });
const aiRanges = (D) => ({
  [`AI_${D}_DELAY`]: r(0, 1, 0.01), [`AI_${D}_MOVE`]: r(0.2, 8, 0.1), [`AI_${D}_TIMING`]: r(0, 0.3, 0.005),
  [`AI_${D}_S_MIN`]: r(0, 1, 0.01), [`AI_${D}_S_MAX`]: r(0, 1, 0.01), [`AI_${D}_AIM_X`]: r(0, 0.7, 0.01),
  [`AI_${D}_JITTER`]: r(0, 0.02, 0.0005),
  ...Object.fromEntries(['DRIVE', 'BLOCK', 'CUT', 'SIDE', 'SMASH', 'NORMAL'].map((s) => [`AI_${D}_W_${s}`, r(0, 100, 1)])),
  [`AI_${D}_READ`]: r(0, 1, 0.01),
});
const apexRanges = (P) => ({ [`${P}_APEX_WEAK`]: r(0.3, 1.6, 0.01), [`${P}_APEX_STRONG`]: r(0.3, 1.6, 0.01) });
export const TUNABLE_RANGES = Object.freeze({
  G_GAME: r(4.9, 9.8, 0.01),  // 0.5배 아래는 풍선처럼 보여 범위에서 뺀다
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
  SMASH_SPEED: r(0, 6, 0.05),
  BASIC_SMASH_SPEED: r(0, 6, 0.05),
  DIR_SIN: r(0, 1, 0.01),
  CURVE_MIN: r(0, 0.5, 0.005),
  SMASH_MIN_HEIGHT: r(0, 0.6, 0.01),
  SMASH_RING_FLOOR: r(0, 0.6, 0.01),
  BUTTON_WINDOW: r(0, 0.3, 0.005),
  SPIN_CARRY: r(0, 1.5, 0.01),
  HIT_RADIUS: r(0.05, 0.4, 0.005),
  SERVE_HIT_RADIUS: r(0.05, 0.5, 0.005),
  REACH_Y: r(0.05, 0.8, 0.01),
  PERFECT_WINDOW: r(0, 0.2, 0.005),
  COMBO_MAX: r(0, 10, 1),
  COMBO_SPEED: r(0, 0.15, 0.005),
  COMBO_SPIN: r(0, 0.15, 0.005),
  COMBO_APEX: r(0, 0.1, 0.005),
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
  NET_CLEAR: r(0, 0.2, 0.005),
  BLOCK_PUSH: r(0, 5, 0.05),
  WEAK_PITCH: r(-45, 45, 1),
  MISHIT_SPEED: r(0, 30, 0.5),
  MISHIT_AIM_Z: r(0, 0.15, 0.005),
  NORMAL_V_MIN: r(0, 30, 0.1), NORMAL_V_MAX: r(0, 30, 0.1),
  NORMAL_DEPTH: r(0.2, 1.37, 0.01), NORMAL_PITCH: r(-60, 60, 1),
  NORMAL_LAMBDA_TOP: r(0, 1.5, 0.01), NORMAL_LAMBDA_BACK: r(0, 1.5, 0.01), NORMAL_LAMBDA_SIDE: r(0, 1.5, 0.01),
  ...apexRanges('NORMAL'),
  ...stackRanges('DRIVE'),
  ...stackRanges('CUT'),
  ...stackRanges('SIDE'),
  BLOCK_LAMBDA_SIDE: r(0, 1, 0.01),
  COMBO_MIX: r(0, 1.5, 0.01),
  ...shotRanges('DRIVE', 30),
  ...shotRanges('SMASH', 35),
  ...shotRanges('CUT', 20),
  ...shotRanges('SIDE', 30),
  ...apexRanges('DRIVE'),
  ...apexRanges('CUT'),
  ...apexRanges('SIDE'),
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
  SMASH_ASSIST_V: r(0, 15, 0.1),
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
  CAM_X: r(-2, 2, 0.01), CAM_Y: r(-5, -1.5, 0.01), CAM_Z: r(0.3, 3, 0.01),
  CAM_TX: r(-1, 1, 0.01), CAM_TY: r(-1.5, 1.5, 0.01), CAM_TZ: r(-1, 1, 0.01),
  CAM_FOV: r(25, 90, 1),
  CAM_DIST: r(0.8, 1.8, 0.05),
  TOUCH_OFFSET_PX: r(0, 150, 1),
  TOUCH_SPEED_GAIN: r(0.2, 3, 0.01),
  TOUCH_LIFT_HOLD: r(0, 0.3, 0.005),
  TOUCH_SMASH_SPEED: r(0, 6, 0.05),
  BASIC_TOUCH_SMASH_SPEED: r(0, 6, 0.05),
  MOB_CAM_FOV: r(25, 90, 1),
  MOB_CAM_TZ: r(-1, 1, 0.01),
  MOB_PIXEL_RATIO: r(0.5, 3, 0.05),
  MOB_SHADOW_SIZE: r(256, 2048, 256),
  MOB_TRAIL_SCALE: r(0.1, 1, 0.05),
  MOB_FPS_MIN: r(20, 60, 1),
  VIB_HIT_MIN: r(0, 80, 1), VIB_HIT_MAX: r(0, 80, 1),
  VIB_BOUNCE: r(0, 40, 1),
  MOB_BTN_SIZE: r(40, 110, 1),
  MOB_BTN_LEFT: r(0, 1, 1),
});

// 구질 이름 (판정 결과 shotType) → 화면 표시
export const SHOT_TYPES = Object.freeze(['normal', 'drive', 'smash', 'cut', 'side', 'block', 'mishit', 'sidecut', 'sidedrive']);
// 조합 구질 (v7.3): 사이드 + 커트(W+E) = 횡+백, 사이드 + 드라이브(Q+E) = 횡+탑. 값은 바탕 구질(커트·드라이브) 이름
export const SHOT_COMBOS = Object.freeze({ sidecut: 'cut', sidedrive: 'drive' });
// 구질 버튼 (v7.0): 버튼 이름 → 구질. PC 키는 main.js(Q·W·E·R), 모바일은 화면 버튼
export const SHOT_BUTTONS = Object.freeze(['drive', 'cut', 'side', 'smash']);
export const SHOT_KEYS = Object.freeze({ KeyQ: 'drive', KeyW: 'cut', KeyE: 'side', KeyR: 'smash' });
// 조작 모드 (v7.4, 설정 ⚙): basic = 기본(드래그 방향·속도로 구질, v6.3 방식), advanced = 고급(Q·W·E·R 구질 버튼, 7단계).
// 사람 클라이언트 전용이다. 로봇은 버튼을 쓰고, 서버는 결과 공(vel·spin)만 검증하므로 두 사람이 서로 다른 모드여도 된다
export const CONTROL_MODES = Object.freeze(['basic', 'advanced']);
export const CONTROL_DEFAULT = 'basic';
export const CONTROL_LABELS = Object.freeze({ basic: '기본', advanced: '고급' });
export const SHOT_LABELS = Object.freeze({
  normal: 'NORMAL', drive: 'DRIVE', smash: 'SMASH', cut: 'CUT', side: 'SIDESPIN', block: 'BLOCK', mishit: 'MISHIT',
  sidecut: 'SIDE CUT', sidedrive: 'SIDE DRIVE',
});
export const DIFFICULTIES = Object.freeze(['EASY', 'NORMAL', 'HARD']);
export const DIFFICULTY_LABELS = Object.freeze({ EASY: '쉬움', NORMAL: '보통', HARD: '어려움' });

// 타격·조작 (튜닝하지 않는 값). 위치는 "자기 쪽이 y < 0, +y로 친다"는 각 플레이어 기준 좌표.
export const SWING = Object.freeze({
  HOME_Y: -1.6,              // 예측할 공이 없을 때 라켓 평면 y (m)
  Y_MIN: -TABLE.LENGTH / 2 - 0.3,  // 라켓 평면 y 자동 범위. v6.0: 엔드라인 뒤 0.6 → 0.3 m (탁구대 쪽으로 당김),
  Y_MAX: -TABLE.LENGTH / 2 + 0.67, //  앞쪽 0.3 → 0.67 m (짧게 떨어진 공은 탁구대 위로 손을 뻗어 친다)
  X_MAX: 1.2,                // 라켓 x 한계 (m)
  Z_MIN: -0.05,              // 라켓 높이 한계 (탁구대 윗면 기준, m)
  Z_MAX: 1.3,                // v6.0: 0.9 → 1.3 (높아진 공을 내려치는 스매시 스윙이 위에서 시작할 수 있게)
  HOME: Object.freeze({ x: 0, z: 0.2 }),  // 로봇 대기 위치
  MAX_SAMPLE_AGE: 0.5,       // 이보다 오래된 마우스 샘플은 버린다 (s)
  AIM_ITER: 14,              // 조준 이분법 반복 횟수
  AIM_SCAN: 10,              // 조준 전에 각도 구간을 고르게 훑는 칸 수
  AIM_ROUNDS: 3,             // 방향각 보정 횟수
  AIM_MAX_T: 1.2,            // 조준 시뮬레이션 최대 시간 (s, 실제 중력 기준. simTime이 게임 중력에 맞게 늘린다)
  AIM_PITCH_MIN: -30,        // 조준 발사각 탐색 범위 (°)
  AIM_PITCH_MAX: 40,
  BLOCK_PITCH_MIN: -45,      // 블록 면 기울기 탐색 범위 (°)
  BLOCK_PITCH_MAX: 60,
  PREDICT_T: 2.0,            // 궤적 예측 최대 시간 (s, 실제 중력 기준. simTime이 게임 중력에 맞게 늘린다)
  SIM_T_MARGIN: 1.5,         // 높은 포물선(v6.0)을 위해 시뮬레이션 시간에 곱하는 여유
  ARC_ITER: 10,              // 정점 조준(solveArc) 뉴턴 반복 최대 횟수
  ARC_TOL: 0.004,            // 정점 조준 허용 오차 (착지·정점, m)
  ARC_DV: 0.01,              // 정점 조준 미분용 속도 변화 (m/s)
  ARC_MIN_RISE: 0.08,        // 목표 정점은 타점보다 최소 이만큼 높게 (m)
  PREDICT_AFTER: 0.3,        // 정점 뒤로 더 예측해 두는 시간 (s)
  AI_SWING_TIME: 0.12,       // 로봇 스윙(가상 드래그) 시간 (s)
  AI_FOLLOW_TIME: 0.1,       // 타격 뒤 팔로스루 (s)
  AI_SAMPLE_DT: 1 / 120,     // 로봇 가상 마우스 샘플 간격 (s)
  SERVE_ASSIST_STEP: 0.5,    // 서브 속도 보조 간격 (m/s)
  SMASH_ASSIST_STEP: 0.5,    // 스매시 속도 보조 간격 (m/s, v7.3)
  AI_SIDE_CURVE: 0.3,        // 로봇 사이드스핀 스윙 곡률
  AI_RETURN_SPEED: 1.0,      // 로봇이 대기 위치로 돌아가는 속도 (m/s)
  AI_BLOCK_LEAD: 0.15,       // 블록할 때 미리 버튼을 누르는 시간 (s)
  AI_PLANE_BACK: 0.1,        // 로봇 라켓 평면을 스윙 타점보다 뒤에 두는 거리 (m)
  AI_DIR: Object.freeze({ drive: 75, smash: -80, cut: -70, side: 0, block: 0, normal: 60 }), // 로봇 드래그 각도 (°, v7.0부터 판정에는 안 쓰고 모양만)
  AI_READ_MIN: 8,            // 로봇: 들어온 회전이 이보다 작으면(rps) 무회전 공으로 본다
  AI_SMASH_SWING: 2.2,       // 로봇 스매시 최소 스윙 속도 (m/s). v7.2까지의 SMASH_SPEED 2.0 × 1.1 (v7.3에 사람 기준이 0이 되어 따로 둠)
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
  TOSS_HEIGHT: 0.46,         // 토스로 띄우는 높이 (m, 공기저항 무시). 속도 = √(2·G_GAME·높이) → 기본 중력에서 2.32 m/s (v6.0: 속도 3.0 고정 → 높이 기준)
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
  MAX_T: 2.2,                // 궤적을 그리는 최대 시간 (s, v6.0: 1.5 → 2.2 느려진 서브)
  QUANT_X: 0.05,             // 라켓 x를 이 간격으로 반올림해 계산 결과를 재사용한다 (m)
  DASH: 0.05,                // 점선 칠한 길이 (m)
  GAP: 0.035,                // 점선 빈 길이 (m)
  COLOR_PATH: 0xffe066,
  COLOR_OWN: 0x8fe39a,       // 내 코트 첫 바운드 표시
  COLOR_TARGET: 0xff9a3c,    // 상대 코트 착지 표시
  MARK_RADIUS: 0.06,         // 바운드 표시 고리 반지름 (m)
  OPACITY: 0.8,
});

// 모바일 (v6.2, 튜닝하지 않는 값. 조절 값은 TUNABLE의 '모바일' 묶음)
export const MOBILE = Object.freeze({
  // 모바일 모드: 손가락 화면(pointer: coarse)이면서 화면 짧은 변이 이 이하 (CSS px, 아이패드 프로 1024 포함).
  // 주소에 ?mobile=1이면 강제로 켜고, ?mobile=0이면 끈다. 터치 입력 자체는 모드와 무관하게 작동한다.
  MAX_SHORT_SIDE: 1100,
  TOUCH_REF_H: 900,          // 터치 감도 기준 화면 높이 (CSS px, 판정 임계값을 맞춘 PC 화면 높이)
  REFRESH: 0.05,             // 손가락이 멈춰 있어도 이 간격으로 현재 위치 샘플을 남긴다 (s, 마우스와 같음)
  FPS_WINDOW: 2,             // 자동 품질: 평균 FPS를 재는 시간 (s)
  FPS_SKIP_DT: 0.25,         // 이보다 긴 프레임(탭 전환·일시정지 뒤)은 자동 품질 측정에서 뺀다 (s)
  PIXEL_RATIO_STEP: 0.25,    // 자동 품질: 한 번에 낮추는 픽셀 비율
  PIXEL_RATIO_MIN: 1,        // 자동 품질: 이 아래로는 낮추지 않는다
  NO_AA_DPR: 2,              // 기기 픽셀 비율이 이 이상이면 안티에일리어싱을 끈다 (새로고침 때 적용)
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
  FEED_SPEED: 5.4,           // v6.0: 7 → 5.4 (게임 중력 √0.6배)
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
  LET_SPEEDS: Object.freeze([3.1, 3.5, 3.9, 2.7, 4.3]), // 네트 인 서브를 찾을 속도 후보 (m/s, v6.0: √0.6배)
  LET_PITCH_STEP: 0.1,       // 발사각 훑는 간격 (°)
  LET_TOPSPIN: 10,           // rps
  LET_MARGIN: 0.1,           // 엔드라인에서 이만큼 안쪽에 떨어져야 함 (m)
  SHORT_SPEED: 3.1,          // 투 바운드용 짧은 백스핀 공 (v6.0: 4 → 3.1)
  SHORT_TOPSPIN: -25,
  SHORT_TARGET: Object.freeze({ x: 0, y: 0.3 }),
  LONG_SPEED: 7,             // 발리용 긴 공 (v6.0: 9 → 7)
  LONG_Z: 0.25,              // 내 라켓 평면을 지나는 높이 (m)
  LONG_PITCH_MIN: -10,
  LONG_PITCH_MAX: 25,
  LONG_PITCH_STEP: 0.25,
});

// 공 발사기 (디버그 패널). 회전은 rps(초당 회전수)로 입력받는다.
export const LAUNCHER = Object.freeze({
  START_Y: -TABLE.LENGTH / 2 - 0.2,  // 가까운 엔드라인 뒤 20 cm에서 발사
  DEFAULTS: Object.freeze({ speed: 5.4, elevation: 12, azimuth: 0, topspin: 0, sidespin: 0, height: 0.25, x: 0 }),
  RANGES: Object.freeze({
    speed: { min: 0, max: 30, step: 0.1 },        // m/s
    elevation: { min: -30, max: 60, step: 0.5 },  // 발사각(°), 위가 +
    azimuth: { min: -30, max: 30, step: 0.5 },    // 방향각(°), 오른쪽(+x)이 +
    topspin: { min: -150, max: 150, step: 1 },    // rps, + 탑스핀 / − 백스핀
    sidespin: { min: -150, max: 150, step: 1 },   // rps, + 위에서 봐서 반시계(왼쪽으로 휨)
    height: { min: 0.02, max: 1, step: 0.01 },    // 탁구대 윗면 기준 공 중심 높이(m)
    x: { min: -0.7, max: 0.7, step: 0.01 },       // 좌우 위치(m)
  }),
  // 프리셋 버튼: 모두 건너편 코트에 한 번 떨어지도록 맞춘 값 (v6.0: 게임 중력에 맞춰 속도 √0.6배, 탑스핀은 발사각 17 → 25°)
  PRESETS: Object.freeze({
    none: Object.freeze({ speed: 5.4, elevation: 12, azimuth: 0, topspin: 0, sidespin: 0, height: 0.25, x: 0 }),
    topspin: Object.freeze({ speed: 6.5, elevation: 25, azimuth: 0, topspin: 60, sidespin: 0, height: 0.25, x: 0 }),
    backspin: Object.freeze({ speed: 4.3, elevation: 8, azimuth: 0, topspin: -40, sidespin: 0, height: 0.25, x: 0 }),
    sideLeft: Object.freeze({ speed: 5.4, elevation: 12, azimuth: 0, topspin: 0, sidespin: 40, height: 0.25, x: 0.3 }),
    sideRight: Object.freeze({ speed: 5.4, elevation: 12, azimuth: 0, topspin: 0, sidespin: -40, height: 0.25, x: -0.3 }),
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
  CAMERA_NEAR: 0.05,
  CAMERA_FAR: 100,
  // 기존 시점(v5.2까지): Space 키(7단계, 이전 C)로 바꿔 볼 수 있다. 새 시점은 TUNABLE의 CAM_* (카메라 묶음)
  CAMERA_CLASSIC: Object.freeze({ pos: Object.freeze({ x: 0, y: -2.9, z: 0.85 }), target: Object.freeze({ x: 0, y: 0.35, z: -0.1 }), fov: 50 }),
  DRAG_REF_POINT: Object.freeze({ x: 0, y: -1.3, z: 0.5 }), // 시점별 마우스 감도(mm/화면)를 재는 기준 타점
  MAX_PIXEL_RATIO: 2,
  FLOOR_SIZE: 30,
  // 화풍 (v7.7 툰·외곽선, v7.8 메뉴와 같은 탁구장 포스터 색: 종이색 바탕·먹색 선·탁구대 초록·공 주황)
  COLOR_BACKGROUND: 0xefe9dc, // 바탕 아래쪽 = 종이색 (안개 색도 같음)
  COLOR_SKY_TOP: 0xdcd3c0,    // 바탕 위쪽 (세로 그러데이션)
  FOG_NEAR: 5,               // 바닥이 하늘로 녹아드는 거리 (m). 바닥 끝(FLOOR_SIZE/2)보다 가까이서 다 녹아야 경계가 안 보인다
  FOG_FAR: 13,
  COLOR_FLOOR: 0xe6dccb,     // 종이색 바닥
  COLOR_MAT: 0xd2c4a6,       // 탁구대 아래 깔개 (바닥보다 조금 진하게: 깊이 단서)
  MAT_SIZE: Object.freeze({ x: 4.2, y: 7.0 }),
  MAT_RADIUS: 0.6,           // 깔개 모서리 둥글기 (m)
  COLOR_TABLE: 0x1f6f4a,     // 초록 상판 (메뉴 탁구대와 같은 색, 파란 백스핀 꼬리와 구분)
  COLOR_LINE: 0xffffff,
  COLOR_LEG: 0x2a2a2a,
  COLOR_NET: 0x2b2f38,
  COLOR_NET_BAND: 0xffffff,
  COLOR_POST: 0x2a2a2a,
  COLOR_OUTLINE: 0x161616,   // 외곽선 (UI의 --ink와 같은 색)
  OUTLINE_W: 0.012,          // 탁구대·네트 외곽선 두께 (m)
  OUTLINE_BALL: 0.0045,      // 공 외곽선 두께 (m, 공 반지름 0.02)
  OUTLINE_RACKET: 0.006,     // 라켓 외곽선 두께 (m)
  TOON_STEPS: Object.freeze([0.55, 0.8, 1]), // 툰 명암 단계 (어두움 → 밝음)
  AMBIENT_INTENSITY: 1.1,
  KEY_LIGHT_INTENSITY: 2.0,
  KEY_LIGHT_POS: Object.freeze({ x: 1.5, y: -1.0, z: 3.5 }),
  SHADOW_MAP_SIZE: 2048,
  LINE_LIFT: 0.001,          // 흰 선이 상판과 겹쳐 깜빡이지 않도록 띄우는 높이
  NET_OPACITY: 0.85,
  COLOR_BALL: 0xff7a1a,
  COLOR_BALL_MARK: 0xffffff,
  BALL_SEGMENTS: 24,
  BALL_TEXTURE_SIZE: 128,    // 공 무늬 텍스처 가로 픽셀 (세로는 절반)
  COLOR_RACKET_ME: 0xe04a2b, // 내 라켓 고무 (빨강)
  COLOR_RACKET_AI: 0x2d5fa8, // 로봇 라켓 고무 (파랑)
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
  TRAIL_MIX_MIN: 0.35,       // 꼬리 색 최소 진하기 (v7.0: 회전 세기 0 → 이 값, 상한 → 1)
  SPIN_LEVELS: 5,            // 회전 표지 세기 칸 수 (v7.0)
  INTRO_TIME: 8,             // 첫 경기 조작 안내판을 보여 주는 최대 시간 (s, 누르면 바로 닫힘)
  POPUP_RISE: 70,            // 팝업이 떠오르는 거리 (px)
  POPUP_STACK: 34,           // 같은 순간 팝업이 여러 개면 위로 쌓는 간격 (px)
  POPUP_OFFSET_Y: -40,       // 공 화면 위치에서 위로 띄우는 거리 (px)
  POPUPS: Object.freeze({
    perfect: Object.freeze({ text: 'PERFECT', color: '#ffd84d', size: 34 }),
    smash: Object.freeze({ text: 'SMASH!', color: '#ff5a3c', size: 46 }),
    edge: Object.freeze({ text: 'EDGE!', color: '#7fe8ff', size: 40 }),
    spinmax: Object.freeze({ text: 'MAX SPIN', color: '#c48bff', size: 30 }),
    combo: Object.freeze({ text: 'PERFECT ×2', color: '#ffd84d', size: 36 }), // v7.6 퍼펙트 콤보 (글자·색은 effects.js popupText)
  }),
  COMBO_COLOR_LOW: 0xffd84d,  // 퍼펙트 콤보 팝업·표시 색: 1단계 노랑 → 최고 단계 빨강
  COMBO_COLOR_HIGH: 0xff3b30,
  COMBO_SIZE_GAIN: 16,       // 최고 단계 콤보 팝업이 1단계보다 커지는 글자 크기 (px)
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
  // v7.6 퍼펙트 콤보: 최고 단계 스매시 SMASH_V_MAX 15 × 1.3 = 19.5 m/s × 1.2 = 23.4 → 24,
  // 최고 단계 드라이브가 누적 상한 100 × 1.25 + 들어온 회전 효과 ≈ 121 rps (사람 대역 측정) → 121 × 1.2 ≈ 150
  MAX_V: 24,                 // 타구 최대 속도 (m/s). v7.6: 22 → 24
  MAX_SPIN: 150,             // 타구 최대 회전 (rps). v7.6: 120 → 150
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
  // 방 서버(Durable Object) 위치 (v6.1). 힌트가 없으면 방을 처음 연 요청이 들어온 Cloudflare 접속 지점 근처에 생기는데,
  // 한국 통신사 경로가 미국·동남아 접속 지점으로 돌아가면 방 서버도 그쪽에 생겨 핑이 커진다.
  // 동북아(일본·한국) → 아시아·태평양 순으로 시도하고, 런타임이 모르는 힌트면 다음 것을 쓴다. 힌트는 최선 노력(보장 아님).
  LOCATION_HINTS: Object.freeze(['apac-ne', 'apac']),
  WHERE_URL: 'https://www.cloudflare.com/cdn-cgi/trace', // 방 서버가 자기 위치(colo)를 알아내는 주소 (방마다 한 번)
  WHERE_TIMEOUT: 1000,       // 위치 확인 최대 대기 (ms). 실패하면 위치 표시만 빠진다
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
