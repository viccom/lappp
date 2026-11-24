// Pure logic of the graph page: where everyone stands, how the links of one
// person are grouped, and what is written back when details change.
//
// Nothing here touches state. tests/householdGraph.test.mjs covers it.
import { edgeDraft, layoutGenerations } from './householdLogic.js';
import { isAutoPersonName } from './personMerge.js';

/** The distance between two people on the same row, and the margin of the canvas. */
export const LAYOUT_GAP = 120;
export const LAYOUT_MARGIN = 70;

/**
 * Where each person stands: a row per generation (see `layoutGenerations`),
 * and inside the row a place that keeps the children under their parents
 * and the spouses next to each other.
 *
 * @param {Array<{ id: number }>} [nodes]
 * @param {Array<{ kind: string, fromNode: number, toNode: number }>} [edges]
 * @returns {{ rows: number[][], pos: Map<number, { row: number, x: number }> }}
 */
export function layoutPositions(nodes, edges) {
  const list = Array.isArray(edges) ? edges : [];
  const { generations: rows } = layoutGenerations(nodes, list);
  const parentsOf = new Map();
  for (const edge of list) {
    if (edge.kind !== 'parent') continue;
    if (!parentsOf.has(edge.toNode)) parentsOf.set(edge.toNode, []);
    parentsOf.get(edge.toNode).push(edge.fromNode);
  }

  const pos = new Map();
  for (let row = 0; row < rows.length; row += 1) {
    const ids = [...rows[row]].sort((left, right) => left - right);

    // Spouses stand as one unit.
    const parent = new Map(ids.map((id) => [id, id]));
    const find = (id) => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root);
      return root;
    };
    for (const edge of list) {
      if (edge.kind !== 'spouse') continue;
      if (!parent.has(edge.fromNode) || !parent.has(edge.toNode)) continue;
      const [low, high] = [find(edge.fromNode), find(edge.toNode)].sort((a, b) => a - b);
      parent.set(high, low);
    }
    const units = new Map();
    for (const id of ids) {
      const root = find(id);
      if (!units.has(root)) units.set(root, []);
      units.get(root).push(id);
    }

    // A unit belongs under the parents of the members that have some above.
    const placed = [...units.values()].map((members) => {
      const above = members.flatMap((id) =>
        (parentsOf.get(id) ?? []).map((p) => pos.get(p)?.x).filter((x) => x !== undefined),
      );
      const under = above.length
        ? above.reduce((sum, x) => sum + x, 0) / above.length
        : null;
      return { members, under };
    });
    placed.sort(
      (left, right) =>
        (left.under ?? Infinity) - (right.under ?? Infinity) ||
        Math.min(...left.members) - Math.min(...right.members),
    );

    let cursor = LAYOUT_MARGIN;
    for (const unit of placed) {
      const width = (unit.members.length - 1) * LAYOUT_GAP;
      const start = unit.under === null ? cursor : Math.max(cursor, unit.under - width / 2);
      unit.members.forEach((id, index) => {
        pos.set(id, { row, x: Math.round(start + index * LAYOUT_GAP) });
      });
      cursor = start + width + LAYOUT_GAP;
    }
  }
  return { rows, pos };
}

/** The four groups of links the bar under the canvas shows. */
export const LINK_GROUPS = [
  { kind: 'parents', labelKey: 'household.parents' },
  { kind: 'children', labelKey: 'household.children' },
  { kind: 'spouse', labelKey: 'household.spouse' },
  { kind: 'social', labelKey: 'household.social' },
];

/** The labels a social link can carry, as the interface offers them. */
export const SOCIAL_LABELS = [
  'classmate',
  'teacher',
  'student',
  'friend',
  'colleague',
  'neighbour',
  'partner',
];

/**
 * The group a link belongs to for a person.
 *
 * A parent link is stored from the parent to the child, so the links that
 * point at a person are their parents, and the ones that leave them are
 * their children.
 *
 * @param {{ kind: string, fromNode: number, toNode: number }} edge
 * @param {number} personId
 * @returns {'parents' | 'children' | 'spouse' | 'social' | null}
 */
export function linkGroupOf(edge, personId) {
  const touches = edge.fromNode === personId || edge.toNode === personId;
  if (!touches) return null;
  if (edge.kind === 'parent') return edge.toNode === personId ? 'parents' : 'children';
  if (edge.kind === 'spouse') return 'spouse';
  if (edge.kind === 'social') return 'social';
  return null;
}

/** The person a link connects to the given one. */
export function otherEnd(edge, personId) {
  return edge.fromNode === personId ? edge.toNode : edge.fromNode;
}

