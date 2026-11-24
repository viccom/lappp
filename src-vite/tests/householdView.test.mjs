// The graph page, mounted for real and clicked through.
//
// The page component, the API wrappers and the logic modules are the real
// files. What stands in is the library behind the commands: an in-memory one
// that answers the way the Rust commands do — nothing for a command that
// only writes, an error for a batch it refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findAll,
  IconPerson,
  ModalDialog,
  SearchableSelect,
  TButton,
  change,
  click,
  mountPage,
  settle,
  textOf,
} from './helpers/vue-mount.mjs';

const SRC = path.resolve('src');
const PAGE = path.join(SRC, 'views', 'Household.vue');

// ---- the library behind the commands ----

const SOCIAL = new Set(['classmate', 'teacher', 'friend', 'colleague', 'neighbour', 'partner']);
const AUTO_NAME = /^person /i;

function createLibrary({ faces, albums }) {
  const state = { tables: false, nodes: [], anchors: new Map(), households: [], edges: [], next: 1 };
  const log = [];
  const nextId = () => {
    state.next += 1;
    return state.next - 1;
  };
  const ownerOf = (name) => state.anchors.get(name) ?? null;
  const nodeById = (id) => state.nodes.find((node) => node.id === id) ?? null;
  const graphById = (id) => state.households.find((graph) => graph.id === id) ?? null;

  function importNames(names) {
    return names
      .filter((name) => name.trim() !== '' && !AUTO_NAME.test(name.trim()))
      .map((name) => {
        const existing = ownerOf(name);
        if (existing != null) return existing;
        const node = {
          id: nextId(), kind: 'person', displayName: name, gender: 'unknown', birthDate: null,
          birthPlace: null, notes: null, shareAge: true, shareDetails: false,
        };
        state.nodes.push(node);
        state.anchors.set(name, node.id);
        return node.id;
      });
  }

  /** A parent link may not close a circle. */
  function closesCircle(edges) {
    const above = new Map();
    for (const edge of edges) {
      if (edge.kind !== 'parent') continue;
      if (!above.has(edge.toNode)) above.set(edge.toNode, []);
      above.get(edge.toNode).push(edge.fromNode);
    }
    for (const start of above.keys()) {
      const seen = new Set();
      const stack = [start];
      while (stack.length) {
        const node = stack.pop();
        // Coming back to somebody already walked round means a circle.
        if (seen.has(node)) return true;
        seen.add(node);
        stack.push(...(above.get(node) ?? []));
      }
    }
    return false;
  }

  /** The word a person carries relative to the root of their graph. */
  function termOf(nodeId) {
    const graph = state.households.find((entry) => entry.memberIds.includes(nodeId));
    if (!graph || graph.rootNodeId === nodeId) return null;
    const child = state.edges.some((edge) => edge.kind === 'parent' && edge.fromNode === graph.rootNodeId && edge.toNode === nodeId);
    if (!child) return null;
    const gender = nodeById(nodeId)?.gender;
    return gender === 'male' ? '儿子' : gender === 'female' ? '女儿' : '孩子';
  }

  const commands = {
    get_household_overview() {
      if (!state.tables) return null;
      return {
        households: state.households.map((graph) => ({ ...graph, albumIds: [...graph.albumIds], memberIds: [...graph.memberIds] })),
        nodes: state.nodes.map((node) => ({
          ...node,
          anchors: [...state.anchors].filter(([, id]) => id === node.id).map(([name]) => name),
          term: termOf(node.id),
        })),
        edges: state.edges.map((edge) => ({ ...edge })),
      };
    },
    list_face_names_for_household() {
      return faces.map((face) => ({ name: face.name, count: face.count, imported: ownerOf(face.name) != null }));
    },
    get_all_albums() {
      return albums.map((album) => ({ id: album.id, name: album.name }));
    },
    create_household({ name, album_ids, root_node_name, import_names }) {
      if (!name || !name.trim()) throw new Error('A graph needs a name');
      state.tables = true;
      const imported = importNames(import_names);
      const root = ownerOf(root_node_name);
      if (root == null) throw new Error(`${root_node_name} is not the name of anyone in the library`);
      const graph = {
        id: nextId(), name: name.trim(), enabled: true, rootNodeId: root,
        albumIds: [...(album_ids ?? [])], memberIds: [...new Set([...imported, root])],
      };
      state.households.push(graph);
      return graph.id;
    },
    update_household({ household_id, name, enabled, album_ids, root_node_id }) {
      const graph = graphById(household_id);
      if (!graph) throw new Error('The graph is gone');
      if (name !== undefined) graph.name = name.trim();
      if (enabled !== undefined) graph.enabled = enabled;
      if (album_ids !== undefined) graph.albumIds = [...album_ids];
      if (root_node_id !== undefined) {
        if (!nodeById(root_node_id)) throw new Error('The object to make the root is gone');
        graph.rootNodeId = root_node_id;
      }
      return null;
    },
    import_household_nodes({ person_names }) {
      return importNames(person_names);
    },
    upsert_household_node({ node }) {
      if (!['male', 'female', 'unknown'].includes(node.gender)) throw new Error(`Unknown gender: ${node.gender}`);
      let target = node.id != null ? nodeById(node.id) : null;
      if (node.id != null && !target) throw new Error(`The object ${node.id} is gone`);
      if (!target) {
        target = { id: nextId() };
        state.nodes.push(target);
      }
      Object.assign(target, {
        kind: node.kind, displayName: node.displayName, gender: node.gender, birthDate: node.birthDate,
        birthPlace: node.birthPlace, notes: node.notes, shareAge: node.shareAge, shareDetails: node.shareDetails,
      });
      for (const [name, ownerId] of [...state.anchors]) {
        if (ownerId === target.id) state.anchors.delete(name);
      }
      for (const name of node.anchors) {
        if (ownerOf(name) != null) throw new Error(`${name} already belongs to another object`);
        state.anchors.set(name, target.id);
      }
      return target.id;
    },
    set_household_members({ household_id, node_ids }) {
      const graph = graphById(household_id);
      if (!graph) throw new Error('The graph is gone');
      for (const id of node_ids) if (!nodeById(id)) throw new Error(`The object ${id} is gone`);
      graph.memberIds = [...new Set(node_ids)];
      return null;
    },
    set_household_edges({ household_id, edges }) {
      const graph = graphById(household_id);
      if (!graph) throw new Error('The graph is gone');
      const members = new Set(graph.memberIds);

      // The whole batch is checked before any of it is written.
      const seen = new Set();
      const prepared = edges.map((edge) => {
        if (!['parent', 'spouse', 'social'].includes(edge.kind)) throw new Error(`Unknown kind of link: ${edge.kind}`);
        if (edge.kind === 'social' && !SOCIAL.has(edge.label)) throw new Error('A social link needs a label the catalog knows');
        if (edge.fromNode === edge.toNode) throw new Error('A link cannot point at the same object');
        if (!nodeById(edge.fromNode) || !nodeById(edge.toNode)) throw new Error('The object is gone');
        // A symmetric link is stored once, the smaller id first.
        const symmetric = edge.kind === 'spouse' || (edge.kind === 'social' && edge.label !== 'teacher');
        const [from, to] = symmetric ? [edge.fromNode, edge.toNode].sort((a, b) => a - b) : [edge.fromNode, edge.toNode];
        const key = `${edge.kind}:${from}>${to}:${edge.label ?? ''}`;
        if (seen.has(key)) throw new Error('The same link is in the list twice');
        seen.add(key);
        return {
          kind: edge.kind, fromNode: from, toNode: to, label: edge.label ?? null,
          termOverride: edge.termOverride ?? null, validFrom: edge.validFrom ?? null,
          validTo: edge.validTo ?? null, source: edge.source ?? 'user',
        };
      });

      const kept = state.edges.filter((edge) => !(members.has(edge.fromNode) || members.has(edge.toNode)));
      if (closesCircle([...kept, ...prepared])) throw new Error('A parent link cannot close a circle');
      state.edges = [...kept, ...prepared];
      return null;
    },
  };

  const toSnake = (args) => Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]),
  );

  return {
    state,
    log,
    idOf: (name) => ownerOf(name),
    invoke: async (command, args = {}) => {
      const snake = toSnake(args);
      log.push({ command, args: snake });
      const run = commands[command];
      if (!run) throw new Error(`no such command: ${command}`);
      return run(snake);
    },
  };
}

