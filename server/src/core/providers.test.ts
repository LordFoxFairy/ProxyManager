import assert from 'node:assert/strict';
import test from 'node:test';
import { listProviders, providerNodes, removeProvider, upsertProvider } from './providers.js';

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
