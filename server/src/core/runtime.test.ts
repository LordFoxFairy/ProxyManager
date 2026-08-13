import assert from 'node:assert/strict';
import test from 'node:test';
import { dnsResponseMatches, getRuntimeConfig, getRuntimeStatus, setRuntimeKind, updateRuntimeConfig } from './runtime.js';
import './store.js';

test('runtime config clamps ports and preserves a valid mode', () => {
  const config = updateRuntimeConfig({ mode: 'global', mixedPort: 1, httpPort: 8080, socksPort: 8081 });
  assert.equal(config.mode, 'global');
  assert.equal(config.mixedPort, 1024);
  assert.equal(config.httpPort, 8080);
  assert.equal(getRuntimeConfig().socksPort, 8081);
});

test('mihomo runtime reports degraded when no sidecar is configured', () => {
  const previous = process.env.PM_MIHOMO_BIN;
  delete process.env.PM_MIHOMO_BIN;
  setRuntimeKind('mihomo');
  const status = getRuntimeStatus();
  assert.equal(status.kind, 'mihomo');
  assert.equal(status.lifecycle, 'degraded');
  assert.equal(status.capabilities.mihomo, false);
  if (previous) process.env.PM_MIHOMO_BIN = previous;
  else delete process.env.PM_MIHOMO_BIN;
  setRuntimeKind('builtin');
});

test('DNS probe accepts successful responses and rejects mismatched or failed responses', () => {
  const id = 0x1234;
  assert.equal(dnsResponseMatches(Buffer.from([0x12, 0x34, 0x81, 0, 0, 1, 0, 1, 0, 0, 0, 0]), id), true);
  assert.equal(dnsResponseMatches(Buffer.from([0x12, 0x35, 0x81, 0, 0, 1, 0, 1, 0, 0, 0, 0]), id), false);
  assert.equal(dnsResponseMatches(Buffer.from([0x12, 0x34, 0x81, 3, 0, 1, 0, 0, 0, 0, 0, 0]), id), false);
});
