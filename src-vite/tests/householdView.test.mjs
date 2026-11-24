// The graph page, mounted for real and clicked through.
//
// The page component, its parts, the API wrappers and the logic modules are
// the real files. What stands in is the library behind the commands: the
// in-memory one of helpers/household-library.mjs, which answers the way the
// Rust commands do — nothing for a command that only writes, an error for what
// it refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  IconPerson,
  ModalDialog,
  TButton,
  change,
  click,
  findAll,
  mountPage,
  settle,
  textOf,
} from './helpers/vue-mount.mjs';
import { COUPLE_GAP, NODE_W } from '../src/common/householdGraph.js';
import { createFamilyLibrary, createLibrary } from './helpers/household-library.mjs';

const SRC = path.resolve('src');
const PAGE = path.join(SRC, 'views', 'Household.vue');

// ---- the library behind the commands ----

const people = [
  { id: 1001, name: '张伟', count: 431 },
  { id: 1002, name: '李静', count: 428 },
  { id: 1003, name: '张小满', count: 1204 },
  { id: 1004, name: '王秀兰', count: 86 },
  { id: 1005, name: '陈小雨', count: 32 },
  { id: 1006, name: 'Person 9', count: 46 },
];
const albums = [{ id: 1, name: '家庭' }, { id: 2, name: '旅行' }];

const emptyLibrary = () => createLibrary({ persons: people, albums });

/** A library with a graph of a few people and no links yet. */
async function libraryWithGraph(members = ['张伟', '李静', '张小满']) {
  const library = emptyLibrary();
  await library.invoke('create_household', {
    name: '张伟家', albumIds: [1], rootNodeName: '张伟', importNames: members,
  });
  library.log.length = 0;
  return library;
}

// ---- the page ----

async function openPage(library, { search = '' } = {}) {
  const toasts = [];
  const listeners = new Map();
  const say = (kind) => (message) => toasts.push(`${kind}: ${message}`);
  const page = await mountPage(
    SRC,
    PAGE,
    {
      '@/common/transport': {
        invoke: library.invoke,
        listen: async (event, handler) => {
          listeners.set(event, handler);
          return () => {};
        },
        transportMode: 'tauri',
        emit: () => {},
      },
      '@/common/icons': new Proxy({}, { get: () => IconPerson }),
      '@/common/toast': { useToast: () => ({ info: say('info'), success: say('success'), warning: say('warning'), error: say('error') }) },
      '@/components/TButton.vue': TButton,
      '@/components/ModalDialog.vue': ModalDialog,
    },
    'zh-CN',
    { search },
  );
  return Object.assign(page, { toasts, listeners });
}

const role = (node, name) => findAll(node, (entry) => entry.props['data-role'] === name);
const one = (node, name) => role(node, name)[0] ?? null;
const withRole = (node, name, key, value) => role(node, name).find((entry) => entry.props[key] === value) ?? null;
/** The name of the graph that is open: written out, or the one chosen in the list of graphs. */
const graphNameOf = (page) => {
  const shown = one(page.root, 'graph-name');
  if (!shown) return null;
  if (shown.tag !== 'select') return textOf(shown).trim();
  return textOf(findAll(shown, (entry) => entry.tag === 'option')[Number(shown.props.value)]).trim();
};
const dialogOf = (page) => findAll(page.root, (node) => node.props.class === 'modal-dialog')[0]?.props['data-title'] ?? null;

/** The person as they stand on the canvas. */
const onCanvas = (page, name) =>
  findAll(page.root, (entry) => 'data-person' in entry.props && entry.props['data-name'] === name)[0] ?? null;
const onCanvasNames = (page) =>
  role(page.root, 'canvas').flatMap((canvas) => findAll(canvas, (entry) => 'data-person' in entry.props).map((entry) => entry.props['data-name']));
const linesOf = (page, kind) => findAll(page.root, (entry) => entry.props['data-line'] === kind);

const panelName = (page) => textOf(one(page.root, 'person-name')).trim();
const group = (page, kind) => findAll(page.root, (entry) => entry.props['data-group'] === kind && entry.props['data-role'] === 'group')[0] ?? null;
const linksOf = (page, kind) =>
  (group(page, kind)?.children ?? [])
    .filter((child) => child.props['data-link'] === kind)
    .map((row) => ({ name: row.props['data-name'], text: textOf(row).replace(/×$/, '').trim() }));
const rootBadgeOn = (person) => Boolean(person && findAll(person, (entry) => entry.props['data-role'] === 'root-badge').length);

