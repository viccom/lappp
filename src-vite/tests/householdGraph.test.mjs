import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeDraft } from '../src/common/householdLogic.js';
import {
  AVATAR_DY,
  AVATAR_R,
  COUPLE_GAP,
  COL_GAP,
  NODE_H,
  NODE_W,
  ROW_GAP,
  birthYearOf,
  drawLines,
  edgePayload,
  facesOutsideGraph,
  fitView,
  groupLinks,
  kinKey,
  layoutTree,
  linkGroupOf,
  makeLink,
  nodeForName,
  nodeWithDetails,
  personIdIn,
  socialWord,
  wouldCloseParentCircle,
} from '../src/common/householdGraph.js';

const edge = (kind, fromNode, toNode, label = null) => ({ kind, fromNode, toNode, label });
const person = (id, extra = {}) => ({ id, ...extra });

/** What the page sends for a link: every field, the ones it leaves out included. */
const draft = (kind, fromNode, toNode, label = null) => ({
  kind, fromNode, toNode, label, termOverride: null, validFrom: null, validTo: null, source: 'user',
});

const xOf = (pos, id) => pos.get(id).x;
const middle = (pos, ...ids) => ids.reduce((sum, id) => sum + xOf(pos, id), 0) / ids.length;

// ---- where everybody stands ----

test('parents stand a generation above their child, spouses beside each other', () => {
  const nodes = [person(1), person(2), person(3)];
  const { pos, rows } = layoutTree(nodes, [edge('spouse', 1, 2), edge('parent', 1, 3), edge('parent', 2, 3)], { rootId: 3 });
  assert.deepEqual(rows, [[1, 2], [3]]);
  assert.equal(pos.get(3).y - pos.get(1).y, ROW_GAP);
  assert.equal(Math.abs(xOf(pos, 2) - xOf(pos, 1)), NODE_W + COUPLE_GAP);
  // The first row is the top of the picture, not the bottom.
  assert.equal(pos.get(1).y, 0);
});

test('a child stands under the middle of the parents', () => {
  const nodes = [person(1), person(2), person(3)];
  const { pos } = layoutTree(nodes, [edge('spouse', 1, 2), edge('parent', 1, 3), edge('parent', 2, 3)], { rootId: 3 });
  assert.ok(Math.abs(xOf(pos, 3) - middle(pos, 1, 2)) <= 1, `${xOf(pos, 3)} is not under ${middle(pos, 1, 2)}`);
});

test('the parents of a spouse stand above the spouse, spread round the couple in the middle', () => {
  // 1 is married to 2; 3 and 4 are the parents of 1, 5 and 6 the parents of 2.
  const nodes = Array.from({ length: 6 }, (_, i) => person(i + 1));
  const links = [
    edge('spouse', 1, 2), edge('spouse', 3, 4), edge('spouse', 5, 6),
    edge('parent', 3, 1), edge('parent', 4, 1), edge('parent', 5, 2), edge('parent', 6, 2),
  ];
  const { pos, rows } = layoutTree(nodes, links, { rootId: 1 });
  assert.deepEqual(rows, [[3, 4, 5, 6], [1, 2]]);
  // Nobody stands on anybody: the two couples are wider than the one below.
  assert.ok(xOf(pos, 5) - xOf(pos, 4) >= NODE_W + COL_GAP);
  // The pair of the parents of 1 is left of the pair of the parents of 2, and each above its own child.
  assert.ok(middle(pos, 3, 4) < xOf(pos, 1));
  assert.ok(middle(pos, 5, 6) > xOf(pos, 2));
  // The give and take is even: the couple below is the middle of the two pairs.
  const between = (middle(pos, 3, 4) + middle(pos, 5, 6)) / 2;
  assert.ok(Math.abs(between - middle(pos, 1, 2)) <= 1);
});

test('siblings stand in the order they were born', () => {
  const nodes = [person(1), person(2), person(3, { birthDate: '2012' }), person(4, { birthDate: '2005' }), person(5, { birthDate: '2009' })];
  const links = [
    edge('spouse', 1, 2),
    edge('parent', 1, 3), edge('parent', 2, 3),
    edge('parent', 1, 4), edge('parent', 2, 4),
    edge('parent', 1, 5), edge('parent', 2, 5),
  ];
  const { pos } = layoutTree(nodes, links, { rootId: 1 });
  assert.ok(xOf(pos, 4) < xOf(pos, 5) && xOf(pos, 5) < xOf(pos, 3));
  // The parents stand over the middle of their children.
  assert.ok(Math.abs(middle(pos, 1, 2) - middle(pos, 4, 5, 3)) <= 1);
});

