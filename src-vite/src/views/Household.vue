<template>
  <div class="flex h-screen flex-col overflow-hidden bg-base-100 text-base-content" data-view="household">
    <!-- top bar: which graph, whether it feeds the model, and where to start another -->
    <header class="hh-bar">
      <span class="hh-bar-title shrink-0">{{ t('household.title') }}</span>
      <template v-if="current">
        <select
          v-if="households.length > 1"
          class="select select-xs select-ghost font-medium hh-graph-name"
          data-role="graph-name"
          :value="currentIndex"
          @change="switchGraph(Number(valueOf($event)))"
        >
          <option v-for="(household, index) in households" :key="household.id" :value="index">{{ household.name }}</option>
        </select>
        <span v-else class="hh-graph-name" data-role="graph-name">{{ current.name }}</span>
        <label class="hh-switch">
          <input
            type="checkbox"
            class="toggle toggle-xs"
            data-role="graph-enabled"
            :checked="current.enabled"
            @change="toggleEnabled(checked($event))"
          />
          <span>{{ t('household.used_for_vision') }}</span>
        </label>
      </template>

      <div class="ml-auto flex shrink-0 items-center gap-1">
        <button
          v-if="current && unjoined.length"
          type="button"
          class="hh-bar-btn"
          data-role="add-people"
          @click="showAdd = true"
        >
          <IconAdd class="w-3.5 h-3.5" />{{ t('household.add_people') }}
        </button>
        <button v-if="current" type="button" class="hh-bar-btn" data-role="new-graph" @click="showNew = true">
          <IconAdd class="w-3.5 h-3.5" />{{ t('household.new') }}
        </button>
        <TButton
          v-if="current"
          :icon="IconSettings"
          :buttonSize="'small'"
          :tooltip="t('household.graph_settings')"
          data-role="graph-settings"
          @click="openSettings"
        />
      </div>
    </header>

    <!-- no graph yet: a graph is started from a person, so pick one -->
    <main v-if="!current" class="hh-start" data-role="root-picker">
      <div class="hh-start-inner">
        <h2 class="hh-start-title">{{ t('household.pick_root_title') }}</h2>
        <p class="hh-start-hint">{{ t('household.pick_root_hint') }}</p>
        <PersonPicker
          grid
          :rows="rootChoices"
          :placeholder="t('household.pick_root_search')"
          :empty-text="t('household.no_named_faces')"
          @pick="openGraphOf"
        />
      </div>
    </main>

    <!-- the graph: the tree in the middle, the person that is selected on the right -->
    <main v-else class="hh-body">
      <HouseholdCanvas
        :people="placed"
        :lines="lines"
        :bounds="bounds"
        :selected-id="selectedNodeId"
        :bare="shownEdges.length === 0"
        @select="selectNode"
        @clear="clearSelection"
      />
      <aside class="hh-side" data-role="side">
        <PersonPanel
          v-if="selectedNode"
          :node="selectedNode"
          :name="nameOf(selectedNode.id)"
          :term="selectedNode.term ?? null"
          :thumbnail="thumbnailOf(selectedNode)"
          :is-root="selectedNode.id === current.rootNodeId"
          :groups="linkGroups"
          :candidates="candidatesByGroup"
          :members="membersById"
          :open-group="pickerGroup"
          :save-state="saveState"
          :elsewhere="elsewhereSelected"
          @close="clearSelection"
          @save="save"
          @select="selectNode"
          @add-link="addLink"
          @remove-link="removeLink"
          @toggle-picker="togglePicker"
          @make-root="makeRoot"
          @remove-person="removePerson"
        />
        <MembersPanel
          v-else
          :name="current.name"
          :members="placed"
          :links="shownEdges.length"
          :unjoined="unjoined"
          @select="selectNode"
          @join="pickToJoin"
        />
      </aside>
    </main>

    <!-- another graph: it starts from a person too, and somebody who has one opens theirs -->
    <ModalDialog v-if="showNew" :title="t('household.new')" :width="560" @cancel="showNew = false">
      <p class="mb-2 text-xs leading-5 text-base-content/55">{{ t('household.new_graph_hint') }}</p>
      <PersonPicker
        grid
        :rows="rootChoices"
        :placeholder="t('household.pick_root_search')"
        :empty-text="t('household.no_named_faces')"
        @pick="openGraphOf"
      />
    </ModalDialog>

    <!-- bring people in -->
    <ModalDialog v-if="showAdd" :title="t('household.add_people')" :width="460" @cancel="showAdd = false">
      <p class="mb-2 text-xs leading-5 text-base-content/55">{{ t('household.add_people_hint') }}</p>
      <PersonPicker
        :rows="addChoices"
        :placeholder="t('household.search_names')"
        :empty-text="t('household.add_people_empty')"
        @pick="pickToJoin"
      />
    </ModalDialog>

    <!-- the graph itself: its name, the albums it applies to, and the end of it -->
    <ModalDialog v-if="showSettings && current" :title="t('household.graph_settings')" :width="440" @cancel="showSettings = false">
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="hh-label">{{ t('household.graph_name') }}</span>
          <input
            type="text"
            class="input input-sm"
            data-role="settings-name"
            :value="draftName"
            @input="draftName = valueOf($event)"
            @keydown.enter.prevent="saveSettings"
          />
        </label>
        <div class="flex flex-col gap-1">
          <span class="hh-label">{{ t('household.albums') }}</span>
          <div class="flex max-h-40 flex-col overflow-y-auto rounded-box border border-base-content/10 p-1">
            <label v-for="album in albums" :key="album.id" class="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm">
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                data-role="settings-album"
                :data-album-id="album.id"
                :checked="draftAlbums.includes(album.id)"
                @change="toggleAlbum(album.id, checked($event))"
              />
              <span class="truncate">{{ album.name }}</span>
            </label>
          </div>
          <span class="text-[11px] text-base-content/40">{{ t('household.albums_hint') }}</span>
        </div>
        <div class="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            class="t-button-default"
            :class="{ 'hh-btn-danger': deleting }"
            data-role="delete-graph"
            @click="askDelete"
          >{{ deleting ? t('household.delete_graph_confirm', { name: current.name }) : t('household.delete_graph') }}</button>
          <button type="button" class="t-button-primary" data-role="settings-save" @click="saveSettings">
            {{ t('household.save_details') }}
          </button>
        </div>
      </div>
    </ModalDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconAdd, IconSettings } from '@/common/icons';
