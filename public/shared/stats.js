// 11단계 경기 요약: 타격·득점 기록을 모아 결과 화면의 표를 만든다 (순수 함수, DOM·시각·난수 없음).
// 연습(main.js)·대전(net.js) 클라이언트가 같은 함수를 쓴다. 서버는 쓰지 않는다(서버 불변).
//
// 기록 규칙 (feel.md "경기 요약")
//  - 타격 = 적용한 racket 이벤트(서브 포함). 같은 타격(key)은 한 번만 센다: 대전은 되감기로 같은 타격을 다시 적용하므로
//    key = 친 사람(side:seat) + 그 사람이 보낸 순번(seq). 서버가 거부한 내 타격은 removeHit로 뺀다.
//  - 득점 = 그 포인트에서 이긴 쪽의 마지막 타격(그 뒤에 상대가 실점). 구질별 득점은 그 타격의 구질, 서브였으면 서브 득점.
//    이긴 쪽이 한 번도 치지 않은 포인트(상대 서브 실수 등)는 득점에만 센다(단식은 그 선수, 복식은 팀 합계에만).
//  - 최장 랠리 = point.rally의 최댓값. 포인트는 서버가 확정한 것(대전) 또는 연습 경기 결과만 넣는다.
//  - 포인트 경계: 이전 결과(렛 포함) 시각 < 타격 시각 ≤ 이 결과 시각인 타격이 그 포인트의 타격이다.
import { STATS, PHYSICS } from './constants.js';

const TWO_PI = 2 * Math.PI;
const norm = (v) => (v ? Math.hypot(v.x, v.y, v.z) : 0);
export const playerKey = (side, seat = 0) => `${side}:${seat}`;

// doubles: 복식(네 칸), mine: 내 선수 키('side:seat', PERFECT·콤보를 아는 칸. 관전자는 null), partial: 입장 전 기록이 빠짐
export function createStats({ doubles = false, mine = null, partial = false } = {}) {
  return { doubles, mine, partial, hits: [], keys: {}, points: [] };
}

// 타격 하나: { key, side, seat, t, shotType, serve, speed(m/s) 또는 vel(벡터), spin(벡터, rad/s), perfect?, combo? }
// 이미 센 key면 false
export function addHit(stats, h) {
  if (Object.hasOwn(stats.keys, h.key)) return false;
  const rec = {
    key: h.key, side: h.side, seat: h.seat ?? 0, t: h.t, shotType: h.shotType ?? 'normal', serve: !!h.serve,
    speed: h.speed ?? norm(h.vel), spin: norm(h.spin) / TWO_PI,
    perfect: h.perfect ?? null, combo: h.combo ?? null,
  };
  stats.keys[h.key] = true;
  stats.hits.push(rec);
  return true;
}

// 서버가 거부한 타격을 뺀다 (없으면 false)
export function removeHit(stats, key) {
  const i = stats.hits.findIndex((h) => h.key === key);
  if (i < 0) return false;
  stats.hits.splice(i, 1);
  delete stats.keys[key];
  return true;
}

// 득점 결과 하나: { type('point'|'let'), winner, loser, rally, t }
export function addPoint(stats, r) {
  stats.points.push({ type: r.type, winner: r.winner ?? 0, loser: r.loser ?? 0, rally: r.rally ?? 0, t: r.t });
}

// 연습·대전 클라이언트의 racket 이벤트 → addHit 입력. seq(대전 순번)가 없으면 시각으로 구분한다(연습은 되감기 없음)
export function hitFromEvent(e, { mineKey = null, dt = PHYSICS.DT } = {}) {
  const seat = e.seat ?? 0;
  const who = playerKey(e.side, seat);
  const q = e.shot?.quality ?? {};
  const own = mineKey !== null && who === mineKey && !q.remote;
  return {
    key: e.seq != null ? `${who}#${e.seq}` : `${who}@${Math.round(e.t / dt)}`,
    side: e.side, seat, t: e.t, shotType: e.shot?.shotType ?? 'normal', serve: !!q.serve,
    speed: e.speed, spin: e.shot?.spin ?? null,
    perfect: own ? q.timing === 'PERFECT' : null, combo: own ? (q.combo ?? 0) : null,
  };
}

function emptyRow(side, seat) {
  const byType = {};
  for (const k of STATS.SHOT_ORDER) byType[k] = { hits: 0, points: 0 };
  return { side, seat, hits: 0, byType, points: 0, servePoints: 0, maxSpeed: 0, maxSpin: 0, perfect: null, maxCombo: null };
}

