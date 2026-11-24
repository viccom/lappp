// Pure logic behind "link these people to an existing name".
// Nothing here touches state or the backend; the people panel and the merge
// dialog call these, and tests/personMerge.test.mjs covers them.

// How many past links are remembered so one of them can be undone.
export const MAX_MERGE_RECORDS = 20;

/**
 * Whether a person row carries a name the user typed.
 *
 * The library gives every unnamed cluster a name like "Person 12", and the
 * backend treats anything starting with "Person " as automatic, whatever the
 * case (see the name snapshot query in t_sqlite.rs). This mirrors that.
 *
 * @param {string | null | undefined} name
 * @returns {boolean} true when the name is missing or was made up by the clustering
 */
export function isAutoPersonName(name) {
  return typeof name !== 'string' || name.trim() === '' || /^person /i.test(name);
}

/**
 * The people a merge can point at: the ones the user named, minus the rows
 * being merged, narrowed to the names that contain the search text.
 *
 * The input is left alone; the result is sorted by name.
 *
 * @param {Array<{ id: number, name: string | null }>} [persons] every person row the panel knows
 * @param {{ excludeIds?: number[], query?: string }} [options]
 * @returns {Array<any>}
 */
export function mergeTargets(persons, options) {
  const { excludeIds = [], query = '' } = options ?? {};
  const excluded = new Set(Array.isArray(excludeIds) ? excludeIds : []);
  const needle = String(query ?? '').trim().toLowerCase();
  return (Array.isArray(persons) ? persons : [])
    .filter((person) => person && !isAutoPersonName(person.name))
    .filter((person) => !excluded.has(person.id))
    .filter((person) => person.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * The numbers the confirmation text needs before people are merged.
 * A face count that is missing or not a positive number counts as zero.
 *
 * @param {Array<{ count?: number }>} [sources] the people about to be merged
 * @param {{ name?: string | null }} [target] the person they are merged into
 * @returns {{ count: number, faces: number, name: string }}
 */
export function mergeConfirmParams(sources, target) {
  const list = Array.isArray(sources) ? sources : [];
  const faces = list.reduce((sum, source) => {
    const count = source?.count;
    return sum + (typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0);
  }, 0);
  return { count: list.length, faces, name: target?.name ?? '' };
}

/**
 * Whether a remembered link carries enough to be undone from.
 *
 * @param {unknown} record
 * @returns {boolean}
 */
function canBeUndone(record) {
  return Boolean(
    record
    && typeof record === 'object'
    && typeof record.targetName === 'string'
    && record.targetName.trim() !== ''
    && Array.isArray(record.faceIds)
    && record.faceIds.length > 0
  );
}

/**
 * Remember a link so it can be undone. Newest first, at most `cap` of them.
 * A record that could not be undone from is ignored and the list is returned as it was.
 *
 * @param {Array<object> | null | undefined} [records]
 * @param {object} record
 * @param {number} [cap]
 * @returns {Array<{ targetId: number, targetName: string, faceIds: number[], at: number }>}
 */
export function pushMergeRecord(records, record, cap = MAX_MERGE_RECORDS) {
  if (!canBeUndone(record)) return records ?? [];
  return [record, ...(Array.isArray(records) ? records : [])].slice(0, Math.max(0, cap));
}

/**
 * After a merge, point the smart albums that listed one of the merged people
 * at the person that survived. Their rules hold a person id, which the merge
 * made disappear.
 *
 * Albums and rules that are not affected are returned as the same objects,
 * and the input is never modified.
 *
 * @template T
 * @param {T[]} [smartAlbums]
 * @param {number[]} mergedPersonIds
 * @param {number} targetPersonId
 * @returns {T[]}
 */
export function remapPersonRules(smartAlbums, mergedPersonIds, targetPersonId) {
  if (!Array.isArray(smartAlbums) || !Array.isArray(mergedPersonIds) || mergedPersonIds.length === 0) {
    return smartAlbums;
  }
  const merged = new Set(mergedPersonIds);
  let changed = false;
  const next = smartAlbums.map((album) => {
    const rules = album?.query?.rules;
    if (!Array.isArray(rules)) return album;
    let albumChanged = false;
    const nextRules = rules.map((rule) => {
      if (rule?.field !== 'person' || !merged.has(rule.value)) return rule;
      albumChanged = true;
      return { ...rule, value: targetPersonId };
    });
    if (!albumChanged) return album;
    changed = true;
    return { ...album, query: { ...album.query, rules: nextRules } };
  });
  return changed ? next : smartAlbums;
}

// Stubs: the selection helpers are written next, behind their tests.
const notImplemented = (name) => () => {
  throw new Error(`personMerge.${name} is not implemented`);
};

/**
 * Add a row to the selection, or take it back when it is already in.
 * The list it was given is left alone.
 *
 * @param {number[] | null | undefined} [selectedIds]
 * @param {number} personId
 * @returns {number[]}
 */
export function toggleSelection(selectedIds, personId) {
  const current = Array.isArray(selectedIds) ? selectedIds : [];
  return current.includes(personId)
    ? current.filter((id) => id !== personId)
    : [...current, personId];
}

/**
 * The row the people panel should show after a link: the target when the row
 * that was open was linked away, the open row when it survived.
 *
 * @param {number | null} [openPersonId]
 * @param {number[]} mergedPersonIds
 * @param {number} targetPersonId
 * @returns {number | null}
 */
export function rowAfterMerge(openPersonId, mergedPersonIds, targetPersonId) {
  if (openPersonId == null) return null;
  const merged = Array.isArray(mergedPersonIds) ? mergedPersonIds : [];
  return merged.includes(openPersonId) ? targetPersonId : openPersonId;
}