import ModalDialog from '@/components/ModalDialog.vue';
import TButton from '@/components/TButton.vue';
import HouseholdCanvas from '@/components/household/HouseholdCanvas.vue';
import MembersPanel from '@/components/household/MembersPanel.vue';
import PersonPanel from '@/components/household/PersonPanel.vue';
import PersonPicker from '@/components/household/PersonPicker.vue';
import {
  createHousehold,
  deleteHousehold,
  importHouseholdNodes,
  listAlbumChoices,
  listPersons,
  setHouseholdEdges,
  setHouseholdMembers,
  updateHousehold,
  upsertHouseholdNode,
} from '@/common/householdApi';
import {
  LINK_GROUPS,
  drawLines,
  edgePayload,
  facesOutsideGraph,
  groupLinks,
  layoutTree,
  linkKey,
  makeLink,
  nodeForName,
  nodeWithDetails,
  personIdIn,
  wouldCloseParentCircle,
} from '@/common/householdGraph';
import { isAutoPersonName } from '@/common/personMerge';
import { listen } from '@/common/transport';
import { useToast } from '@/common/toast';
import { useHousehold } from '@/composables/useHousehold';

/** An object of the graph, as the overview gives it. */
interface GraphObject {
  id: number;
  [field: string]: any;
}

/** A link between two of them. */
interface GraphEdge {
  kind: string;
  fromNode: number;
  toNode: number;
  [field: string]: any;
}

