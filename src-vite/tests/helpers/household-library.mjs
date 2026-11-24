// An in-memory library behind the graph commands, for the tests and for the
// browser bench (tests/browser/).
//
// It answers the way the Rust commands do: nothing for a command that only
// writes, an error for what it refuses. It is a stand-in, not a second
// implementation: the real one is `t_household.rs`.

const AUTO_NAME = /^person /i;
const STORED_SOCIAL = new Set(['classmate', 'teacher', 'friend', 'colleague', 'neighbour', 'partner']);

const push = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

/**
 * A face as the library keeps it: the bare JPEG and nothing in front of it.
 * `get_persons_page` hands it over exactly so (`Person::get_page`), and the
 * page is the one that turns it into the address of a picture.
 */
export const FACE = 'ZmFjZQ==';

/** What a person is to the root of their graph, the way the library derives it. */
function termOf(state, nodeId, rootId) {
  if (nodeId === rootId) return null;
  const parentsOf = new Map();
  const childrenOf = new Map();
  const spousesOf = new Map();
  for (const edge of state.edges) {
    if (edge.kind === 'parent') {
      push(parentsOf, edge.toNode, edge.fromNode);
      push(childrenOf, edge.fromNode, edge.toNode);
    }
    if (edge.kind === 'spouse') {
      push(spousesOf, edge.fromNode, edge.toNode);
      push(spousesOf, edge.toNode, edge.fromNode);
    }
  }
  const node = (id) => state.nodes.find((entry) => entry.id === id) ?? null;
  const gender = (id) => node(id)?.gender ?? 'unknown';
  const born = (id) => Number(/^(\d{4})/.exec(String(node(id)?.birthDate ?? ''))?.[1] ?? NaN);
  const elder = (id) => born(id) < born(rootId);
  const of = gender(nodeId);
  const word = (male, female, neutral) => (of === 'male' ? male : of === 'female' ? female : neutral);

  if ((parentsOf.get(rootId) ?? []).includes(nodeId)) return word('父亲', '母亲', '父母');
  if ((childrenOf.get(rootId) ?? []).includes(nodeId)) return word('儿子', '女儿', '孩子');
  if ((spousesOf.get(rootId) ?? []).includes(nodeId)) return word('丈夫', '妻子', '配偶');
  const sibling = (parentsOf.get(rootId) ?? []).some((parent) => (childrenOf.get(parent) ?? []).includes(nodeId));
  if (sibling) {
    if (of === 'male') return elder(nodeId) ? '哥哥' : '弟弟';
    if (of === 'female') return elder(nodeId) ? '姐姐' : '妹妹';
    return '兄弟姐妹';
  }
  for (const parent of parentsOf.get(rootId) ?? []) {
    for (const grand of parentsOf.get(parent) ?? []) {
      if (grand !== nodeId) continue;
      const side = gender(parent) === 'male';
      return word(side ? '爷爷' : '外公', side ? '奶奶' : '外婆', '祖父母');
    }
  }
  for (const spouse of spousesOf.get(rootId) ?? []) {
    if (!(parentsOf.get(spouse) ?? []).includes(nodeId)) continue;
    const hers = gender(rootId) === 'female';
    return word(hers ? '公公' : '岳父', hers ? '婆婆' : '岳母', '岳父母');
  }
  for (const child of childrenOf.get(rootId) ?? []) {
    if ((spousesOf.get(child) ?? []).includes(nodeId)) return word('女婿', '儿媳', '儿媳或女婿');
  }
  return null;
}

/**
 * @param {{ persons?: Array<{ id?: number, name: string, count?: number, thumbnail?: string | null }>, albums?: Array<{ id: number, name: string }> }} [data]
 */
