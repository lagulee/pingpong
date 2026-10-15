---
paths:
  - "public/js/net.js"
  - "public/shared/host.js"
  - "public/shared/match.js"
  - "server/**"
  - "wrangler.jsonc"
  - "tests/net*"
---

# 멀티플레이 사양

## 서버 구성

- `server/worker.js`: `/api/new`는 방 코드를 발급하고, `/ws/:roomCode`로 들어온 WebSocket 업그레이드를 해당 방의 Durable Object로 넘긴다. 그 외 요청은 정적 자산(`public/`)으로 처리한다. Durable Object 호출이 실패하면(무료 한도 초과 등) `503 { error: 'limit' }`.
- `server/room.js`: 방 하나 = Durable Object 하나. **WebSocket Hibernation API**(`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`)를 사용해 대기 중 자원 소모를 줄인다. 방 관리·검증·판정은 하지 않고, `public/shared/host.js`의 `Host`(순수 클래스)에 입출력(io)만 연결하는 얇은 껍데기다.
- `public/shared/host.js`: 방·입장·검증·득점 판정. io(`now`, `rng`, `send`, `close`, `setTimer`, `save`, `clear`)만 주입받으므로 Node 서버나 P2P 호스트 브라우저에서도 그대로 돌릴 수 있다.
- `public/shared/match.js`: 경기 흐름(서브 대기·토스·타격 적용·물리·규칙·다음 서브). 연습 모드(`ai.js`), 대전 클라이언트(`net.js`), 서버(`host.js`)가 같은 코드를 쓴다.
- Durable Object는 SQLite 기반으로만 만든다 (`wrangler.jsonc`의 migrations에 `new_sqlite_classes`). 무료 플랜 조건이다.
- 무료 한도를 넘으면 과금 없이 오류가 나므로, 오류 시 사용자에게 "잠시 후 다시 시도" 안내를 보여 준다.
- 무료 한도: 요청 하루 100,000건. 들어오는 WebSocket 메시지는 20:1로 요청 수에 세고, 나가는 메시지는 과금하지 않는다(공식 가격 문서). 잠들 수 있는 유휴 객체는 실행 시간을 과금하지 않는다.

## 방 시스템

- 방 코드는 4자리. 혼동되는 문자(0/O, 1/I)는 제외한다 (`ONLINE.CODE_CHARS`).
- 로그인 없음, 닉네임만 입력 (최대 `ONLINE.NICK_MAX` 12자)
- 한 방에 플레이어 2명까지. 3번째 접속은 `full`로 거절한다. 방을 만든 사람이 −1 쪽, 들어온 사람이 +1 쪽(카메라 180° 회전).
- 클라이언트 `VERSION`이 서버와 다르면 `version`으로 거절한다(새로고침 안내).
- 둘 다 시계를 맞추고 `ready`를 보내면 `START_DELAY`(3 s) 뒤 시작. 첫 서브권은 서버가 무작위로 정한다.
- 상대가 끊기면 10초(`RECONNECT_WAIT`) 재접속 대기 → 넘으면 상대 승리(기권) 처리. 대기 중에는 토스를 받지 않는다(`reject: away`).
- 끊긴 쪽은 `RECONNECT_RETRY`(1 s)마다 `token`으로 다시 `join`한다. 다시 들어오면 시계를 다시 맞추고 `ready` → `resume`(현재 경기 상태)을 받아 이어서 진행한다.
- 경기 중 `leave` = 기권.

## 방 정리 (무료 한도)

- 상태 저장(`ctx.storage.put`)은 입장·준비·시작·득점·끊김·경기 끝에만 한다 (한 경기 약 20~35회). 잠들었다 깨어나면 생성자에서 저장된 상태로 `Host.restore`.
- 플레이어 정보는 소켓 첨부(`serializeAttachment({ id })`)와 저장된 자리 정보(`slots[].conn`)로 연결한다.
- 타이머는 `setTimeout` 대신 `ctx.storage.setAlarm` 하나만 쓴다: 예정 결말 + `GRACE`, 재접속 마감, 대기실 시간 초과(`LOBBY_IDLE` 600 s) 중 가장 이른 것.
- 대기실에서 나가면 자리를 비우고, 아무도 연결되어 있지 않은 대기실·끝난 경기는 `deleteAlarm()` + `storage.deleteAll()`로 지운다. 경기 중 둘 다 끊기면 재접속 마감에 지운다.

## 메시지 형식 (JSON)

모든 메시지에 `type`이 있다. 시각 `t`는 경기 시각(s, 서버 시각 `startAt`이 0), `startAt`·`until`은 서버 시각(ms).

