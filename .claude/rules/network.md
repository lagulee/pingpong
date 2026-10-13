---
paths:
  - "public/js/net.js"
  - "server/**"
  - "wrangler.jsonc"
  - "tests/net*"
---

# 멀티플레이 사양

## 서버 구성

- `server/worker.js`: `/ws/:roomCode`로 들어온 WebSocket 업그레이드를 해당 방의 Durable Object로 넘긴다. 그 외 요청은 정적 자산(`public/`)으로 처리한다.
- `server/room.js`: 방 하나 = Durable Object 하나. **WebSocket Hibernation API**(`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`)를 사용해 대기 중 자원 소모를 줄인다.
- Durable Object는 SQLite 기반으로만 만든다 (`wrangler.jsonc`의 migrations에 `new_sqlite_classes`). 무료 플랜 조건이다.
- 무료 한도를 넘으면 과금 없이 오류가 나므로, 오류 시 사용자에게 "잠시 후 다시 시도" 안내를 보여 준다.

## 방 시스템

- 방 코드는 4자리. 혼동되는 문자(0/O, 1/I)는 제외한다.
- 로그인 없음, 닉네임만 입력
- 한 방에 플레이어 2명까지. 3번째 접속은 거절한다.
- 상대가 끊기면 10초 재접속 대기 → 넘으면 상대 승리 처리

## 메시지 형식 (JSON)

| 종류 | 방향 | 내용 |
|---|---|---|
| `join` | C→S | `{ nickname }` |
| `ready` | C→S | 준비 완료 |
| `start` | S→C | 시작, 서브권, 시작 시각 |
| `serve` / `hit` | C→S, S→C | `{ t, pos, vel, spin, shotType, seq }` |
| `point` | S→C | 득점자, 점수, 사유 |
| `correct` | S→C | 바운드 시점의 서버 기준 공 상태 |
| `ping` / `pong` | 양방향 | 시계 동기화 |
| `leave` | 양방향 | 퇴장 |

## 타격 이벤트 동기화

물리가 결정론적이므로 **공 위치를 매 프레임 보내지 않는다.** 타격 순간 정보만 보낸다.

```text
A 타격 → hit 전송 → 서버 검증 → B에게 전달
B는 지연된 시간만큼 공을 "빨리 감기"해서 따라잡음
```

- 빨리 감기는 한 번에 하지 않고 **0.1 s에 걸쳐 부드럽게 합류**시킨다.
- 바운드 순간마다 서버가 `correct`를 보내 부동소수점 오차 누적을 막는다.

## 시계 동기화 (NTP 방식)

$$\text{offset} = \frac{(t_1 - t_0) + (t_2 - t_3)}{2}$$

- `t0`: 클라이언트 송신, `t1`: 서버 수신, `t2`: 서버 송신, `t3`: 클라이언트 수신
- 시작 전 8회 측정해 왕복 시간이 가장 짧은 표본을 쓰고, 게임 중에도 5초마다 갱신한다.

## 서버 권위 판정

- 서버도 `public/shared/physics.js`와 `rules.js`를 그대로 실행해 궤적을 재계산하고 **득점을 서버가 판정**한다.
- 비정상 `hit`은 거부한다.
  - 속도·회전이 `constants.js`의 최댓값을 넘음
  - 라켓 위치에서 공까지 거리가 너무 멂
  - 자기 차례가 아님
  - 시각이 너무 과거이거나 미래임
- 클라이언트가 보낸 점수는 믿지 않는다.

## 검증 테스트

- [ ] (`tests/net.test.js`) 시계 동기화 공식이 인위적 지연(편도 30/50 ms) 조건에서 오차 5 ms 이내로 offset을 구한다.
- [ ] Room 클래스를 가짜 WebSocket 2개로 직접 생성해, 한 랠리 후 두 클라이언트와 서버의 득점 판정이 일치한다.
- [ ] 비정상 `hit`(과속, 차례 아님)이 거부된다.
- [ ] 3번째 접속이 거절된다.
- [ ] 가능하면 `npx wrangler dev`로 실제 WebSocket 연결 테스트도 수행한다. 안 되면 그 사실을 보고한다.
