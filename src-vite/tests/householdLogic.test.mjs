import test from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutGenerations,
  relationCandidates,
  edgeDraft,
  unjoinedNames,
  rootBadgeVisible,
  personTerm,
} from '../src/common/householdLogic.js';

// The stand-in family the design documents use.
const nodes = [
  { id: 1, gender: 'male' },
  { id: 2, gender: 'female' },
  { id: 3, gender: 'male' },
  { id: 4, gender: 'female' },
  { id: 5, gender: 'male' },
];

const edge = (kind, fromNode, toNode, label = null) => ({ kind, fromNode, toNode, label });

test('no links put everyone on one row', () => {
    const layout = layoutGenerations(nodes, []);
    assert.equal(layout.generations.length, 1);
    assert.deepEqual(layout.generations[0].sort(), [1, 2, 3, 4, 5]);
});

test('a parent stands one generation above the child', () => {
    const layout = layoutGenerations(nodes, [edge('parent', 1, 5)]);
    const rowOf = (id) => layout.generations.findIndex((row) => row.includes(id));
    assert.equal(rowOf(1), rowOf(5) - 1);
});

test('grandparents stand above grandparents through the whole line', () => {
    const layout = layoutGenerations(nodes, [
        edge('parent', 1, 3),
        edge('parent', 3, 5),
    ]);
    const rowOf = (id) => layout.generations.findIndex((row) => row.includes(id));
    assert.equal(rowOf(3), rowOf(5) - 1);
    assert.equal(rowOf(1), rowOf(3) - 1);
});

test('a spouse shares the row of the partner', () => {
    const layout = layoutGenerations(nodes, [edge('spouse', 1, 2)]);
    const rowOf = (id) => layout.generations.findIndex((row) => row.includes(id));
    assert.equal(rowOf(1), rowOf(2));
});

test('a spouse follows the row the marriage puts them in', () => {
    // 3 is the child of 1; 4 is married to 3, so 4 stands with 3.
    const layout = layoutGenerations(nodes, [
        edge('parent', 1, 3),
        edge('spouse', 3, 4),
    ]);
    const rowOf = (id) => layout.generations.findIndex((row) => row.includes(id));
    assert.equal(rowOf(4), rowOf(3));
});

test('a social link does not move anybody', () => {
    const onlySocial = layoutGenerations(nodes, [edge('social', 1, 5, 'classmate')]);
    assert.equal(onlySocial.generations.length, 1);

    // Adding a classmate to a family changes no row of the family.
    const family = [edge('parent', 1, 3)];
    const before = layoutGenerations(nodes, family).rowOf;
    const after = layoutGenerations(nodes, [...family, edge('social', 3, 5, 'classmate')]).rowOf;
    for (const id of [1, 2, 3, 4, 5]) {
        assert.equal(after.get(id), before.get(id), `person ${id} moved`);
    }
});

test('everybody appears exactly once', () => {
    const layout = layoutGenerations(nodes, [
        edge('parent', 1, 3),
        edge('parent', 2, 3),
        edge('spouse', 1, 2),
        edge('social', 4, 5, 'friend'),
    ]);
    const flat = layout.generations.flat().sort((a, b) => a - b);
    assert.deepEqual(flat, [1, 2, 3, 4, 5]);
});

test('the layout names the rows it gave each person', () => {
    const layout = layoutGenerations(nodes, [edge('parent', 1, 3)]);
    assert.equal(layout.rowOf.get(1), 0);
    assert.equal(layout.rowOf.get(3), 1);
});

test('the candidates to link are the members, minus the person, minus the ones already linked', () => {
    const people = [
        { id: 1, name: '小明' },
        { id: 2, name: '小红' },
        { id: 3, name: '小小' },
        { id: 4, name: '路人' },
    ];
    const candidates = relationCandidates(people, [1, 2, 3], {
        excludeIds: [1],
        linkedIds: [2],
    });
    assert.deepEqual(candidates.map((person) => person.id), [3]);
});

test('the candidates follow the search text whatever the case', () => {
    const people = [
        { id: 1, name: 'Ann' },
        { id: 2, name: 'anna' },
        { id: 3, name: 'Bob' },
    ];
    const candidates = relationCandidates(people, [1, 2, 3], { query: 'ANN' });
    assert.deepEqual(candidates.map((person) => person.id), [1, 2]);
});

test('a link draft keeps the direction the catalog gives it', () => {
    const draft = edgeDraft('parent', 5, 1);
    assert.deepEqual(
        { kind: draft.kind, fromNode: draft.fromNode, toNode: draft.toNode, source: draft.source },
        { kind: 'parent', fromNode: 5, toNode: 1, source: 'user' },
    );
});

test('a social draft needs its label, and a teacher keeps its direction', () => {
    const classmate = edgeDraft('social', 3, 5, 'classmate');
    assert.equal(classmate.label, 'classmate');
    const teacher = edgeDraft('social', 3, 5, 'teacher');
    assert.deepEqual([teacher.fromNode, teacher.toNode], [3, 5]);
});

test('the names that could join a graph are the ones nobody brought in yet', () => {
    const names = [
        { name: '小明', count: 3, imported: true },
        { name: '小红', count: 2, imported: false },
        { name: 'Person 9', count: 1, imported: false },
    ];
    const taken = new Set(['小明']);
    const unjoined = unjoinedNames(names, taken);
    assert.deepEqual(unjoined.map((entry) => entry.name), ['小红']);
});

test('only the root of a graph carries a badge in the sidebar', () => {
    assert.equal(rootBadgeVisible(3, 3), true);
    assert.equal(rootBadgeVisible(1, 3), false);
    assert.equal(rootBadgeVisible(1, null), false);
    assert.equal(rootBadgeVisible(null, 3), false);
});

test('a person shows the word the graph gives them, and the root shows none', () => {
    const overview = {
        households: [{ id: 7, rootNodeId: 3 }],
        nodes: [
            { id: 3, term: null },
            { id: 5, term: '儿子' },
        ],
    };
    assert.equal(personTerm(overview, 5), '儿子');
    assert.equal(personTerm(overview, 3), null);
    assert.equal(personTerm(overview, 99), null);
    assert.equal(personTerm(null, 5), null);
});
