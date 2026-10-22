---
paths:
  - "public/js/net.js"
  - "public/shared/host.js"
  - "public/shared/match.js"
  - "server/**"
  - "wrangler.jsonc"
  - "tests/net*"
  - "tests/pause*"
  - "tests/emote*"
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
- 한 방에 플레이어 2명까지(관전자는 따로, 아래 "관전"). 3번째 접속은 `full`로 거절한다. 방을 만든 사람이 −1 쪽, 들어온 사람이 +1 쪽(카메라 180° 회전).
- 클라이언트 `VERSION`이 서버와 다르면 `version`으로 거절한다(새로고침 안내).
- 둘 다 시계를 맞추고 `ready`를 보내면 `START_DELAY`(3 s) 뒤 시작. 첫 서브권은 서버가 무작위로 정한다.
- (10단계에서 아래 "끊김 일시정지"로 바뀐다. 지금 동작:) 상대가 끊기면 10초(`RECONNECT_WAIT`) 재접속 대기 → 넘으면 상대 승리(기권) 처리. 대기 중에는 토스를 받지 않는다(`reject: away`).
- 끊긴 쪽은 `RECONNECT_RETRY`(1 s)마다 `token`으로 다시 `join`한다. 다시 들어오면 시계를 다시 맞추고 `ready` → `resume`(현재 경기 상태)을 받아 이어서 진행한다.
- 경기 중 `leave` = 기권.
- **모바일 백그라운드 복귀(v6.2)**: 다른 앱으로 가거나 화면이 꺼지면 JS가 멈추고 연결이 끊긴다. 화면으로 돌아오면(`visibilitychange`) 클라이언트가 `wake()`를 불러, 끊겼으면 재시도 간격(1 s)을 기다리지 않고 바로 다시 접속하고, 연결돼 있으면 시계를 바로 다시 잰다. 10초 기권 규칙(`RECONNECT_WAIT`)은 그대로 두고, 대기실에 "다른 앱으로 가면 10초 뒤 기권" 안내를 보여 준다. 휴대폰은 대전 중 화면 꺼짐 방지(Wake Lock)를 건다.

## 복식 (9단계)

- 방을 만들 때 `join { create: true, mode: 'doubles' }`로 정한다(없으면 단식). 정원은 4명(2:2), 5번째는 `full`. 단식 방은 그대로 2명.
- **자리**: 팀(side)마다 두 좌석(seat 0, 1). 서버 자료는 `slots[side]` = seat 0, `mates[side]` = seat 1(단식은 seat 0뿐이라 기존 테스트·저장과 호환). 입장 순서대로 사람이 적은 쪽(같으면 왼쪽 −1)에 앉는다 → 왼쪽·오른쪽·왼쪽·오른쪽. `joined`에 `seat`·`mode`.
- **팀 옮기기**(대기실만): `team { side }` → 반대 쪽에 빈 자리가 있으면 옮기고 준비가 풀린다. 서버는 자리가 바뀐 사람(옮긴 사람, 앞 좌석으로 당겨진 동료)에게 `seat { you, seat, reready }`를 보내고, `reready`면 클라이언트가 `ready`를 다시 보낸다. 앞 좌석 사람이 나가면 동료가 seat 0으로 당겨진다(`compact`, 첫 서버가 seat 기준이므로 대기실에서만). `lobby`에 `mode`, 모든 `players` 항목에 `seat`.
- **시작**: 4명이 모두 연결·준비해야 `start`(`mode` 포함). 첫 서브권은 무작위, 첫 서버·첫 리시버는 각 팀의 seat 0. 시계 맞추기·`ready`는 단식과 같다.
- **방송**: `toss`·`serve`·`hit`·`racket`·`opp`는 보낸 사람을 뺀 모든 선수와 관전자에게 가고(단식: 상대 + 관전자), 모두 `side`·`seat`(보낸 사람)을 붙인다. 클라이언트는 `racket`을 roster(`'side:seat'` → 선수)로 쌓고, 상대 타격은 `msg.side`로 친 쪽을 알아 `applyHit(..., { seat })`로 적용한다.
- **검증**: 서버는 좌석을 메시지가 아니라 보낸 **연결**의 것으로 쓴다. `hit`·`serve`는 `rules.hits` 순서의 차례인 좌석만(`canHitSeat`) 통과하고 아니면 `reject: turn`. `toss`는 지금 서브 차례의 서버 좌석만, 그리고 다른 선수가 끊겨 있으면 `away`. 나머지 검사(시각·속도·회전·라켓 거리·공 위치)는 단식과 같다.
- **끊김·기권**: 선수마다 `away`·재접속 대기(`RECONNECT_WAIT`)를 따로 센다. 한 명이 마감 안에 못 돌아오거나 `leave`하면 **그 팀이 기권**(상대 팀 승, `end.by = 'forfeit'`), 상대 팀이 모두 끊겨 있으면 방을 닫는다. 재접속은 `token`으로 같은 좌석에 돌아와 `resume`을 받는다(`resume.opp`는 아직 끊긴 사람 한 명).
- 관전: 복식 방도 같다(`mode`가 `joined`·`resume`에 들어가고 roster 네 칸을 받는다).
- 화면 지연·되감기·`correct`는 단식과 같다. 클라이언트의 내 선수는 `players[me]`(= roster의 내 좌석)이고 동료는 roster의 다른 좌석이다. 내 차례일 때만 타격을 판정한다(`hitPhase`가 `canHitSeat`).

