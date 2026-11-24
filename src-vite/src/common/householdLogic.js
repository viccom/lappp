// Pure logic behind the household graph, shared by the graph page and the
// two fused views. Nothing here touches state.
//
// Where the people stand and how their links are grouped is in
// householdGraph.js; this is what the people panel and the info panel ask.

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
