import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConnectivityTargets } from './connectivity.js';

test('normalizes public HTTPS connectivity targets', () => {
  assert.deepEqual(
    normalizeConnectivityTargets([
      { id: 'docs', name: 'Docs', url: 'https://docs.example.com/health#status' },
      { id: 'docs', name: 'Duplicate', url: 'https://example.com/' },
    ]),
    [{ id: 'docs', name: 'Docs', url: 'https://docs.example.com/health' }],
  );
});

test('rejects local, authenticated, non-HTTPS and non-standard-port targets', () => {
  const urls = [
    'http://example.com/',
    'https://localhost/health',
    'https://127.0.0.1/health',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
  ];
  const targets = urls.map((url, index) => ({ id: `bad-${index}`, name: 'Bad', url }));
  assert.deepEqual(normalizeConnectivityTargets(targets), []);
});