## 관전 (8단계)

- 입장: `join { spectate: true }`. 선수가 한 명이라도 있는 방(대기실 또는 경기 중)에만 들어갈 수 있다(없는 방·끝난 방 `noRoom`). 관전자는 최대 `ONLINE.SPECTATOR_MAX`(8)명, 넘으면 `specFull`. 선수 자리(2명)와 따로 센다(선수 3번째는 그대로 `full`). `VERSION`이 다르면 `version`. 첫 화면의 **관전** 버튼으로 사용자가 직접 고른다(방이 가득 찼다고 자동으로 관전자가 되지 않는다).
- 응답 `joined { you: 0, spectator: true, token: null, resume, spectators }`. 시계 맞추기(ping/pong 8회)와 `ready`는 선수와 같다. 경기 중이면 `ready` 뒤에 `resume`(현재 경기 상태)을 받고, 대기실이면 `start`를 방송으로 받는다. 시계를 다 맞추기 전에 온 `start`는 무시하고 `resume`을 기다린다.
- 서버는 선수가 받는 방송을 관전자에게도 보낸다: `lobby`(+ `spectators` 수), `start`, `toss`·`serve`·`hit`(친 쪽 `side` 포함. 선수에게는 상대 것만 가지만 관전자는 둘 다), `correct`, `point`, `end`, `opp`(+ `side`), `racket`(+ `side`, 두 선수 모두). 관전자가 보내는 `toss`·`serve`·`hit`은 `reject { reason: 'spectator' }`이고 `racket` 등은 무시한다. 관전자는 경기 상태에 아무 영향을 주지 못한다.
- 관전자 목록(연결 id → 닉네임)은 `snapshot`/`restore`에 들어가 잠들었다 깨어나도 방송을 받는다. 입장·퇴장은 저장 1회. 선수가 모두 떠나 방이 정리되면(`cleanupIfEmpty`) 관전 연결도 닫는다(코드 4003), 대기실 시간 초과(`LOBBY_IDLE`)도 같다. 끊긴 관전자는 선수와 달리 자리가 유지되지 않고, 클라이언트가 `RECONNECT_RETRY`마다 새 관전자로 다시 접속한다(`RECONNECT_WAIT` 안에서).
- 클라이언트(`net.js` `spectate: true`): 두 선수 모두 원격이라 타격을 판정하지 않는다(`local: []`, 로봇 없음). 받은 `toss`·`hit`의 `side`로 친 사람을 알고, `racket`은 `side`별로 쌓는다. 경기 진행 목표 시각을 `ONLINE.SPECTATOR_DELAY`(0.5 s) 늦춰 선수 → 서버 → 관전자 지연보다 길게 두므로 상대 타격이 제때 도착해 되감기·보정이 필요 없다(측정: 선수 편도 80 ms + 관전자 60 ms에서 되감기 0). 화면 지연(`createBallLag`)은 쓰지 않는다. 득점은 선수와 같이 내 화면의 잠정 판정 → 서버 `point`로 확정한다(관전자 잠정 판정 불일치 0).
- 무료 한도: 관전자가 서버로 보내는 메시지는 시계 맞추기(5 s마다 ping)뿐이고 방송은 나가는 메시지라 과금되지 않는다. 선수 한 명의 `racket` 15 Hz는 상대와 관전자 모두에게 나간다.
- 화면: 선수 화면 상태 칩과 대기실에 "관전 N명"이 보인다. 관전 화면은 자유 시점(feel.md).

