import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PM_DB = join(mkdtempSync(join(tmpdir(), 'pm-bundle-')), 'bundle.db');
const store = await import('./store.js');
const bundle = await import('./config-bundle.js');
const providers = await import('./providers.js');
const rules = await import('./rules.js');
store.init();

test('config bundle round-trips policies and replaces removed entries', () => {
  providers.upsertProvider({ id: 'keep', name: 'Keep', kind: 'fixed', nodes: [{ name: 'node', type: 'http', server: '127.0.0.1', port: 8080 }] });
  providers.upsertProvider({ id: 'remove', name: 'Remove', kind: 'fixed' });
  rules.upsertRule({ id: 'rule-a', kind: 'DOMAIN-SUFFIX', value: 'example.com', target: 'PROXY' });
  const exported = bundle.exportConfigBundle();
  const trimmed = { ...exported, providers: exported.providers.filter((item) => item.id !== 'remove'), rules: [] };
  bundle.importConfigBundle(trimmed);
  assert.deepEqual(providers.listProviders().map((item) => item.id), ['keep']);
  assert.deepEqual(rules.listRules(), []);
});

test('legacy bundle without optional policy fields remains importable', () => {
  const current = bundle.exportConfigBundle();
  const legacy = { ...current } as Record<string, unknown>;
  delete legacy.automation;
  delete legacy.routing;
  delete legacy.ruleProviderSnapshots;
  assert.doesNotThrow(() => bundle.importConfigBundle(legacy));
});

test('config bundle restores rule provider snapshots and removes stale snapshots', () => {
  rules.upsertRuleProvider({ id: 'rules-a', name: 'A', url: 'https://example.test/a', behavior: 'domain' });
  rules.upsertRuleProvider({ id: 'rules-b', name: 'B', url: 'https://example.test/b', behavior: 'domain' });
  rules.replaceRuleProviderSnapshots({ 'rules-a': 'a.example', 'rules-b': 'b.example' });
  const exported = bundle.exportConfigBundle();
  assert.deepEqual(exported.ruleProviderSnapshots, { 'rules-a': 'a.example', 'rules-b': 'b.example' });

  const trimmed = { ...exported, ruleProviders: exported.ruleProviders.filter((item) => item.id === 'rules-a'), ruleProviderSnapshots: { 'rules-a': 'restored.example' } };
  bundle.importConfigBundle(trimmed);
  assert.deepEqual(rules.listRuleProviderSnapshots(), { 'rules-a': 'restored.example' });
});