const { t } = useI18n();
const toast = useToast();
const { overview, faceNames, reload, nameOf } = useHousehold();

/** The value of whatever the user just changed. */
function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function checked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

// ---- what the page shows ----

/** Everybody the user named, with the face the library keeps for them. */
const persons = ref<Array<{ id: number; name: string; count?: number; thumbnail?: string | null }>>([]);
const currentIndex = ref(0);
const selectedNodeId = ref<number | null>(null);
/** The group whose list of people is open, or null. */
const pickerGroup = ref<string | null>(null);
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');

const households = computed<GraphObject[]>(() => overview.value?.households ?? []);
const current = computed<GraphObject>(() => households.value[currentIndex.value] ?? null);
const allNodes = computed<GraphObject[]>(() => overview.value?.nodes ?? []);
const memberNodes = computed<GraphObject[]>(() => {
  const members = new Set<number>(current.value?.memberIds ?? []);
  return allNodes.value.filter((node: GraphObject) => members.has(node.id));
});
/** Every link that touches the graph: the set the library replaces as a whole. */
const graphEdges = computed<GraphEdge[]>(() => {
  const members = new Set<number>(current.value?.memberIds ?? []);
  return (overview.value?.edges ?? []).filter(
    (edge: GraphEdge) => members.has(edge.fromNode) || members.has(edge.toNode),
  );
});
/**
 * The links that are drawn and listed: between two people of the graph.
 *
 * A link belongs to two people, not to a graph. One that leads out of the
 * graph — to somebody who was taken out of it but is in another one — stays
 * in the library and goes into every batch that is written; it is only out of
 * sight here.
 */
const shownEdges = computed<GraphEdge[]>(() => {
  const members = new Set<number>(current.value?.memberIds ?? []);
  return graphEdges.value.filter((edge: GraphEdge) => members.has(edge.fromNode) && members.has(edge.toNode));
});
const selectedNode = computed<GraphObject | null>(
  () => memberNodes.value.find((node: GraphObject) => node.id === selectedNodeId.value) ?? null,
);

/** The face of a person: of the first of their names the library keeps a face for. */
const faceOf = (name: string) => persons.value.find((person) => person.name === name)?.thumbnail ?? null;
const thumbnailOf = (node: GraphObject | null) => {
  for (const name of node?.anchors ?? []) {
    const face = faceOf(name);
    if (face) return face;
  }
  return null;
};

/** The people who could still join: new ones, and people in nobody's graph. */
const unjoined = computed(() =>
  facesOutsideGraph(
    faceNames.value as Array<{ name: string; count?: number }>,
    allNodes.value,
    current.value?.memberIds ?? [],
  ).map((entry) => ({
    ...entry,
    thumbnail: faceOf(entry.name),
  })),
);

// ---- the picture ----

const layout = computed(() => layoutTree(memberNodes.value, shownEdges.value, { rootId: current.value?.rootNodeId ?? null }));
const lines = computed(() => drawLines(layout.value.pos, shownEdges.value));
const placed = computed(() =>
  memberNodes.value.map((node: GraphObject) => {
    const place = layout.value.pos.get(node.id) ?? { x: 0, y: 0, row: 0 };
    return {
      id: node.id,
      name: nameOf(node.id),
      term: node.term ?? null,
      gender: node.gender ?? 'unknown',
      thumbnail: thumbnailOf(node),
      isRoot: node.id === current.value?.rootNodeId,
      x: place.x,
      y: place.y,
      row: place.row,
    };
  }),
);
const bounds = computed(() => {
  const reach = layout.value.bounds;
  // Air for the badge of the root, which stands above their card: the same
  // amount below, so the people stay in the middle.
  return reach ? { ...reach, top: reach.top - 22, bottom: reach.bottom + 22 } : null;
});
const membersById = computed<Record<number, GraphObject>>(() =>
  Object.fromEntries(placed.value.map((person): [number, GraphObject] => [person.id, person])),
);

