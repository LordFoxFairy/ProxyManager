import assert from 'node:assert/strict';
import test from 'node:test';
import { getRuntimeConfig, getRuntimeStatus, setRuntimeKind, updateRuntimeConfig } from './runtime.js';
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
