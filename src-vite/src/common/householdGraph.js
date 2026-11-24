// Pure logic of the graph page: where everyone stands, what is drawn between
// them, how the links of one person are grouped, and what goes back to the
// library when something changes.
//
// Nothing here touches state. tests/householdGraph.test.mjs covers it.
import { edgeDraft } from './householdLogic.js';
import { isAutoPersonName } from './personMerge.js';

// ---- the measures of the picture ----

/** A person's place on the canvas: their face, their name, and what they are to the root. */
export const NODE_W = 104;
export const NODE_H = 96;
/** The radius of the face, and how far its middle is above the middle of the place. */
export const AVATAR_R = 30;
export const AVATAR_DY = -16;
/** Between the middles of two generations: room for the line down to the children. */
export const ROW_GAP = 168;
/** Between two spouses: the marriage line is drawn in it. */
export const COUPLE_GAP = 44;
/** At least this between two people of a row who are not married to each other. */
export const COL_GAP = 28;
/** The bar above the children, and the join under parents who are not side by side. */
const STUB = 34;
const JOIN = 20;

const none = new Set();
const list = (set) => [...set].sort((left, right) => left - right);
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * The places of one row, each as near to where it wants to be as the gaps
 * between them allow.
 *
 * Neighbours that crowd each other are pooled until they fit, and a pool
 * stands round the middle of what its members wanted: two couples that both
 * want to stand over the same child give way by the same distance.
 */
function settleRow(row, targets, weights, room) {
  // How far each place is from the first one when every gap is at its smallest.
  const lead = [];
  let at = 0;
  row.forEach((block, index) => {
    lead.push(at);
    if (index + 1 < row.length) at += room(index);
  });

  const value = [];
  const weight = [];
  const size = [];
  row.forEach((block, index) => {
    value.push(targets[index] - lead[index]);
    weight.push(weights[index]);
    size.push(1);
    while (value.length > 1 && value.at(-2) > value.at(-1)) {
      const pooledValue = value.pop();
      const pooledWeight = weight.pop();
      const pooledSize = size.pop();
      value[value.length - 1] = (value.at(-1) * weight.at(-1) + pooledValue * pooledWeight) / (weight.at(-1) + pooledWeight);
      weight[weight.length - 1] += pooledWeight;
      size[size.length - 1] += pooledSize;
    }
  });
  let index = 0;
  value.forEach((place, pool) => {
    for (let member = 0; member < size[pool]; member += 1, index += 1) {
      row[index].x = place + lead[index];
    }
  });
}

/**
 * Where each person stands, the way a family tree is drawn.
 *
 * A generation to a row, the parents above their children. Spouses stand side
 * by side, joined; a child stands under the middle of the parents; somebody
 * linked by a social link stands in the row of the person they are linked to.
 * The rows are worked out, not stored: nothing is saved until a link is.
 *
 * @param {Array<{ id: number, birthDate?: string | null }>} [nodes]
 * @param {Array<{ kind: string, fromNode: number, toNode: number }>} [edges]
 * @param {{ rootId?: number | null }} [options]
 * @returns {{ pos: Map<number, { row: number, x: number, y: number }>, rows: number[][], bounds: { left: number, top: number, right: number, bottom: number } | null }}
 */