## 방 서버 위치 (v6.1)

- Durable Object는 힌트가 없으면 방을 처음 연 요청이 들어온 Cloudflare 접속 지점 근처에 생기고, 한 번 생기면 옮겨지지 않는다. 한국 통신사 경로가 미국·동남아 접속 지점으로 돌아가면 방 서버도 그쪽에 생겨 핑이 커진다.
- v7.14부터 `ONLINE.LOCATION_HINTS`는 비어 있다(힌트 없음 = 방장의 접속 지점 근처). v6.1의 동북아 고정(`apac-ne` → `apac`)은 한국 두 사람이 모두 미국 접속 지점(SEA·LAX)으로 붙을 때 미국 → 서울 → 미국으로 태평양을 4번 건너게 했다(실측 핑 270 ms). 값을 넣으면 `worker.js`의 `roomStub`이 `get(id, { locationHint })`로 차례로 시도한다. 런타임이 모르는 힌트로 오류가 나면 다음 힌트, 마지막엔 힌트 없이 만든다(입장이 막히지 않음). 힌트는 최선 노력이며 처음 만들 때만 적용된다.
- 진단 표시: 방 서버는 처음 연결 때 `ONLINE.WHERE_URL`(cdn-cgi/trace)로 자기 데이터센터 코드를 알아내 `joined.server`로 보내고, 클라이언트는 `/api/where`(내 요청의 `cf.colo`)로 내 접속 지점을 알아낸다. 화면 오른쪽 위에 `경로 접속지점 → 서버 위치`(예: `ICN → NRT`)를 핑과 함께 보여 준다. 위치 확인이 실패하면 `?`.
- 사용자 → 접속 지점 구간(통신사 라우팅)은 코드로 바꿀 수 없다. 그 구간이 멀면(예: 접속 지점 LAX) 화면 표시로 확인할 수 있다.

## 방 정리 (무료 한도)

- 상태 저장(`ctx.storage.put`)은 입장·준비·시작·득점·끊김·경기 끝에만 한다 (한 경기 약 20~35회). 잠들었다 깨어나면 생성자에서 저장된 상태로 `Host.restore`.
- 플레이어 정보는 소켓 첨부(`serializeAttachment({ id })`)와 저장된 자리 정보(`slots[].conn`)로 연결한다.
- 타이머는 `setTimeout` 대신 `ctx.storage.setAlarm` 하나만 쓴다: 예정 결말 + `GRACE`, 재접속 마감, 대기실 시간 초과(`LOBBY_IDLE` 600 s) 중 가장 이른 것.
- 대기실에서 나가면 자리를 비우고, 아무도 연결되어 있지 않은 대기실·끝난 경기는 `deleteAlarm()` + `storage.deleteAll()`로 지운다. 경기 중 둘 다 끊기면 재접속 마감에 지운다.

## 메시지 형식 (JSON)

모든 메시지에 `type`이 있다. 시각 `t`는 경기 시각(s, 서버 시각 `startAt`이 0), `startAt`·`until`은 서버 시각(ms).

