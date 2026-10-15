// v6.1 핑 개선: 방 서버(Durable Object) 위치 힌트와 경로 진단 (.claude/rules/network.md "방 서버 위치")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { roomStub } from '../server/worker.js';
import { whereAmI } from '../server/room.js';
import { createWorld } from './net-harness.js';
import { ONLINE } from '../public/shared/constants.js';

// get(id, opts) 호출을 기록하는 가짜 Durable Object 네임스페이스. reject에 든 힌트는 런타임이 모르는 힌트처럼 오류를 낸다.
function fakeNamespace(reject = []) {
  const calls = [];
  return {
    calls,
    idFromName: (name) => `id:${name}`,
    get(id, opts) {
      calls.push(opts?.locationHint ?? null);
      if (opts && reject.includes(opts.locationHint)) throw new TypeError(`unknown location hint ${opts.locationHint}`);
      return { id, hint: opts?.locationHint ?? null };
    },
  };
}

test('방 서버는 동북아(apac-ne) 위치 힌트로 만든다', () => {
  assert.deepEqual(ONLINE.LOCATION_HINTS, ['apac-ne', 'apac']);
  const ns = fakeNamespace();
  const stub = roomStub({ ROOM: ns }, 'ABCD');
  assert.equal(stub.id, 'id:ABCD');
  assert.equal(stub.hint, 'apac-ne');
});

test('런타임이 모르는 힌트면 apac, 그것도 안 되면 힌트 없이 만든다 (방 입장이 막히지 않음)', () => {
  let ns = fakeNamespace(['apac-ne']);
  assert.equal(roomStub({ ROOM: ns }, 'ABCD').hint, 'apac');
  assert.deepEqual(ns.calls, ['apac-ne', 'apac']);
  ns = fakeNamespace(['apac-ne', 'apac']);
  assert.equal(roomStub({ ROOM: ns }, 'ABCD').hint, null);
  assert.deepEqual(ns.calls, ['apac-ne', 'apac', null]);
});

test('/api/where: 내가 접속한 Cloudflare 데이터센터 코드를 알려 준다', async () => {
  const req = new Request('https://example.com/api/where');
  Object.defineProperty(req, 'cf', { value: { colo: 'ICN', country: 'KR' } });
  const res = await worker.fetch(req, {});
  assert.deepEqual(await res.json(), { colo: 'ICN', country: 'KR' });
  const res2 = await worker.fetch(new Request('https://example.com/api/where'), {});
  assert.deepEqual(await res2.json(), { colo: null, country: null }); // 로컬 실행 등 cf 정보가 없을 때
});

test('방 서버 위치: trace 응답의 colo를 읽고, 실패하면 null', async () => {
  const ok = async () => new Response('fl=1\nh=www.cloudflare.com\nip=1.2.3.4\ncolo=NRT\nloc=KR\n');
  assert.equal(await whereAmI(ok), 'NRT');
  assert.equal(await whereAmI(async () => { throw new Error('막힘'); }), null);
  assert.equal(await whereAmI(async () => new Response('엉뚱한 응답')), null);
});

test('입장 응답(joined)에 방 서버 위치가 실려 두 클라이언트가 화면에 보여 줄 수 있다', () => {
  const w = createWorld({ seed: 5 });
  w.code = 'ABCD';
  w.room.host.serverColo = 'NRT';
  const A = w.addAI({ lat: 30, create: true, nickname: '가', aiSeed: 1 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const B = w.addAI({ lat: 30, nickname: '나', aiSeed: 2 });
  w.run(() => B.client.status === 'playing', { maxMs: 5000 });
  assert.equal(A.client.serverColo, 'NRT');
  assert.equal(B.client.serverColo, 'NRT');
});
