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
const control = await import('./control.js');
const sourceControl = await import('./collect.js');
const routing = await import('./routing.js');

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

test('stores the observed exit IP with a validated proxy', () => {
  add('10.10.10.10:1080');
  store.recordResult('10.10.10.10:1080', true, { exitIp: '203.0.113.9', https: 1 });
  assert.equal(store.find('10.10.10.10:1080')?.exit_ip, '203.0.113.9');
});

test('restores a removed proxy and its connectivity history', () => {
  const proxy = {
    addr: '9.9.9.9:8080', scheme: 'http' as const, score: 80, anonymity: 'elite' as const, country: 'US', exit_ip: '8.8.8.8', https: 1,
    latency_ms: 120, ok_count: 2, fail_count: 0, source: 'test', checked_at: Date.now(), added_at: Date.now(),
  };
  store.addCandidates([{ addr: proxy.addr, scheme: proxy.scheme, source: proxy.source! }]);
  const stored = store.find(proxy.addr)!;
  store.restoreProxy({ ...stored, ...proxy }, [{ id: 'github', name: 'GitHub', url: 'https://github.com', available: true, latencyMs: 100, statusCode: 200, checkedAt: Date.now() }]);
  assert.equal(store.find(proxy.addr)?.exit_ip, '8.8.8.8');
  assert.equal(store.connectivityResults(proxy.addr).length, 1);
  store.remove(proxy.addr);
});

test('persists job run history with completion status', () => {
  const id = store.startJobRun('validate', { limit: 25 });
  store.finishJobRun(id, 'failed', 'fixture failure');
  const run = store.listJobRuns(1)[0]!;
  assert.equal(run.id, id);
  assert.equal(run.status, 'failed');
  assert.equal(run.metadata.limit, 25);
  assert.equal(run.error, 'fixture failure');
});

test('automation settings persist and clamp unsafe ranges', () => {
  const settings = control.updateAutomationSettings({
    enabled: false,
    autoPurgeEnabled: false,
    collectIntervalMinutes: 1,
    recheckIntervalMinutes: 999,
    validateBatch: 10,
  });
  assert.deepEqual(settings, {
    enabled: false,
    autoPurgeEnabled: false,
    collectIntervalMinutes: 5,
    recheckIntervalMinutes: 120,
    validateBatch: 50,
  });
  assert.deepEqual(control.getAutomationSettings(), settings);
});

test('collection source enablement persists', () => {
  const initial = sourceControl.sourceStatuses();
  assert.equal(initial.length, 23);
  assert.equal(initial.filter((source) => source.enabled).length, 7);
  assert.ok(initial.filter((source) => source.recommended).every((source) => source.enabled));
  assert.ok(sourceControl.setSourceEnabled('proxifly', false));
  assert.equal(sourceControl.sourceStatuses().find((source) => source.name === 'proxifly')?.enabled, false);
  assert.ok(sourceControl.setSourceEnabled('proxifly', true));
  assert.equal(sourceControl.sourceStatuses().find((source) => source.name === 'proxifly')?.enabled, true);
});

test('gateway usage and country routing persist', () => {
  assert.deepEqual(routing.updateGatewayRouting({ profile: 'openai', country: 'US' }), {
    profile: 'openai',
    country: 'US',
  });
  assert.deepEqual(routing.getGatewayRouting(), { profile: 'openai', country: 'US' });
  assert.deepEqual(routing.updateGatewayRouting({ profile: 'invalid', country: null }), {
    profile: 'openai',
    country: null,
  });
});

test('connectivity results persist and support target filtering', () => {
  const addr = '10.10.10.10:1080';
  store.recordConnectivity(addr, [{
    id: 'github',
    name: 'GitHub',
    url: 'https://github.com/',
    available: true,
    latencyMs: 123,
    statusCode: 200,
  }], 123456);
  assert.equal(store.connectivitySummaries([addr]).get(addr)?.available, 1);
  assert.ok(store.get({ n: 100, target: 'github' }).some((proxy) => proxy.addr === addr));
});

test('proxy queries paginate with a stable total', () => {
  const total = store.count({ minScore: 1 });
  const first = store.get({ n: 1, offset: 0, minScore: 1 });
  const second = store.get({ n: 1, offset: 1, minScore: 1 });
  assert.ok(total >= 2);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0]?.addr, second[0]?.addr);
});