| 종류 | 방향 | 내용 |
|---|---|---|
| `join` | C→S | `{ nickname, version, create, token?, spectate? }` (`create`: 방 만들기, `token`: 재접속, `spectate`: 관전자로 입장, 8단계) |
| `joined` | S→C | `{ you(−1/+1, 관전자 0), token, code, players, resume, server, spectator?, spectators? }` (`server`: 방 서버 데이터센터 코드 또는 null, v6.1) |
| `lobby` | S→C | `{ players: [{ side, nick, ready, online }], spectators }` (`spectators`: 관전자 수, 8단계) |
| `error` | S→C | `{ code }`: `full` · `noRoom` · `inUse` · `version` · `specFull` (보낸 뒤 연결을 닫는다) |
| `ready` | C→S | `{ rtt }` 시계를 맞춘 뒤 준비 완료 |
| `start` | S→C | `{ startAt, firstServer, bestOf, players }` |
| `resume` | S→C | `{ startAt, firstServer, players, game(경기 상태), opp? }` 재접속한 사람에게 |
| `ping` / `pong` | C→S / S→C | `{ t0 }` / `{ t0, t1, t2 }` 시계 동기화 |
| `toss` | C→S, S→C | `{ seq, t, x }` (+ 서버가 붙이는 `side`). `makeToss(x, t)`가 결정론적이라 이것으로 충분 |
| `serve` / `hit` | C→S, S→C | `{ seq, t, pos, vel, spin, shotType, racket: { x, z } }` (+ `side`). `racket`은 타격 순간 라켓 위치(친 사람 기준 좌표). `shotType`은 `SHOT_TYPES`(`normal`·`drive`·`cut`·`side`·`smash`·`block`·`mishit`, 7단계) 중 하나 |
| `reject` | S→C | `{ seq, t, reason }` 보낸 사람에게만. 사유: `time` `turn` `speed` `spin` `far` `pos` `away` `bad` `spectator`(관전자가 보냄) `countdown`(10단계, 재개 카운트다운 중 토스) |
| `correct` | S→C | `{ side, seq, t, pos, vel, spin }` 바운드 직후 서버 기준 공 상태 (`side`·`seq` = 그 공을 친 타격) |
| `point` | S→C | `{ kind, winner, loser, reason, score, games, rally, t, gameOver, matchOver, nextAt, rules }` (`rules` = 득점 직후 규칙 상태) |
| `racket` | C→S, S→C | `{ t, x, z }` (관전자에게 가는 것은 `side` 포함) 상대 화면에 내 라켓을 보여 주기 위한 위치 (15 Hz). 숨은 치트(수)면 받을 공 쪽으로 옮긴 위치(v7.17, `guardRacket`) |
| `opp` | S→C | `{ state: 'away', until }` / `{ state: 'back' }` 상대 끊김·복귀 (관전자에게는 `side` 포함) |
| `end` | S→C | `{ winner, score, games, by: 'normal' \| 'forfeit' }` |
| `leave` | C→S | 퇴장 (경기 중이면 기권) |
| `pause` | S→C | (10단계) `{ state: 'wait', who: [{ side, seat, nick, until }] }` 일시정지 시작·갱신 / `{ state: 'resume', at }` 재개 시각(서버 시각 ms, 지금 + `RESUME_COUNTDOWN`) / `{ state: 'cancel' }` 카운트다운 중 다시 끊겨 대기로 복귀 |
| `emote` | C→S, S→C | (12단계) 보낼 때 `{ id }`, 받을 때 `{ id, side, seat }` |

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

- 서버도 `public/shared/physics.js`, `rules.js`, `match.js`를 그대로 실행해 궤적을 재계산하고 **득점을 서버가 판정**한다. 서버는 `TUNABLE` 기본값(게임용 중력 `G_GAME` 포함)을 쓰므로, 대전 중 클라이언트는 물리·판정 값을 기본값으로 고정한다(연출 켜기/끄기·카메라·모바일 값만 허용, `TUNABLE_ONLINE_FREE`. 터치 감도는 마우스 DPI처럼 각자 맞추는 값).
- 서버는 실시간 루프 없이 이벤트로 움직인다: 타격이 오면 확정 상태를 복사해 그 시각까지 진행한 뒤 검증하고, 통과하면 확정한다.
- 아무도 치지 않으면 어떻게 끝나는지(예정 결말 시각)를 미리 계산해 그 시각 + `GRACE`(0.6 s, v5.0의 0.3에서 늘림)에 알람을 걸고, 그때까지 유효한 타격이 없으면 `point`를 보낸다.
- 클라이언트 화면의 판정은 잠정(회색 "?")이다. 서버 `point`가 같으면 확정, 다르면 "판정 정정"으로 서버 판정을 보여 준다. 점수판·득점 소리·다음 서브는 서버 `point` 기준.
- 비정상 `hit`·`serve`는 거부한다 (`reject`). 수치는 `constants.js`의 `ONLINE`.

