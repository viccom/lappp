// Pure logic behind the household graph page.
// The page and the two fused views call these; nothing here touches state.

import { isAutoPersonName } from './personMerge.js';

/**
 * Where each person stands in the graph.
 *
 * The graph has no coordinates stored: the rows are computed. A parent stands
 * one row above their child, a spouse stands on the row of their partner, and
 * a social link moves nobody.
 *
 * @param {Array<{ id: number }>} [nodes]
 * @param {Array<{ kind: string, fromNode: number, toNode: number }>} [edges]
 * @returns {{ generations: number[][], rowOf: Map<number, number> }}
 */
export function layoutGenerations(nodes, edges) {
  const ids = (Array.isArray(nodes) ? nodes : []).map((node) => node.id);
  const list = Array.isArray(edges) ? edges : [];
  const parents = list.filter((edge) => edge.kind === 'parent');
  const spouses = list.filter((edge) => edge.kind === 'spouse');

  const row = new Map(ids.map((id) => [id, 0]));
  // A few rounds settle a line of a dozen people; the bound keeps a broken
  // graph (a circle the database refused) from spinning here.
  const rounds = Math.max(1, ids.length) * 2 + 2;
  for (let round = 0; round < rounds; round += 1) {
    let changed = false;
    for (const edge of parents) {
      if (!row.has(edge.fromNode) || !row.has(edge.toNode)) continue;
      const want = row.get(edge.fromNode) + 1;
      if (row.get(edge.toNode) < want) {
        row.set(edge.toNode, want);
        changed = true;
      }
    }
    for (const edge of spouses) {
      if (!row.has(edge.fromNode) || !row.has(edge.toNode)) continue;
      const same = Math.max(row.get(edge.fromNode), row.get(edge.toNode));
      if (row.get(edge.fromNode) !== same) {
        row.set(edge.fromNode, same);
        changed = true;
      }
      if (row.get(edge.toNode) !== same) {
        row.set(edge.toNode, same);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // The rows start at the topmost person, not at an empty row.
  const lowest = Math.min(...row.values());
  const generations = [];
  for (const [id, place] of [...row.entries()]) {
    const index = place - lowest;
    while (generations.length <= index) generations.push([]);
    generations[index].push(id);
  }
  for (const generation of generations) generation.sort((left, right) => left - right);
  const rowOf = new Map([...row.entries()].map(([id, place]) => [id, place - lowest]));
  return { generations, rowOf };
}

/**
 * The people a link can point at: the members of the graph, without the
 * person being edited and without the ones already linked.
 *
 * @param {Array<{ id: number, name?: string | null }>} [people]
 * @param {number[]} [memberIds]
 * @param {{ excludeIds?: number[], linkedIds?: number[], query?: string }} [options]
 * @returns {Array<{ id: number, name?: string | null }>}
 */
export function relationCandidates(people, memberIds, options) {
  const { excludeIds = [], linkedIds = [], query = '' } = options ?? {};
  const members = new Set(Array.isArray(memberIds) ? memberIds : []);
  const excluded = new Set([...excludeIds, ...linkedIds]);
  const needle = String(query ?? '').trim().toLowerCase();
  return (Array.isArray(people) ? people : [])
    .filter((person) => person && members.has(person.id) && !excluded.has(person.id))
    .filter((person) => String(person.name ?? '').toLowerCase().includes(needle))
    .sort((left, right) => String(left.name ?? '').localeCompare(String(right.name ?? '')));
}

/**
 * A link as the page sends it to the library.
 *
 * The period of validity and the source are not on the interface in this
 * phase: every link the user draws is a fact of their own.
 *
 * @param {string} kind
 * @param {number} fromNode
 * @param {number} toNode
 * @param {string | null} [label] the social links carry one
 * @returns {{ kind: string, fromNode: number, toNode: number, label: string | null, termOverride: null, validFrom: null, validTo: null, source: string }}
 */
export function edgeDraft(kind, fromNode, toNode, label) {
  return {
    kind,
    fromNode,
    toNode,
    label: label ?? null,
    termOverride: null,
    validFrom: null,
    validTo: null,
    source: 'user',
  };
}

/**
 * The names that could still join the graph: the ones the user gave, that no
 * object stands for yet, and that the caller did not rule out.
 *
 * @param {Array<{ name: string, imported?: boolean }>} [faceNames]
 * @param {Set<string> | string[]} [takenNames]
 * @returns {Array<{ name: string, imported?: boolean }>}
 */
export function unjoinedNames(faceNames, takenNames) {
  const taken = takenNames instanceof Set ? takenNames : new Set(takenNames ?? []);
  return (Array.isArray(faceNames) ? faceNames : []).filter((entry) => {
    if (!entry || entry.imported === true) return false;
    if (taken.has(entry.name)) return false;
    // A name the clustering made up stands for nobody.
    return !isAutoPersonName(entry.name);
  });
}

/**
 * Whether a row of the people panel carries the badge of the root.
 *
 * @param {number | null | undefined} personId
 * @param {number | null | undefined} rootNodeId
 * @returns {boolean}
 */
export function rootBadgeVisible(personId, rootNodeId) {
  return personId != null && rootNodeId != null && personId === rootNodeId;
}

/**
 * The word a person carries relative to the root of their graph.
 *
 * @param {{ nodes?: Array<{ id: number, term?: string | null }> } | null} [overview]
 * @param {number | null | undefined} personId
 * @returns {string | null}
 */
export function personTerm(overview, personId) {
  if (!overview || personId == null) return null;
  const node = (overview.nodes ?? []).find((entry) => entry.id === personId);
  return node?.term ?? null;
}
