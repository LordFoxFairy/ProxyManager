import assert from 'node:assert/strict';
import test from 'node:test';
import { JobOrchestrator } from './job-orchestrator.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test('collection and validation can run concurrently', async () => {
  const collection = deferred();
  const validation = deferred();
  const jobs = new JobOrchestrator({
    collect: () => collection.promise,
    validate: () => validation.promise,
    sourceStatuses: () => [{ name: 'source-a', enabled: true }],
  });

  const collecting = jobs.startCollection(undefined, true)!;
  const validating = jobs.startValidation(100)!;
  assert.equal(jobs.snapshot().collection.running, true);
  assert.equal(jobs.snapshot().validation.running, true);

  collection.resolve();
  validation.resolve();
  await Promise.all([collecting, validating]);
});

test('different sources can run while the same source conflicts', async () => {
  const tasks = new Map<string, ReturnType<typeof deferred>>();
  const jobs = new JobOrchestrator({
    collect: (_log, sources = []) => {
      const task = deferred();
      tasks.set(sources[0]!, task);
      return task.promise;
    },
    validate: async () => {},
    sourceStatuses: () => [
      { name: 'source-a', enabled: true },
      { name: 'source-b', enabled: true },
    ],
  });

  const first = jobs.startCollection(['source-a'])!;
  assert.equal(jobs.startCollection(['source-a']), null);
  const second = jobs.startCollection(['source-b'])!;
  assert.deepEqual(new Set(jobs.snapshot().collection.sources), new Set(['source-a', 'source-b']));

  tasks.get('source-a')!.resolve();
  tasks.get('source-b')!.resolve();
  await Promise.all([first, second]);
});

test('duplicate validation conflicts without blocking collection', async () => {
  const validation = deferred();
  const jobs = new JobOrchestrator({
    collect: async () => {},
    validate: () => validation.promise,
    sourceStatuses: () => [{ name: 'source-a', enabled: true }],
  });

  const running = jobs.startValidation(100)!;
  assert.equal(jobs.startValidation(100), null);
  await jobs.startCollection(['source-a']);
  assert.equal(jobs.snapshot().validation.running, true);

  validation.resolve();
  await running;
});