const linkGroups = computed(() => (selectedNode.value ? groupLinks(shownEdges.value, selectedNode.value.id) : []));

/** For each group, the people a new link of that group could point at. */
const candidatesByGroup = computed<Record<string, Array<Record<string, any>>>>(() => {
  const node = selectedNode.value;
  if (!node) return {};
  const made: Record<string, Set<number>> = Object.fromEntries(
    LINK_GROUPS.map((group): [string, Set<number>] => [group.kind, new Set(groupLinks(shownEdges.value, node.id)
      .find((entry) => entry.kind === group.kind)?.links.map((link) => link.otherId) ?? [])]),
  );
  const rows = (kind: string) => {
    const linked: Set<number> = made[kind];
    const inside = memberNodes.value
      .filter((other: GraphObject) => other.id !== node.id && !linked.has(other.id))
      // The library refuses a parent link that closes a circle: do not offer it.
      .filter((other: GraphObject) => !(kind === 'parents' && wouldCloseParentCircle(graphEdges.value, other.id, node.id)))
      .filter((other: GraphObject) => !(kind === 'children' && wouldCloseParentCircle(graphEdges.value, node.id, other.id)))
      .map((other: GraphObject) => ({
        key: `node-${other.id}`,
        nodeId: other.id,
        name: nameOf(other.id),
        thumbnail: thumbnailOf(other),
        hint: other.term ?? '',
      }));
    const outside = unjoined.value.map((entry) => ({
      key: `name-${entry.name}`,
      nodeId: null,
      name: entry.name,
      thumbnail: entry.thumbnail,
      hint: t('household.will_join'),
    }));
    return [...inside, ...outside];
  };
  const byGroup: Record<string, Array<Record<string, any>>> = {};
  for (const group of LINK_GROUPS) byGroup[group.kind] = rows(group.kind);
  return byGroup;
});

// ---- one write at a time ----

// Two changes made in quick succession must both land, in that order, and no
// reading back may come between a write and the one after it.
let tail: Promise<unknown> = Promise.resolve();

function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * A graph as the page holds it now. Inside a queued job this is after whatever
 * was written before has been read back: a list of members taken when the user
 * clicked would be from before that, and writing it would undo it.
 */
const householdNow = (id: number) => households.value.find((entry: GraphObject) => entry.id === id) ?? null;

// ---- the links ----

async function addLink({ group, nodeId, name, label }: { group: string; nodeId: number | null; name: string; label?: string }) {
  const node = selectedNode.value;
  const household = current.value;
  if (!node || !household) return;
  const opened = pickerGroup.value;
  const linked = await queued(async () => {
    let other = nodeId;
    // A name that is in nobody's graph yet comes in first.
    if (other == null) {
      const ids = await importHouseholdNodes([name]);
      if (!Array.isArray(ids) || !ids.length) return false;
      const now = householdNow(household.id);
      if (!now) return false;
      const joined = await setHouseholdMembers(household.id, [...new Set([...(now.memberIds ?? []), ...ids.map(Number)])]);
      if (joined !== true) return false;
      [other] = ids.map(Number);
      // They are a member now, and the library replaces every link that
      // touches a member. Read the graph again before the batch is made, so
      // the links they already have elsewhere are in it, and not wiped out.
      await reload();
    }
    const draft = makeLink(group, node.id, Number(other), label);
    if (!draft) return false;
    const written = await setHouseholdEdges(household.id, [...graphEdges.value.map(edgePayload), draft]);
    if (written !== true) {
      toast.error(t('household.link_refused'));
      return false;
    }
    await reload();
    return true;
  });
  if (!linked && nodeId == null) toast.error(t('household.save_failed'));
  if (linked && pickerGroup.value === opened) pickerGroup.value = null;
}

