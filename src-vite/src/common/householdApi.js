// The household graph commands. Same shape as the rest of api.js: the caller
// gets the value, or null when the call failed.
import { invoke } from '@/common/transport';

export async function getHouseholdOverview() {
  try {
    // A library without the tables of the module answers null, not an empty
    // object: there is no graph at all.
    return await invoke('get_household_overview');
  } catch (error) {
    console.error('Failed to read the household graphs:', error);
    return null;
  }
}

/**
 * The albums a graph can apply to: just the id and the name.
 *
 * The full album list costs a request per album for its flags, which this
 * dialog does not need.
 */
export async function listAlbumChoices() {
  try {
    const albums = await invoke('get_all_albums', { refreshAccessibility: false });
    return (albums ?? []).map((album) => ({ id: album.id, name: album.name }));
  } catch (error) {
    console.error('Failed to list the albums:', error);
    return [];
  }
}

export async function listFaceNamesForHousehold() {
  try {
    return (await invoke('list_face_names_for_household')) ?? null;
  } catch (error) {
    console.error('Failed to list the names of faces:', error);
    return null;
  }
}

/** How many people a page of the people list carries; the library allows no more. */
const PERSON_PAGE = 100;

/**
 * A face the library keeps, as the address of a picture.
 *
 * The library keeps a face as the JPEG itself and hands it over as bare
 * base64 (`Person::get_page`); a page can only show it with the whole data
 * address in front, the way the people panel puts it. Something that is an
 * address already is left alone.
 *
 * @param {string | null | undefined} thumbnail
 * @returns {string | null}
 */
export function faceSource(thumbnail) {
  const value = typeof thumbnail === 'string' ? thumbnail.trim() : '';
  if (!value) return null;
  return /^data:/.test(value) ? value : `data:image/jpeg;base64,${value}`;
}

/**
 * Everybody in the people panel, with the face the library keeps for them.
 *
 * A graph knows its people by name, and a face belongs to a person by id: this
 * is the table that joins the two, and brings the face along for the canvas.
 * The names the clustering made up are in it too: a page opened on one of
 * those people has to be able to tell the user why nothing can start from it.
 */
export async function listPersons() {
  const persons = [];
  try {
    for (let page = 0; page < 100; page += 1) {
      const chunk = await invoke('get_persons_page', {
        request: { sort: 0, offset: page * PERSON_PAGE, limit: PERSON_PAGE, search: '', refreshSummary: null },
      });
      for (const person of chunk?.persons ?? []) {
        persons.push({
          id: person.id,
          name: person.name,
          count: person.count ?? null,
          thumbnail: faceSource(person.thumbnail),
        });
      }
      if (!chunk?.has_more) break;
    }
  } catch (error) {
    console.error('Failed to list the people:', error);
  }
  return persons.filter((person) => person?.name);
}

export async function previewHouseholdCard(fileId) {
  try {
    return (await invoke('preview_household_card', { fileId })) ?? null;
  } catch (error) {
    console.error('Failed to build the card:', error);
    return null;
  }
}

export async function createHousehold(name, albumIds, rootNodeName, importNames) {
  try {
    return await invoke('create_household', { name, albumIds, rootNodeName, importNames });
  } catch (error) {
    console.error('Failed to create the graph:', error);
    return null;
  }
}

/**
 * Change a graph. Resolves to true when the library took the change, and to
 * null when it refused it.
 *
 * The command returns nothing, so a caller cannot tell the two apart from
 * the raw result: the answer is made explicit here.
 */
export async function updateHousehold(householdId, changes) {
  try {
    await invoke('update_household', { householdId, ...changes });
    return true;
  } catch (error) {
    console.error('Failed to change the graph:', error);
    return null;
  }
}

/**
 * Delete a graph. The library answers whether there was one to delete; null
 * when the call failed.
 */
export async function deleteHousehold(householdId) {
  try {
    return await invoke('delete_household', { householdId });
  } catch (error) {
    console.error('Failed to delete the graph:', error);
    return null;
  }
}

export async function importHouseholdNodes(personNames) {
  try {
    return (await invoke('import_household_nodes', { personNames })) ?? null;
  } catch (error) {
    console.error('Failed to import the names:', error);
    return null;
  }
}

export async function upsertHouseholdNode(node) {
  try {
    return await invoke('upsert_household_node', { node });
  } catch (error) {
    console.error('Failed to write the object:', error);
    return null;
  }
}

/**
 * Take a person out of every graph, with their links. The library answers
 * whether there was somebody to take out; null when it refused or the call
 * failed (the root of a graph cannot be taken out).
 */
export async function deleteHouseholdNode(nodeId) {
  try {
    return await invoke('delete_household_node', { nodeId });
  } catch (error) {
    console.error('Failed to take the person out:', error);
    return null;
  }
}

/** Replace the members of a graph. True when the library took them, null when it refused. */
export async function setHouseholdMembers(householdId, nodeIds) {
  try {
    await invoke('set_household_members', { householdId, nodeIds });
    return true;
  } catch (error) {
    console.error('Failed to write the members:', error);
    return null;
  }
}

/**
 * Replace the links of a graph. True when the library took them, null when it
 * refused the batch (a link to itself, a parent circle, an unknown kind).
 *
 * The library checks the whole batch before writing any of it, so a refusal
 * leaves every link as it was.
 */
export async function setHouseholdEdges(householdId, edges) {
  try {
    await invoke('set_household_edges', { householdId, edges });
    return true;
  } catch (error) {
    console.error('Failed to write the links:', error);
    return null;
  }
}
