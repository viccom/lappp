import test from 'node:test';
import assert from 'node:assert/strict';
import {
  edgeDraft,
  rootBadgeVisible,
  personTerm,
} from '../src/common/householdLogic.js';

test('a link draft keeps the direction the catalog gives it', () => {
    const draft = edgeDraft('parent', 5, 1);
    assert.deepEqual(
        { kind: draft.kind, fromNode: draft.fromNode, toNode: draft.toNode, source: draft.source },
        { kind: 'parent', fromNode: 5, toNode: 1, source: 'user' },
    );
});

test('a social draft needs its label, and a teacher keeps their direction', () => {
    const classmate = edgeDraft('social', 3, 5, 'classmate');
    assert.equal(classmate.label, 'classmate');
    const teacher = edgeDraft('social', 3, 5, 'teacher');
    assert.deepEqual([teacher.fromNode, teacher.toNode], [3, 5]);
    // Without a label the field is empty, not the string "undefined".
    assert.equal(edgeDraft('spouse', 3, 5).label, null);
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