/**
 * The word a social link reads as for this person.
 *
 * A teacher link is stored from the teacher to the student: for the teacher
 * the other person is a student, for the student the other one is a teacher.
 *
 * @param {{ label?: string | null, fromNode: number }} edge
 * @param {number} personId
 * @returns {string | null}
 */
export function socialWord(edge, personId) {
  if (edge.label === 'teacher') return edge.fromNode === personId ? 'student' : 'teacher';
  return edge.label ?? null;
}

/** A key that tells two links apart. */
export function linkKey(edge) {
  return `${edge.kind}:${edge.fromNode}>${edge.toNode}:${edge.label ?? ''}`;
}

/**
 * The links of a person, in the four groups the bar shows.
 *
 * @param {object[]} [edges]
 * @param {number} personId
 * @returns {Array<{ kind: string, labelKey: string, links: Array<{ key: string, edge: object, otherId: number, word: string | null }> }>}
 */
export function groupLinks(edges, personId) {
  const groups = LINK_GROUPS.map((group) => ({ ...group, links: [] }));
  for (const edge of Array.isArray(edges) ? edges : []) {
    const kind = linkGroupOf(edge, personId);
    if (!kind) continue;
    groups
      .find((group) => group.kind === kind)
      .links.push({
        key: linkKey(edge),
        edge,
        otherId: otherEnd(edge, personId),
        word: kind === 'social' ? socialWord(edge, personId) : null,
      });
  }
  return groups;
}

/**
 * A new link as the library stores it.
 *
 * `socialLabel` is one of `SOCIAL_LABELS`; "student" is the other way round
 * from "teacher", since only the teacher → student direction is stored.
 *
 * @param {string} kind one of the groups
 * @param {number} personId
 * @param {number} otherId
 * @param {string} [socialLabel]
 * @returns {object | null}
 */
export function makeLink(kind, personId, otherId, socialLabel) {
  switch (kind) {
    case 'parents':
      return edgeDraft('parent', otherId, personId);
    case 'children':
      return edgeDraft('parent', personId, otherId);
    case 'spouse':
      return edgeDraft('spouse', personId, otherId);
    case 'social':
      return socialLabel === 'student'
        ? edgeDraft('social', otherId, personId, 'teacher')
        : edgeDraft('social', personId, otherId, socialLabel);
    default:
      return null;
  }
}

/** The object as it is written back when a link is taken away. */
export function edgePayload(edge) {
  return {
    kind: edge.kind,
    fromNode: edge.fromNode,
    toNode: edge.toNode,
    label: edge.label ?? null,
    termOverride: edge.termOverride ?? null,
    validFrom: edge.validFrom ?? null,
    validTo: edge.validTo ?? null,
    source: edge.source ?? 'user',
  };
}

/** The year of a birth date like '2011' or '2011-05-07'. */
export function birthYearOf(birthDate) {
  const match = /^(\d{4})/.exec(String(birthDate ?? '').trim());
  return match ? Number(match[1]) : null;
}

/**
 * The object as it is written back when the gender or the year of birth
 * changes. Everything else is carried over as it was, the anchors included.
 *
 * @param {object} node the object as the overview gives it
 * @param {{ gender: string, birthYear: number | null }} details
 * @returns {object}
 */
export function nodeWithDetails(node, details) {
  return {
    id: node.id,
    kind: node.kind ?? 'person',
    displayName: node.displayName ?? null,
    gender: details.gender,
    birthDate: details.birthYear == null ? null : String(details.birthYear),
    birthPlace: node.birthPlace ?? null,
    notes: node.notes ?? null,
    shareAge: node.shareAge !== false,
    shareDetails: node.shareDetails === true,
    anchors: Array.isArray(node.anchors) ? node.anchors : [],
  };
}

/**
 * The faces that could join a graph: the ones whose name stands for nobody
 * yet, and the ones that stand for a person who is not in this graph.
 *
 * @param {Array<{ name: string }>} [faceNames] every name the user gave
 * @param {Array<{ id: number, anchors?: string[] }>} [nodes] every object of the library
 * @param {number[]} [memberIds] the objects of the graph that is open
 * @returns {Array<{ name: string, count?: number, nodeId: number | null }>}
 */
export function facesOutsideGraph(faceNames, nodes, memberIds) {
  const members = new Set(Array.isArray(memberIds) ? memberIds : []);
  return (Array.isArray(faceNames) ? faceNames : [])
    .filter((entry) => entry && !isAutoPersonName(entry.name))
    .map((entry) => ({
      ...entry,
      nodeId:
        (Array.isArray(nodes) ? nodes : []).find((node) =>
          (node.anchors ?? []).includes(entry.name),
        )?.id ?? null,
    }))
    .filter((entry) => entry.nodeId === null || !members.has(entry.nodeId));
}
