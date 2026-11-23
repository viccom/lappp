import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTypecheckResult } from '../../scripts/typecheck-gate-logic.mjs';

const diagnostic = 'src/example.ts :: TS2339 :: Property does not exist';

function evaluate(result, options = {}) {
  return evaluateTypecheckResult({ counts: new Map(), ...result }, options);
}

test('a vue-tsc spawn error fails closed and cannot produce a baseline update', () => {
  const result = evaluate({ status: null, error: new Error('spawn failed') }, { update: true });

  assert.equal(result.ok, false);
  assert.match(result.reason, /failed to start.*spawn failed/);
  assert.equal(result.baselineUpdate, null);
});

test('signal termination fails closed and cannot produce a baseline update', () => {
  const result = evaluate({ status: null, signal: 'SIGTERM' }, { update: true });

  assert.equal(result.ok, false);
  assert.match(result.reason, /signal.*SIGTERM/);
  assert.equal(result.baselineUpdate, null);
});

test('a null exit status fails closed and cannot produce a baseline update', () => {
  const result = evaluate({ status: null }, { update: true });

  assert.equal(result.ok, false);
  assert.match(result.reason, /no exit status/);
  assert.equal(result.baselineUpdate, null);
});

test('a nonzero exit without parseable diagnostics fails closed', () => {
  const result = evaluate({ status: 1 }, { update: true });

  assert.equal(result.ok, false);
  assert.match(result.reason, /without parseable TypeScript diagnostics/);
  assert.equal(result.baselineUpdate, null);
});

test('zero exit with parseable diagnostics is inconsistent and fails closed', () => {
  const result = evaluate({ status: 0, counts: new Map([[diagnostic, 1]]) }, { update: true });

  assert.equal(result.ok, false);
  assert.match(result.reason, /exited successfully.*reported/);
  assert.equal(result.baselineUpdate, null);
});

test('exit status 1 with baseline-covered diagnostics fails and cannot update the baseline', () => {
  const counts = new Map([[diagnostic, 1]]);
  const result = evaluate(
    { status: 1, counts },
    { baselineEntries: { [diagnostic]: 1 } },
  );
  const updateResult = evaluate({ status: 1, counts }, { update: true });

  assert.equal(result.ok, false);
  assert.match(result.reason, /unexpected status 1/);
  assert.equal(result.baselineUpdate, null);
  assert.equal(updateResult.ok, false);
  assert.equal(updateResult.baselineUpdate, null);
});

test('nonzero exit with baseline-covered diagnostics is normal TypeScript behavior', () => {
  const result = evaluate(
    { status: 2, counts: new Map([[diagnostic, 1]]) },
    { baselineEntries: { [diagnostic]: 1 } },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.added, []);
});

test('diagnostics beyond the baseline fail the gate', () => {
  const result = evaluate(
    { status: 2, counts: new Map([[diagnostic, 2]]) },
    { baselineEntries: { [diagnostic]: 1 } },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.added, [`${diagnostic} (+1)`]);
});

test('a valid result can produce a baseline update', () => {
  const result = evaluate({ status: 2, counts: new Map([[diagnostic, 1]]) }, { update: true });

  assert.equal(result.ok, true);
  assert.equal(result.baselineUpdate.total, 1);
  assert.deepEqual(result.baselineUpdate.entries, { [diagnostic]: 1 });
});