async function removeLink(link: GraphObject) {
  const household = current.value;
  if (!household) return;
  await queued(async () => {
    const written = await setHouseholdEdges(household.id, graphEdges.value.filter((edge) => linkKey(edge) !== link.key).map(edgePayload));
    if (written !== true) {
      toast.error(t('household.link_refused'));
      return;
    }
    await reload();
  });
}

function togglePicker(group: string) {
  pickerGroup.value = pickerGroup.value === group ? null : group;
}

// ---- who a person is ----

async function save(details: Record<string, unknown>) {
  const id = selectedNode.value?.id;
  if (id == null) return;
  saveState.value = 'saving';
  await queued(async () => {
    // Who they are as the library holds them now. A change written just before
    // this one is in there, and must not be written over with what there was before it.
    const node = allNodes.value.find((entry: GraphObject) => entry.id === id) ?? null;
    if (!node) {
      saveState.value = 'error';
      return;
    }
    const written = await upsertHouseholdNode(nodeWithDetails(node, details));
    if (written === null) {
      saveState.value = 'error';
      toast.error(t('household.save_failed'));
      return;
    }
    await reload();
    saveState.value = 'saved';
  });
}

async function makeRoot() {
  const household = current.value;
  const node = selectedNode.value;
  if (!household || !node) return;
  await queued(async () => {
    const written = await updateHousehold(household.id, { rootNodeId: node.id });
    if (written !== true) {
      toast.error(t('household.save_failed'));
      return;
    }
    await reload();
  });
}

/** Whether the person selected is in another graph as well. */
const elsewhereSelected = computed(() => {
  const node = selectedNode.value;
  const household = current.value;
  return Boolean(node && household
    && households.value.some((entry: GraphObject) => entry.id !== household.id && entry.memberIds.includes(node.id)));
});

/**
 * Take the person out of this graph. A link belongs to two people, not to a
 * graph: the links between them and the people of this graph go with them
 * when this is their only graph; in another graph they stay, where they are
 * still wanted.
 */
async function removePerson() {
  const node = selectedNode.value;
  const household = current.value;
  if (!node || !household) return;
  const done = await queued(async () => {
    const now = householdNow(household.id);
    if (!now) return false;
    const members = new Set<number>(now.memberIds ?? []);
    if (!elsewhereSelected.value) {
      // The links go first, while the person still counts as a member: the
      // library replaces the links of the members, and only those.
      const gone = (edge: GraphEdge) => edge.fromNode === node.id || edge.toNode === node.id;
      const keeps = graphEdges.value.filter((edge: GraphEdge) => {
        if (!gone(edge)) return true;
        // A link out of the graph is the business of the graph it leads to.
        return !members.has(edge.fromNode === node.id ? edge.toNode : edge.fromNode);
      }).map(edgePayload);
      const written = await setHouseholdEdges(household.id, keeps);
      if (written !== true) {
        toast.error(t('household.link_refused'));
        return false;
      }
    }
    const left = await setHouseholdMembers(household.id, [...members].filter((id: number) => id !== node.id));
    if (left !== true) {
      toast.error(t('household.save_failed'));
      return false;
    }
    await reload();
    return true;
  });
  // The root is what is left to look at.
  if (done) selectedNodeId.value = current.value?.rootNodeId ?? null;
}

// ---- the people of the graph ----

/** Bring a name in as a person, and into a graph. */
async function bringIn(name: string, householdId?: number) {
  const household = households.value.find((entry) => entry.id === (householdId ?? current.value?.id)) ?? null;
  if (!household) return;
  const joined = await queued(async () => {
    const ids = await importHouseholdNodes([name]);
    if (!Array.isArray(ids) || !ids.length) return false;
    const now = householdNow(household.id);
    if (!now) return false;
    const written = await setHouseholdMembers(household.id, [...new Set([...(now.memberIds ?? []), ...ids.map(Number)])]);
    if (written !== true) return false;
    await reload();
    return true;
  });
  if (!joined) {
    toast.error(t('household.save_failed'));
    return;
  }
  showAdd.value = false;
  const node = nodeForName(allNodes.value, name);
  switchTo(households.value.findIndex((entry) => entry.id === household.id), node?.id ?? null);
}