export function layoutTree(nodes, edges, { rootId = null } = {}) {
  const people = (Array.isArray(nodes) ? nodes : []).filter((node) => node && node.id != null);
  if (!people.length) return { pos: new Map(), rows: [], bounds: null };

  const known = new Set(people.map((node) => node.id));
  const parentsOf = new Map();
  const childrenOf = new Map();
  const spousesOf = new Map();
  const socialOf = new Map();
  const add = (map, id, other) => {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(other);
  };
  const marriages = [];
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || !known.has(edge.fromNode) || !known.has(edge.toNode) || edge.fromNode === edge.toNode) continue;
    if (edge.kind === 'parent') {
      add(parentsOf, edge.toNode, edge.fromNode);
      add(childrenOf, edge.fromNode, edge.toNode);
    } else if (edge.kind === 'spouse') {
      marriages.push(edge);
      add(spousesOf, edge.fromNode, edge.toNode);
      add(spousesOf, edge.toNode, edge.fromNode);
    } else if (edge.kind === 'social') {
      add(socialOf, edge.fromNode, edge.toNode);
      add(socialOf, edge.toNode, edge.fromNode);
    }
  }
  const parents = (id) => parentsOf.get(id) ?? none;
  const children = (id) => childrenOf.get(id) ?? none;
  const partners = (id) => spousesOf.get(id) ?? none;
  const friends = (id) => socialOf.get(id) ?? none;

  // ---- which row ----
  const start = known.has(rootId) ? rootId : people[0].id;
  const layer = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    const row = layer.get(id);
    const steps = [[parents(id), row - 1], [children(id), row + 1], [partners(id), row]];
    for (const [others, at] of steps) {
      for (const other of list(others)) {
        if (layer.has(other)) continue;
        layer.set(other, at);
        queue.push(other);
      }
    }
  }
  // A social link says "the same generation as", and nothing about which.
  for (let again = true; again;) {
    again = false;
    for (const node of people) {
      if (!layer.has(node.id)) continue;
      for (const other of list(friends(node.id))) {
        if (layer.has(other)) continue;
        layer.set(other, layer.get(node.id));
        again = true;
      }
    }
  }

  // ---- the order inside a row ----
  // The order people are met walking out from the root: parents, the spouse,
  // the children (the eldest first), then whoever else is linked.
  const yearOf = new Map(people.map((node) => [node.id, birthYearOf(node.birthDate)]));
  const eldest = (left, right) => (yearOf.get(left) ?? Infinity) - (yearOf.get(right) ?? Infinity) || left - right;
  const reach = [];
  const met = new Set([start]);
  const walk = [start];
  while (walk.length) {
    const id = walk.shift();
    reach.push(id);
    const next = [...list(parents(id)), ...list(partners(id)), ...list(children(id)).sort(eldest), ...list(friends(id))];
    for (const other of next) {
      if (met.has(other)) continue;
      met.add(other);
      walk.push(other);
    }
  }

  const lowest = Math.min(...layer.values());
  const rowOf = new Map(people.map((node) => [node.id, (layer.get(node.id) ?? layer.get(start)) - lowest]));
  const rows = [];
  const takeRow = (row) => {
    while (rows.length <= row) rows.push([]);
    return rows[row];
  };
  for (const id of reach) takeRow(rowOf.get(id)).push(id);
  // Whoever is not linked to anybody stands in the row of the root, after the rest.
  const unlinked = people.filter((node) => !met.has(node.id)).map((node) => node.id).sort((left, right) => left - right);
  for (const id of unlinked) takeRow(rowOf.get(id)).push(id);
  const rank = new Map(reach.map((id, index) => [id, index]));

  // Spouses stand as one: a block moves as a whole.
  const blocks = rows.map((row) => {
    const at = new Map(row.map((id, index) => [id, index]));
    const up = row.map((_, index) => index);
    const find = (index) => {
      while (up[index] !== index) index = up[index];
      return index;
    };
    for (const edge of marriages) {
      if (!at.has(edge.fromNode) || !at.has(edge.toNode)) continue;
      const first = find(at.get(edge.fromNode));
      const second = find(at.get(edge.toNode));
      if (first !== second) up[Math.max(first, second)] = Math.min(first, second);
    }
    const groups = new Map();
    for (const id of row) {
      const key = find(at.get(id));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    }
    const place = (id) => rank.get(id) ?? reach.length + at.get(id);
    return [...groups.values()].map((members) => ({
      members: members.sort((left, right) => place(left) - place(right)),
      x: 0,
    }));
  });

  const seat = new Map();
  blocks.forEach((row, index) => {
    row.forEach((block) => {
      block.row = index;
      block.members.forEach((id, at) => seat.set(id, { block, at }));
    });
  });
  const spread = (block) => (block.members.length - 1) * (NODE_W + COUPLE_GAP);
  const half = (block) => (spread(block) + NODE_W) / 2;
  const xOf = (id) => {
    const { block, at } = seat.get(id);
    return block.x - spread(block) / 2 + at * (NODE_W + COUPLE_GAP);
  };
  // Who stands one row above or below: a parent or a child.
  const across = new Map(people.map((node) => [node.id, [...parents(node.id), ...children(node.id)]]));
  // Who hangs on a social link alone: linked to somebody of their row, and to
  // nobody above or below.
  const hangsOn = (block) => {
    if (block.members.some((id) => across.get(id).length > 0)) return null;
    const anchorId = block.members
      .flatMap((id) => list(friends(id)))
      .find((other) => rowOf.get(other) === block.row && !block.members.includes(other));
    return anchorId ?? null;
  };

  const pack = () => {
    for (const row of blocks) {
      let cursor = 0;
      for (const block of row) {
        block.x = cursor + half(block);
        cursor = block.x + half(block) + COL_GAP;
      }
    }
  };

  // ---- the order of the blocks: as few crossing lines as a few passes get ----
  pack();
  for (let pass = 0; pass < 3; pass += 1) {
    for (const down of [true, false]) {
      const first = down ? 1 : rows.length - 2;
      for (let row = first; row >= 0 && row < rows.length - (down ? 0 : 1); row += down ? 1 : -1) {
        const reference = down ? row - 1 : row + 1;
        const order = new Map(blocks[row].map((block, index) => [block, index]));
        const pull = (block) => {
          const wanted = block.members
            .flatMap((id) => across.get(id))
            .filter((other) => rowOf.get(other) === reference)
            .map(xOf);
          if (wanted.length) return median(wanted);
          return xOf(block.members[0]) + order.get(block) / blocks[row].length;
        };
        blocks[row] = [...blocks[row]].sort((left, right) => pull(left) - pull(right));
        // The next pass reads these places: they must be the ones this order gives.
        pack();
      }
    }
  }

  // ---- who hangs on whom: right beside them, on the side the family leaves free ----
  // A classmate or a friend does not stand between two brothers: they go
  // outside the brothers and sisters, and outside the spouse.
  for (const row of blocks) {
    const where = new Map(row.map((block, index) => [block, index]));
    const hanging = new Map();
    for (const block of row) {
      const anchorId = hangsOn(block);
      if (anchorId === null) {
        block.side = 0;
        continue;
      }
      const anchor = seat.get(anchorId).block;
      const siblings = [...parents(anchorId)].flatMap((parent) => [...children(parent)]).filter((id) => id !== anchorId);
      const familyAfter = [...partners(anchorId), ...siblings].some((id) =>
        rowOf.get(id) === block.row && where.get(seat.get(id).block) > where.get(anchor),
      );
      block.side = familyAfter ? -1 : 1;
      if (!hanging.has(anchor)) hanging.set(anchor, []);
      hanging.get(anchor).push(block);
    }
    if (!hanging.size) continue;

    const next = [];
    const placed = new Set();
    const visiting = new Set();
    const add = (block) => {
      if (placed.has(block)) return;
      placed.add(block);
      // Whoever hangs on this one goes just before or just after it.
      for (const other of hanging.get(block) ?? []) {
        if (other.side < 0 && !placed.has(other)) {
          placed.add(other);
          next.push(other);
        }
      }
      next.push(block);
      for (const other of hanging.get(block) ?? []) {
        if (other.side > 0 && !placed.has(other)) {
          placed.add(other);
          next.push(other);
        }
      }
    };
    for (const block of row) {
      // One that hangs on another is put in by that other, unless the two hang on each other.
      const anchorId = hangsOn(block);
      const anchor = anchorId === null ? null : seat.get(anchorId).block;
      if (anchor && anchor !== block && !visiting.has(anchor) && where.has(anchor)) {
        visiting.add(block);
        add(anchor);
        visiting.delete(block);
      } else {
        add(block);
      }
    }
    row.splice(0, row.length, ...next);
  }
  pack();

  // ---- the places: everybody under the middle of who they belong to ----
  for (let sweep = 0; sweep < 60; sweep += 1) {
    const down = sweep % 2 === 0;
    let moved = 0;
    const first = down ? 1 : rows.length - 2;
    for (let row = first; row >= 0 && row < rows.length - (down ? 0 : 1); row += down ? 1 : -1) {
      const reference = down ? row - 1 : row + 1;
      const targets = [];
      const weights = [];
      blocks[row].forEach((block, index) => {
        const wanted = block.members
          .flatMap((id) => across.get(id))
          .filter((other) => rowOf.get(other) === reference)
          .map(xOf);
        if (wanted.length) {
          targets.push(median(wanted));
          weights.push(1);
          return;
        }
        // Nobody above or below: keep to the person of the social link instead.
        const anchorId = hangsOn(block);
        if (anchorId !== null) {
          targets.push(xOf(anchorId) + (block.side || 1) * (NODE_W + COL_GAP));
          weights.push(1);
          return;
        }
        // Nothing to go by: it tucks up against whichever neighbour there is,
        // and does not pull anybody.
        const room = (other) => half(block) + COL_GAP + half(other);
        targets.push(index > 0 ? blocks[row][index - 1].x + room(blocks[row][index - 1]) : blocks[row][index + 1].x - room(blocks[row][index + 1]));
        weights.push(0);
      });
      const before = blocks[row].map((block) => block.x);
      settleRow(blocks[row], targets, weights, (index) => half(blocks[row][index]) + COL_GAP + half(blocks[row][index + 1]));
      moved += blocks[row].reduce((sum, block, index) => sum + Math.abs(block.x - before[index]), 0);
    }
    if (sweep >= 3 && moved < 0.01) break;
  }

  // ---- the picture ----
  const pos = new Map();
  for (const standing of blocks) {
    for (const block of standing) {
      block.members.forEach((id) => {
        pos.set(id, { row: rowOf.get(id), x: xOf(id), y: rowOf.get(id) * ROW_GAP });
      });
    }
  }
  // The leftmost card starts at zero.
  const leftmost = Math.min(...[...pos.values()].map((place) => place.x)) - NODE_W / 2;
  for (const [id, place] of pos) place.x = Math.round(place.x - leftmost);
  return {
    pos,
    rows,
    bounds: {
      left: 0,
      top: Math.min(...[...pos.values()].map((place) => place.y)) - NODE_H / 2,
      right: Math.max(...[...pos.values()].map((place) => place.x)) + NODE_W / 2,
      bottom: Math.max(...[...pos.values()].map((place) => place.y)) + NODE_H / 2,
    },
  };
}