/** Click a person on the canvas. */
async function select(page, name) {
  const person = onCanvas(page, name);
  assert.ok(person, `${name} is not on the canvas`);
  await click(person);
  await settle();
}

// ---- the first graph ----

test('a library without a graph asks for a root among the people the user named', async () => {
  const library = emptyLibrary();
  const page = await openPage(library);

  assert.ok(one(page.root, 'root-picker'), 'nobody is asked for a root');
  assert.match(page.text(), /选一位根人物/);
  // Everybody with a name is a choice, with their face; a made-up name is not.
  const offered = role(page.root, 'pick-person').map((entry) => entry.props['data-pick-name']);
  assert.deepEqual(offered, ['张伟', '李静', '张小满', '王秀兰', '陈小雨']);
  const face = findAll(withRole(page.root, 'pick-person', 'data-pick-name', '张伟'), (entry) => entry.tag === 'img')[0];
  // The library keeps a face as the bare JPEG: what is shown is the whole address of a picture.
  assert.equal(face.props.src, `data:image/jpeg;base64,${library.state.persons.find((entry) => entry.name === '张伟').thumbnail}`);
  // No empty shell of a graph, and nothing written to find out.
  assert.equal(one(page.root, 'canvas'), null);
  assert.deepEqual(
    library.log.map((entry) => entry.command).filter((name) => name.startsWith('set_') || name.startsWith('create_') || name.startsWith('import_')),
    [],
  );
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('picking a person makes the graph at once, with them as the root', async () => {
  const library = emptyLibrary();
  const page = await openPage(library);

  await click(withRole(page.root, 'pick-person', 'data-pick-name', '李静'));
  await settle();

  assert.deepEqual(library.log.find((entry) => entry.command === 'create_household').args, {
    name: '李静家', album_ids: [1, 2], root_node_name: '李静', import_names: ['李静'],
  });
  assert.equal(one(page.root, 'root-picker'), null, 'the picker stayed');
  assert.equal(graphNameOf(page), '李静家');
  // The new graph opens on its root: the card of the root is what the person fills in.
  assert.equal(panelName(page), '李静');
  assert.ok(rootBadgeOn(onCanvas(page, '李静')));
  // Nothing to draw between one person: the page says how to start.
  assert.match(page.text(), /还没有关系/);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('opened for a person, with no graph yet, the page builds the graph round them without asking', async () => {
  const library = emptyLibrary();
  const page = await openPage(library, { search: '?personId=1001' });

  assert.deepEqual(library.log.find((entry) => entry.command === 'create_household').args, {
    name: '张伟家', album_ids: [1, 2], root_node_name: '张伟', import_names: ['张伟'],
  });
  assert.equal(one(page.root, 'root-picker'), null);
  assert.equal(panelName(page), '张伟');
  assert.deepEqual(onCanvasNames(page), ['张伟']);
  // It was not asked for, so it is said: a graph was made.
  assert.deepEqual(page.toasts, ['info: 已创建图谱「张伟家」']);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('picking a person to start from makes the graph without a word: that one was asked for', async () => {
  const library = emptyLibrary();
  const page = await openPage(library);

  await click(withRole(page.root, 'pick-person', 'data-pick-name', '李静'));
  await settle();
  assert.deepEqual(page.toasts, []);
  page.unmount();
});

test('opened for somebody who is not in the graph, they join it and are the one selected', async () => {
  const library = await libraryWithGraph(['张伟']);
  const page = await openPage(library, { search: '?personId=1004' });

  const commands = library.log.map((entry) => entry.command);
  assert.deepEqual(commands.filter((name) => ['import_household_nodes', 'set_household_members'].includes(name)), [
    'import_household_nodes', 'set_household_members',
  ]);
  assert.deepEqual(library.log.find((entry) => entry.command === 'import_household_nodes').args.person_names, ['王秀兰']);
  assert.deepEqual(library.log.find((entry) => entry.command === 'set_household_members').args.node_ids.sort(), [
    library.idOf('张伟'), library.idOf('王秀兰'),
  ].sort());
  assert.equal(panelName(page), '王秀兰');
  assert.deepEqual(onCanvasNames(page).sort(), ['张伟', '王秀兰'].sort());
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('opened for somebody the graph already has, they are the one selected and nothing is written', async () => {
  const library = await libraryWithGraph();
  const page = await openPage(library, { search: `?personId=1003` });

  assert.equal(panelName(page), '张小满');
  assert.deepEqual(
    library.log.map((entry) => entry.command).filter((name) => name !== 'get_household_overview' && name !== 'list_face_names_for_household' && name !== 'get_persons_page' && name !== 'get_all_albums'),
    [],
    'something was written',
  );
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('opened for somebody outside every graph when there are several, nobody is written to: they are offered to join', async () => {
  const library = await libraryWithGraph(['张伟']);
  await library.invoke('create_household', { name: '王秀兰家', albumIds: [1], rootNodeName: '王秀兰', importNames: ['王秀兰'] });
  library.log.length = 0;
  const page = await openPage(library, { search: '?personId=1005' });

  // Which of two graphs a newcomer belongs to is not for the page to guess.
  assert.deepEqual(
    library.log.map((entry) => entry.command).filter((name) => name !== 'get_household_overview' && name !== 'list_face_names_for_household' && name !== 'get_persons_page' && name !== 'get_all_albums'),
    [],
    'something was written',
  );
  assert.equal(one(page.root, 'person-panel'), null);
  assert.ok(findAll(page.root, (entry) => entry.props['data-role'] === 'join' && entry.props['data-name'] === '陈小雨').length, '陈小雨 is not offered');
  page.unmount();
});

test('a person picked in the main window while the page is open joins and is selected the same way', async () => {
  const library = await libraryWithGraph(['张伟']);
  const page = await openPage(library);

  assert.ok(page.listeners.has('household-select'), 'the page does not listen for the main window');
  await page.listeners.get('household-select')({ payload: { personId: 1005 } });
  await settle();

  assert.equal(panelName(page), '陈小雨');
  assert.deepEqual(library.log.filter((entry) => entry.command === 'import_household_nodes').at(-1).args.person_names, ['陈小雨']);
  page.unmount();
});

test('somebody without a name cannot be a root, and the page says why', async () => {
  const library = emptyLibrary();
  const page = await openPage(library, { search: '?personId=1006' });

  assert.equal(library.log.some((entry) => entry.command === 'create_household'), false);
  assert.ok(page.toasts.some((line) => /没有名字/.test(line)), `nothing was said: ${page.toasts}`);
  // The way out is still open: a root can be picked.
  assert.ok(one(page.root, 'root-picker'));
  page.unmount();
});

// ---- the picture ----

test('the people stand as a family tree, each with the face the library keeps for them', async () => {
  const library = createFamilyLibrary();
  const page = await openPage(library);

  assert.equal(onCanvasNames(page).length, 11, '王强 is not a member');
  // Three generations: the grandparents and the in-laws, the parents, the children.
  assert.equal(onCanvas(page, '张建国').props['data-row'], 0);
  assert.equal(onCanvas(page, '张伟').props['data-row'], 1);
  assert.equal(onCanvas(page, '张小满').props['data-row'], 2);
  // Spouses side by side, at the distance the marriage line is drawn in.
  assert.equal(
    Math.abs(onCanvas(page, '李静').props['data-x'] - onCanvas(page, '张伟').props['data-x']),
    NODE_W + COUPLE_GAP,
  );
  // What is known of them is on the canvas: the name and the word for the root.
  const name = textOf(onCanvas(page, '张小满'));
  assert.match(name, /张小满/);
  assert.match(name, /女儿/);
  assert.equal(rootBadgeOn(onCanvas(page, '张伟')), true);
  assert.equal(rootBadgeOn(onCanvas(page, '李静')), false);
  // The lines of a tree: four marriages, three lines down to the children (one for each set
  // of parents), and one friendship of the classroom. Who stands left of who is the
  // layout's business; what must hold is who hangs off which line.
  const ids = (text) => String(text).split(',').map(Number).sort((a, b) => a - b);
  assert.equal(linesOf(page, 'couple').length, 4);
  assert.deepEqual(
    linesOf(page, 'family').map((line) => [ids(line.props['data-parents']), ids(line.props['data-children'])]),
    [
      [[library.idOf('张建国'), library.idOf('周慧兰')], [library.idOf('张伟'), library.idOf('张伟民')]],
      [[library.idOf('李国栋'), library.idOf('刘慧')], [library.idOf('李静')]],
      [[library.idOf('张伟'), library.idOf('李静')], [library.idOf('张小满'), library.idOf('张小北')]],
    ],
  );
  assert.equal(linesOf(page, 'social').length, 1);
  // A line down to the children starts between them, over the middle of the parents.
  const line = linesOf(page, 'family').find((entry) => ids(entry.props['data-children']).length === 2 && entry.props['data-parents'].includes(`${library.idOf('张伟')}`));
  const stems = line.props.d.match(/M([\d.-]+) ([\d.-]+)V/g).map((stem) => Number(stem.slice(1).split(' ')[0]));
  const childX = (name) => Number(onCanvas(page, name).props['data-x']);
  assert.ok(stems[0] >= childX('张小满') && stems[0] <= childX('张小北'), `the line comes down at ${stems[0]}`);
  // Everybody has the face of the person their name stands for.
  for (const person of role(page.root, 'canvas').flatMap((canvas) => findAll(canvas, (entry) => 'data-person' in entry.props))) {
    const face = findAll(person, (entry) => entry.tag === 'image')[0];
    // The library keeps a face as the bare JPEG: the canvas draws the whole address of a picture.
    const kept = library.state.persons.find((entry) => entry.name === person.props['data-name']).thumbnail;
    assert.equal(face?.props.href, `data:image/jpeg;base64,${kept}`, `${person.props['data-name']} has another face`);
  }
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('a person whose face the library does not have gets a silhouette, not a hole', async () => {
  const library = createLibrary({ persons: [{ id: 1001, name: '张伟', count: 3, thumbnail: null }], albums });
  await library.invoke('create_household', { name: '张伟家', albumIds: [1], rootNodeName: '张伟', importNames: ['张伟'] });
  const page = await openPage(library);

  const person = onCanvas(page, '张伟');
  assert.equal(findAll(person, (entry) => entry.tag === 'image').length, 0);
  assert.equal(findAll(person, (entry) => entry.props['data-role'] === 'silhouette').length, 1);
  page.unmount();
});

test('clicking a person on the canvas opens their card in the side panel', async () => {
  const page = await openPage(createFamilyLibrary());

  // A graph opens on its root.
  assert.equal(panelName(page), '张伟');
  await select(page, '张小满');

  assert.equal(panelName(page), '张小满');
  assert.equal(textOf(one(page.root, 'person-term')).trim(), '女儿');
  assert.equal(one(page.root, 'birth-year').props.value, '2011');
  assert.deepEqual(linksOf(page, 'parents').map((link) => link.name), ['张伟', '李静']);
  assert.deepEqual(linksOf(page, 'children'), []);
  assert.deepEqual(linksOf(page, 'spouse'), []);
  assert.deepEqual(linksOf(page, 'social').map((link) => link.name), ['陈小雨']);
  // The word follows what is known: the father, the mother.
  assert.deepEqual(linksOf(page, 'parents').map((link) => link.text), ['张伟父亲', '李静母亲']);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('closing the card lists the members and whoever could still join', async () => {
  const library = createFamilyLibrary();
  const page = await openPage(library);

  await click(one(page.root, 'close-person'));
  await settle();
  assert.equal(one(page.root, 'person-panel'), null);

  const members = role(page.root, 'member').map((entry) => [entry.props['data-name'], textOf(entry).trim()]);
  assert.equal(members.length, 11);
  assert.deepEqual(members.find(([name]) => name === '张小满'), ['张小满', '张小满女儿']);
  // The root keeps the badge in the list.
  assert.ok(findAll(withRole(page.root, 'member', 'data-name', '张伟'), (entry) => entry.props['data-role'] === 'root-badge').length);
  // 王强 has a name but is in nobody's graph yet: one click brings them in.
  const join = findAll(page.root, (entry) => entry.props['data-role'] === 'join' && entry.props['data-name'] === '王强')[0];
  assert.ok(join, '王强 is not offered');
  await click(join);
  await settle();
  assert.ok(onCanvas(page, '王强'), '王强 did not join');
  assert.equal(panelName(page), '王强');
  assert.deepEqual(page.problems, []);
  page.unmount();
});

// ---- adding and taking away ----

test('adding a parent writes the links, and the card shows the new one at once', async () => {
  const library = await libraryWithGraph();
  const page = await openPage(library);
  await select(page, '张小满');

  await click(withRole(group(page, 'parents'), 'add-link', 'data-group', 'parents'));
  await settle();
  assert.ok(one(page.root, 'picker'), 'the picker did not open');
  // Those of the graph come first; the two who are in nobody's graph follow, marked as joining.
  assert.deepEqual(role(one(page.root, 'picker'), 'pick-person').map((entry) => textOf(entry).replace(/加入图谱$/, '').trim()), ['张伟', '李静', '王秀兰', '陈小雨']);

  await click(withRole(one(page.root, 'picker'), 'pick-person', 'data-pick-name', '张伟'));
  await settle();

  const write = library.log.find((entry) => entry.command === 'set_household_edges');
  assert.deepEqual(write.args.edges.map((edge) => [edge.kind, edge.fromNode, edge.toNode]), [
    ['parent', library.idOf('张伟'), library.idOf('张小满')],
  ]);
  assert.deepEqual(linksOf(page, 'parents').map((link) => link.name), ['张伟']);
  assert.equal(one(page.root, 'picker'), null, 'the picker stayed open');
  // The tree grew a line.
  assert.equal(linesOf(page, 'family').length, 1);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('a name that is in nobody\'s graph joins it on the way', async () => {
  const library = await libraryWithGraph();
  const page = await openPage(library);
  await select(page, '张伟');

  await click(withRole(group(page, 'parents'), 'add-link', 'data-group', 'parents'));
  await settle();
  const outside = role(one(page.root, 'picker'), 'pick-person').filter((entry) => entry.props['data-pick'] === '');
  assert.deepEqual(outside.map((entry) => entry.props['data-pick-name']), ['王秀兰', '陈小雨']);
  assert.match(textOf(outside[0]), /加入图谱/);

  await click(withRole(one(page.root, 'picker'), 'pick-person', 'data-pick-name', '王秀兰'));
  await settle();

  const commands = library.log.map((entry) => entry.command);
  assert.ok(commands.indexOf('import_household_nodes') < commands.indexOf('set_household_members'));
  assert.ok(commands.indexOf('set_household_members') < commands.indexOf('set_household_edges'));
  assert.deepEqual(
    library.log.find((entry) => entry.command === 'set_household_edges').args.edges.map((edge) => [edge.fromNode, edge.toNode]),
    [[library.idOf('王秀兰'), library.idOf('张伟')]],
  );
  assert.ok(onCanvas(page, '王秀兰'), 'the new person is not on the canvas');
  assert.deepEqual(linksOf(page, 'parents').map((link) => link.name), ['王秀兰']);
  page.unmount();
});

test('a student is stored as a teacher link the other way, and reads as a teacher for the student', async () => {
  const library = await libraryWithGraph();
  const page = await openPage(library);
  await select(page, '张小满');

  await click(withRole(group(page, 'social'), 'add-link', 'data-group', 'social'));
  await settle();
  await click(withRole(one(page.root, 'picker'), 'social-label', 'data-social-label', 'student'));
  await click(withRole(one(page.root, 'picker'), 'pick-person', 'data-pick-name', '李静'));
  await settle();

  const stored = library.state.edges.find((edge) => edge.kind === 'social');
  assert.deepEqual(
    { from: stored.fromNode, to: stored.toNode, label: stored.label },
    { from: library.idOf('李静'), to: library.idOf('张小满'), label: 'teacher' },
  );
  assert.deepEqual(linksOf(page, 'social'), [{ name: '李静', text: '李静老师' }]);
  page.unmount();
});

test('somebody who would close a circle is not offered as a parent or a child', async () => {
  const library = await libraryWithGraph();
  await library.invoke('set_household_edges', {
    householdId: library.state.households[0].id,
    edges: [{ kind: 'parent', fromNode: library.idOf('张伟'), toNode: library.idOf('张小满') }],
  });
  const page = await openPage(library);

  await select(page, '张伟');
  await click(withRole(group(page, 'parents'), 'add-link', 'data-group', 'parents'));
  await settle();
  // The child cannot also be the father's parent.
  assert.equal(withRole(one(page.root, 'picker'), 'pick-person', 'data-pick-name', '张小满'), null);

  await select(page, '张小满');
  await click(withRole(group(page, 'children'), 'add-link', 'data-group', 'children'));
  await settle();
  assert.equal(withRole(one(page.root, 'picker'), 'pick-person', 'data-pick-name', '张伟'), null);
  assert.ok(withRole(one(page.root, 'picker'), 'pick-person', 'data-pick-name', '李静'));
  page.unmount();
});

test('a link is taken away with one click on its cross', async () => {
  const library = createFamilyLibrary();
  const page = await openPage(library);
  await select(page, '张小北');

  assert.deepEqual(linksOf(page, 'parents').map((link) => link.name), ['张伟', '李静']);
  const row = findAll(group(page, 'parents'), (entry) => entry.props['data-link'] === 'parents' && entry.props['data-name'] === '李静')[0];
  await click(findAll(row, (entry) => entry.props['data-role'] === 'remove-link')[0]);
  await settle();

  const write = library.log.find((entry) => entry.command === 'set_household_edges');
  assert.equal(write.args.edges.some((edge) => edge.kind === 'parent' && edge.fromNode === library.idOf('李静') && edge.toNode === library.idOf('张小北')), false);
  // The rest of the family is still there.
  assert.ok(write.args.edges.some((edge) => edge.kind === 'parent' && edge.fromNode === library.idOf('李静') && edge.toNode === library.idOf('张小满')));
  assert.deepEqual(linksOf(page, 'parents').map((link) => link.name), ['张伟']);
  page.unmount();
});

test('a batch the library refuses leaves the page and the links as they were, and says so', async () => {
  const library = createFamilyLibrary();
  const page = await openPage(library);
  await select(page, '张伟民');
  const reads = library.log.filter((entry) => entry.command === 'get_household_overview').length;

  await click(withRole(group(page, 'spouse'), 'add-link', 'data-group', 'spouse'));
  await settle();
  library.failures.add('set_household_edges');
  await click(withRole(one(page.root, 'picker'), 'pick-person', 'data-pick-name', '陈小雨'));
  await settle();

  assert.equal(library.state.edges.filter((edge) => edge.kind === 'spouse').length, 4);
  assert.deepEqual(linksOf(page, 'spouse').map((link) => link.name), ['刘敏']);
  assert.equal(
    library.log.filter((entry) => entry.command === 'get_household_overview').length,
    reads,
    'the page reloaded a graph it had not changed',
  );
  assert.deepEqual(page.toasts, ['error: 没能保存这段关系，库里没有接受这批改动。']);
  // The picker stays, so the choice can be made another way.
  assert.ok(one(page.root, 'picker'));
  page.unmount();
});

// ---- who a person is ----

test('what is known of a person is saved as soon as it is changed', async () => {
  const library = createFamilyLibrary();
  const page = await openPage(library);
  await select(page, '张小满');
  const writes = () => library.log.filter((entry) => entry.command === 'upsert_household_node');
  // She is known to be a daughter: the word follows what is known.
  assert.equal(textOf(one(page.root, 'person-term')).trim(), '女儿');
  assert.equal(one(page.root, 'save-state'), null, 'something was said to be saved that was not changed');

  const male = findAll(one(page.root, 'gender'), (entry) => entry.props['data-gender'] === 'male')[0];
  await click(male);
  await settle();
  let written = writes().at(-1).args.node;
  assert.equal(written.gender, 'male');
  assert.deepEqual(written.anchors, ['张小满']);
  assert.equal(textOf(one(page.root, 'person-term')).trim(), '儿子');
  assert.equal(textOf(one(page.root, 'save-state')).trim(), '已保存');

  await change(one(page.root, 'birth-year'), '2012');
  await settle();
  await change(one(page.root, 'birth-place'), '北京');
  await settle();
  await change(one(page.root, 'notes'), '爱做饭');
  await settle();
  written = writes().at(-1).args.node;
  assert.deepEqual([written.gender, written.birthDate, written.birthPlace, written.notes], ['male', '2012', '北京', '爱做饭']);
  // Each change is one write: three more since the gender.
  assert.equal(writes().length, 4);
  // What was saved is what the card shows.
  assert.equal(one(page.root, 'birth-place').props.value, '北京');
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('a year that is not a year is marked and not saved', async () => {
  const library = await libraryWithGraph();
  const page = await openPage(library);
  await select(page, '张小满');

  await change(one(page.root, 'birth-year'), 'abcd');
  await settle();
  assert.equal(library.log.some((entry) => entry.command === 'upsert_household_node'), false);
  assert.equal(one(page.root, 'birth-year').props['data-invalid'], 'true');
  // A year on its own is taken.
  await change(one(page.root, 'birth-year'), '2011');
  await settle();
  assert.equal(one(page.root, 'birth-year').props['data-invalid'], undefined);
  assert.equal(library.log.filter((entry) => entry.command === 'upsert_household_node').at(-1).args.node.birthDate, '2011');
  page.unmount();
});

test('making a person the root moves the root to them', async () => {
  const library = createFamilyLibrary();
  const page = await openPage(library);
  await select(page, '李静');

  await click(one(page.root, 'make-root'));
  await settle();

  assert.deepEqual(library.log.find((entry) => entry.command === 'update_household').args, {
    household_id: library.state.households[0].id, root_node_id: library.idOf('李静'),
  });
  assert.equal(rootBadgeOn(onCanvas(page, '李静')), true);
  assert.equal(rootBadgeOn(onCanvas(page, '张伟')), false);
  // The root has nothing to be made: no button for it.
  assert.equal(one(page.root, 'make-root'), null);
  assert.equal(one(page.root, 'remove-person'), null);
  // 张伟 is the husband now.
  assert.match(textOf(onCanvas(page, '张伟')), /丈夫/);
  page.unmount();
});

test('somebody who is not the root is taken out of the graph on the second click, with their links here', async () => {
  const library = createFamilyLibrary();
  const page = await openPage(library);
  const before = library.state.edges.length;
  const theirs = library.idOf('陈小雨');
  const people = library.state.nodes.length;
  await select(page, '陈小雨');

  // One click only asks.
  await click(one(page.root, 'remove-person'));
  await settle();
  assert.equal(library.log.some((entry) => ['set_household_members', 'set_household_edges', 'delete_household_node'].includes(entry.command)), false);
  assert.match(textOf(one(page.root, 'remove-person')), /再点一次/);

  await click(one(page.root, 'remove-person'));
  await settle();
  // The links go first, while the person still counts as a member: the library
  // replaces the links of the members, and only those.
  const writes = library.log
    .filter((entry) => ['set_household_edges', 'set_household_members'].includes(entry.command))
    .map((entry) => entry.command);
  assert.deepEqual(writes, ['set_household_edges', 'set_household_members']);
  assert.equal(library.log.some((entry) => entry.command === 'delete_household_node'), false, 'the person was deleted from the library');
  assert.equal(library.state.edges.length, before - 1);
  assert.equal(library.state.households[0].memberIds.includes(theirs), false);
  assert.equal(onCanvas(page, '陈小雨'), null);
  // The person is the library's still: brought back, it is the same person.
  assert.equal(library.state.nodes.length, people);
  await click(one(page.root, 'close-person'));
  await settle();
  await click(findAll(page.root, (entry) => entry.props['data-role'] === 'join' && entry.props['data-name'] === '陈小雨')[0]);
  await settle();
  assert.equal(library.state.nodes.length, people);
  assert.equal(library.state.households[0].memberIds.includes(theirs), true);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('taking somebody out of this graph leaves them, and their links, in another graph they are in', async () => {
  const library = createFamilyLibrary();
  await library.invoke('create_household', { name: '王强家', albumIds: [1], rootNodeName: '王强', importNames: ['王强'] });
  const other = library.state.households[1];
  const parent = { kind: 'parent', fromNode: library.idOf('王强'), toNode: library.idOf('陈小雨') };
  await library.invoke('set_household_members', { householdId: other.id, nodeIds: [library.idOf('王强'), library.idOf('陈小雨')] });
  await library.invoke('set_household_edges', { householdId: other.id, edges: [parent] });
  library.log.length = 0;
  const page = await openPage(library);
  const before = library.state.edges.length;
  await select(page, '陈小雨');
  await click(one(page.root, 'remove-person'));
  await settle();
  await click(one(page.root, 'remove-person'));
  await settle();

  // A link belongs to two people, not to a graph: where it is still wanted, it stays.
  assert.equal(library.log.some((entry) => entry.command === 'set_household_edges'), false, 'links were rewritten');
  assert.equal(library.state.edges.length, before);
  assert.ok(other.memberIds.includes(library.idOf('陈小雨')), 'they were taken out of the other graph too');
  assert.equal(library.state.households[0].memberIds.includes(library.idOf('陈小雨')), false);
  // Out of sight here: the classmate link that is left is not offered under 张小满 any more.
  await select(page, '张小满');
  assert.deepEqual(linksOf(page, 'social'), []);
  page.unmount();
});

test('somebody with links of their own in another graph keeps them when they are brought in here', async () => {
  const library = createLibrary({
    persons: [...people, { id: 1007, name: '孙桂芳', count: 12 }],
    albums,
  });
  // This graph: 张伟, 李静 and their child. Elsewhere: 王秀兰 and her child 陈小雨.
  const here = await library.invoke('create_household', {
    name: '张伟家', albumIds: [1], rootNodeName: '张伟', importNames: ['张伟', '李静', '张小满'],
  });
  const elsewhere = await library.invoke('create_household', {
    name: '王秀兰家', albumIds: [1], rootNodeName: '王秀兰', importNames: ['王秀兰', '陈小雨'],
  });
  const theirLink = { kind: 'parent', fromNode: library.idOf('王秀兰'), toNode: library.idOf('陈小雨') };
  await library.invoke('set_household_edges', { householdId: elsewhere, edges: [theirLink] });
  const page = await openPage(library);
  assert.equal(graphNameOf(page), '张伟家');

  await select(page, '张小满');
  await click(withRole(group(page, 'parents'), 'add-link', 'data-group', 'parents'));
  await settle();
  // 陈小雨 is in the other graph only: picking the name brings them in on the way.
  await click(withRole(one(page.root, 'picker'), 'pick-person', 'data-pick-name', '陈小雨'));
  await settle();

  // The link to their mother is not this graph's to take away.
  assert.deepEqual(
    library.state.edges.map((edge) => [edge.kind, edge.fromNode, edge.toNode]).sort(),
    [[theirLink.kind, theirLink.fromNode, theirLink.toNode], ['parent', library.idOf('陈小雨'), library.idOf('张小满')]].sort(),
  );
  assert.deepEqual(linksOf(page, 'parents').map((link) => link.name), ['陈小雨']);
  assert.equal(here, library.state.households[0].id);
  page.unmount();
});

test('two changes made one after the other both land', async () => {
  const library = createFamilyLibrary();
  const page = await openPage(library);
  await select(page, '张小满');
  const writes = () => library.log.filter((entry) => entry.command === 'upsert_household_node').map((entry) => entry.args.node);

  // No waiting between them: the second write must not carry what was there before the first.
  const male = findAll(one(page.root, 'gender'), (entry) => entry.props['data-gender'] === 'male')[0];
  await click(male);
  await change(one(page.root, 'birth-year'), '2012');
  await settle();
  await settle();

  assert.equal(writes().length, 2);
  const last = writes().at(-1);
  assert.deepEqual([last.gender, last.birthDate], ['male', '2012']);
  page.unmount();
});

// ---- the graph itself ----

test('the switch in the top bar turns the graph off for the picture description', async () => {
  const library = createFamilyLibrary();
  const page = await openPage(library);

  const toggle = one(page.root, 'graph-enabled');
  assert.equal(toggle.props.checked, true);
  await change(toggle, false);
  await settle();

  assert.deepEqual(library.log.find((entry) => entry.command === 'update_household').args, {
    household_id: library.state.households[0].id, enabled: false,
  });
  assert.equal(one(page.root, 'graph-enabled').props.checked, false);
  page.unmount();
});

test('a new graph is started from the top bar by picking its root', async () => {
  const library = await libraryWithGraph();
  const page = await openPage(library);

  await click(one(page.root, 'new-graph'));
  await settle();
  assert.equal(dialogOf(page), '新建图谱');
  // 陈小雨 and 王秀兰 are not in the first graph: either can start another.
  await click(withRole(page.root, 'pick-person', 'data-pick-name', '陈小雨'));
  await settle();

  assert.deepEqual(library.log.filter((entry) => entry.command === 'create_household').at(-1).args, {
    name: '陈小雨家', album_ids: [1, 2], root_node_name: '陈小雨', import_names: ['陈小雨'],
  });
  assert.equal(dialogOf(page), null);
  assert.equal(graphNameOf(page), '陈小雨家');
  assert.equal(panelName(page), '陈小雨');
  page.unmount();
});

test('picking somebody who has a graph already, from the new-graph dialog, opens that graph and makes no other', async () => {
  const library = await libraryWithGraph();
  const page = await openPage(library);

  await click(one(page.root, 'new-graph'));
  await settle();
  // The card says where picking leads: to the graph there is.
  const card = withRole(page.root, 'pick-person', 'data-pick-name', '张小满');
  assert.match(textOf(card), /张伟家/);
  await click(card);
  await settle();

  assert.equal(library.log.filter((entry) => entry.command === 'create_household').length, 0, 'a second graph was made');
  assert.equal(dialogOf(page), null);
  assert.equal(panelName(page), '张小满');
  page.unmount();
});

test('the real button keeps the contract the page relies on', () => {
  const source = fs.readFileSync(path.join(SRC, 'components', 'TButton.vue'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(source, /^\s*text:\s*\{/m, 'the button no longer takes a text');
  assert.match(source, /^\s*disabled:\s*\{/m, 'the button no longer takes disabled');
  assert.match(source, /defineEmits\(\['click'\]\)/, 'the button no longer says when it is clicked');
});
