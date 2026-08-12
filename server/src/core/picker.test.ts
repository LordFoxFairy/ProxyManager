import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PM_DB = join(mkdtempSync(join(tmpdir(), 'pm-pick-')), 'p.db');

const store = await import('./store.js');
const { Picker } = await import('./picker.js');

store.init();

/** Seed a validated proxy with a known latency. */
function seed(addr: string, latencyMs: number, score = 50) {
  store.addCandidates([{ addr, scheme: 'socks5', source: 'test' }]);
  store.recordResult(addr, true, { https: 1, latencyMs });
  // recordResult adds SCORE.ok; nudge to the caller's target score.
  const cur = store.find(addr)!.score;
  if (score !== cur) store.recordResult(addr, true, { delta: score - cur });
}

test('url-test holds the current node unless beaten by more than tolerance', () => {
  seed('10.0.0.1:1080', 500);
  const p = new Picker();
  p.cacheMs = 0;
  p.tolerance = 300;

  const first = p.pick(true);
  assert.equal(first?.addr, '10.0.0.1:1080');

  // A node only 100ms faster is inside tolerance -- switching would thrash
  // connection reuse for no real gain.
  seed('10.0.0.2:1080', 400);
  assert.equal(p.pick(true)?.addr, '10.0.0.1:1080', 'must not switch inside tolerance');

  // A node 400ms faster clears the threshold.
  seed('10.0.0.3:1080', 100);
  assert.equal(p.pick(true)?.addr, '10.0.0.3:1080', 'must switch when clearly better');
});

test('a reported failure drops the node from the next pick', () => {
  const p = new Picker();
  p.cacheMs = 0;
  const first = p.pick(true)!;
  p.report(first.addr, false);
  const next = p.pick(true);
  assert.notEqual(next?.addr, first.addr, 'failed node must not be reused immediately');
});

test('exclusions are honoured so a retry never repeats a failed node', () => {
  const p = new Picker();
  p.cacheMs = 0;
  const a = p.pick(true)!;
  const b = p.pick(true, new Set([a.addr]));
  assert.ok(b);
  assert.notEqual(b.addr, a.addr);
});

test('round-robin visits different nodes', () => {
  const p = new Picker();
  p.cacheMs = 0;
  p.strategy = 'round-robin';
  const seen = new Set([p.pick(true)?.addr, p.pick(true)?.addr, p.pick(true)?.addr]);
  assert.ok(seen.size > 1, 'round-robin must not pin a single node');
});

test('pick returns null when everything is excluded', () => {
  const p = new Picker();
  p.cacheMs = 0;
  const all = new Set(store.get({ n: 500 }).map((x) => x.addr));
  assert.equal(p.pick(true, all), null);
});

test('https-only never returns a non-CONNECT proxy', () => {
  store.addCandidates([{ addr: '10.0.9.9:1080', scheme: 'socks4', source: 'test' }]);
  store.recordResult('10.0.9.9:1080', true, { https: 0, latencyMs: 1 });
  const p = new Picker();
  p.cacheMs = 0;
  // Latency 1ms would win on speed alone; the https filter must exclude it.
  for (let i = 0; i < 5; i++) {
    assert.notEqual(p.pick(true)?.addr, '10.0.9.9:1080');
  }
});

test('country filters constrain the candidate pool', () => {
  seed('10.0.8.1:1080', 40, 100);
  store.recordResult('10.0.8.1:1080', true, { country: 'DE' });
  seed('10.0.8.2:1080', 10, 100);
  store.recordResult('10.0.8.2:1080', true, { country: 'US' });
  const p = new Picker();
  p.cacheMs = 0;
  assert.equal(p.pick(true, new Set(), { country: 'DE' })?.addr, '10.0.8.1:1080');
});

test('target routing prefers learned proxies and falls back while learning', () => {
  seed('10.0.7.1:1080', 90, 100);
  store.recordResult('10.0.7.1:1080', true, { country: 'FR' });
  store.recordConnectivity('10.0.7.1:1080', [{
    id: 'openai',
    name: 'OpenAI API',
    url: 'https://api.openai.com/v1/models',
    available: true,
    latencyMs: 90,
    statusCode: 401,
  }]);
  const p = new Picker();
  p.cacheMs = 0;
  assert.equal(p.pick(true, new Set(), { country: 'FR', target: 'openai' })?.addr, '10.0.7.1:1080');
  assert.ok(p.pick(true, new Set(), { country: 'FR', target: 'not-learned' }));
});
