import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PM_DB = join(mkdtempSync(join(tmpdir(), 'pm-rules-')), 'rules.db');
const store = await import('./store.js');
const rules = await import('./rules.js');
store.init();

test('rule hit testing respects order and rule kinds', () => {
  rules.replaceRules([
    { id: 'suffix', kind: 'DOMAIN-SUFFIX', value: 'example.com', target: 'PROXY', enabled: true },
    { id: 'cidr', kind: 'IP-CIDR', value: '10.0.0.0/8', target: 'DIRECT', enabled: true },
    { id: 'process', kind: 'PROCESS-NAME', value: 'Claude.exe', target: 'CLAUDE', enabled: true },
    { id: 'final', kind: 'MATCH', value: '', target: 'FINAL', enabled: true },
  ]);
  assert.equal(rules.testRuleMatch({ kind: 'domain', value: 'api.example.com' }).target, 'PROXY');
  assert.equal(rules.testRuleMatch({ kind: 'ip', value: '10.2.3.4' }).target, 'DIRECT');
  assert.equal(rules.testRuleMatch({ kind: 'process', value: 'claude.exe' }).target, 'CLAUDE');
  assert.equal(rules.testRuleMatch({ kind: 'domain', value: 'unknown.test' }).target, 'FINAL');
});

test('rule hit testing ignores disabled rules', () => {
  rules.replaceRules([{ id: 'disabled', kind: 'DOMAIN', value: 'blocked.test', target: 'REJECT', enabled: false }]);
  const result = rules.testRuleMatch({ kind: 'domain', value: 'blocked.test' });
  assert.equal(result.matched, false);
  assert.equal(result.target, 'PROXY');
});

test('rule hit testing matches IPv6 CIDR', () => {
  rules.replaceRules([{ id: 'v6', kind: 'IP-CIDR6', value: '2001:db8::/32', target: 'V6', enabled: true }]);
  assert.equal(rules.testRuleMatch({ kind: 'ip', value: '2001:db8:1::10' }).target, 'V6');
  assert.equal(rules.testRuleMatch({ kind: 'ip', value: '2001:dead::10' }).matched, false);
});