| 종류 | 방향 | 내용 |
|---|---|---|
| `join` | C→S | `{ nickname, version, create, token? }` (`create`: 방 만들기, `token`: 재접속) |
| `joined` | S→C | `{ you(−1/+1), token, code, players, resume }` |
| `lobby` | S→C | `{ players: [{ side, nick, ready, online }] }` |
| `error` | S→C | `{ code }`: `full` · `noRoom` · `inUse` · `version` (보낸 뒤 연결을 닫는다) |
| `ready` | C→S | `{ rtt }` 시계를 맞춘 뒤 준비 완료 |
| `start` | S→C | `{ startAt, firstServer, bestOf, players }` |
| `resume` | S→C | `{ startAt, firstServer, players, game(경기 상태), opp? }` 재접속한 사람에게 |
| `ping` / `pong` | C→S / S→C | `{ t0 }` / `{ t0, t1, t2 }` 시계 동기화 |
| `toss` | C→S, S→C | `{ seq, t, x }` (+ 서버가 붙이는 `side`). `makeToss(x, t)`가 결정론적이라 이것으로 충분 |
| `serve` / `hit` | C→S, S→C | `{ seq, t, pos, vel, spin, shotType, racket: { x, z } }` (+ `side`). `racket`은 타격 순간 라켓 위치(친 사람 기준 좌표) |
| `reject` | S→C | `{ seq, t, reason }` 보낸 사람에게만. 사유: `time` `turn` `speed` `spin` `far` `pos` `away` `bad` |
| `correct` | S→C | `{ side, seq, t, pos, vel, spin }` 바운드 직후 서버 기준 공 상태 (`side`·`seq` = 그 공을 친 타격) |
| `point` | S→C | `{ kind, winner, loser, reason, score, games, rally, t, gameOver, matchOver, nextAt, rules }` (`rules` = 득점 직후 규칙 상태) |
| `racket` | C→S, S→C | `{ t, x, z }` 상대 화면에 내 라켓을 보여 주기 위한 위치 (15 Hz) |
| `opp` | S→C | `{ state: 'away', until }` / `{ state: 'back' }` 상대 끊김·복귀 |
| `end` | S→C | `{ winner, score, games, by: 'normal' \| 'forfeit' }` |
| `leave` | C→S | 퇴장 (경기 중이면 기권) |

## 타격 이벤트 동기화

물리가 결정론적이므로 **공 위치를 매 프레임 보내지 않는다.** 타격 순간 정보만 보낸다.

```text
A 타격 → (A 화면에 바로 적용) → hit 전송 → 서버 검증 → B에게 전달 + 양쪽에 correct
B는 받은 타격 시각의 상태로 되감아 타격을 적용하고 지금까지 다시 계산 → 화면은 빨리 감아 합류
```

- 클라이언트는 최근 `SNAP_TIME`(1.2 s) 동안의 경기 상태를 물리 스텝마다 기억해 두고 되감는다.
- **화면 지연(v5.1)**: 상대 타격은 (상대 → 서버 → 나) 지연 $L$만큼 늦게 알게 된다. 그래서 공을 **상대 쪽에서는 예상 지연 $\hat L$만큼 늦게** 보여 주고, 공이 내 쪽으로 오는 동안 지연을 0으로 줄인다. 내 코트(기준 y < `LAG_NEAR` −0.4 m)에서는 화면 = 실제 물리라 타격 판정과 보이는 공이 일치한다.
  - 지연 목표 = $\hat L \cdot s(y)$, $s$는 보이는 공의 기준 y가 `LAG_NEAR`(−0.4)에서 0 → `LAG_FAR`(1.2)에서 1. 지연은 초당 `LAG_RATE_UP` 0.5 이하로 늘고 `LAG_RATE_DOWN` 3 이하로 준다(화면 공 0.5~4배속).
  - $\hat L$ = 실제로 늦게 도착한 상대 타격 시간의 지수 평균(`LAG_EMA` 0.2) + 2 × 평균 편차, 첫 추정은 핑, 상한 `LAG_MAX` 0.35 s.
  - 상대 라켓도 같은 지연($\hat L$)으로 그려 상대 쪽 공과 맞춘다. 소리·판정 글자도 보이는 공의 시각에 낸다.
  - (v5.0의 "기다릴 때 0.5배속 최대 0.15 s + 받은 뒤 0.1 s에 빨리 감기"는 지연이 크면 공이 멈칫했다가 2~3배속으로 튀어 v5.1에서 바꿨다.)
- 화면 오른쪽 위에 핑과 "상대 공 지연"($\hat L$)을 함께 표시한다.
- **`correct` 시점**: 바운드 순간이 아니라, 서버가 타격을 검증한 직후 다음 바운드 `CORRECT_MAX`(2)개를 미리 계산해 한 번에 보낸다 (실제 바운드보다 먼저 도착하고, 바운드마다 서버를 깨우지 않는다). 클라이언트는 그 시각에 내 공과 1 mm(`CORRECT_EPS`) 넘게 다를 때만 바꾸고, 이미 지난 시각이면 되감아 다시 계산한다.

## 시계 동기화 (NTP 방식)

$$\text{offset} = \frac{(t_1 - t_0) + (t_2 - t_3)}{2}$$

- `t0`: 클라이언트 송신, `t1`: 서버 수신, `t2`: 서버 송신, `t3`: 클라이언트 수신
- 시작 전 8회 측정해 왕복 시간이 가장 짧은 표본을 쓰고, 게임 중에도 5초마다 갱신한다(최근 8개 중 최단).
- Workers의 시각은 한 요청을 처리하는 동안 멈춰 있어 $t_1 = t_2$가 될 수 있다. 공식에는 문제없다.