// 표에 쓸 집계. roster: 표에 넣을 선수 [{ side, seat }] (없으면 단식 두 명 / 복식 네 명)
// 반환 { players: [행], teams: { -1: 행, 1: 행 }, longest, shotTypes(나온 구질만, 순서대로), partial, rallies }
// 행: { side, seat, hits, byType: { 구질: { hits, points } }, points, servePoints, maxSpeed(km/h), maxSpin(rps), perfect, maxCombo }
export function summary(stats, roster = null) {
  const seats = roster ?? (stats.doubles
    ? [[-1, 0], [-1, 1], [1, 0], [1, 1]].map(([side, seat]) => ({ side, seat }))
    : [{ side: -1, seat: 0 }, { side: 1, seat: 0 }]);
  const rows = {};
  for (const s of seats) rows[playerKey(s.side, s.seat)] = emptyRow(s.side, s.seat);
  const rowOf = (side, seat) => (rows[playerKey(side, seat)] ??= emptyRow(side, seat));
  const teams = { [-1]: emptyRow(-1, null), [1]: emptyRow(1, null) };
  if (stats.mine && rows[stats.mine]) Object.assign(rows[stats.mine], { perfect: 0, maxCombo: 0 });

  const hits = stats.hits.slice().sort((a, b) => a.t - b.t);
  for (const h of hits) {
    const r = rowOf(h.side, h.seat);
    const k = STATS.SHOT_ORDER.includes(h.shotType) ? h.shotType : 'normal';
    r.hits++;
    r.byType[k].hits++;
    r.maxSpeed = Math.max(r.maxSpeed, h.speed * STATS.KMH_PER_MS);
    r.maxSpin = Math.max(r.maxSpin, h.spin);
    if (h.perfect !== null) {
      r.perfect = (r.perfect ?? 0) + (h.perfect ? 1 : 0);
      r.maxCombo = Math.max(r.maxCombo ?? 0, h.combo ?? 0);
    }
  }

  // 포인트마다 그 사이 타격으로 득점자를 정한다
  let longest = 0, from = -Infinity, i = 0, rallies = 0;
  const points = stats.points.slice().sort((a, b) => a.t - b.t);
  for (const p of points) {
    const inPoint = [];
    while (i < hits.length && hits[i].t <= p.t) { if (hits[i].t > from) inPoint.push(hits[i]); i++; }
    from = p.t;
    if (p.type !== 'point') continue;
    rallies++;
    longest = Math.max(longest, p.rally);
    teams[p.winner].points++;
    const last = [...inPoint].reverse().find((h) => h.side === p.winner);
    if (last) {
      const r = rowOf(last.side, last.seat);
      const k = STATS.SHOT_ORDER.includes(last.shotType) ? last.shotType : 'normal';
      r.points++;
      r.byType[k].points++;
      if (last.serve) r.servePoints++;
    } else if (!stats.doubles) rowOf(p.winner, 0).points++; // 단식: 상대 실수로 얻은 점수도 그 선수의 득점
  }

  // 팀 합계 (복식 표의 팀 줄. 득점은 위에서 센 실제 점수. PERFECT·콤보는 한 사람만 아는 값이라 합치지 않는다)
  for (const r of Object.values(rows)) {
    const t = teams[r.side];
    t.hits += r.hits;
    t.servePoints += r.servePoints;
    t.maxSpeed = Math.max(t.maxSpeed, r.maxSpeed);
    t.maxSpin = Math.max(t.maxSpin, r.maxSpin);
    for (const k of STATS.SHOT_ORDER) {
      t.byType[k].hits += r.byType[k].hits;
      t.byType[k].points += r.byType[k].points;
    }
  }
  const players = seats.map((s) => rows[playerKey(s.side, s.seat)]);
  const shotTypes = STATS.SHOT_ORDER.filter((k) => players.some((r) => r.byType[k].hits > 0));
  return { players, teams, longest, shotTypes, partial: stats.partial, rallies };
}

// 결과 화면 표의 내용 (DOM 없이 글자만): 열 = 선수(내 쪽 먼저, 복식은 팀마다 두 사람 + 팀 합계), 행 = 항목.
// names: (side, seat) → 이름, first: 앞에 둘 쪽(내 쪽, 관전은 −1). 반환 { head: [{ text, team, mine }], rows: [[항목, ...칸]], longest, partial }
export function summaryTable(sum, { names = (side, seat) => `${side}:${seat}`, first = -1, mine = null } = {}) {
  const cols = [];
  for (const side of [first, -first]) {
    const mates = sum.players.filter((r) => r.side === side).sort((a, b) => a.seat - b.seat);
    for (const r of mates) cols.push({ text: names(r.side, r.seat), row: r, team: false, mine: playerKey(r.side, r.seat) === mine });
    if (mates.length > 1) cols.push({ text: '팀', row: sum.teams[side], team: true, mine: false });
  }
  const dash = (v) => (v === null || v === undefined ? '-' : String(v));
  const rows = [
    ['득점', ...cols.map((c) => String(c.row.points))],
    ['서브 득점', ...cols.map((c) => String(c.row.servePoints))],
    ['타격', ...cols.map((c) => String(c.row.hits))],
    ...sum.shotTypes.map((k) => [`${STATS.SHOT_NAMES[k]} 타격/득점`, ...cols.map((c) => `${c.row.byType[k].hits} / ${c.row.byType[k].points}`)]),
    ['최고 속도 (km/h)', ...cols.map((c) => String(Math.round(c.row.maxSpeed)))],
    ['최대 회전 (rps)', ...cols.map((c) => String(Math.round(c.row.maxSpin)))],
    ['PERFECT', ...cols.map((c) => dash(c.row.perfect))],
    ['최대 퍼펙트 콤보', ...cols.map((c) => dash(c.row.maxCombo))],
  ];
  return { head: cols.map(({ text, team, mine: m }) => ({ text, team, mine: m })), rows, longest: sum.longest, partial: sum.partial };
}
