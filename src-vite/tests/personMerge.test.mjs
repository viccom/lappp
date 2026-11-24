import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAutoPersonName,
  mergeTargets,
  mergeConfirmParams,
  pushMergeRecord,
  remapPersonRules,
} from '../src/common/personMerge.js';

// Names here are the stand-ins the design documents use.
const people = [
  { id: 1, name: '王秀兰', count: 6 },
  { id: 2, name: '李静', count: 107 },
  { id: 3, name: 'Person 46', count: 46 },
  { id: 4, name: null, count: 2 },
  { id: 5, name: '张伟', count: 878 },
  { id: 6, name: 'Ann', count: 3 },
];

test('isAutoPersonName: a missing, empty or automatic name is not one the user gave', () => {
  assert.equal(isAutoPersonName(null), true);
  assert.equal(isAutoPersonName(undefined), true);
  assert.equal(isAutoPersonName(''), true);
  assert.equal(isAutoPersonName('   '), true);
  assert.equal(isAutoPersonName('Person 46'), true);
  assert.equal(isAutoPersonName('person 7'), true);
  assert.equal(isAutoPersonName('Person '), true);
});

test('isAutoPersonName: a name the user typed stays theirs', () => {
  assert.equal(isAutoPersonName('张伟'), false);
  assert.equal(isAutoPersonName('Personal friend'), false);
  assert.equal(isAutoPersonName('Ann'), false);
});

test('mergeTargets offers only people the user named, never the rows being merged', () => {
  const targets = mergeTargets(people, { excludeIds: [5, 5], query: '' });
  assert.deepEqual(targets.map((person) => person.id).sort(), [1, 2, 6]);
  assert.deepEqual(mergeTargets(people).map((person) => person.id).sort(), [1, 2, 5, 6]);
});

test('mergeTargets lists people by name', () => {
  const named = [{ id: 1, name: 'Carol' }, { id: 2, name: 'alice' }, { id: 3, name: 'Bob' }];
  assert.deepEqual(mergeTargets(named).map((person) => person.id), [2, 3, 1]);
});

test('mergeTargets finds a name by any part of it, whatever the case', () => {
  assert.deepEqual(mergeTargets(people, { query: 'ANN' }).map((person) => person.id), [6]);
  assert.deepEqual(mergeTargets(people, { query: ' 秀 ' }).map((person) => person.id), [1]);
});

test('mergeTargets leaves what it was given alone and copes with nothing to offer', () => {
  const before = JSON.stringify(people);
  mergeTargets(people, { excludeIds: [1], query: '' });
  assert.equal(JSON.stringify(people), before);
  assert.deepEqual(mergeTargets([], { query: '' }), []);
  assert.deepEqual(mergeTargets(undefined), []);
  assert.deepEqual(mergeTargets(people, { excludeIds: [1, 2, 5, 6] }), []);
});

test('mergeConfirmParams counts the rows and the faces that will move', () => {
  const params = mergeConfirmParams([{ id: 3, count: 46 }, { id: 4 }], { name: '张伟' });
  assert.deepEqual(params, { count: 2, faces: 46, name: '张伟' });
});

test('mergeConfirmParams treats a missing or unusable face count as zero', () => {
  const sources = [{ count: '12' }, { count: null }, { count: -3 }, {}];
  assert.equal(mergeConfirmParams(sources, { name: 'Ann' }).faces, 0);
});

const link = (n) => ({ targetId: 1, targetName: 'Ann', faceIds: [n], at: n });

test('pushMergeRecord puts the newest link first and returns a new list', () => {
  const before = [link(1), link(2)];
  const after = pushMergeRecord(before, link(3));
  assert.deepEqual(after.map((record) => record.at), [3, 1, 2]);
  assert.equal(before.length, 2);
});

test('pushMergeRecord keeps at most twenty links and drops the oldest', () => {
  let records = [];
  for (let n = 1; n <= 25; n++) records = pushMergeRecord(records, link(n));
  assert.equal(records.length, 20);
  assert.equal(records[0].at, 25);
  assert.equal(records.at(-1).at, 6);
});

test('pushMergeRecord honours a smaller cap', () => {
  assert.deepEqual(pushMergeRecord([link(1)], link(2), 1).map((record) => record.at), [2]);
});

test('pushMergeRecord starts from nothing', () => {
  assert.deepEqual(pushMergeRecord(undefined, link(1)), [link(1)]);
  assert.deepEqual(pushMergeRecord(null, link(1)), [link(1)]);
});

test('pushMergeRecord ignores a record that could not be undone from', () => {
  const before = [link(1)];
  assert.equal(pushMergeRecord(before, null), before);
  assert.equal(pushMergeRecord(before, { targetName: 'Ann', faceIds: [] }), before);
  assert.equal(pushMergeRecord(before, { faceIds: [1] }), before);
  assert.equal(pushMergeRecord(before, { targetName: 'Ann', faceIds: 'abc' }), before);
});

const albums = () => [
  {
    id: 'a', name: '张伟',
    query: { version: 1, match: 'all', rules: [{ id: 'r1', field: 'person', operator: 'has', value: 3 }] },
  },
  {
    id: 'b', name: '混合',
    query: { version: 1, match: 'any', rules: [
      { id: 'r2', field: 'tag', operator: 'has', value: 9 },
      { id: 'r3', field: 'person', operator: 'not_has', value: 7 },
      { id: 'r4', field: 'person', operator: 'has', value: 5 },
    ] },
  },
  {
    id: 'c', name: '收藏',
    query: { version: 1, match: 'all', rules: [{ id: 'r5', field: 'favorite', operator: 'is', value: 1 }] },
  },
  { id: 'd', name: '无规则', query: { version: 1, match: 'all', rules: [] } },
];

test('remapPersonRules points the rules of merged rows at the surviving person', () => {
  const after = remapPersonRules(albums(), [3, 5], 2);
  assert.equal(after[0].query.rules[0].value, 2);
  assert.deepEqual(after[1].query.rules.map((rule) => [rule.field, rule.value]), [['tag', 9], ['person', 7], ['person', 2]]);
});

test('remapPersonRules leaves everything else as it was, including the input', () => {
  const before = albums();
  const after = remapPersonRules(before, [3, 5], 2);
  assert.equal(after[2], before[2]);
  assert.equal(after[3], before[3]);
  assert.equal(before[0].query.rules[0].value, 3);
  assert.equal(after[1].query.rules[0], before[1].query.rules[0]);
  assert.equal(after[0].name, '张伟');
  assert.equal(after[0].query.match, 'all');
});

test('remapPersonRules gives back the same list when no rule points at a merged row', () => {
  const before = albums();
  assert.equal(remapPersonRules(before, [99], 2), before);
  assert.equal(remapPersonRules(before, [], 2), before);
});

test('remapPersonRules copes with albums that carry no rules', () => {
  const odd = [{ id: 'x' }, { id: 'y', query: {} }, null];
  assert.deepEqual(remapPersonRules(odd, [3], 2), odd);
  assert.deepEqual(remapPersonRules(undefined, [3], 2), undefined);
});
