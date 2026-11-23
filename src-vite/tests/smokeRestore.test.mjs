import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { resolveRequiredDataDir } from '../../scripts/smoke-config.mjs';
import { createCleanup, createShutdownHandler, restoreAndRebuild } from '../../scripts/restore-clean-build.mjs';

test('smoke data directory must be explicit and is resolved without filesystem access', () => {
  assert.throws(() => resolveRequiredDataDir(undefined), /LAP_SMOKE_DATA_DIR is required/);
  assert.throws(() => resolveRequiredDataDir('  '), /LAP_SMOKE_DATA_DIR is required/);
  assert.throws(() => resolveRequiredDataDir('relative-smoke-data'), /must be an absolute path/);
  assert.equal(resolveRequiredDataDir(resolve('smoke-data')), resolve('smoke-data'));
});

test('concurrent cleanup calls stop the child and restore/rebuild exactly once', async () => {
  const calls = [];
  let finishStop;
  const cleanup = createCleanup({
    stopChild: () => { calls.push('stop'); return new Promise((resolve) => { finishStop = resolve; }); },
    restore: async () => { calls.push('restore'); },
    rebuild: async () => { calls.push('rebuild'); },
  });

  const first = cleanup();
  const second = cleanup();
  assert.equal(first, second);
  finishStop();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['stop', 'restore', 'rebuild']);
});

test('signal shutdown stops, restores, rebuilds once, then exits with its signal code', async () => {
  const calls = [];
  let finishStop;
  const cleanup = createCleanup({
    stopChild: () => { calls.push('stop'); return new Promise((resolve) => { finishStop = resolve; }); },
    restore: async () => { calls.push('restore'); },
    rebuild: async () => { calls.push('rebuild'); },
  });
  const shutdown = createShutdownHandler({
    cleanup,
    exit: (code) => calls.push(`exit:${code}`),
  });

  const first = shutdown('SIGINT', 130);
  const second = shutdown('SIGTERM', 143);
  assert.deepEqual(calls, ['stop']);
  finishStop();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['stop', 'restore', 'rebuild', 'exit:130']);
});

test('signal shutdown preserves an assertion failure after successful cleanup', async () => {
  const calls = [];
  const shutdown = createShutdownHandler({
    cleanup: async () => { calls.push('cleanup'); },
    exit: (code) => calls.push(code),
    getExitCode: () => 1,
  });

  await shutdown('SIGINT', 130);
  assert.deepEqual(calls, ['cleanup', 1]);
});

test('signal shutdown exits 1 when cleanup fails', async () => {
  const calls = [];
  const shutdown = createShutdownHandler({
    cleanup: async () => { throw new Error('restore failed'); },
    exit: (code) => calls.push(code),
    report: () => {},
  });

  await shutdown('SIGTERM', 143);
  assert.deepEqual(calls, [1]);
});

test('a clean rebuild error propagates after config restoration', async () => {
  const calls = [];
  const rebuildError = new Error('cargo build failed');

  await assert.rejects(
    restoreAndRebuild({
      restore: async () => { calls.push('restore'); },
      rebuild: async () => { calls.push('rebuild'); throw rebuildError; },
    }),
    (error) => error.message.includes('clean rebuild failed') && error.cause === rebuildError,
  );
  assert.deepEqual(calls, ['restore', 'rebuild']);
});

test('a restore error is reported without running or claiming a clean rebuild', async () => {
  const calls = [];
  const restoreError = new Error('cannot restore config');

  await assert.rejects(
    restoreAndRebuild({
      restore: async () => { calls.push('restore'); throw restoreError; },
      rebuild: async () => { calls.push('rebuild'); },
    }),
    (error) => error.message.includes('config restoration failed') && error.cause === restoreError,
  );
  assert.deepEqual(calls, ['restore']);
});

test('successful restoration and clean rebuild resolve', async () => {
  const calls = [];

  await assert.doesNotReject(restoreAndRebuild({
    restore: async () => { calls.push('restore'); },
    rebuild: async () => { calls.push('rebuild'); },
  }));
  assert.deepEqual(calls, ['restore', 'rebuild']);
});