## 서버 권위 판정

- 서버도 `public/shared/physics.js`, `rules.js`, `match.js`를 그대로 실행해 궤적을 재계산하고 **득점을 서버가 판정**한다. 서버는 `TUNABLE` 기본값(게임용 중력 `G_GAME` 포함)을 쓰므로, 대전 중 클라이언트는 물리·판정 값을 기본값으로 고정한다(연출 켜기/끄기·카메라만 허용, `TUNABLE_ONLINE_FREE`).
- 서버는 실시간 루프 없이 이벤트로 움직인다: 타격이 오면 확정 상태를 복사해 그 시각까지 진행한 뒤 검증하고, 통과하면 확정한다.
- 아무도 치지 않으면 어떻게 끝나는지(예정 결말 시각)를 미리 계산해 그 시각 + `GRACE`(0.6 s, v5.0의 0.3에서 늘림)에 알람을 걸고, 그때까지 유효한 타격이 없으면 `point`를 보낸다.
- 클라이언트 화면의 판정은 잠정(회색 "?")이다. 서버 `point`가 같으면 확정, 다르면 "판정 정정"으로 서버 판정을 보여 준다. 점수판·득점 소리·다음 서브는 서버 `point` 기준.
- 비정상 `hit`·`serve`는 거부한다 (`reject`). 수치는 `constants.js`의 `ONLINE`.

| 검사 | 기준 | 사유 |
|---|---|---|
| 형식 | `pos`·`vel`·`spin`·`racket`이 유한한 수 | `bad` |
| 차례 | 보낸 사람이 `canHit`이고, 서브 순간이면 `serve`·아니면 `hit` | `turn` |
| 시각 | 서버 경기 시각 기준 $-0.6 \le t - t_{now} \le +0.05$ s (`T_PAST`, `T_FUTURE`; v5.0의 0.3에서 늘림), 확정 시각 이후, 그 전에 득점이 나지 않음 | `time` / `turn` |
| 최대 속도 | $\lvert v \rvert \le 22$ m/s (`MAX_V`) | `speed` |
| 최대 회전 | $\lvert \omega \rvert \le 120$ rps (`MAX_SPIN`) | `spin` |
| 라켓-공 거리 | 친 사람 기준 x·z 각각 `HIT_RADIUS`(서브 `SERVE_HIT_RADIUS`) + 0.04 m (`RACKET_TOL`) | `far` |
| 공 위치 | `pos`와 서버가 계산한 공의 거리 $\le 0.05$ m (`BALL_TOL`) | `pos` |

- 한도 실측(5단계): AI 경기 60판 87,590타 최대 15.15 m/s(스매시)·79.2 rps(드라이브). 사람만 낼 수 있는 실타 `MISHIT_SPEED` 18 m/s × 1.2 → 22 m/s, 회전 79.2 × 1.5 ≈ 120 rps. 테스트가 "한도 ≥ 실측 최댓값 × 1.2"를 확인한다.
- 토스: 서브 대기 중 서브권자만, 상대가 끊겨 있으면 `away`. 클라이언트가 보낸 점수는 믿지 않는다.

## 검증 테스트

- [x] (`tests/net.test.js`) 시계 동기화 공식이 인위적 지연(편도 30/50 ms + 지터 0~10 ms) 조건에서 오차 5 ms 이내로 offset을 구한다.
- [x] (`tests/net-room.test.js`) Room 클래스를 가짜 WebSocket 2개로 직접 생성해, 한 랠리 후 두 클라이언트와 서버의 득점 판정이 일치한다.
- [x] 비정상 `hit`(차례 아님, 과속, 과회전, 라켓이 멂, 시각 과거·미래, 위치 불일치)이 거부된다.
- [x] 3번째 접속이 거절된다 (없는 방·쓰는 중인 방·버전 불일치 포함).
- [x] (`tests/net-wrangler.test.js`) `npx wrangler@4.139.0 dev`로 실제 WebSocket 연결 테스트(입장·핑·3번째 거절·AI 둘이 첫 득점까지). 실행할 수 없는 환경이면 이유를 남기고 건너뛴다.
- [x] (`tests/net-match.test.js`) 인위적 지연(편도 30·80 ms, 비대칭 30/80 ms)에서 AI 대 AI 원격 경기 한 판의 점수·득점 순서가 서버·두 클라이언트에서 일치한다.
- [x] 재접속(10초 안: 이어서 진행 / 넘으면 기권승·방 정리), 잠들었다 깨어남(저장 상태 복원), 화면 지연 함수, 대전 토스 실패 규칙.
- [x] (v5.1) 흔들리는 네트워크(편도 100 ms + 지터 30 ms + 3% 확률 최대 300 ms 튐)에서 원격 AI 경기: 거부 0, 점수 일치.
- [x] (v5.1) 편도 80 ms 원격 경기에서 화면을 흉내 내: 보이는 공의 시간이 거꾸로 가지 않고, 내가 칠 때 화면 지연 ≤ 20 ms.