export function createLibrary({ persons = [], albums = [] } = {}) {
  const state = {
    tables: false,
    nodes: [],
    anchors: new Map(),
    households: [],
    edges: [],
    // People are numbered from afar: the objects of a graph start at 1.
    persons: persons.map((person, index) => ({
      id: person.id ?? 1000 + index,
      name: person.name,
      count: person.count ?? 0,
      // A stand-in face unless the caller says there is none.
      thumbnail: person.thumbnail === undefined ? FACE : person.thumbnail,
    })),
    next: 1,
  };
  const log = [];
  // Commands the next call to which fails, the way a library on a read-only
  // disk would: for the tests of what the page does when a write is refused.
  const failures = new Set();

  const nextId = () => {
    state.next += 1;
    return state.next - 1;
  };
  const ownerOf = (name) => state.anchors.get(name) ?? null;
  const nodeById = (id) => state.nodes.find((node) => node.id === id) ?? null;
  const graphById = (id) => state.households.find((graph) => graph.id === id) ?? null;
  const named = () => state.persons.filter((person) => !AUTO_NAME.test(person.name.trim()));

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
      if (edge.kind === 'parent') push(above, edge.toNode, edge.fromNode);
    }
    for (const start of above.keys()) {
      const seen = new Set();
      const stack = [start];
      while (stack.length) {
        const current = stack.pop();
        if (seen.has(current)) return true;
        seen.add(current);
        stack.push(...(above.get(current) ?? []));
      }
    }
    return false;
  }

  const commands = {
    get_household_overview() {
      if (!state.tables) return null;
      return {
        households: state.households.map((graph) => ({ ...graph, albumIds: [...graph.albumIds], memberIds: [...graph.memberIds] })),
        nodes: state.nodes.map((node) => ({
          ...node,
          anchors: [...state.anchors].filter(([, id]) => id === node.id).map(([name]) => name),
          term: (() => {
            const graph = state.households.find((entry) => entry.memberIds.includes(node.id));
            return graph ? termOf(state, node.id, graph.rootNodeId) : null;
          })(),
        })),
        edges: state.edges.map((edge) => ({ ...edge })),
      };
    },
    list_face_names_for_household() {
      return named().map((person) => ({ name: person.name, count: person.count, imported: ownerOf(person.name) != null }));
    },
    get_persons_page({ request }) {
      // Like the people panel: everybody, the made-up names included.
      const needle = String(request?.search ?? '').trim().toLowerCase();
      const all = state.persons.filter((person) => person.name.toLowerCase().includes(needle));
      const offset = request?.offset ?? 0;
      const limit = Math.min(100, Math.max(1, request?.limit ?? 100));
      return {
        persons: all.slice(offset, offset + limit).map((person) => ({ ...person })),
        has_more: offset + limit < all.length,
        total: all.length,
      };
    },
    get_person_thumbnail({ person_id }) {
      return state.persons.find((person) => person.id === person_id)?.thumbnail ?? null;
    },
    get_all_albums() {
      return albums.map((album) => ({ id: album.id, name: album.name }));
    },
    create_household({ name, album_ids, root_node_name, import_names }) {
      if (!name || !name.trim()) throw new Error('A graph needs a name');
      if (state.households.some((graph) => graph.name === name.trim())) throw new Error('There is a graph of that name already');
      state.tables = true;
      const imported = importNames(import_names ?? []);
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
      if (name !== undefined) {
        if (state.households.some((other) => other.id !== graph.id && other.name === name.trim())) {
          throw new Error('There is a graph of that name already');
        }
        graph.name = name.trim();
      }
      if (enabled !== undefined) graph.enabled = enabled;
      if (album_ids !== undefined) graph.albumIds = [...album_ids];
      if (root_node_id !== undefined) {
        if (!nodeById(root_node_id)) throw new Error('The object to make the root is gone');
        graph.rootNodeId = root_node_id;
      }
      return null;
    },
    delete_household({ household_id }) {
      const at = state.households.findIndex((graph) => graph.id === household_id);
      if (at < 0) return false;
      state.households.splice(at, 1);
      return true;
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
      for (const name of node.anchors ?? []) {
        if (ownerOf(name) != null) throw new Error(`${name} already belongs to another object`);
        state.anchors.set(name, target.id);
      }
      return target.id;
    },
    delete_household_node({ node_id }) {
      if (state.households.some((graph) => graph.rootNodeId === node_id)) {
        throw new Error('The root of a graph cannot be deleted');
      }
      const at = state.nodes.findIndex((node) => node.id === node_id);
      if (at < 0) return false;
      state.nodes.splice(at, 1);
      for (const [name, ownerId] of [...state.anchors]) {
        if (ownerId === node_id) state.anchors.delete(name);
      }
      state.edges = state.edges.filter((edge) => edge.fromNode !== node_id && edge.toNode !== node_id);
      for (const graph of state.households) {
        graph.memberIds = graph.memberIds.filter((id) => id !== node_id);
      }
      return true;
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
        if (edge.kind === 'social' && !STORED_SOCIAL.has(edge.label)) throw new Error('A social link needs a label the catalog knows');
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
    failures,
    idOf: (name) => ownerOf(name),
    invoke: async (command, args = {}) => {
      const snake = toSnake(args);
      log.push({ command, args: snake });
      if (failures.delete(command)) throw new Error(`refused on purpose: ${command}`);
      const run = commands[command];
      if (!run) throw new Error(`no such command: ${command}`);
      return run(snake);
    },
  };
}

