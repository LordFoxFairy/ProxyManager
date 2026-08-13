import assert from 'node:assert/strict';
import test from 'node:test';
import { listGroups, removeGroup, upsertGroup } from './groups.js';

test('default groups exist and custom groups persist', () => {
  assert.equal(listGroups().some((group) => group.id === 'proxy'), true);
  const group = upsertGroup({ id: 'us-auto', name: '美国自动', kind: 'url-test', members: ['DIRECT'], interval: 10 });
  assert.equal(group.interval, 30);
  assert.equal(listGroups().some((item) => item.id === 'us-auto'), true);
  assert.equal(removeGroup('us-auto'), true);
});

test('base PROXY group cannot be removed', () => { assert.equal(removeGroup('proxy'), false); });
