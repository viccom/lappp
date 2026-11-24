import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_GAP,
  SOCIAL_LABELS,
  birthYearOf,
  edgePayload,
  facesOutsideGraph,
  groupLinks,
  layoutPositions,
  linkGroupOf,
  makeLink,
  nodeWithDetails,
  socialWord,
} from '../src/common/householdGraph.js';

const edge = (kind, fromNode, toNode, label = null) => ({ kind, fromNode, toNode, label });

/** What the page sends for a link: every field, the ones it leaves out included. */
const draft = (kind, fromNode, toNode, label = null) => ({
  kind, fromNode, toNode, label, termOverride: null, validFrom: null, validTo: null, source: 'user',
});

test('a child stands under the middle of the parents', () => {
  const nodes = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const { pos } = layoutPositions(nodes, [edge('parent', 1, 3), edge('parent', 2, 3)]);
  const [father, mother, child] = [pos.get(1), pos.get(2), pos.get(3)];
  assert.equal(father.row, 0);
  assert.equal(child.row, 1);
  assert.equal(child.x, Math.round((father.x + mother.x) / 2));
});

test('spouses stand next to each other and are not pushed apart by others', () => {
  const nodes = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const { pos } = layoutPositions(nodes, [edge('spouse', 1, 2), edge('parent', 1, 3), edge('spouse', 3, 4)]);
  const [father, mother, child, partner] = [pos.get(1), pos.get(2), pos.get(3), pos.get(4)];
  assert.equal(Math.abs(father.x - mother.x), LAYOUT_GAP);
  assert.equal(Math.abs(child.x - partner.x), LAYOUT_GAP);
  // The pair of the child stands under the pair of the parents.
  const middle = (pair) => (pair[0].x + pair[1].x) / 2;
  assert.equal(middle([child, partner]), middle([father, mother]));
});

test('two people never share a place', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));
  const edges = [
    edge('parent', 1, 5), edge('parent', 2, 5),
    edge('parent', 3, 6), edge('parent', 4, 6),
    edge('spouse', 5, 6), edge('parent', 5, 7), edge('parent', 5, 8),
    edge('parent', 5, 9), edge('parent', 5, 10), edge('parent', 6, 11), edge('parent', 6, 12),
  ];
  const { pos } = layoutPositions(nodes, edges);
  const byRow = new Map();
  for (const [id, place] of pos) {
    if (!byRow.has(place.row)) byRow.set(place.row, []);
    byRow.get(place.row).push(place.x);
  }
  for (const xs of byRow.values()) {
    assert.equal(new Set(xs).size, xs.length, `two people share a place: ${xs}`);
    const sorted = [...xs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok(sorted[i] - sorted[i - 1] >= LAYOUT_GAP, `rows are closer than a gap: ${sorted}`);
    }
  }
});

test('a social link moves nobody', () => {
  const nodes = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const family = [edge('parent', 1, 3)];
  const before = layoutPositions(nodes, family).pos;
  const after = layoutPositions(nodes, [...family, edge('social', 2, 3, 'classmate')]).pos;
  assert.deepEqual([...after.entries()].map(([id, p]) => [id, p.row, p.x]), [...before.entries()].map(([id, p]) => [id, p.row, p.x]));
});

test('the parents of a person are the links that point at them, the children the ones that leave', () => {
  const parent = edge('parent', 1, 3);
  assert.equal(linkGroupOf(parent, 3), 'parents');
  assert.equal(linkGroupOf(parent, 1), 'children');
  assert.equal(linkGroupOf(edge('spouse', 1, 2), 2), 'spouse');
  assert.equal(linkGroupOf(edge('social', 2, 3, 'friend'), 3), 'social');
  assert.equal(linkGroupOf(parent, 2), null);
});

test('the links of a person come in four groups, each naming the other person', () => {
  const groups = groupLinks(
    [
      edge('parent', 1, 3), edge('parent', 2, 3), edge('parent', 3, 4),
      edge('spouse', 1, 2), edge('social', 3, 5, 'teacher'), edge('social', 5, 6, 'teacher'),
    ],
    3,
  );
  const others = (kind) => groups.find((group) => group.kind === kind).links.map((link) => link.otherId);
  assert.deepEqual(others('parents'), [1, 2]);
  assert.deepEqual(others('children'), [4]);
  assert.deepEqual(others('spouse'), []);
  // 3 teaches 5. That 5 teaches 6 is not a link of 3 at all.
  assert.deepEqual(others('social'), [5]);
  assert.equal(groups.find((group) => group.kind === 'social').links[0].word, 'student');
});

