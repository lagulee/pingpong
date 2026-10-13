# 1vs1 탁구게임 — 프로젝트 사양서

> Claude Code **클라우드 세션**에서 개발한다. 이 파일은 매 세션 시작 시 로드된다.
> 세부 사양은 `.claude/rules/`에 있으며, 해당 파일을 다룰 때 자동 로드된다.
> 사양과 다르게 구현해야 할 이유가 생기면 구현하기 전에 사용자에게 묻는다.

## 1. 개요

- **목적**: 재미. 타격감·소리·연출을 최대한 살린다.
- **방향**: 실제 탁구 물리(회전, 마그누스 효과, 바운드)를 현실적으로 재현한다.
- **형태**: 친구끼리 링크로 접속하는 실시간 1:1 대전. PC 브라우저 + 마우스.
- **비용**: Claude 구독 외 지출 0원. 무료 플랜만 사용하고, 결제 수단 등록·유료 API·유료 서비스는 금지.

## 2. 기술 구성

| 역할 | 기술 |
|---|---|
| 3D 렌더링 | Three.js (브라우저에서 CDN으로 로드) |
| 물리 엔진 | 직접 작성한 JS, 결정론적 고정 스텝, 브라우저·서버 공용 |
| 사운드 | Web Audio API 합성 + CC0 효과음 (저작권 음원 금지) |
| 서버 | Cloudflare Workers + Durable Objects (SQLite 기반, `new_sqlite_classes`) |
| 정적 파일 | 같은 Worker의 정적 자산(assets) 기능으로 `public/` 제공 |
| 테스트 | Node 내장 `node:test` (추가 의존성 없음) |
| 모듈 형식 | ES Modules (`package.json`에 `"type": "module"`) |

범용 물리 라이브러리는 쓰지 않는다. 회전·마그누스 효과를 제대로 다루지 못하고, 멀티플레이에는 같은 입력이면 모든 컴퓨터에서 같은 궤적이 나오는 결정론이 필요하기 때문이다.

## 3. 폴더 구조

```text
pingpong/
├─ CLAUDE.md
├─ .claude/rules/          # 세부 사양 (아래 4장)
├─ package.json
├─ wrangler.jsonc          # Worker, assets, Durable Object 설정
├─ public/                 # 브라우저에 그대로 제공되는 파일
│  ├─ index.html
│  ├─ shared/              # 브라우저·서버 공용 (단일 원본)
│  │  ├─ constants.js      # 규격·물리 상수·판정 임계값
│  │  ├─ physics.js
│  │  └─ rules.js
│  └─ js/
│     ├─ main.js  render.js  input.js  ai.js
│     ├─ audio.js effects.js net.js    debug.js
├─ server/
│  ├─ worker.js            # 진입점, WebSocket 업그레이드, 방 라우팅
│  └─ room.js              # Durable Object: 방 관리, 검증, 득점 판정
└─ tests/
```

서버 코드는 `public/shared/`를 상대 경로로 import한다. 공용 코드를 복사해 두 벌 만들지 않는다.

## 4. 세부 사양 위치

| 파일 | 내용 | 적용 경로 |
|---|---|---|
| `.claude/rules/physics.md` | 규격, 운동 방정식, 바운드, 충돌, 물리 검증 | `public/shared/physics.js`, `constants.js`, `tests/physics*` |
| `.claude/rules/input.md` | 드래그 타격, 구질 판정, AI 로봇 | `public/js/input.js`, `ai.js`, `tests/input*`, `tests/rally*` |
| `.claude/rules/game-rules.md` | 탁구 규칙, 점수, 서브 | `public/shared/rules.js`, `tests/rules*` |
| `.claude/rules/network.md` | 동기화, 시계 맞추기, 방, 서버 판정 | `public/js/net.js`, `server/**`, `wrangler.jsonc`, `tests/net*` |
| `.claude/rules/feel.md` | 렌더링, 사운드, 이펙트, 디버그 패널 | `public/index.html`, `public/js/main.js`, `render.js`, `audio.js`, `effects.js`, `debug.js` |

## 5. 좌표계와 기본 규격

- x = 탁구대 너비, y = 길이(네트 기준 양쪽), z = 높이(위가 +), 단위는 m·s·kg
- 원점: 탁구대 윗면 중앙(네트 바로 아래)
- 탁구대 2.74 × 1.525 m, 높이 0.76 m, 네트 0.1525 m / 공 2.7 g, 지름 40 mm
- 모든 수치는 `public/shared/constants.js`에서만 정의한다.

## 6. 클라우드 세션 작업 환경