// ---- the page ----

async function openPage(library) {
  const page = await mountPage(SRC, PAGE, {
    '@/common/transport': { invoke: library.invoke, listen: async () => () => {}, transportMode: 'tauri', emit: () => {} },
    '@/common/icons': new Proxy({}, { get: () => IconPerson }),
    '@/components/TButton.vue': TButton,
    '@/components/ModalDialog.vue': ModalDialog,
    '@/components/SearchableSelect.vue': SearchableSelect,
  });
  return page;
}

const buttonsIn = (node) => findAll(node, (entry) => entry.tag === 'button');
const buttonNamed = (node, label) => buttonsIn(node).find((button) => textOf(button).trim() === label);
const dialogOf = (page) => findAll(page.root, (node) => node.props.class === 'modal-dialog')[0] ?? null;
const selectsIn = (node) => findAll(node, (entry) => entry.tag === 'select');

/** The column of one group of links: the one whose label says so. */
function groupNamed(page, label) {
  const name = findAll(page.root, (node) => node.tag === 'span' && textOf(node).trim() === label)[0];
  return name?.parentNode ?? null;
}

/** The links already made, in a group. */
function chipsOf(group) {
  return group.children
    .filter((child) => child.tag === 'span' && String(child.props.class).includes('inline-flex'))
    .map((chip) => textOf(chip).replace(/×$/, ''));
}

