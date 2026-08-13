import assert from 'node:assert/strict';
import test from 'node:test';
import { listProviders, providerNodes, removeProvider, upsertProvider, refreshProvider } from './providers.js';

test('provider catalog persists fixed nodes and exposes enabled nodes', () => {
  const provider = upsertProvider({ id: 'test-fixed', name: 'Test ISP', kind: 'fixed', nodes: [{ name: 'ISP US', type: 'http', server: '127.0.0.1', port: 8080 }] });
  assert.equal(provider.nodes.length, 1);
  assert.equal(providerNodes().some((node) => node.name === 'ISP US'), true);
  assert.equal(listProviders().some((item) => item.id === 'test-fixed'), true);
  assert.equal(removeProvider('test-fixed'), true);
});

test('provider updates preserve refreshed metadata', () => {
  const provider = upsertProvider({ id: 'test-refresh', name: 'Refresh', kind: 'subscription', updatedAt: 123, lastError: null });
  assert.equal(provider.updatedAt, 123);
  assert.equal(upsertProvider({ id: 'test-refresh', updatedAt: 456, lastError: 'network' }).updatedAt, 456);
  assert.equal(upsertProvider({ id: 'test-refresh', updatedAt: 456, lastError: 'network' }).lastError, 'network');
  removeProvider('test-refresh');
});

test('provider nodes reject invalid protocols and ports', () => {
  const provider = upsertProvider({ id: 'invalid-nodes', kind: 'fixed', nodes: [
    { name: 'bad-port', type: 'http', server: '127.0.0.1', port: 0 },
    { name: 'bad-type', type: 'socks4', server: '127.0.0.1', port: 8080 },
    { name: 'valid', type: 'socks5', server: '127.0.0.1', port: 8080 },
  ] });
  assert.deepEqual(provider.nodes.map((node) => node.name), ['valid']);
  removeProvider('invalid-nodes');
});

test('provider catalog preserves common Clash outbound protocols', () => {
  const provider = upsertProvider({ id: 'protocols', kind: 'subscription', nodes: [
    { name: 'ss', type: 'ss', server: 'ss.example', port: 443, cipher: 'aes-128-gcm', password: 'secret' },
    { name: 'vmess', type: 'vmess', server: 'vmess.example', port: 443, uuid: 'UUID' },
    { name: 'vless', type: 'vless', server: 'vless.example', port: 443, uuid: 'UUID' },
    { name: 'trojan', type: 'trojan', server: 'trojan.example', port: 443, password: 'secret' },
    { name: 'hysteria', type: 'hysteria2', server: 'h.example', port: 443, password: 'secret' },
    { name: 'tuic', type: 'tuic', server: 'tuic.example', port: 443, uuid: 'UUID' },
    { name: 'wireguard', type: 'wireguard', server: 'wg.example', port: 51820 },
  ] });
  assert.deepEqual(provider.nodes.map((node) => node.type), ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard']);
  removeProvider('protocols');
});

test('provider YAML nodes preserve transport and TLS fields', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(`proxies:\n  - name: VLESS US\n    type: vless\n    server: edge.example\n    port: 443\n    uuid: UUID\n    tls: true\n    network: ws\n    ws-opts: /ignored\n`)) as typeof fetch;
  try {
    const provider = upsertProvider({ id: 'yaml-fields', kind: 'subscription', url: 'https://example.test/sub' });
    const refreshed = await refreshProvider(provider.id);
    assert.equal(refreshed.nodes[0]?.type, 'vless');
    assert.equal(refreshed.nodes[0]?.uuid, 'UUID');
    assert.equal(refreshed.nodes[0]?.tls, true);
    assert.equal(refreshed.nodes[0]?.network, 'ws');
  } finally {
    globalThis.fetch = originalFetch;
    removeProvider('yaml-fields');
  }
});