| 검사 | 기준 | 사유 |
|---|---|---|
| 형식 | `pos`·`vel`·`spin`·`racket`이 유한한 수, `shotType`이 허용 목록(`SHOT_TYPES`) 안 (7단계) | `bad` |
| 차례 | 보낸 사람이 `canHit`이고, 서브 순간이면 `serve`·아니면 `hit` | `turn` |
| 시각 | 서버 경기 시각 기준 $-0.6 \le t - t_{now} \le +0.05$ s (`T_PAST`, `T_FUTURE`; v5.0의 0.3에서 늘림), 확정 시각 이후, 그 전에 득점이 나지 않음 | `time` / `turn` |
| 최대 속도 | $\lvert v \rvert \le 22$ m/s (`MAX_V`) | `speed` |
| 최대 회전 | $\lvert \omega \rvert \le 120$ rps (`MAX_SPIN`) | `spin` |
| 라켓-공 거리 | 친 사람 기준 x·z 각각 `HIT_RADIUS`(서브 `SERVE_HIT_RADIUS`) + 0.04 m (`RACKET_TOL`) | `far` |
| 공 위치 | `pos`와 서버가 계산한 공의 거리 $\le 0.05$ m (`BALL_TOL`) | `pos` |

- 한도 실측(5단계): AI 경기 60판 87,590타 최대 15.15 m/s(스매시)·79.2 rps(드라이브). 사람만 낼 수 있는 실타 `MISHIT_SPEED` 18 m/s × 1.2 → 22 m/s, 회전 79.2 × 1.5 ≈ 120 rps. 테스트가 "한도 ≥ 실측 최댓값 × 1.2"를 확인한다.
- 7단계 회전 누적: 상한(드라이브 100, 커트·사이드 70 rps)이 있어 AI 경기 30판 4,799타 최대 98.6 rps(드라이브), 14.99 m/s → 한도(120 rps, 22 m/s)는 그대로다. 테스트가 "상한 ≤ MAX_SPIN / 1.2"도 확인한다.
- 토스: 서브 대기 중 서브권자만, 상대가 끊겨 있으면 `away`. 클라이언트가 보낸 점수는 믿지 않는다.

## 구질 버튼과 결정론 (7단계)

- 구질 판정·회전 누적·판정용 회전은 **친 사람의 클라이언트에서만** 계산한다. 서버는 결과 `vel`·`spin`의 한도와 `shotType` 허용 목록만 검증하고, 되감기는 받은 `vel`·`spin`을 다시 적용할 뿐 다시 판정하지 않는다. 그래서 누적이 결정론·서버 판정과 어긋나지 않는다.
- 판정용 회전의 출발점 `game.inSpin = { t, spin }`(마지막 타격의 회전)은 `applyHit`가 기록하고, 되감기·재접속용 경기 상태(`matchSnapshot`/`restoreMatch`)에 들어간다. 토스하면 null.
- 구질 판정 값(`BUTTON_WINDOW`, `SPIN_CARRY`, 구질별 회전·λ·`SPIN_CAP`·`STACK`)은 대전 중 기본값으로 고정된다. 모바일 버튼 크기·위치(`MOB_BTN_*`)는 화면 값이라 바꿀 수 있다.
- 옛 페이지(다른 `VERSION`)는 입장할 때 `version`으로 거절되므로 v6 클라이언트와 섞이지 않는다.

