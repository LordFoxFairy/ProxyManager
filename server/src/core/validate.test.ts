import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { isCatastrophicValidationFailure, tcpProbe } from './validate.js';

test('TCP probe quickly separates reachable and closed endpoints', async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const target = `127.0.0.1:${address.port}`;
  assert.equal(await tcpProbe(target, 200), true);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.equal(await tcpProbe(target, 200), false);
});

test('validation circuit breaker catches abnormal bulk failures', () => {
  assert.equal(isCatastrophicValidationFailure(49, 0), false);
  assert.equal(isCatastrophicValidationFailure(50, 0), true);
  assert.equal(isCatastrophicValidationFailure(500, 2), true);
});

test('validation circuit breaker allows plausible low-yield runs', () => {
  assert.equal(isCatastrophicValidationFailure(50, 1), false);
  assert.equal(isCatastrophicValidationFailure(500, 3), false);
  assert.equal(isCatastrophicValidationFailure(1_500, 100), false);
});
