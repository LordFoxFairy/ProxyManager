import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceForHost } from './services.js';

test('service profiles resolve application domains and subdomains', () => {
  assert.equal(serviceForHost('api.openai.com')?.id, 'openai');
  assert.equal(serviceForHost('chatgpt.com')?.id, 'openai');
  assert.equal(serviceForHost('api.anthropic.com')?.id, 'claude-code');
  assert.equal(serviceForHost('raw.githubusercontent.com')?.id, 'github');
  assert.equal(serviceForHost('example.com'), null);
});
