// [5] npx wrangler dev(고정 버전)로 실제 Worker + Durable Object를 띄워 진짜 WebSocket으로 연결한다.
// wrangler를 받거나 띄울 수 없는 환경(네트워크 차단 등)이면 이유를 남기고 건너뛴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createOnlineClient } from '../public/js/net.js';
import { createAI } from '../public/js/ai.js';
import { createRng } from '../public/js/input.js';
import { VERSION } from '../public/shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = 'wrangler@4.139.0'; // 고정 버전 (CLAUDE.md 10장)
const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;

function startWrangler(timeoutMs = 120_000) {
  return new Promise((resolve) => {
    let log = '';
    let child;
    try {
      child = spawn('npx', ['--yes', WRANGLER, 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
        cwd: ROOT, detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      });
    } catch (e) { resolve({ error: `실행 실패: ${e.message}` }); return; }
    const timer = setTimeout(() => resolve({ child, error: `${timeoutMs / 1000}초 안에 준비되지 않음\n${log.slice(-800)}` }), timeoutMs);
    const onData = (d) => {
      log += d;
      if (/Ready on/.test(log)) { clearTimeout(timer); resolve({ child }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: `실행 실패: ${e.message}` }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ error: `wrangler 종료 (코드 ${code})\n${log.slice(-800)}` }); });
  });
}
function stop(child) {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 이미 끝남 */ }
}

// 메시지를 차례로 받는 WebSocket 래퍼
function openWs(code) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/${code}`);
  const inbox = [];
  ws.onmessage = (ev) => { inbox.push(JSON.parse(ev.data)); };
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return {
    ws, opened,
    send: (m) => ws.send(JSON.stringify(m)),
    async next(type, ms = 5000) {
      const end = Date.now() + ms;
      for (;;) {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) return inbox.splice(i, 1)[0];
        if (Date.now() > end) throw new Error(`${type} 메시지를 받지 못함: ${JSON.stringify(inbox)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}

test('[5] wrangler dev 실제 연결: 방 코드 발급 → 입장 → 핑 → 3번째 거절 → AI 둘이 실제 WebSocket으로 첫 득점까지', { timeout: 240_000 }, async (t) => {
  const srv = await startWrangler();
  if (srv.error) {
    if (srv.child) stop(srv.child);
    console.log(`# wrangler dev 건너뜀: ${srv.error}`);
    t.skip(`wrangler dev를 쓸 수 없음: ${srv.error.split('\n')[0]}`);
    return;
  }
  try {
    // 정적 자산과 방 코드 발급
    const html = await (await fetch(`${BASE}/`)).text();
    assert.match(html, /<div id="version"><\/div>/);
    const { code } = await (await fetch(`${BASE}/api/new`)).json();
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}$/);
    const bad = await fetch(`${BASE}/ws/${code}`);
    assert.equal(bad.status, 426, 'WebSocket이 아닌 요청');

    // 입장·핑·대기실·3번째 거절
    const a = openWs(code);
    await a.opened;
    a.send({ type: 'join', nickname: '가', version: VERSION, create: true });
    const ja = await a.next('joined');
    assert.equal(ja.you, -1);
    assert.equal(ja.code, code);
    const t0 = Date.now();
    a.send({ type: 'ping', t0 });
    const pong = await a.next('pong');
    assert.equal(pong.t0, t0);
    assert.ok(Number.isFinite(pong.t1) && Number.isFinite(pong.t2));
    const b = openWs(code);
    await b.opened;
    b.send({ type: 'join', nickname: '나', version: VERSION });
    assert.equal((await b.next('joined')).you, 1);
    const c = openWs(code);
    await c.opened;
    c.send({ type: 'join', nickname: '셋째', version: VERSION });
    assert.equal((await c.next('error')).code, 'full');
    for (const x of [a, b, c]) x.ws.close();
    await new Promise((r) => setTimeout(r, 300));

    // 실제 시간으로 AI 둘이 대전: 첫 득점이 양쪽에 같게 도착
    const { code: code2 } = await (await fetch(`${BASE}/api/new`)).json();
    const now = () => performance.timeOrigin + performance.now();
    const recs = [];
    const mk = (nick, create, seed) => {
      const rec = { points: [], rejects: [] };
      rec.client = createOnlineClient({
        open: () => new WebSocket(`ws://127.0.0.1:${PORT}/ws/${code2}`),
        now, nickname: nick, code: code2, create, seed,
        makePlayer(side) { const ai = createAI(side, 'NORMAL', createRng(seed)); return { ai, player: ai.player }; },
        hooks: { onServerResult: (r, m) => rec.points.push({ ...r, matched: m }), onReject: (m) => rec.rejects.push(m) },
      });
      recs.push(rec);
      rec.client.connect();
      return rec;
    };
    const waitFor = async (fn, ms) => {
      const end = Date.now() + ms;
      while (!fn()) {
        if (Date.now() > end) throw new Error(`시간 초과: ${recs.map((r) => `${r.client.status}/${r.client.errorCode}`)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const A = mk('가', true, 3);
    const timer = setInterval(() => { for (const r of recs) r.client.tick(); }, 8);
    try {
      await waitFor(() => A.client.status === 'waiting', 10_000);
      const B = mk('나', false, 4);
      await waitFor(() => A.client.status === 'playing' && B.client.status === 'playing', 10_000);
      assert.ok(A.client.ping !== null && A.client.ping < 200, `핑 ${A.client.ping} ms`);
      await waitFor(() => A.points.length >= 1 && B.points.length >= 1, 90_000);
      const [pa, pb] = [A.points[0], B.points[0]];
      assert.equal(pa.winner, pb.winner);
      assert.equal(pa.reason, pb.reason);
      assert.deepEqual(pa.score, pb.score);
      assert.deepEqual(A.client.game.rules.score, B.client.game.rules.score);
      assert.equal(A.rejects.length + B.rejects.length, 0, JSON.stringify([...A.rejects, ...B.rejects]));
      console.log(`# wrangler dev 실제 대전: 첫 득점 ${pa.reason} (${pa.score.join(':')}), 핑 ${A.client.ping?.toFixed(1)} ms, 잠정 판정 일치 ${pa.matched}/${pb.matched}`);
      for (const r of recs) r.client.leave();
    } finally {
      clearInterval(timer);
    }
  } finally {
    stop(srv.child);
  }
});