test('a teacher link reads as a student for the teacher and as a teacher for the student', () => {
  const taught = edge('social', 3, 5, 'teacher');
  assert.equal(socialWord(taught, 3), 'student');
  assert.equal(socialWord(taught, 5), 'teacher');
  assert.equal(socialWord(edge('social', 3, 5, 'classmate'), 3), 'classmate');
});

test('the groups come with the keys of their names', () => {
  const groups = groupLinks([], 1);
  assert.deepEqual(groups.map((group) => group.labelKey), [
    'household.parents', 'household.children', 'household.spouse', 'household.social',
  ]);
});

test('a new link is written the way the library stores it', () => {
  assert.deepEqual(makeLink('parents', 3, 1), draft('parent', 1, 3));
  assert.deepEqual(makeLink('children', 3, 4), draft('parent', 3, 4));
  assert.deepEqual(makeLink('spouse', 3, 4), draft('spouse', 3, 4));
  assert.deepEqual(makeLink('social', 3, 4, 'classmate'), draft('social', 3, 4, 'classmate'));
  // "Student" is the teacher link seen from the other end.
  assert.deepEqual(makeLink('social', 3, 4, 'student'), draft('social', 4, 3, 'teacher'));
  assert.equal(makeLink('cousin', 3, 4), null);
});

test('every social label the interface offers can be written', () => {
  for (const label of SOCIAL_LABELS) {
    assert.ok(makeLink('social', 1, 2, label), label);
  }
});

test('a link goes back to the library with every field, the ones it does not have included', () => {
  assert.deepEqual(edgePayload(edge('social', 4, 3, 'teacher')), {
    kind: 'social', fromNode: 4, toNode: 3, label: 'teacher',
    termOverride: null, validFrom: null, validTo: null, source: 'user',
  });
  assert.equal(edgePayload({ ...edge('parent', 1, 2), source: 'imported', validFrom: 2015 }).source, 'imported');
  assert.equal(edgePayload({ ...edge('parent', 1, 2), validFrom: 2015 }).validFrom, 2015);
});

test('the year of birth is read from the front of the date', () => {
  assert.equal(birthYearOf('2011'), 2011);
  assert.equal(birthYearOf('2011-05-07'), 2011);
  assert.equal(birthYearOf(''), null);
  assert.equal(birthYearOf(null), null);
  assert.equal(birthYearOf('spring 2011'), null);
});

test('changing the gender or the year keeps everything else about the person', () => {
  const node = {
    id: 7, kind: 'person', displayName: '张小满', gender: 'unknown', birthDate: null,
    birthPlace: '大屯', notes: '爱做饭', shareAge: true, shareDetails: true, anchors: ['张小满', '满满'],
  };
  const written = nodeWithDetails(node, { gender: 'male', birthYear: 2011 });
  assert.equal(written.gender, 'male');
  assert.equal(written.birthDate, '2011');
  assert.equal(written.birthPlace, '大屯');
  assert.equal(written.notes, '爱做饭');
  assert.equal(written.shareDetails, true);
  assert.deepEqual(written.anchors, ['张小满', '满满']);
  // Taking the year away writes nothing, not the string "null".
  assert.equal(nodeWithDetails(node, { gender: 'male', birthYear: null }).birthDate, null);
});

test('the faces that could join are the ones without a person, and the people outside this graph', () => {
  const faces = [
    { name: '张伟', count: 4 }, { name: '李静', count: 3 }, { name: '张小满', count: 9 }, { name: 'Person 12', count: 46 },
  ];
  const nodes = [
    { id: 1, anchors: ['张伟'] }, { id: 2, anchors: ['李静', '静静'] },
  ];
  // 张伟 and 李静 are people already; 张伟 is in the graph, 李静 is not; 张小满 is nobody yet.
  const outside = facesOutsideGraph(faces, nodes, [1]);
  assert.deepEqual(outside.map((entry) => [entry.name, entry.nodeId]), [['李静', 2], ['张小满', null]]);
});

test('no graph, no faces and no nodes are all allowed', () => {
  assert.deepEqual(facesOutsideGraph(undefined, undefined, undefined), []);
  assert.deepEqual(facesOutsideGraph([{ name: '张伟' }], undefined, undefined).map((e) => e.name), ['张伟']);
});
