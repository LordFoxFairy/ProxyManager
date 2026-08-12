import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMihomoConfig, validateMihomoConfig } from './mihomo.js';
import type { RuntimeConfig } from './runtime.js';

const config: RuntimeConfig = {
  mode: 'rule', mixedPort: 7899, httpPort: 7897, socksPort: 7898,
  systemProxy: false, tun: false, dns: false,
};

test('builds a conservative mihomo config with loopback controller', () => {
  const built = buildMihomoConfig(config, undefined, undefined, [{ addr: '127.0.0.1:8080', scheme: 'http', score: 100, anonymity: null, country: 'US', exit_ip: null, https: 1, latency_ms: 10, ok_count: 1, fail_count: 0, source: 'test', checked_at: Date.now(), added_at: Date.now() }]);
  assert.equal(built['mixed-port'], 7899);
  assert.equal(built['allow-lan'], false);
  assert.equal(built['external-controller'], '127.0.0.1:9090');
  assert.equal(built.proxies.length, 1);
  assert.equal(built['proxy-groups'][0].proxies[0], 'POOL-1-US');
  assert.deepEqual(built.rules, ['MATCH,PROXY']);
});

test('rejects duplicate runtime ports before starting mihomo', () => {
  assert.deepEqual(validateMihomoConfig({ ...config, socksPort: config.mixedPort }), ['mixed/http/socks 端口不能重复']);
});
