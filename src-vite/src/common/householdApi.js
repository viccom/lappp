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

export async function updateHousehold(householdId, changes) {
  try {
    return await invoke('update_household', { householdId, ...changes });
  } catch (error) {
    console.error('Failed to change the graph:', error);
    return null;
  }
}

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

export async function deleteHouseholdNode(nodeId) {
  try {
    return await invoke('delete_household_node', { nodeId });
  } catch (error) {
    console.error('Failed to delete the object:', error);
    return null;
  }
}

export async function setHouseholdMembers(householdId, nodeIds) {
  try {
    return await invoke('set_household_members', { householdId, nodeIds });
  } catch (error) {
    console.error('Failed to write the members:', error);
    return null;
  }
}

export async function setHouseholdEdges(householdId, edges) {
  try {
    return await invoke('set_household_edges', { householdId, edges });
  } catch (error) {
    console.error('Failed to write the links:', error);
    return null;
  }
}