## 검증 테스트

- [x] (`tests/net.test.js`) 시계 동기화 공식이 인위적 지연(편도 30/50 ms + 지터 0~10 ms) 조건에서 오차 5 ms 이내로 offset을 구한다.
- [x] (`tests/net-room.test.js`) Room 클래스를 가짜 WebSocket 2개로 직접 생성해, 한 랠리 후 두 클라이언트와 서버의 득점 판정이 일치한다.
- [x] 비정상 `hit`(차례 아님, 과속, 과회전, 라켓이 멂, 시각 과거·미래, 위치 불일치)이 거부된다.
- [x] 3번째 접속이 거절된다 (없는 방·쓰는 중인 방·버전 불일치 포함).
- [x] (`tests/net-wrangler.test.js`) `npx wrangler@4.139.0 dev`로 실제 WebSocket 연결 테스트(입장·핑·3번째 거절·AI 둘이 첫 득점까지). 실행할 수 없는 환경이면 이유를 남기고 건너뛴다.
- [x] (`tests/net-match.test.js`) 인위적 지연(편도 30·80 ms, 비대칭 30/80 ms)에서 AI 대 AI 원격 경기 한 판의 점수·득점 순서가 서버·두 클라이언트에서 일치한다.
- [x] 재접속(10초 안: 이어서 진행 / 넘으면 기권승·방 정리), 잠들었다 깨어남(저장 상태 복원), 화면 지연 함수, 대전 토스 실패 규칙.
- [x] (v5.1) 흔들리는 네트워크(편도 100 ms + 지터 30 ms + 3% 확률 최대 300 ms 튐)에서 원격 AI 경기: 거부 0, 점수 일치.
- [x] (v6.2) 모바일 데이터(편도 60 ms + 지터 40 ms + 5% 확률 최대 400 ms 튐): PC 30 ms ↔ 모바일은 거부 0·점수 일치. 양쪽 모두 모바일이면 튐이 겹쳐 타격이 0.6 s 넘게 늦는 일이 드물게 생겨(실측 한 판 1건, `time`) 거부 1% 이하·점수 일치만 확인한다. 서버 값은 바꾸지 않았다.
- [x] (v6.2) 백그라운드 복귀 `wake()`: 끊긴 직후 부르면 100 ms 안에 다시 접속, 연결된 채로 부르면 바로 `ping`.
- [x] (9단계, `tests/doubles-net.test.js`) 복식 방 정원 4명·5번째 `full`·단식 방 불변, 팀 옮기기(빈 자리만·자동 재준비·새 자리 통지)와 앞 좌석 당기기, 4명이 11점 한 게임을 끝까지(서버·네 클라이언트 점수·득점 순서 일치, 잠정 판정 불일치 0, 거부 0, 서브 순서가 ITTF 4순환과 일치하고 네 사람 모두 서브), 차례가 아닌 좌석의 `hit`·`toss` 거부와 상태 불변, 재접속(같은 좌석, 끊긴 사람을 모두에게 알림)·퇴장 시 팀 기권, 관전자가 네 선수의 라켓을 모두 받음.
- [x] (8단계, `tests/spectate.test.js`) 관전자 3명(대기실·경기 중 입장)이 선수와 같은 득점 순서·점수를 받고 잠정 판정 불일치 0, 관전자의 `toss`·`serve`·`hit` 거부와 상태 불변, 8명까지·9번째 `specFull`·없는 방 `noRoom`·선수 3번째는 그대로 `full`, 관전자 중도 퇴장·입장에도 경기 유지, 선수 끊김(`opp` + `side`)·기권 `end` 전달, 선수가 모두 떠나면 관전 연결 정리, 목록 저장·복원, 되감기 0·관전 지연 0.5 s, 자유 시점 계산(`orbitCamera` 등).
- [x] (v5.1) 편도 80 ms 원격 경기에서 화면을 흉내 내: 보이는 공의 시간이 거꾸로 가지 않고, 내가 칠 때 화면 지연 ≤ 20 ms.

## 끊김 일시정지 (10단계)