test('a family of three generations keeps everybody clear of everybody else', () => {
  const nodes = Array.from({ length: 14 }, (_, i) => person(i + 1));
  const links = [
    edge('spouse', 1, 2), edge('parent', 1, 5), edge('parent', 2, 5), edge('parent', 1, 6), edge('parent', 2, 6),
    edge('spouse', 3, 4), edge('parent', 3, 7), edge('parent', 4, 7),
    edge('spouse', 5, 7), edge('parent', 5, 9), edge('parent', 7, 9), edge('parent', 5, 10), edge('parent', 7, 10),
    edge('spouse', 6, 8),
    edge('parent', 11, 1), edge('parent', 12, 1), edge('spouse', 11, 12),
    edge('parent', 13, 3), edge('parent', 14, 3), edge('spouse', 13, 14),
  ];
  const { pos, rows } = layoutTree(nodes, links, { rootId: 5 });
  // 6 is a sibling of the root, married to 8: the row of the root.
  assert.deepEqual(rows.map((row) => [...row].sort((a, b) => a - b)), [[11, 12, 13, 14], [1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]);
  for (const row of rows) {
    const sorted = [...row].sort((a, b) => xOf(pos, a) - xOf(pos, b));
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = xOf(pos, sorted[i]) - xOf(pos, sorted[i - 1]);
      assert.ok(gap >= NODE_W + COL_GAP - 1, `${sorted[i - 1]} and ${sorted[i]} are ${gap} apart`);
    }
  }
});

