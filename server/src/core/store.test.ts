import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// config reads the DB path at import time, so point it somewhere disposable
// before anything pulls in the store.
process.env.PM_DB = join(mkdtempSync(join(tmpdir(), 'pm-test-')), 'test.db');

const store = await import('./store.js');
const { SCORE } = await import('../config.js');

store.init();

const add = (addr: string, scheme = 'socks5') =>
  store.addCandidates([{ addr, scheme, source: 'test' }]);

test('a proxy that never succeeded is evicted on its first failure', () => {
  add('1.1.1.1:1080');
  store.recordResult('1.1.1.1:1080', false);
  // 50 + (-50) = 0 -> purgeable. Keeping it would waste check slots on the
  // ~70% of candidates that never work.
  assert.equal(store.get({ minScore: 0 }).find((p) => p.addr === '1.1.1.1:1080')?.score, 0);
  assert.equal(store.purgeDead(), 1);
});

test('a proven proxy survives a single failure', () => {
  add('2.2.2.2:1080');
  store.recordResult('2.2.2.2:1080', true); // 50 -> 60, ok_count 1
  store.recordResult('2.2.2.2:1080', false); // proven, so only -30 -> 30
  const p = store.get({ minScore: 0 }).find((x) => x.addr === '2.2.2.2:1080');
  assert.equal(p?.score, SCORE.init + SCORE.ok + SCORE.fail);
  assert.equal(store.purgeDead(), 0);
});

test('score is clamped to the configured maximum', () => {
  add('3.3.3.3:1080');
  for (let i = 0; i < 20; i++) store.recordResult('3.3.3.3:1080', true);
  assert.equal(store.get({ minScore: 0 }).find((p) => p.addr === '3.3.3.3:1080')?.score, SCORE.max);
});

test('purged addresses are buried and not re-collected', () => {
  add('4.4.4.4:1080');
  store.recordResult('4.4.4.4:1080', false);
  store.purgeDead();

  // The free lists keep serving the same dead addresses; re-inserting them
  // would burn the whole validation budget on known-dead hosts.
  const added = add('4.4.4.4:1080');
  assert.equal(added, 0, 'buried address must not be re-inserted');
});

test('tombstones expire with doubling backoff', () => {
  const H = 3_600_000;
  const ADDR = '5.5.5.5:1080';
  // Other tests leave their own tombstones, so assert on this address only.
  const buried = () => store.isBuried(ADDR);

  add(ADDR);
  store.recordResult(ADDR, false);
  store.purgeDead(); // deaths = 1 -> 1h

  store.exhumeExpired(Date.now() + 30 * 60_000);
  assert.ok(buried(), 'still buried at 30min');

  store.exhumeExpired(Date.now() + H + 60_000);
  assert.ok(!buried(), 'exhumed after 1h');

  // Second death must wait twice as long.
  add(ADDR);
  store.recordResult(ADDR, false);
  store.purgeDead(); // deaths = 2 -> 2h

  store.exhumeExpired(Date.now() + H + 60_000);
  assert.ok(buried(), 'still buried at 1h on the 2nd death');

  store.exhumeExpired(Date.now() + 2 * H + 60_000);
  assert.ok(!buried(), 'exhumed after 2h');
});

test('https filter only returns CONNECT-capable proxies', () => {
  add('6.6.6.6:1080');
  add('7.7.7.7:1080');
  store.recordResult('6.6.6.6:1080', true, { https: 1, latencyMs: 100 });
  store.recordResult('7.7.7.7:1080', true, { https: 0, latencyMs: 50 });

  const https = store.get({ n: 10, https: true }).map((p) => p.addr);
  assert.ok(https.includes('6.6.6.6:1080'));
  assert.ok(!https.includes('7.7.7.7:1080'), 'socks4-style non-CONNECT proxy must be excluded');
});

test('unchecked proxies are never handed out', () => {
  add('8.8.8.8:1080');
  const addrs = store.get({ n: 100 }).map((p) => p.addr);
  assert.ok(!addrs.includes('8.8.8.8:1080'), 'never-validated proxy must not be served');
});

test('pending prioritises never-checked proxies over checked ones', () => {
  add('9.9.9.9:1080');
  const due = store.pending(50).map((p) => p.addr);
  const unchecked = due.indexOf('9.9.9.9:1080');
  const checked = due.indexOf('6.6.6.6:1080'); // validated in an earlier test
  assert.ok(unchecked >= 0, 'new proxy must be queued for checking');
  assert.ok(checked === -1 || unchecked < checked, 'never-checked must come first');
});