기권패 대신 기다렸다가 이어서 한다. 단식·복식·관전 공통이다. 구현 전 사양이며, 시작 버전은 v10.0.

- **상태**: `Host`에 선수별 `awayAt`(끊긴 서버 시각, 없으면 null)·`awaySpent`(이 경기에서 이미 끊겨 있던 시간 누적, ms), 전체 `pause`(`null | 'wait' | 'countdown'`)와 `resumeAt`을 둔다. 값은 `snapshot`/`restore`에 넣어 잠들었다 깨어나도 유지한다. 지금의 `p.away`(마감 시각)는 이 둘로 바꾼다.
- **끊김**: 연결이 끊기면 `awayAt`을 기록하고 `opp { state:'away' }`(마감 시각 포함)를 방송한다. **진행 중인 랠리는 평소대로 끝까지 판정한다**(끊긴 쪽이 칠 차례면 보통 실점. 끊어서 실점을 피하는 악용 방지). 다른 선수의 `hit`은 그대로 받는다. 서브 대기(`waitingServe`)에서 끊기면 바로 일시정지다.
- **일시정지 시작**: 끊긴 사람이 있고 그 포인트가 끝난 뒤(`rules.phase`가 `serving`·`rally`가 아님)부터 `pause = 'wait'`. `pause { state:'wait', who }`를 선수·관전자 모두에게 보내고 화면은 "○○ 연결 끊김 · 기다리는 중 (남은 N초)"를 보인다. 토스는 `reject: away`(지금과 같음).
- **대기 한도**: 한 번 끊긴 동안 `RECONNECT_WAIT` 30 s(10 → 30, 단식·복식 공통), 한 경기에서 선수별 누적 `AWAY_BUDGET` 90 s. 둘 다 **끊긴 순간부터** 센다(포인트가 끝나기 전 시간 포함). 마감 = `min(awayAt + RECONNECT_WAIT, awayAt + (AWAY_BUDGET − awaySpent))`. 넘으면 그 팀이 기권패(`end.by = 'forfeit'`, 지금과 같음). 돌아오면 `awaySpent += 복귀 시각 − awayAt`. 한 사람이 반복해 끊어도 누적 90 s가 상한이다.
- **재개**: 끊긴 사람이 `token`으로 돌아와 시계를 맞추고 `ready`를 보내(재접속은 지금과 같음, `resume` 수신) 모든 선수가 연결되면 `pause { state:'resume', at: now + RESUME_COUNTDOWN(3 s) }`를 모두에게 보낸다. 화면은 3·2·1을 띄운다. `at`이 되기 전의 `toss`는 `reject: countdown`. `at`이 지나면 `pause = null`이고 토스를 받는다. 카운트다운 중 누가 다시 끊기면 `pause { state:'cancel' }`로 대기로 돌아간다(그 끊김도 누적에 센다). 복식에서 둘 이상이 끊기면 마지막 사람이 돌아와야 카운트다운이 시작된다.
- **모두 끊김**: 한 팀 전원이 끊긴 경우는 지금처럼 마감에 방을 닫는다(기권이 아니라 정리). 상대 팀이 연결돼 있으면 기권패.
- **흐르는 시간**: 확인 결과 서브 대기에는 시간 제한이 없고(`waitingServe`), `RALLY_TIMEOUT`은 토스·타격 뒤에만 흐르므로 일시정지 중 멈춰야 할 경기 시계는 없다. 서버 경기 시각은 벽시계 기준 그대로 흐른다. 돌아온 클라이언트는 `resume`의 경기 상태에서 `MAX_CATCHUP_STEPS`로 따라잡는다(30 s·90 s도 몇 프레임). 구현 때 서브 대기 중 오래 흐른 시각이 `T_PAST` 검사에 걸리지 않는지 테스트로 확인한다.
- **저장**: `ctx.storage.put`은 끊김·복귀·재개(카운트다운 시작) 순간에만 한다(한 번 끊길 때 약 3회). 알람은 기존 하나를 유지하되 후보에 일시정지 마감·재개 시각을 넣는다.
- **관전자**: `pause`·`opp`를 받아 같은 안내를 보인다. 관전자가 끊기는 것은 일시정지와 무관하다.
- **경기 중 나가기**(`leave`)는 지금처럼 즉시 기권. 대기실 안내(모바일 백그라운드 복귀)의 "10초 뒤 기권패"는 "30초 안에 돌아오면 이어서 합니다"로 고친다. 클라이언트의 포기 시각(`net.js`의 `RECONNECT_WAIT` 비교)도 새 값을 쓴다.
- **상수** (`ONLINE`): `RECONNECT_WAIT` 10 → 30, `AWAY_BUDGET` 90, `RESUME_COUNTDOWN` 3. 기존 테스트에서 10 s 가정이 있으면 이유를 10장에 남기고 고친다.
- **테스트** (`tests/pause*.test.js`): 랠리 중 끊김 → 그 포인트는 정상 판정 후 일시정지 / 일시정지·카운트다운 중 토스 거부(`away`·`countdown`) / 30 s 안 복귀 → 카운트다운 → 점수 유지한 채 재개 / 카운트다운 중 재끊김 → 대기 복귀 / 누적 90 s 초과 → 기권 / 한 번에 30 s 초과 → 기권 / 복식에서 1명 끊김 → 4명·관전자 모두 일시정지, 2명 끊김 → 마지막 복귀 뒤 카운트다운 / 일시정지 중 `snapshot`→`restore`(잠들었다 깨어남) 후 상태·누적 유지 / 흔들리는 네트워크(편도 100 ms + 지터) 원격 AI 경기 점수 일치(기존 테스트 유지).