test('everybody appears once, on a whole number, the same way every time', () => {
  const nodes = Array.from({ length: 9 }, (_, i) => person(i + 1));
  const links = [
    edge('spouse', 1, 2), edge('parent', 1, 3), edge('parent', 2, 3), edge('parent', 1, 4), edge('parent', 2, 4),
    edge('spouse', 3, 5), edge('parent', 3, 6), edge('parent', 5, 6), edge('spouse', 7, 8), edge('parent', 7, 2),
  ];
  const once = [...layoutTree(nodes, links, { rootId: 1 }).pos.entries()];
  const again = [...layoutTree(nodes, links, { rootId: 1 }).pos.entries()];
  assert.deepEqual(once, again);
  assert.deepEqual(once.map(([id]) => id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const [, place] of once) {
    assert.ok([place.x, place.y].every((n) => Number.isInteger(n)), `${place.x}, ${place.y} are not whole numbers`);
  }
});

test('a graph without links puts everybody on one row, spread from the left', () => {
  const { pos, rows } = layoutTree([person(4), person(2), person(7), person(5)], [], { rootId: 5 });
  assert.deepEqual(rows, [[5, 2, 4, 7]]);
  const xs = [...pos.values()].map((place) => place.x).sort((a, b) => a - b);
  assert.deepEqual(xs.slice(1).map((x, i) => x - xs[i]), [NODE_W + COL_GAP, NODE_W + COL_GAP, NODE_W + COL_GAP]);
});

test('a social link keeps the other person in the row of the one it touches, next to them', () => {
  const nodes = [person(1), person(2), person(3)];
  const { pos } = layoutTree(nodes, [edge('parent', 1, 3), edge('social', 3, 2, 'classmate')], { rootId: 3 });
  assert.equal(pos.get(2).row, pos.get(3).row);
  assert.equal(Math.abs(xOf(pos, 2) - xOf(pos, 3)), NODE_W + COL_GAP);
});

test('a classmate stands beside the person they are linked to, on the side the family leaves free', () => {
  // 1 and 2 have two children, 3 and 4; 5 is a classmate of 3, 6 a friend of 4.
  const nodes = Array.from({ length: 6 }, (_, i) => person(i + 1));
  const links = [
    edge('spouse', 1, 2), edge('parent', 1, 3), edge('parent', 2, 3), edge('parent', 1, 4), edge('parent', 2, 4),
    edge('social', 5, 3, 'classmate'), edge('social', 4, 6, 'friend'),
  ];
  const { pos } = layoutTree(nodes, links, { rootId: 3 });
  // The classmate does not stand between the two brothers: the row is 5, 3, 4, 6.
  const row = [...pos.entries()].filter(([, place]) => place.row === pos.get(3).row).sort((a, b) => a[1].x - b[1].x).map(([id]) => id);
  assert.deepEqual(row, [5, 3, 4, 6]);
  assert.equal(Math.abs(xOf(pos, 5) - xOf(pos, 3)), NODE_W + COL_GAP);
  assert.equal(Math.abs(xOf(pos, 6) - xOf(pos, 4)), NODE_W + COL_GAP);
});

test('an empty graph has nothing to place', () => {
  assert.deepEqual(layoutTree([], []).rows, []);
  assert.equal(layoutTree(undefined, undefined).pos.size, 0);
});

test('the picture says how far it reaches', () => {
  const nodes = [person(1), person(2), person(3)];
  const { pos, bounds } = layoutTree(nodes, [edge('spouse', 1, 2), edge('parent', 1, 3), edge('parent', 2, 3)], { rootId: 3 });
  const left = Math.min(...[...pos.values()].map((place) => place.x)) - NODE_W / 2;
  assert.equal(bounds.left, left);
  assert.equal(bounds.right, Math.max(...[...pos.values()].map((place) => place.x)) + NODE_W / 2);
  assert.equal(bounds.top, -NODE_H / 2);
  assert.equal(bounds.bottom, pos.get(3).y + NODE_H / 2);
});

// ---- what is drawn between them ----

const couple = () => {
  const nodes = [person(1), person(2), person(3), person(4)];
  const links = [
    edge('spouse', 1, 2), edge('parent', 1, 3), edge('parent', 2, 3), edge('parent', 1, 4), edge('parent', 2, 4),
  ];
  return { pos: layoutTree(nodes, links, { rootId: 1 }).pos, links };
};

test('a couple is joined by a marriage line between their faces', () => {
  const { pos, links } = couple();
  const { couples } = drawLines(pos, links);
  assert.equal(couples.length, 1);
  const [line] = couples;
  assert.deepEqual([line.a, line.b], [1, 2]);
  // The line is as high as the middle of the faces, and joins what is between them.
  assert.equal(line.y1, pos.get(1).y + AVATAR_DY);
  assert.equal(line.y2, line.y1);
  assert.ok(line.x1 > xOf(pos, 1) && line.x1 < xOf(pos, 2));
  assert.ok(line.x2 > line.x1 && line.x2 < xOf(pos, 2));
  assert.equal(line.ended, false);
});

test('the line to the children starts from the middle of the marriage line and spreads over them', () => {
  const { pos, links } = couple();
  const { families } = drawLines(pos, links);
  assert.equal(families.length, 1);
  const [family] = families;
  assert.deepEqual(family.parents, [1, 2]);
  assert.deepEqual(family.children, [3, 4]);
  assert.deepEqual(family.drops, [{ x: middle(pos, 1, 2), y1: pos.get(1).y + AVATAR_DY, y2: family.bar.y }]);
  // The bar is above the children, and a stub comes down to each.
  assert.ok(family.bar.y < pos.get(3).y - NODE_H / 2);
  assert.equal(family.bar.x1, xOf(pos, 3));
  assert.equal(family.bar.x2, xOf(pos, 4));
  assert.deepEqual(family.stubs.map((stub) => [stub.x, stub.y2]), [[xOf(pos, 3), pos.get(3).y - NODE_H / 2], [xOf(pos, 4), pos.get(4).y - NODE_H / 2]]);
  // Nothing has to be joined under the parents: they stand side by side.
  assert.deepEqual(family.joins, []);
  assert.equal(family.stem, null);
});

test('a parent on their own sends the line down from under their card', () => {
  const nodes = [person(1), person(2), person(3)];
  const links = [edge('spouse', 2, 3), edge('parent', 1, 2)];
  const { pos } = layoutTree(nodes, links, { rootId: 2 });
  const { families } = drawLines(pos, links);
  assert.equal(families.length, 1);
  const [family] = families;
  assert.deepEqual(family.parents, [1]);
  // One child: the line goes straight to the top of the card, no bar.
  assert.deepEqual(family.drops, [{ x: xOf(pos, 1), y1: pos.get(1).y + NODE_H / 2, y2: pos.get(2).y - NODE_H / 2 }]);
  assert.equal(family.bar, null);
  assert.deepEqual(family.stubs, []);
});

test('parents who are not side by side are joined under their cards', () => {
  // 5 and 6 are both parents of 1, but married to other people.
  const nodes = Array.from({ length: 7 }, (_, i) => person(i + 1));
  const links = [
    edge('spouse', 1, 2), edge('spouse', 5, 7), edge('spouse', 6, 3),
    edge('parent', 5, 1), edge('parent', 6, 1),
  ];
  const { pos } = layoutTree(nodes, links, { rootId: 1 });
  const { families } = drawLines(pos, links);
  const family = families.find((entry) => entry.key === '5,6');
  assert.ok(family, 'the two parents are not drawn as one family');
  assert.equal(family.drops.length, 2);
  assert.equal(family.joins.length, 1);
  // The join is under both cards, and the line goes on down from its middle.
  assert.ok(family.joins[0].y > pos.get(5).y + NODE_H / 2);
  assert.equal(family.stem.y1, family.joins[0].y);
  assert.equal(family.stem.x, middle(pos, 5, 6));
});

test('a social link is a curve that keeps clear of the faces, with a place for its word', () => {
  const nodes = [person(1), person(2), person(3)];
  const links = [edge('parent', 1, 3), edge('social', 3, 2, 'classmate')];
  const { pos } = layoutTree(nodes, links, { rootId: 3 });
  const { socials } = drawLines(pos, links);
  assert.equal(socials.length, 1);
  const [line] = socials;
  assert.deepEqual([line.a, line.b, line.label], [3, 2, 'classmate']);
  assert.equal(line.directed, false);
  assert.match(line.d, /^M [\d.-]+ [\d.-]+ Q /);
  // Where it starts is just outside the face of the one end.
  const [sx, sy] = line.d.slice(2).split(' Q ')[0].split(' ').map(Number);
  const reach = Math.hypot(sx - xOf(pos, 3), sy - (pos.get(3).y + AVATAR_DY));
  assert.ok(reach >= AVATAR_R && reach <= AVATAR_R + 8, `the curve starts ${reach} from the middle of the face`);
  // The word goes by the middle of the curve, clear of both faces.
  assert.ok(Math.abs(line.lx - xOf(pos, 3)) > AVATAR_R && Math.abs(line.lx - xOf(pos, 2)) > AVATAR_R);
});

test('a parent who stands lower than the child is joined by a plain line', () => {
  // The library would refuse this; a picture still has to draw it.
  const nodes = [person(1), person(2)];
  const links = [edge('parent', 1, 2)];
  const pos = new Map([[1, { row: 1, x: 0, y: ROW_GAP }], [2, { row: 0, x: 0, y: 0 }]]);
  const { families, others } = drawLines(pos, links);
  assert.equal(families.length, 0);
  assert.equal(others.length, 1);
});

test('a marriage that ended is drawn as ended', () => {
  const nodes = [person(1), person(2)];
  const { pos } = layoutTree(nodes, [edge('spouse', 1, 2)], { rootId: 1 });
  const [line] = drawLines(pos, [{ ...edge('spouse', 1, 2), validTo: 2015 }]).couples;
  assert.equal(line.ended, true);
});

// ---- the view ----

test('the view that shows everything puts it in the middle, and does not blow up a small graph', () => {
  const bounds = { left: 100, top: 50, right: 500, bottom: 350 };
  const view = fitView(bounds, { width: 1000, height: 800 });
  assert.equal(view.zoom, 1);
  assert.deepEqual([300 * view.zoom + view.offset.x, 200 * view.zoom + view.offset.y], [500, 400]);
});

test('a graph wider than the window is scaled down until it fits', () => {
  const bounds = { left: 0, top: 0, right: 1800, bottom: 900 };
  const view = fitView(bounds, { width: 900, height: 600 }, { padding: 0 });
  assert.ok(view.zoom < 1 && view.zoom > 0.4);
  // The middle of the picture is the middle of the window, and no edge runs off it.
  assert.deepEqual([900 * view.zoom + view.offset.x, 450 * view.zoom + view.offset.y], [450, 300]);
  assert.ok(1800 * view.zoom + view.offset.x <= 900.5);
  assert.ok(900 * view.zoom + view.offset.y <= 600.5);
});

test('nothing to show is a view of nothing', () => {
  assert.deepEqual(fitView(null, { width: 800, height: 600 }), { zoom: 1, offset: { x: 0, y: 0 } });
});

// ---- who may be linked ----

test('a parent link closes a circle when the new parent is already below the child', () => {
  assert.equal(wouldCloseParentCircle([edge('parent', 3, 1)], 1, 3), true);
  assert.equal(wouldCloseParentCircle([edge('parent', 3, 1), edge('parent', 1, 4)], 4, 3), true);
  assert.equal(wouldCloseParentCircle([edge('parent', 1, 3)], 1, 3), false);
  // The other way round it is a circle too: each the parent of the other.
  assert.equal(wouldCloseParentCircle([edge('parent', 1, 3)], 3, 1), true);
  // A spouse or a friend between them does not make a line of descent.
  assert.equal(wouldCloseParentCircle([edge('spouse', 3, 1), edge('social', 1, 4)], 4, 3), false);
  assert.equal(wouldCloseParentCircle([], 5, 9), false);
});

// ---- reading what the page was opened with ----

test('the person the page was opened for is read from the address', () => {
  assert.equal(personIdIn('?personId=12'), 12);
  assert.equal(personIdIn('?personId=12&other=x'), 12);
  assert.equal(personIdIn('?personId=abc'), null);
  assert.equal(personIdIn(''), null);
  assert.equal(personIdIn(undefined), null);
});

test('the person whose faces carry a name is found by that name', () => {
  const nodes = [{ id: 1, anchors: ['张伟'] }, { id: 2, anchors: ['李静', '静静'] }];
  assert.equal(nodeForName(nodes, '静静').id, 2);
  assert.equal(nodeForName(nodes, '王秀兰'), null);
  assert.equal(nodeForName(null, '张伟'), null);
});

test('the word for a parent, a child or a spouse follows what is known of them', () => {
  assert.equal(kinKey('parents', { gender: 'male' }), 'household.kin.father');
  assert.equal(kinKey('parents', { gender: 'female' }), 'household.kin.mother');
  assert.equal(kinKey('parents', { gender: 'unknown' }), 'household.kin.parent');
  assert.equal(kinKey('children', { gender: 'female' }), 'household.kin.daughter');
  assert.equal(kinKey('children', {}), 'household.kin.child');
  assert.equal(kinKey('spouse', { gender: 'male' }), 'household.kin.husband');
  assert.equal(kinKey('spouse', { gender: 'unknown' }), 'household.kin.spouse');
  assert.equal(kinKey('social', { gender: 'male' }), null);
});

// ---- the links of one person ----

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
  assert.deepEqual(groupLinks([], 1).map((group) => group.labelKey), [
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

test('every social label the interface offers can be written', async () => {
  const { SOCIAL_LABELS } = await import('../src/common/householdGraph.js');
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

// ---- who a person is ----

test('the year of birth is read from the front of the date', () => {
  assert.equal(birthYearOf('2011'), 2011);
  assert.equal(birthYearOf('2011-05-07'), 2011);
  assert.equal(birthYearOf(''), null);
  assert.equal(birthYearOf(null), null);
  assert.equal(birthYearOf('spring 2011'), null);
});

test('changing what is known of a person keeps everything else about them', () => {
  const node = {
    id: 7, kind: 'person', displayName: '张小满', gender: 'unknown', birthDate: null,
    birthPlace: '大屯', notes: '爱做饭', shareAge: true, shareDetails: true, anchors: ['张小满', '满满'],
  };
  const written = nodeWithDetails(node, { gender: 'male', birthYear: 2011 });
  assert.equal(written.gender, 'male');
  assert.equal(written.birthDate, '2011');
  assert.equal(written.birthPlace, '大屯');
  assert.equal(written.notes, '爱做饭');
  assert.equal(written.shareAge, true);
  assert.equal(written.shareDetails, true);
  assert.deepEqual(written.anchors, ['张小满', '满满']);
  // Taking the year away writes nothing, not the string "null".
  assert.equal(nodeWithDetails(node, { gender: 'male', birthYear: null }).birthDate, null);

  const place = nodeWithDetails(node, { birthPlace: '北京', notes: '' });
  assert.equal(place.birthPlace, '北京');
  assert.equal(place.notes, null);
  assert.equal(nodeWithDetails(node, { shareDetails: false }).shareDetails, false);
  // What was left out stays as it was.
  assert.equal(nodeWithDetails(node, { gender: 'female' }).birthPlace, '大屯');
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