- **세션은 화면과 소리를 확인할 수 없다.** 그래서 모든 단계는 `npm test`로 자동 검증할 수 있게 설계한다. 눈과 귀로 판단할 부분은 사용자가 배포 주소에서 플레이하고 피드백한다.
- **배포**: 사용자가 Cloudflare 대시보드에서 이 GitHub 저장소를 Worker에 연결해 두었다. 푸시하면 자동으로 빌드·배포된다. 세션에서 `wrangler deploy` 실행, API 토큰 요구, Cloudflare 계정 접근은 하지 않는다.
- **네트워크 제한**: npm 레지스트리 외 외부 접근이 막힐 수 있다. 다운로드가 실패하면 다른 경로로 우회하지 말고 무엇이 막혔는지 보고한다.
- **로컬 실행 검증**: 가능하면 세션 VM 안에서 `npx wrangler dev`를 띄워 localhost로 테스트한다. 실행이 안 되면 Durable Object 클래스를 직접 생성하는 단위 테스트로 대체한다.
- **원격 튜닝**: 물리 상수와 판정 임계값은 디버그 패널(`?debug=1`)에서 바꿀 수 있게 한다. 사용자가 세션 없이도 직접 맞춰 보고 좋은 값을 알려줄 수 있어야 한다.
- `/clear`는 클라우드 세션에서 지원되지 않는다. 새 단계는 새 세션으로 시작해도 이 파일 덕분에 맥락이 유지된다.

## 7. 단계별 개발 계획

| 단계 | 목표 | 완료 기준 (세션) | 사용자 확인 |
|---|---|---|---|
| 0. 준비 | `package.json`, `wrangler.jsonc`, 폴더 구조, 탁구대가 보이는 빈 장면 | `npm test` 실행됨 | 배포 주소에서 탁구대가 보임 |
| 1. 물리 | 공 운동, 바운드, 회전, 디버그 화살표 | physics.md 검증 테스트 전부 통과 | 공 낙하·휘어짐이 자연스러운지 |
| 2. 타격 | 드래그 판정, 5가지 구질, AI 로봇 | 구질 판정 테스트 + AI끼리 자동 랠리 10회 이상 | 로봇과 랠리 10회 성공 |
| 3. 규칙 | 서브, 점수, 듀스, 서브 교대 | game-rules.md 테스트 통과 | 한 게임 끝까지 진행 |
| 4. 타격감 | 사운드, 이펙트, 연출, 디버그 패널 | 오류 없이 로드, 이펙트 함수 단위 테스트 | "손맛 있다" 평가 |
| 5. 멀티 | 방, 이벤트 동기화, 시계 맞추기, 서버 판정 | 가상 클라이언트 2개로 한 랠리·득점 일치 테스트 | 친구와 원격 1게임 완료 |
| 6. 튜닝 | 사용자 피드백으로 상수·연출 조정 | 기존 테스트 전부 유지 | 친구들 실전 테스트 |

## 8. 작업 방식

- **한 번에 한 단계만** 진행한다. 사용자가 다음 단계를 지시하기 전에 넘어가지 않는다.
- 2단계와 5단계는 **계획을 먼저 제시**하고, 승인받은 뒤 구현한다.
- 단계를 마치면 다음 순서로 진행한다.
  1. `npm test` 전부 통과를 확인한다.
  2. 커밋하고 푸시한다. 커밋 메시지는 한국어로, `[단계 N] 요약` 형식을 쓴다.
  3. 사용자에게 보고한다.
     - 바뀐 내용 3줄 요약
     - 배포 주소에서 확인할 체크리스트
     - 알려진 문제
- 사용자 피드백("공이 너무 뜬다" 등)은 어떤 상수를 얼마나 바꿨는지 숫자로 보고한다.
- 중요한 설계 결정은 아래 10장 "결정 기록"에 한 줄씩 추가한다.

## 9. 코딩 규칙

- 수치는 `constants.js`에만 둔다. 다른 파일에 하드코딩하지 않는다.
- `public/shared/`에서는 DOM, Node 전용 API, `Math.random()`, `Date.now()`를 쓰지 않는다. 시간과 난수는 인자로 받는다.
- 새 기능에는 테스트를 함께 작성한다. 기존 테스트를 지우거나 약하게 바꿔서 통과시키지 않는다.
- 주석과 사용자 대상 문구는 한국어로 작성한다.
- 외부 라이브러리를 추가하기 전에 사용자에게 묻는다. Three.js만 기본 허용한다.

## 10. 결정 기록

- [0단계] `npm test`는 `node --test "tests/**/*.test.js"`로 한다. Node 22에서 `node --test tests/`는 폴더를 파일로 취급해 실패하기 때문.
- [0단계] Three.js는 jsdelivr `three@0.170.0`을 import map으로 고정해 불러온다.
- [0단계] 브라우저 코드(`public/js`)는 Node에서 `three`·DOM을 해석할 수 없으므로 `node --check`로 문법만 검사하고, `public/shared`는 실제 import로 검사한다.
- [0단계] `Room`은 `cloudflare:workers`를 import하지 않는 일반 클래스로 둔다. Node 테스트에서 직접 생성할 수 있게 하기 위함.
- [0단계] 렌더링용 치수·색상·카메라 위치도 `constants.js`의 `RENDER`에 둔다(수치 단일 원본 규칙).