/**
 * What is drawn between the people.
 *
 * A couple is joined by a marriage line between their faces; the line to the
 * children starts from the middle of it, spreads into a bar above the
 * children, and a stub comes down to each. A social link is a curve bowed
 * away from the faces, with a place for its word. Anything the library would
 * not have allowed (a parent below the child) gets a plain line.
 *
 * @param {Map<number, { row: number, x: number, y: number }>} pos
 * @param {Array<{ kind: string, fromNode: number, toNode: number, label?: string | null, validTo?: number | null }>} [edges]
 * @returns {{ couples: object[], families: object[], socials: object[], others: object[] }}
 */
export function drawLines(pos, edges) {
  const drawn = { couples: [], families: [], socials: [], others: [] };
  const at = (id) => pos.get(id);
  const faceY = (id) => at(id).y + AVATAR_DY;
  const top = (id) => at(id).y - NODE_H / 2;
  const bottom = (id) => at(id).y + NODE_H / 2;
  const links = (Array.isArray(edges) ? edges : []).filter(
    (edge) => edge && at(edge.fromNode) && at(edge.toNode) && edge.fromNode !== edge.toNode,
  );

  const parentsOf = new Map();
  for (const edge of links) {
    const a = at(edge.fromNode);
    const b = at(edge.toNode);
    if (edge.kind === 'parent') {
      if (a.y < b.y) {
        if (!parentsOf.has(edge.toNode)) parentsOf.set(edge.toNode, new Set());
        parentsOf.get(edge.toNode).add(edge.fromNode);
      } else {
        drawn.others.push({ key: linkKey(edge), x1: a.x, y1: bottom(edge.fromNode), x2: b.x, y2: top(edge.toNode) });
      }
    } else if (edge.kind === 'spouse' && a.row === b.row) {
      const [left, right] = a.x <= b.x ? [edge.fromNode, edge.toNode] : [edge.toNode, edge.fromNode];
      drawn.couples.push({
        key: linkKey(edge),
        a: edge.fromNode,
        b: edge.toNode,
        x1: at(left).x + AVATAR_R + 4,
        y1: faceY(left),
        x2: at(right).x - AVATAR_R - 4,
        y2: faceY(right),
        ended: edge.validTo != null,
      });
    } else if (edge.kind === 'social') {
      // From the edge of one face to the edge of the other.
      const dx = b.x - a.x;
      const dy = faceY(edge.toNode) - faceY(edge.fromNode);
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const clear = AVATAR_R + 4;
      const sx = a.x + ux * clear;
      const sy = faceY(edge.fromNode) + uy * clear;
      const ex = b.x - ux * clear;
      const ey = faceY(edge.toNode) - uy * clear;
      // The curve bows away from the row (upwards for people side by side),
      // into the room between the rows, so it keeps clear of the faces.
      const bend = Math.max(24, Math.min(46, length * 0.3));
      const cx = (sx + ex) / 2 + uy * bend;
      const cy = (sy + ey) / 2 - ux * bend;
      drawn.socials.push({
        key: linkKey(edge),
        a: edge.fromNode,
        b: edge.toNode,
        label: edge.label ?? null,
        directed: edge.label === 'teacher',
        d: `M ${round(sx)} ${round(sy)} Q ${round(cx)} ${round(cy)} ${round(ex)} ${round(ey)}`,
        // The word sits on the middle of the curve, on a patch of the background.
        lx: round(sx / 4 + cx / 2 + ex / 4),
        ly: round(sy / 4 + cy / 2 + ey / 4),
      });
    } else {
      drawn.others.push({ key: linkKey(edge), x1: a.x, y1: faceY(edge.fromNode), x2: b.x, y2: faceY(edge.toNode) });
    }
  }

  // The children of the same parents hang off one line.
  const byParents = new Map();
  for (const [child, parentSet] of parentsOf) {
    const key = list(parentSet).join(',');
    if (!byParents.has(key)) byParents.set(key, { key, parents: list(parentSet), children: [] });
    byParents.get(key).children.push(child);
  }
  for (const family of byParents.values()) {
    const parents = [...family.parents].sort((left, right) => at(left).x - at(right).x);
    const children = [...family.children].sort((left, right) => at(left).x - at(right).x);
    const childTop = Math.min(...children.map(top));
    const barY = childTop - STUB;
    const end = children.length > 1 ? barY : childTop;
    const first = parents[0];
    const second = parents[1];
    const sideBySide = parents.length === 2 && at(first).row === at(second).row
      && at(second).x - at(first).x <= NODE_W + COUPLE_GAP + 1;
    let drops;
    const joins = [];
    let stem = null;
    if (sideBySide) {
      drops = [{ x: (at(first).x + at(second).x) / 2, y1: faceY(first), y2: end }];
    } else {
      const joinY = Math.max(...parents.map(bottom)) + JOIN;
      drops = parents.map((id) => ({ x: at(id).x, y1: bottom(id), y2: parents.length > 1 ? joinY : end }));
      if (parents.length > 1) {
        joins.push({ x1: at(first).x, x2: at(parents.at(-1)).x, y: joinY });
        stem = { x: parents.reduce((sum, id) => sum + at(id).x, 0) / parents.length, y1: joinY, y2: end };
      }
    }
    const bar = children.length > 1 ? { x1: at(children[0]).x, x2: at(children.at(-1)).x, y: barY } : null;
    const stubs = bar ? children.map((id) => ({ x: at(id).x, y1: barY, y2: top(id) })) : [];
    drawn.families.push({ ...family, parents, children, drops, joins, stem, bar, stubs });
  }
  return drawn;
}