// ---- the graph itself ----

async function toggleEnabled(enabled: boolean) {
  const household = current.value;
  if (!household) return;
  await queued(async () => {
    const written = await updateHousehold(household.id, { enabled });
    if (written !== true) {
      toast.error(t('household.save_failed'));
      return;
    }
    await reload();
  });
}

function switchGraph(index: number) {
  switchTo(index, households.value[index]?.rootNodeId ?? null);
}

function switchTo(index: number, nodeId: number | null) {
  currentIndex.value = Math.max(0, index);
  selectedNodeId.value = nodeId;
  pickerGroup.value = null;
}

/** The graph a person is in, if any. */
function graphOf(name: string): { index: number; nodeId: number } | null {
  const node = nodeForName(allNodes.value, name);
  if (!node) return null;
  const index = households.value.findIndex((entry) => entry.memberIds.includes(node.id));
  return index >= 0 ? { index, nodeId: node.id } : null;
}

/** A graph starts from a person: they are its root, and nobody else is in it yet. */
async function startGraph(name: string, { announce = false } = {}) {
  const choices = await ensureAlbums();
  const title = `${name}${t('household.name_suffix')}`;
  const created = await queued(() => createHousehold(title, choices.map((album) => album.id), name, [name]));
  if (created === null) {
    toast.error(t('household.save_failed'));
    return;
  }
  if (announce) toast.info(t('household.graph_created', { name: title }));
  showNew.value = false;
  await reload();
  switchTo(households.value.findIndex((entry) => entry.id === created), nodeForName(allNodes.value, name)?.id ?? null);
}

/** Pick a person and end up in their graph: the one there is, or a new one with them as the root. */
async function openGraphOf(row: { name: string }) {
  const { name } = row;
  const there = graphOf(name);
  if (there) {
    showNew.value = false;
    switchTo(there.index, there.nodeId);
    return;
  }
  await startGraph(name);
}

// ---- settings ----

const showSettings = ref(false);
const showNew = ref(false);
const showAdd = ref(false);
const draftName = ref('');
const draftAlbums = ref<number[]>([]);
const albums = ref<Array<{ id: number; name: string }>>([]);
const deleting = ref(false);
let forgetDelete: ReturnType<typeof setTimeout> | null = null;

async function ensureAlbums() {
  if (!albums.value.length) albums.value = await listAlbumChoices();
  return albums.value;
}

async function openSettings() {
  const household = current.value;
  if (!household) return;
  draftName.value = household.name;
  await ensureAlbums();
  draftAlbums.value = [...household.albumIds];
  deleting.value = false;
  showSettings.value = true;
}

function toggleAlbum(id: number, on: boolean) {
  draftAlbums.value = on ? [...new Set([...draftAlbums.value, id])] : draftAlbums.value.filter((entry) => entry !== id);
}

async function saveSettings() {
  const household = current.value;
  const name = draftName.value.trim();
  if (!household || !name) return;
  await queued(async () => {
    const written = await updateHousehold(household.id, { name, albumIds: draftAlbums.value });
    if (written !== true) {
      toast.error(t('household.save_failed'));
      return;
    }
    await reload();
    showSettings.value = false;
  });
}

function askDelete() {
  const household = current.value;
  if (!household) return;
  // One click asks; the next one, within a few seconds, does it.
  if (deleting.value) {
    deleting.value = false;
    void queued(async () => {
      const gone = await deleteHousehold(household.id);
      if (gone === null) {
        toast.error(t('household.save_failed'));
        return;
      }
      await reload();
      showSettings.value = false;
      switchTo(0, null);
    });
    return;
  }
  deleting.value = true;
  forgetDelete = setTimeout(() => {
    deleting.value = false;
  }, 5000);
}