/** The control that adds a link to a group. */
function adderOf(group) {
  return group.children.find((child) => child.tag === 'select' && child.props.class === 'searchable-select') ?? null;
}

/** The row of a person in the column on the left: the one that names them. */
function rowOfMember(page, name) {
  const label = findAll(
    page.root,
    (node) => node.tag === 'span' && String(node.props.class).includes('truncate') && textOf(node) === name,
  )[0];
  return label?.parentNode ?? null;
}

const faces = [
  { name: '张伟', count: 431 },
  { name: '李静', count: 428 },
  { name: '张小满', count: 1204 },
  { name: '王秀兰', count: 86 },
  { name: '陈小雨', count: 32 },
];
const albums = [{ id: 1, name: '家庭' }, { id: 2, name: '旅行' }];

async function withGraph(library, { root = '张小满', members = ['张伟', '李静', '张小满', '王秀兰'], albums: scope = [1] } = {}) {
  await library.invoke('create_household', {
    name: `${root}家`, albumIds: scope, rootNodeName: root, importNames: members,
  });
  return library.state.households[0].id;
}

test('a library without a graph says so, and names who a graph can be built from', async () => {
  const library = createLibrary({ faces, albums });
  const page = await openPage(library);

  const text = page.text();
  assert.match(text, /还没有家庭图谱/);
  // The people are what the page has to offer: they are on it.
  for (const face of faces) assert.ok(text.includes(face.name), `${face.name} is not named`);
  // An empty shell is not shown.
  assert.doesNotMatch(text, /成员 \(0\)/);
  assert.equal(dialogOf(page), null);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('the new-graph button opens the dialog although nobody is selected and no graph exists', async () => {
  const library = createLibrary({ faces, albums });
  const page = await openPage(library);

  const opener = buttonNamed(page.root, '新建家庭图谱');
  assert.ok(opener, 'the top bar has no button to create a graph');
  await click(opener);
  await settle();

  const dialog = dialogOf(page);
  assert.ok(dialog, 'the dialog did not open');
  assert.equal(dialog.props['data-title'], '新建家庭图谱');
  // The root is a choice among the named people, and nobody is chosen yet.
  const root = selectsIn(dialog)[0];
  assert.deepEqual(
    root.children.filter((option) => option.tag === 'option').map(textOf),
    ['请选择', ...faces.map((face) => face.name)],
  );
  // Nothing to create until a root is chosen.
  assert.equal(buttonNamed(dialog, '新建').props.disabled, true);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('creating a graph sends the root, the members and the albums in one command, and the people appear', async () => {
  const library = createLibrary({ faces, albums });
  const page = await openPage(library);

  await click(buttonNamed(page.root, '新建家庭图谱'));
  await settle();
  const dialog = dialogOf(page);
  await change(selectsIn(dialog)[0], '李静');
  await settle();

  // The name follows the root.
  const nameInput = findAll(dialog, (node) => node.tag === 'input')[0];
  assert.equal(nameInput.props.value, '李静家');
  await click(buttonNamed(dialog, '新建'));
  await settle();

  const created = library.log.find((entry) => entry.command === 'create_household');
  assert.deepEqual(created.args, {
    name: '李静家',
    album_ids: [1, 2],
    root_node_name: '李静',
    import_names: faces.map((face) => face.name),
  });
  assert.equal(dialogOf(page), null, 'the dialog stayed open');

  const text = page.text();
  assert.match(text, /成员 \(5\)/);
  assert.ok(rowOfMember(page, '李静'), 'the root is not in the column');
  assert.equal(textOf(rowOfMember(page, '李静')).trim(), '李静根');
  assert.match(text, /根: 李静/);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('the parents of a person are under "parents", the children under "children"', async () => {
  const library = createLibrary({ faces, albums });
  const graph = await withGraph(library);
  await library.invoke('set_household_edges', {
    householdId: graph,
    edges: [
      { kind: 'parent', fromNode: library.idOf('张伟'), toNode: library.idOf('张小满') },
      { kind: 'parent', fromNode: library.idOf('李静'), toNode: library.idOf('张小满') },
    ],
  });
  const page = await openPage(library);

  await click(rowOfMember(page, '张小满'));
  await settle();
  assert.deepEqual(chipsOf(groupNamed(page, '父母')), ['张伟', '李静']);
  assert.deepEqual(chipsOf(groupNamed(page, '子女')), []);

  await click(rowOfMember(page, '张伟'));
  await settle();
  assert.deepEqual(chipsOf(groupNamed(page, '父母')), []);
  assert.deepEqual(chipsOf(groupNamed(page, '子女')), ['张小满']);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('adding a parent from the bar writes the links, and the bar shows the new one at once', async () => {
  const library = createLibrary({ faces, albums });
  const graph = await withGraph(library);
  await library.invoke('set_household_edges', {
    householdId: graph,
    edges: [{ kind: 'parent', fromNode: library.idOf('张伟'), toNode: library.idOf('张小满') }],
  });
  const page = await openPage(library);

  await click(rowOfMember(page, '张小满'));
  await settle();
  const before = library.log.length;

  const parents = groupNamed(page, '父母');
  const adder = adderOf(parents);
  assert.ok(adder, 'there is no way to add a parent');
  // The father is already a parent: the choice is the mother or the grandmother.
  const offered = adder.children.filter((option) => option.tag === 'option').map(textOf);
  assert.deepEqual(offered, ['李静', '王秀兰']);
  await change(adder, library.idOf('李静'));
  await settle();

  const writes = library.log.slice(before).filter((entry) => entry.command === 'set_household_edges');
  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0].args.edges.map((edge) => [edge.kind, edge.fromNode, edge.toNode]),
    [['parent', library.idOf('张伟'), library.idOf('张小满')], ['parent', library.idOf('李静'), library.idOf('张小满')]],
  );
  // The page read the graph back.
  assert.deepEqual(chipsOf(groupNamed(page, '父母')), ['张伟', '李静']);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('a student is stored as a teacher link pointing the other way, and reads as a teacher for the student', async () => {
  const library = createLibrary({ faces, albums });
  const graph = await withGraph(library);
  const page = await openPage(library);

  await click(rowOfMember(page, '张小满'));
  await settle();
  const social = groupNamed(page, '社交');
  const [label, adder] = selectsIn(social);
  await change(label, 'student');
  await change(adder, library.idOf('李静'));
  await settle();

  const stored = library.state.edges.find((edge) => edge.kind === 'social');
  assert.deepEqual(
    { from: stored.fromNode, to: stored.toNode, label: stored.label },
    { from: library.idOf('李静'), to: library.idOf('张小满'), label: 'teacher' },
  );
  assert.deepEqual(chipsOf(groupNamed(page, '社交')), ['李静（老师）']);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('a batch the library refuses leaves the page and the links as they were', async () => {
  const library = createLibrary({ faces, albums });
  const graph = await withGraph(library);
  await library.invoke('set_household_edges', {
    householdId: graph,
    edges: [{ kind: 'parent', fromNode: library.idOf('张伟'), toNode: library.idOf('张小满') }],
  });
  const page = await openPage(library);

  await click(rowOfMember(page, '张伟'));
  await settle();
  const reads = library.log.filter((entry) => entry.command === 'get_household_overview').length;

  // Making the child a parent of the father closes a circle.
  await change(adderOf(groupNamed(page, '父母')), library.idOf('张小满'));
  await settle();

  assert.equal(library.state.edges.length, 1);
  assert.deepEqual(chipsOf(groupNamed(page, '子女')), ['张小满']);
  assert.equal(
    library.log.filter((entry) => entry.command === 'get_household_overview').length,
    reads,
    'the page reloaded a graph it had not changed',
  );
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('the gender and the year of birth are saved on the person, and the word follows', async () => {
  const library = createLibrary({ faces, albums });
  const graph = await withGraph(library, { root: '张伟' });
  await library.invoke('set_household_edges', {
    householdId: graph,
    edges: [{ kind: 'parent', fromNode: library.idOf('张伟'), toNode: library.idOf('张小满') }],
  });
  const page = await openPage(library);

  await click(rowOfMember(page, '张小满'));
  await settle();
  // Nobody said who the child is: the word stays neutral.
  assert.match(page.text(), /张小满孩子/);
  const save = buttonNamed(page.root, '保存');
  assert.equal(save.props.disabled, true, 'nothing changed, so there is nothing to save');

  const gender = selectsIn(page.root).find((select) => select.children.some((option) => option.props.value === 'female'));
  const year = findAll(page.root, (node) => node.tag === 'input' && node.props.type === 'text')[0];
  await change(gender, 'male');
  await change(year, '2011');
  await settle();
  assert.equal(save.props.disabled, false);
  await click(save);
  await settle();

  const written = library.log.filter((entry) => entry.command === 'upsert_household_node').at(-1);
  assert.equal(written.args.node.gender, 'male');
  assert.equal(written.args.node.birthDate, '2011');
  assert.deepEqual(written.args.node.anchors, ['张小满']);
  assert.match(page.text(), /张小满儿子/);
  assert.equal(save.props.disabled, true, 'what was saved is no longer a change');
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('making a person the root moves the badge and the word', async () => {
  const library = createLibrary({ faces, albums });
  const graph = await withGraph(library);
  await library.invoke('set_household_edges', {
    householdId: graph,
    edges: [{ kind: 'parent', fromNode: library.idOf('张伟'), toNode: library.idOf('张小满') }],
  });
  const page = await openPage(library);

  await click(rowOfMember(page, '张伟'));
  await settle();
  assert.equal(buttonNamed(page.root, '以此人为根').props.disabled, false);
  await click(buttonNamed(page.root, '以此人为根'));
  await settle();

  assert.equal(library.state.households[0].rootNodeId, library.idOf('张伟'));
  assert.equal(textOf(rowOfMember(page, '张伟')).trim(), '张伟根');
  assert.match(page.text(), /根: 张伟/);
  // The old root is a son now.
  assert.match(page.text(), /张小满儿子|张小满孩子/);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('a name that is not in the graph joins it from the column on the left', async () => {
  const library = createLibrary({ faces, albums });
  await withGraph(library, { members: ['张小满'] });
  const page = await openPage(library);

  assert.match(page.text(), /未加入 \(4\)/);
  const row = rowOfMember(page, '陈小雨');
  assert.ok(row, 'the name is not offered');
  await click(row);
  await settle();

  const names = library.log.filter((entry) => entry.command === 'import_household_nodes').at(-1);
  assert.deepEqual(names.args.person_names, ['陈小雨']);
  assert.match(page.text(), /成员 \(2\)/);
  assert.doesNotMatch(page.text(), /未加入 \(4\)/);
  assert.deepEqual(page.problems, []);
  page.unmount();
});

test('the real button keeps the contract the page relies on', () => {
  const source = fs.readFileSync(path.join(SRC, 'components', 'TButton.vue'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(source, /^\s*text:\s*\{/m, 'the button no longer takes a text');
  assert.match(source, /^\s*disabled:\s*\{/m, 'the button no longer takes disabled');
  assert.match(source, /defineEmits\(\['click'\]\)/, 'the button no longer says when it is clicked');
});