const round = (value) => Math.round(value * 10) / 10;

/**
 * The view that shows the whole picture in the middle of a window.
 *
 * A small picture is not blown up: text and faces stay sharp at 1.
 *
 * @param {{ left: number, top: number, right: number, bottom: number } | null} bounds
 * @param {{ width: number, height: number }} viewport
 * @param {{ padding?: number, maxZoom?: number }} [options]
 * @returns {{ zoom: number, offset: { x: number, y: number } }}
 */
export function fitView(bounds, viewport, { padding = 36, maxZoom = 1 } = {}) {
  if (!bounds || !(viewport.width > 0) || !(viewport.height > 0)) return { zoom: 1, offset: { x: 0, y: 0 } };
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const zoom = Math.min(maxZoom, (viewport.width - padding * 2) / width, (viewport.height - padding * 2) / height);
  const usable = Number.isFinite(zoom) ? Math.max(0.2, zoom) : maxZoom;
  return {
    zoom: usable,
    offset: {
      x: viewport.width / 2 - usable * (bounds.left + width / 2),
      y: viewport.height / 2 - usable * (bounds.top + height / 2),
    },
  };
}

// ---- who may be linked ----

/**
 * Whether making `parent` a parent of `child` would close a circle, which the
 * library refuses: it does when the parent is already below the child.
 *
 * @param {Array<{ kind: string, fromNode: number, toNode: number }>} [edges]
 * @param {number} parent
 * @param {number} child
 * @returns {boolean}
 */