## 이모트 중계 (12단계)

구현 전 사양이며, 시작 버전은 v12.0. 화면 표시는 feel.md "이모트".

- **문구**: `constants.js`의 `EMOTES` 6개로 고정 — "나이스!", "아깝다", "ㅋㅋㅋ", "잘 쳤다", "한 판 더?", "GG". 자유 입력은 받지 않는다(`id`는 0~5 정수).
- **C→S** `emote { id }`. 서버는 ① 보낸 연결이 선수이고(관전자가 보낸 것은 **조용히 무시**) ② `id`가 정수이고 범위 안이며 ③ 그 연결의 마지막 통과 이모트로부터 `EMOTE_COOLDOWN` 2 s 이상 지났을 때만 중계한다. 아니면 버린다(오류 응답 없음). 시각은 `io.now()`(서버 시각)로 잰다. 통과하면 보낸 사람을 뺀 모든 선수·관전자에게 `emote { id, side, seat }`(`side`·`seat`은 연결에서 정한 값, 메시지 값은 믿지 않음). 대기실·경기 중·결과 화면·일시정지 중 모두 가능하다.
- **경기 상태 불변**: 이모트는 `game`·`snapshot`·저장·알람에 아무 영향이 없다(`ctx.storage` 저장 없음). 쿨다운 기록은 메모리에만 두며 연결 id별이라 잠들면 사라져도 괜찮다.
- **무료 한도 계산**: 들어오는 WebSocket 메시지는 20:1로 요청 수에 센다. 서버가 중계하는 이모트는 쿨다운 때문에 연결당 최대 0.5개/s이고, 클라이언트도 같은 쿨다운으로 보내기 전에 걸러 실제 들어오는 메시지도 연결당 약 0.5개/s 이하다. 4연결이 쉬지 않고 눌러도 2개/s ÷ 20 = 0.1요청/s로 `racket` 15 Hz(연결당 0.75요청/s)의 1/7 이하라 영향이 작다. 나가는 중계는 과금되지 않는다(정상 사용은 분당 몇 번).
- **테스트** (`tests/emote*.test.js`): 정상 중계(단식 1명 / 복식 3명 + 관전자 전원) / 잘못된 id(음수·6·소수·문자열·없음) 무시 / 쿨다운(2 s 안의 두 번째 버림, 2 s 뒤 통과, 연결별 독립) / 관전자가 보낸 것 무시 / 보낸 이모트 전후 `snapshot()` 동일·저장 호출 0회.
