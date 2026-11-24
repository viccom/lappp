<template>
  <div class="flex flex-col h-screen bg-base-100 text-base-content">
    <!-- top bar: which graph, its root, whether it feeds the model -->
    <div class="shrink-0 border-b border-base-content/10">
      <div class="flex items-center gap-2 px-3 h-11 min-w-0">
        <select
          v-if="households.length > 1"
          class="select select-xs select-ghost max-w-48 font-medium shrink-0"
          :value="currentIndex"
          @change="currentIndex = Number(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="(household, index) in households" :key="household.id" :value="index">
            {{ household.name }}
          </option>
        </select>
        <span v-else class="text-sm font-medium truncate min-w-0">
          {{ current?.name || t('household.title') }}
        </span>

        <span v-if="rootName" class="text-xs text-base-content/50 truncate min-w-0">
          {{ t('household.root') }}: {{ rootName }}
        </span>

        <label
          v-if="current"
          class="ml-auto flex items-center gap-1.5 text-xs text-base-content/60 cursor-pointer shrink-0 whitespace-nowrap"
        >
          <input
            type="checkbox"
            class="toggle toggle-xs"
            :checked="current.enabled !== false"
            @change="toggleEnabled(($event.target as HTMLInputElement).checked)"
          />
          {{ t('household.used_for_vision') }}
        </label>

        <TButton
          :text="t('settings.household.new')"
          :buttonSize="'small'"
          @click="openCreate"
        />
      </div>
    </div>

    <!-- no graph yet: one button, and what it is for -->
    <div v-if="!households.length" class="flex-1 flex items-center justify-center p-8">
      <div class="max-w-md flex flex-col items-center gap-3 text-center">
        <IconPerson class="w-10 h-10 text-base-content/20" />
        <div class="text-sm text-base-content/60">{{ t('household.no_graph_yet') }}</div>
        <div class="text-xs text-base-content/40 leading-5">{{ t('household.no_graph_hint') }}</div>
        <TButton :text="t('household.create_confirm')" @click="openCreate" />
      </div>
    </div>

    <div v-else class="flex flex-1 min-h-0">
      <!-- left: the members, and the names that could still join -->
      <div class="w-56 shrink-0 border-r border-base-content/10 flex flex-col min-h-0">
        <div class="flex-1 overflow-y-auto px-1 py-1">
          <div class="px-2 py-1 text-[11px] uppercase tracking-wider text-base-content/40">
            {{ t('household.members') }} ({{ memberNodes.length }})
          </div>
          <button
            v-for="node in memberNodes"
            :key="node.id"
            class="sidebar-item h-8 gap-2 text-sm"
            :class="selectedNodeId === node.id ? 'sidebar-item-selected' : 'sidebar-item-hover'"
            @click="selectedNodeId = node.id"
          >
            <IconPerson class="w-4 h-4 shrink-0 text-base-content/30" />
            <span class="sidebar-item-label truncate">{{ nameOf(node.id) }}</span>
            <span
              v-if="node.id === current?.rootNodeId"
              class="ml-auto shrink-0 text-[10px] px-1 rounded-box bg-primary/15 text-primary"
            >{{ t('household.root') }}</span>
            <span v-else-if="node.term" class="ml-auto shrink-0 text-[11px] text-base-content/40">
              {{ node.term }}
            </span>
          </button>
        </div>

        <div v-if="unjoined.length" class="border-t border-base-content/10 max-h-52 overflow-y-auto px-1 py-1">
          <div class="px-2 py-1 text-[11px] uppercase tracking-wider text-base-content/40">
            {{ t('household.not_joined') }} ({{ unjoined.length }})
          </div>
          <button
            v-for="entry in unjoined"
            :key="entry.name"
            class="sidebar-item h-8 gap-2 text-sm text-base-content/60"
            @click="join(entry.name)"
          >
            <span class="w-4 shrink-0 text-center">+</span>
            <span class="sidebar-item-label truncate">{{ entry.name }}</span>
            <span class="ml-auto shrink-0 text-[11px] text-base-content/30">{{ (entry as any).count ?? '' }}</span>
          </button>
        </div>
      </div>

      <!-- the canvas: the rows are computed, the nodes are not draggable -->
      <div
        ref="canvasRef"
        class="flex-1 min-w-0 overflow-hidden relative cursor-grab active:cursor-grabbing"
        @wheel.prevent="onWheel"
        @mousedown="onPanStart"
      >
        <svg :viewBox="viewBox" class="w-full h-full" @mousedown.self="selectedNodeId = null">
          <g v-for="(row, rowIndex) in layout.generations" :key="rowIndex">
            <g v-for="(id, columnIndex) in row" :key="id">
              <line
                v-for="edge in linesOf(id)"
                :key="edge.key"
                :x1="position(id).x" :y1="position(id).y + NODE_R"
                :x2="edge.x" :y2="edge.y"
                :stroke-dasharray="edge.dashed ? '4 3' : undefined"
                class="stroke-base-content/25"
                stroke-width="1.5"
              />
              <g
                class="cursor-pointer"
                @click.stop="selectNode(id)"
              >
                <circle
                  :cx="position(id).x" :cy="position(id).y"
                  :r="NODE_R"
                  :class="selectedNodeId === id ? 'fill-primary/25 stroke-primary' : 'fill-base-200 stroke-base-content/25'"
                  stroke-width="2"
                />
                <text
                  :x="position(id).x" :y="position(id).y + 4"
                  text-anchor="middle"
                  class="fill-base-content text-[13px] select-none"
                >{{ shortName(id) }}</text>
                <text
                  v-if="id === current?.rootNodeId"
                  :x="position(id).x" :y="position(id).y - NODE_R - 6"
                  text-anchor="middle"
                  class="fill-primary text-[10px] select-none"
                >{{ t('household.root') }}</text>
              </g>
            </g>
          </g>
        </svg>

        <div v-if="!memberNodes.length" class="absolute inset-0 flex items-center justify-center text-sm text-base-content/40">
          {{ t('household.empty_graph') }}
        </div>
      </div>
    </div>

    <!-- bottom: the links of the person that is selected -->
    <div v-if="selectedNodeId !== null" class="shrink-0 border-t border-base-content/10 px-3 py-2">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span class="text-sm font-medium">{{ nameOf(selectedNodeId) }}</span>

        <div v-for="group in linkGroups" :key="group.kind" class="flex items-center gap-1.5 flex-wrap">
          <span class="text-[11px] text-base-content/40">{{ t(group.labelKey) }}</span>
          <span
            v-for="link in group.links"
            :key="link.key"
            class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-box bg-base-300/60"
          >
            {{ link.text }}
            <button class="text-base-content/40 hover:text-error" @click="removeLink(link)">×</button>
          </span>
          <SearchableSelect
            v-if="group.addable && candidatesFor(group.kind).length"
            :options="candidatesFor(group.kind).map((candidate: any) => ({ value: candidate.id, label: nameOf(candidate.id) }))"
            :placeholder="t('household.add')"
            :searchPlaceholder="t('household.search_names')"
            :emptyText="t('household.no_candidates')"
            @update:modelValue="(id: any) => addLink(group.kind, id)"
          />
        </div>
      </div>

    <!-- create a graph: a name, a root, who joins it, which albums it covers -->
    <ModalDialog
      v-if="showCreate"
      :title="t('household.create_title')"
      :width="440"
      @cancel="showCreate = false"
    >
      <div class="flex flex-col gap-1.5 min-h-0">
        <div class="text-xs text-base-content/50">{{ t('household.name') }}</div>
        <input
          v-model="draftName"
          class="input input-sm w-full"
          :placeholder="t('household.name_hint')"
        />

        <div class="text-xs text-base-content/50 mt-1">{{ t('household.root_choice') }}</div>
        <select v-model="draftRoot" class="select select-sm w-full">
          <option value="">{{ t('household.choose_one') }}</option>
          <option v-for="entry in namedFaces" :key="entry.name" :value="entry.name">
            {{ entry.name }}
          </option>
        </select>

        <div class="text-xs text-base-content/50 mt-1">{{ t('household.members_choice') }}</div>
        <div class="max-h-36 overflow-y-auto rounded-box border border-base-content/10 p-1">
          <label
            v-for="entry in namedFaces"
            :key="entry.name"
            class="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer"
          >
            <input type="checkbox" class="checkbox checkbox-xs" :value="entry.name" v-model="draftMembers" />
            <span class="truncate">{{ entry.name }}</span>
          </label>
          <div v-if="!namedFaces.length" class="px-1 py-2 text-xs text-base-content/40">
            {{ t('household.no_named_faces') }}
          </div>
        </div>

        <div class="text-xs text-base-content/50 mt-1">{{ t('household.albums') }}</div>
        <div class="max-h-28 overflow-y-auto rounded-box border border-base-content/10 p-1">
          <label
            v-for="album in albumChoices"
            :key="album.id"
            class="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer"
          >
            <input type="checkbox" class="checkbox checkbox-xs" :value="album.id" v-model="draftAlbums" />
            <span class="truncate">{{ album.name }}</span>
          </label>
          <div v-if="!albumChoices.length" class="px-1 py-2 text-xs text-base-content/40">
            {{ t('household.no_albums') }}
          </div>
        </div>
        <div class="text-[11px] text-base-content/40 leading-4">{{ t('household.albums_hint') }}</div>

        <div class="flex justify-end gap-2 mt-2">
          <TButton :text="t('msgbox.cancel')" @click="showCreate = false" />
          <TButton
            :text="t('household.create_confirm')"
            buttonClasses="btn-primary"
            :disabled="!canCreate"
            @click="submitCreate"
          />
        </div>
      </div>
    </ModalDialog>

      <div v-if="derivedTerms.length" class="mt-1 text-[11px] text-base-content/40 truncate">
        {{ t('household.derived') }}: {{ derivedTerms.join(' · ') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconPerson } from '@/common/icons';
import SearchableSelect from '@/components/SearchableSelect.vue';
import TButton from '@/components/TButton.vue';
import { useHousehold } from '@/composables/useHousehold';
import ModalDialog from '@/components/ModalDialog.vue';
import {
  createHousehold,
  listAlbumChoices,
  importHouseholdNodes,
  setHouseholdEdges,
  setHouseholdMembers,
  updateHousehold,
} from '@/common/householdApi';
import { edgeDraft, layoutGenerations, relationCandidates, unjoinedNames } from '@/common/householdLogic';

const { t } = useI18n();
const { overview, faceNames, reload, nameOf } = useHousehold();

const NODE_R = 26;
const ROW_GAP = 110;
const COLUMN_GAP = 130;

const currentIndex = ref(0);

// The dialog that creates a graph. Without one the page cannot be used at all,
// so it lives here rather than behind a parent that may not listen.
const showCreate = ref(false);
const draftName = ref('');
const draftRoot = ref('');
const draftMembers = ref<string[]>([]);
const draftAlbums = ref<number[]>([]);
const albumChoices = ref<Array<{ id: number; name: string }>>([]);

/** The names a graph can be built from: the ones the user gave the faces. */
const namedFaces = computed(() => faceNames.value);

const canCreate = computed(
  () => Boolean(draftRoot.value) && draftName.value.trim().length > 0,
);

async function openCreate() {
  draftName.value = '';
  draftRoot.value = '';
  draftMembers.value = namedFaces.value.map((entry: any) => entry.name);
  draftAlbums.value = albumChoices.value.map((album) => album.id);
  showCreate.value = true;
  if (!albumChoices.value.length) {
    albumChoices.value = await listAlbumChoices();
    if (!draftAlbums.value.length) {
      draftAlbums.value = albumChoices.value.map((album) => album.id);
    }
  }
}

// The name follows the root until the user types one.
watch(draftRoot, (root) => {
  if (root && (!draftName.value || draftName.value.endsWith('家'))) {
    draftName.value = `${root}${t('household.name_suffix')}`;
  }
});

async function submitCreate() {
  if (!canCreate.value) return;
  const members = new Set(draftMembers.value);
  // The root belongs to the graph whether or not it was ticked.
  members.add(draftRoot.value);
  const created = await createHousehold(
    draftName.value.trim(),
    draftAlbums.value,
    draftRoot.value,
    [...members],
  );
  if (created === null) return;
  showCreate.value = false;
  await reload();
  const index = households.value.findIndex((household: any) => household.id === created);
  currentIndex.value = index >= 0 ? index : 0;
  selectedNodeId.value = null;
}
const selectedNodeId = ref<number | null>(null);

const households = computed<any[]>(() => overview.value?.households ?? []);
const current = computed<any>(() => households.value[currentIndex.value] ?? null);

const householdOptions = computed(() =>
  households.value.map((household: any, index: number) => ({ value: index, label: household.name })),
);

/** The objects that belong to the graph that is open. */
const memberNodes = computed<any[]>(() => {
  const memberIds = new Set<number>(current.value?.memberIds ?? []);
  return (overview.value?.nodes ?? []).filter((node: any) => memberIds.has(node.id));
});

const rootName = computed(() =>
  current.value?.rootNodeId != null ? nameOf(current.value.rootNodeId) : '',
);

/** The links of the graph that is open. */
const graphEdges = computed<any[]>(() => {
  const memberIds = new Set<number>(current.value?.memberIds ?? []);
  return (overview.value?.edges ?? []).filter(
    (edge: any) => memberIds.has(edge.fromNode) || memberIds.has(edge.toNode),
  );
});

const layout = computed(() => layoutGenerations(memberNodes.value, graphEdges.value));

/** Where a node stands on the canvas. */
function position(id: number) {
  const row = layout.value.rowOf.get(id) ?? 0;
  const column = layout.value.generations[row]?.indexOf(id) ?? 0;
  return { x: column * COLUMN_GAP + 60, y: row * ROW_GAP + 60 };
}

/** Pick a person: the canvas and the bar under it follow. */
function selectNode(id: number) {
  selectedNodeId.value = id;
}

function shortName(id: number) {
  const name = nameOf(id);
  return name.length > 4 ? `${name.slice(0, 4)}…` : name;
}

/** The lines that leave a node, towards the nodes below or beside it. */
function linesOf(id: number) {
  const mine = position(id);
  const lines: any[] = [];
  for (const edge of graphEdges.value) {
    const other = edge.fromNode === id ? edge.toNode : edge.toNode === id ? edge.fromNode : null;
    if (other === null) continue;
    const place = position(other);
    const below = place.y > mine.y;
    lines.push({
      key: `${edge.kind}-${edge.fromNode}-${edge.toNode}-${edge.label ?? ''}`,
      x: place.x,
      y: below ? place.y - NODE_R : place.y,
      dashed: edge.kind === 'social',
    });
  }
  return lines;
}

/** The names that could join, minus the ones a graph already holds. */
const unjoined = computed(() =>
  unjoinedNames(faceNames.value, new Set(memberNodes.value.flatMap((node: any) => node.anchors ?? []))),
);

const viewBox = computed(() => {
  const rows = layout.value.generations.length || 1;
  const columns = Math.max(1, ...layout.value.generations.map((row) => row.length));
  return `0 0 ${columns * COLUMN_GAP + 60} ${rows * ROW_GAP + 60}`;
});

// ---- the links of one person ----

/** The four groups the bar shows, in the order the design draws them. */
const LINK_GROUPS = [
  { kind: 'parents', labelKey: 'household.parents', edgeKind: 'parent', outgoing: true },
  { kind: 'children', labelKey: 'household.children', edgeKind: 'parent', outgoing: false },
  { kind: 'spouse', labelKey: 'household.spouse', edgeKind: 'spouse', outgoing: true },
  { kind: 'social', labelKey: 'household.social', edgeKind: 'social', outgoing: true },
];

function linksOfSelected(kind: any) {
  if (selectedNodeId.value === null) return [];
  return graphEdges.value.filter((edge: any) => {
    if (edge.kind !== kind.edgeKind) return false;
    return kind.outgoing ? edge.fromNode === selectedNodeId.value : edge.toNode === selectedNodeId.value;
  });
}

const linkGroups = computed(() =>
  LINK_GROUPS.map((group) => ({
    kind: group.kind,
    labelKey: group.labelKey,
    addable: true,
    links: linksOfSelected(group).map((edge: any) => ({
      key: `${edge.kind}-${edge.fromNode}-${edge.toNode}-${edge.label ?? ''}`,
      edge,
      text:
        group.kind === 'parents'
          ? nameOf(edge.toNode)
          : group.kind === 'children'
            ? nameOf(edge.fromNode)
            : group.kind === 'social'
              ? `${nameOf(edge.fromNode === selectedNodeId.value ? edge.toNode : edge.fromNode)} (${t(`household.social_label.${edge.label}`)})`
              : nameOf(edge.fromNode === selectedNodeId.value ? edge.toNode : edge.fromNode),
    })),
  })),
);

const derivedTerms = computed(() => {
  if (selectedNodeId.value === null) return [];
  const root = current.value?.rootNodeId;
  return graphEdges.value
    .filter((edge: any) => edge.fromNode === selectedNodeId.value || edge.toNode === selectedNodeId.value)
    .map((edge: any) => {
      const other = edge.fromNode === selectedNodeId.value ? edge.toNode : edge.fromNode;
      return `${nameOf(other)}${root === other ? '' : ''}`;
    })
    .filter((value: string, index: number, all: string[]) => all.indexOf(value) === index);
});

function candidatesFor(kind: string) {
  const linked = linkGroups.value
    .find((group) => group.kind === kind)
    ?.links.flatMap((link: any) => [link.edge.fromNode, link.edge.toNode]) ?? [];
  return relationCandidates(
    memberNodes.value.map((node: any) => ({ id: node.id, name: nameOf(node.id) })),
    memberNodes.value.map((node: any) => node.id),
    { excludeIds: selectedNodeId.value === null ? [] : [selectedNodeId.value], linkedIds: linked },
  );
}

/** Add one link and write the whole set of links of the graph. */
async function addLink(kind: string, otherId: number) {
  if (selectedNodeId.value === null || !current.value) return;
  const draft =
    kind === 'parents'
      ? edgeDraft('parent', otherId, selectedNodeId.value)
      : kind === 'children'
        ? edgeDraft('parent', selectedNodeId.value, otherId)
        : kind === 'spouse'
          ? edgeDraft('spouse', selectedNodeId.value, otherId)
          : edgeDraft('social', selectedNodeId.value, otherId, 'friend');
  await writeEdges([...graphEdges.value.map(toEdgePayload), draft]);
}

async function removeLink(link: any) {
  if (!current.value) return;
  const rest = graphEdges.value
    .filter((edge: any) => edge !== link.edge)
    .map(toEdgePayload);
  await writeEdges(rest);
}

function toEdgePayload(edge: any) {
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

/** Write the links, then read the graph back: the server normalises them. */
async function writeEdges(edges: any[]) {
  if (!current.value) return;
  const result = await setHouseholdEdges(current.value.id, edges);
  if (result === null) return;
  await reload();
}

/** Bring a name of a face in as an object and into this graph. */
async function join(name: string) {
  if (!current.value) return;
  const ids = await importHouseholdNodes([name]);
  if (!Array.isArray(ids) || !ids.length) return;
  const members = new Set<number>(current.value.memberIds ?? []);
  for (const id of ids) members.add(id);
  await setHouseholdMembers(current.value.id, [...members]);
  await reload();
}

async function toggleEnabled(value: boolean) {
  if (!current.value) return;
  await updateHousehold(current.value.id, { enabled: value });
  await reload();
}

// ---- moving the canvas ----

const zoom = ref(1);
const offset = ref({ x: 0, y: 0 });
let panning: { x: number; y: number; startX: number; startY: number } | null = null;

function onWheel(event: WheelEvent) {
  const next = zoom.value * (event.deltaY > 0 ? 0.9 : 1.1);
  zoom.value = Math.min(2, Math.max(0.4, next));
}

function onPanStart(event: MouseEvent) {
  panning = { x: offset.value.x, y: offset.value.y, startX: event.clientX, startY: event.clientY };
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', onPanEnd);
}

function onPanMove(event: MouseEvent) {
  if (!panning) return;
  offset.value = {
    x: panning.x + (event.clientX - panning.startX),
    y: panning.y + (event.clientY - panning.startY),
  };
}

function onPanEnd() {
  panning = null;
  window.removeEventListener('mousemove', onPanMove);
  window.removeEventListener('mouseup', onPanEnd);
}

onMounted(reload);
watch(households, () => {
  if (currentIndex.value >= households.value.length) currentIndex.value = 0;
});
</script>