/**
 * A family to look at: three generations round 张伟, with the names the
 * documents of the project use for make-believe people.
 *
 * Every person gets a face unless `faces` says otherwise; `faces` is a list of
 * image URLs handed out in order.
 */
export function createFamilyLibrary({ faces = [], albums = [{ id: 1, name: '家庭' }, { id: 2, name: '旅行' }], graph = true } = {}) {
  const people = [
    ['张建国', 'male', '1952', 214], ['周慧兰', 'female', '1954', 198],
    ['李国栋', 'male', '1950', 96], ['刘慧', 'female', '1951', 88],
    ['张伟', 'male', '1980', 431], ['张伟民', 'male', '1984', 150],
    ['李静', 'female', '1982', 428], ['刘敏', 'female', '1986', 77],
    ['张小满', 'female', '2011', 1204], ['张小北', 'male', '2015', 640],
    ['陈小雨', 'female', '2009', 32], ['王强', 'male', '1979', 21],
  ];
  const library = createLibrary({
    albums,
    persons: people.map(([name, , , count], index) => ({
      name, count, thumbnail: faces[index] === undefined ? undefined : faces[index],
    })),
  });
  if (!graph) return library;

  // The stand-in answers at once, so the graph can be seeded without awaits.
  const id = (name) => library.idOf(name);
  library.invoke('create_household', {
    name: '张伟家', albumIds: albums.map((album) => album.id), rootNodeName: '张伟',
    importNames: people.filter(([name]) => name !== '王强').map(([name]) => name),
  });
  for (const [name, gender, birthDate] of people) {
    library.invoke('upsert_household_node', {
      node: {
        id: id(name), kind: 'person', displayName: name, gender, birthDate, birthPlace: null, notes: null,
        shareAge: true, shareDetails: false, anchors: [name],
      },
    });
  }
  const link = (kind, from, to, label = null) => ({ kind, fromNode: id(from), toNode: id(to), label });
  library.invoke('set_household_edges', {
    householdId: library.state.households[0].id,
    edges: [
      link('spouse', '张建国', '周慧兰'),
      link('parent', '张建国', '张伟'), link('parent', '周慧兰', '张伟'),
      link('parent', '张建国', '张伟民'), link('parent', '周慧兰', '张伟民'),
      link('spouse', '李国栋', '刘慧'),
      link('parent', '李国栋', '李静'), link('parent', '刘慧', '李静'),
      link('spouse', '张伟', '李静'),
      link('parent', '张伟', '张小满'), link('parent', '李静', '张小满'),
      link('parent', '张伟', '张小北'), link('parent', '李静', '张小北'),
      link('spouse', '张伟民', '刘敏'),
      link('social', '陈小雨', '张小满', 'classmate'),
    ],
  });
  library.log.length = 0;
  return library;
}