// ---- what to offer ----

const rootChoices = computed(() =>
  persons.value
    // A graph is built from names the user gave; a made-up one is not a choice.
    .filter((person) => !isAutoPersonName(person.name))
    .map((person) => {
      // Picking somebody who has a graph opens it: the card says which.
      const there = graphOf(person.name);
      return {
        key: `person-${person.id}`,
        name: person.name,
        nodeId: nodeForName(allNodes.value, person.name)?.id ?? null,
        thumbnail: person.thumbnail ?? null,
        count: there ? null : person.count ?? null,
        hint: there ? households.value[there.index].name : '',
      };
    }),
);
const addChoices = computed(() =>
  unjoined.value.map((entry) => ({
    key: `name-${entry.name}`,
    name: entry.name,
    nodeId: null,
    thumbnail: entry.thumbnail,
    count: entry.count ?? null,
  })),
);

// ---- selection ----

function selectNode(id: number) {
  if (selectedNodeId.value === id) return;
  selectedNodeId.value = id;
  pickerGroup.value = null;
}

function clearSelection() {
  selectedNodeId.value = null;
  pickerGroup.value = null;
}

// Whoever was selected and leaves the graph takes the selection with them:
// the root is what there is to look at then.
watch([memberNodes, currentIndex], () => {
  if (selectedNodeId.value != null && !memberNodes.value.some((node: GraphObject) => node.id === selectedNodeId.value)) {
    selectedNodeId.value = current.value?.rootNodeId ?? null;
    pickerGroup.value = null;
  }
});
watch(households, () => {
  if (currentIndex.value >= households.value.length) currentIndex.value = 0;
});

// ---- opening the page ----

/**
 * Bring a person into view: the graph that has them opens on them, and when
 * nobody has them yet they join — or, with no graph at all, start one.
 */
async function focusPerson(personId: number) {
  const person = persons.value.find((entry) => entry.id === personId);
  if (!person) return;
  // A graph is built from names: somebody without one cannot be in it.
  if (isAutoPersonName(person.name)) {
    toast.warning(t('household.name_first'));
    return;
  }
  const node = nodeForName(allNodes.value, person.name);
  if (node) {
    const index = households.value.findIndex((household) => household.memberIds.includes(node.id));
    if (index >= 0) {
      switchTo(index, node.id);
      return;
    }
  }
  if (!households.value.length) {
    await startGraph(person.name, { announce: true });
    return;
  }
  // One graph: that is where somebody new belongs. Which of several is not
  // for the page to guess: they wait under the list, one click away.
  if (households.value.length === 1) {
    await bringIn(person.name, households.value[0].id);
    return;
  }
  selectedNodeId.value = null;
  pickerGroup.value = null;
}

/** Somebody picked from the list of those not in the graph. */
function pickToJoin(row: { name: string }) {
  return bringIn(row.name);
}

async function loadPersons() {
  persons.value = await listPersons();
}

async function bootstrap() {
  await Promise.all([reload(), loadPersons()]);
  const wanted = personIdIn(window.location?.search);
  if (wanted != null) {
    await focusPerson(wanted);
    return;
  }
  // A graph opens on its root: the root is where the links start.
  selectedNodeId.value = current.value?.rootNodeId ?? null;
}

let unlisten: (() => void) | null = null;

onMounted(async () => {
  // Picking "open the graph" on another person in the main window moves this page too.
  try {
    unlisten = await listen('household-select', (event: { payload?: { personId?: number } }) => {
      if (event.payload?.personId != null) void focusPerson(event.payload.personId);
    });
  } catch (error) {
    console.error('Failed to listen for the person to show:', error);
  }
  await bootstrap();
});

onBeforeUnmount(() => {
  unlisten?.();
  unlisten = null;
  if (forgetDelete) clearTimeout(forgetDelete);
});
</script>