export function wouldCloseParentCircle(edges, parent, child) {
  const below = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (edge.kind !== 'parent') continue;
    if (!below.has(edge.fromNode)) below.set(edge.fromNode, []);
    below.get(edge.fromNode).push(edge.toNode);
  }
  const seen = new Set();
  const stack = [child];
  while (stack.length) {
    const id = stack.pop();
    if (id === parent) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(below.get(id) ?? []));
  }
  return false;
}

// ---- what the page was opened with ----

/** The person the page was opened for, from the query of its address. */
export function personIdIn(search) {
  const value = new URLSearchParams(String(search ?? '')).get('personId');
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

/** The object whose faces carry a name. */
export function nodeForName(nodes, name) {
  return (Array.isArray(nodes) ? nodes : []).find((node) => (node.anchors ?? []).includes(name)) ?? null;
}

/**
 * The key of the word for somebody linked directly: a parent, a child or a
 * spouse. What is not known of them stays unsaid (a child, not a son).
 */
export function kinKey(group, node) {
  const gender = node?.gender ?? 'unknown';
  if (group === 'parents') return gender === 'male' ? 'household.kin.father' : gender === 'female' ? 'household.kin.mother' : 'household.kin.parent';
  if (group === 'children') return gender === 'male' ? 'household.kin.son' : gender === 'female' ? 'household.kin.daughter' : 'household.kin.child';
  if (group === 'spouse') return gender === 'male' ? 'household.kin.husband' : gender === 'female' ? 'household.kin.wife' : 'household.kin.spouse';
  return null;
}

// ---- the links of one person ----

/** The four groups of links the panel of a person shows. */
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
 * The links of a person, in the four groups the panel shows.
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

// ---- who a person is ----

/** The year of a birth date like '2011' or '2011-05-07'. */
export function birthYearOf(birthDate) {
  const match = /^(\d{4})/.exec(String(birthDate ?? '').trim());
  return match ? Number(match[1]) : null;
}

const blank = (value) => (value == null || String(value).trim() === '' ? null : String(value).trim());

/**
 * The object as it is written back when what is known of a person changes.
 * Everything the change leaves out is carried over as it was, the anchors
 * included.
 *
 * @param {object} node the object as the overview gives it
 * @param {{ gender?: string, birthYear?: number | null, birthPlace?: string | null, notes?: string | null, shareAge?: boolean, shareDetails?: boolean }} details
 * @returns {object}
 */
export function nodeWithDetails(node, details) {
  const has = (key) => Object.hasOwn(details, key);
  return {
    id: node.id,
    kind: node.kind ?? 'person',
    displayName: node.displayName ?? null,
    gender: details.gender ?? node.gender ?? 'unknown',
    birthDate: has('birthYear') ? (details.birthYear == null ? null : String(details.birthYear)) : node.birthDate ?? null,
    birthPlace: has('birthPlace') ? blank(details.birthPlace) : node.birthPlace ?? null,
    notes: has('notes') ? blank(details.notes) : node.notes ?? null,
    shareAge: has('shareAge') ? Boolean(details.shareAge) : node.shareAge !== false,
    shareDetails: has('shareDetails') ? Boolean(details.shareDetails) : node.shareDetails === true,
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
